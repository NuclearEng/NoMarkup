-- Down for 106.
--
-- The up migration added two nullable TEXT columns and rewrote comments. It
-- read, copied and wrote no PII, so this is a pure schema-object rollback.
--
-- WARNING, two of them:
--
--   * Dropping dob_encrypted / date_of_birth_encrypted DISCARDS the dates for
--     every row the backfill has already processed, because that backfill
--     NULLs the plaintext DATE in the same transaction that writes the
--     ciphertext. Unlike 104/105 this is not a loss of precision — it is the
--     whole value. Restore a pre-106 dump if the dates are needed.
--
--   * provider_licenses.license_number is NOT decrypted here; that needs
--     ENCRYPTION_KEY and a Go tool (031's down migration carries the same
--     note). After this rollback the column still holds ciphertext, and a
--     pre-106 binary will mask and display the last four characters of
--     base64. Roll the code back with the schema.

SET lock_timeout = '5s';

ALTER TABLE users              DROP COLUMN IF EXISTS dob_encrypted;
ALTER TABLE provider_employees DROP COLUMN IF EXISTS date_of_birth_encrypted;

-- None of these carried a COMMENT before 106 (043, 026 and 062 documented
-- them with `--` SQL comments, which never reach pg_description), so NULL is
-- the exact prior state.
COMMENT ON COLUMN users.dob                             IS NULL;
COMMENT ON COLUMN users.dob_verified_at                 IS NULL;
COMMENT ON COLUMN provider_employees.date_of_birth      IS NULL;
COMMENT ON COLUMN provider_licenses.license_number      IS NULL;
COMMENT ON COLUMN provider_licenses.jurisdiction        IS NULL;
COMMENT ON TABLE  provider_licenses                     IS NULL;
