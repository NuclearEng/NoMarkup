-- Down for 075.
--
-- The schema half is reversible; the DATA half deliberately is not reverted.
--
-- Restoring the archived rows into advance_repayments would re-credit money the
-- platform never withheld, and re-adding it to working_capital_advances.
-- repaid_cents would forgive provider debt a second time — i.e. rolling back
-- would recreate the exact money bug the migration exists to fix. It would also
-- immediately violate 076's unique index if 076 is still applied.
--
-- The archive table is dropped so the rollback leaves no dangling object. The
-- rows it held are recoverable only from a database backup — which is the
-- correct bar for "undo a money correction". This mirrors 074's down, which
-- likewise refuses to resurrect the rows its up-migration retired.
--
-- Development only.

DROP TABLE IF EXISTS advance_repayment_duplicates;
