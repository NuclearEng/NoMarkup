-- Migration 081 — reject negative money. Part 2 of 3: quarantine and repair.
--
-- 080 declared 59 `CHECK (col >= 0) NOT VALID` constraints, which stop NEW
-- negatives but deliberately do not look at existing rows. 082 will VALIDATE
-- them, and VALIDATE fails hard on any row that violates. This migration is
-- what makes 082 safe to run.
--
-- ── Why repair rather than abort ─────────────────────────────────────────
-- The alternative — RAISE EXCEPTION listing the offending rows so a human
-- fixes them — leaves golang-migrate stamped (version=81, dirty=true), because
-- it stamps BEFORE executing the file. Every later migration then becomes
-- unreachable until someone runs `migrate force 80` against production. A
-- schema hardening migration must not be able to wedge the deploy pipeline.
--
-- ── Why nothing is lost ──────────────────────────────────────────────────
-- Every value clamped here is first copied verbatim into
-- negative_cents_quarantine, together with the table, the column, and the row's
-- primary key rendered as text. Clamping to 0 does not recover money that was
-- mis-moved; it makes the ledger internally consistent and leaves finance an
-- exact list of what to reconcile:
--
--   SELECT * FROM negative_cents_quarantine ORDER BY table_name, column_name;
--
-- ── Why a DO block ───────────────────────────────────────────────────────
-- The repair is driven off pg_constraint rather than a hardcoded list of 59
-- table/column pairs: it finds every not-yet-validated `ck_%_nonneg` CHECK
-- created by 080 and derives the table and column from the constraint's own
-- conkey. That means this file cannot drift out of sync with 080, and a
-- constraint added by a later migration following the same naming convention is
-- picked up automatically. A DO block is a single statement, so it is safe
-- inside the implicit transaction golang-migrate wraps this file in.
--
-- ── Why the repair is per-TABLE, not per-column ──────────────────────────
-- A NOT VALID constraint is still enforced on every UPDATE of a row, including
-- an UPDATE that touches a different column. A payments row carrying BOTH
-- platform_fee_cents = -50000 and refund_amount_cents = -42 therefore cannot be
-- fixed one column at a time: clamping the fee rewrites the row, and the
-- refund constraint rejects the rewrite (verified — the first draft of this
-- migration failed exactly there with 23514 on
-- ck_payments_refund_amount_cents_nonneg). So every constrained column on a
-- table is clamped in ONE statement, and the row goes from fully-violating to
-- fully-valid in a single write.
--
-- Locking: the UPDATEs take ROW EXCLUSIVE (writers on the same rows block,
-- readers do not). Tables with no negative rows — which should be all of them
-- on a healthy database — match zero rows on the `WHERE col < 0 OR ...` guard,
-- which is index-free but runs once per table and is the price of correctness.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS negative_cents_quarantine (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name     TEXT        NOT NULL,
    column_name    TEXT        NOT NULL,
    row_key        TEXT        NOT NULL,
    old_value      BIGINT      NOT NULL,
    migration      TEXT        NOT NULL DEFAULT '081',
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE negative_cents_quarantine IS
    'Original values of negative *_cents columns clamped to 0 by migration 081 so the non-negativity constraints declared in 080 could be validated in 082. row_key is the source row primary key rendered as text. Each row is a finance reconciliation item.';

CREATE INDEX IF NOT EXISTS idx_negative_cents_quarantine_table
    ON negative_cents_quarantine (table_name, column_name);

DO $$
DECLARE
    t          RECORD;
    c          RECORD;
    pk_expr    TEXT;
    set_list   TEXT;
    where_list TEXT;
    moved      BIGINT;
    fixed      BIGINT;
BEGIN
    -- Outer loop: one pass per TABLE that 080 constrained.
    FOR t IN
        SELECT con.conrelid,
               con.conrelid::regclass::text AS tbl
          FROM pg_constraint con
         WHERE con.contype = 'c'
           AND con.connamespace = 'public'::regnamespace
           AND con.conname LIKE 'ck\_%\_nonneg'
           AND NOT con.convalidated
           AND array_length(con.conkey, 1) = 1
         GROUP BY 1, 2
         ORDER BY 2
    LOOP
        -- Render the row's identity. Composite primary keys (e.g.
        -- seller_metrics_daily is keyed on user_id + metric_date) are joined
        -- with ':'. A table with no primary key falls back to ctid, which is
        -- only stable until the next VACUUM but is still enough to correlate
        -- against a backup taken at deploy time.
        SELECT COALESCE(
                   string_agg(format('%I::text', pa.attname), ' || '':'' || '
                              ORDER BY k.ord),
                   'ctid::text')
          INTO pk_expr
          FROM pg_constraint pc
          JOIN LATERAL unnest(pc.conkey) WITH ORDINALITY k(attnum, ord) ON true
          JOIN pg_attribute pa
            ON pa.attrelid = pc.conrelid
           AND pa.attnum   = k.attnum
         WHERE pc.conrelid = t.conrelid
           AND pc.contype  = 'p';

        pk_expr    := COALESCE(pk_expr, 'ctid::text');
        set_list   := NULL;
        where_list := NULL;

        -- Inner loop: quarantine each constrained column's negatives, and
        -- accumulate the SET/WHERE fragments for the single repair statement.
        FOR c IN
            SELECT a.attname::text AS col
              FROM pg_constraint con
              JOIN pg_attribute a
                ON a.attrelid = con.conrelid
               AND a.attnum   = con.conkey[1]
             WHERE con.conrelid = t.conrelid
               AND con.contype  = 'c'
               AND con.conname LIKE 'ck\_%\_nonneg'
               AND NOT con.convalidated
               AND array_length(con.conkey, 1) = 1
             ORDER BY 1
        LOOP
            EXECUTE format(
                'INSERT INTO negative_cents_quarantine
                     (table_name, column_name, row_key, old_value)
                 SELECT %L, %L, %s, %I FROM %I WHERE %I < 0',
                t.tbl, c.col, pk_expr, c.col, t.tbl, c.col);

            GET DIAGNOSTICS moved = ROW_COUNT;
            IF moved > 0 THEN
                RAISE NOTICE 'migration 081: quarantined % negative value(s) from %.%',
                             moved, t.tbl, c.col;
            END IF;

            set_list   := concat_ws(', ',   set_list,
                                    format('%I = GREATEST(%I, 0)', c.col, c.col));
            where_list := concat_ws(' OR ', where_list,
                                    format('%I < 0', c.col));
        END LOOP;

        IF set_list IS NOT NULL THEN
            EXECUTE format('UPDATE %I SET %s WHERE %s',
                           t.tbl, set_list, where_list);
            GET DIAGNOSTICS fixed = ROW_COUNT;
            IF fixed > 0 THEN
                RAISE NOTICE 'migration 081: clamped % row(s) in %', fixed, t.tbl;
            END IF;
        END IF;
    END LOOP;
END
$$;
