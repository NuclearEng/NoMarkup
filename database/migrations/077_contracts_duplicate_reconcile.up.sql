-- Migration 077 — collapse duplicate contracts per job. Data half of 078.
--
-- Builds on:
--   004 — contracts table
--
-- ── The money bug ────────────────────────────────────────────────────────
-- contracts has idx_contracts_job (NOT unique) and idx_contracts_job_status
-- (NOT unique). Nothing has ever stopped a job from carrying two contracts.
-- services/job/internal/repository/contract_repo.go CreateContract is a bare
-- INSERT, and gateway/internal/handler/bid.go:405-412 documents the recovery
-- path for a failed post-award contract creation as "re-call this endpoint".
-- Re-calling it after a contract WAS in fact created mints a SECOND contract
-- with its own contract_number, its own amount_cents, its own
-- customer_accepted/provider_accepted handshake, and — the expensive part — its
-- own payment/escrow lifecycle. The customer can be charged and put into escrow
-- twice for one job, and each contract independently drives payout, milestones,
-- installment plans and working-capital advances.
--
-- The in-repo pattern for the same shape of problem is listing_orders, which
-- carries a real UNIQUE(listing_id) and whose writer uses
-- ON CONFLICT (listing_id) DO NOTHING. 078 gives contracts the equivalent
-- index; this migration makes the existing data satisfy it.
--
-- OUT OF SCOPE (follow-up, NOT done here): CreateContract in
-- services/job/internal/repository/contract_repo.go is still a bare INSERT. It
-- will now fail with a 23505 unique violation instead of silently minting a
-- duplicate — which is the correct outcome — but it should be changed to
-- `ON CONFLICT DO NOTHING` + re-select (mirroring CloseListingAuction) so the
-- award path returns the existing contract and the gateway maps it to a 409
-- rather than a 500.

SET lock_timeout = '5s';

-- ── 1. Audit trail for what we retire ────────────────────────────────────
-- Nothing here is hard-deleted (payments, milestones, disputes,
-- installment_plans and working_capital_advances all carry contract_id FKs),
-- but "which contract did we void, and did it have money on it" must be
-- answerable afterwards without diffing a backup.
CREATE TABLE IF NOT EXISTS contract_duplicate_reconciliation (
    contract_id            UUID        PRIMARY KEY,
    job_id                 UUID        NOT NULL,
    kept_contract_id       UUID        NOT NULL,
    prior_status           TEXT        NOT NULL,
    amount_cents           BIGINT      NOT NULL,
    live_payment_count     INTEGER     NOT NULL,
    any_money_child        BOOLEAN     NOT NULL,
    requires_manual_review BOOLEAN     NOT NULL,
    reconciled_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE contract_duplicate_reconciliation IS
    'Contracts voided by migration 077 because their job already had a live contract. requires_manual_review = true means the voided contract still had money attached (payments/milestones/installment plans/advances) and finance must settle it by payment id.';

-- ── 2. Rank the duplicates. This is the money decision. ──────────────────
-- Only jobs that actually carry more than one LIVE contract are considered, so
-- the per-contract money subqueries stay cheap on a table where duplicates are
-- rare (same shape as 069's `dupes` CTE).
--
-- "Live" = deleted_at IS NULL AND status NOT IN ('cancelled','voided'). A
-- cancelled contract is a finished negotiation that legitimately frees the job
-- for a fresh award, exactly as a completed/cancelled installment plan frees a
-- contract in 069. Constraining those would break a real product path.
--
-- Ranking rule, in order — WHICH CONTRACT SURVIVES DECIDES WHERE MONEY LIVES:
--
--   1. MOST payments in a live money state ('pending','processing','escrow',
--      'disputed'). This is the one that must survive. Escrowed funds are
--      released through PaymentService.ReleaseEscrow, and everything upstream
--      of it — the customer's approve-completion button, the 7-day
--      auto-release sweeper (GetContractsAwaitingApproval), the dispute
--      surfaces — reaches the payment THROUGH the contract, filtering
--      `deleted_at IS NULL`. Voiding the contract that holds escrow would
--      strand that money: no UI path and no cron would ever release it to the
--      provider or refund it to the customer. Keeping it is the only choice
--      that does not orphan an escrow.
--   2. HAS any money child at all (payments in any state, milestones,
--      installment_plans, working_capital_advances). Same argument, one tier
--      weaker: a settled/refunded payment or a milestone schedule is history
--      that should stay reachable from a live contract.
--   3. MOST ADVANCED lifecycle status (completed > active > disputed >
--      suspended > abandoned > pending_acceptance). Where neither contract has
--      money, the one both parties actually acted on is the real agreement;
--      the other is the saga artifact.
--   4. EARLIEST created_at. In the common double-submit / re-call-the-endpoint
--      case nothing distinguishes the rows but order, and the first one is the
--      id the gateway already returned to the customer, the one referenced by
--      any notification already sent, and the one whose contract_number the
--      provider has seen.
--   5. id, purely for determinism.
--
-- WHAT THIS MIGRATION CANNOT FIX — requires manual finance reconciliation:
-- if BOTH duplicates carry money, the customer was charged twice for one job.
-- Voiding the loser does not refund it. Those rows land in
-- contract_duplicate_reconciliation with requires_manual_review = true, and
-- the money is still fully addressable BY PAYMENT ID (ReleaseEscrow and
-- CreateRefund take a payment id, not a contract id), so nothing is stranded
-- beyond reach — it is just no longer reachable through the voided contract.
-- Query the work list with:
--   SELECT * FROM contract_duplicate_reconciliation WHERE requires_manual_review;
--
-- This migration deliberately does NOT abort when it finds that case. Aborting
-- would leave golang-migrate stamped (version=77, dirty=true) — it stamps
-- BEFORE executing — and every later migration would be unreachable until a
-- human ran `migrate force 76` against production. A wedged pipeline is a
-- worse outcome than a flagged reconciliation queue.
DROP TABLE IF EXISTS _dup_contracts;
CREATE TEMP TABLE _dup_contracts AS
WITH live AS (
    SELECT c.id, c.job_id, c.status, c.amount_cents, c.created_at
      FROM contracts c
     WHERE c.deleted_at IS NULL
       AND c.status NOT IN ('cancelled', 'voided')
),
dupes AS (
    SELECT job_id FROM live GROUP BY job_id HAVING COUNT(*) > 1
),
scored AS (
    SELECT l.id, l.job_id, l.status, l.amount_cents, l.created_at,
           (SELECT COUNT(*) FROM payments p
             WHERE p.contract_id = l.id
               AND p.status IN ('pending','processing','escrow','disputed')
           ) AS live_payments,
           (
             EXISTS (SELECT 1 FROM payments p                 WHERE p.contract_id = l.id)
          OR EXISTS (SELECT 1 FROM milestones m               WHERE m.contract_id = l.id)
          OR EXISTS (SELECT 1 FROM installment_plans ip       WHERE ip.contract_id = l.id)
          OR EXISTS (SELECT 1 FROM working_capital_advances w WHERE w.contract_id = l.id)
           ) AS any_money,
           CASE l.status
               WHEN 'completed'           THEN 6
               WHEN 'active'              THEN 5
               WHEN 'disputed'            THEN 4
               WHEN 'suspended'           THEN 3
               WHEN 'abandoned'           THEN 2
               WHEN 'pending_acceptance'  THEN 1
               ELSE 0
           END AS status_rank
      FROM live l
      JOIN dupes d ON d.job_id = l.job_id
),
ranked AS (
    SELECT s.*,
           ROW_NUMBER() OVER (
               PARTITION BY s.job_id
               ORDER BY s.live_payments DESC,
                        s.any_money     DESC,
                        s.status_rank   DESC,
                        s.created_at    ASC,
                        s.id            ASC
           ) AS rn,
           FIRST_VALUE(s.id) OVER (
               PARTITION BY s.job_id
               ORDER BY s.live_payments DESC,
                        s.any_money     DESC,
                        s.status_rank   DESC,
                        s.created_at    ASC,
                        s.id            ASC
           ) AS keeper_id
      FROM scored s
)
SELECT id, job_id, keeper_id, status, amount_cents, live_payments, any_money
  FROM ranked
 WHERE rn > 1;

-- ── 3. Record the losers before touching them ────────────────────────────
INSERT INTO contract_duplicate_reconciliation
    (contract_id, job_id, kept_contract_id, prior_status, amount_cents,
     live_payment_count, any_money_child, requires_manual_review)
SELECT id, job_id, keeper_id, status, amount_cents,
       live_payments, any_money, any_money
  FROM _dup_contracts
    ON CONFLICT (contract_id) DO NOTHING;

-- ── 4. Void + soft-delete the losers ─────────────────────────────────────
-- 'voided' (not 'cancelled') is the honest status: these contracts never
-- represented a separate agreement, they were a saga artifact. cancelled_by is
-- left NULL — no user did this, the platform did — and cancelled_at records
-- when. deleted_at is what actually removes them from every read path in
-- contract_repo.go, all of which filter `deleted_at IS NULL`.
UPDATE contracts c
   SET status              = 'voided',
       deleted_at          = now(),
       cancelled_at        = COALESCE(c.cancelled_at, now()),
       cancellation_reason = 'auto: duplicate contract for job (migration 077); kept ' || d.keeper_id::text,
       updated_at          = now()
  FROM _dup_contracts d
 WHERE c.id = d.id;

DROP TABLE IF EXISTS _dup_contracts;
