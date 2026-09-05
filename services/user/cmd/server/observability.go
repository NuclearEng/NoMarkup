package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
)

// startObservabilityServer launches a separate HTTP server exposing
// /healthz, /readyz, and /metrics on its own port. Keeping observability
// off the gRPC port lets ops scrape Prometheus and run k8s probes without
// touching the business-traffic listener.
//
// Liveness (/healthz) — process can respond. Always 200 if the loop is up.
// Readiness (/readyz) — backing dependencies (PostgreSQL, Redis) are reachable
//                       within a 1s deadline. Returns 503 otherwise so the
//                       service is removed from rotation while still allowing
//                       the pod itself to live (avoids restart storms).
// Metrics  (/metrics)  — Prometheus exposition (default registry).
//
// METRICS_PORT defaults to {SERVICE_PORT}+1000. Set explicitly in production
// to keep ports stable across deployments. When unset and SERVICE_PORT is
// non-numeric, falls back to 9100.
func startObservabilityServer(
	ctx context.Context,
	serviceName string,
	servicePort string,
	pool *pgxpool.Pool,
	rdb *redis.Client,
) {
	metricsPort := os.Getenv("METRICS_PORT")
	if metricsPort == "" {
		if p, err := strconv.Atoi(servicePort); err == nil {
			metricsPort = strconv.Itoa(p + 1000)
		} else {
			metricsPort = "9100"
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "ok",
			"service": serviceName,
		})
	})

	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		probeCtx, cancel := context.WithTimeout(r.Context(), 1*time.Second)
		defer cancel()

		checks := map[string]string{}
		ready := true

		if pool != nil {
			if err := pool.Ping(probeCtx); err != nil {
				checks["postgres"] = "unhealthy: " + err.Error()
				ready = false
			} else {
				checks["postgres"] = "ok"
			}
		}
		if rdb != nil {
			if err := rdb.Ping(probeCtx).Err(); err != nil {
				checks["redis"] = "unhealthy: " + err.Error()
				ready = false
			} else {
				checks["redis"] = "ok"
			}
		}

		status := http.StatusOK
		body := map[string]any{"status": "ready", "service": serviceName, "checks": checks}
		if !ready {
			status = http.StatusServiceUnavailable
			body["status"] = "not_ready"
		}
		writeJSON(w, status, body)
	})

	mux.Handle("/metrics", promhttp.Handler())

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%s", metricsPort),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		slog.Info("observability server starting", "port", metricsPort, "service", serviceName)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("observability server error", "error", err)
		}
	}()

	// Shut down with the parent context.
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
