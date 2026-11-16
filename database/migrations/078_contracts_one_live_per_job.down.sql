-- Down for 078. Single statement, CONCURRENTLY — see 076's header.
--
-- Rolling this back reopens the duplicate-contract path: one job can again
-- carry two independent escrow lifecycles. Development only.
DROP INDEX CONCURRENTLY IF EXISTS uq_contracts_live_job;
