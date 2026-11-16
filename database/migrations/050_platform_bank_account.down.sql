-- 050_platform_bank_account.down.sql
DROP TRIGGER IF EXISTS set_updated_at_platform_bank_account ON platform_bank_account;
DROP INDEX IF EXISTS idx_platform_bank_account_stripe_id;
DROP INDEX IF EXISTS idx_platform_bank_account_one_default;
DROP TABLE IF EXISTS platform_bank_account;
