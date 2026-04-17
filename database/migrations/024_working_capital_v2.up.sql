-- Working Capital V2: credit limits, repayments, and disbursement tracking.

CREATE TABLE provider_credit_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL UNIQUE REFERENCES users(id),
    max_advance_cents BIGINT NOT NULL DEFAULT 0,
    total_outstanding_cents BIGINT NOT NULL DEFAULT 0,
    risk_score NUMERIC(5,2) NOT NULL DEFAULT 0.00,
    last_computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    jobs_completed INTEGER NOT NULL DEFAULT 0,
    total_earnings_cents BIGINT NOT NULL DEFAULT 0,
    avg_job_value_cents BIGINT NOT NULL DEFAULT 0,
    on_time_rate NUMERIC(5,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at_provider_credit_limits BEFORE UPDATE ON provider_credit_limits FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE advance_repayments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advance_id UUID NOT NULL REFERENCES working_capital_advances(id),
    payment_id UUID NOT NULL REFERENCES payments(id),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_advance_repayments_advance ON advance_repayments(advance_id);

ALTER TABLE working_capital_advances ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT;
