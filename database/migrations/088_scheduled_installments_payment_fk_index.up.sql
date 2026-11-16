-- Migration 088 — cover the unindexed FK scheduled_installments.payment_id.
--
-- Money path. BNPL installment rows are found by plan_id and by due_date, never by payment_id, so linking a Stripe charge back to its installment was a full scan of the whole schedule table.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scheduled_installments_payment_fk ON scheduled_installments (payment_id);
