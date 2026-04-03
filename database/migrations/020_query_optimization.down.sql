-- Reverse 020_query_optimization: drop all indexes added in the up migration.

-- Payments
DROP INDEX IF EXISTS idx_payments_provider_status_created;
DROP INDEX IF EXISTS idx_payments_customer_status_created;
DROP INDEX IF EXISTS idx_payments_created_desc;
DROP INDEX IF EXISTS idx_fee_config_category_active;
DROP INDEX IF EXISTS idx_fee_config_default_active;

-- Bids
DROP INDEX IF EXISTS idx_bids_provider_created;
DROP INDEX IF EXISTS idx_bids_created;

-- Contracts
DROP INDEX IF EXISTS idx_contracts_provider_status_created;

-- Reviews
DROP INDEX IF EXISTS idx_reviews_reviewee_created;

-- Users
DROP INDEX IF EXISTS idx_users_email_trgm;
DROP INDEX IF EXISTS idx_users_display_name_trgm;
DROP INDEX IF EXISTS idx_users_created_at;
DROP INDEX IF EXISTS idx_users_last_active;

-- Jobs
DROP INDEX IF EXISTS idx_jobs_title_trgm;
DROP INDEX IF EXISTS idx_jobs_status_updated;
DROP INDEX IF EXISTS idx_jobs_customer_status_created;
DROP INDEX IF EXISTS idx_jobs_customer_drafts;

-- Chat
DROP INDEX IF EXISTS idx_chat_messages_channel_active;

-- Market ranges
DROP INDEX IF EXISTS idx_market_ranges_type_zip_computed;

-- Analytics transactions
DROP INDEX IF EXISTS idx_analytics_txn_category_completed;

-- Subscriptions
DROP INDEX IF EXISTS idx_subscriptions_user_status_created;

-- Refresh tokens
DROP INDEX IF EXISTS idx_refresh_tokens_user_active;

-- Verification documents
DROP INDEX IF EXISTS idx_verification_docs_user_created;
