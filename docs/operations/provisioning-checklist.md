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

**OPS-02 (IaC):** `deploy/terraform/` is a **Founder-Action** residual — eng skeleton
only (README inventory + draft modules for VPC/EKS/RDS/Redis/S3). It is **not**
applied and contains **no** AWS account IDs. Founder must create the account,
remote state, plan/apply (or document an external provisioner), enable PostGIS,
and load secrets before `DEPLOY_PROVISIONED=true`.

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

### 4. Provision `nomarkup-secrets` (OPS-04 Founder-Action — Founder wires Vault)

In-repo samples only; **no live secret store is applied by kustomize**.

| Pattern | Path |
|---|---|
| ESO + Vault (preferred) | `deploy/k8s/base/externalsecret.sample.yaml` |
| Sealed Secrets fallback | `deploy/k8s/base/sealedsecret.sample.yaml` |
| Key inventory + dual metrics token | `deploy/k8s/SECRETS.md` |

Spotlight families mapped explicitly in the ExternalSecret sample:

- **METRICS** — `METRICS_BEARER_TOKEN` (gateway + `monitoring/nomarkup-metrics-token`)
- **JWT** — `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` (PEM content → file mounts)
- **STRIPE** — `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_CONNECT_CLIENT_ID`
- **GOOGLE** — `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (not ConfigMap)

Also generate and store platform keys, including WS hop auth:

```bash
openssl rand -base64 32   # INTERNAL_WS_SECRET (same on gateway + chat)
openssl rand -base64 32   # METRICS_BEARER_TOKEN (same on gateway + Prometheus)
openssl rand -base64 32   # SESSION_SECRET / ENCRYPTION_KEY as needed
```

**Founder-Action:** stand up Vault (or Sealed Secrets controller), write real
values (Stripe Dashboard, Google OAuth client, RSA PEMs — never invent into
git), apply ClusterSecretStore + ExternalSecrets (or sealed overlays), confirm
`kubectl get secret nomarkup-secrets -n nomarkup` has the required keys before
`DEPLOY_PROVISIONED=true`.

### 5. Deploy credentials (required when DEPLOY_PROVISIONED=true)
| Secret / var | Purpose |
|---|---|
| `DEPLOY_PROVISIONED=true` | repo/environment variable — opens the gate |
| `KUBE_CONFIG` | base64 kubeconfig for production |
| `REGISTRY_PASSWORD` | GHCR/PAT write token |
| `REGISTRY_USERNAME` | optional; defaults to `github.actor` |

---

## Recommended (not strictly blocking)

- **Migration-numbering CI lint.** **Done** — `scripts/check-migration-sequence.sh`
  + CI job **Migration Sequence Lint** (fail on dupe/gap).
- **Schema-version readiness gate.** **Done (optional env)** — gateway
  `/readyz` checks `schema_migrations` when `EXPECTED_SCHEMA_VERSION` is set
  (503 if dirty or version behind). Stamp from deploy/migrate job for prod.

---

## After everything above is in place

Set the deploy flag so the workflow stops failing closed:

```
# GitHub → repo (or "production" environment) → Variables
DEPLOY_PROVISIONED = true
```

Then a `v*` tag push runs the real deploy. Keep this doc updated as the steps
become real automation.

**Process-start fail-closed (already shipped — do not extend into `bin/dev`):**
gateway exits on a missing JWT public key (every env) and on missing
`DATABASE_URL` / `REDIS_URL` when `ENVIRONMENT=production`; payment exits on
placeholder `STRIPE_SECRET_KEY` (non-dev) and missing `STRIPE_WEBHOOK_SECRET`
(every env); PII cipher exits on missing `ENCRYPTION_KEY` in production.
OAuth / SendGrid / Sentry / Apple Pay / `DEPLOY_PROVISIONED` stay
Founder-Action — inventory them with `make founder-secrets-check` before
flipping this flag. See `docs/compliance/founder-action-board.md`.
