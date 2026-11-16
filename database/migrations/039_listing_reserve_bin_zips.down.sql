-- Rollback for 039_listing_reserve_bin_zips.

-- 1. zip_codes lookup table.
DROP INDEX IF EXISTS idx_zip_codes_location;
DROP TABLE IF EXISTS zip_codes;

-- 2. Reserve + buy-now constraints + columns on listings.
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_buy_now_above_reserve;
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_buy_now_positive;
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_reserve_positive;

ALTER TABLE listings DROP COLUMN IF EXISTS buy_now_price_cents;
ALTER TABLE listings DROP COLUMN IF EXISTS reserve_price_cents;
