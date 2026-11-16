# Backup & Disaster Recovery

> RTO: **1 hour** (max time to restore service after declared disaster).
> RPO: **5 minutes** (max acceptable data loss).
>
> "Disaster" = primary database lost AND replica lost OR region-wide failure.
> Smaller failures (single pod, brief network blip) are handled by runbooks 02
> and 04, not this procedure.

## Backup Strategy

### Postgres — Continuous WAL archiving + daily base backup

| Layer                      | Retention   | Storage                     | Validated     |
|----------------------------|-------------|-----------------------------|---------------|
| Streaming replica (1)      | live        | same region, different AZ   | replica lag <5s |
| Streaming replica (2, ro)  | live        | same region, different AZ   | replica lag <5s |
| Daily logical dump         | 30 days     | `s3://nomarkup-backups-prod/postgres/dumps/YYYY-MM-DD.sql.gz` | nightly checksum |
| Daily base backup (pgBackRest) | 30 days | `s3://nomarkup-backups-prod/postgres/base/`                   | weekly restore drill |
| WAL segments               | 30 days     | `s3://nomarkup-backups-prod/postgres/wal/`                    | continuously, every WAL is verified on archive |
| Off-region copy            | 7 days      | `s3://nomarkup-backups-prod-dr/postgres/` (different region)  | nightly cross-region replication |

> **Implementation status:** the launch checklist (`docs/launch-checklist.md`)
> covers PITR enablement and 30-day retention. WAL archiving + cross-region
> replication require explicit configuration on the managed Postgres
> provider — see *Provisioning checklist* below.

### S3 (user uploads)

- Versioning enabled on all buckets (`nomarkup-prod-uploads`, `nomarkup-prod-private`).
- 90-day soft delete via lifecycle policy.
- Cross-region replication to `nomarkup-prod-uploads-dr` for the public bucket.
- Private bucket (KYC / insurance docs) NOT cross-region-replicated to limit
  data spread; instead, daily snapshot copy to a separate account.

### Redis

- Redis is for ephemeral data: rate limit counters, OTP codes, MFA challenges,
  job-search caches.
- **Not backed up.** All data in Redis can be regenerated from Postgres or
  re-issued (OTPs / MFA challenges).
- AOF persistence enabled to survive single-node restarts.

### Meilisearch

- Search index is rebuilt from Postgres on demand.
- Daily snapshot to S3 for fast cold start, but not authoritative.

### Configuration / secrets

- Kubernetes manifests in git, encrypted via SOPS.
- Vault snapshots: daily, off-cluster S3, encrypted with AWS KMS.

## Disaster Categories & Procedures

### D1: Primary down, replica fresh (RPO: 0–5s, RTO: ~5 min)

→ **Failover** per `docs/runbooks/02-database-master-down.md` Path B.

This is not a disaster — it's the happy path of the runbook.

### D2: Primary down, replica also stale or lost (RPO: WAL gap, RTO: 30–60 min)

→ **Restore from base backup + WAL replay** to a fresh instance.

```bash
# 1. Provision a fresh Postgres instance (same version) in the surviving AZ.
#    Use the same volume / instance type as the lost primary.

# 2. Pull the latest base backup.
pgbackrest --stanza=nomarkup --repo=s3://nomarkup-backups-prod \
           --target-time="2026-04-25 14:25:00 UTC" \
           --type=time restore

# 3. Verify WAL replay caught up.
psql -c "SELECT pg_last_wal_replay_lsn(), now() - pg_last_xact_replay_timestamp();"

# 4. Promote the restored instance to primary.
pg_ctl promote

# 5. Update the Postgres Service selector in K8s to point at the new instance.
kubectl patch svc postgres-primary -n nomarkup \
  -p '{"spec":{"selector":{"role":"new-primary"}}}'

# 6. Restart all app services to drop stale conns.
for svc in gateway user job payment chat notification; do
  kubectl rollout restart -n nomarkup deployment/$svc
done

# 7. Verify smoke test (registration, login, post job, place bid, take payment).
```

### D3: Region-wide failure (RPO: 24h, RTO: 2-4h — exceeds standard SLO)

→ **Failover to DR region** with cross-region backup.

This is a declared disaster. Communicate impact to customers via status page;
this is a planned RTO miss.

```bash
# 1. Spin up the DR cluster in the secondary region (terraform apply -target=region.dr).
# 2. Restore Postgres from cross-region replica (most recent: 24h max lag).
# 3. Restore Vault snapshot from off-cluster S3.
# 4. Restore Redis from snapshot OR start cold (acceptable — Redis is ephemeral).
# 5. Restore Meilisearch from snapshot OR rebuild from Postgres (slower but authoritative).
# 6. Update DNS:
#    - api.nomarkup.com  → dr-region load balancer IP
#    - nomarkup.com      → dr-region load balancer IP
#    Cloudflare TTL is 60s; expect 1–2 min DNS propagation.
# 7. S3 bucket: redirect uploads to DR bucket.
# 8. Stripe webhook URL: update in Stripe Dashboard to dr-region URL.
#    (Dashboard cannot be updated programmatically; must be done by hand.)
# 9. Smoke-test the full flow before reopening to traffic.
```

### D4: Total data loss (RPO: 24h, RTO: 4h)

→ Same as D3 but with one additional step before #1: confirm the surviving
backup is intact via checksum verification before pointing production at it.

This is a worst-case. We will lose any data not yet replicated cross-region.

## Restore Drills

**Quarterly:** restore the latest backup to a non-prod environment, run smoke
tests, document RTO actually achieved. File a ticket if drift from target.

**Annually:** full DR drill — simulate region failure, run through D3 in a
test environment, time end-to-end. Engineering manager owns scheduling.

## Provisioning Checklist (do at launch — see `docs/launch-checklist.md`)

- [ ] Managed Postgres has continuous WAL archiving to S3 enabled.
- [ ] Daily base backup to S3 enabled.
- [ ] 30-day retention configured.
- [ ] Cross-region S3 replication for backup bucket enabled.
- [ ] Vault snapshot cron job scheduled and tested.
- [ ] DR region terraform applied and idle.
- [ ] First quarterly restore drill completed and documented.

## Communications During DR

Use the status page templates from `docs/operations/incident-response.md` →
"External — Status Page" section. For a declared D3/D4:

1. Status page: "We are restoring service. ETA 2–4 hours." Update every 30 min.
2. Email blast to all users (BCC, batched): we will send a single message at
   start and a single message at recovery. Avoid frequent updates.
3. Post-recovery: published postmortem within 7 days. The blast radius and
   data-loss window must be honest.

## Escalation

- D1: handled by primary on-call.
- D2: primary on-call + platform lead on-call.
- D3 / D4: Engineering Manager declares disaster. CEO is notified.
  Press / customer communications go through the EM, not engineering.

## Owner

- Backup configuration: Platform team.
- Restore drills: Platform on-call rotation, scheduled quarterly.
- DR region: Platform team.
- Disaster declaration: Engineering Manager.
