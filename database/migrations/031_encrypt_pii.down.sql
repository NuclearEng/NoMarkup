-- Down: drop the flags. Note this does NOT decrypt the data — that requires
-- access to ENCRYPTION_KEY and would have to run via a Go tool similar to
-- encrypt-pii but in reverse. In practice rolling back this migration on a
-- DB that already has encrypted rows means those rows stay ciphertext until
-- the operator runs a manual decrypt step.

DROP INDEX IF EXISTS idx_users_pii_encrypted_v1;
DROP INDEX IF EXISTS idx_provider_profiles_pii_encrypted_v1;

ALTER TABLE users DROP COLUMN IF EXISTS pii_encrypted_v1;
ALTER TABLE provider_profiles DROP COLUMN IF EXISTS pii_encrypted_v1;
