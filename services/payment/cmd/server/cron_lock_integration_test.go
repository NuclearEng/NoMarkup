//go:build integration

// The advisory lock that keeps N payment-service replicas from each charging
// the same customer on the same tick, proved against a real PostgreSQL.
//
// Run:
//
//	cd services/payment && DATABASE_URL=... go test -tags=integration \
//	    -run TestWithCronLock ./cmd/server/...

package main

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func lockTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("needs DATABASE_URL")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("connect db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// TestWithCronLock_OnlyOneHolderRunsTheBody is the replica-safety guarantee the
// BNPL and settlement workers rely on: several pods tick at the same moment,
// exactly one does the work, the rest skip without erroring.
func TestWithCronLock_OnlyOneHolderRunsTheBody(t *testing.T) {
	pool := lockTestPool(t)
	ctx := context.Background()

	const replicas = 6
	var (
		mu      sync.Mutex
		ran     int
		skipped int
		errs    []error
		start   = make(chan struct{})
		inside  = make(chan struct{})
		release = make(chan struct{})
		wg      sync.WaitGroup
	)

	for i := range replicas {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			didSkip, err := withCronLock(ctx, pool, installmentCronLockKey, func(context.Context) error {
				// Hold the lock until every other replica has had its chance to
				// try, so the test is deterministic rather than timing-dependent.
				inside <- struct{}{}
				<-release
				return nil
			})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err != nil:
				errs = append(errs, err)
			case didSkip:
				skipped++
			default:
				ran++
			}
		}(i)
	}

	close(start)

	select {
	case <-inside:
	case <-time.After(10 * time.Second):
		t.Fatal("no replica ever acquired the lock")
	}

	// Give the losers time to fail their pg_try_advisory_lock and record a skip.
	deadline := time.After(10 * time.Second)
	for {
		mu.Lock()
		done := skipped+len(errs) == replicas-1
		mu.Unlock()
		if done {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for the losers to skip (skipped=%d errs=%d)", skipped, len(errs))
		case <-time.After(20 * time.Millisecond):
		}
	}

	close(release)
	wg.Wait()

	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if ran != 1 {
		t.Fatalf("ran = %d, want exactly 1 — N replicas must not each charge", ran)
	}
	if skipped != replicas-1 {
		t.Fatalf("skipped = %d, want %d", skipped, replicas-1)
	}

	// The lock must be released once the body returns, or the next tick starves.
	// Probe on ONE dedicated connection: a session advisory lock belongs to the
	// connection that took it, so a pool-level lock/unlock pair could land on
	// two different connections and silently not unlock.
	probe, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire probe connection: %v", err)
	}
	defer probe.Release()
	var free bool
	if err := probe.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, installmentCronLockKey).Scan(&free); err != nil {
		t.Fatalf("re-acquire probe: %v", err)
	}
	if !free {
		t.Fatal("advisory lock was not released after the tick")
	}
	if _, err := probe.Exec(ctx, `SELECT pg_advisory_unlock($1)`, installmentCronLockKey); err != nil {
		t.Fatalf("probe unlock: %v", err)
	}
}

// TestWithCronLock_PropagatesBodyError makes sure a failing tick is reported to
// the caller rather than swallowed by the locking wrapper — a silent failure in
// a money worker is exactly the class of bug this whole change is about.
func TestWithCronLock_PropagatesBodyError(t *testing.T) {
	pool := lockTestPool(t)

	want := errors.New("tick exploded")
	skipped, err := withCronLock(context.Background(), pool, listingSettlementLockKey, func(context.Context) error {
		return want
	})
	if skipped {
		t.Fatal("skipped = true, want false when the lock was acquired")
	}
	if !errors.Is(err, want) {
		t.Fatalf("err = %v, want %v", err, want)
	}
}
