-- Reverse migration 044.

DROP TRIGGER IF EXISTS listing_offers_set_updated_at ON listing_offers;
DROP TABLE IF EXISTS listing_offers;

ALTER TABLE listing_watchlist DROP COLUMN IF EXISTS last_drop_alert_cents;
ALTER TABLE listing_watchlist DROP COLUMN IF EXISTS baseline_price_cents;
