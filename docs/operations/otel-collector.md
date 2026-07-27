# OpenTelemetry Collector — backend export (OPS-09)

In-cluster collector that receives OTLP from app pods and dual-exports to
**debug** (always) plus an optional **OTLP/HTTP** backend when configured.

| Role | Address |
|------|---------|
| Apps → collector (gRPC) | `http://otel-collector:4317` (`OTEL_EXPORTER_OTLP_ENDPOINT` on services) |
| Apps → collector (HTTP) | `http://otel-collector:4318` |
| Collector → backend | ConfigMap `otel-collector-backend` → `OTEL_BACKEND_OTLP_HTTP_ENDPOINT` |

Manifests:

| Path | Purpose |
|------|---------|
| `deploy/k8s/base/otel-collector/configmap.yaml` | Collector pipeline (`debug` + `otlphttp/backend`) |
| `deploy/k8s/base/otel-collector/backend-configmap.yaml` | Backend URL + TLS insecure flag |
| `deploy/k8s/base/otel-collector/deployment.yaml` | Env wiring from backend ConfigMap |
| `deploy/k8s/base/otel-collector/service.yaml` | ClusterIP 4317/4318 |

Local docker-compose still points services **directly** at Jaeger
(`OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4317`) and does not use this
k8s collector. That is intentional for local DX.

## Default behaviour (no backend provisioned)

`backend-configmap.yaml` ships:

```yaml
OTEL_BACKEND_OTLP_HTTP_ENDPOINT: "http://127.0.0.1:4318"
OTEL_BACKEND_OTLP_TLS_INSECURE: "true"
```

The collector **starts and stays Ready**. Traces always appear in collector
pod logs via the `debug` exporter. The `otlphttp/backend` exporter retries
briefly against loopback and drops — expected until you set a real URL.
**No SaaS account or credentials are required for the cluster to boot.**

## Enable a real backend (staging)

Pick any OTLP/HTTP-compatible store (self-hosted Tempo/Jaeger, or a vendor
gateway you already have). **Do not commit real credentials.**

### Option A — patch the ConfigMap (recommended for staging)

Edit `deploy/k8s/base/otel-collector/backend-configmap.yaml` in a staging
overlay, or apply:

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
  # Self-hosted examples (operator supplies real service DNS):
  OTEL_BACKEND_OTLP_HTTP_ENDPOINT: "http://tempo.observability.svc.cluster.local:4318"
  OTEL_BACKEND_OTLP_TLS_INSECURE: "true"
  # Vendor HTTPS example (replace host; set insecure false):
  # OTEL_BACKEND_OTLP_HTTP_ENDPOINT: "https://otlp-gateway.example.com"
  # OTEL_BACKEND_OTLP_TLS_INSECURE: "false"
EOF

kubectl -n nomarkup rollout restart deployment/otel-collector
```

### Option B — staging kustomize overlay

In `deploy/k8s/overlays/staging/kustomization.yaml`, add a strategic merge
or JSON6902 patch that replaces the two keys on
`ConfigMap/otel-collector-backend`. Example strategic merge file:

```yaml
# deploy/k8s/overlays/staging/otel-backend-patch.yaml  (create when ready)
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-backend
data:
  OTEL_BACKEND_OTLP_HTTP_ENDPOINT: "http://tempo.observability.svc.cluster.local:4318"
  OTEL_BACKEND_OTLP_TLS_INSECURE: "true"
```

```yaml
# in kustomization.yaml
patchesStrategicMerge:
  - otel-backend-patch.yaml
```

Then:

```bash
kubectl apply -k deploy/k8s/overlays/staging
```

### Option C — one-shot kubectl set (quick smoke)

```bash
kubectl -n nomarkup create configmap otel-collector-backend \
  --from-literal=OTEL_BACKEND_OTLP_HTTP_ENDPOINT='http://tempo.observability.svc:4318' \
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

Prefer ExternalSecrets / Vault for the Secret in production (OPS-04 /
OPS-25). Never commit tokens.

## Verify

```bash
# Collector healthy
kubectl -n nomarkup get pods -l app.kubernetes.io/name=otel-collector
kubectl -n nomarkup logs -l app.kubernetes.io/name=otel-collector --tail=50

# Debug exporter should print span summaries when traffic hits the gateway
# After pointing at a real backend, confirm spans in that UI (Tempo Explore,
# Jaeger UI, vendor dashboard).

# Env actually injected
kubectl -n nomarkup exec deploy/otel-collector -- printenv \
  OTEL_BACKEND_OTLP_HTTP_ENDPOINT OTEL_BACKEND_OTLP_TLS_INSECURE
```

## What this does **not** do

- It does **not** deploy Tempo, Jaeger, Grafana, or any SaaS account.
- It does **not** ship production credentials.
- Traces are **not** durable until `OTEL_BACKEND_OTLP_HTTP_ENDPOINT` points at
  a live OTLP/HTTP receiver. Until then, status remains **Partial** on OPS-09.

## Related

- App OTLP env: overlays set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317`
- NetworkPolicy ingress to collector: `allow-mesh-otel-collector` in
  `deploy/k8s/base/network-policy.yaml`.
- NetworkPolicy egress (OPS-19): `allow-egress-https-public` +
  `allow-egress-otel-backend` in `deploy/k8s/base/network-policy-egress.yaml`
  admit collector → public HTTPS OTLP gateways and cross-namespace OTLP
  4317/4318. If the backend uses another port/CIDR, patch that policy before
  flipping the backend URL or traces black-hole. See
  `docs/operations/network-policy-egress.md`.
- Local Jaeger: `docker-compose.yml` service `jaeger` (ports 16686 UI, 4317 OTLP)
