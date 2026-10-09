-- Migration 085 — cover the unindexed FK analytics_transactions.provider_id.
--
-- Second of the four analytics_transactions FKs on the user-erasure path; also the access path for per-provider revenue rollups.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_transactions_provider_fk ON analytics_transactions (provider_id);
