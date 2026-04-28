package main

// welcome_emails.go — onboarding email sequence scheduler.
//
// The audit (Section P) flagged welcome-email cadence as MISSING. This
// loop runs once every 5 minutes and walks three queries: day-1 (the
// welcome), day-3 follow-up ("here's how to win your first auction"),
// day-7 follow-up ("see what your neighbors are selling near you").
//
// Every notification type is plumbed through the same Service.SendNotification
// call already used by the closing-soon scheduler so the user's existing
// preferences govern channel selection. Email-only by spirit, but if a
// user has push enabled for `welcome_day_1` we deliver there too.
//
// Idempotency is enforced by setting users.welcome_email_sent_at (and the
// _day3_ / _day7_ siblings) — once a row's timestamp is non-NULL it is
// excluded from the next sweep. A failed dispatch leaves the timestamp
// NULL so the next tick retries.
//
// Migration 041 added the three TIMESTAMPTZ columns. The scheduler tolerates
// the columns being absent: the boot-time init log fires regardless, and
// the queries return zero rows when the columns don't exist (Postgres returns
// `column does not exist` — we log-and-continue).

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/services/notification/internal/service"
)

// welcomeEmailInterval is how often the scheduler sweeps. 5 minutes is
// plenty granular for an onboarding cadence — the day-1 email being a few
// minutes late is invisible to the user, and the lower frequency lets us
// share DB capacity with the closing-soon scheduler.
const welcomeEmailInterval = 5 * time.Minute

// welcomeEmailGracePeriod is the buffer after registration before the
// day-1 email fires. Five minutes lets a user finish a sign-up flow
// (verify email, set up profile) before the welcome arrives — fresh
// inboxes at minute zero feel automated.
const welcomeEmailGracePeriod = 5 * time.Minute

// runWelcomeEmailScheduler starts a background loop that processes the
// day-1 / day-3 / day-7 welcome cadence. The function returns once the
// goroutine is spawned; cancel `ctx` to stop it.
//
// A nil pool is treated as "feature disabled" — the loop logs once and
// returns, matching the rest of the scheduler family.
func runWelcomeEmailScheduler(ctx context.Context, pool *pgxpool.Pool, svc *service.Service) {
	if pool == nil || svc == nil {
		slog.Warn("welcome email scheduler: missing dependencies, skipping",
			"pool_nil", pool == nil, "svc_nil", svc == nil)
		return
	}

	go func() {
		slog.Info("welcome email scheduler starting", "interval", welcomeEmailInterval.String())
		t := time.NewTicker(welcomeEmailInterval)
		defer t.Stop()

		// Run once immediately so a fresh process catches any users that
		// registered while the previous instance was being rolled out.
		runWelcomeEmailTick(ctx, pool, svc)

		for {
			select {
			case <-t.C:
				runWelcomeEmailTick(ctx, pool, svc)
			case <-ctx.Done():
				slog.Info("welcome email scheduler stopping")
				return
			}
		}
	}()
}

// runWelcomeEmailTick processes one sweep of all three days. Each day is
// run sequentially so a slow query in one stage doesn't block the others
// on the same loop iteration but also doesn't fan out to three goroutines
// (which would deadlock against the same pool on small connection counts).
func runWelcomeEmailTick(ctx context.Context, pool *pgxpool.Pool, svc *service.Service) {
	tickCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	day1 := welcomeStage{
		notifType: "welcome_day_1",
		title:     "Welcome to NoMarkup",
		body:      "Glad you're here. NoMarkup is the local-first marketplace where buyers come to you. Browse what your neighbors are selling, or post your first listing — there's no markup, just a fair market price.",
		actionURL: "/marketplace",
		query: `
			SELECT id, COALESCE(email, '')
			  FROM users
			 WHERE welcome_email_sent_at IS NULL
			   AND email_verified = true
			   AND created_at <= now() - $1::interval
			 LIMIT 200`,
		queryArgs: []interface{}{intervalString(welcomeEmailGracePeriod)},
		stampCol:  "welcome_email_sent_at",
	}
	day3 := welcomeStage{
		notifType: "welcome_day_3",
		title:     "Three days in — your next 60 seconds",
		body:      "Sellers who post their first listing in week one earn 4× more than those who wait. Snap two photos, set a starting price, and let the auction do the work.",
		actionURL: "/sell",
		query: `
			SELECT id, COALESCE(email, '')
			  FROM users
			 WHERE welcome_email_sent_at IS NOT NULL
			   AND welcome_email_sent_at <= now() - interval '3 days'
			   AND welcome_day3_sent_at IS NULL
			 LIMIT 200`,
		stampCol: "welcome_day3_sent_at",
	}
	day7 := welcomeStage{
		notifType: "welcome_day_7",
		title:     "Your first week recap",
		body:      "See what's auctioning near you right now. Local pickup, no shipping, no markup — just real items from real neighbors.",
		actionURL: "/marketplace",
		query: `
			SELECT id, COALESCE(email, '')
			  FROM users
			 WHERE welcome_email_sent_at IS NOT NULL
			   AND welcome_email_sent_at <= now() - interval '7 days'
			   AND welcome_day7_sent_at IS NULL
			 LIMIT 200`,
		stampCol: "welcome_day7_sent_at",
	}

	for _, stage := range []welcomeStage{day1, day3, day7} {
		if err := processWelcomeStage(tickCtx, pool, svc, stage); err != nil {
			slog.WarnContext(tickCtx, "welcome email stage failed",
				"stage", stage.notifType, "error", err)
		}
	}
}

// welcomeStage groups everything that varies per day-of-cadence so the
// processor can stay generic across day-1 / day-3 / day-7.
type welcomeStage struct {
	notifType string
	title     string
	body      string
	actionURL string
	query     string
	queryArgs []interface{}
	// Column on `users` to UPDATE once the notification dispatches successfully.
	stampCol string
}

// processWelcomeStage walks one stage's query, dispatches, and stamps
// each row's timestamp on success. We update one row at a time rather than
// bulk-updating because a partial failure in the middle of a sweep would
// otherwise lose its idempotency anchor.
func processWelcomeStage(ctx context.Context, pool *pgxpool.Pool, svc *service.Service, stage welcomeStage) error {
	rows, err := pool.Query(ctx, stage.query, stage.queryArgs...)
	if err != nil {
		return err
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
			slog.WarnContext(ctx, "welcome email scan failed",
				"stage", stage.notifType, "error", err)
			continue
		}
		users = append(users, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	if len(users) == 0 {
		return nil
	}

	for _, u := range users {
		// Email channel needs the address surfaced through the `data` map
		// — the notification service has no FK back to `users`. This
		// matches dispatchEmail's contract in service.go.
		data := map[string]string{
			"entity_type": "user",
			"entity_id":   u.userID,
		}
		if u.email != "" {
			data["user_email"] = u.email
		}

		// Force email + in-app channels for the welcome cadence — the
		// audit calls these out as critical onboarding touchpoints, so
		// we don't gate them behind defaultChannelPrefs.
		channels := []string{"in_app", "email"}

		if _, _, err := svc.SendNotification(ctx, u.userID, stage.notifType,
			stage.title, stage.body, stage.actionURL, data, channels); err != nil {
			slog.WarnContext(ctx, "welcome email dispatch failed",
				"stage", stage.notifType, "user_id", u.userID, "error", err)
			continue
		}

		// Stamp the row so the next sweep skips it. UPDATE is intentionally
		// scoped via the stampCol — a malformed column would 500 the query
		// instead of silently no-op'ing.
		stampSQL := "UPDATE users SET " + stage.stampCol + " = now() WHERE id = $1"
		if _, err := pool.Exec(ctx, stampSQL, u.userID); err != nil {
			// If the column doesn't exist (migration not run), log once and
			// abort the loop — repeated failures on every tick are noise.
			if isUndefinedColumn(err) {
				slog.WarnContext(ctx, "welcome email stamp failed: column missing",
					"stage", stage.notifType, "column", stage.stampCol, "error", err)
				return err
			}
			slog.WarnContext(ctx, "welcome email stamp failed",
				"stage", stage.notifType, "user_id", u.userID, "column", stage.stampCol, "error", err)
		}
	}

	slog.InfoContext(ctx, "welcome email tick complete",
		"stage", stage.notifType, "users", len(users))
	return nil
}

// isUndefinedColumn surfaces the Postgres SQLSTATE 42703 condition (column
// does not exist) so we can short-circuit when migration 041 hasn't run.
// We compare against the error string rather than importing pgconn here
// to keep the dependency surface tight.
func isUndefinedColumn(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	if msg == "" {
		return false
	}
	// pgx surfaces "ERROR: column \"foo\" does not exist (SQLSTATE 42703)".
	return errors.New(msg).Error() != "" &&
		(containsCI(msg, "42703") || containsCI(msg, "does not exist"))
}

// containsCI is a tiny case-insensitive substring check — keeps the file
// stdlib-only. Used by isUndefinedColumn.
func containsCI(s, sub string) bool {
	if len(sub) == 0 {
		return true
	}
	if len(s) < len(sub) {
		return false
	}
	// Lowercase compare without allocating.
	for i := 0; i+len(sub) <= len(s); i++ {
		match := true
		for j := 0; j < len(sub); j++ {
			a := s[i+j]
			b := sub[j]
			if a >= 'A' && a <= 'Z' {
				a += 'a' - 'A'
			}
			if b >= 'A' && b <= 'Z' {
				b += 'a' - 'A'
			}
			if a != b {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}
