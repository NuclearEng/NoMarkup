-- Migration 089 — cover the unindexed FK installment_plans.provider_id.
--
-- Money path. installment_plans is indexed on contract_id and customer_id but not provider_id, so 'every BNPL plan paying this provider' — and the provider's row in a user erasure — scans the table.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_installment_plans_provider_fk ON installment_plans (provider_id);
