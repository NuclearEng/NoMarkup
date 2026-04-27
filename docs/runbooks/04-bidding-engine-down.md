# Runbook: Bidding Engine Down

> The Rust bidding engine processes every live auction bid. When it is down,
> auctions stall: providers can't bid, customers can't see new offers, and
> sealed-bid windows freeze.

## Symptoms

- Alert: `NoMarkupServiceDown` for `bidding`.
- Alert: `NoMarkupBidProcessingSlow` (P1) sustained → indicative of degraded engine.
- WebSocket `/ws/auction/{jobId}` clients receive no events for >30s.
- Logs (gateway):
  ```
  failed to connect to bid engine: connection refused
  bidHandler: PlaceBid: rpc error: code = Unavailable
  ```
- Customer-side: bid count stops climbing, "X providers competing" stays constant.
- Provider-side: bid submission button shows error toast.

## Diagnosis

1. **Check pod state:**
   ```bash
   kubectl get pods -n nomarkup -l app.kubernetes.io/name=bidding -o wide
   kubectl describe pod -n nomarkup -l app.kubernetes.io/name=bidding | tail -50
   ```

2. **Check gRPC health from another pod:**
   ```bash
   kubectl exec -n nomarkup deployment/gateway -- \
     grpc_health_probe -addr=bidding:50053 -service=nomarkup.bid.v1.BidService
   # Expected: status: SERVING
   ```
   If you don't have grpc_health_probe in the gateway image, run from a debug pod:
   ```bash
   kubectl run debug-grpc --rm -it --image=fullstorydev/grpcurl:latest --restart=Never -- \
     grpcurl -plaintext bidding.nomarkup.svc.cluster.local:50053 grpc.health.v1.Health/Check
   ```

3. **Check recent logs:**
   ```bash
   kubectl logs -n nomarkup deployment/bidding --tail=500
   kubectl logs -n nomarkup deployment/bidding --previous --tail=500
   ```
   Look for:
   - `panicked at` — unrecoverable state in Rust.
   - `database connection lost` — Postgres connectivity (see runbook 02).
   - `out of memory` — pod OOM-killed.
   - `tonic: connection error` — TLS / gRPC config drift.

4. **Check resource pressure:**
   ```bash
   kubectl top pod -n nomarkup -l app.kubernetes.io/name=bidding
   ```
   The bidding engine is CPU-sensitive. Sustained >80% suggests under-provisioning.

## Mitigation

### Path A: Pod CrashLoopBackOff

1. Roll back to last known good image:
   ```bash
   kubectl rollout history -n nomarkup deployment/bidding
   kubectl rollout undo    -n nomarkup deployment/bidding
   kubectl rollout status  -n nomarkup deployment/bidding
   ```
2. While the rollback is in progress, see *Customer Notifications* below.

### Path B: Out of memory (OOMKilled)

1. Increase memory limits:
   ```bash
   kubectl set resources -n nomarkup deployment/bidding \
     --limits=memory=2Gi --requests=memory=512Mi
   ```
2. Open a P2 ticket to investigate the leak — Rust services should not grow unbounded.

### Path C: Database unreachable

The bidding engine needs Postgres for auction state. If the DB is down, see `02-database-master-down.md`. The engine recovers automatically once DB is back.

### Path D: Healthy but slow (NoMarkupBidProcessingSlow)

1. Scale horizontally:
   ```bash
   kubectl scale -n nomarkup deployment/bidding --replicas=4
   ```
   The engine is stateless per-bid — concurrent bids are safely serialized via Postgres row locks on `auctions.id`.
2. Check Jaeger for slow span: filter on `service.name=bidding-engine` → `bid.process` operation. The span tags include `db_lock_wait_ms`.

## Auction State & Queue Replay

When the engine recovers, **bids submitted during the outage are NOT replayed automatically**. The gateway returns 503 to the client, and the client must re-submit.

For the rare case where the engine processed a bid but failed to write the response (extremely narrow window), reconcile with:

```sql
-- Find bids inserted but with no auction_event row in the same transaction window:
SELECT b.id, b.job_id, b.amount_cents, b.created_at
  FROM bids b
  LEFT JOIN auction_events e ON e.bid_id = b.id
 WHERE b.created_at > now() - interval '1 hour'
   AND e.id IS NULL;
```
For each orphaned row, re-emit the corresponding auction event:
```sql
INSERT INTO auction_events (id, job_id, bid_id, event_type, payload, created_at)
VALUES (gen_random_uuid(), '<job_id>', '<bid_id>', 'bid_placed',
        jsonb_build_object('amount_cents', <amount>, 'replayed', true),
        now());
```
Notify the affected customers (auction_events drives the spectator WebSocket).

## Customer Notifications

If the outage is > 5 min:
1. Trigger banner: set feature flag `live_auction_degraded=true`.
2. Email customers with active auctions starting within the next 30 min:
   ```sql
   SELECT j.id, j.title, u.email, u.id AS customer_id
     FROM jobs j JOIN users u ON u.id = j.customer_id
    WHERE j.status = 'bidding' AND j.auction_starts_at BETWEEN now() AND now() + interval '30 minutes';
   ```
   Use the `auction_delay` notification template (or send hand-crafted if template missing).

## Resolution

1. `kubectl get pods -n nomarkup -l app.kubernetes.io/name=bidding` — all pods Running, Ready 1/1.
2. gRPC health check returns SERVING (see Diagnosis #2).
3. Place a smoke-test bid via the gateway; observe it appear in `auction_events`.
4. `NoMarkupServiceDown` and `NoMarkupBidProcessingSlow` alerts cleared.
5. Banner / feature flag reverted.

## Postmortem Template

```
## Incident: Bidding Engine Down YYYY-MM-DD
- Severity: P0
- Duration: HH:MM
- Detection: alert / customer report
- Bids dropped: <count from gateway 503 logs>
- Auctions affected: <count from `jobs WHERE status='bidding' AND auction_starts_at IN window>`
- Root cause: <one sentence>

### Timeline
- HH:MM ...

### Action items
- [ ] Add bid replay queue (Redis Streams) so engine can resume after crash
- [ ] Increase HPA min replicas for bidding (currently 2) if outage was load-driven
```
