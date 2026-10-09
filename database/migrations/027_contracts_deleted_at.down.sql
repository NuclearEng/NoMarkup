-- Reverse Bug 1 migration.
DROP INDEX IF EXISTS idx_contracts_provider_active;
DROP INDEX IF EXISTS idx_contracts_customer_active;
ALTER TABLE contracts DROP COLUMN IF EXISTS deleted_at;
