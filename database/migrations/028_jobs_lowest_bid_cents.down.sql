-- Reverse Bug 2 migration.
DROP INDEX IF EXISTS idx_jobs_lowest_bid_cents;
DROP TRIGGER IF EXISTS bids_update_lowest_bid_cents ON bids;
DROP FUNCTION IF EXISTS trigger_update_lowest_bid_cents();
ALTER TABLE jobs DROP COLUMN IF EXISTS lowest_bid_cents;
