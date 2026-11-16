-- Reverse migration 068 — drop the Stripe PaymentIntent id marker on
-- scheduled installments.

ALTER TABLE scheduled_installments DROP COLUMN IF EXISTS stripe_payment_intent_id;
