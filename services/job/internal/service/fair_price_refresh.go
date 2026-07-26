// Package service — Fair Price Index materialized-view refresher.
//
// `fair_price_index` (migration 014) aggregates completed-contract pricing per
// (category, ZIP) and backs the public pricing endpoint
// (gateway/internal/handler/pricing.go → GET /api/v1/pricing/{category}), which
// is served through writeCachedJSON and therefore CDN-cached.
//
// A materialized view is a snapshot: it holds whatever the last REFRESH
// computed and NEVER updates itself. Before this file there was no REFRESH
// anywhere in the tree — `grep -rn "REFRESH MATERIALIZED" .` returned zero
// hits — so on any database built from the migration chain the view stayed at
// the 0 rows it was created with and `refreshed_at` stayed NULL, forever. The
// endpoint degrades to `[]` rather than erroring, which is exactly why the
// failure went unnoticed: the pricing page has been silently empty in
// production, not broken.
//
// The refresh belongs here rather than in SQL because migrations are
// forward-only, run once, and cannot schedule anything; keeping it in Go also
// puts it under the same structured logging and shutdown handling as the rest
// of the service.
package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fairPriceIndexView is the materialized view this refresher owns.
//
// It is interpolated into the REFRESH statement below because SQL does not
// allow an object name to be a bind parameter. That is safe here and only
// here: it is an untyped compile-time constant in this file, never derived
// from a request, a config value, or any other input. Do not turn it into a
// variable.
const fairPriceIndexView = "fair_price_index"

// fairPriceRefreshLockKey is the advisory-lock key that keeps replicas from
// refreshing on top of each other. REFRESH takes a heavy lock on the view, so
// N pods ticking together would serialise into N sequential rebuilds of the
// same data. With the advisory lock, the losers skip the tick instead of
// queueing behind it. Arbitrary but stable — changing it re-introduces the
// duplicate work.
const fairPriceRefreshLockKey int64 = 0x6661_6972_7072_6963 // "fairpric"

// FairPriceRefresher recomputes the fair_price_index materialized view.
type FairPriceRefresher struct {
	pool *pgxpool.Pool
	// minInterval suppresses a refresh whose result would be near-identical to
	// the current snapshot — it protects against a restart loop, or several
	// pods starting at once, turning into a burst of full rebuilds.
	minInterval time.Duration
}

// NewFairPriceRefresher returns a refresher bound to pool. A nil pool makes
// every call a no-op, matching the graceful-degradation contract the rest of
// the service uses for optional dependencies.
func NewFairPriceRefresher(pool *pgxpool.Pool, minInterval time.Duration) *FairPriceRefresher {
	if minInterval < 0 {
		minInterval = 0
	}
	return &FairPriceRefresher{pool: pool, minInterval: minInterval}
}

// Refresh recomputes the view and reports how many rows it now holds.
//
// skipped is true when the refresh was deliberately not run — another replica
// held the advisory lock, or the snapshot was younger than minInterval. That is
// a normal outcome, not an error.
func (f *FairPriceRefresher) Refresh(ctx context.Context) (rows int64, skipped bool, err error) {
	if f == nil || f.pool == nil {
		return 0, true, nil
	}

	// One connection for the whole operation: a session-scoped advisory lock is
	// held by the connection that took it, so releasing it from a different
	// pooled connection would silently fail to unlock.
	conn, err := f.pool.Acquire(ctx)
	if err != nil {
		return 0, false, fmt.Errorf("fair price refresh: acquire connection: %w", err)
	}
	defer conn.Release()

	var gotLock bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, fairPriceRefreshLockKey).Scan(&gotLock); err != nil {
		return 0, false, fmt.Errorf("fair price refresh: acquire advisory lock: %w", err)
	}
	if !gotLock {
		slog.DebugContext(ctx, "fair price refresh: another replica holds the lock, skipping tick")
		return 0, true, nil
	}
	defer func() {
		// Best-effort unlock on a fresh context: the caller's ctx may already be
		// cancelled (shutdown), and leaving a session lock held would block the
		// next replica until the connection is recycled.
		unlockCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if _, uerr := conn.Exec(unlockCtx, `SELECT pg_advisory_unlock($1)`, fairPriceRefreshLockKey); uerr != nil {
			slog.WarnContext(ctx, "fair price refresh: advisory unlock failed", "error", uerr)
		}
	}()

	if f.minInterval > 0 {
		fresh, ferr := f.snapshotIsFresh(ctx, conn)
		if ferr != nil {
			return 0, false, ferr
		}
		if fresh {
			slog.DebugContext(ctx, "fair price refresh: snapshot still fresh, skipping tick",
				"min_interval", f.minInterval.String())
			return 0, true, nil
		}
	}

	concurrent, err := f.canRefreshConcurrently(ctx, conn)
	if err != nil {
		return 0, false, err
	}

	start := time.Now()
	stmt := "REFRESH MATERIALIZED VIEW " + fairPriceIndexView
	if concurrent {
		// CONCURRENTLY takes only an EXCLUSIVE lock, so the public pricing
		// endpoint keeps reading the old snapshot throughout the rebuild
		// instead of blocking on ACCESS EXCLUSIVE.
		stmt = "REFRESH MATERIALIZED VIEW CONCURRENTLY " + fairPriceIndexView
	}
	if _, err := conn.Exec(ctx, stmt); err != nil {
		return 0, false, fmt.Errorf("fair price refresh: %s: %w", stmt, err)
	}

	if err := conn.QueryRow(ctx,
		`SELECT COUNT(*) FROM `+fairPriceIndexView).Scan(&rows); err != nil {
		// The refresh itself succeeded; a failed count is cosmetic.
		slog.WarnContext(ctx, "fair price refresh: succeeded but row count failed", "error", err)
		return 0, false, nil
	}

	slog.InfoContext(ctx, "fair price index refreshed",
		"rows", rows,
		"concurrent", concurrent,
		"duration_ms", time.Since(start).Milliseconds(),
	)
	return rows, false, nil
}

// snapshotIsFresh reports whether the newest refreshed_at is younger than
// minInterval. The view's own definition selects `now() AS refreshed_at`, so
// every row carries the time of the refresh that produced it. An empty view has
// no rows and is never "fresh" — that is the state we most want to fix.
func (f *FairPriceRefresher) snapshotIsFresh(ctx context.Context, conn queryRower) (bool, error) {
	var refreshedAt *time.Time
	if err := conn.QueryRow(ctx,
		`SELECT MAX(refreshed_at) FROM `+fairPriceIndexView).Scan(&refreshedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("fair price refresh: read snapshot age: %w", err)
	}
	if refreshedAt == nil {
		return false, nil
	}
	return time.Since(*refreshedAt) < f.minInterval, nil
}

// canRefreshConcurrently reports whether REFRESH ... CONCURRENTLY is legal for
// this view right now. Postgres requires BOTH:
//
//   - at least one UNIQUE index covering every row, and
//   - the view to already be populated (CONCURRENTLY computes a delta against
//     existing contents, so it cannot do the very first load).
//
// Migration 014 satisfies both today: it creates
// `idx_fair_price_index_category_zip UNIQUE (category_id, zip_code)`, and
// `CREATE MATERIALIZED VIEW ... AS SELECT` populates WITH DATA by default. This
// check exists so that if either ever stops holding, the refresh degrades to a
// blocking-but-correct plain REFRESH with a loud warning, instead of failing
// and leaving the view empty forever — which is the bug this file fixes.
func (f *FairPriceRefresher) canRefreshConcurrently(ctx context.Context, conn queryRower) (bool, error) {
	var hasUnique, populated bool
	err := conn.QueryRow(ctx, `
		SELECT COALESCE(bool_or(i.indisunique), false) AS has_unique,
		       COALESCE(bool_or(c.relispopulated), false) AS populated
		  FROM pg_class c
		  LEFT JOIN pg_index i ON i.indrelid = c.oid
		 WHERE c.relname = $1 AND c.relkind = 'm'`,
		fairPriceIndexView).Scan(&hasUnique, &populated)
	if err != nil {
		return false, fmt.Errorf("fair price refresh: inspect view %s: %w", fairPriceIndexView, err)
	}

	if !hasUnique {
		slog.WarnContext(ctx, "fair price refresh: no UNIQUE index on materialized view; "+
			"falling back to a blocking REFRESH that locks readers out for its duration. "+
			"Add a unique index to restore CONCURRENTLY.",
			"view", fairPriceIndexView)
		return false, nil
	}
	if !populated {
		slog.InfoContext(ctx, "fair price refresh: view not yet populated; "+
			"first refresh must be non-concurrent",
			"view", fairPriceIndexView)
		return false, nil
	}
	return true, nil
}

// queryRower is the minimal read surface Refresh needs, so the helpers accept
// either a pool connection or a bare pool.
type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// RunFairPriceRefreshCron starts the background refresh loop and returns
// immediately. It stops when ctx is cancelled, so the caller's shutdown context
// drains it along with everything else.
//
// Mirrors runAuctionCloseCron's shape (initial delay → run once → tick) so both
// workers behave the same under a rolling restart: the delay keeps a fleet-wide
// deploy from firing every replica's first refresh simultaneously, and the
// advisory lock inside Refresh handles whatever overlap remains.
func RunFairPriceRefreshCron(ctx context.Context, f *FairPriceRefresher, interval, initialDelay time.Duration) {
	if f == nil || f.pool == nil {
		slog.Info("fair price refresh cron disabled (no database pool)")
		return
	}
	if interval <= 0 {
		interval = time.Hour
	}
	if initialDelay < 0 {
		initialDelay = 0
	}

	go func() {
		slog.Info("fair price refresh cron starting",
			"interval", interval.String(),
			"initial_delay", initialDelay.String(),
			"min_interval", f.minInterval.String(),
		)
		select {
		case <-time.After(initialDelay):
		case <-ctx.Done():
			return
		}

		t := time.NewTicker(interval)
		defer t.Stop()

		runOnce := func() {
			// A full rebuild over a large contracts table is not a request-path
			// query; give it its own generous bound rather than inheriting none.
			runCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
			defer cancel()
			rows, skipped, err := f.Refresh(runCtx)
			switch {
			case err != nil:
				// Never fatal: stale pricing data is a degraded read, and the
				// endpoint already tolerates it. Log and retry next tick.
				slog.Error("fair price refresh: tick failed", "error", err)
			case skipped:
				// Debug-logged inside Refresh with the specific reason.
			default:
				slog.Debug("fair price refresh: tick complete", "rows", rows)
			}
		}
		runOnce()

		for {
			select {
			case <-t.C:
				runOnce()
			case <-ctx.Done():
				slog.Info("fair price refresh cron stopping")
				return
			}
		}
	}()
}
