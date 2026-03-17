DROP TRIGGER IF EXISTS set_auction_bid_events_updated_at ON auction_bid_events;
ALTER TABLE auction_bid_events DROP COLUMN IF EXISTS updated_at;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS chk_snipe_extension_max;
