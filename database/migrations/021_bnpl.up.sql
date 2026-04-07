-- BNPL: Installment plans and scheduled installments for Buy Now Pay Later

CREATE TABLE installment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES contracts(id),
    customer_id UUID NOT NULL REFERENCES users(id),
    provider_id UUID NOT NULL REFERENCES users(id),
    total_amount_cents BIGINT NOT NULL CHECK (total_amount_cents > 0),
    bnpl_fee_cents BIGINT NOT NULL DEFAULT 0,
    total_with_fee_cents BIGINT NOT NULL CHECK (total_with_fee_cents > 0),
    installment_count INTEGER NOT NULL CHECK (installment_count IN (3, 6)),
    per_installment_cents BIGINT NOT NULL CHECK (per_installment_cents > 0),
    fee_rate NUMERIC(5,4) NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','defaulted','cancelled')),
    provider_paid_at TIMESTAMPTZ,
    stripe_provider_transfer_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_installment_plans
    BEFORE UPDATE ON installment_plans
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_installment_plans_contract ON installment_plans(contract_id);
CREATE INDEX idx_installment_plans_customer ON installment_plans(customer_id, status);

CREATE TABLE scheduled_installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES installment_plans(id),
    installment_number INTEGER NOT NULL CHECK (installment_number > 0),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    due_date DATE NOT NULL,
    payment_id UUID REFERENCES payments(id),
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','processing','paid','failed','retrying')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_scheduled_installments
    BEFORE UPDATE ON scheduled_installments
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_scheduled_installments_plan ON scheduled_installments(plan_id);
CREATE INDEX idx_scheduled_installments_due ON scheduled_installments(due_date, status)
    WHERE status IN ('scheduled','retrying');
