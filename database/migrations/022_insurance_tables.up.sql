-- Insurance products catalog
CREATE TABLE insurance_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    coverage_type TEXT NOT NULL CHECK (coverage_type IN ('property_damage', 'workmanship_warranty', 'completion_guarantee', 'liability')),
    base_rate_bps INT NOT NULL,
    min_premium_cents BIGINT NOT NULL DEFAULT 500,
    max_coverage_cents BIGINT,
    coverage_duration_days INT NOT NULL DEFAULT 90,
    deductible_cents BIGINT NOT NULL DEFAULT 0,
    terms_markdown TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_insurance_products_slug ON insurance_products (slug);
CREATE INDEX idx_insurance_products_active ON insurance_products (active);
CREATE INDEX idx_insurance_products_coverage_type ON insurance_products (coverage_type);

-- Policy number sequence
CREATE SEQUENCE insurance_policy_number_seq START 1000;

-- Insurance policies (per-contract)
CREATE TABLE insurance_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_number TEXT NOT NULL UNIQUE,
    product_id UUID NOT NULL REFERENCES insurance_products (id),
    contract_id UUID NOT NULL,
    customer_id UUID NOT NULL,
    provider_id UUID NOT NULL,
    coverage_amount_cents BIGINT NOT NULL,
    premium_cents BIGINT NOT NULL,
    deductible_cents BIGINT NOT NULL DEFAULT 0,
    stripe_payment_intent_id TEXT,
    effective_date DATE NOT NULL,
    expiration_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'active', 'expired', 'claimed', 'cancelled', 'void')),
    paid_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_insurance_policies_policy_number ON insurance_policies (policy_number);
CREATE INDEX idx_insurance_policies_product_id ON insurance_policies (product_id);
CREATE INDEX idx_insurance_policies_contract_id ON insurance_policies (contract_id);
CREATE INDEX idx_insurance_policies_customer_id ON insurance_policies (customer_id);
CREATE INDEX idx_insurance_policies_provider_id ON insurance_policies (provider_id);
CREATE INDEX idx_insurance_policies_status ON insurance_policies (status);
CREATE INDEX idx_insurance_policies_effective_date ON insurance_policies (effective_date);
CREATE INDEX idx_insurance_policies_expiration_date ON insurance_policies (expiration_date);

-- Claim number sequence
CREATE SEQUENCE insurance_claim_number_seq START 1000;

-- Insurance claims
CREATE TABLE insurance_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    claim_number TEXT NOT NULL UNIQUE,
    policy_id UUID NOT NULL REFERENCES insurance_policies (id),
    claimant_id UUID NOT NULL,
    claim_type TEXT NOT NULL CHECK (claim_type IN ('property_damage', 'workmanship_defect', 'incomplete_work', 'liability_incident')),
    description TEXT NOT NULL DEFAULT '',
    evidence_urls TEXT[] NOT NULL DEFAULT '{}',
    claimed_amount_cents BIGINT NOT NULL,
    assessed_amount_cents BIGINT,
    assessor_notes TEXT,
    approved_amount_cents BIGINT,
    payout_cents BIGINT,
    stripe_transfer_id TEXT,
    status TEXT NOT NULL DEFAULT 'filed' CHECK (status IN ('filed', 'under_review', 'approved', 'denied', 'paid_out', 'appealed', 'closed')),
    denial_reason TEXT,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_insurance_claims_claim_number ON insurance_claims (claim_number);
CREATE INDEX idx_insurance_claims_policy_id ON insurance_claims (policy_id);
CREATE INDEX idx_insurance_claims_claimant_id ON insurance_claims (claimant_id);
CREATE INDEX idx_insurance_claims_status ON insurance_claims (status);
CREATE INDEX idx_insurance_claims_claim_type ON insurance_claims (claim_type);
CREATE INDEX idx_insurance_claims_reviewed_by ON insurance_claims (reviewed_by);

-- Seed default insurance products
INSERT INTO insurance_products (name, slug, description, coverage_type, base_rate_bps, min_premium_cents, coverage_duration_days, deductible_cents, terms_markdown) VALUES
('Property Damage Protection', 'property-damage', 'Covers accidental property damage during service work', 'property_damage', 150, 1000, 90, 5000, '## Property Damage Protection\n\nCovers accidental damage to your property caused during the performance of contracted service work.\n\n### What is Covered\n- Accidental damage to structures, fixtures, or personal property\n- Damage caused by tools or equipment\n- Water damage from plumbing work\n\n### What is Not Covered\n- Pre-existing damage\n- Normal wear and tear\n- Damage caused by the homeowner\n- Acts of nature during service'),
('Extended Workmanship Warranty', 'workmanship-warranty', 'Extended warranty on completed work quality', 'workmanship_warranty', 200, 1500, 365, 2500, '## Workmanship Warranty\n\nExtends warranty coverage on the quality of completed work beyond the standard guarantee period.\n\n### What is Covered\n- Defects in workmanship discovered after completion\n- Materials that fail due to improper installation\n- Work that does not meet industry standards\n\n### What is Not Covered\n- Normal wear and tear\n- Damage from misuse or neglect\n- Changes made by third parties'),
('Completion Guarantee Plus', 'completion-guarantee', 'Guarantees project completion even if provider defaults', 'completion_guarantee', 100, 500, 180, 0, '## Completion Guarantee Plus\n\nGuarantees your project will be completed even if the original provider is unable to finish.\n\n### What is Covered\n- Provider abandonment or default\n- Cost of hiring a replacement provider\n- Additional materials needed to complete work\n\n### What is Not Covered\n- Scope changes requested by the customer\n- Delays due to weather or permits\n- Work the customer cancelled'),
('General Liability Shield', 'liability-shield', 'Covers third-party injury or damage claims', 'liability', 250, 2000, 90, 10000, '## Liability Shield\n\nCovers third-party injury or property damage claims arising from the contracted service work.\n\n### What is Covered\n- Third-party bodily injury on the job site\n- Third-party property damage\n- Legal defense costs\n\n### What is Not Covered\n- Intentional acts\n- Professional liability (errors in design)\n- Pollution or environmental damage\n- Workers compensation claims');

-- Updated_at triggers
CREATE OR REPLACE FUNCTION update_insurance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_insurance_products_updated_at
    BEFORE UPDATE ON insurance_products
    FOR EACH ROW EXECUTE FUNCTION update_insurance_updated_at();

CREATE TRIGGER trg_insurance_policies_updated_at
    BEFORE UPDATE ON insurance_policies
    FOR EACH ROW EXECUTE FUNCTION update_insurance_updated_at();

CREATE TRIGGER trg_insurance_claims_updated_at
    BEFORE UPDATE ON insurance_claims
    FOR EACH ROW EXECUTE FUNCTION update_insurance_updated_at();
