package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/service"
)

// runAutoReleaseCompletedContractsCron starts the 7-day services auto-approve
// worker. Every `interval` it selects contracts the provider marked complete
// more than 7 days ago with no customer action, releases held escrow as a
// System actor, then finalises the contract and job.
//
// Same ticker shape as runAuctionCloseCron: initial delay, bounded tick
// timeout, fail-soft per row, context-cancellation stop.
func runAutoReleaseCompletedContractsCron(ctx context.Context, svc *service.ContractService, interval, initialDelay time.Duration) {
	if svc == nil {
		return
	}
	if interval <= 0 {
		interval = time.Hour
	}
	if initialDelay <= 0 {
		initialDelay = 2 * time.Minute
	}

	go func() {
		slog.Info("contract auto-release cron starting",
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

		runOnce := func() {
			ctxRun, cancel := context.WithTimeout(ctx, 5*time.Minute)
			defer cancel()
			if err := svc.AutoReleaseCompletedContracts(ctxRun); err != nil {
				slog.Error("contract auto-release: cron tick failed", "error", err)
			}
		}
		runOnce()

		for {
			select {
			case <-t.C:
				runOnce()
			case <-ctx.Done():
				slog.Info("contract auto-release cron stopping")
				return
			}
		}
	}()
}
