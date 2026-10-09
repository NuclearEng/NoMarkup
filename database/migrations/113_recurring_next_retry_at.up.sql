-- Migration 113 — FR-16.7 partial: schedule next automatic payment retry.
--
-- Migration 112 added payment_retry_count (3-strike pause). FR-16.7 also wants
-- day-0 / day-3 / day-7 automatic retries before pause. This column stores when
-- the next scheduled attempt is due:
--
--   recurring_configs.next_retry_at
--
-- Gateway sets it on CreatePayment/setup failure when the new count is still
-- below the pause threshold (count 1 → now+3d, count 2 → now+4d so day-7 lands
-- ~7d after day-0). Clears on successful visit pay, on reset, and when count
-- reaches the pause threshold.
--
-- Worker residual: a log-only job-service ticker (processRecurringPaymentRetries)
-- scans due rows. Actual off-session charge / CreatePayment re-attempt remains
-- residual — this column is the durable schedule only.

ALTER TABLE recurring_configs
    ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

COMMENT ON COLUMN recurring_configs.next_retry_at IS
    'FR-16.7 partial: when the next automatic payment retry is due (day 3 / day 7 after setup failures). NULL when no retry scheduled or after pause/success reset.';

-- Partial index for the due-retry scan (active schedules with a pending retry).
CREATE INDEX IF NOT EXISTS idx_recurring_configs_next_retry_at
    ON recurring_configs (next_retry_at)
    WHERE next_retry_at IS NOT NULL AND status = 'active';
