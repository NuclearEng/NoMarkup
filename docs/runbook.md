# NoMarkup Incident Response Runbook

> For each alert: what it means, first response steps, escalation path.

---

## On-Call Structure

| Role | Contact | Hours |
|------|---------|-------|
| Primary on-call (Platform) | `#oncall-platform` Slack channel | 24/7 rotation |
| Secondary (Engines) | `#oncall-engines` Slack channel | 24/7 rotation |
| Payments escalation | `#team-payments` Slack channel | Business hours, pager after hours |
| Trust & Safety | `#team-trust-safety` Slack channel | Business hours |
| Security | `#security-incidents` Slack channel | 24/7 pager |

**Escalation timeline:**
- P0: Acknowledge within 5 min. Incident channel created automatically. Page secondary if no ack in 10 min.
- P1: Acknowledge within 15 min. Investigate within 30 min.
- P2: Acknowledge within 1 hour. Investigate next business day.

---

## Common Troubleshooting Commands

```bash
# Check pod status in the nomarkup namespace
kubectl get pods -n nomarkup -o wide

# View logs for a specific service (last 100 lines, follow)
kubectl logs -n nomarkup deployment/gateway --tail=100 -f

# Describe a pod to see events, restart reasons, resource usage
kubectl describe pod -n nomarkup <pod-name>

# Check recent events (sorted by time)
kubectl get events -n nomarkup --sort-by='.lastTimestamp' | tail -30

# Port-forward to Prometheus for local queries
kubectl port-forward -n monitoring svc/prometheus 9090:9090

# Check current Prometheus alerts
curl -s http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | {alertname: .labels.alertname, state: .state}'

# Check PgBouncer pool status
kubectl exec -n nomarkup deployment/pgbouncer -- pgbouncer -d /etc/pgbouncer/pgbouncer.ini -R
# or connect directly:
kubectl exec -it -n nomarkup deployment/pgbouncer -- psql -p 6432 pgbouncer -c "SHOW POOLS;"

# Check PostgreSQL active queries
kubectl exec -it -n nomarkup statefulset/postgres -- psql -U nomarkup -c \
  "SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
   FROM pg_stat_activity WHERE state != 'idle' ORDER BY duration DESC LIMIT 10;"

# Kill a runaway PostgreSQL query
kubectl exec -it -n nomarkup statefulset/postgres -- psql -U nomarkup -c \
  "SELECT pg_terminate_backend(<pid>);"

# Check Redis info
kubectl exec -it -n nomarkup deployment/redis -- redis-cli INFO | grep -E "connected_clients|used_memory_human|instantaneous_ops"

# Restart a deployment (rolling)
kubectl rollout restart -n nomarkup deployment/<service-name>

# Scale a deployment
kubectl scale -n nomarkup deployment/<service-name> --replicas=<count>

# Check Stripe webhook status (requires Stripe CLI)
stripe events list --limit 10
stripe logs tail
```

---

## Alert Playbooks

### NoMarkupGatewayDown (P0 Critical)

**What it means:** The API gateway has zero healthy pods. All HTTP traffic to the platform is blocked. This is a total outage.

**First response:**
1. Check gateway pod status: `kubectl get pods -n nomarkup -l app.kubernetes.io/name=gateway`
2. Look at pod events: `kubectl describe pod -n nomarkup -l app.kubernetes.io/name=gateway`
3. Check recent logs from the previous pod: `kubectl logs -n nomarkup -l app.kubernetes.io/name=gateway --previous --tail=200`
4. Common causes:
   - OOM kill: check `kubectl describe pod` for `OOMKilled` reason. Increase memory limits.
   - Config/secret mount failure: check if `nomarkup-secrets` and `nomarkup-config` exist.
   - Downstream service unavailability causing crash: check if gateway panics on startup when a backend is unreachable.
5. If pods are in CrashLoopBackOff, try rolling back: `kubectl rollout undo -n nomarkup deployment/gateway`

**Escalation:** If not resolved in 10 min, page secondary on-call and engineering lead.

---

### NoMarkupServiceDown (P0 Critical)

**What it means:** A backend service (user, job, payment, chat, bidding, fraud, trust, imaging, notification) has zero healthy pods.

**First response:**
1. Identify which service: check the `deployment` label in the alert.
2. Same steps as GatewayDown but for the specific service.
3. Assess blast radius:
   - `user` down: login/registration broken, all auth-dependent operations fail.
   - `job` down: job creation/search broken.
   - `payment` down: all payment operations fail, but existing jobs continue.
   - `bidding` down: live auctions stall, new bids rejected.
   - `chat` down: messaging unavailable, WebSocket connections drop.
4. Check if the issue is related to a shared dependency (Postgres, Redis, PgBouncer).

**Escalation:** If shared infrastructure (DB, Redis), page platform team lead immediately.

---

### NoMarkupHighErrorRate (P0 Critical)

**What it means:** More than 1% of all HTTP requests are returning 5xx status codes, sustained for 5 minutes. The performance budget requires < 0.1%.

**First response:**
1. Identify which endpoints are failing:
   ```
   # In Prometheus or Grafana:
   topk(10, sum by (path, status) (rate(http_requests_total{status=~"5.."}[5m])))
   ```
2. Check gateway logs for error patterns: `kubectl logs -n nomarkup deployment/gateway --tail=500 | grep -i error`
3. Check if a specific backend service is unhealthy (look for gRPC connection errors in gateway logs).
4. If errors are on a specific path, check the corresponding service logs.
5. Check if a recent deployment caused the regression: `kubectl rollout history -n nomarkup deployment/gateway`

**Escalation:** If error rate > 5% or not resolved in 15 min, page engineering lead.

---

### NoMarkupAuthFailureSpike (P0 Critical)

**What it means:** More than 50 failed authentication attempts per minute, sustained for 2 minutes. Likely a brute-force or credential stuffing attack.

**First response:**
1. Check if rate limiting is working: `kubectl logs -n nomarkup deployment/gateway --tail=200 | grep -i "rate limit"`
2. Identify source IPs if possible (check access logs or load balancer logs).
3. If a single IP/range, add a temporary block at the ingress/WAF level.
4. Verify legitimate users can still log in (the rate limiter should not block them).
5. Check if accounts are actually being compromised (look for successful logins from unusual IPs following the failures).

**Escalation:** Page security team immediately. If accounts are compromised, initiate incident response.

---

### NoMarkupWebhookSignatureFailures (P0 Critical)

**What it means:** Stripe webhook requests are failing signature verification. This blocks payment lifecycle events (charges, refunds, disputes).

**First response:**
1. Check if the Stripe webhook secret was recently rotated: compare `STRIPE_WEBHOOK_SECRET` env var against the Stripe Dashboard webhook settings.
2. Check Stripe Dashboard > Developers > Webhooks for delivery status.
3. Verify the webhook endpoint is receiving the raw request body (middleware must not parse it before signature verification).
4. If the secret was rotated, update the K8s secret and restart the payment service.
5. If the failures are from unknown sources (not Stripe IPs), this may be an attack. Block at WAF level.

**Escalation:** Page payments team. If payments are stalled, page engineering lead.

---

### NoMarkupHighLatencyP95 (P1 Warning)

**What it means:** 95th percentile API response time exceeds 500ms, sustained for 5 minutes. Performance budget is p95 < 200ms.

**First response:**
1. Identify slow endpoints:
   ```
   topk(10, histogram_quantile(0.95, sum by (le, path) (rate(http_request_duration_seconds_bucket[5m]))))
   ```
2. Check database query latency: look at `pg_stat_activity` for long-running queries.
3. Check Redis latency: `kubectl exec -it -n nomarkup deployment/redis -- redis-cli --latency`
4. Check if a service is CPU/memory constrained (correlate with resource alerts).
5. Check if there is unusual traffic volume (DDoS, bot scraping, legitimate traffic spike).

**Escalation:** If p95 > 2s for more than 15 min, escalate to P0.

---

### NoMarkupHighLatencyP99 (P1 Warning)

**What it means:** 99th percentile API response time exceeds 1s. Same investigation as P95 but more severe tail latency.

**First response:** Same as NoMarkupHighLatencyP95, plus:
1. Check for lock contention in PostgreSQL.
2. Check for garbage collection pauses in Go services (if GC metrics are exposed).
3. Look for network latency between services (check OpenTelemetry traces in Jaeger).

**Escalation:** If p99 > 5s for more than 10 min, escalate to P0.

---

### NoMarkupBidProcessingSlow (P1 Warning)

**What it means:** Bid processing p99 latency exceeds 5ms. The performance budget is p99 < 1ms. Live auctions may feel sluggish.

**First response:**
1. Check bidding engine logs: `kubectl logs -n nomarkup deployment/bidding --tail=200`
2. Check if the engine is CPU constrained (Rust services are CPU-sensitive).
3. Check database latency from the bidding engine (auction state reads/writes).
4. Check for lock contention if multiple bids are being processed concurrently.
5. Look at Jaeger traces for bid processing spans.

**Escalation:** Page engines team if not resolved in 15 min.

---

### NoMarkupHighCPU (P1 Warning)

**What it means:** A pod has been using >80% of its CPU limit for 10 minutes. Performance degradation is likely, and throttling may already be occurring.

**First response:**
1. Identify the pod and service from the alert labels.
2. Check if the service is under unusual load: `kubectl top pods -n nomarkup`
3. Check if horizontal pod autoscaling (HPA) is configured and if it has hit max replicas.
4. If the CPU spike is unexpected, check for:
   - Infinite loops or busy-waits in recent code changes.
   - A spike in traffic (check request rate metrics).
   - Background job processing (batch operations, reindexing).
5. Scale up if needed: `kubectl scale -n nomarkup deployment/<service> --replicas=<n>`

**Escalation:** If CPU is at limit and causing errors/timeouts, escalate to P0.

---

### NoMarkupHighMemory (P1 Warning)

**What it means:** A pod is using >85% of its memory limit. OOM kill is imminent if usage grows.

**First response:**
1. Check which container in the pod is consuming memory: `kubectl top pods -n nomarkup --containers`
2. Look for memory leak indicators:
   - Is memory monotonically increasing? (Check Grafana memory graph over 24h.)
   - Was there a recent deployment? (Check `kubectl rollout history`.)
3. For Go services: check goroutine count if exposed via pprof (`/debug/pprof/goroutine`).
4. For Rust services: check if there is unbounded caching or buffering.
5. Immediate mitigation: restart the pod (`kubectl delete pod -n nomarkup <pod-name>`) to reclaim memory while investigating.

**Escalation:** If OOM kills are recurring, file a P1 bug for memory leak investigation.

---

### NoMarkupPodRestartLoop (P1 Warning)

**What it means:** A pod has restarted more than 3 times in 15 minutes. It is likely in CrashLoopBackOff.

**First response:**
1. Check pod status: `kubectl get pod -n nomarkup <pod-name> -o yaml | grep -A5 containerStatuses`
2. Check the reason for the last restart: look at `lastState.terminated.reason` (OOMKilled, Error, etc.)
3. Check logs from the previous instance: `kubectl logs -n nomarkup <pod-name> --previous --tail=200`
4. Common causes:
   - Startup crash: missing env vars, unreachable database, bad config.
   - OOMKilled: increase memory limits.
   - Liveness probe failure: check if the health endpoint is slow or broken.
5. If caused by a bad deployment, roll back: `kubectl rollout undo -n nomarkup deployment/<service>`
   — note the deploy workflow now attempts this **automatically** when the
   rollout or the post-deploy smoke check fails, and fails the job loudly
   either way. If you are here after an automated rollback reported
   `ROLLBACK INCOMPLETE`, this manual path is the fallback. Migrations are
   forward-only, so a rollback restores **code only**; the schema stays
   ahead, which is safe because migrations are additive.

**Escalation:** If the service is critical (gateway, payment) and rollback does not help, escalate to P0.

---

### NoMarkupDBConnectionPoolExhausted (P1 Warning) — ⚠️ CURRENTLY DISABLED

> **This alert cannot fire today.** Its rule is commented out in
> `deploy/monitoring/prometheus/alerts.yml` because the metrics it needs
> (`pgbouncer_pools_server_active` / `_idle`) come from a PgBouncer exporter
> that is not deployed — PgBouncer appears only in `docker-compose.yml` for
> local dev, in zero Kubernetes manifests, and the Go services connect to
> Postgres directly. It was previously a live rule against a metric nobody
> emitted, which reads as coverage while providing none.
>
> **To re-enable:** deploy PgBouncer + pgbouncer-exporter, uncomment the
> scrape job in `prometheus.yml`, then uncomment the rule. A cheaper
> alternative is to export `db_pool_*` from `pgxpool.Stat()` on the existing
> `/metrics` endpoint and rewrite the expression against that.
>
> The response steps below stay valid for manual investigation.

**What it means:** PgBouncer connection pool is >90% utilized. New database connections may be queued or rejected.

**First response:**
1. Check PgBouncer pool stats: `SHOW POOLS;` and `SHOW CLIENTS;`
2. Check for long-running transactions in PostgreSQL: `SELECT * FROM pg_stat_activity WHERE state = 'active' ORDER BY query_start;`
3. Check if a specific service is holding connections (correlate client counts with service names).
4. Kill idle-in-transaction sessions if safe: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction' AND query_start < now() - interval '5 minutes';`
5. Consider temporarily increasing `DEFAULT_POOL_SIZE` in PgBouncer if the traffic spike is legitimate.

**Escalation:** If connections are fully exhausted and queries are failing, escalate to P0.

---

### NoMarkupDBSlowQueries (P1 Warning) — ⚠️ CURRENTLY DISABLED

> **This alert cannot fire today.** Its rule is commented out in
> `deploy/monitoring/prometheus/alerts.yml` because
> `pg_stat_activity_max_tx_duration` comes from a postgres_exporter that is
> not deployed and has no scrape job.
>
> **To re-enable:** deploy postgres_exporter, add its scrape job, then
> uncomment the rule.
>
> The response steps below stay valid for manual investigation.

**What it means:** PostgreSQL has transactions running longer than 30 seconds. This may cause lock contention and cascading latency.

**First response:**
1. Identify the slow queries: `SELECT pid, now() - query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC LIMIT 10;`
2. Check if the query is a known slow path (full table scan, missing index) or an anomaly.
3. If safe, terminate the query: `SELECT pg_terminate_backend(<pid>);`
4. Check `pg_stat_user_tables` for sequential scan counts on large tables.
5. Run `EXPLAIN ANALYZE` on the slow query to identify missing indexes.

**Escalation:** If slow queries are blocking other operations, escalate to platform team lead.

---

### NoMarkupPaymentFailureSpike (P2 Info)

**What it means:** More than 5% of payment-related requests are failing over a 10-minute window.

**First response:**
1. Check Stripe status page: https://status.stripe.com/
2. Check payment service logs for error patterns: `kubectl logs -n nomarkup deployment/payment --tail=200 | grep -i error`
3. Verify Stripe API keys are valid (check if `STRIPE_SECRET_KEY` env var is set and not expired).
4. Check if the failure is on specific operations (create payment, process, refund) vs. all operations.
5. If Stripe is down, acknowledge and monitor. Users will see friendly error messages.

**Escalation:** If payment failures exceed 20% or persist for 30+ min, escalate to P1.

---

### NoMarkupWebSocketConnectionDrop (P2 Info)

**What it means:** Active WebSocket connections have dropped by more than 20% in 5 minutes. Chat and live auction features are degraded.

**First response:**
1. Check chat service pods: `kubectl get pods -n nomarkup -l app.kubernetes.io/name=chat`
2. Check if the gateway is still routing WebSocket upgrades: look for 101 status codes in gateway logs.
3. Check if a node was drained or evicted (cordon/drain events).
4. Check load balancer configuration for WebSocket idle timeout settings.
5. If clients are reconnecting, this may be self-healing. Monitor the connection count for recovery.

**Escalation:** If connections do not recover within 10 min, escalate to P1.

---

### NoMarkupHighDisputeRate (P2 Info)

**What it means:** The ratio of disputes to completed jobs exceeds 5% over the last hour. This is a business health indicator.

**First response:**
1. This is not an infrastructure issue. Check if there is a pattern in disputes:
   - Are disputes concentrated on specific providers?
   - Are disputes concentrated in specific service categories?
   - Is there a new type of dispute (scam, quality, no-show)?
2. Review recent disputes in the admin panel.
3. Check if the trust scoring system flagged any of the involved users.
4. Check if a recent platform change (new category, pricing change) is causing confusion.

**Escalation:** Notify trust & safety team. If fraud is suspected, page security team.
