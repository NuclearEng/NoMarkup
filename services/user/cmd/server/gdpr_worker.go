package main

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"

	"github.com/nomarkup/nomarkup/services/user/internal/service"
)

// gdprDeletionsFinalizedTotal counts how many user accounts the cron has
// finalized end-to-end. Bumped per-user, not per-batch, so a slow batch
// does not look like a stall on the dashboard.
var gdprDeletionsFinalizedTotal = promauto.NewCounter(prometheus.CounterOpts{
	Name: "gdpr_deletions_finalized_total",
	Help: "Total number of user accounts the GDPR/CCPA cron has erased.",
})

// gdprDeletionsFailedTotal counts per-user failures inside a batch so an
// alerting rule can distinguish "cron crashed" from "Stripe is sad".
var gdprDeletionsFailedTotal = promauto.NewCounter(prometheus.CounterOpts{
	Name: "gdpr_deletions_failed_total",
	Help: "Total number of GDPR finalize attempts that failed and will be retried on the next tick.",
})

// startGDPRWorker spawns a background goroutine that ticks every `interval`
// and drains the pending-deletion queue via Erasure.ProcessPendingFinalizations.
//
// Graceful shutdown: the goroutine exits as soon as ctx is cancelled. There
// is no in-flight DB work that survives ctx cancellation because each batch
// runs inside Postgres transactions — pgx will abort and roll back anything
// uncommitted at cancel time. Worst case a half-finished cascade gets
// rolled back and the same user shows up in the next tick (the row's
// deletion_finalized_at stays NULL).
func startGDPRWorker(ctx context.Context, erasure *service.Erasure, interval time.Duration, batchSize int) {
	if interval <= 0 {
		interval = 6 * time.Hour
	}
	if batchSize <= 0 {
		batchSize = 100
	}

	go func() {
		slog.Info("gdpr cron worker started",
			"interval", interval.String(),
			"batch_size", batchSize,
		)

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				slog.Info("gdpr cron worker stopping (context cancelled)")
				return
			case <-ticker.C:
				runOnce(ctx, erasure, batchSize)
			}
		}
	}()
}

// runOnce drains a single batch. Errors are logged but never propagated;
// they will simply re-appear on the next tick.
func runOnce(ctx context.Context, erasure *service.Erasure, batchSize int) {
	start := time.Now()
	processed, failed, err := erasure.ProcessPendingFinalizations(ctx, batchSize)
	if err != nil {
		slog.Error("gdpr cron tick failed",
			"error", err,
		)
		return
	}
	for i := 0; i < processed; i++ {
		gdprDeletionsFinalizedTotal.Inc()
	}
	for i := 0; i < failed; i++ {
		gdprDeletionsFailedTotal.Inc()
	}
	if processed > 0 || failed > 0 {
		slog.Info("gdpr cron tick complete",
			"processed", processed,
			"failed", failed,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	}
}

// parseDurationOrDefault parses a duration string from an env var, falling
// back to def on empty / invalid input.
func parseDurationOrDefault(s string, def time.Duration) time.Duration {
	if s == "" {
		return def
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		slog.Warn("invalid duration env var, using default",
			"value", s,
			"default", def.String(),
		)
		return def
	}
	return d
}

func parseIntOrDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		slog.Warn("invalid int env var, using default",
			"value", s,
			"default", def,
		)
		return def
	}
	return n
}
