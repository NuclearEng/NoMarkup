-- Migration 084 — cover the unindexed FK analytics_transactions.customer_id.
--
-- GDPR user erasure: this is one of the four analytics_transactions FKs a DELETE FROM users must check. Without it that single delete sequentially scans the platform's largest append-only table four times.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_transactions_customer_fk ON analytics_transactions (customer_id);
