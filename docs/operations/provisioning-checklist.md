# Production Provisioning Checklist

> **Status: NOT YET PROVISIONED.** The `.github/workflows/deploy.yml` job is
> **fail-closed**: it exits non-zero on every `v*` tag until
> `DEPLOY_PROVISIONED=true`. When that flag is set **and** secrets
> `KUBE_CONFIG` + `REGISTRY_PASSWORD` exist, deploy runs real
> build/push/migrate/apply. Missing credentials after the flag flip still fails
> (no echo-only success). Work through this checklist, then flip the flag.

Infra manifests (migration Job, metrics ports, NetworkPolicies, PDBs, HPAs,
Terraform skeleton) are in-repo. What remains is **provisioning real cloud
resources + secrets** — not more placeholder YAML.

---

## Must-do before the first deploy (fail-closed)

### 1. Database migrations auto-apply — DONE in-repo
- Job: `deploy/k8s/base/migration-job.yaml`
- Image: `deploy/docker/migrate.Dockerfile` (bakes `database/migrations/`)
- CI: deploy.yml creates `db-migrate-<version>` and waits for complete before rollout
- Runbook: `docs/runbooks/09-migration-job.md`

Still required on the cluster: `nomarkup-secrets/DATABASE_URL` pointing at the
managed Postgres.

### 2. Set `APP_VERSION` per release — DONE in-repo
`APP_VERSION` is in `nomarkup-config` (overlays) and stamped by deploy.yml to the
release tag. Deployments read it via `configMapKeyRef` (category cache bust).

### 3. Build + push images — DONE in deploy.yml
When provisioned + credentials present, deploy builds/pushes all service images
(including migrate + engines) to GHCR.

### 4. Set the internal WS-auth secret — wire in Vault
Gateway + chat Deployments inject `INTERNAL_WS_SECRET` via `secretKeyRef`.
Generate and store in Vault / `nomarkup-secrets`:

```bash
openssl rand -base64 32   # store as INTERNAL_WS_SECRET
```

Sample ExternalSecret: `deploy/k8s/base/externalsecret.sample.yaml`.

### 5. Deploy credentials (required when DEPLOY_PROVISIONED=true)
| Secret / var | Purpose |
|---|---|
| `DEPLOY_PROVISIONED=true` | repo/environment variable — opens the gate |
| `KUBE_CONFIG` | base64 kubeconfig for production |
| `REGISTRY_PASSWORD` | GHCR/PAT write token |
| `REGISTRY_USERNAME` | optional; defaults to `github.actor` |

---

## Recommended (not strictly blocking)

- **Migration-numbering CI lint.** There is no check for gaps/duplicates in
  `database/migrations/`. Add a CI step that fails on a missing or duplicate
  sequence number so two branches can't both grab `0NN`.
- **Schema-version readiness gate.** Have `/readyz` (or the migration Job's
  completion) confirm the DB is at the expected migration version, so a service
  can't serve traffic against an un-migrated DB.

---

## After everything above is in place

Set the deploy flag so the workflow stops failing closed:

```
# GitHub → repo (or "production" environment) → Variables
DEPLOY_PROVISIONED = true
```

Then a `v*` tag push runs the real deploy. Keep this doc updated as the steps
become real automation.
