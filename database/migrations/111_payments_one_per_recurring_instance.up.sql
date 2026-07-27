-- Migration 111 — at most ONE live payment per recurring_instance_id.
--
-- Closes dual-PI risk on FR-18 visits: gateway approve/auto-complete uses
-- sticky key recurring-instance-pay:{instanceID}, while customer iOS/web
-- POST /payments uses create-payment:{contract}:{amount}:{instance}. Those are
-- different payments.idempotency_key values, so the existing UNIQUE(idempotency_key)
-- does not collapse them. Without a unique on recurring_instance_id, two
-- PaymentIntents can authorize against the same visit.
--
-- Builds on:
--   001 — payments.recurring_instance_id (nullable FK)
--   064 — non-unique idx_payments_recurring_instance (perf/FK lookup only)
--
-- ── Partial UNIQUE ───────────────────────────────────────────────────────
-- WHERE recurring_instance_id IS NOT NULL: non-recurring payments (milestones,
-- full-contract, tips) leave the column NULL and must still coexist.
--
-- We DROP the non-unique 064 index after creating the unique one: a unique
-- partial index still serves FK/lookup equality on recurring_instance_id, so
-- the non-unique is pure write overhead once the unique exists.
--
-- ── Pre-existing duplicates ──────────────────────────────────────────────
-- Keep the earliest row that already has a Stripe PaymentIntent (the one that
-- may hold an authorization); on a tie keep earliest created_at/id. Losers
-- have recurring_instance_id nulled so the unique index can build — payment
-- history is preserved, only the instance linkage is cleared. Status is left
-- as-is (failed/pending orphan PIs stay for ops/reconciliation).
--
-- Multi-statement file (no CONCURRENTLY): same pattern as 069. payments is
-- not at the scale where a short lock on this partial unique is a deploy risk
-- for current environments; CONCURRENTLY would force a one-statement-per-file
-- split and a separate drop migration.

-- 1. Collapse pre-existing dual-PI rows so the unique index can build.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY recurring_instance_id
               ORDER BY
                   CASE WHEN COALESCE(stripe_payment_intent_id, '') <> '' THEN 0 ELSE 1 END,
                   created_at ASC,
                   id ASC
           ) AS rn
      FROM payments
     WHERE recurring_instance_id IS NOT NULL
)
UPDATE payments p
   SET recurring_instance_id = NULL,
       updated_at            = now()
  FROM ranked
 WHERE p.id = ranked.id
   AND ranked.rn > 1;

-- 2. Enforce one payment per recurring visit (NULL-safe partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_recurring_instance
    ON payments (recurring_instance_id)
    WHERE recurring_instance_id IS NOT NULL;

COMMENT ON INDEX uq_payments_recurring_instance IS
    'At most one payments row per recurring_instances visit. Soft-replay on 23505 re-reads the existing PaymentIntent client_secret (CreatePayment).';

-- 3. Drop the redundant non-unique index from 064 (unique covers lookups).
DROP INDEX IF EXISTS idx_payments_recurring_instance;
