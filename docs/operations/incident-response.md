# Incident Response

> What every on-call engineer needs to know in 5 minutes when paged.

## Severity Levels

| Severity | Definition | Examples | Acknowledge | Resolve |
|----------|------------|----------|-------------|---------|
| **P0**   | Total or partial outage; revenue impact; legal/security exposure | Gateway down; Postgres primary down; auth fully broken; Stripe webhooks all failing; security breach | 5 min | 1 hour |
| **P1**   | Significant degradation; subset of users impacted | Single service down; latency >2x SLO; payment failure spike on one path; bidding engine slow | 15 min | 4 hours |
| **P2**   | Limited or low impact; operational | Single user account issue; non-critical alert flapping; one Stripe webhook event type backlogged | 1 hour | next business day |
| **P3**   | Cosmetic or future risk | Dashboard wrong; old log entries; capacity planning miss | best effort | next sprint |

## On-Call Rotation

**Rotation cadence:** weekly, Monday 09:00 PT handoff.
**Coverage:**
- Primary on-call (Platform): 24/7. Slack `#oncall-platform`. Pager via PagerDuty.
- Secondary on-call (Engines): 24/7. Slack `#oncall-engines`. Pager via PagerDuty.
- Payments escalation: business hours via Slack `#team-payments`; pager after hours.
- Trust & Safety: business hours via Slack `#team-trust-safety`.
- Security: 24/7 via Slack `#security-incidents` and dedicated pager.
- Engineering manager (final escalation): on-call lead is paged after 30 min unack on P0.

**Handoff:**
- Outgoing on-call posts a one-paragraph summary in `#oncall-handoff` covering
  any open issues, paged incidents this week, and known weak spots to watch.
- Incoming on-call confirms PagerDuty schedule has flipped and that they have
  laptop access tested before signing off the previous on-call.

**Pre-shift checklist:** see `docs/operations/oncall-checklist.md`.

## Incident Lifecycle

### 1. Detection (T+0)
- Alert fires → PagerDuty pages primary on-call.
- Or: customer / external monitor reports → on-call manually opens an incident.

### 2. Acknowledge (within SLO above)
- Click "Acknowledge" in PagerDuty.
- Post in `#incidents`: `Ack'd <alert name>, investigating.`
- If you need help: tag secondary on-call.

### 3. Triage (T+5 to T+15)
- Identify which service is impacted.
- Run the appropriate runbook — `docs/runbooks/01..06`.
- If unsure which runbook, start with the gateway and cascade.
- For P0: open a dedicated Slack channel `#inc-YYYY-MM-DD-shortname`.

### 4. Mitigate
- The goal is restoring service, not finding root cause.
- Acceptable mitigations: rollback, scale up, traffic shed, feature flag off, manual workaround.
- Document each action in the incident channel as you take it.

### 5. Resolve
- Confirm symptoms cleared.
- Confirm alerts cleared.
- Post resolution to `#incidents`.
- Schedule postmortem (P0/P1 mandatory; P2 at on-call's discretion).

### 6. Postmortem
- Within 5 business days for P0/P1.
- Use the template at the bottom of each runbook.
- Blameless. Focus on systemic gaps, not individuals.
- Action items get owners and due dates; owner reports completion in retro.

## Communication Templates

### Internal — Slack (during incident)

```
**[P0] <Service / Symptom> (Inc-YYYY-MM-DD-name)**
- Status: investigating | mitigating | resolved
- Impact: <user-facing description>
- Actions taken: <bullet list>
- Next update in: 15 min
- IC: @oncall  Comms: @on-call-mgr
```

Update every 15 min during P0, every 30 min during P1, until resolved.

### External — Status Page

We use <https://status.nomarkup.com> (Statuspage.io). Update for any P0
or sustained P1 affecting > 5% of users.

Status page voice: factual, minimal speculation, no internal jargon.

```
[Investigating] Some users may be unable to log in.
We're investigating reports of failed login attempts. Already-logged-in users are unaffected. (HH:MM PT)

[Identified] We've identified an issue with our authentication service.
Engineers are deploying a fix. ETA 30 minutes. (HH:MM PT)

[Resolved] Login is restored.
Users who experienced failures may need to clear cookies and try again. (HH:MM PT)
```

Avoid:
- "Soon" / "shortly" — give a number or say "we don't yet have an ETA".
- Naming specific services internally that customers don't know about.
- Promising features ("we'll add monitoring for this") in the status post.

### External — Customer email (post-incident, P0/P1)

Use the `incident_followup` template via SendGrid. Required content:
- What happened (one sentence, plain English).
- When it happened (timezone-agnostic — "around 3pm PT on April 25").
- What we did to fix it.
- What we're doing to prevent recurrence.
- Apology + thanks.

Sent by the engineering manager, not the on-call engineer.

## Runbook Index

| Code | Runbook                                       | Severity expected |
|------|-----------------------------------------------|-------------------|
| 01   | Stripe webhook stuck                          | P0                |
| 02   | Postgres master down                          | P0                |
| 03   | Provider payout failed                        | P2 (P1 if many)   |
| 04   | Bidding engine down                           | P0                |
| 05   | Auth/User service degraded                    | P0                |
| 06   | Fraud false positive — manual override        | P2 (P1 if bulk)   |

For alert-driven runbook entries (NoMarkupGatewayDown, NoMarkupHighErrorRate,
etc.) see the existing `docs/runbook.md`.

## When to Page Whom

| Symptom                                          | Page                                |
|--------------------------------------------------|-------------------------------------|
| Any P0                                           | Primary on-call                     |
| Stripe / Connect / payouts                       | + Payments escalation               |
| Auth / login broken                              | + Security (rules out attack)       |
| Suspected breach / data leak                     | + Security + EM + Legal             |
| Trust & Safety incident (CSAM, harassment)       | + Trust & Safety + Legal            |
| Bidding / fraud / trust engine                   | + Engines on-call                   |
| Database / infrastructure                        | + Platform lead                     |
| Customer-impacting > 30 min unresolved P0        | + Engineering Manager               |

If in doubt: page. Apologize later.

## Status Page Discipline

- Update within 15 min of P0 ack.
- Update at least every 30 min while incident is active.
- Set "Resolved" status only after symptoms confirmed cleared, not just code rolled out.
- A historical incident page is the public artifact — write it as if it will be linked from a press article.
