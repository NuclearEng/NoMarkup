-- Goods marketplace: make an unpaid auction win a VISIBLE, TERMINAL outcome.
--
-- Background. `services/job/internal/repository/listing_repo.go` inserts the
-- winning auction's order as escrow_status='pending_payment' with no
-- payment_intent_id. Nothing ever moved that row forward: ChargeListingWinner
-- had zero non-test callers, so the order sat in 'pending_payment' forever.
-- The listing stayed 'sold', the winning bid stayed 'awarded', and no human
-- was ever told. The escrow_status CHECK (migration 035) had no state that
-- could express "the buyer never paid", so even an operator could not record
-- the outcome without violating the constraint.
--
-- This migration adds the missing vocabulary, in one cohesive change (the same
-- shape migration 035 used when it introduced 'pending_payment'):
--
--   1. escrow_status gains 'payment_failed' — terminal, reached only from
--      'pending_payment'. It NEVER pays a seller: the auto-release worker
--      (repository/marketplace.go ListListingOrdersForAutoRelease) selects only
--      'held' and 'released', so a payment_failed order can never transfer.
--
--   2. payment_due_at — the deadline by which the buyer must fund the order.
--      Stamped by the settlement sweeper when it first creates the
--      PaymentIntent. NULL means "no deadline set yet"; the sweeper falls back
--      to created_at + window so pre-existing rows are still swept.
--
--   3. payment_attempts / last_payment_error — how many times settlement has
--      tried to fund this order and why the last try did not stick. Without
--      these, a stuck order is indistinguishable from a fresh one and support
--      has nothing to act on.
--
-- Money-safety: nothing here moves money or changes an existing row's status.
-- The new columns are nullable / zero-defaulted, so the migration is a pure
-- widening — every existing read path keeps working unchanged.

ALTER TABLE listing_orders DROP CONSTRAINT IF EXISTS listing_orders_escrow_status_check;
ALTER TABLE listing_orders ADD CONSTRAINT listing_orders_escrow_status_check
    CHECK (escrow_status IN (
        'pending_payment',
        'payment_failed',
        'held',
        'pickup_confirmed',
        'released',
        'disputed',
        'refunded',
        'partially_refunded'
    ));

ALTER TABLE listing_orders ADD COLUMN payment_due_at     TIMESTAMPTZ;
ALTER TABLE listing_orders ADD COLUMN payment_attempts   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE listing_orders ADD COLUMN last_payment_error TEXT;

COMMENT ON COLUMN listing_orders.payment_due_at IS
    'Deadline for the buyer to fund an auction win. Past this, the settlement sweeper moves the order to escrow_status=payment_failed. NULL = not yet stamped.';
COMMENT ON COLUMN listing_orders.payment_attempts IS
    'Number of settlement passes that have tried to fund this order. Incremented by the payment-service settlement sweeper only.';
COMMENT ON COLUMN listing_orders.last_payment_error IS
    'Operator-facing reason the most recent settlement attempt did not fund the order. Never rendered to the buyer verbatim.';

-- Sweeper index. The settlement worker scans exactly the unfunded set, so keep
-- it a partial index on the status it filters — the table is dominated by
-- funded/released rows that must never be walked.
CREATE INDEX idx_listing_orders_awaiting_payment
    ON listing_orders (created_at)
    WHERE escrow_status = 'pending_payment';
