-- Reverse migration 047 — drop promotion + seller-metrics + no-show
-- columns. Cascading drops handle dependent indexes/constraints.

DROP TABLE IF EXISTS promotion_charges;
DROP TABLE IF EXISTS seller_metrics_daily;

DROP INDEX IF EXISTS idx_listings_promoted;

ALTER TABLE listings        DROP COLUMN IF EXISTS promoted_until;
ALTER TABLE listings        DROP COLUMN IF EXISTS is_promoted;

ALTER TABLE users           DROP COLUMN IF EXISTS no_show_cooldown_until;
ALTER TABLE users           DROP COLUMN IF EXISTS no_show_count;

ALTER TABLE listing_orders  DROP COLUMN IF EXISTS seller_confirmed_at;
ALTER TABLE listing_orders  DROP COLUMN IF EXISTS selfie_url;
ALTER TABLE listing_orders  DROP COLUMN IF EXISTS handoff_photo_url;
ALTER TABLE listing_orders  DROP COLUMN IF EXISTS pickup_window_end;
ALTER TABLE listing_orders  DROP COLUMN IF EXISTS pickup_window_start;
ALTER TABLE listing_orders  DROP COLUMN IF EXISTS pickup_code_hash;
