# Runbook: Redis degraded or unreachable

**Symptom:** elevated 5xx, session / rate-limit / idempotency failures, cache misses
spiking. Logs show `REDIS_URL` dial errors or timeouts.

## Severity

P0 if auth sessions or payment idempotency are broken. P1 if only cache miss rate rises.

## Immediate checks

```bash
# From a debug pod or bastion in the VPC
redis-cli -u "$REDIS_URL" PING

kubectl get pods -n nomarkup -l app.kubernetes.io/part-of=nomarkup
kubectl logs -n nomarkup deploy/gateway --tail=100 | grep -i redis
```

## Common causes

1. **ElastiCache failover** — primary endpoint flipped; clients still holding dead connections.
2. **Security group / NetworkPolicy** — VPC CIDR changed; pods cannot reach Redis.
3. **Auth / TLS** — `REDIS_URL` missing password or `rediss://` after transit encryption enabled.
4. **Memory eviction** — Redis at `maxmemory`; check `INFO memory`.

## Mitigation

1. Confirm ElastiCache replication group status in AWS console / CLI.
2. Roll gateway + payment + user Deployments to reset connection pools:
   ```bash
   kubectl rollout restart deploy/gateway deploy/payment deploy/user deploy/job deploy/chat -n nomarkup
   ```
3. If `REDIS_URL` rotated in Vault, refresh ExternalSecret and restart:
   ```bash
   kubectl annotate externalsecret nomarkup-secrets force-sync=$(date +%s) -n nomarkup --overwrite
   kubectl rollout restart deployment -n nomarkup -l app.kubernetes.io/part-of=nomarkup
   ```

## Verify

- `PING` returns `PONG`
- Gateway `/health` 200
- Payment create with idempotency key does not double-charge
