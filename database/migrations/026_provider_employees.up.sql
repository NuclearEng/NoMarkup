-- Company employees that providers manage from the team page.
CREATE TABLE provider_employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    date_of_birth DATE,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    hire_date DATE,
    background_check_status TEXT NOT NULL DEFAULT 'not_started',
    background_check_date DATE,
    license_number TEXT,
    license_state TEXT,
    license_expiry DATE,
    insurance_policy_number TEXT,
    insurance_expiry DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_provider_employees_provider_id ON provider_employees(provider_id);
CREATE TRIGGER set_updated_at_provider_employees BEFORE UPDATE ON provider_employees FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
