# Runbook: Stripe Webhook Stuck or Failing

> Stripe webhooks drive escrow release, payout settlement, subscription billing,
> and dispute creation. When webhook delivery stalls, money flow stalls.

## Symptoms

- Alert: `NoMarkupWebhookSignatureFailures` (P0) firing.
- Alert: `NoMarkupPaymentFailureSpike` (P2) firing with no apparent cause.
- Stripe Dashboard → Developers → Webhooks shows endpoint with red "Failed" badge or rising attempt count.
- Customer-side: payments collected but escrow status stuck in `pending_capture` / `requires_action`.
- Provider-side: completed jobs not flipping to "Awaiting payout".
- Logs:
  - `payment service: webhook signature mismatch`
  - `gateway: 400 Bad Request /api/v1/webhooks/stripe`
  - `payment service: idempotency key conflict on event evt_xxx`

## Diagnosis

1. **Confirm webhooks are reaching the gateway:**
   ```bash
   kubectl logs -n nomarkup deployment/gateway --tail=200 | grep -i "/api/v1/webhooks/stripe"
   ```
   If zero hits in the last 10 min, the problem is upstream (Cloudflare, ingress, DNS). Skip to *Mitigation: Stripe → Gateway path broken*.

2. **Check signature verification:**
   ```bash
   kubectl logs -n nomarkup deployment/payment --tail=500 | grep -iE "webhook|signature|stripe"
   ```
   - `signature does not match`        → secret rotated or wrong env
   - `event timestamp too old`         → clock drift between Stripe and pod (>5 min)
   - `idempotency key conflict`        → replay; usually self-heals
   - `unknown event type`              → schema upgrade; typically safe

3. **Compare configured webhook secret against Stripe Dashboard:**
   - Dashboard → Developers → Webhooks → click endpoint → "Signing secret" → reveal.
   - Compare against `STRIPE_WEBHOOK_SECRET` in the running pod env:
     ```bash
     kubectl exec -n nomarkup deployment/payment -- printenv STRIPE_WEBHOOK_SECRET | head -c 12
     # should match first 12 chars of dashboard secret (whsec_xxxx...)
     ```

4. **Check Stripe webhook attempt log:**
   - Dashboard → Developers → Events → filter by failing event type → click event → "Webhook attempts" tab.
   - Note the response code Stripe is seeing. 401/403/404 ≠ 5xx ≠ timeout — the handling differs.

## Mitigation

### Path A: Signature mismatch (secret rotated)

1. Update the Kubernetes secret with the new value:
   ```bash
   kubectl create secret generic nomarkup-secrets \
     --from-literal=STRIPE_WEBHOOK_SECRET=whsec_NEW_VALUE \
     --dry-run=client -o yaml | kubectl apply -n nomarkup -f -
   ```
2. Restart the payment service:
   ```bash
   kubectl rollout restart -n nomarkup deployment/payment
   kubectl rollout status   -n nomarkup deployment/payment
   ```
3. In Stripe Dashboard → click endpoint → "Resend" failed events from the Attempts tab.

### Path B: Stripe → Gateway path broken

1. Verify the public webhook URL responds:
   ```bash
   curl -i https://nomarkup.com/api/v1/webhooks/stripe -X POST \
     -H "Content-Type: application/json" -d '{}'
   # Expected: HTTP/2 400 (missing signature) — proves the route is alive.
   ```
2. If it does NOT return 400 (e.g. 502/504/timeout), check ingress + Cloudflare:
   - `kubectl get ingress -n nomarkup`
   - `dig +short nomarkup.com`
   - Cloudflare dashboard → Security Events → look for blocks on Stripe egress IPs.
3. Whitelist Stripe webhook source IPs at the WAF: <https://stripe.com/docs/ips#webhook-notifications>

### Path C: Idempotency key conflict

This is usually benign — Stripe is replaying an event we already processed. Look for a stuck row in the `processed_events` table:

```sql
SELECT id, event_id, event_type, processed_at, error
  FROM processed_events
 WHERE event_id = 'evt_xxxxxxxxxxxxxxxx';
```

If `error IS NOT NULL` and `processed_at` is recent, the previous attempt failed mid-flight. Investigate the underlying error in the payment service logs, fix it, then:

```sql
DELETE FROM processed_events WHERE event_id = 'evt_xxxxxxxxxxxxxxxx';
```

Then click **Resend** in Stripe Dashboard for that event.

### Path D: Backlog of failed events

If many events failed during an outage, replay them in bulk:

```bash
# Stripe CLI — list failed events in last 6 hours
stripe events list --limit 100 --created.gte=$(date -u -v-6H +%s)
# Copy the failed event IDs and resend:
for id in evt_a evt_b evt_c; do stripe events resend "$id"; done
```

## Resolution

1. Verify success rate returns to 100% in Stripe Dashboard → Webhooks → endpoint stats.
2. Verify the alert `NoMarkupWebhookSignatureFailures` clears in Prometheus.
3. Spot-check escrow rows that should have settled:
   ```sql
   SELECT id, status, updated_at FROM payments
    WHERE status = 'pending_capture' AND updated_at < now() - interval '15 minutes';
   ```
   Should return zero rows once the backlog drains.
4. Confirm no orphaned `processed_events` rows older than 1 hour with `error IS NOT NULL`.

## Postmortem Template

```
## Incident: Stripe Webhook Outage YYYY-MM-DD
- Severity: P0 / P1
- Duration: HH:MM (first failure → recovery)
- Detection: alert / customer report / Stripe email
- Impact: N escrow releases delayed M minutes; $X total funds in flight
- Root cause: <one sentence>

### Timeline (UTC)
- HH:MM  First webhook 400 in payment service logs
- HH:MM  Alert fired
- HH:MM  On-call ack
- HH:MM  Mitigation applied
- HH:MM  Backlog cleared

### Action items
- [ ] Owner: <name> — <preventive change>
- [ ] Owner: <name> — <detection improvement>
```
