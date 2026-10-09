//go:build integration

// Integration tests for the Fair Price Index materialized-view refresher.
//
// Bug: nothing in the tree ever ran REFRESH MATERIALIZED VIEW
// (`grep -rn "REFRESH MATERIALIZED" .` returned zero hits), so on any database
// built from the migration chain `fair_price_index` stayed at 0 rows with
// refreshed_at NULL forever. The public pricing endpoint reads it directly
// (gateway/internal/handler/pricing.go) and degrades to `[]`, which is why the
// failure was invisible rather than loud.
//
// Run:
//
//	DATABASE_URL=... go test -tags=integration -count=1 \
//	    -run TestFairPriceRefresher ./internal/service/...
//
// These tests REFRESH a shared view rather than writing rows, so they are safe
// to run against a scratch database and leave no residue of their own.
package service

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func refreshTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://nomarkup:nomarkup@localhost:5433/nomarkup?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), url)
	require.NoError(t, err, "connect db at %s", url)
	t.Cleanup(pool.Close)
	return pool
}

// TestFairPriceRefresher_PopulatesView is the regression test for the whole
// defect: a refresher run must leave the view with a non-NULL refreshed_at.
func TestFairPriceRefresher_PopulatesView(t *testing.T) {
	pool := refreshTestDB(t)
	ctx := context.Background()

	// minInterval 0 so the test is never skipped for freshness.
	r := NewFairPriceRefresher(pool, 0)

	before := time.Now()
	rows, skipped, err := r.Refresh(ctx)
	require.NoError(t, err)
	require.False(t, skipped, "refresh must actually run with minInterval=0")

	var refreshedAt *time.Time
	var count int64
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT COUNT(*), MAX(refreshed_at) FROM fair_price_index`).Scan(&count, &refreshedAt))
	require.Equal(t, count, rows, "reported row count must match the view")

	if count == 0 {
		// A database with no qualifying data (the view needs >=3 completed
		// contracts per category+ZIP) legitimately yields zero rows. The
		// refresh still ran, which is what this test guards.
		t.Log("view refreshed to 0 rows: no qualifying completed contracts in this database")
		return
	}
	require.NotNil(t, refreshedAt, "refreshed_at must not be NULL after a refresh")
	require.WithinDuration(t, before, *refreshedAt, time.Minute,
		"refreshed_at must reflect this run, not a stale snapshot")
}

// TestFairPriceRefresher_UsesConcurrently asserts the view still satisfies the
// preconditions for REFRESH ... CONCURRENTLY (a UNIQUE index + populated). If
// this ever fails, the refresher silently degrades to a blocking refresh that
// locks readers out of the public pricing endpoint for its duration.
func TestFairPriceRefresher_UsesConcurrently(t *testing.T) {
	pool := refreshTestDB(t)
	ctx := context.Background()

	conn, err := pool.Acquire(ctx)
	require.NoError(t, err)
	defer conn.Release()

	r := NewFairPriceRefresher(pool, 0)
	concurrent, err := r.canRefreshConcurrently(ctx, conn)
	require.NoError(t, err)
	require.True(t, concurrent,
		"fair_price_index must keep a UNIQUE index and stay populated "+
			"(migration 014 creates idx_fair_price_index_category_zip)")
}

// TestFairPriceRefresher_SkipsWhenFresh proves the minInterval guard: a second
// run right after a successful one is skipped, not repeated. That is what keeps
// a restart loop or a simultaneous fleet start from stacking full rebuilds.
func TestFairPriceRefresher_SkipsWhenFresh(t *testing.T) {
	pool := refreshTestDB(t)
	ctx := context.Background()

	var count int64
	require.NoError(t, pool.QueryRow(ctx, `SELECT COUNT(*) FROM fair_price_index`).Scan(&count))
	if count == 0 {
		t.Skip("view has no rows in this database, so refreshed_at is NULL and freshness cannot be evaluated")
	}

	// Prime a fresh snapshot.
	_, skipped, err := NewFairPriceRefresher(pool, 0).Refresh(ctx)
	require.NoError(t, err)
	require.False(t, skipped)

	_, skipped, err = NewFairPriceRefresher(pool, time.Hour).Refresh(ctx)
	require.NoError(t, err)
	require.True(t, skipped, "a snapshot younger than minInterval must be skipped")
}

// TestFairPriceRefresher_NilPoolIsNoOp pins the graceful-degradation contract:
// an unconfigured refresher must not panic or error.
func TestFairPriceRefresher_NilPoolIsNoOp(t *testing.T) {
	t.Parallel()

	rows, skipped, err := NewFairPriceRefresher(nil, 0).Refresh(context.Background())
	require.NoError(t, err)
	require.True(t, skipped)
	require.Zero(t, rows)

	// The cron must also decline to start rather than spinning on a nil pool.
	RunFairPriceRefreshCron(context.Background(), NewFairPriceRefresher(nil, 0), time.Second, 0)
}
