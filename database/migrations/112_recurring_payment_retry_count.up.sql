-- Migration 112 — FR-16.7 partial: payment setup failure retry counter.
--
-- CreatePayment failures on recurring visits (gateway approve / auto-approve
-- complete) used to PauseRecurring on the first failure. FR-16.7 wants 3
-- attempts before pause. This column is the durable counter:
--
--   recurring_configs.payment_retry_count
--
-- Gateway increments on CreatePayment failure for a visit; pauses only when
-- the returned count >= 3. Resets to 0 on successful visit PI create or on
-- ProcessPayment capture (resume path). Day-0/3/7 scheduled retries and
-- automatic off-session charge remain residual (not this migration).
--
-- No proto change: gateway reads/writes via shared Postgres pool (same pattern
-- as tip_amount_cents enrichment on contracts).

ALTER TABLE recurring_configs
    ADD COLUMN IF NOT EXISTS payment_retry_count INTEGER NOT NULL DEFAULT 0
        CONSTRAINT recurring_configs_payment_retry_count_nonneg CHECK (payment_retry_count >= 0);

COMMENT ON COLUMN recurring_configs.payment_retry_count IS
    'FR-16.7 partial: consecutive CreatePayment/setup failures for visit escrow. Pause recurrence when >= 3; reset on successful visit pay.';
