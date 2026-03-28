CREATE TABLE provider_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES users(id),
    category TEXT NOT NULL CHECK (category IN ('materials','tools','transportation','insurance','licensing','marketing','subcontractor','office','other')),
    description TEXT NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    receipt_url TEXT,
    expense_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_provider ON provider_expenses(provider_id, expense_date DESC);

CREATE TRIGGER set_provider_expenses_updated_at
  BEFORE UPDATE ON provider_expenses
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
