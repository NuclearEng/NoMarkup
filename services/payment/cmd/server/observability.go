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
)

// stripe_webhook_processing_duration_seconds and
// stripe_webhook_event_lag_seconds used to be declared here, in package main,
// alongside an ObserveStripeWebhook recorder that no package could import and
// that consequently had zero call sites. They now live in
// internal/observability and are recorded by the code that actually processes
// the events -- internal/service/webhook.go, immediately around its mandatory
// stripe.webhooks.constructEvent() verification. They still appear on this
// server's /metrics because promauto registers them on the default registry.

// startObservabilityServer launches the observability HTTP server.
// See user service for full rationale. METRICS_PORT defaults to {SERVICE_PORT}+1000.
func startObservabilityServer(
	ctx context.Context,
	serviceName string,
	servicePort string,
	pool *pgxpool.Pool,
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
