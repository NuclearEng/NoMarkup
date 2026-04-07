ALTER TABLE working_capital_advances DROP COLUMN IF EXISTS stripe_transfer_id;

DROP INDEX IF EXISTS idx_advance_repayments_advance;
DROP TABLE IF EXISTS advance_repayments;

DROP TRIGGER IF EXISTS set_updated_at_provider_credit_limits ON provider_credit_limits;
DROP TABLE IF EXISTS provider_credit_limits;
