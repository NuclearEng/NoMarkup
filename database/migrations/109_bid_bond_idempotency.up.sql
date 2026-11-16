-- 109_bid_bond_idempotency.up.sql
--
-- Durable double-submit guard for POST /api/v1/listings/{id}/bid-bond.
-- Gateway RequireIdempotencyKey is Redis-only (24h 2xx). This column + partial
-- UNIQUE survives Redis flush and serializes concurrent creates that both
-- passed middleware without minting a second SetupIntent row on soft replay.
--
-- Pattern mirrors 056_listing_bid_idempotency: nullable key for legacy rows;
-- partial unique only when key is present. Scope: (user_id, listing_id, key)
-- because the client sticky key is already bid-bond:{listing}:{intended_cents}.

ALTER TABLE bid_bonds
    ADD COLUMN idempotency_key TEXT;

COMMENT ON COLUMN bid_bonds.idempotency_key IS
    'Client Idempotency-Key for CreateBidBond. NULL = no key (legacy). Deduped per (user_id, listing_id) via idx_bid_bonds_idempotency.';

CREATE UNIQUE INDEX idx_bid_bonds_idempotency
    ON bid_bonds (user_id, listing_id, idempotency_key)
 WHERE idempotency_key IS NOT NULL;
