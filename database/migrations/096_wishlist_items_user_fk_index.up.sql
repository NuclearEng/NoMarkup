-- Migration 096 — cover the unindexed FK wishlist_items.user_id.
--
-- idx_wishlist_items_user is PARTIAL on 'deleted_at IS NULL' and leads on (user_id, created_at DESC). The partial predicate excludes soft-deleted rows, so it cannot serve the FK check on user erasure.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wishlist_items_user_fk ON wishlist_items (user_id);
