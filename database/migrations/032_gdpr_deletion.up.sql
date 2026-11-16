-- 032: GDPR / CCPA right-to-erasure pipeline columns.
--
-- Adds the lifecycle columns the user-service GDPR pipeline requires so a
-- self-service deletion request can be:
--   1. Recorded with a request timestamp (`deletion_requested_at`) so the
--      30-day grace window is countable.
--   2. Annotated with a free-text user reason for exit-survey insights.
--   3. Marked as fully erased (`deletion_finalized_at`) once the cascade
--      anonymizer has run, which also acts as the idempotency guard so a
--      re-fired worker does not double-process a row.
--
-- The partial index `idx_users_deletion_pending` is the cron's hot-path
-- predicate: it scans only rows with a request that has not been finalized,
-- which is at most a few hundred rows even on a large platform.
--
-- See docs/operations/gdpr-delete.md for the full erasure cascade and
-- table-by-table rationale.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS deletion_reason       TEXT        NULL,
    ADD COLUMN IF NOT EXISTS deletion_finalized_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_users_deletion_pending
    ON users (deletion_requested_at)
    WHERE deletion_finalized_at IS NULL
      AND deletion_requested_at IS NOT NULL;

COMMENT ON COLUMN users.deletion_requested_at IS
    'Timestamp when the user (or admin) initiated GDPR/CCPA erasure. NULL while account is active. The cron worker reads this and finalizes anything older than the grace window (30 days by default).';
COMMENT ON COLUMN users.deletion_reason IS
    'Free-text reason captured from the user at deletion request time. Retained for exit-survey insights only — not anonymized at finalization (it is opt-in input that is already not directly identifying).';
COMMENT ON COLUMN users.deletion_finalized_at IS
    'Timestamp when FinalizeAccountDeletion completed. NULL until cascade has run. Used as the idempotency guard so the cron does not re-process a row that has already been wiped.';
