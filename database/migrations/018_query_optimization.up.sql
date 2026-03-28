-- Recommended postgresql.conf tuning for NoMarkup (add to docker-compose postgres command):
-- shared_buffers = 256MB (25% of container RAM)
-- effective_cache_size = 768MB (75% of container RAM)
-- work_mem = 8MB
-- maintenance_work_mem = 128MB
-- random_page_cost = 1.1 (for SSD)
-- effective_io_concurrency = 200 (for SSD)
-- max_connections = 200

-- =============================================================================
-- 019_query_optimization: Add missing indexes for common query patterns
-- =============================================================================

-- Spectator mode: "most active auctions" query — supports ORDER BY created_at DESC
-- across all jobs (not filtered to a single job_id). The existing
-- idx_auction_bid_events_job covers (job_id, created_at) but not a global sort.
CREATE INDEX IF NOT EXISTS idx_auction_bid_events_created_at
    ON auction_bid_events (created_at DESC);

-- Fair Price Index refresh: speed up materialized view refresh.
-- The view joins contracts WHERE status = 'completed' — this partial index
-- narrows the scan to only completed contracts.
CREATE INDEX IF NOT EXISTS idx_contracts_completed
    ON contracts (status, bid_id)
    WHERE status = 'completed';

-- Accepted bids by job — used by Fair Price Index view (joins bids via bid_id
-- from completed contracts) and by award queries filtering on accepted status.
-- Existing idx_bids_job_amount covers status = 'active'; this covers 'awarded'.
CREATE INDEX IF NOT EXISTS idx_bids_awarded_amount
    ON bids (job_id, amount_cents)
    WHERE status = 'awarded';

-- Job search: composite index for category + status + date ordering.
-- Existing idx_jobs_category covers (category_id, status) but does not include
-- created_at for ORDER BY, causing an extra sort step.
CREATE INDEX IF NOT EXISTS idx_jobs_category_status_created
    ON jobs (category_id, status, created_at DESC)
    WHERE deleted_at IS NULL;

-- Job search: ZIP + category filter for "open jobs near me" queries.
CREATE INDEX IF NOT EXISTS idx_jobs_zip_category
    ON jobs (service_zip, category_id)
    WHERE deleted_at IS NULL AND status = 'active';

-- Chat message pagination: supports keyset pagination on (channel_id, created_at DESC).
-- Existing idx_chat_messages_channel uses ascending order; DESC is needed for
-- "latest messages first" pagination.
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_created_desc
    ON chat_messages (channel_id, created_at DESC);

-- Review aggregation for trust scoring: provider-centric lookups by rating.
-- Existing idx_reviews_reviewee covers (reviewee_id, status) for published
-- reviews but does not include rating for aggregation queries.
CREATE INDEX IF NOT EXISTS idx_reviews_provider_rating
    ON reviews (reviewee_id, overall_rating, created_at DESC)
    WHERE status = 'published';

-- Challenge leaderboard: supports ORDER BY current_progress DESC within a challenge.
CREATE INDEX IF NOT EXISTS idx_challenge_participants_progress
    ON challenge_participants (challenge_id, current_progress DESC);

-- Disputes: admin view of guarantee claims ordered by recency.
-- Existing idx_disputes_guarantee_status (migration 015) covers (status, created_at DESC)
-- but only filters by status within guarantee claims. This index supports the
-- "all guarantee claims, newest first" admin query without a status filter.
CREATE INDEX IF NOT EXISTS idx_disputes_guarantee_created
    ON disputes (created_at DESC)
    WHERE is_guarantee_claim = true;

-- Provider search: trust tier + score for filtered provider listings.
-- Existing idx_trust_scores_tier covers (tier, overall_score DESC) but adding
-- a covering index for user_id avoids the heap lookup.
CREATE INDEX IF NOT EXISTS idx_trust_scores_tier_user
    ON trust_scores (tier, overall_score DESC, user_id);

-- Contract lookup by job: speed up the Fair Price Index view join path
-- contracts -> jobs. Existing idx_contracts_job is (job_id) without status.
CREATE INDEX IF NOT EXISTS idx_contracts_job_status
    ON contracts (job_id, status);

-- Provider service categories: reverse lookup for "which providers serve this category?"
-- Existing idx_psc_category covers (category_id) but adding provider_id avoids
-- the heap lookup for join-heavy provider search queries.
CREATE INDEX IF NOT EXISTS idx_psc_category_provider
    ON provider_service_categories (category_id, provider_id);
