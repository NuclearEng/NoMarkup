-- Migration 093 — cover the unindexed FK user_savings.job_id.
--
-- user_savings_user_id_job_id_key is UNIQUE(user_id, job_id) — job_id is not the leading column, so it cannot serve a lookup or delete check keyed on job_id alone.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_savings_job_fk ON user_savings (job_id);
