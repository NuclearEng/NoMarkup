-- Rollback for 040_listing_condition_retraction.

-- 1. listing_bids.retracted_at + status enum revert.
DROP INDEX IF EXISTS idx_listing_bids_retracted;
ALTER TABLE listing_bids DROP COLUMN IF EXISTS retracted_at;

ALTER TABLE listing_bids DROP CONSTRAINT IF EXISTS listing_bids_status_check;
ALTER TABLE listing_bids ADD CONSTRAINT listing_bids_status_check
  CHECK (status IN ('active','outbid','winning','awarded','withdrawn'));

-- 2. listings.condition.
DROP INDEX IF EXISTS idx_listings_condition;
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_condition_check;
ALTER TABLE listings DROP COLUMN IF EXISTS condition;
