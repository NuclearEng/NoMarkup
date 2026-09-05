package main

// reengagement.go — re-engagement email scheduler.
//
// Every 6 hours, sweeps for users whose last_active_at falls inside one
// of three day-bucket windows (7d, 14d, 30d) and queues a re-engagement
// notification with copy that taps into watched-listing state.
//
// Idempotency: each user is matched by a 1-day-wide bucket, so the same
// user fires each milestone at most once per pass through it — the bucket
// width is the ONLY dedupe for the email/in-app channels this scheduler
// uses (unlike welcome_emails.go, which stamps users.welcome_*_sent_at).
// There is no `notifications.delivery_log` table — an earlier version of
// this comment cited one that never existed (IOS-SYS.NT.1). The real send
// ledger is `notification_send_ledger` (migration 117), written inside
// service.SendNotification's push dispatch: it rate-limits promotional
// PUSH sends (reengagement_* is classified promotional in
// internal/service/notif_class.go) but does not dedupe email or in-app.
//
// Schema dependency: users.last_active_at exists (migration 020). When
// it's NULL (e.g. a user who never actually logged a session), we fall
// back to created_at as a proxy so the funnel doesn't go silent.

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/services/notification/internal/service"
)

// reengagementInterval is how often the scheduler sweeps. 6 hours is the
// product spec — it's also the cheapest cadence that ensures every user
// hits each milestone exactly once with a 1-day-wide bucket query.
const reengagementInterval = 6 * time.Hour

// runReengagementScheduler kicks off the 7d/14d/30d re-engagement loop.
// Cancel `ctx` to stop the goroutine.
func runReengagementScheduler(ctx context.Context, pool *pgxpool.Pool, svc *service.Service) {
	if pool == nil || svc == nil {
		slog.Warn("reengagement scheduler: missing dependencies, skipping",
			"pool_nil", pool == nil, "svc_nil", svc == nil)
		return
	}

	go func() {
		slog.Info("reengagement scheduler starting", "interval", reengagementInterval.String())
		t := time.NewTicker(reengagementInterval)
		defer t.Stop()

		// Run once on startup.
		runReengagementTick(ctx, pool, svc)

		for {
			select {
			case <-t.C:
				runReengagementTick(ctx, pool, svc)
			case <-ctx.Done():
				slog.Info("reengagement scheduler stopping")
				return
			}
		}
	}()
}

// reengagementStage groups everything that varies per milestone.
type reengagementStage struct {
	notifType string
	title     string
	body      string
	actionURL string
	// Inclusive lower bound on inactivity (e.g. 7 days).
	lowerDays int
	// Exclusive upper bound (e.g. 8 days). Together (lower, upper) define
	// a 24h-wide bucket so each user fires exactly once per milestone.
	upperDays int
}

func reengagement7d() reengagementStage {
	return reengagementStage{
		notifType: "reengagement_7d",
		title:     "Auctions you're watching are heating up",
		body:      "Some of the listings on your watchlist close in the next 24 hours. Open NoMarkup to place your bid before time runs out.",
		actionURL: "/me/watchlist",
		lowerDays: 7,
		upperDays: 8,
	}
}

func reengagement14d() reengagementStage {
	return reengagementStage{
		notifType: "reengagement_14d",
		title:     "Two weeks since your last visit",
		body:      "Your neighbors have posted dozens of new listings this week. Take a look — local pickup, no markup, no shipping.",
		actionURL: "/marketplace",
		lowerDays: 14,
		upperDays: 15,
	}
}

func reengagement30d() reengagementStage {
	return reengagementStage{
		notifType: "reengagement_30d",
		title:     "We saved a spot for you",
		body:      "It's been a month. Local marketplace activity is up 40%. Come see what's auctioning near you.",
		actionURL: "/marketplace",
		lowerDays: 30,
		upperDays: 31,
	}
}

// runReengagementTick processes one sweep across the three stages.
func runReengagementTick(ctx context.Context, pool *pgxpool.Pool, svc *service.Service) {
	tickCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	for _, stage := range []reengagementStage{reengagement7d(), reengagement14d(), reengagement30d()} {
		if err := processReengagementStage(tickCtx, pool, svc, stage); err != nil {
			slog.WarnContext(tickCtx, "reengagement stage failed",
				"stage", stage.notifType, "error", err)
		}
	}
}

// processReengagementStage walks the bucket query and dispatches one
// notification per matched user.
func processReengagementStage(ctx context.Context, pool *pgxpool.Pool, svc *service.Service, stage reengagementStage) error {
	// COALESCE(last_active_at, created_at) is the proxy fallback for the
	// rare row that's never logged a session. The DESC ordering is
	// arbitrary; LIMIT 500 keeps a single tick bounded.
	q := `
		SELECT id, COALESCE(email, '')
		  FROM users
		 WHERE deleted_at IS NULL
		   AND COALESCE(last_active_at, created_at) <= now() - ($1::text)::interval
		   AND COALESCE(last_active_at, created_at) >  now() - ($2::text)::interval
		 LIMIT 500`

	rows, err := pool.Query(ctx, q,
		fmt.Sprintf("%d days", stage.lowerDays),
		fmt.Sprintf("%d days", stage.upperDays),
	)
	if err != nil {
		return fmt.Errorf("query users: %w", err)
	}
	defer rows.Close()

	type pending struct {
		userID string
		email  string
	}
	users := make([]pending, 0, 64)
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.userID, &p.email); err != nil {
			slog.WarnContext(ctx, "reengagement scan failed", "stage", stage.notifType, "error", err)
			continue
		}
		users = append(users, p)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("rows iter: %w", err)
	}
	if len(users) == 0 {
		return nil
	}

	for _, u := range users {
		data := map[string]string{
			"entity_type":  "user",
			"entity_id":    u.userID,
			"reengagement": fmt.Sprintf("%dd", stage.lowerDays),
		}
		if u.email != "" {
			data["user_email"] = u.email
		}
		// Email + in-app — same channel set as welcome_emails.
		channels := []string{"in_app", "email"}
		if _, _, err := svc.SendNotification(ctx, u.userID, stage.notifType,
			stage.title, stage.body, stage.actionURL, data, channels); err != nil {
			slog.WarnContext(ctx, "reengagement dispatch failed",
				"stage", stage.notifType, "user_id", u.userID, "error", err)
		}
	}

	slog.InfoContext(ctx, "reengagement tick complete",
		"stage", stage.notifType, "users", len(users))
	return nil
}
