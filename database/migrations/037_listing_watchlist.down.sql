-- Reverse migration 037.

DROP INDEX IF EXISTS idx_saved_searches_alert;
DROP INDEX IF EXISTS idx_saved_searches_user;
DROP TABLE IF EXISTS saved_searches;

DROP INDEX IF EXISTS idx_listing_watchlist_listing;
DROP INDEX IF EXISTS idx_listing_watchlist_user;
DROP TABLE IF EXISTS listing_watchlist;
