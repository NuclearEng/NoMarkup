-- Down for 082 — demote the non-negativity constraints back to NOT VALID.
--
-- PostgreSQL has no `ALTER TABLE ... INVALIDATE CONSTRAINT`; the only way to
-- undo a VALIDATE is to drop the constraint and re-add it NOT VALID. Doing that
-- from pg_constraint (rather than a hardcoded list) keeps this file correct
-- even if 080's set changes, and reuses each constraint's own definition via
-- pg_get_constraintdef so the expression cannot drift.
--
-- This leaves the constraints in place and still enforced on new writes — it
-- only clears the "every existing row has been checked" flag, which is exactly
-- the state 080 left behind. Dropping them entirely is 080's down.
--
-- Locking note: DROP + ADD each take ACCESS EXCLUSIVE, held until this
-- transaction commits. That is a brief full lock across all listed tables, and
-- it is acceptable here only because downs are development-only in this repo
-- (CLAUDE.md §5: forward-only in production).

SET lock_timeout = '5s';

DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT conrelid::regclass::text AS tbl,
               conname::text            AS name,
               pg_get_constraintdef(oid) AS def
          FROM pg_constraint
         WHERE contype = 'c'
           AND connamespace = 'public'::regnamespace
           AND conname LIKE 'ck\_%\_nonneg'
           AND convalidated
         ORDER BY 1, 2
    LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', c.tbl, c.name);
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s NOT VALID',
                       c.tbl, c.name, c.def);
    END LOOP;
END
$$;
