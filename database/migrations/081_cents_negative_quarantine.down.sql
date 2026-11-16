-- Down for 081. Restores every clamped value from the quarantine table.
--
-- ── Why the constraints are dropped and re-added around the restore ──────
-- The values being written back are negative, and 080's CHECK constraints are
-- still attached at this point (migrate runs downs in descending order: 082's
-- down has demoted them to NOT VALID, but 080's down — which removes them — has
-- not run yet). A NOT VALID constraint is still enforced on every write, so a
-- naive restore fails with 23514 on the first row.
--
-- So this file drops each ck_%_nonneg constraint, restores, then re-adds it
-- exactly as it was (NOT VALID, definition taken from pg_get_constraintdef so
-- the expression cannot drift). Net effect on the schema: unchanged — the
-- constraints end up in precisely the state 080 left them in, which is what
-- 080's down expects to find. Net effect on the data: fully reverted.
--
-- Rolling this back reintroduces negative money into the tables. Development
-- only (CLAUDE.md §5: migrations are forward-only in production).

SET lock_timeout = '5s';

DO $$
DECLARE
    saved   JSONB := '[]'::jsonb;
    c       RECORD;
    q       RECORD;
    pk_expr TEXT;
    entry   JSONB;
BEGIN
    IF to_regclass('public.negative_cents_quarantine') IS NULL THEN
        RETURN;
    END IF;

    -- 1. Detach the non-negativity constraints, remembering their definitions.
    FOR c IN
        SELECT conrelid::regclass::text  AS tbl,
               conname::text             AS name,
               pg_get_constraintdef(oid) AS def
          FROM pg_constraint
         WHERE contype = 'c'
           AND connamespace = 'public'::regnamespace
           AND conname LIKE 'ck\_%\_nonneg'
         ORDER BY 1, 2
    LOOP
        saved := saved || jsonb_build_object('tbl', c.tbl, 'name', c.name, 'def', c.def);
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', c.tbl, c.name);
    END LOOP;

    -- 2. Write the original values back.
    FOR q IN SELECT * FROM negative_cents_quarantine LOOP
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
         WHERE pc.conrelid = q.table_name::regclass
           AND pc.contype  = 'p';

        pk_expr := COALESCE(pk_expr, 'ctid::text');

        EXECUTE format('UPDATE %I SET %I = $1 WHERE (%s) = $2',
                       q.table_name, q.column_name, pk_expr)
          USING q.old_value, q.row_key;
    END LOOP;

    -- 3. Re-attach every constraint exactly as it was, NOT VALID.
    FOR entry IN SELECT * FROM jsonb_array_elements(saved) LOOP
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s NOT VALID',
                       entry->>'tbl', entry->>'name', entry->>'def');
    END LOOP;
END
$$;

DROP TABLE IF EXISTS negative_cents_quarantine;
