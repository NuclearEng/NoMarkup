-- 110_job_bid_idempotency.down.sql
DROP INDEX IF EXISTS idx_bids_idempotency;
ALTER TABLE bids
    DROP COLUMN IF EXISTS idempotency_key;
