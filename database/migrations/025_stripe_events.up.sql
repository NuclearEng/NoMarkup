-- Stripe webhook event dedup table.
--
-- Stripe retries webhook deliveries for up to 3 days on any non-2xx response.
-- If a handler is slow or crashes mid-write, the SAME event.id can arrive
-- multiple times, which would double-apply side effects (e.g. re-releasing
-- escrow on payment_intent.succeeded). This table records every Stripe event
-- the payment service has seen, keyed by Stripe's event.id (which is globally
-- unique per event). The webhook handler checks this table before processing
-- and returns 200 OK for duplicates.
CREATE TABLE stripe_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX idx_stripe_events_received_at ON stripe_events (received_at);
CREATE INDEX idx_stripe_events_type ON stripe_events (type);
