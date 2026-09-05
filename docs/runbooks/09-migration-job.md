# Runbook: Database migration Job

**Resource:** `deploy/k8s/base/migration-job.yaml`  
**Image:** `ghcr.io/nomarkup/migrate` (`deploy/docker/migrate.Dockerfile`)  
**CI:** `.github/workflows/deploy.yml` creates `db-migrate-<version>` per release.

Migrations live in `database/migrations/` (forward-only in production).

## When this runs

On every `v*` tag deploy after `DEPLOY_PROVISIONED=true` and credentials are set.
The Job must complete **before** Deployments roll (deploy.yml enforces order).

## Manual run

```bash
export VERSION=v1.2.3
export MIGRATE_IMAGE=ghcr.io/<owner>/nomarkup/migrate:${VERSION}

kubectl delete job -n nomarkup "db-migrate-${VERSION//./-}" --ignore-not-found

# Prefer re-running via deploy.yml. One-shot:
kubectl apply -f deploy/k8s/base/migration-job.yaml
kubectl set image job/db-migrate migrate=${MIGRATE_IMAGE} -n nomarkup
kubectl wait --for=condition=complete job/db-migrate -n nomarkup --timeout=600s
kubectl logs job/db-migrate -n nomarkup
```

## Failure modes

| Symptom | Cause | Action |
|---------|--------|--------|
| Job `BackOffLimitExceeded` | SQL error / dirty DB | `kubectl logs job/...`; fix migration or `migrate force <version>` carefully |
| `secret "nomarkup-secrets" not found` | Secrets not provisioned | Apply ExternalSecret / create secret (SECRETS.md) |
| ImagePullBackOff | Registry auth / wrong tag | Confirm GHCR push + imagePullSecrets if private |
| Stuck Pending | Resource quotas / PSPs | `kubectl describe job` + events |

## Dirty database version

If migrate reports a dirty version:

```bash
# ONLY after understanding which migration failed mid-way
migrate -path database/migrations -database "$DATABASE_URL" force <N>
# Fix the SQL, then re-run `up`
```

Never force past a half-applied migration without DBA review on production.

## Verify

```bash
migrate -path database/migrations -database "$DATABASE_URL" version
# Services ready:
kubectl get pods -n nomarkup
```
