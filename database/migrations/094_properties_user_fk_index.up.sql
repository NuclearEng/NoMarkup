-- Migration 094 — cover the unindexed FK properties.user_id.
--
-- idx_properties_user exists but is PARTIAL on 'deleted_at IS NULL'. A soft-deleted property is invisible to it, so a user erasure still sequentially scans properties to find the rows blocking the delete. A non-partial index is required for the FK check.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_user_fk ON properties (user_id);
