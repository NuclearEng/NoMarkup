-- Reverse 111: drop unique one-payment-per-instance; restore 064 non-unique lookup.
DROP INDEX IF EXISTS uq_payments_recurring_instance;

CREATE INDEX IF NOT EXISTS idx_payments_recurring_instance
    ON payments (recurring_instance_id) WHERE recurring_instance_id IS NOT NULL;

-- Note: recurring_instance_id NULLs applied to loser duplicates in the up
-- migration are NOT restored — that data loss is intentional and irreversible
-- without an archive table (none was written). Re-linking would re-open dual-PI.
