# Production Provisioning Checklist

> **Status: NOT YET PROVISIONED.** The `.github/workflows/deploy.yml` job is a
> placeholder and is **fail-closed**: it exits non-zero on every `v*` tag until
> the repo/environment variable `DEPLOY_PROVISIONED` is set to `true`. Work
> through this checklist when the Kubernetes cluster is provisioned, then flip
> the flag. This is the single source of truth for "what has to happen before
> the first real deploy."

The app code, container images, and database migrations are all deploy-ready.
What is missing is the **deploy automation** (cluster + the steps below). None of
these are feature work; they are platform/infra tasks gated on a real cluster.

---

## Must-do before the first deploy (fail-closed)

### 1. Database migrations auto-apply
golang-migrate is the mechanism. Migrations live in `database/migrations/`
(authoritative, currently through `054_*`) — there are no per-service migration
dirs. Today nothing runs them on deploy: `deploy.yml` documents
`kubectl exec ... deploy/migration-job -- migrate up`, but **no `migration-job`
resource exists** in `deploy/k8s/`.

Action: create one of —
- a Kubernetes **Job** (run-once per release) that runs
  `migrate -path /migrations -database $DATABASE_URL up`, gated to complete
  before the app Deployments roll, **or**
- an **init-container** on the gateway/user/job Deployments that runs the same
  `migrate up` before the service container starts.

The migration image just needs the `migrate` binary + the `database/migrations/`
dir mounted (or baked in). Forward-only in prod (`up` only); down migrations are
for dev.

### 2. Set `APP_VERSION` per release on every service
The gateway versions its category-tree Redis cache key by `APP_VERSION`
(`gateway/internal/handler/categories.go`, fix `1b9f0ca`). This is what makes a
taxonomy migration (e.g. new goods/service categories) show up immediately
instead of serving stale data for up to the 1h TTL.

Action: inject `APP_VERSION=<release tag>` into the gateway (and ideally all
services, for Sentry release tagging too) in the Deployment env. If it is unset
the key falls back to `dev` and will **not** bust between releases — categories
will appear stale after a taxonomy change. No manual Redis flush is needed once
`APP_VERSION` changes per release.

### 3. Build + push the updated images
The gateway image (`deploy/docker/gateway.Dockerfile`, `COPY gateway/`) includes
the new `markets.go` handler / `GET /api/v1/markets`. CI builds from source, so a
normal image build picks it up — just confirm the gateway + user images are
rebuilt for the release.

### 4. Set the internal WS-auth secret
The gateway presents a shared secret to the chat/auction WebSocket backends so
the internal WS hop is authenticated (`gateway/internal/config/config.go`
`InternalWSSecret`, commit `a77ddb7`). The handshake is **inactive until the
secret is set on both sides**.

Action: set the SAME value for `INTERNAL_WS_SECRET` (alias `GATEWAY_CHAT_SECRET`)
on the **gateway** and the **chat service** Deployments. Generate with
`openssl rand -base64 32`. If unset, the WS auth handshake is a no-op.

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
