-- Enhance disputes table for dedicated guarantee claim tracking.
-- Guarantee claims are modeled as disputes with is_guarantee_claim = true.
-- This migration adds a dedicated payout column to track guarantee fund disbursements
-- separately from generic dispute refunds, plus additional guarantee metadata.

ALTER TABLE disputes
    ADD COLUMN IF NOT EXISTS guarantee_payout_cents BIGINT,
    ADD COLUMN IF NOT EXISTS guarantee_reviewed_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS guarantee_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS guarantee_paid_at TIMESTAMPTZ;

-- Composite index for admin guarantee claims listing with status filtering.
CREATE INDEX IF NOT EXISTS idx_disputes_guarantee_status
    ON disputes (status, created_at DESC)
    WHERE is_guarantee_claim = true;
