-- Migration 095 — cover the unindexed FK review_responses.user_id.
--
-- review_responses had no index on user_id at all — only the PK and the unique on review_id. Both 'all responses by this user' and the user-erasure check were full scans.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_responses_user_fk ON review_responses (user_id);
