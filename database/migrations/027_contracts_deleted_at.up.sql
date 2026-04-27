-- Bug 1: contracts table needs deleted_at for soft-delete support.
-- The gateway middleware (gateway/internal/middleware/ownership.go::RequirePartyAccess)
-- filters on `deleted_at IS NULL`. Without this column, every contract endpoint
-- returns 503. The original 001 schema omitted it; this migration backfills.
--
-- Uses IF NOT EXISTS so it is a no-op against environments where the column was
-- added out-of-band (some shared dev DBs already have it from a hand-applied fix).
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- Partial indexes that align with how the column is actually queried.
CREATE INDEX IF NOT EXISTS idx_contracts_customer_active
    ON contracts (customer_id, status)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_provider_active
    ON contracts (provider_id, status)
    WHERE deleted_at IS NULL;
