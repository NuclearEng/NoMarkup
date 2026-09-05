-- Reverse Bug 3 migration.
DROP TRIGGER IF EXISTS bids_update_bid_count ON bids;
DROP FUNCTION IF EXISTS trigger_update_bid_count();
-- Note: we intentionally do not reset bid_count values — leaving them as-is
-- preserves the most recent maintained state. The original 001 schema
-- defaults the column to 0 but does not maintain it.
