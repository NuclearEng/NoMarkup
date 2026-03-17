-- Reverse company employees migration

DROP TRIGGER IF EXISTS set_company_employees_updated_at ON company_employees;
DROP INDEX IF EXISTS idx_company_employees_provider;
DROP TABLE IF EXISTS company_employees;

ALTER TABLE provider_profiles DROP COLUMN IF EXISTS ein_tin;
ALTER TABLE provider_profiles DROP COLUMN IF EXISTS insurance_provider;
ALTER TABLE provider_profiles DROP COLUMN IF EXISTS insurance_policy_number;
ALTER TABLE provider_profiles DROP COLUMN IF EXISTS insurance_expiry;
ALTER TABLE provider_profiles DROP COLUMN IF EXISTS insurance_coverage_cents;
