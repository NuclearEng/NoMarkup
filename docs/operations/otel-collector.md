# OpenTelemetry Collector — backend export (OPS-09)

In-cluster collector that receives OTLP from app pods and dual-exports to
**debug** (always) plus **OTLP/HTTP** (`otlphttp/backend`) when a real endpoint
is configured.

| Role | Address |
|------|---------|
| Apps → collector (gRPC) | `http://otel-collector:4317` (`OTEL_EXPORTER_OTLP_ENDPOINT` on services) |
| Apps → collector (HTTP) | `http://otel-collector:4318` |
| Collector → backend | ConfigMap `otel-collector-backend` → `OTEL_BACKEND_OTLP_HTTP_ENDPOINT` |
| Optional Tempo lite | `http://tempo.monitoring.svc.cluster.local:4318` (OTLP/HTTP) |

Manifests:

| Path | Purpose |
|------|---------|
| `deploy/k8s/base/otel-collector/configmap.yaml` | Collector pipeline (`debug` + `otlphttp/backend`) |
| `deploy/k8s/base/otel-collector/backend-configmap.yaml` | Backend URL + TLS insecure flag (base default: loopback) |
| `deploy/k8s/base/otel-collector/deployment.yaml` | Env wiring from backend ConfigMap |
| `deploy/k8s/base/otel-collector/service.yaml` | ClusterIP 4317/4318 |
| `deploy/monitoring/k8s/tempo-*.yaml` + `tempo/tempo.yaml` | Optional single-binary Tempo lite |
| `deploy/k8s/overlays/staging/otel-backend-patch.yaml` | Staging points collector at Tempo |

Local docker-compose still points services **directly** at Jaeger
(`OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4317`) and does not use this
k8s collector. That is intentional for local DX.

## Default behaviour (base / production overlay)

`backend-configmap.yaml` ships:

```yaml
OTEL_BACKEND_OTLP_HTTP_ENDPOINT: "http://127.0.0.1:4318"
OTEL_BACKEND_OTLP_TLS_INSECURE: "true"
```

The collector **starts and stays Ready**. Traces always appear in collector
pod logs via the `debug` exporter. The `otlphttp/backend` exporter retries
briefly against loopback and drops — expected until you set a real URL.
**No SaaS account or credentials are required for the cluster to boot.**

Production keeps this loopback default until an operator points at a durable
backend (HA Tempo, Grafana Cloud, Honeycomb, etc.). That choice is
**Founder residual** (account, URL, auth Secret) — see below.

## Staging path (recommended): dual-export → Tempo lite

Staging overlay patches the backend ConfigMap to the optional in-cluster Tempo:

```text
http://tempo.monitoring.svc.cluster.local:4318
```

### Apply order

```bash
# 1) Optional observability stack (Prometheus + Grafana + Tempo lite)
#    Requires nomarkup-metrics-token first — docs/operations/monitoring-stack.md
kubectl apply -k deploy/monitoring

# 2) App mesh (staging) — includes otel-collector + backend patch → Tempo
kubectl apply -k deploy/k8s/overlays/staging

# 3) Restart collector if the ConfigMap changed after the first apply
kubectl -n nomarkup-staging rollout restart deployment/otel-collector
```

### View traces

```bash
# Grafana Explore → datasource Tempo
kubectl -n monitoring port-forward svc/grafana 3000:3000
# http://localhost:3000  (admin/admin or anonymous Viewer)

# Or Tempo HTTP API directly
kubectl -n monitoring port-forward svc/tempo 3200:3200
```

Tempo lite is **single-replica, local disk (`emptyDir`), 48h retention** — fine
for staging/smoke, **not** a production durability story. Traces are lost on
pod restart.

## Production / vendor backend

Pick any OTLP/HTTP-compatible store. **Do not commit real credentials.**

### Option A — patch the ConfigMap

```bash
kubectl -n nomarkup apply -f - <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-backend
  namespace: nomarkup
  labels:
    app.kubernetes.io/name: otel-collector
    app.kubernetes.io/component: observability
    app.kubernetes.io/part-of: nomarkup
data:
  # Self-hosted HA Tempo / vendor examples (operator supplies real DNS):
  OTEL_BACKEND_OTLP_HTTP_ENDPOINT: "http://tempo.observability.svc.cluster.local:4318"
  OTEL_BACKEND_OTLP_TLS_INSECURE: "true"
  # Vendor HTTPS example:
  # OTEL_BACKEND_OTLP_HTTP_ENDPOINT: "https://otlp-gateway.example.com"
  # OTEL_BACKEND_OTLP_TLS_INSECURE: "false"
EOF

kubectl -n nomarkup rollout restart deployment/otel-collector
```

### Option B — production overlay strategic merge

```yaml
# deploy/k8s/overlays/production/otel-backend-patch.yaml  (create when ready)
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-backend
data:
  OTEL_BACKEND_OTLP_HTTP_ENDPOINT: "https://otlp-gateway.example.com"
  OTEL_BACKEND_OTLP_TLS_INSECURE: "false"
```

```yaml
# in production kustomization.yaml
patches:
  - path: otel-backend-patch.yaml
```

### Option C — one-shot kubectl

```bash
kubectl -n nomarkup create configmap otel-collector-backend \
  --from-literal=OTEL_BACKEND_OTLP_HTTP_ENDPOINT='http://tempo.monitoring.svc:4318' \
  --from-literal=OTEL_BACKEND_OTLP_TLS_INSECURE='true' \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n nomarkup rollout restart deployment/otel-collector
```

## Vendor auth (optional)

Base config does **not** send an `Authorization` header (avoids empty Bearer
tokens). The Deployment already mounts optional env
`OTEL_BACKEND_OTLP_AUTH_HEADER` from Secret
`otel-collector-backend-auth` key `Authorization` (optional: true).

To use it:

1. Create the Secret (value is the full header value, e.g. `Basic …` or `Bearer …`):

```bash
kubectl -n nomarkup create secret generic otel-collector-backend-auth \
  --from-literal=Authorization='Bearer REPLACE_ME' \
  --dry-run=client -o yaml | kubectl apply -f -
```

2. Patch the collector pipeline ConfigMap to pass the header into
   `otlphttp/backend`:

```yaml
exporters:
  otlphttp/backend:
    endpoint: ${env:OTEL_BACKEND_OTLP_HTTP_ENDPOINT:-http://127.0.0.1:4318}
    headers:
      Authorization: ${env:OTEL_BACKEND_OTLP_AUTH_HEADER}
    # …rest unchanged
```

3. Restart the collector Deployment.

Prefer ExternalSecrets / Vault for the Secret in production (OPS-04 Founder-Action —
see `deploy/k8s/base/externalsecret.sample.yaml` + `SECRETS.md`; Founder still
wires Vault). Never commit tokens.

## Verify

```bash
# Collector healthy
kubectl -n nomarkup get pods -l app.kubernetes.io/name=otel-collector
kubectl -n nomarkup logs -l app.kubernetes.io/name=otel-collector --tail=50

# Env actually injected
kubectl -n nomarkup exec deploy/otel-collector -- printenv \
  OTEL_BACKEND_OTLP_HTTP_ENDPOINT OTEL_BACKEND_OTLP_TLS_INSECURE

# Tempo Ready (when monitoring stack applied)
kubectl -n monitoring rollout status deploy/tempo
kubectl -n monitoring logs -l app.kubernetes.io/name=tempo --tail=30
```

Debug exporter always prints span summaries when traffic hits the gateway.
After pointing at Tempo or a vendor, confirm spans in Grafana Explore (Tempo)
or the vendor UI.

## What this does **not** do

- It does **not** ship production HA Tempo, object-store backend, or multi-tenant
  auth. Lite Tempo is staging/smoke only.
- It does **not** ship production SaaS credentials or a production overlay URL
  (Founder chooses vendor/HA endpoint and wires Secret).
- Production base remains loopback until that ConfigMap is patched.

## Founder residual (production durability)

| Item | Owner |
|------|--------|
| Choose durable OTLP backend (Grafana Cloud / Honeycomb / HA Tempo) | Founder |
| Set `OTEL_BACKEND_OTLP_HTTP_ENDPOINT` (+ TLS flag) on production | Founder / ops |
| Create `otel-collector-backend-auth` if vendor needs `Authorization` | Founder / Vault |
| Optional: promote Tempo beyond emptyDir (PVC, object storage, replicas) | Eng follow-up if self-hosting |

Engineering path is complete: dual-export defaults on, backend ConfigMap is
env-driven, staging targets Tempo lite, docs cover vendor auth and NetPol.

## Related

- App OTLP env: overlays set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317`
- Monitoring stack (Tempo + Grafana): `docs/operations/monitoring-stack.md`
- NetworkPolicy ingress to collector: `allow-mesh-otel-collector` in
  `deploy/k8s/base/network-policy.yaml`.
- NetworkPolicy egress (OPS-19): `allow-egress-https-public` +
  `allow-egress-otel-backend` in `deploy/k8s/base/network-policy-egress.yaml`
  admit collector → public HTTPS OTLP gateways and cross-namespace OTLP
  4317/4318. If the backend uses another port/CIDR, patch that policy before
  flipping the backend URL or traces black-hole. See
  `docs/operations/network-policy-egress.md`.
- Tempo ingress NetPol: `deploy/monitoring/k8s/tempo-network-policy.yaml`
  (collector in `nomarkup` / `nomarkup-staging` → Tempo OTLP; Grafana → query).
- Local Jaeger: `docker-compose.yml` service `jaeger` (ports 16686 UI, 4317 OTLP)
