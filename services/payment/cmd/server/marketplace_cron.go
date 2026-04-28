package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/service"
)

// runMarketplaceAutoReleaseCron starts the goods-marketplace auto-release
// loop. Every 4 hours it scans listing_orders where:
//   - escrow_status = 'held'
//   - dispute_id IS NULL
//   - created_at < now() - 14 days
//
// and transitions each to 'released', creating a Stripe transfer to the
// seller. Idempotency keys on the transfer prevent double-pay if the cron
// retries.
//
// The first tick fires after `initialDelay` so service startup isn't
// hammered. Cancel the context to stop the loop.
func runMarketplaceAutoReleaseCron(ctx context.Context, svc *service.MarketplaceService, interval, initialDelay time.Duration) {
	if interval <= 0 {
		interval = 4 * time.Hour
	}
	if initialDelay <= 0 {
		initialDelay = 5 * time.Minute
	}

	go func() {
		slog.Info("marketplace auto-release cron starting",
			"interval", interval.String(),
			"initial_delay", initialDelay.String(),
		)
		select {
		case <-time.After(initialDelay):
		case <-ctx.Done():
			return
		}

		t := time.NewTicker(interval)
		defer t.Stop()

		// Run once immediately after the initial delay, then on each tick.
		runOnce := func() {
			ctxRun, cancel := context.WithTimeout(ctx, 10*time.Minute)
			defer cancel()
			n, err := svc.AutoReleaseListingOrders(ctxRun, 200)
			if err != nil {
				slog.Error("marketplace auto-release: cron tick failed", "error", err)
				return
			}
			if n > 0 {
				slog.Info("marketplace auto-release: tick released orders", "count", n)
			}
		}
		runOnce()

		for {
			select {
			case <-t.C:
				runOnce()
			case <-ctx.Done():
				slog.Info("marketplace auto-release cron stopping")
				return
			}
		}
	}()
}
