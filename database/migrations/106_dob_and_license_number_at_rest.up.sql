-- Migration 106 — the three PII columns that were added AFTER the encryption
-- passes and never reviewed against them.
--
-- Builds on:
--   031 — users.pii_encrypted_v1 (phone, mfa_secret, mfa_backup_codes)
--   033 — provider_employees (email, phone, license_number,
--         insurance_policy_number)
--   098 — per-VALUE detection; the audit view; the rule that a comment
--         asserting a security property the code does not provide is worse
--         than no comment
--   099 — the same correction applied to company_employees.ssn_last_four
--
-- Each of these three post-dates the pass that would have caught it:
--
--   users.dob                        added by 043 (compliance bid bonds)
--   provider_employees.date_of_birth added by 026, one migration before 033
--                                    covered four of its SIBLING columns
--   provider_licenses.license_number added by 062, whose own inline comment
--                                    reads "Full license number for admin
--                                    review (sensitive)"
--
-- The last one is the sharpest: provider_employees.license_number IS
-- encrypted (033) and provider_licenses.license_number — the same kind of
-- issued credential, self-described as sensitive — is not.
--
-- ── Why two of these need a new column ───────────────────────────────────
-- secretbox output is base64 TEXT. users.dob and
-- provider_employees.date_of_birth are DATE. A DATE column cannot hold
-- ciphertext, and rewriting a deployed column's type in place would rewrite
-- the table under an ACCESS EXCLUSIVE lock and give the backfill nowhere to
-- stand mid-flight. So each gets a sibling TEXT column, the Go tool encrypts
-- into it and NULLs the DATE in the same transaction, and the read paths
-- prefer the encrypted column with a fallback to the DATE for rows the
-- backfill has not reached.
--
-- provider_licenses.license_number is already TEXT and is encrypted IN PLACE.
-- It is NOT NULL, which rules out the usual NULL sentinel — but nothing here
-- uses one: detection is per VALUE (098), so "is this row done" is answered by
-- asking whether the value opens under the key, not by a flag or a NULL.
--
-- ── Data minimisation, applied where it is free ──────────────────────────
-- users.dob has NO production read path at all. It is written by
-- gateway/internal/handler/compliance.go SetDOB, which computes
-- meetsMinimumAge() in memory and persists the answer as dob_verified_at; the
-- only SELECT of the users DOB pair anywhere is GetAgeStatus reading
-- dob_verified_at alone (compliance.go:343), and a seeder regression test.
-- The date itself is retained solely as evidence behind an age assertion, so
-- it is retained encrypted and the plaintext DATE is cleared. GetAgeStatus is
-- unaffected because it never read it.
--
-- provider_employees.date_of_birth IS read — it round-trips to the owning
-- provider's team page — so it keeps a read path, through the cipher.
--
-- ── A GDPR erasure gap found while tracing, fixed in Go ──────────────────
-- services/user/internal/repository/gdpr.go FinalizeDeletion nulls phone,
-- password_hash, avatar_url, mfa_secret and mfa_backup_codes on `users`, but
-- neither dob nor dob_verified_at. A full date of birth currently SURVIVES a
-- right-to-erasure request. The fix ships with this migration in gdpr.go; the
-- new dob_encrypted column is added to the same erasure statement so the
-- encrypted copy cannot outlive the plaintext it replaced.
--
-- This migration mutates no row and no PII value. Schema and comments only.

SET lock_timeout = '5s';

-- ── 1. users.dob ─────────────────────────────────────────────────────────

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS dob_encrypted TEXT;

COMMENT ON COLUMN users.dob_encrypted IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305 of the date of birth as "YYYY-MM-DD". Written by gateway/internal/handler/compliance.go SetDOB, which also writes dob = NULL — the plaintext DATE is not retained because nothing reads it. Backfilled by database/cmd/encrypt-pii. Cleared by GDPR erasure alongside dob/dob_verified_at. Detection is per VALUE; users.pii_encrypted_v1 is advisory only (migration 098) and must not be branched on.';

COMMENT ON COLUMN users.dob IS
    'LEGACY PLAINTEXT, being drained. Migration 043 added this DATE with no encryption review. As of migration 106 the runtime write path stores the date in dob_encrypted and writes NULL here, and database/cmd/encrypt-pii does the same for existing rows. A non-NULL value means the backfill has not reached this row — see pii_plaintext_audit (migration 107). No production query SELECTs this column; the derived fact the platform actually uses is dob_verified_at.';

COMMENT ON COLUMN users.dob_verified_at IS
    'NOT encrypted, deliberately: a timestamp asserting that an age check passed. It is a derived fact, not an identifier, and it is the only half of the DOB pair any production read path consumes (gateway/internal/handler/compliance.go GetAgeStatus).';

-- ── 2. provider_employees.date_of_birth ──────────────────────────────────

ALTER TABLE provider_employees
    ADD COLUMN IF NOT EXISTS date_of_birth_encrypted TEXT;

COMMENT ON COLUMN provider_employees.date_of_birth_encrypted IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305 of the date of birth as "YYYY-MM-DD". Written by gateway/internal/handler/employees.go Create/Update, which also write date_of_birth = NULL; read by scanEmployee, which falls back to the DATE column for rows the backfill has not reached. Backfilled by database/cmd/encrypt-pii. Detection is per VALUE — provider_employees.pii_encrypted_v1 is advisory (migration 098) and scanEmployee no longer branches on it.';

COMMENT ON COLUMN provider_employees.date_of_birth IS
    'LEGACY PLAINTEXT, being drained into date_of_birth_encrypted. Migration 026 added it; migration 033 encrypted four SIBLING columns on this same table (email, phone, license_number, insurance_policy_number) and left this one, which is a stronger identifier than most of them. A non-NULL value means the backfill has not reached this row.';

-- ── 3. provider_licenses.license_number ──────────────────────────────────
-- Encrypted in place; no new column, no flag.

COMMENT ON COLUMN provider_licenses.license_number IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305. Corrects migration 062, whose inline comment called this column "sensitive" while storing it in clear — the identically-named provider_employees.license_number has been encrypted since migration 033. Encrypted on write by gateway/internal/handler/provider_license.go SubmitLicense; decrypted on read by scanLicenseRows, which then applies maskLicenseNumber to the PLAINTEXT (masking ciphertext would publish the last four base64 characters of a nonce and mask nothing). NOT NULL, so there is no NULL sentinel and none is needed: detection is per VALUE (migration 098). This table has no pii_encrypted_v1 column and must not gain one.';

COMMENT ON COLUMN provider_licenses.jurisdiction IS
    'NOT encrypted, deliberately: a state/bar jurisdiction code. It is published on the verified-licence badge and is not personally identifying on its own.';

COMMENT ON TABLE provider_licenses IS
    'Professional licence submissions. license_number is encrypted at rest as of migration 106; the public read path (ListProviderVerifiedLicenses) additionally masks it to the last four characters AFTER decryption and serves only status=verified rows.';
