-- Add safety-net constraint on snipe extensions (max 3)
ALTER TABLE jobs ADD CONSTRAINT chk_snipe_extension_max CHECK (snipe_extension_count <= 3);

-- Add updated_at to auction_bid_events for schema consistency
ALTER TABLE auction_bid_events ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE TRIGGER set_auction_bid_events_updated_at
  BEFORE UPDATE ON auction_bid_events
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
