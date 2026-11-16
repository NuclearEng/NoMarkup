-- Migration 079 — turn stripe_events from a check-then-act log into a claim.
--
-- Builds on:
--   025 — stripe_events (id TEXT PK, type, received_at, processed_at)
--
-- Signature verification is unaffected by this migration and remains mandatory
-- upstream of everything described here: StripeWebhookValidator verifies every
-- delivery against STRIPE_WEBHOOK_SECRET before an event id ever reaches this
-- table. This migration only concerns what happens AFTER an event is verified.
--
-- ── The bug ──────────────────────────────────────────────────────────────
-- services/payment/internal/repository/postgres.go RecordStripeEventStart did:
--
--     INSERT INTO stripe_events (id, type) VALUES ($1,$2)
--       ON CONFLICT (id) DO NOTHING;          -- RowsAffected DISCARDED
--     SELECT processed_at FROM stripe_events WHERE id = $1;   -- separate query
--
-- The PK on stripe_events.id makes the row unique, but nothing CLAIMS it. Two
-- concurrent deliveries of the same event (Stripe retries aggressively, and the
-- payment service can be running many replicas) both find processed_at IS NULL
-- and both run the handler to completion: double refunds, double escrow
-- transitions, double dispute records. The INSERT already knew which caller
-- won — it threw that information away.
--
-- Compounding it: the delivery entrypoint logs and swallows a
-- MarkStripeEventProcessed failure. When that stamp fails, processed_at stays
-- NULL forever, so the ONLY thing the dedup check keys off is absent — dedup is
-- disabled for exactly the event that already went wrong.
--
-- ── The fix ──────────────────────────────────────────────────────────────
-- A lease. `claimed_at` records when a worker took the event; `attempts`
-- counts takes. The repository now issues ONE statement:
--
--     INSERT INTO stripe_events (id, type, claimed_at, attempts)
--     VALUES ($1, $2, now(), 1)
--     ON CONFLICT (id) DO UPDATE
--        SET claimed_at = now(), attempts = stripe_events.attempts + 1
--      WHERE stripe_events.processed_at IS NULL
--        AND (stripe_events.claimed_at IS NULL
--             OR stripe_events.claimed_at < now() - <lease>)
--     RETURNING id;
--
-- A returned row means this caller holds the claim; no row means either the
-- event is already fully processed or another worker holds a live lease. Both
-- are "skip". The ON CONFLICT DO UPDATE takes a row-level lock, so the two
-- concurrent deliveries serialise and exactly one wins.
--
-- The lease preserves MON-12 (a crashed attempt must be retryable — Stripe
-- redelivers for up to 3 days): once the lease expires the next delivery
-- re-claims and reprocesses. It also bounds the swallowed-stamp failure above:
-- duplicate work is now blocked for the whole lease window even when
-- processed_at never gets set, instead of not at all.
--
-- No backfill is needed. Existing rows get claimed_at NULL / attempts 0, which
-- the claim predicate reads as "unclaimed" — the correct interpretation for a
-- row written by the old code.

SET lock_timeout = '5s';

ALTER TABLE stripe_events
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

ALTER TABLE stripe_events
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN stripe_events.claimed_at IS
    'When a worker last took this event for processing. Acts as a lease: a claim older than the repository lease window is re-claimable so a crashed attempt is retried (MON-12). NULL means never claimed.';
COMMENT ON COLUMN stripe_events.attempts IS
    'Number of times this event has been claimed for processing. attempts > 1 with processed_at NULL is the alerting signal for an event that keeps failing.';

-- Operational surface: find events that were claimed but never finished. This
-- is the queue a background alerter should watch — previously invisible,
-- because a stuck event was indistinguishable from a brand new one.
CREATE INDEX IF NOT EXISTS idx_stripe_events_unprocessed
    ON stripe_events (claimed_at)
    WHERE processed_at IS NULL;
