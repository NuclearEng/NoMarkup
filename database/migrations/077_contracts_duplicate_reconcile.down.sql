-- Down for 077.
--
-- Un-voids the contracts this migration retired, using its own audit table as
-- the source of truth, then drops the audit table. This one IS reversible
-- (unlike 075's) because nothing was deleted and the prior status was
-- recorded — restoring is a status/deleted_at flip, not a money movement.
--
-- Order matters: the restore must run BEFORE the audit table is dropped, and
-- 078's partial unique index must already be gone (migrate runs downs in
-- descending order, so 078.down has executed by the time this file runs).
-- Restoring while that index still existed would raise 23505.
--
-- Not restored: cancelled_at. The up-migration set it with COALESCE, so a row
-- that already carried a cancellation timestamp is indistinguishable from one
-- that did not. Leaving a stale cancelled_at on an un-voided contract is inert
-- (every read path keys off status/deleted_at), whereas clearing it would
-- destroy a real timestamp on the rows that had one.
--
-- Rolling this back reinstates the duplicate contracts — a job can again carry
-- two independent escrow lifecycles. Development only.

UPDATE contracts c
   SET status              = r.prior_status,
       deleted_at          = NULL,
       cancellation_reason = NULL,
       updated_at          = now()
  FROM contract_duplicate_reconciliation r
 WHERE c.id = r.contract_id
   AND c.status = 'voided';

DROP TABLE IF EXISTS contract_duplicate_reconciliation;
