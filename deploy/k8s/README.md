# Kubernetes deployment — `deploy/k8s`

Kustomize layout: `base/` holds every manifest; `overlays/production` and
`overlays/staging` set namespace, replicas, image tags, and the per-environment
`nomarkup-config` ConfigMap. Render with:

```bash
kubectl kustomize deploy/k8s/overlays/production
kubectl kustomize deploy/k8s/overlays/staging
```

## In-cluster vs. external-managed components

| Component | Where it runs | Manifest / wiring |
|---|---|---|
| gateway, web, user, job, payment, chat, notification (Go/Next.js) | in-cluster | `base/<name>/` |
| bidding, fraud, trust, imaging, pricing, underwriting (Rust engines) | in-cluster | `base/<name>/` |
| Meilisearch | in-cluster | `base/meilisearch/` — `MEILISEARCH_URL=http://meilisearch:7700`; master key comes from `nomarkup-secrets/MEILISEARCH_API_KEY` (see `SECRETS.md`); data on the `meili-data` PVC |
| OpenTelemetry Collector | in-cluster | `base/otel-collector/` — `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317`; ships with the `debug` exporter, swap in a real backend exporter in `base/otel-collector/configmap.yaml` |
| **PostgreSQL 16 + PostGIS** | **external managed service** (by design) | no Deployment/StatefulSet in this repo. Services receive `DATABASE_URL` from the Vault-sourced `nomarkup-secrets` Secret (`SECRETS.md`) |
| **Redis 7** (Cluster in prod) | **external managed service** (by design) | no manifest. Services receive `REDIS_URL` from `nomarkup-secrets` |
| MinIO / S3 | external (AWS S3 in prod; MinIO only for local dev) | `S3_*` keys in `nomarkup-secrets` |

Note: `base/pvc.yaml` still declares `postgres-data` / `minio-data` PVCs. They
exist for dev/spike clusters only — **no workload in this repo mounts them**;
production data stores are the managed services above. The only PVC consumed
in-cluster is `meili-data` (Meilisearch index storage).

## Image pinning + the deploy gate

- Base manifests reference `ghcr.io/nomarkup/<name>:latest`, but **overlays
  never deploy `:latest`**: both `overlays/production/kustomization.yaml` and
  `overlays/staging/kustomization.yaml` carry an `images:` block pinning all
  13 deployables (`gateway, web, user, job, payment, chat, notification,
  bidding, fraud, imaging, pricing, trust, underwriting`) to an explicit tag.
- `v0.1.0` in the repo is a placeholder. At deploy time CI stamps the real
  release tag:

  ```bash
  cd deploy/k8s/overlays/production
  for img in gateway web user job payment chat notification \
             bidding fraud imaging pricing trust underwriting; do
    kustomize edit set image ghcr.io/nomarkup/$img:$RELEASE_TAG
  done
  ```

- `.github/workflows/deploy.yml` is **fail-closed** until
  `DEPLOY_PROVISIONED=true`. When provisioned **and** secrets `KUBE_CONFIG` +
  `REGISTRY_PASSWORD` are present, it build/pushes images, runs the
  `db-migrate-<version>` Job, then `kubectl apply -k overlays/production`.
  Missing credentials after the gate is flipped fails with a clear error
  (no echo-only success path).

## Secrets

All runtime secrets (including `DATABASE_URL` / `REDIS_URL` for the managed
Postgres and Redis) come from the `nomarkup-secrets` Secret, provisioned
externally from Vault (External Secrets Operator recommended). Sample:
[`base/externalsecret.sample.yaml`](./base/externalsecret.sample.yaml). Full
key list (includes `INTERNAL_WS_SECRET`): [`SECRETS.md`](./SECRETS.md).

## Migrations

`base/migration-job.yaml` + `deploy/docker/migrate.Dockerfile` apply
`database/migrations/` via golang-migrate. CI renames the Job per release.
Runbook: [`docs/runbooks/09-migration-job.md`](../../docs/runbooks/09-migration-job.md).

## Metrics scrape ports

Go services: `SERVICE_PORT + 1000` (`METRICS_PORT`). Rust engines with metrics:
gRPC port + 10000 (`*_METRICS_PORT`). See `docs/operations/metrics.md`.
Pod annotations must point at the **HTTP metrics** port, not the gRPC port.

## Gateway `/metrics` exposure (security audit note)

The gateway serves Prometheus metrics at `/metrics` on its main listener
(port 8080, `gateway/internal/router/router.go`). It is **not externally
routable**: `base/ingress.yaml` routes only `/api/` and `/ws/` prefixes to the
`gateway` Service — the catch-all `/` goes to `web:3000`. A request to
`https://no-markup.com/metrics` therefore lands on the Next.js frontend (404),
never the gateway. Prometheus scrapes `/metrics` in-cluster via the pod
annotations (`prometheus.io/scrape`). If a future ingress change ever routes
`/` or `/metrics` to the gateway, add an explicit deny/exclusion path first.

## Known caveat (staging)

`overlays/staging` applies `namePrefix: staging-`, which renames Services
(e.g. `staging-meilisearch`). Kustomize rewrites object references (ingress
backends) automatically, but **literal URLs inside `configMapGenerator`**
(`MEILISEARCH_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`) are not rewritten. Staging
runs in its own namespace (`nomarkup-staging`), so either drop the prefix for
infrastructure Services or update the staging ConfigMap literals when staging
is actually provisioned (deploy gate is off today, see above).
