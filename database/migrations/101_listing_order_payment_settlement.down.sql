-- Reverse 101. Any row already parked in 'payment_failed' has to be moved back
-- to a state the old CHECK accepts, or the constraint cannot be re-added.
-- 'pending_payment' is the state those rows came from and is the only honest
-- target: it says "still unfunded", which remains true.
UPDATE listing_orders
   SET escrow_status = 'pending_payment'
 WHERE escrow_status = 'payment_failed';

DROP INDEX IF EXISTS idx_listing_orders_awaiting_payment;

ALTER TABLE listing_orders DROP COLUMN IF EXISTS last_payment_error;
ALTER TABLE listing_orders DROP COLUMN IF EXISTS payment_attempts;
ALTER TABLE listing_orders DROP COLUMN IF EXISTS payment_due_at;

ALTER TABLE listing_orders DROP CONSTRAINT IF EXISTS listing_orders_escrow_status_check;
ALTER TABLE listing_orders ADD CONSTRAINT listing_orders_escrow_status_check
    CHECK (escrow_status IN (
        'pending_payment',
        'held',
        'pickup_confirmed',
        'released',
        'disputed',
        'refunded',
        'partially_refunded'
    ));
