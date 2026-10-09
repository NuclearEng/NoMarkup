-- Reverse migration 072 — drop the persisted underwriting decision columns.
ALTER TABLE provider_credit_limits
    DROP COLUMN IF EXISTS approved,
    DROP COLUMN IF EXISTS tier,
    DROP COLUMN IF EXISTS available_advance_cents,
    DROP COLUMN IF EXISTS fee_bps,
    DROP COLUMN IF EXISTS factor_rate,
    DROP COLUMN IF EXISTS holdback_pct,
    DROP COLUMN IF EXISTS binding_cap,
    DROP COLUMN IF EXISTS decision_hash,
    DROP COLUMN IF EXISTS model_version;
