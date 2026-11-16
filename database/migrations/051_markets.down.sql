-- Rollback for 051_markets.
DROP TRIGGER IF EXISTS set_updated_at_markets ON markets;
DROP INDEX IF EXISTS idx_markets_location;
DROP INDEX IF EXISTS idx_markets_active;
DROP INDEX IF EXISTS idx_markets_country_region;
DROP TABLE IF EXISTS markets;
