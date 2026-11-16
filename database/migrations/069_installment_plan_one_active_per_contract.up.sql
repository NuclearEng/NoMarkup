-- Migration 069 — at most ONE active BNPL installment plan per contract.
--
-- Builds on:
--   021 — installment_plans creation (status: active/completed/defaulted/cancelled)
--
-- The money bug this closes:
--   CreateInstallmentPlan pays the provider IN FULL the moment a plan is created.
--   Nothing server-side stopped a customer from creating a SECOND plan for the
--   same contract — only the web UI hid the selector once a plan existed. A
--   direct API call (or a double-submit race) could therefore create N plans for
--   one contract and pay the provider N times for a single job, with the customer
--   on the hook for N installment schedules. Per the project's fail-closed rule,
--   the invariant must live at the data boundary, not the client.
--
-- A PARTIAL UNIQUE index keyed on contract_id WHERE status = 'active' enforces
-- this atomically (it also defeats the concurrent double-submit race a service
-- check alone cannot). A plan that later completes/defaults/cancels frees the
-- contract, so a customer can legitimately set up a fresh plan if one is ever
-- needed again.
--
-- ── Why step 1 exists ────────────────────────────────────────────────────
-- The header above says duplicates CAN exist in production. Creating the index
-- against that data raises 23505 and, because golang-migrate stamps
-- (version=69, dirty=true) BEFORE executing the file, the failure wedges the
-- whole pipeline: every subsequent `migrate up` refuses to run until a human
-- executes `migrate force 68` against prod. So the dedupe MUST ship inside this
-- migration — a later forward migration (075+) would never be reached, because
-- the chain stops here. This is the one case where editing an already-shipped
-- migration is correct: as written it is unrunnable anywhere duplicates exist,
-- so there is no "already applied" state to protect.

-- ── 1. Collapse pre-existing duplicate active plans ──────────────────────
-- Which plan survives is a MONEY decision, not a cosmetic one. Every one of
-- these plans already paid the provider in full at creation, and every one of
-- them has its own schedule in scheduled_installments that has been charging
-- the customer. Ranking rule, in order:
--
--   1. MOST installments already paid.  Cancelling a plan does not refund what
--      it collected — ProcessDueInstallments simply stops picking it up
--      (GetDueInstallments joins ON ip.status = 'active'). If we kept the
--      less-progressed plan, the customer would be re-charged from ITS schedule
--      for money they had already paid on the other one. Keeping the furthest-
--      along plan minimises both the stranded paid amount and the remaining
--      balance still to be collected.
--   2. Oldest created_at.  On a tie (the common double-submit case: two plans
--      seconds apart, nothing collected yet) the first submit is the legitimate
--      one; the later rows are the race artifacts, and its schedule starts
--      earliest so the contract finishes soonest.
--   3. id, purely for determinism.
--
-- Terminal status is 'cancelled', not 'defaulted': 'defaulted' asserts customer
-- non-payment and feeds trust/fraud surfaces. These duplicates are a platform
-- defect, and the customer must not be scored for it.
--
-- WHAT THIS MIGRATION CANNOT FIX — requires manual finance reconciliation:
--   * The provider was paid once PER PLAN. Cancelling the duplicate does not
--     claw back that transfer; the platform is out one payout per collapsed row.
--   * Any installment the customer already paid on a now-cancelled plan is a
--     real charge against a schedule that will never complete, and is owed back
--     as a refund.
-- installment_plans has no free-text audit column, so the affected rows are
-- identified after the fact by: status = 'cancelled' AND provider_paid_at IS
-- NOT NULL AND updated_at = this migration's run time, sharing a contract_id
-- with a surviving active plan.
--
-- The `dupes` CTE keeps the cost proportional to the damage: only contracts
-- that actually carry more than one active plan pay for the per-plan paid-count
-- subquery, so this stays cheap on a table where duplicates are rare.
WITH dupes AS (
    SELECT contract_id
      FROM installment_plans
     WHERE status = 'active'
     GROUP BY contract_id
    HAVING COUNT(*) > 1
),
ranked AS (
    SELECT ip.id,
           ROW_NUMBER() OVER (
               PARTITION BY ip.contract_id
               ORDER BY (
                           SELECT COUNT(*)
                             FROM scheduled_installments si
                            WHERE si.plan_id = ip.id
                              AND si.status = 'paid'
                        ) DESC,
                        ip.created_at ASC,
                        ip.id ASC
           ) AS rn
      FROM installment_plans ip
      JOIN dupes d ON d.contract_id = ip.contract_id
     WHERE ip.status = 'active'
)
UPDATE installment_plans ip
   SET status     = 'cancelled',
       updated_at = now()
  FROM ranked
 WHERE ip.id = ranked.id
   AND ranked.rn > 1;

-- Leftover scheduled_installments on the cancelled plans are intentionally left
-- as-is: scheduled_installments has no 'cancelled' status (021 allows only
-- scheduled/processing/paid/failed/retrying), and marking an uncollected row
-- 'failed' would falsely imply a declined card. They are inert because
-- GetDueInstallments requires ip.status = 'active'.

-- ── 2. Enforce one active plan per contract ──────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_installment_plans_active_per_contract
    ON installment_plans (contract_id)
    WHERE status = 'active';
