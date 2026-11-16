-- 056_listing_bid_idempotency.up.sql
--
-- Double-submit guard for goods bidding (CLAUDE.md §6: idempotency is
-- mandatory on bid/payment mutations).
--
-- POST /api/v1/listings/{id}/bids previously had no idempotency guard. A
-- rapid double-click sending two DISTINCT increasing amounts recorded BOTH
-- as real bids — the min-increment rule only catches identical-amount
-- double-submits. We now let the client pass an `Idempotency-Key` header;
-- the gateway persists it on the buyer's visible bid row and dedups within
-- the FOR UPDATE listings-row lock in placeBidTx.
--
-- The key is nullable: older clients that send no header are unaffected
-- (still protected by the min-increment + FOR UPDATE serialization). The
-- partial UNIQUE index only enforces uniqueness when a key is present, so a
-- second submit with the same (listing_id, bidder_id, idempotency_key)
-- collides and the handler returns the PRIOR bid instead of inserting.

ALTER TABLE listing_bids
    ADD COLUMN idempotency_key TEXT;

COMMENT ON COLUMN listing_bids.idempotency_key IS
    'Client-supplied Idempotency-Key for the visible bid. NULL = no key sent (legacy client). Deduped per (listing_id, bidder_id) via idx_listing_bids_idempotency.';

-- Partial UNIQUE index: only rows carrying a key participate, so legacy
-- NULL-key bids never collide. Backs the ON CONFLICT-style dedup lookup in
-- placeBidTx (single index probe inside the locked tx).
CREATE UNIQUE INDEX idx_listing_bids_idempotency
    ON listing_bids (listing_id, bidder_id, idempotency_key)
 WHERE idempotency_key IS NOT NULL;
