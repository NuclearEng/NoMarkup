-- Roll back the goods marketplace schema. Drops triggers, functions, then tables.

DROP TRIGGER IF EXISTS listing_orders_set_updated_at ON listing_orders;
DROP TRIGGER IF EXISTS listings_set_updated_at ON listings;
DROP TRIGGER IF EXISTS listing_bids_update_counters ON listing_bids;

DROP FUNCTION IF EXISTS trigger_update_listing_counters();
DROP FUNCTION IF EXISTS trigger_listings_set_updated_at();

DROP TABLE IF EXISTS listing_orders;
DROP TABLE IF EXISTS listing_photos;
DROP TABLE IF EXISTS listing_bids;
DROP TABLE IF EXISTS listings;
