-- Migration 090 — cover the unindexed FK jobs.awarded_bid_id.
--
-- Points a job at the bid that won it. Uncovered, so resolving a bid back to its job, and any delete check against bids, scans the largest transactional table in the schema.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_awarded_bid_fk ON jobs (awarded_bid_id);
