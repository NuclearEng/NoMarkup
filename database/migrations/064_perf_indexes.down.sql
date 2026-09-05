-- 064 down: drop the performance indexes added in the up migration.
DROP INDEX IF EXISTS idx_contracts_bid;
DROP INDEX IF EXISTS idx_payments_recurring_instance;
DROP INDEX IF EXISTS idx_subscriptions_tier;
DROP INDEX IF EXISTS idx_listings_current_bidder;
DROP INDEX IF EXISTS idx_jobs_subcategory;
DROP INDEX IF EXISTS idx_jobs_service_type;
DROP INDEX IF EXISTS idx_provider_profiles_location_geog;
DROP INDEX IF EXISTS idx_listings_location_geog;
DROP INDEX IF EXISTS idx_jobs_location_geog;
