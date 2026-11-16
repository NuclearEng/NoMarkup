-- Down for 079. Reversible: drops the lease columns and the alerting index.
--
-- Rolling this back restores the check-then-act dedup, under which two
-- concurrent deliveries of the same Stripe event both run the handler. The
-- repository code must be rolled back with it — RecordStripeEventStart
-- references claimed_at/attempts. Development only.
--
-- Signature verification is not touched by either direction of this migration;
-- STRIPE_WEBHOOK_SECRET verification stays mandatory upstream.

DROP INDEX IF EXISTS idx_stripe_events_unprocessed;

ALTER TABLE stripe_events DROP COLUMN IF EXISTS attempts;
ALTER TABLE stripe_events DROP COLUMN IF EXISTS claimed_at;
