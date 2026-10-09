-- Remove the passkeys feature flag seeded by the up migration, then drop the
-- credential store. Trigger and indexes drop with the table.
DELETE FROM feature_flags WHERE key = 'passkeys';

DROP TABLE IF EXISTS passkey_credentials;
