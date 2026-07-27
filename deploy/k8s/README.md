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
| OpenTelemetry Collector | in-cluster | `base/otel-collector/` — apps use `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317`; dual-export `debug` + `otlphttp/backend` via `otel-collector-backend` ConfigMap (`OTEL_BACKEND_OTLP_HTTP_ENDPOINT`). Default loopback until a Tempo/Jaeger/vendor URL is set — see `docs/operations/otel-collector.md` |
| **Prometheus + Alertmanager** | in-cluster (`monitoring` ns) | **Optional** kustomize root `deploy/monitoring/` (not part of this base/overlays path). Reuses `deploy/monitoring/prometheus/{prometheus,alerts}.yml`. Apply: `kubectl apply -k deploy/monitoring` after creating `nomarkup-metrics-token`. See [`docs/operations/monitoring-stack.md`](../../docs/operations/monitoring-stack.md) (OPS-10 Partial). |
| **PostgreSQL 16 + PostGIS** | **external managed service** (by design) | no Deployment/StatefulSet in this repo. Services receive `DATABASE_URL` from the Vault-sourced `nomarkup-secrets` Secret (`SECRETS.md`) |
| **Redis 7** (Cluster in prod) | **external managed service** (by design) | no manifest. Services receive `REDIS_URL` from `nomarkup-secrets` |
| MinIO / S3 | external (AWS S3 in prod; MinIO only for local dev) | `S3_*` keys in `nomarkup-secrets` |

Note: `base/pvc.yaml` still declares `postgres-data` / `minio-data` PVCs. They
exist for dev/spike clusters only — **no workload in this repo mounts them**;
production data stores are the managed services above. The only PVC consumed
in-cluster is `meili-data` (Meilisearch index storage).

## Image pinning + the deploy gate

- Base manifests reference `ghcr.io/nomarkup/<name>:latest` (dev-friendly
  default). **Overlays pin explicit tags** so a rendered prod/staging apply
  never ships floating `:latest`:
  - **Production** (`overlays/production`): every image is tagged
    `require-ci-stamp` — intentionally not a pullable release. This is
    fail-closed for accidental `kubectl apply -k` (OPS-08).
  - **Staging** (`overlays/staging`): placeholder `v0.1.0` until CI stamps a
    real tag (non-prod may still use base `:latest` only if you apply `base/`
    directly — do not do that for shared clusters).
- Image **names** in overlays match the base: `ghcr.io/nomarkup/<svc>`. At
  deploy time CI rewrites name **and** tag to the OPS-21 / deploy.yml push
  path:

  ```text
  ghcr.io/<github.repository_owner>/nomarkup/<svc>:<VERSION|sha8>
  ```

  ```bash
  cd deploy/k8s/overlays/production
  for img in gateway web user job payment chat notification \
             bidding fraud imaging pricing trust underwriting migrate; do
    kustomize edit set image \
      "ghcr.io/nomarkup/${img}=ghcr.io/${OWNER}/nomarkup/${img}:${RELEASE_TAG}"
  done
  ```

  Optional registry overrides: `vars.DOCKER_REGISTRY`, `vars.DOCKER_IMAGE_PREFIX`
  (same as main-branch push in `ci.yml`).

- `.github/workflows/deploy.yml` is **fail-closed** until
  `DEPLOY_PROVISIONED=true`. When provisioned **and** secrets `KUBE_CONFIG` +
  `REGISTRY_PASSWORD` are present, it build/pushes images, stamps the overlay,
  runs the `db-migrate-<version>` Job, then `kubectl apply -k overlays/production`.
  Missing credentials after the gate is flipped fails with a clear error
  (no echo-only success path).

- **Google OAuth client ID** is not a ConfigMap literal in production. Provision
  `GOOGLE_CLIENT_ID` (and confidential `GOOGLE_CLIENT_SECRET`) into
  `nomarkup-secrets` — see [`SECRETS.md`](./SECRETS.md). Do not invent or
  commit real Google client credentials.

## Secrets (OPS-04 Partial)

All runtime secrets (including `DATABASE_URL` / `REDIS_URL` for the managed
Postgres and Redis) come from the `nomarkup-secrets` Secret, provisioned
**out-of-band** — nothing in this repo creates live credentials.

| Pattern | Sample | Status |
|---|---|---|
| ESO → Vault (preferred) | [`base/externalsecret.sample.yaml`](./base/externalsecret.sample.yaml) | Explicit `data:` remoteRefs for **METRICS**, **JWT**, **STRIPE**, **GOOGLE** + second ExternalSecret for `monitoring/nomarkup-metrics-token` |
| Sealed Secrets (gitops fallback) | [`base/sealedsecret.sample.yaml`](./base/sealedsecret.sample.yaml) | `kubeseal` workflow; empty `encryptedData` until sealed against the cluster cert |

Full key list + rotation: [`SECRETS.md`](./SECRETS.md). **Founder still wires
Vault / controller and stores real values** before first deploy — samples are
not applied by kustomize.

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

In production `/metrics` is *also* bearer-gated (`protectMetrics`, SEC-08): a
non-loopback request with no `Authorization: Bearer <token>` gets **401**.
Because Prometheus scrapes cross-pod from the `monitoring` namespace, the token
must be configured on **both** sides or all gateway-derived alerts go dark
without warning:

- gateway: `METRICS_BEARER_TOKEN` from `nomarkup-secrets` (explicit
  `secretKeyRef`, non-optional — see [`SECRETS.md`](./SECRETS.md))
- Prometheus: same value mounted as a file, referenced by `authorization:` on
  the `kubernetes-pods` job in `deploy/monitoring/prometheus/prometheus.yml`
  (Deployment: `deploy/monitoring/k8s/prometheus-deployment.yaml` mounts
  Secret `nomarkup-metrics-token`)

Do **not** "fix" a 401 by setting `METRICS_PUBLIC=true` — that serves metrics
unauthenticated to anything that can reach the pod.

Full apply/verify/residuals:
[`docs/operations/monitoring-stack.md`](../../docs/operations/monitoring-stack.md).

## Health vs readiness probes

`livenessProbe` and `readinessProbe` are deliberately **not** the same endpoint
where dependency-aware HTTP health exists:

### Gateway (HTTP :8080)

- liveness → `/health` (alias of `/healthz`), unconditional 200. Dependency-
  **independent** on purpose: a Postgres/Redis blip must not restart every pod.
- readiness → `/readyz`, pings Postgres + Redis (1s) and 503s on failure so the
  pod leaves Service endpoints instead of serving errors.

### Go services (HTTP metrics port = SERVICE_PORT+1000)

user / job / payment / chat / notification expose the same contract on the
observability listener (`docs/operations/metrics.md`):

| Service      | Metrics port | Liveness   | Readiness checks        |
|--------------|-------------:|------------|-------------------------|
| user         | 51051        | `/healthz` | Postgres + Redis        |
| job          | 51052        | `/healthz` | Postgres                |
| payment      | 51054        | `/healthz` | Postgres                |
| chat         | 51055        | `/healthz` | Postgres + Redis        |
| notification | 51059        | `/healthz` | Postgres                |

Probes use `httpGet` against the named `metrics` containerPort — **not** the
gRPC `Health/Check` RPC. gRPC health is set to `SERVING` once at boot and never
tracks DB/Redis, so a pod with a dead database would stay Ready forever under
a gRPC readiness probe.

### Rust engines (gRPC-only health — do not force HTTP)

bidding / fraud / trust / imaging / underwriting / pricing have Prometheus on
gRPC port + 10000 where wired, but **no** dependency-checking HTTP `/readyz`.
They keep `grpc:` liveness + readiness probes. Do not point k8s at their
metrics port for readiness — process-up is the available signal until a deep
health path ships.

Never point liveness at `/readyz`, and never point readiness at `/health(z)`.
The `web` Deployment probes `/robots.txt` as an interim target because the
Next.js app has no health route yet (see the TODO in `base/web/deployment.yaml`).

## NetworkPolicy

- **Ingress:** `base/network-policy.yaml` — default-deny ingress + allowlists
  (ingress-nginx → gateway/web, mesh least-privilege, Prometheus scrape).
- **Egress (OPS-19):** `base/network-policy-egress.yaml` — default-deny egress +
  DNS, in-namespace mesh, managed Postgres/Redis ports, public HTTPS (Stripe /
  S3 / OAuth / Sentry / push) with RFC1918 + IMDS carved out, OTel backend.

Stripe/S3 CIDRs are intentionally broad (public `:443` with private carve-outs);
Postgres/Redis allow TCP 5432/6379/6380 world-open except loopback/IMDS until the
VPC CIDR is known — overlay-patch then. Full matrix + smoke checklist:
[`docs/operations/network-policy-egress.md`](../../docs/operations/network-policy-egress.md).

Enforcement needs a NetworkPolicy-capable CNI. kind’s default kindnet does not
enforce these rules.

## Staging isolation (no `namePrefix`)

Staging uses **namespace isolation only** (`nomarkup-staging` vs production
`nomarkup`). There is intentionally **no** `namePrefix` on the staging overlay.

Base Deployments hardcode Service DNS hostnames (`user:50051`, `job:50052`,
`bidding:50053`, …) and ConfigMap literals use short names
(`http://meilisearch:7700`, `http://otel-collector:4317`). Kustomize rewrites
Kubernetes nameReferences (ingress backends, `configMapRef` / `secretKeyRef`)
under a prefix, but **not** those string hostnames — a `namePrefix: staging-`
would rename Services to `staging-user` while clients still dial `user:…` and
break the entire mesh (OPS-20). Keep Service names stable within each
namespace; never reintroduce a prefix without also rewriting every
`*_SERVICE_ADDR` / `*_ENGINE_ADDR` / Meili / OTel URL.
