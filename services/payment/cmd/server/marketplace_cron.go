package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

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

// runListingSettlementCron starts the goods-marketplace settlement loop — the
// missing caller for ChargeListingWinner on the auction path.
//
// A won auction is closed by the job service, which inserts listing_orders in
// escrow_status='pending_payment' with no payment_intent_id. Its cron comment
// asserted that "ChargeListingWinner (payment service) attaches the PI"; no
// code did. Auction-won orders therefore sat in pending_payment forever,
// escrow_status never reached 'held', and the auto-release worker above — which
// selects only 'held' and 'released' — never saw them.
//
// Every tick this worker:
//   - attaches a PaymentIntent to unfunded orders (idempotent: ChargeListingWinner
//     short-circuits on an existing PI, and the Stripe key is deterministic per
//     order), and stamps the buyer's payment deadline once, and
//   - loudly reports orders still unfunded past that deadline, moving them to
//     the terminal 'payment_failed' only when SetExpireUnfunded is armed.
//
// It moves no money. See SettlePendingListingOrders for the full explanation of
// why an off-session auction charge is impossible with today's Stripe plumbing.
//
// Serialized fleet-wide by an advisory lock (cron_lock.go) for the same reason
// as the BNPL worker: several replicas each calling ChargeListingWinner for the
// same order would be deduped by Stripe, but should not race in the first place.
func runListingSettlementCron(
	ctx context.Context,
	svc *service.MarketplaceService,
	pool *pgxpool.Pool,
	interval, initialDelay time.Duration,
	batchLimit int,
) {
	if svc == nil {
		slog.Warn("listing settlement cron disabled (no marketplace service)")
		return
	}
	if pool == nil {
		slog.Error("listing settlement cron disabled (no database pool for the advisory lock); " +
			"auction-won orders will stay in pending_payment")
		return
	}
	if interval <= 0 {
		interval = 15 * time.Minute
	}
	if initialDelay <= 0 {
		initialDelay = time.Minute
	}
	if batchLimit <= 0 {
		batchLimit = 200
	}

	runLockedCron(ctx, "listing-settlement", pool, listingSettlementLockKey,
		interval, initialDelay, 10*time.Minute,
		func(runCtx context.Context) error {
			stats, err := svc.SettlePendingListingOrders(runCtx, batchLimit)
			if err != nil {
				return err
			}
			if stats.Charged > 0 || stats.ChargeFailed > 0 || stats.Overdue > 0 {
				slog.InfoContext(runCtx, "listing settlement: tick complete",
					"scanned", stats.Scanned,
					"charged", stats.Charged,
					"charge_failed", stats.ChargeFailed,
					"overdue_unfunded", stats.Overdue,
					"expired", stats.Expired,
				)
			}
			return nil
		})
}
