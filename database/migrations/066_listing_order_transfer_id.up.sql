-- Migration 066 — record the Stripe Connect transfer that pays the seller
-- for a released goods order, and let the auto-release worker reconcile
-- handshake-released orders that have not yet been paid out.
--
-- Builds on:
--   034 — listing_orders / listings creation
--   035 — escrow_status state machine ('held' -> 'released' etc.)
--   047 — mutual pickup handshake (seller_confirmed_at)
--
-- The money bug this fixes:
--   The gateway pickup handshake (confirm-pickup + seller-confirm) flips
--   listing_orders.escrow_status straight to 'released' in SQL, but the ONLY
--   code path that creates the Stripe Connect transfer to the seller is the
--   payment-service auto-release worker, which polled ONLY escrow_status='held'.
--   So a handshake-released order was NEVER paid out — no transfer fired.
--
-- The fix records the transfer id on the order so:
--   1. the worker can find 'released' orders with NO transfer yet
--      (stripe_transfer_id IS NULL) and pay them, and
--   2. once paid, stripe_transfer_id is non-null so the order is never
--      selected again — a durable, idempotent "already paid" marker that
--      complements the deterministic Stripe idempotency key
--      ('listing-release:<order_id>').

ALTER TABLE listing_orders ADD COLUMN IF NOT EXISTS stripe_transfer_id TEXT;

-- Worker scan: 'released' orders that still need a payout. Partial index keeps
-- the reconcile query cheap (the common case is zero unpaid released orders).
CREATE INDEX IF NOT EXISTS idx_listing_orders_unpaid_released
    ON listing_orders (released_at)
    WHERE escrow_status = 'released' AND stripe_transfer_id IS NULL;
