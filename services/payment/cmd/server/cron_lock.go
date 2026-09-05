package main

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Shared plumbing for the payment service's money-moving background workers.
//
// Both workers here charge (or decide not to charge) real customers, so unlike
// the auto-release worker — which is protected end to end by deterministic
// Stripe idempotency keys and a durable stripe_transfer_id marker — they must
// not run concurrently across replicas in the first place. A Postgres session
// advisory lock gives that for free: the winner does the tick, every other
// replica skips it, and the lock disappears if the pod dies. This mirrors
// FairPriceRefresher in services/job/internal/service/fair_price_refresh.go,
// which uses the same primitive for the same reason.
//
// Advisory-lock keys. Arbitrary but STABLE — changing one silently
// re-introduces the concurrent duplicate work it was added to prevent.
const (
	// "bnplinst"
	installmentCronLockKey int64 = 0x626e_706c_696e_7374
	// "goodsstl" (goods settlement)
	listingSettlementLockKey int64 = 0x676f_6f64_7373_746c
)

// envDurationOr reads a Go-duration env var (e.g. "4h", "30m"), falling back to
// def when unset or unparseable. Named to avoid colliding with the job
// service's envDuration; both services keep their own copy rather than sharing
// a package, matching how envOrDefault/envBool already live in main.go.
func envDurationOr(key string, def time.Duration) time.Duration {
	v := envOrDefault(key, "")
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		slog.Warn("invalid duration env var, using default", "key", key, "value", v, "default", def.String())
		return def
	}
	if d <= 0 {
		slog.Warn("non-positive duration env var, using default", "key", key, "value", v, "default", def.String())
		return def
	}
	return d
}

// envIntOr reads an integer env var, falling back to def when unset or
// unparseable. Non-positive values are rejected: every caller uses this for a
// batch size, where 0 would silently disable the worker.
func envIntOr(key string, def int) int {
	v := envOrDefault(key, "")
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		slog.Warn("invalid int env var, using default", "key", key, "value", v, "default", def)
		return def
	}
	return n
}

// withCronLock runs fn exactly once across the fleet for this tick.
//
// skipped=true means another replica holds the lock — a normal outcome, not an
// error. A nil pool means the caller has no database, in which case there is
// nothing to serialize and nothing to do, so the tick is skipped rather than
// run unprotected: a money worker that cannot take its lock must not charge.
func withCronLock(ctx context.Context, pool *pgxpool.Pool, key int64, fn func(context.Context) error) (skipped bool, err error) {
	if pool == nil {
		return true, nil
	}

	// One connection for the whole operation: a session advisory lock belongs to
	// the connection that took it, so unlocking from a different pooled
	// connection would silently fail to release it.
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return false, fmt.Errorf("cron lock: acquire connection: %w", err)
	}
	defer conn.Release()

	var got bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, key).Scan(&got); err != nil {
		return false, fmt.Errorf("cron lock: acquire advisory lock: %w", err)
	}
	if !got {
		return true, nil
	}
	defer func() {
		// Best-effort unlock on a fresh context: the caller's ctx may already be
		// cancelled (shutdown), and leaving the lock held would block the next
		// replica until the connection is recycled.
		unlockCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if _, uerr := conn.Exec(unlockCtx, `SELECT pg_advisory_unlock($1)`, key); uerr != nil {
			slog.WarnContext(ctx, "cron lock: advisory unlock failed", "key", key, "error", uerr)
		}
	}()

	return false, fn(ctx)
}

// runLockedCron is the shared loop shape: initial delay, run once, then tick,
// with every run serialized fleet-wide by the advisory lock and bounded by
// runTimeout. Stops when ctx is cancelled.
func runLockedCron(
	ctx context.Context,
	name string,
	pool *pgxpool.Pool,
	key int64,
	interval, initialDelay, runTimeout time.Duration,
	fn func(context.Context) error,
) {
	go func() {
		slog.Info("cron starting",
			"cron", name,
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
			runCtx, cancel := context.WithTimeout(ctx, runTimeout)
			defer cancel()
			skipped, err := withCronLock(runCtx, pool, key, fn)
			switch {
			case err != nil:
				slog.ErrorContext(runCtx, "cron tick failed", "cron", name, "error", err)
			case skipped:
				slog.DebugContext(runCtx, "cron tick skipped (another replica holds the lock)", "cron", name)
			}
		}
		runOnce()

		for {
			select {
			case <-t.C:
				runOnce()
			case <-ctx.Done():
				slog.Info("cron stopping", "cron", name)
				return
			}
		}
	}()
}
