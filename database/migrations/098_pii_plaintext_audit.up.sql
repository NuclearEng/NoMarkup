-- Migration 098 — make un-encrypted PII findable, and record that ein_tin /
-- insurance_policy_number now have a RUNTIME encryption path.
--
-- Builds on:
--   031 — pii_encrypted_v1 on users + provider_profiles
--   033 — pii_encrypted_v1 on provider_employees + properties
--
-- ── The gap this closes ──────────────────────────────────────────────────
-- 031 declared provider_profiles.ein_tin and .insurance_policy_number
-- "encrypted", and database/cmd/encrypt-pii converted the rows that existed at
-- backfill time. But nothing in Go ever WROTE those columns through the cipher:
-- services/user/internal/repository/postgres.go carried the admission
-- "ein_tin and insurance_policy_number are not selected by this scanner". Any
-- row written after the backfill would therefore have landed in plaintext under
-- a schema comment claiming otherwise.
--
-- The Go half of the fix ships alongside this migration:
--   * services/user/internal/repository/postgres.go — the provider_profiles
--     scanner now selects and decrypts both columns, and UpdateProviderProfile
--     encrypts every PII column on the way in.
--   * gateway/internal/handler/data_export.go — the GDPR Art. 15 export
--     decrypts instead of returning base64.
--   * database/cmd/encrypt-pii — reconciles by VALUE, so it can no longer
--     double-encrypt (it previously did exactly that during a key rotation).
--
-- ── Why this migration does not itself encrypt anything ──────────────────
-- It cannot. The wire format is XSalsa20-Poly1305 (nacl/secretbox); PostgreSQL
-- ships no libsodium and pgcrypto implements a different construction entirely.
-- Inventing a second algorithm here so that "the migration does the work" would
-- give us two incompatible ciphertexts in one column — strictly worse than the
-- bug. 031 made the same call for the same reason. The conversion stays in
-- `make encrypt-pii`; this migration makes the work VERIFIABLE.
--
-- Consequently this migration mutates NO row and NO PII value. The
-- quarantine-before-mutation rule (see 075/081) is satisfied vacuously: there
-- is nothing to archive because nothing is destroyed. That is deliberate for a
-- second reason — the archive tables 075/081 use hold money, which is not
-- secret. Copying plaintext EIN/TIN into a quarantine table to "preserve" it
-- would DUPLICATE the exposure this whole work stream exists to remove.
--
-- ── The discriminator ────────────────────────────────────────────────────
-- pii_looks_like_secretbox() decides, from the value alone, whether a column
-- could be our ciphertext. A value produced by Cipher.EncryptString is
-- base64(nonce || secretbox), where nonce is 24 bytes and the sealed box
-- carries a 16-byte Poly1305 tag. So ANY genuine ciphertext:
--
--   * uses only the standard base64 alphabet [A-Za-z0-9+/] with '=' padding,
--   * has a length that is a multiple of 4,
--   * decodes to at least 24 + 16 = 40 bytes, which requires at least 56
--     encoded characters.
--
-- Failing any of those means the value cannot be our ciphertext, so it is
-- plaintext. The real values in these columns miss by a wide margin: an EIN/TIN
-- is "12-3456789" (10 chars, and '-' is outside the base64 alphabet), policy
-- numbers are short and usually punctuated, phone numbers contain '-' or '+',
-- street addresses contain spaces and commas.
--
-- The converse is intentionally NOT claimed here. Passing the shape test does
-- not prove a value IS ciphertext — only that it could be. Proving it requires
-- opening the Poly1305 tag with the actual key, which only the Go tool can do.
-- That asymmetry is why this view is named for what it can prove:
-- pii_plaintext_audit lists DEFINITE plaintext (shape test failed), never
-- "probable ciphertext". A shape-passing value that no key opens is caught by
-- encrypt-pii's pre-flight, which refuses to run rather than guess.

SET lock_timeout = '5s';

-- ── 1. The discriminator ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION pii_looks_like_secretbox(v TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
    raw BYTEA;
BEGIN
    -- NULL and empty are neither plaintext nor ciphertext; callers treat them
    -- as "nothing stored". Returning TRUE here keeps them OUT of the plaintext
    -- audit view, which is the useful behaviour.
    IF v IS NULL OR v = '' THEN
        RETURN TRUE;
    END IF;

    -- 56 chars is the minimum encoding of 40 bytes (24-byte nonce + 16-byte
    -- Poly1305 tag), i.e. the ciphertext of a ZERO-length message. Anything
    -- shorter cannot be our wire format.
    IF length(v) < 56 THEN
        RETURN FALSE;
    END IF;

    -- Standard base64 alphabet with at most two '=' pad characters, and a
    -- length that is a multiple of 4. decode() is lenient about whitespace, so
    -- this regex is what actually enforces the alphabet.
    IF v !~ '^[A-Za-z0-9+/]+={0,2}$' OR length(v) % 4 <> 0 THEN
        RETURN FALSE;
    END IF;

    BEGIN
        raw := decode(v, 'base64');
    EXCEPTION WHEN others THEN
        RETURN FALSE;
    END;

    RETURN octet_length(raw) >= 40;
END;
$$;

COMMENT ON FUNCTION pii_looks_like_secretbox(TEXT) IS
    'TRUE when v could be base64(nonce||secretbox) as written by Cipher.EncryptString: standard base64, length a multiple of 4, decoding to >= 40 bytes (24-byte nonce + 16-byte Poly1305 tag). NULL/empty return TRUE (nothing stored). FALSE is decisive — the value is definitely NOT our ciphertext. TRUE is NOT proof of ciphertext; only opening the Poly1305 tag with the key proves that, which database/cmd/encrypt-pii does. See migration 098.';

-- ── 2. The audit view ────────────────────────────────────────────────────
-- One row per PII value that is DEFINITELY still plaintext. On a fully
-- backfilled database this view is empty:
--
--   SELECT table_name, column_name, count(*)
--     FROM pii_plaintext_audit GROUP BY 1,2 ORDER BY 1,2;
--
-- It exposes only the table, the column and the row id — never the value —
-- so the audit itself cannot become a plaintext-PII sink.

CREATE OR REPLACE VIEW pii_plaintext_audit AS
    SELECT 'users'::TEXT AS table_name, 'phone'::TEXT AS column_name, id, pii_encrypted_v1
      FROM users
     WHERE deleted_at IS NULL AND phone IS NOT NULL AND phone <> ''
       AND NOT pii_looks_like_secretbox(phone)
UNION ALL
    SELECT 'users', 'mfa_secret', id, pii_encrypted_v1
      FROM users
     WHERE deleted_at IS NULL AND mfa_secret IS NOT NULL AND mfa_secret <> ''
       AND NOT pii_looks_like_secretbox(mfa_secret)
UNION ALL
    SELECT 'provider_profiles', 'service_address', id, pii_encrypted_v1
      FROM provider_profiles
     WHERE service_address IS NOT NULL AND service_address <> ''
       AND NOT pii_looks_like_secretbox(service_address)
UNION ALL
    SELECT 'provider_profiles', 'ein_tin', id, pii_encrypted_v1
      FROM provider_profiles
     WHERE ein_tin IS NOT NULL AND ein_tin <> ''
       AND NOT pii_looks_like_secretbox(ein_tin)
UNION ALL
    SELECT 'provider_profiles', 'insurance_policy_number', id, pii_encrypted_v1
      FROM provider_profiles
     WHERE insurance_policy_number IS NOT NULL AND insurance_policy_number <> ''
       AND NOT pii_looks_like_secretbox(insurance_policy_number)
UNION ALL
    SELECT 'provider_employees', 'email', id, pii_encrypted_v1
      FROM provider_employees
     WHERE email IS NOT NULL AND email <> ''
       AND NOT pii_looks_like_secretbox(email)
UNION ALL
    SELECT 'provider_employees', 'phone', id, pii_encrypted_v1
      FROM provider_employees
     WHERE phone IS NOT NULL AND phone <> ''
       AND NOT pii_looks_like_secretbox(phone)
UNION ALL
    SELECT 'provider_employees', 'license_number', id, pii_encrypted_v1
      FROM provider_employees
     WHERE license_number IS NOT NULL AND license_number <> ''
       AND NOT pii_looks_like_secretbox(license_number)
UNION ALL
    SELECT 'provider_employees', 'insurance_policy_number', id, pii_encrypted_v1
      FROM provider_employees
     WHERE insurance_policy_number IS NOT NULL AND insurance_policy_number <> ''
       AND NOT pii_looks_like_secretbox(insurance_policy_number)
UNION ALL
    SELECT 'properties', 'address', id, pii_encrypted_v1
      FROM properties
     WHERE deleted_at IS NULL AND address IS NOT NULL AND address <> ''
       AND NOT pii_looks_like_secretbox(address)
UNION ALL
    SELECT 'properties', 'notes', id, pii_encrypted_v1
      FROM properties
     WHERE deleted_at IS NULL AND notes IS NOT NULL AND notes <> ''
       AND NOT pii_looks_like_secretbox(notes);

COMMENT ON VIEW pii_plaintext_audit IS
    'Every at-rest PII value that is DEFINITELY still plaintext (it fails pii_looks_like_secretbox). Empty on a fully backfilled database. Run `make encrypt-pii` to drain it. Exposes table/column/row id only — never the value. See migration 098.';

-- ── 3. Report the current state in the deploy log ────────────────────────
-- A NOTICE, not an exception: this migration must never wedge the pipeline
-- (golang-migrate stamps dirty=TRUE before executing, so a RAISE here would
-- require a manual `migrate force 97` — see the 081 header for the same
-- reasoning). Remaining plaintext is an operational task, not a schema fault.

DO $$
DECLARE
    remaining BIGINT;
BEGIN
    SELECT count(*) INTO remaining FROM pii_plaintext_audit;
    IF remaining > 0 THEN
        RAISE NOTICE 'migration 098: % PII value(s) are still plaintext. Run `make encrypt-pii` (see docs/operations/encryption-key-rotation.md). Detail: SELECT table_name, column_name, count(*) FROM pii_plaintext_audit GROUP BY 1,2;', remaining;
    ELSE
        RAISE NOTICE 'migration 098: no plaintext PII detected.';
    END IF;
END
$$;

-- ── 4. Correct the schema comments ───────────────────────────────────────
-- 031's comment described a state the code did not implement. These replace it
-- with what is now true, per column rather than per row.

COMMENT ON COLUMN provider_profiles.ein_tin IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305. Encrypted on write by services/user/internal/repository UpdateProviderProfile and decrypted on read by scanProviderProfile; backfilled/re-keyed by database/cmd/encrypt-pii. Detection is per VALUE — do not rely on the row-level pii_encrypted_v1 flag for this column.';

COMMENT ON COLUMN provider_profiles.insurance_policy_number IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305. Encrypted on write by services/user/internal/repository UpdateProviderProfile and decrypted on read by scanProviderProfile; backfilled/re-keyed by database/cmd/encrypt-pii. Detection is per VALUE — do not rely on the row-level pii_encrypted_v1 flag for this column.';

COMMENT ON COLUMN provider_profiles.service_address IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305. Encrypted on write, decrypted on read, per value.';

COMMENT ON COLUMN provider_profiles.insurance_provider IS
    'NOT encrypted, deliberately: this is a carrier name (a company), not personal data, and it is displayed on provider profiles.';

-- pii_encrypted_v1 is now advisory. It is a ROW flag over a per-COLUMN
-- property, so a row whose service_address was written through the encrypting
-- update path reads TRUE even while its ein_tin is still legacy plaintext. Read
-- paths detect per value; the flag survives for observability and for the
-- backfill tool's reporting.
COMMENT ON COLUMN provider_profiles.pii_encrypted_v1 IS
    'ADVISORY ONLY as of migration 098. TRUE means at least one PII column on this row has been written encrypted; it does NOT mean every column has. Read paths detect ciphertext per value (crypto.Cipher.DecryptStringOrPassthrough) and must not branch on this flag. Use the pii_plaintext_audit view for a truthful per-column picture.';

COMMENT ON COLUMN users.pii_encrypted_v1 IS
    'ADVISORY ONLY as of migration 098. See provider_profiles.pii_encrypted_v1 and the pii_plaintext_audit view.';
