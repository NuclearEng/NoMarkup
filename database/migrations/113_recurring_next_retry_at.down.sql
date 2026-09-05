-- Reverse 113: drop FR-16.7 partial next_retry_at.
DROP INDEX IF EXISTS idx_recurring_configs_next_retry_at;

ALTER TABLE recurring_configs
    DROP COLUMN IF EXISTS next_retry_at;
