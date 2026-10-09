package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/service"
)

// runBidBondSweepCron backfills bid_bonds that primary event paths may have
// missed (fail-soft release) and cancels abandoned pending SetupIntents.
//
// Primary release still happens on auction close / cancel / pay-held. This
// worker is the safety net so authorized bonds do not strand forever.
func runBidBondSweepCron(ctx context.Context, svc *service.ListingService, interval, initialDelay, pendingAge time.Duration, batchSize int) {
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	if initialDelay <= 0 {
		initialDelay = 45 * time.Second
	}
	if pendingAge <= 0 {
		pendingAge = 24 * time.Hour
	}
	if batchSize <= 0 {
		batchSize = 200
	}

	go func() {
		slog.Info("bid-bond sweep cron starting",
			"interval", interval.String(),
			"initial_delay", initialDelay.String(),
			"pending_age", pendingAge.String(),
			"batch_size", batchSize,
		)
		select {
		case <-time.After(initialDelay):
		case <-ctx.Done():
			return
		}

		t := time.NewTicker(interval)
		defer t.Stop()

		runOnce := func() {
			ctxRun, cancel := context.WithTimeout(ctx, 2*time.Minute)
			defer cancel()
			released, cancelled, err := svc.SweepStrandedBidBonds(ctxRun, pendingAge, batchSize)
			if err != nil {
				slog.Error("bid-bond sweep: cron tick failed", "error", err)
				return
			}
			if released > 0 || cancelled > 0 {
				slog.Info("bid-bond sweep: tick complete",
					"released", released,
					"cancelled_pending", cancelled,
				)
			}
		}
		runOnce()

		for {
			select {
			case <-t.C:
				runOnce()
			case <-ctx.Done():
				slog.Info("bid-bond sweep cron stopping")
				return
			}
		}
	}()
}
