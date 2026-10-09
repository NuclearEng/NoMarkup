-- 049_lead_gen_fee.down.sql
ALTER TABLE platform_fee_config
  DROP CONSTRAINT IF EXISTS chk_lead_gen_max_fee_order,
  DROP CONSTRAINT IF EXISTS chk_lead_gen_min_fee_nonneg,
  DROP CONSTRAINT IF EXISTS chk_lead_gen_percentage_range;

ALTER TABLE platform_fee_config
  DROP COLUMN IF EXISTS lead_gen_max_fee_cents,
  DROP COLUMN IF EXISTS lead_gen_min_fee_cents,
  DROP COLUMN IF EXISTS lead_gen_percentage,
  DROP COLUMN IF EXISTS lead_gen_enabled;
