-- Reverse Live Auction Arena migration

DROP INDEX IF EXISTS idx_provider_streaks_rank;
DROP TABLE IF EXISTS provider_streaks;

DROP INDEX IF EXISTS idx_user_savings_user;
DROP TABLE IF EXISTS user_savings;

DROP INDEX IF EXISTS idx_auction_bid_events_job;
DROP TABLE IF EXISTS auction_bid_events;

ALTER TABLE jobs DROP COLUMN IF EXISTS original_auction_ends_at;
ALTER TABLE jobs DROP COLUMN IF EXISTS snipe_extension_count;
ALTER TABLE jobs DROP COLUMN IF EXISTS auction_type;
