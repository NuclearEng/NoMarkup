-- Migration 092 — cover the unindexed FK jobs.property_id.
--
-- A customer deleting a saved property forces a sequential scan of jobs. The existing idx_properties_user is on the wrong table for this, and jobs has no index on property_id at all.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_property_fk ON jobs (property_id);
