-- Migration 068 — record the Stripe PaymentIntent id that settled a scheduled
-- BNPL installment, separate from the internal payments(id) FK.
--
-- Builds on:
--   021 — installment_plans / scheduled_installments creation
--
-- The money/state bug this fixes:
--   scheduled_installments.payment_id is `UUID REFERENCES payments(id)` (021),
--   intended to point at an INTERNAL payments row. But installment charges never
--   create a payments row — the installment service charges Stripe directly and
--   then tried to write the raw Stripe PaymentIntent id (e.g.
--   'pi_3Nx...' / dev 'pi_dev_offsession_<key>') straight into that UUID column.
--   Postgres rejected every such UPDATE with:
--       invalid input syntax for type uuid: "pi_..." (SQLSTATE 22P02)
--   The error was only logged (never surfaced), so CreateInstallmentPlan returned
--   201 with the provider already paid, yet the first installment stayed
--   'scheduled' forever — uncollected. The same failure hit the scheduler
--   (ProcessDueInstallments) and the webhook confirm path, so NO installment in
--   any environment could ever be marked 'paid' and NO plan could ever 'complete'.
--
-- The fix gives the Stripe PI id its own TEXT home so the charge is durably
-- recorded; payment_id stays a clean UUID FK (left NULL for installment charges,
-- since there is no internal payments row to reference).

ALTER TABLE scheduled_installments
    ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;
