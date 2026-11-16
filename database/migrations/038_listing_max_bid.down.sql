-- 038_listing_max_bid.down.sql
DROP INDEX IF EXISTS idx_listing_bids_active_max;
ALTER TABLE listing_bids DROP COLUMN IF EXISTS max_bid_cents;
