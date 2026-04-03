-- =============================================================================
-- 020_query_optimization: Additional indexes and query-level improvements
-- =============================================================================
-- Analysis of all repository queries across user, job, payment, chat, and
-- analytics services. Targets: missing indexes for WHERE/JOIN/ORDER BY patterns,
-- partial indexes for status-filtered queries, composite indexes for multi-column
-- lookups, and coverage gaps left by migration 018.

-- ---------------------------------------------------------------------------
-- PAYMENTS: Indexes for analytics and listing queries
-- ---------------------------------------------------------------------------

-- analytics.go: GetMarketTrends JOIN payments ON contract_id, filter by status + created_at
-- analytics.go: GetProviderEarnings filter by provider_id + status + created_at
-- analytics.go: GetCustomerSpending filter by customer_id + status + created_at
-- Existing idx_payments_customer and idx_payments_provider cover (user_id, status)
-- but not created_at, forcing a sort/filter step on the date range.
CREATE INDEX IF NOT EXISTS idx_payments_provider_status_created
    ON payments (provider_id, status, created_at DESC)
    WHERE status IN ('completed', 'released');

CREATE INDEX IF NOT EXISTS idx_payments_customer_status_created
    ON payments (customer_id, status, created_at DESC)
    WHERE status IN ('completed', 'released', 'escrow');

-- payment/postgres.go: ListPayments filters (customer_id = $1 OR provider_id = $1)
-- with ORDER BY created_at DESC. The OR prevents use of a single index efficiently.
-- These partial indexes help the planner use a BitmapOr scan.
CREATE INDEX IF NOT EXISTS idx_payments_created_desc
    ON payments (created_at DESC);

-- payment/postgres.go: FindByStripePaymentIntentID -- already covered by
-- idx_payments_stripe_pi. No change needed.

-- payment/postgres.go: GetFeeConfig / GetDefaultFeeConfig -- filter by
-- category_id + active + ORDER BY effective_from DESC.
CREATE INDEX IF NOT EXISTS idx_fee_config_category_active
    ON platform_fee_config (category_id, effective_from DESC)
    WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_fee_config_default_active
    ON platform_fee_config (effective_from DESC)
    WHERE category_id IS NULL AND active = true;

-- ---------------------------------------------------------------------------
-- BIDS: Indexes for analytics aggregation
-- ---------------------------------------------------------------------------

-- analytics.go: GetProviderAnalytics aggregates bids by provider_id + status + created_at
-- Existing idx_bids_provider covers (provider_id, status) but not created_at.
CREATE INDEX IF NOT EXISTS idx_bids_provider_created
    ON bids (provider_id, created_at DESC);

-- analytics.go: GetPlatformMetrics counts bids by created_at range.
-- Existing indexes are all (job_id, ...) or (provider_id, ...).
CREATE INDEX IF NOT EXISTS idx_bids_created
    ON bids (created_at DESC);

-- ---------------------------------------------------------------------------
-- CONTRACTS: Indexes for analytics JOINs
-- ---------------------------------------------------------------------------

-- analytics.go: GetProviderAnalytics filters contracts by provider_id + status + created_at
-- Existing idx_contracts_provider covers (provider_id, status) but not created_at.
CREATE INDEX IF NOT EXISTS idx_contracts_provider_status_created
    ON contracts (provider_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- REVIEWS: Indexes for analytics aggregation
-- ---------------------------------------------------------------------------

-- analytics.go: GetProviderAnalytics aggregates reviews by reviewee_id + created_at
-- Existing idx_reviews_reviewee covers (reviewee_id, status) for published only.
-- Analytics queries filter by created_at range across all statuses.
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee_created
    ON reviews (reviewee_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- USERS: Indexes for admin search and platform metrics
-- ---------------------------------------------------------------------------

-- user/postgres.go: AdminSearchUsers uses ILIKE on email, display_name, phone.
-- pg_trgm GIN indexes enable fast trigram similarity matching for ILIKE patterns.
CREATE INDEX IF NOT EXISTS idx_users_email_trgm
    ON users USING GIN (email gin_trgm_ops)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_display_name_trgm
    ON users USING GIN (display_name gin_trgm_ops)
    WHERE deleted_at IS NULL;

-- analytics.go: GetPlatformMetrics scans users for COUNT with FILTER on
-- last_active_at and created_at. A composite index helps the conditional counts.
CREATE INDEX IF NOT EXISTS idx_users_created_at
    ON users (created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_last_active
    ON users (last_active_at DESC)
    WHERE deleted_at IS NULL AND last_active_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- JOBS: Indexes for search and analytics
-- ---------------------------------------------------------------------------

-- job/postgres.go: SearchJobs text search uses ILIKE on title and description.
-- pg_trgm GIN indexes support these patterns.
CREATE INDEX IF NOT EXISTS idx_jobs_title_trgm
    ON jobs USING GIN (title gin_trgm_ops)
    WHERE deleted_at IS NULL AND status = 'active';

-- analytics.go: GetPlatformMetrics and GetGrowthMetrics filter jobs by
-- status + updated_at for completed job counts.
CREATE INDEX IF NOT EXISTS idx_jobs_status_updated
    ON jobs (status, updated_at DESC)
    WHERE deleted_at IS NULL;

-- job/postgres.go: ListCustomerJobs filters by customer_id + status + property_id
-- with ORDER BY created_at DESC. Existing idx_jobs_customer covers (customer_id)
-- but not the common status filter.
CREATE INDEX IF NOT EXISTS idx_jobs_customer_status_created
    ON jobs (customer_id, status, created_at DESC)
    WHERE deleted_at IS NULL;

-- job/postgres.go: ListDrafts filters customer_id + status='draft' + ORDER BY updated_at.
-- Partial index for this frequent query.
CREATE INDEX IF NOT EXISTS idx_jobs_customer_drafts
    ON jobs (customer_id, updated_at DESC)
    WHERE status = 'draft' AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- CHAT: Indexes for message queries and unread counts
-- ---------------------------------------------------------------------------

-- chat/postgres.go: GetUnreadCounts uses correlated subqueries counting
-- chat_messages by channel_id + is_deleted + created_at > last_read_at.
-- Existing idx_chat_messages_channel covers (channel_id, created_at ASC).
-- The partial index on non-deleted messages speeds up the COUNT subquery.
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_active
    ON chat_messages (channel_id, created_at DESC)
    WHERE is_deleted = false;

-- chat/postgres.go: ListChannels filters by (customer_id = $1 OR provider_id = $1)
-- Existing indexes cover each side separately. No change needed.

-- ---------------------------------------------------------------------------
-- MARKET RANGES: Covering index for frequent lookup
-- ---------------------------------------------------------------------------

-- analytics.go + job/postgres.go: LookupMarketRange and GetMarketRange both
-- query WHERE service_type_id = $1 AND zip_code = $2 ORDER BY computed_at DESC.
-- Existing idx_market_ranges_zip covers (zip_code, service_type_id) but not
-- computed_at for the ORDER BY.
CREATE INDEX IF NOT EXISTS idx_market_ranges_type_zip_computed
    ON market_ranges (service_type_id, zip_code, computed_at DESC);

-- ---------------------------------------------------------------------------
-- ANALYTICS TRANSACTIONS: Indexes for reporting queries
-- ---------------------------------------------------------------------------

-- analytics.go: GetGeographicMetrics filters by completed_at + region.
-- analytics.go: GetCategoryMetrics joins on category_id + completed_at.
CREATE INDEX IF NOT EXISTS idx_analytics_txn_category_completed
    ON analytics_transactions (category_id, completed_at DESC)
    WHERE category_id IS NOT NULL;

-- analytics.go: GetCustomerSpending and GetProviderEarnings join
-- payments -> contracts -> jobs. The contracts.job_id join is already
-- covered by idx_contracts_job and idx_contracts_job_status (migration 018).

-- ---------------------------------------------------------------------------
-- SUBSCRIPTIONS: Index for GetStripeCustomerID
-- ---------------------------------------------------------------------------

-- payment/postgres.go: GetStripeCustomerID filters subscriptions by
-- user_id + status IN ('active', 'trialing', 'past_due') + ORDER BY created_at DESC.
-- Existing idx_subscriptions_user covers (user_id, status) but not created_at.
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status_created
    ON subscriptions (user_id, status, created_at DESC)
    WHERE status IN ('active', 'trialing', 'past_due');

-- ---------------------------------------------------------------------------
-- REFRESH TOKENS: Index for RevokeAllUserTokens
-- ---------------------------------------------------------------------------

-- user/postgres.go: RevokeAllUserTokens filters by user_id + revoked_at IS NULL.
-- Existing idx_refresh_tokens_user_id covers (user_id) but not the NULL filter.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active
    ON refresh_tokens (user_id)
    WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- VERIFICATION DOCUMENTS: Index for ListDocuments
-- ---------------------------------------------------------------------------

-- user/postgres.go: ListDocuments and GetDocumentByUserAndType query by user_id
-- with ORDER BY created_at DESC. Existing idx_verification_docs_user covers
-- (user_id, document_type) but without created_at ordering.
CREATE INDEX IF NOT EXISTS idx_verification_docs_user_created
    ON verification_documents (user_id, created_at DESC);
