-- Reverse 019_query_optimization: drop all indexes added in the up migration.

DROP INDEX IF EXISTS idx_auction_bid_events_created_at;
DROP INDEX IF EXISTS idx_contracts_completed;
DROP INDEX IF EXISTS idx_bids_awarded_amount;
DROP INDEX IF EXISTS idx_jobs_category_status_created;
DROP INDEX IF EXISTS idx_jobs_zip_category;
DROP INDEX IF EXISTS idx_chat_messages_channel_created_desc;
DROP INDEX IF EXISTS idx_reviews_provider_rating;
DROP INDEX IF EXISTS idx_challenge_participants_progress;
DROP INDEX IF EXISTS idx_disputes_guarantee_created;
DROP INDEX IF EXISTS idx_trust_scores_tier_user;
DROP INDEX IF EXISTS idx_contracts_job_status;
DROP INDEX IF EXISTS idx_psc_category_provider;
