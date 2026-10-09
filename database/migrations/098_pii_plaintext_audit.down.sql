-- Down for 098. Drops the audit view and the discriminator function and
-- restores the column comments 031 left in place.
--
-- No PII value was ever read, copied or written by the up migration, so there
-- is nothing to restore and nothing to lose: this is a pure schema-object
-- rollback. The view must go before the function it depends on.

SET lock_timeout = '5s';

DROP VIEW IF EXISTS pii_plaintext_audit;
DROP FUNCTION IF EXISTS pii_looks_like_secretbox(TEXT);

-- Restore 031's wording verbatim.
COMMENT ON COLUMN provider_profiles.pii_encrypted_v1 IS
    'TRUE when service_address/ein_tin/insurance_policy_number are nacl/secretbox ciphertext.';
COMMENT ON COLUMN users.pii_encrypted_v1 IS
    'TRUE when phone/mfa_secret are nacl/secretbox ciphertext and mfa_backup_codes are argon2id hashes. Toggled by database/cmd/encrypt-pii.';

-- These four had no COMMENT before 098; clear them.
COMMENT ON COLUMN provider_profiles.ein_tin IS NULL;
COMMENT ON COLUMN provider_profiles.insurance_policy_number IS NULL;
COMMENT ON COLUMN provider_profiles.service_address IS NULL;
COMMENT ON COLUMN provider_profiles.insurance_provider IS NULL;
