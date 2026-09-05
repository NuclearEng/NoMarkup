-- Migration 075 — reconcile double-credited working-capital advance repayments.
--
-- Builds on:
--   049 — working_capital_advances + advance_repayments creation
--
-- ── The money bug ────────────────────────────────────────────────────────
-- advance_repayments had NO uniqueness on (advance_id, payment_id): the only
-- indexes were the PK on id and a non-unique idx_advance_repayments_advance.
-- PaymentService.ReleaseEscrow (services/payment/internal/service/service.go)
-- can legitimately re-enter the repayment loop for a payment it has ALREADY
-- deducted from:
--
--   1. Release #1 CAS-claims the payment escrow→released, computes a deduction
--      R = 20% of provider_payout_cents (capped at the advance's outstanding
--      balance), inserts advance_repayments(advance, payment, R) and does
--      `repaid_cents = repaid_cents + R` with NO cap in the WHERE clause.
--   2. It then creates the Stripe transfer for (payout - R) and crashes before
--      UpdateStripeFields stamps stripe_transfer_id.
--   3. Release #2 (retry / cron / manual) sees status='released' with an empty
--      stripe_transfer_id, sets resume=true, SKIPS the CAS claim and falls
--      straight back into the repayment loop. It recomputes R' from the NEW
--      repaid_cents and increments AGAIN.
--   4. Stripe dedupes the transfer on the deterministic idempotency key
--      "escrow-release:<paymentID>" and returns the ORIGINAL transfer — so only
--      R was ever actually withheld from the provider.
--
-- Net effect: the ledger credits R + R' against the advance while the platform
-- only ever held back R. The provider's advance is forgiven faster than cash is
-- taken, and the platform eats the difference. Every extra retry compounds it.
--
-- The Go-side fixes ship alongside this migration:
--   * repository/advance.go — INSERT ... ON CONFLICT (advance_id, payment_id)
--     DO NOTHING with the insert's RowsAffected gating the UPDATE, plus the
--     `repaid_cents + $2 <= advance_amount_cents + fee_cents` cap guard in the
--     WHERE clause (the pattern already proven at
--     gateway/internal/handler/working_capital.go:386).
--   * service/service.go — accounts for what was ACTUALLY applied by diffing
--     the returned advance's repaid_cents, instead of assuming its own
--     requested deduction landed.
--
-- This migration is the data half: it repairs rows the old code already
-- corrupted so migration 076 can build the unique index without a 23505.
-- Splitting the repair (here, plain DML) from the index build (076,
-- CONCURRENTLY) is deliberate — CREATE INDEX CONCURRENTLY cannot share a file
-- with any other statement under golang-migrate; see 076's header.

-- Never let this migration sit behind a lock storm during a deploy: the
-- migrate Job has activeDeadlineSeconds: 600 and golang-migrate stamps
-- dirty=true BEFORE running, so a lock wait that outlives the Job wedges the
-- whole pipeline until a human runs `migrate force 74`.
SET lock_timeout = '5s';

-- ── 1. Preserve the rows we are about to remove ──────────────────────────
-- advance_repayments is a money ledger. Collapsing duplicates DELETEs rows, and
-- a deleted money row with no trace is not acceptable — finance needs to be
-- able to reconstruct what the platform believed at the time. The table has no
-- soft-delete column and amount_cents CHECK (amount_cents > 0) rules out
-- zeroing the row in place, so the surviving record is an archive table.
CREATE TABLE IF NOT EXISTS advance_repayment_duplicates (
    id                 UUID        PRIMARY KEY,
    advance_id         UUID        NOT NULL,
    payment_id         UUID        NOT NULL,
    amount_cents       BIGINT      NOT NULL,
    original_created_at TIMESTAMPTZ NOT NULL,
    collapsed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason             TEXT        NOT NULL
);

COMMENT ON TABLE advance_repayment_duplicates IS
    'Archive of duplicate (advance_id, payment_id) advance_repayments rows removed by migration 075. Each row is a repayment the ledger credited but that no cash movement backs — see the migration header.';

CREATE INDEX IF NOT EXISTS idx_advance_repayment_duplicates_advance
    ON advance_repayment_duplicates (advance_id);

-- ── 2. Identify the duplicates ───────────────────────────────────────────
-- Keep the EARLIEST row per (advance_id, payment_id). Ordering rule:
--   1. created_at ASC — the first insert is the one whose deduction actually
--      shaped the Stripe transfer amount that was paid out. Every later row is
--      an artifact of a resume that Stripe deduped away, so it corresponds to
--      no withheld cash.
--   2. id ASC purely for determinism when created_at ties (now() is per-
--      statement, so two inserts inside one transaction share a timestamp).
--
-- Deliberately NOT "keep the largest": amount size is irrelevant to which
-- deduction was real, and picking the largest would keep the row that credits
-- the MOST money the platform never withheld.
-- Plain TEMP TABLE (not ON COMMIT DROP) with an explicit DROP at the end, so
-- this file behaves identically whether golang-migrate runs it as one implicit
-- transaction or a human runs it statement-by-statement through psql.
DROP TABLE IF EXISTS _dup_repayments;
CREATE TEMP TABLE _dup_repayments AS
WITH dupes AS (
    SELECT advance_id, payment_id
      FROM advance_repayments
     GROUP BY advance_id, payment_id
    HAVING COUNT(*) > 1
),
ranked AS (
    SELECT ar.id, ar.advance_id, ar.payment_id, ar.amount_cents, ar.created_at,
           ROW_NUMBER() OVER (
               PARTITION BY ar.advance_id, ar.payment_id
               ORDER BY ar.created_at ASC, ar.id ASC
           ) AS rn
      FROM advance_repayments ar
      JOIN dupes d
        ON d.advance_id = ar.advance_id
       AND d.payment_id = ar.payment_id
)
SELECT id, advance_id, payment_id, amount_cents, created_at
  FROM ranked
 WHERE rn > 1;

-- ── 3. Archive, then delete ──────────────────────────────────────────────
INSERT INTO advance_repayment_duplicates
    (id, advance_id, payment_id, amount_cents, original_created_at, reason)
SELECT id, advance_id, payment_id, amount_cents, created_at,
       'migration 075: duplicate (advance_id, payment_id) — ledger credit with no matching cash withholding'
  FROM _dup_repayments
    ON CONFLICT (id) DO NOTHING;

DELETE FROM advance_repayments ar
 USING _dup_repayments d
 WHERE ar.id = d.id;

-- ── 4. Roll the phantom credit back out of the advance ───────────────────
-- repaid_cents was incremented once per duplicate row. Subtract exactly the
-- archived total, then clamp at 0 — a negative outstanding balance is not a
-- state any downstream reader (GetActiveAdvancesForProvider, the underwriting
-- engine's headroom calc) is written to handle. GREATEST() also makes this
-- statement safe to re-run.
UPDATE working_capital_advances wca
   SET repaid_cents = GREATEST(0, wca.repaid_cents - agg.phantom_cents),
       updated_at   = now()
  FROM (
        SELECT advance_id, SUM(amount_cents) AS phantom_cents
          FROM _dup_repayments
         GROUP BY advance_id
       ) AS agg
 WHERE wca.id = agg.advance_id;

-- ── 5. Recompute the derived status/repaid_at for the touched advances ───
-- An advance that the phantom credit pushed to 'repaid' must go back to
-- 'repaying' (or 'disbursed' if nothing legitimate was ever collected),
-- otherwise the provider keeps a forgiven balance they still owe.
--
-- 'defaulted' and 'rejected' are terminal judgements a human or the
-- underwriting engine made about the borrower; this migration must not
-- overwrite them. 'requested'/'approved' pre-date disbursement and cannot
-- carry repayments at all.
UPDATE working_capital_advances wca
   SET status = CASE
           WHEN wca.repaid_cents >= wca.advance_amount_cents + wca.fee_cents
               THEN 'repaid'
           WHEN wca.repaid_cents > 0 THEN 'repaying'
           ELSE 'disbursed'
       END,
       repaid_at = CASE
           WHEN wca.repaid_cents >= wca.advance_amount_cents + wca.fee_cents
               THEN COALESCE(wca.repaid_at, now())
           ELSE NULL
       END,
       updated_at = now()
 WHERE wca.id IN (SELECT DISTINCT advance_id FROM _dup_repayments)
   AND wca.status IN ('disbursed', 'repaying', 'repaid');

-- ── 6. Clamp any pre-existing over-repayment ─────────────────────────────
-- The old UPDATE had no cap in its WHERE, so repaid_cents could also exceed
-- the total owed without any duplicate row being involved (two concurrent
-- releases against different payments both reading a stale balance). 076's
-- unique index cannot catch that; only the new Go cap guard can prevent it
-- going forward, and this statement squares the existing rows.
UPDATE working_capital_advances
   SET repaid_cents = advance_amount_cents + fee_cents,
       status       = 'repaid',
       repaid_at    = COALESCE(repaid_at, now()),
       updated_at   = now()
 WHERE repaid_cents > advance_amount_cents + fee_cents
   AND status IN ('disbursed', 'repaying', 'repaid');

DROP TABLE IF EXISTS _dup_repayments;
