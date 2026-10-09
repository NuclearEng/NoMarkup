-- Migration 086 — cover the unindexed FK analytics_transactions.contract_id.
--
-- Ties an analytics row back to its contract. Uncovered, so contract-scoped reporting and any contract delete check both scan the whole table.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_transactions_contract_fk ON analytics_transactions (contract_id);
