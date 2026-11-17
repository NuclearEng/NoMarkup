# PgBouncer in front of Postgres

PgBouncer in **transaction** pool mode is mandatory in production
([`scaling-blockers.md`](scaling-blockers.md)). This repo defines one pooler,
for local development and CI: the `pgbouncer` service in `docker-compose.yml`.
**There is no production or staging pooler definition in the repo** —
`deploy/k8s` expects an external managed database behind the `DATABASE_URL`
secret, `deploy/prod/docker-compose.yml` connects to Postgres directly, and
`deploy/terraform` is a skeleton. Whoever provisions the production pooler
configures it from this page.

## Required configuration

`pgbouncer.ini`, `[pgbouncer]` section:

```ini
pool_mode = transaction
ignore_startup_parameters = extra_float_digits,statement_timeout,lock_timeout,idle_in_transaction_session_timeout
query_timeout = 15
idle_transaction_timeout = 30
```

With the `edoburu/pgbouncer` image the same settings are the environment
variables `POOL_MODE`, `IGNORE_STARTUP_PARAMETERS`, `QUERY_TIMEOUT` and
`IDLE_TRANSACTION_TIMEOUT`. A managed pooler (RDS Proxy, Supabase, PgCat)
needs no equivalent of `ignore_startup_parameters`: the services do not send
those parameters.

| Setting | Why |
|---|---|
| `ignore_startup_parameters` | Guard only. Request-path pools send none of the three timeouts. A `DATABASE_URL` that pins one, or `DB_TIMEOUTS_IN_STARTUP_PACKET=true`, would otherwise be refused (see Symptom). Ignored parameters are dropped, not forwarded. |
| `query_timeout = 15` | Backstop if the role defaults are missing. Above the 10 s `statement_timeout` so Postgres cancels the statement cleanly first; PgBouncer's timeout drops the server connection. |
| `idle_transaction_timeout = 30` | Backstop for `idle_in_transaction_session_timeout`. |
| (none) | PgBouncer has no `lock_timeout`. Only the role default provides it. |

## Where the timeouts come from

Migration `137_role_session_timeouts` sets them as defaults of the database
role, for the application database:

| Setting | Value |
|---|---|
| `statement_timeout` | 10 s |
| `lock_timeout` | 3 s |
| `idle_in_transaction_session_timeout` | 30 s |

Postgres applies a role default to every session of that role, including each
server connection the pooler opens, so it holds in every pool mode.

Why not the other two ways:

- **Startup parameters** (the previous design). PgBouncer refuses a startup
  parameter it does not track; with the ignore list it accepts the connection
  and discards the value. Behind the pooler `lock_timeout` was therefore not
  enforced at all.
- **`SET` after connect.** In transaction mode a session `SET` lands on the
  server connection that ran that statement, is absent for the next
  transaction, and leaks to the next client given that server connection.

The migration targets the role that runs it. **If the application connects as
a different role than the migration job, set the defaults for the application
role by hand:**

```sql
ALTER ROLE <app role> IN DATABASE <db> SET statement_timeout = '10s';
ALTER ROLE <app role> IN DATABASE <db> SET lock_timeout = '3s';
ALTER ROLE <app role> IN DATABASE <db> SET idle_in_transaction_session_timeout = '30s';
```

A role default binds when a session starts. After applying the migration or
the statements above, recycle the pooler's server connections (PgBouncer admin
console: `RECONNECT;`) or wait for `server_lifetime` (default 1 h); the
services' own connections recycle within 30 minutes.

## Verify

One command, through the pooler, as the application role:

```bash
psql "$DATABASE_URL" -Atc "SELECT current_setting('statement_timeout'), current_setting('lock_timeout'), current_setting('idle_in_transaction_session_timeout')"
# expected: 10s|3s|30s
```

`0` in any column means that timeout is not enforced.

Each service checks the same thing on the first connection of every pool and
logs the result:

```bash
kubectl logs -n nomarkup deployment/<service> | grep "postgres session timeout"
```

| Log line | Meaning |
|---|---|
| `postgres session timeouts in effect` (info) | All three bounds are enforced. |
| `postgres session timeout is NOT in effect` (error) | The role default is missing for the role in `DATABASE_URL`. Apply migration 137 or the `ALTER ROLE` statements above. The service keeps running, unbounded. |
| `postgres session timeout is looser than this service expects` (warn) | The role default is larger than `DB_*_TIMEOUT`. Change the role default. |
| `postgres session timeout will cut this batch pool's statements` (error) | A batch command is connected through the pooler. Point it at Postgres directly. |

## Symptom: services cannot connect through the pooler

Service log, then exit 1; gateway `/readyz` stays 503:

```
pooler rejected a connection startup parameter (unsupported startup parameter: lock_timeout)
```

PgBouncer log:

```
FATAL: unsupported startup parameter: lock_timeout   (SQLSTATE 08P01)
```

Cause: the connection's startup packet carries a parameter the pooler does not
track. In order of likelihood:

1. `DATABASE_URL` contains `statement_timeout=`, `lock_timeout=`,
   `idle_in_transaction_session_timeout=` or `options=`. Remove it.
2. `DB_TIMEOUTS_IN_STARTUP_PACKET=true` is set on a service behind the pooler.
   Unset it.
3. A batch command (`reindex-listings`, `database/cmd/encrypt-pii`) is pointed
   at the pooler. These opt out of the role timeouts in their startup packet
   and must use the direct Postgres address.
4. A service image from before migration 137. Add the
   `ignore_startup_parameters` line above to the pooler.

This took down user, job, payment and notification in CI (run 43956991515)
until `docker-compose.yml` gained the ignore list (commit `e8d6c997`).

## Migrations and batch work

- Run migrations against Postgres directly, not through the pooler:
  golang-migrate holds a session advisory lock, which transaction pooling does
  not preserve.
- Migrations run as the application role and inherit its defaults. A migration
  that needs longer than 10 s per statement, or more than 3 s to get a lock,
  starts with `SET statement_timeout = 0; SET lock_timeout = 0;`.
- `pg_dump` resets `statement_timeout` and `lock_timeout` itself.
