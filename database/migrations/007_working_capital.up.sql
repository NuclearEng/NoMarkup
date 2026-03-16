CREATE TABLE working_capital_advances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES users(id),
    contract_id UUID NOT NULL REFERENCES contracts(id),
    advance_amount_cents BIGINT NOT NULL CHECK (advance_amount_cents > 0),
    fee_cents BIGINT NOT NULL DEFAULT 0,
    repaid_cents BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','disbursed','repaying','repaid','defaulted','rejected')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    disbursed_at TIMESTAMPTZ,
    repaid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wca_provider ON working_capital_advances(provider_id, status);
CREATE INDEX idx_wca_contract ON working_capital_advances(contract_id);
