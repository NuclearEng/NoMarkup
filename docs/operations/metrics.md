# Prometheus Metrics — Endpoints & Catalog

> One scrape target per service. Metrics live on a separate HTTP port
> (default `SERVICE_PORT + 1000`) so Prometheus polling never competes
> with business traffic on the gRPC / HTTP API port.

## Endpoint Map

| Service             | Service Port (default) | Metrics Port (default) | Endpoint           |
|---------------------|-----------------------:|-----------------------:|--------------------|
| API Gateway         | 8080 (HTTP)            | 8080 (same listener)   | `/metrics`         |
| User Service        | 50051 (gRPC)           | 51051                  | `/metrics`         |
| Job Service         | 50052 (gRPC)           | 51052                  | `/metrics`         |
| Bidding Engine      | 50053 (gRPC)           | 60053                  | `/metrics`         |
| Payment Service     | 50054 (gRPC)           | 51054                  | `/metrics`         |
| Chat Service        | 50055 (gRPC)           | 51055                  | `/metrics`         |
| Fraud Engine        | 50056 (gRPC)           | 60056                  | `/metrics`         |
| Trust Engine        | 50057 (gRPC)           | 60057                  | `/metrics`         |
| Imaging Service     | 50058 (gRPC)           | 60058                  | `/metrics`         |
| Notification Service| 50059 (gRPC)           | 51059                  | `/metrics`         |

`METRICS_PORT` env var overrides the default per Go service. The Rust
engines use dedicated env vars (`BIDDING_METRICS_PORT`, `FRAUD_METRICS_PORT`,
`TRUST_METRICS_PORT`, `IMAGING_METRICS_PORT`); leaving any of them unset
disables that engine's `/metrics` listener (gRPC health remains available).

> **Rust engines port convention:** gRPC port + 10000 (rather than +1000
> like the Go services) so the Rust metrics listeners cannot collide with
> the Go services' `51xxx` band. Each Rust engine runs the Prometheus
> exposition on a `hyper` HTTP server spawned alongside the gRPC server.

## Required Metrics (per CLAUDE.md §11)

| Metric                                            | Where exposed              | Status     |
|--------------------------------------------------|----------------------------|------------|
| `http_requests_total{method,path,status}`         | Gateway                    | Implemented |
| `http_request_duration_seconds{method,path}`      | Gateway                    | Implemented |
| `feature_flag_checks_total{flag,result}`          | Gateway                    | Implemented (ARC-10 exposure) |
| `experiment_exposures_total{key,variant}`         | Gateway                    | Implemented (ARC-10 exposure) |
| `grpc_requests_total{service,method,status}`      | Gateway (outbound)         | Wired (interceptor TODO)*  |
| `grpc_request_duration_seconds{service,method}`   | Gateway (outbound)         | Wired (interceptor TODO)*  |
| `bid_processing_duration_seconds`                 | Bidding engine (60053)     | Implemented (place_bid + award_bid timers) |
| `bids_awarded_total`                              | Bidding engine (60053)     | Implemented (incremented on award) |
| `trust_score_computation_duration_seconds`        | Trust engine (60057)       | Implemented (compute_score timer) |
| `trust_scores_recomputed_total`                   | Trust engine (60057)       | Implemented (incremented on persist) |
| `fraud_scoring_duration_seconds`                  | Fraud engine (60056)       | Implemented (check_transaction/registration/bid) |
| `fraud_alerts_created_total`                      | Fraud engine (60056)       | Implemented (incremented on alert threshold) |
| `image_processing_duration_seconds`               | Imaging engine (60058)     | Implemented (process_image timer) |
| `images_processed_total`                          | Imaging engine (60058)     | Implemented (incremented on success) |
| `active_websocket_connections`                    | Chat service               | Implemented (gauge sampled every 10s) |
| `stripe_webhook_processing_duration_seconds`      | Payment service            | Implemented (helper exported; observers TODO at call sites) |

\* Counters/histograms are registered in
`gateway/internal/middleware/metrics.go`. The unary client interceptor
that records observations on each outbound gRPC call is not yet wired —
add `grpc.WithUnaryInterceptor(metricsInterceptor(...))` to each
`grpc.NewClient` in `gateway/cmd/server/main.go` to activate.

## Scrape Configuration (Prometheus)

```yaml
scrape_configs:
  - job_name: nomarkup-gateway
    static_configs:
      - targets: ['gateway:8080']
    metrics_path: /metrics

  - job_name: nomarkup-services
    kubernetes_sd_configs:
      - role: pod
        namespaces: { names: [nomarkup] }
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app_kubernetes_io_name]
        action: keep
        regex: (user|job|payment|chat|notification)
      - source_labels: [__meta_kubernetes_pod_container_port_number]
        action: keep
        regex: '510(51|52|54|55|59)'
      - source_labels: [__meta_kubernetes_pod_label_app_kubernetes_io_name]
        target_label: service
```

## Health Probes

In addition to `/metrics`, every Go service exposes:
- `/healthz` — liveness (always 200 if process is running)
- `/readyz`  — readiness (200 only if backing dependencies are reachable;
              503 when DB or Redis is down so k8s removes the pod from rotation
              without restarting it)

Use `/readyz` for Kubernetes `readinessProbe` and `/healthz` for
`livenessProbe`. The Rust engines respond to `grpc.health.v1.Health/Check` —
configure k8s with `grpc_health_probe` or use a `grpc:` probe directly
(k8s 1.24+).

## Verifying

```bash
# Locally:
curl -s http://localhost:8080/metrics | head -20            # gateway
curl -s http://localhost:51051/healthz                       # user service
curl -s http://localhost:51051/readyz | jq .
curl -s http://localhost:51051/metrics | grep http_requests  # user service

# In cluster:
kubectl port-forward -n nomarkup deployment/user 51051:51051 &
curl -s http://localhost:51051/readyz

# Rust engine:
grpc_health_probe -addr=bidding.nomarkup.svc.cluster.local:50053
curl -s http://localhost:60053/metrics | grep bid_processing_duration   # bidding
curl -s http://localhost:60056/metrics | grep fraud_scoring_duration    # fraud
curl -s http://localhost:60057/metrics | grep trust_score_computation   # trust
curl -s http://localhost:60058/metrics | grep image_processing_duration # imaging
```

### SLO Bucket Layout

Each engine's histogram buckets are tuned to its CLAUDE.md §8 latency budget:

| Engine   | p99 budget | Buckets (seconds)                                |
|----------|-----------:|--------------------------------------------------|
| Bidding  | < 1ms      | 0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05         |
| Trust    | < 5ms      | 0.001, 0.005, 0.01, 0.05, 0.1                    |
| Fraud    | < 50ms     | 0.005, 0.01, 0.05, 0.1, 0.5, 1.0                 |
| Imaging  | < 200ms    | 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0               |

## Cardinality Discipline

The gateway's `http_request_duration_seconds` histogram replaces UUIDs and
numeric IDs in the path with `{id}` to keep label cardinality bounded
(see `normalizePath` in `gateway/internal/middleware/metrics.go`). Do NOT
add new labels with unbounded values (e.g. raw user IDs, full URLs).
