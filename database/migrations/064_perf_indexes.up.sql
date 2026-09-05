-- 064: Performance indexes — close geo-index mismatch + unindexed FKs.
--
-- Geo (the headline fix): jobs.approximate_location / listings.location /
-- provider_profiles.service_location are geometry(Point,4326) with GiST indexes
-- on the GEOMETRY type. But every hot ST_DWithin radius search casts the column
-- to ::geography (for true metric distance), and a geometry GiST index cannot
-- serve a geography operator — so the index is ignored and the planner scans the
-- whole active set and filters in memory on every marketplace browse / provider
-- match (verified via EXPLAIN: Rows Removed by Filter on idx_listings_status).
-- These functional GiST indexes on the geography cast make the radius search
-- index-served, on the §14 McMaster-fast browse + §8 search budget paths.
-- The partial predicates mirror the actual query WHERE clauses.
CREATE INDEX IF NOT EXISTS idx_jobs_location_geog
    ON jobs USING gist ((approximate_location::geography))
    WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_listings_location_geog
    ON listings USING gist ((location::geography))
    WHERE status = 'active' AND is_hidden = false;

CREATE INDEX IF NOT EXISTS idx_provider_profiles_location_geog
    ON provider_profiles USING gist ((service_location::geography))
    WHERE service_location IS NOT NULL;

-- Job category-filter columns hit by the browse/search OR-clause (unindexed FKs).
CREATE INDEX IF NOT EXISTS idx_jobs_service_type
    ON jobs (service_type_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_subcategory
    ON jobs (subcategory_id) WHERE deleted_at IS NULL;

-- Warm unindexed FKs on money/auction-adjacent paths (§5: index every FK).
CREATE INDEX IF NOT EXISTS idx_listings_current_bidder
    ON listings (current_bidder_id) WHERE current_bidder_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_tier
    ON subscriptions (tier_id);

CREATE INDEX IF NOT EXISTS idx_payments_recurring_instance
    ON payments (recurring_instance_id) WHERE recurring_instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_bid
    ON contracts (bid_id);
