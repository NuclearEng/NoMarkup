-- 049_lead_gen_fee.up.sql
-- Adds a separate, additive "qualified lead" fee to the platform fee config.
-- This is charged to the WINNING provider on a won contract, on top of the
-- marketplace take rate. It captures the lead-generation budget providers
-- already spend externally. Disabled by default so existing pricing is unchanged.

ALTER TABLE platform_fee_config
  ADD COLUMN lead_gen_enabled        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN lead_gen_percentage     NUMERIC(5,4) NOT NULL DEFAULT 0.0000,  -- e.g., 0.1000 = 10%
  ADD COLUMN lead_gen_min_fee_cents  BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN lead_gen_max_fee_cents  BIGINT;  -- NULL = no cap

-- Guard rails: percentage must be a sane fraction, caps non-negative and ordered.
ALTER TABLE platform_fee_config
  ADD CONSTRAINT chk_lead_gen_percentage_range
    CHECK (lead_gen_percentage >= 0 AND lead_gen_percentage <= 1),
  ADD CONSTRAINT chk_lead_gen_min_fee_nonneg
    CHECK (lead_gen_min_fee_cents >= 0),
  ADD CONSTRAINT chk_lead_gen_max_fee_order
    CHECK (lead_gen_max_fee_cents IS NULL OR lead_gen_max_fee_cents >= lead_gen_min_fee_cents);
