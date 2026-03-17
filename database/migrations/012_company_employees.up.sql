-- Company employees under a provider account
CREATE TABLE company_employees (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id             UUID NOT NULL REFERENCES users(id),
  first_name              TEXT NOT NULL,
  last_name               TEXT NOT NULL,
  email                   TEXT,
  phone                   TEXT,
  date_of_birth           DATE,
  ssn_last_four           TEXT, -- encrypted, last 4 digits only
  role                    TEXT NOT NULL DEFAULT 'technician' CHECK (role IN ('technician', 'lead', 'manager', 'apprentice')),
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'terminated')),
  hire_date               DATE,
  -- Verification
  id_document_url         TEXT, -- uploaded gov ID
  background_check_status TEXT NOT NULL DEFAULT 'not_started' CHECK (background_check_status IN ('not_started', 'pending', 'passed', 'failed')),
  background_check_date   TIMESTAMPTZ,
  -- Certifications
  license_number          TEXT,
  license_state           TEXT,
  license_expiry          DATE,
  insurance_policy_number TEXT,
  insurance_expiry        DATE,
  -- Standard timestamps
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_employees_provider ON company_employees (provider_id, status);

CREATE TRIGGER set_company_employees_updated_at
  BEFORE UPDATE ON company_employees
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Provider business identity (EIN/TIN, insurance details)
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS ein_tin TEXT;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS insurance_provider TEXT;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS insurance_policy_number TEXT;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS insurance_expiry DATE;
ALTER TABLE provider_profiles ADD COLUMN IF NOT EXISTS insurance_coverage_cents BIGINT;
