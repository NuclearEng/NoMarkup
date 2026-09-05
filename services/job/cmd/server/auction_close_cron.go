package main

import (
	"context"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/service"
)

// envDuration reads a Go-duration env var (e.g. "30s", "1m"), falling back to
// def when unset or unparseable.
func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
		slog.Warn("invalid duration env var, using default", "key", key, "value", v, "default", def.String())
	}
	return def
}

// envInt reads an integer env var, falling back to def when unset or
// unparseable.
func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
		slog.Warn("invalid int env var, using default", "key", key, "value", v, "default", def)
	}
	return def
}

// runAuctionCloseCron starts the goods-marketplace auction-close worker. Every
// `interval` it scans for listings whose auction deadline has passed but are
// still status='active' and resolves each one:
//
//   - winning bid at/above any reserve → highest bidder wins, a
//     listing_orders row is created in escrow_status='pending_payment'
//     (NOT held — held requires a captured PaymentIntent; see MON-06),
//     with seller-side fee from platform_fee_config (fee%+guarantee%, R6.1).
//     The listing flips to status='sold', and the winning bid is 'awarded'.
//
//     This worker deliberately stops there — it does not talk to the payment
//     service. Settlement is picked up asynchronously by the payment service's
//     own worker (runListingSettlementCron in
//     services/payment/cmd/server/marketplace_cron.go), which calls
//     ChargeListingWinner for every order still in 'pending_payment' with no
//     payment_intent_id. Keeping it that way means an auction still closes
//     correctly when the payment service is down, and settlement retries on its
//     own schedule instead of being lost with the tick that closed the auction.
//
//     NOTE (accuracy): attaching the PaymentIntent is NOT the same as being
//     paid. The PI is created without a customer or payment method, so it sits
//     in requires_payment_method until someone confirms it client-side. Only a
//     signature-verified payment_intent.succeeded event promotes
//     pending_payment → held. Release / auto-release / confirm-pickup run only
//     on held orders that have payment_intent_id set, so an unfunded order can
//     never pay a seller. An earlier version of this comment asserted that
//     ChargeListingWinner attached the PI here; nothing called it at all.
//   - no bids, OR a high bid below the seller's reserve → the listing closes
//     WITHOUT a sale (status='expired'), no order, no money moved.
//
// This mirrors services/payment/cmd/server/marketplace_cron.go's
// runMarketplaceAutoReleaseCron (the escrow auto-release worker): same
// initial-delay + ticker shape, same bounded per-tick batch, same
// fail-soft-per-row semantics, same context-cancellation stop.
//
// Money-safety. Each listing is closed in its own FOR UPDATE-locked,
// status-guarded transaction (ListingService.CloseListingAuction →
// repository), and listing_orders carries a UNIQUE(listing_id) constraint, so:
//   - a re-run over an already-closed listing is a no-op (the status guard
//     short-circuits — 'sold'/'expired' never re-enters the award path), and
//   - even two concurrent worker ticks (or two job-service instances) racing
//     the same row can produce at most ONE order — the second close sees the
//     row already non-active (or the UNIQUE constraint rejects the insert) and
//     does nothing.
// Exactly one order per ended auction. No double-pay.
//
// The first tick fires after `initialDelay` so service startup isn't hammered.
// Cancel the context to stop the loop.
func runAuctionCloseCron(ctx context.Context, svc *service.ListingService, interval, initialDelay time.Duration, batchSize int) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	if initialDelay <= 0 {
		initialDelay = 15 * time.Second
	}
	if batchSize <= 0 {
		batchSize = 100
	}

	go func() {
		slog.Info("auction-close cron starting",
			"interval", interval.String(),
			"initial_delay", initialDelay.String(),
			"batch_size", batchSize,
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
			ctxRun, cancel := context.WithTimeout(ctx, 5*time.Minute)
			defer cancel()
			closed, expired, err := svc.CloseEndedAuctions(ctxRun, batchSize)
			if err != nil {
				slog.Error("auction-close: cron tick failed", "error", err)
				return
			}
			if closed > 0 || expired > 0 {
				slog.Info("auction-close: tick resolved auctions",
					"closed_with_order", closed,
					"expired_no_sale", expired,
				)
			}
		}
		runOnce()

		for {
			select {
			case <-t.C:
				runOnce()
			case <-ctx.Done():
				slog.Info("auction-close cron stopping")
				return
			}
		}
	}()
}
