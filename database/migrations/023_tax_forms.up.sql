-- Tax forms for 1099-NEC generation
CREATE TABLE tax_forms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES users(id),
    tax_year INTEGER NOT NULL,
    form_type TEXT NOT NULL DEFAULT '1099-nec' CHECK (form_type IN ('1099-nec', '1099-k')),
    provider_legal_name TEXT NOT NULL,
    provider_tax_id_last4 TEXT,
    provider_address TEXT NOT NULL,
    total_compensation_cents BIGINT NOT NULL,
    federal_tax_withheld_cents BIGINT NOT NULL DEFAULT 0,
    state_tax_withheld_cents BIGINT NOT NULL DEFAULT 0,
    platform_ein TEXT NOT NULL DEFAULT '88-1234567',
    platform_name TEXT NOT NULL DEFAULT 'NoMarkup Inc.',
    pdf_url TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'delivered', 'corrected', 'filed')),
    delivered_at TIMESTAMPTZ,
    filed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider_id, tax_year, form_type)
);

CREATE TRIGGER set_updated_at_tax_forms
    BEFORE UPDATE ON tax_forms
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_tax_forms_provider ON tax_forms(provider_id, tax_year);
