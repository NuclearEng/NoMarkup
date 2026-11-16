-- Admin-defined named fees applied on top of platform_fee_config.fee_percentage.
-- Rates are integer basis points (500 = 5%); never store a float here.
-- Soft-delete via deleted_at; active=false keeps the row visible in admin but
-- excluded from live CalculateFees.

CREATE TABLE platform_custom_fees (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    rate_bps   INT NOT NULL,
    active     BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT platform_custom_fees_name_check
        CHECK (char_length(btrim(name)) > 0 AND char_length(name) <= 100),
    CONSTRAINT platform_custom_fees_rate_bps_check
        CHECK (rate_bps >= 0 AND rate_bps <= 10000)
);

CREATE INDEX idx_platform_custom_fees_active
    ON platform_custom_fees (created_at)
    WHERE deleted_at IS NULL AND active = true;

CREATE INDEX idx_platform_custom_fees_list
    ON platform_custom_fees (created_at)
    WHERE deleted_at IS NULL;

CREATE TRIGGER set_platform_custom_fees_updated_at
    BEFORE UPDATE ON platform_custom_fees
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE platform_custom_fees IS
    'Admin-named additive platform fees. rate_bps is integer basis points (500 = 5%). Active, non-deleted rows are summed into CalculateFees platform_fee_cents.';
COMMENT ON COLUMN platform_custom_fees.rate_bps IS
    'Integer basis points; 10000 = 100%. Combined with platform_fee_config.fee_percentage the live take is capped at 5000 bps (50%) fail-closed.';
