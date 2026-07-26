-- Down for 099. Clears the comments the up migration added.
--
-- None of those columns carried a COMMENT before 099 (012 documented them with
-- inline `--` SQL comments, which are discarded at parse time and never reach
-- pg_description), so NULL is the exact prior state.
--
-- Comment-only in both directions: no data is read, written or lost. Rolling
-- back restores the *misleading* situation 099 fixed — the schema stops warning
-- that ssn_last_four is plaintext — so do this only in development.

SET lock_timeout = '5s';

COMMENT ON COLUMN company_employees.ssn_last_four IS NULL;
COMMENT ON COLUMN company_employees.date_of_birth IS NULL;
COMMENT ON COLUMN company_employees.email IS NULL;
COMMENT ON COLUMN company_employees.phone IS NULL;
COMMENT ON TABLE company_employees IS NULL;
