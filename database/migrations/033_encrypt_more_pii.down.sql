-- 033 down: drop the pii_encrypted_v1 flags and partial indexes added by 033.
-- WARNING: dropping the flag does not decrypt existing ciphertext. After running
-- this down migration, re-add the column + run encrypt-pii (no-op for rows
-- that are already ciphertext, since maybeEncrypt() in the tool re-encrypts —
-- prefer leaving the flag in place and only rolling back if you've also
-- restored a pre-033 dump).

DROP INDEX IF EXISTS idx_provider_employees_pii_encrypted_v1;
DROP INDEX IF EXISTS idx_properties_pii_encrypted_v1;

ALTER TABLE provider_employees DROP COLUMN IF EXISTS pii_encrypted_v1;
ALTER TABLE properties DROP COLUMN IF EXISTS pii_encrypted_v1;
