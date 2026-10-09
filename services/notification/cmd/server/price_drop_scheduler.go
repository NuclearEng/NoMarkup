package main

// price_drop_scheduler.go — goods marketplace price-drop alerts.
//
// Wakes every 5 minutes and walks listing_watchlist. For each row:
//
//   1. Read the current bid price from listings.current_bid_cents
//      (falling back to listings.starting_price_cents when no bids yet).
//   2. If baseline_price_cents is null on the watchlist row, stamp it
//      with the current price and continue — this is the first time we
//      see this watch, so there's no drop to compare against yet.
//   3. If the current price is at least 10% below the baseline AND
//      either last_drop_alert_cents is null OR current price is below
//      the last alert threshold, queue a `price_drop` notification to
//      follower_id and update last_drop_alert_cents.
//
// The 10% threshold is intentional: we want a drop alert to feel
// significant, not a fluttery $0.50 move on a low-priced auction. The
// "≤ last_drop_alert_cents" gate prevents repeated alerts for the same
// drop — we only send a fresh alert when the price drops further.
//
// Coexists alongside listing_scheduler.go (closing-soon / outbid) and
// the welcome / follows / re-engagement schedulers — all share the
// same notification.Service instance via main.go.

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/services/notification/internal/service"
)

// priceDropInterval is how often the price-drop sweep runs. 5 minutes
// matches the audit-roadmap requirement and keeps the work cheap.
const priceDropInterval = 5 * time.Minute

// priceDropMinPercent is the minimum % drop relative to baseline before
// we fire an alert. 10% is the floor: anything smaller would be noise.
const priceDropMinPercent = 10.0

// runPriceDropScheduler kicks off the price-drop loop. Returns once the
// goroutine is spawned; cancel `ctx` to stop it.
func runPriceDropScheduler(ctx context.Context, pool *pgxpool.Pool, svc *service.Service) {
	if pool == nil || svc == nil {
		slog.Warn("price-drop scheduler: missing dependencies, skipping",
			"pool_nil", pool == nil, "svc_nil", svc == nil)
		return
	}

	go func() {
		slog.Info("price-drop scheduler starting", "interval", priceDropInterval.String())
		t := time.NewTicker(priceDropInterval)
		defer t.Stop()

		// Run once immediately so first-time baselines stamp without a
		// 5-minute delay.
		runPriceDropTick(ctx, pool, svc)

		for {
			select {
			case <-t.C:
				runPriceDropTick(ctx, pool, svc)
			case <-ctx.Done():
				slog.Info("price-drop scheduler stopping")
				return
			}
		}
	}()
}

// priceDropRow groups the per-watch state we read in each sweep.
type priceDropRow struct {
	WatchID            string
	UserID             string
	ListingID          string
	CurrentPriceCents  int64
	BaselinePriceCents pgtype.Int8
	LastAlertCents     pgtype.Int8
	ListingTitle       string
}

// runPriceDropTick performs ONE sweep of listing_watchlist. Failures
// are logged-and-continue; a single broken row never aborts the loop.
func runPriceDropTick(ctx context.Context, pool *pgxpool.Pool, svc *service.Service) {
	tickCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	// Pull every watch row alongside the listing's current effective price.
	// We restrict to active listings — there's no point alerting on a
	// closed/sold/cancelled listing. The baseline + last-alert columns
	// land on listing_watchlist via migration 044.
	rows, err := pool.Query(tickCtx, `
		SELECT lw.id::text,
		       lw.user_id::text,
		       lw.listing_id::text,
		       COALESCE(l.current_bid_cents, l.starting_price_cents) AS price_cents,
		       lw.baseline_price_cents,
		       lw.last_drop_alert_cents,
		       COALESCE(l.title, '')
		  FROM listing_watchlist lw
		  JOIN listings l ON l.id = lw.listing_id
		 WHERE l.status = 'active'`,
	)
	if err != nil {
		slog.ErrorContext(tickCtx, "price-drop: query failed", "error", err)
		return
	}
	defer rows.Close()

	type baselineUpdate struct {
		WatchID string
		Price   int64
	}
	type alertUpdate struct {
		WatchID string
		Price   int64
	}
	var baselines []baselineUpdate
	var alerts []alertUpdate

	type pendingNotif struct {
		UserID    string
		ListingID string
		Title     string
		Body      string
		Action    string
	}
	var notifs []pendingNotif

	count := 0
	for rows.Next() {
		var pr priceDropRow
		if err := rows.Scan(
			&pr.WatchID, &pr.UserID, &pr.ListingID,
			&pr.CurrentPriceCents, &pr.BaselinePriceCents,
			&pr.LastAlertCents, &pr.ListingTitle,
		); err != nil {
			slog.ErrorContext(tickCtx, "price-drop: scan failed", "error", err)
			continue
		}
		count++

		// Step 2: stamp baseline on first observation.
		if !pr.BaselinePriceCents.Valid {
			baselines = append(baselines, baselineUpdate{
				WatchID: pr.WatchID,
				Price:   pr.CurrentPriceCents,
			})
			continue
		}

		// Step 3: detect a drop ≥ 10% relative to baseline.
		baseline := pr.BaselinePriceCents.Int64
		if baseline <= 0 {
			continue
		}
		dropFraction := float64(baseline-pr.CurrentPriceCents) / float64(baseline)
		if dropFraction*100.0 < priceDropMinPercent {
			continue
		}

		// Suppress repeats: only alert when the new price beats the
		// previous alert threshold.
		if pr.LastAlertCents.Valid && pr.CurrentPriceCents >= pr.LastAlertCents.Int64 {
			continue
		}

		alerts = append(alerts, alertUpdate{
			WatchID: pr.WatchID,
			Price:   pr.CurrentPriceCents,
		})

		title := "Price drop on a listing you're watching"
		body := fmt.Sprintf(
			"%s — now %s (down from %s).",
			displayTitleForPriceDrop(pr.ListingTitle),
			formatPriceCents(pr.CurrentPriceCents),
			formatPriceCents(baseline),
		)
		notifs = append(notifs, pendingNotif{
			UserID:    pr.UserID,
			ListingID: pr.ListingID,
			Title:     title,
			Body:      body,
			Action:    fmt.Sprintf("/marketplace/%s", pr.ListingID),
		})
	}
	if err := rows.Err(); err != nil {
		slog.ErrorContext(tickCtx, "price-drop: rows iteration failed", "error", err)
	}

	// Persist baseline stamps so we never re-stamp the same watch.
	for _, b := range baselines {
		if _, err := pool.Exec(tickCtx,
			`UPDATE listing_watchlist SET baseline_price_cents = $1 WHERE id = $2`,
			b.Price, b.WatchID,
		); err != nil {
			slog.WarnContext(tickCtx, "price-drop: baseline update failed", "error", err, "watch_id", b.WatchID)
		}
	}

	// Persist alert thresholds so future sweeps suppress duplicates.
	for _, a := range alerts {
		if _, err := pool.Exec(tickCtx,
			`UPDATE listing_watchlist SET last_drop_alert_cents = $1 WHERE id = $2`,
			a.Price, a.WatchID,
		); err != nil {
			slog.WarnContext(tickCtx, "price-drop: alert update failed", "error", err, "watch_id", a.WatchID)
		}
	}

	// Fan notifications out via the shared service. Each send is best-effort;
	// transient failures don't block the others.
	for _, n := range notifs {
		data := map[string]string{
			"entity_type": "listing",
			"entity_id":   n.ListingID,
		}
		if _, _, err := svc.SendNotification(tickCtx, n.UserID, "price_drop", n.Title, n.Body, n.Action, data, nil); err != nil {
			slog.WarnContext(tickCtx, "price-drop: send failed",
				"user_id", n.UserID, "listing_id", n.ListingID, "error", err,
			)
		}
	}

	slog.InfoContext(tickCtx, "price-drop: tick complete",
		"rows_seen", count,
		"baselines_set", len(baselines),
		"alerts_sent", len(notifs),
	)
}

// displayTitleForPriceDrop trims long titles to keep the push body legible.
// Whitelisted to a 60-char window — long enough to recognize the listing,
// short enough that a phone push doesn't truncate the dollar amount.
func displayTitleForPriceDrop(title string) string {
	const maxLen = 60
	if title == "" {
		return "An auction"
	}
	if len(title) <= maxLen {
		return title
	}
	return title[:maxLen-1] + "…"
}

// formatPriceCents renders an integer cents value as "$NN.NN" without
// pulling in a fmt-heavy money library. Negative values are clamped to 0.
func formatPriceCents(cents int64) string {
	if cents < 0 {
		cents = 0
	}
	dollars := cents / 100
	rem := cents % 100
	return fmt.Sprintf("$%d.%02d", dollars, rem)
}
