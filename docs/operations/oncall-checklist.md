# On-Call Pre-Shift Checklist

> Run through this list 30 minutes before you go on-call. If anything is broken,
> fix it before you take the pager.

## Tooling

- [ ] **PagerDuty** app installed on phone, notifications enabled, sound on.
- [ ] **Slack** app installed on phone, `#incidents` and `#oncall-handoff` notifications enabled.
- [ ] **Laptop** can reach VPN / bastion / kubectl context.
- [ ] **kubectl** authenticated to production cluster:
      ```
      kubectl get pods -n nomarkup
      ```
      Should return without an auth error.
- [ ] **psql** can reach Postgres via bastion / read replica:
      ```
      kubectl exec -n nomarkup deployment/gateway -- psql "$DATABASE_URL" -c "SELECT 1"
      ```
- [ ] **Stripe CLI** authenticated and can list events:
      ```
      stripe events list --limit 1
      ```
- [ ] **Sentry** loaded in browser, logged in, default project = `nomarkup`.
- [ ] **Grafana** loaded in browser, dashboards bookmarked:
      - "Service Health" — error rate, latency p95/p99, request volume.
      - "Database" — connection pool, query latency, replication lag.
      - "Payments" — webhook lag, payout success rate.
      - "Bidding" — bid processing latency, active auctions.
- [ ] **Status page** (Statuspage.io) admin login tested.

## Knowledge

- [ ] Runbook URLs bookmarked: `docs/runbook.md`, `docs/runbooks/01..06`.
- [ ] Severity definitions reviewed: `docs/operations/incident-response.md`.
- [ ] Aware of any known issues from outgoing on-call's handoff in `#oncall-handoff`.
- [ ] Aware of any in-flight deploys / migrations / experiments — check `#deploys`.

## Recently Shipped

Look at the last 5 PRs merged to `main`:
```
git log --oneline -20 origin/main
```
Make a mental note of what changed in case it correlates with an incident.

## Known Quiet Hours

The fraud engine runs heavier batch reconciliation at:
- 02:00 UTC daily (trust score recompute)
- 04:00 UTC daily (fraud signal aggregation)

A spike in DB load at these times is expected, not an incident.

## Communication

- [ ] You know who the secondary on-call is this week. Test pinging them in Slack.
- [ ] You know who the engineering manager on call is.
- [ ] You know who Trust & Safety lead is.
- [ ] You know who Payments lead is.
- [ ] You have phone numbers (not just Slack) for the EM and Security lead in case Slack is down.

## Escalation Paths

| If…                                          | Then page or ping…                  |
|---------------------------------------------|-------------------------------------|
| You can't ack a P0 in 5 min                 | Auto-pages secondary on-call        |
| Issue persists 30 min, you're stuck         | Engineering manager on-call         |
| Stripe / payments / payouts                 | Payments lead (Slack DM)            |
| Auth, user service, JWT, MFA                | Security lead (Slack DM)            |
| Suspected breach, data exfiltration         | Security + EM + Legal (phone)       |
| User safety / harassment / CSAM             | Trust & Safety + Legal              |
| Database promotion / restore                | Platform lead (this is irreversible)|

## During the Shift

- Acknowledge alerts within SLO. Even "I see it, investigating" is enough.
- Post hourly in `#oncall-platform` if anything is happening; silence is fine if it's quiet.
- Don't work on side projects during on-call — be free to drop everything.
- If you go to sleep / dinner / commute, ensure phone is reachable and PagerDuty volume is on.

## Handoff Out

When your shift ends:

1. Post in `#oncall-handoff`:
   - Anything still active that you didn't fully resolve.
   - Any patterns you noticed (flapping alerts, slow service, weird logs).
   - Any tools / docs that bit you — file a PR or open an issue.
2. Confirm PagerDuty has rolled to next on-call.
3. Confirm next on-call has acked the handoff post.
4. You're off. Rest.

## Post-Shift Self-Care

- If you took a P0, you may be tired. Take a half day if you need it.
- File postmortem action items as PRs, not as resolutions of the incident.
- Add anything missing from this checklist as a PR.
