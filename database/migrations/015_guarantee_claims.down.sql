DROP INDEX IF EXISTS idx_disputes_guarantee_status;

ALTER TABLE disputes
    DROP COLUMN IF EXISTS guarantee_paid_at,
    DROP COLUMN IF EXISTS guarantee_reviewed_at,
    DROP COLUMN IF EXISTS guarantee_reviewed_by,
    DROP COLUMN IF EXISTS guarantee_payout_cents;
