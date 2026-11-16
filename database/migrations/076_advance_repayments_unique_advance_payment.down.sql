-- Down for 076. Single statement, CONCURRENTLY, for the same reason the up is
-- (see its header): DROP INDEX CONCURRENTLY also cannot run in a transaction
-- block, and this file is executed as one simple query by golang-migrate.
--
-- Rolling this back reopens the double-credit path described in 075.
-- Development only.
DROP INDEX CONCURRENTLY IF EXISTS uq_advance_repayments_advance_payment;
