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
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"

	"github.com/nomarkup/nomarkup/services/chat/internal/ws"
)

// activeWebSocketConnections tracks the live count of registered connections
// in the chat WebSocket hub. Required by CLAUDE.md §11. Sampled every
// hubSampleInterval from the hub.
var activeWebSocketConnections = promauto.NewGauge(prometheus.GaugeOpts{
	Name: "active_websocket_connections",
	Help: "Number of currently active WebSocket connections in the chat hub.",
})

const hubSampleInterval = 10 * time.Second

// startObservabilityServer launches the observability HTTP server.
// METRICS_PORT defaults to {SERVICE_PORT}+1000.
//
// Also starts a background goroutine that samples hub.ActiveCount() into the
// active_websocket_connections gauge. The gauge is kept up-to-date even when
// no scrape arrives, so dashboards see fresh values during low-scrape periods.
func startObservabilityServer(
	ctx context.Context,
	serviceName string,
	servicePort string,
	pool *pgxpool.Pool,
	rdb *redis.Client,
	hub *ws.Hub,
) {
	metricsPort := os.Getenv("METRICS_PORT")
	if metricsPort == "" {
		if p, err := strconv.Atoi(servicePort); err == nil {
			metricsPort = strconv.Itoa(p + 1000)
		} else {
			metricsPort = "9100"
		}
	}

	// Background sampler for the hub gauge.
	go func() {
		ticker := time.NewTicker(hubSampleInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if hub != nil {
					activeWebSocketConnections.Set(float64(hub.ActiveCount()))
				}
			}
		}
	}()

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
