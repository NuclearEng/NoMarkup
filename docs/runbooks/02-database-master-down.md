# Runbook: PostgreSQL Master Down

> The primary Postgres instance is unreachable. Every write path is blocked:
> registration, job posting, bidding, payments, chat persistence.

## Symptoms

- Alert: `NoMarkupServiceDown` firing for `gateway` and most backend services simultaneously.
- Alert: `NoMarkupDBConnectionPoolExhausted` (P1) — usually fires first as services pile up retries.
- Logs:
  - `failed to connect to database: dial tcp <ip>:5432: connect: connection refused`
  - `pgxpool: failed to ping after 3 attempts`
  - `pgbouncer: server connection failed: server closed the connection unexpectedly`
- Customer-side: every write fails with 500. Reads may still work briefly via replica + cache.
- Provider-side: same.

## Diagnosis

1. **Identify primary instance health** (managed Postgres dashboard first, then network):
   ```bash
   # Managed (RDS / Cloud SQL): check provider console for "Available" status.
   # Self-hosted: check pod
   kubectl get pods -n nomarkup -l app=postgres-primary
   kubectl describe pod -n nomarkup postgres-primary-0
   ```

2. **Check network reachability from a pod that has psql:**
   ```bash
   kubectl exec -n nomarkup deployment/gateway -- timeout 5 nc -vz postgres-primary 5432
   # or
   kubectl exec -n nomarkup deployment/gateway -- pg_isready -h postgres-primary -p 5432
   ```

3. **Check disk / resource exhaustion:**
   ```bash
   kubectl exec -n nomarkup statefulset/postgres-primary -- df -h /var/lib/postgresql/data
   kubectl top pod -n nomarkup -l app=postgres-primary
   ```
   Postgres halts writes when the data volume is >95% full or WAL fills.

4. **Check replica lag** (to confirm a replica is fresh enough to promote):
   ```sql
   -- Run on a replica
   SELECT now() - pg_last_xact_replay_timestamp() AS replication_lag;
   ```
   < 5s is safe. > 5min and the failover loses data → restore from backup instead.

## Mitigation

### Path A: Brief network blip (master is alive, just unreachable)

1. Restart the affected gateway / service pods to drop stale connections:
   ```bash
   for svc in gateway user job payment chat notification; do
     kubectl rollout restart -n nomarkup deployment/$svc
   done
   ```
2. PgBouncer should auto-reconnect; if not, restart it too:
   ```bash
   kubectl rollout restart -n nomarkup deployment/pgbouncer
   ```

### Path B: Promote replica (master is dead)

1. Confirm replica lag is acceptable (see Diagnosis #4).
2. **Managed Postgres** (RDS / Cloud SQL):
   - Console → click instance → **Failover** / **Promote**.
   - Provider keeps the same DNS name; no app config change needed.
3. **Self-hosted Patroni / pg_auto_failover:**
   ```bash
   kubectl exec -n nomarkup statefulset/postgres-replica-0 -- patronictl failover
   # follow prompts; confirm new leader.
   ```
4. **No automation** (manual promote — rare):
   ```bash
   kubectl exec -n nomarkup statefulset/postgres-replica-0 -- pg_ctl promote
   # then update the Postgres Service selector to point to the replica:
   kubectl patch svc postgres-primary -n nomarkup -p '{"spec":{"selector":{"role":"replica","instance":"replica-0"}}}'
   ```
5. Restart all app services to pick up the new endpoint:
   ```bash
   for svc in gateway user job payment chat notification; do
     kubectl rollout restart -n nomarkup deployment/$svc
   done
   ```

### Path C: Restore from backup (replica also lost or stale)

This is the worst case — see `docs/operations/backup-disaster-recovery.md` for the full procedure. RPO target is 5 minutes (PITR); RTO target is 1 hour.

Brief outline:
1. Provision a fresh Postgres instance from the latest base backup + WAL up to the last clean LSN.
2. Run smoke checks (row counts on `users`, `jobs`, `bids`, `payments`).
3. Update Postgres Service selector to the new instance.
4. Restart all services.
5. Open an incident postmortem; flag any data loss windows for customer comms.

### Path D: Disk full

```bash
# Free WAL aggressively if archive shipping is healthy:
kubectl exec -n nomarkup statefulset/postgres-primary -- psql -U nomarkup -c "CHECKPOINT;"
kubectl exec -n nomarkup statefulset/postgres-primary -- psql -U nomarkup -c "SELECT pg_switch_wal();"
# If a runaway query bloated temp space, terminate it:
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
 WHERE temp_bytes > 1073741824 AND state = 'active';
```
Then resize the PVC (cloud) or attach a larger volume.

## Resolution

1. Verify all services have re-established connections:
   ```bash
   kubectl logs -n nomarkup deployment/gateway --tail=50 | grep -i "connected to database"
   ```
2. Verify PgBouncer pool is healthy:
   ```bash
   kubectl exec -it -n nomarkup deployment/pgbouncer -- psql -p 6432 pgbouncer -c "SHOW POOLS;"
   ```
3. Run a smoke-test write through the gateway (e.g. POST /api/v1/auth/register with a throwaway email).
4. Confirm `NoMarkupServiceDown` and `NoMarkupDBConnectionPoolExhausted` alerts clear.
5. Re-enable any traffic that was shed (Cloudflare maintenance page, rate limit emergency caps).

## Postmortem Template

```
## Incident: Postgres Primary Down YYYY-MM-DD
- Severity: P0
- Duration: HH:MM (first connect failure → all services healthy)
- Detection: alert / external monitoring / customer report
- Impact: N writes lost, M users affected, $X transactions in flight at moment of failure
- Root cause: <one sentence — disk full / OOM / network / hardware / corruption>
- Data loss: yes (window: HH:MM–HH:MM) / no
- Failover path used: A / B / C / D

### Timeline (UTC)
- HH:MM  First connection failure
- HH:MM  Alert fired
- HH:MM  On-call ack
- HH:MM  Promote/restore initiated
- HH:MM  Services back online

### Action items
- [ ] Owner: <name> — <preventive change, e.g. add disk-full alert at 80%>
- [ ] Owner: <name> — <test failover quarterly>
```
