# NoMarkup operational runbooks

In-repo playbooks for Prometheus/Alertmanager annotations. Alert rules under
`deploy/monitoring/prometheus/alerts.yml` point here via
`runbook: "docs/runbooks/<file>.md"` (repo-relative; resolve from the monorepo
root or the GitHub blob URL for the deployed branch).

## Alert → runbook map

| Alert | Runbook |
|-------|---------|
| `NoMarkupWebhookSignatureFailures` | [01-stripe-webhook-stuck.md](./01-stripe-webhook-stuck.md) |
| `NoMarkupPaymentFailureSpike` | [01-stripe-webhook-stuck.md](./01-stripe-webhook-stuck.md) (webhook path) + [03-provider-payout-failed.md](./03-provider-payout-failed.md) |
| `NoMarkupPaymentPathDown` | [03-provider-payout-failed.md](./03-provider-payout-failed.md) |
| `NoMarkupAuthFailureSpike` | [05-auth-service-degraded.md](./05-auth-service-degraded.md) |
| `NoMarkupBidProcessingSlow` | [04-bidding-engine-down.md](./04-bidding-engine-down.md) |
| `NoMarkupGatewayDown` / `NoMarkupServiceDown` | [02-database-master-down.md](./02-database-master-down.md) (dependency first) + [07-redis-degraded.md](./07-redis-degraded.md) |
| `NoMarkupHighErrorRate` | [05-auth-service-degraded.md](./05-auth-service-degraded.md) (auth) / [01-stripe-webhook-stuck.md](./01-stripe-webhook-stuck.md) (payments) |
| `NoMarkupHighLatencyP95` / `P99` | [08-meilisearch-degraded.md](./08-meilisearch-degraded.md) / [07-redis-degraded.md](./07-redis-degraded.md) |
| `NoMarkupHighCPU` / `HighMemory` / `PodRestartLoop` | [02-database-master-down.md](./02-database-master-down.md) (infra triage) |
| `NoMarkupWebSocketConnectionDrop` | [07-redis-degraded.md](./07-redis-degraded.md) (pubsub) |
| `NoMarkupHighDisputeRate` | [03-provider-payout-failed.md](./03-provider-payout-failed.md) (money surface) |
| Migration Job failures | [09-migration-job.md](./09-migration-job.md) |
| Fraud false positive spikes | [06-fraud-false-positive.md](./06-fraud-false-positive.md) |

## Adding a runbook

1. Add `NN-short-name.md` with Symptoms / Diagnosis / Mitigation / Escalation.
2. Link it from this table and from the matching `runbook:` annotation in
   `deploy/monitoring/prometheus/alerts.yml`.
3. Prefer repo-relative paths — do not invent `https://docs.nomarkup.dev/...`
   hosts that are not provisioned.
