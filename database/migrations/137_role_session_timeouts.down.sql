-- 137 down: remove the role-level session timeouts. The services then run
-- with no server-side timeouts (and log an error saying so) unless they are
-- started with DB_TIMEOUTS_IN_STARTUP_PACKET=true on a direct connection.
DO $$
BEGIN
  EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET statement_timeout',
                 current_user, current_database());
  EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET lock_timeout',
                 current_user, current_database());
  EXECUTE format('ALTER ROLE %I IN DATABASE %I RESET idle_in_transaction_session_timeout',
                 current_user, current_database());
END
$$;
