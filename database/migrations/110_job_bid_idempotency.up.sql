-- 110_job_bid_idempotency.up.sql
--
-- Durable double-submit guard for POST /api/v1/jobs/{id}/bids (services reverse
-- auction). Gateway RequireIdempotencyKey is Redis-only (24h 2xx). This column +
-- partial UNIQUE survives Redis flush and lets PlaceBid soft-replay by key
-- without minting a second bid row.
--
-- UNIQUE(job_id, provider_id) already prevents two bid ROWS per provider. The
-- residual was key-based durable replay (listing_bids 056 / bid_bonds 109
-- parity): store the client Idempotency-Key on the winning row so a Redis-miss
-- retry short-circuits before gRPC when the same key is reused.
--
-- Pattern mirrors 056_listing_bid_idempotency: nullable key for legacy rows;
-- partial unique only when key is present. Scope: (job_id, provider_id, key).

ALTER TABLE bids
    ADD COLUMN idempotency_key TEXT;

COMMENT ON COLUMN bids.idempotency_key IS
    'Client Idempotency-Key for PlaceBid. NULL = no key (legacy). Deduped per (job_id, provider_id) via idx_bids_idempotency.';

CREATE UNIQUE INDEX idx_bids_idempotency
    ON bids (job_id, provider_id, idempotency_key)
 WHERE idempotency_key IS NOT NULL;
