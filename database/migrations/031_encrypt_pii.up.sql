-- 031: PII at-rest encryption flags.
--
-- CLAUDE.md §6 mandates encrypting PII at rest. The actual ciphertext lives
-- in the existing TEXT/TEXT[] columns (base64-encoded nonce||ciphertext from
-- nacl/secretbox); pure SQL cannot run libsodium, so the data conversion is
-- performed by `database/cmd/encrypt-pii/main.go`. This migration only adds
-- the per-row flags that make re-encryption idempotent and lets readers know
-- whether a row is still legacy plaintext.
--
-- Flagged columns (per Tier 2 audit):
--   users.phone                              — encrypted
--   users.mfa_secret                         — encrypted (TOTP seed)
--   users.mfa_backup_codes                   — argon2id-hashed (one-way)
--   provider_profiles.service_address        — encrypted
--   provider_profiles.ein_tin                — encrypted
--   provider_profiles.insurance_policy_number— encrypted
--
-- email (auth lookup) and bio (user-controlled, public-ish) intentionally stay
-- plaintext per CLAUDE.md §6 / Tier 2 audit.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS pii_encrypted_v1 BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE provider_profiles
    ADD COLUMN IF NOT EXISTS pii_encrypted_v1 BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_pii_encrypted_v1
    ON users (pii_encrypted_v1)
    WHERE pii_encrypted_v1 = FALSE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_provider_profiles_pii_encrypted_v1
    ON provider_profiles (pii_encrypted_v1)
    WHERE pii_encrypted_v1 = FALSE;

COMMENT ON COLUMN users.pii_encrypted_v1 IS
    'TRUE when phone/mfa_secret are nacl/secretbox ciphertext and mfa_backup_codes are argon2id hashes. Toggled by database/cmd/encrypt-pii.';
COMMENT ON COLUMN provider_profiles.pii_encrypted_v1 IS
    'TRUE when service_address/ein_tin/insurance_policy_number are nacl/secretbox ciphertext.';
