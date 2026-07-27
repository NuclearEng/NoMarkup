# In-cluster Prometheus + Alertmanager (OPS-10)

Minimal stack that scrapes annotated NoMarkup pods (especially gateway
`/metrics`) using the configs already under `deploy/monitoring/`. **Not**
wired into `deploy/k8s/base` — apply separately so app deploys do not depend
on the monitoring namespace.

| Piece | Path |
|-------|------|
| Kustomize root | `deploy/monitoring/kustomization.yaml` |
| Prometheus config + rules | `deploy/monitoring/prometheus/prometheus.yml`, `alerts.yml` |
| Alertmanager config | `deploy/monitoring/alertmanager/alertmanager.yml` |
| Manifests | `deploy/monitoring/k8s/*` |
| Grafana dashboards (optional, not deployed) | `deploy/monitoring/grafana/` |

## Prerequisites

1. App mesh running in namespace `nomarkup` (gateway Deployment with
   `prometheus.io/scrape: "true"` / port `8080` / path `/metrics`).
2. NetworkPolicy-capable CNI so `allow-prometheus-scrape` in
   `deploy/k8s/base/network-policy.yaml` permits ingress from namespace
   `monitoring` (label `kubernetes.io/metadata.name: monitoring`).
3. **Matching metrics bearer token on both sides** (SEC-08):

```bash
# Same value as nomarkup-secrets/METRICS_BEARER_TOKEN in namespace nomarkup.
# Generate once if needed:  openssl rand -base64 32
export TOKEN='…'   # do not commit

kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic nomarkup-metrics-token \
  --from-literal=METRICS_BEARER_TOKEN="$TOKEN" \
  --namespace=monitoring \
  --dry-run=client -o yaml | kubectl apply -f -
```

Without this Secret the Prometheus pod will not schedule (volume mount is
required). A token mismatch yields **401** on gateway scrapes and every
`http_requests_total`-based alert stays dark.

## Apply

```bash
# Render
kubectl kustomize deploy/monitoring

# Deploy
kubectl apply -k deploy/monitoring
```

Images are public (`prom/prometheus:v2.51.0`, `prom/alertmanager:v0.27.0`) —
same pins as `docker-compose.yml`. No GHCR pull secrets required for this
stack.

## Verify scrape (gateway)

```bash
# Wait for Ready
kubectl -n monitoring rollout status deploy/prometheus
kubectl -n monitoring rollout status deploy/alertmanager

# Port-forward Prometheus UI
kubectl -n monitoring port-forward svc/prometheus 9090:9090

# Targets: kubernetes-pods job should show gateway pods UP
open http://localhost:9090/targets

# Series from the gateway
curl -sG 'http://localhost:9090/api/v1/query' \
  --data-urlencode 'query=up{job="kubernetes-pods",service="gateway"}' | jq .

curl -sG 'http://localhost:9090/api/v1/query' \
  --data-urlencode 'query=http_requests_total' | jq '.data.result | length'
```

Alertmanager (blackhole receiver by default — no external page):

```bash
kubectl -n monitoring port-forward svc/alertmanager 9093:9093
# UI: http://localhost:9093
```

## What works when applied correctly

- **Pod SD scrape** of anything in `nomarkup` with `prometheus.io/*`
  annotations (gateway, Go services, Rust engines).
- **Bearer auth** on the `kubernetes-pods` job via
  `/etc/prometheus/secrets/metrics-bearer-token`.
- **Rule evaluation** from `alerts.yml` (recording + alerting groups).
- **Alertmanager fan-in** at `alertmanager:9093` (same-namespace Service;
  matches the static target in `prometheus.yml`).

## Residuals (why OPS-10 is Partial, not Done)

| Residual | Impact |
|----------|--------|
| **Not cluster-proven** while `DEPLOY_PROVISIONED` is off | Manifests + configs are complete for scrape; no live “alerts fire on test” proof in this repo’s CI. |
| **No TSDB / AM persistence** | `emptyDir` only — history and silences lost on pod restart. Add a PVC later if needed. |
| **Alertmanager blackhole receiver** | Alerts evaluate and show in UIs; nothing pages until Slack/PagerDuty (or similar) is configured from a Secret. |
| **No kube-state-metrics Deployment** | Jobs `kube-state-metrics` stay DOWN. Rules using `kube_deployment_*` / `kube_pod_*` (e.g. `NoMarkupGatewayDown`) cannot fire until KSM is installed. |
| **Node / cAdvisor jobs** | Need working kubelet proxy + RBAC; often noisy or partial on managed clusters. Not required for gateway HTTP metrics. |
| **Grafana not deployed** | Dashboards under `deploy/monitoring/grafana/` are file-only; optional follow-up. |
| **Staging namespace** | `prometheus.yml` SD lists `nomarkup` only. For `nomarkup-staging`, patch the job namespaces list (overlay or ConfigMap edit). |
| **DB exporter alerts** | Still disabled in `alerts.yml` (see comments there); not part of this stack. |

## Grafana (optional, not in kustomization)

To add later: Grafana Deployment + Service, ConfigMap-mount
`deploy/monitoring/grafana/provisioning/` and dashboards, datasource URL
`http://prometheus:9090`. Keep it out of the critical scrape path.

## Rotate `METRICS_BEARER_TOKEN`

1. Update `nomarkup-secrets` (gateway namespace) and `nomarkup-metrics-token`
   (monitoring) to the **same** new value.
2. `kubectl -n nomarkup rollout restart deploy/gateway`
3. `kubectl -n monitoring rollout restart deploy/prometheus`
4. Confirm `up{job="kubernetes-pods",service="gateway"} == 1`.

Never set `METRICS_PUBLIC=true` as a workaround.

## Related

- `deploy/k8s/README.md` — gateway `/metrics` exposure + scrape ports
- `deploy/k8s/SECRETS.md` — token both-sides contract
- `docs/operations/metrics.md` — endpoint map
- `deploy/monitoring/prometheus/alerts.yml` — rule definitions
