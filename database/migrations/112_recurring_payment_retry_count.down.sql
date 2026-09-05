-- Reverse 112: drop FR-16.7 partial payment_retry_count.
ALTER TABLE recurring_configs
    DROP COLUMN IF EXISTS payment_retry_count;
