-- 137: request-path session timeouts become role-level defaults.
--
-- The Go services used to send statement_timeout, lock_timeout and
-- idle_in_transaction_session_timeout in the connection startup packet.
-- PgBouncer refuses startup parameters it does not track ("unsupported startup
-- parameter", SQLSTATE 08P01), and once told to ignore them it never forwards
-- them, so behind the pooler lock_timeout was not enforced at all. Production
-- pools in transaction mode, where a SET after connect does not hold either.
--
-- A role default is applied by Postgres to every session of the role, pooled
-- or direct, so the services no longer send the parameters
-- (*/internal/observability/postgres.go) and verify the effective values at
-- startup instead. Values match the RES-02 defaults: 10s / 3s / 30s.
--
-- Scope: the role running this migration (the DATABASE_URL role, which is the
-- application role in every deployment in this repo), in this database only.
-- If the application connects as a DIFFERENT role, run the three ALTER ROLE
-- statements for that role by hand (docs/operations/pgbouncer.md); the
-- services log an error at startup until that is done.
--
-- Consequences for other sessions of the same role:
--   * Later migrations inherit these. One that needs longer (index build,
--     backfill) starts with: SET statement_timeout = 0; SET lock_timeout = 0;
--   * Batch tools opt out in their startup packet (BatchPoolSettings,
--     database/cmd/encrypt-pii) and must connect to Postgres directly.
--   * pg_dump resets both timeouts itself.
-- Sessions already open keep their old values until they reconnect.
DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I IN DATABASE %I SET statement_timeout = %L',
                 current_user, current_database(), '10s');
  EXECUTE format('ALTER ROLE %I IN DATABASE %I SET lock_timeout = %L',
                 current_user, current_database(), '3s');
  EXECUTE format('ALTER ROLE %I IN DATABASE %I SET idle_in_transaction_session_timeout = %L',
                 current_user, current_database(), '30s');
END
$$;
