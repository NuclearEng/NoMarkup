//go:build dbtest

package main

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// seedWorkSession creates a contract between two fresh users and one closed
// work session holding PLAINTEXT check-in and check-out ordinates — the shape
// every pre-138 gateway wrote. Returns the session id.
func seedWorkSession(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	customer := seedUser(t, pool, "ws-customer@example.com", "512-555-0901", nil)
	provider := seedUser(t, pool, "ws-provider@example.com", "512-555-0902", nil)
	job := seedJob(t, pool, customer, anyCategoryID(t, pool), fixtureJobAddress, fixtureLat, fixtureLng, nil)

	var bid, contract, session string
	if err := pool.QueryRow(ctx, `
		INSERT INTO bids (job_id, provider_id, amount_cents, original_amount_cents, status)
		VALUES ($1::uuid, $2::uuid, 10000, 10000, 'awarded') RETURNING id::text`, job, provider).Scan(&bid); err != nil {
		t.Fatalf("seed bid: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO contracts (contract_number, job_id, customer_id, provider_id, bid_id,
		                       amount_cents, payment_timing, status, started_at)
		VALUES ('NM-ORD-1', $1::uuid, $2::uuid, $3::uuid, $4::uuid, 10000, 'completion', 'active', now())
		RETURNING id::text`, job, customer, provider, bid).Scan(&contract); err != nil {
		t.Fatalf("seed contract: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO contract_work_sessions (contract_id, provider_id, checked_in_at, check_in_lat, check_in_lng,
		                                    checked_out_at, check_out_lat, check_out_lng, duration_minutes)
		VALUES ($1::uuid, $2::uuid, now() - interval '1 hour', $3, $4, now(), $5, $6, 60)
		RETURNING id::text`, contract, provider, fixtureLat, fixtureLng, fixtureLat+0.001, fixtureLng).Scan(&session); err != nil {
		t.Fatalf("seed work session: %v", err)
	}
	return session
}

// TestRunDrainsWorkSessionOrdinates is the acceptance test for migrations
// 138/139: a run must seal both plaintext pairs into their siblings, NULL every
// ordinate in the same statement, leave pii_plaintext_audit empty, and be a
// no-op the second time.
func TestRunDrainsWorkSessionOrdinates(t *testing.T) {
	pool := testPool(t)
	reset(t, pool)
	ctx := context.Background()
	key := mustKey(t)
	kr := keyring{primary: key}
	session := seedWorkSession(t, pool)

	if before := auditRows(t, pool); len(before) == 0 {
		t.Fatal("fixture is already clean; the test would prove nothing")
	}
	if err := run(ctx, pool, kr, false); err != nil {
		t.Fatalf("run: %v", err)
	}
	if after := auditRows(t, pool); len(after) != 0 {
		t.Fatalf("audit views are not empty after a full run: %v", after)
	}

	read := func() (inEnc, outEnc string, plaintextLeft bool) {
		t.Helper()
		if err := pool.QueryRow(ctx, `
			SELECT check_in_location_encrypted, check_out_location_encrypted,
			       (check_in_lat IS NOT NULL OR check_in_lng IS NOT NULL
			        OR check_out_lat IS NOT NULL OR check_out_lng IS NOT NULL)
			  FROM contract_work_sessions WHERE id::text = $1`, session).Scan(&inEnc, &outEnc, &plaintextLeft); err != nil {
			t.Fatalf("read session: %v", err)
		}
		return
	}
	inEnc, outEnc, left := read()
	if left {
		t.Fatal("plaintext ordinates survived the drain")
	}
	for _, c := range []struct{ name, ct, want string }{
		{"check_in", inEnc, formatExactPoint(fixtureLat, fixtureLng)},
		{"check_out", outEnc, formatExactPoint(fixtureLat+0.001, fixtureLng)},
	} {
		if got, ok := open(key, c.ct); !ok || got != c.want {
			t.Errorf("%s sibling opens as (%q, %v), want %q", c.name, got, ok, c.want)
		}
	}

	// Second run: nothing to do, ciphertext untouched.
	if err := run(ctx, pool, kr, false); err != nil {
		t.Fatalf("second run: %v", err)
	}
	in2, out2, _ := read()
	if in2 != inEnc || out2 != outEnc {
		t.Fatal("second run rewrote already-current ciphertext")
	}
}

// A row changed between scan and update (a live gateway write) must be left for
// the next run, not overwritten with the stale scanned value.
func TestOrdinateUpdateGuardSkipsConcurrentWrite(t *testing.T) {
	pool := testPool(t)
	reset(t, pool)
	ctx := context.Background()
	kr := keyring{primary: mustKey(t)}
	session := seedWorkSession(t, pool)
	spec := ordinateSpecs[0]

	var scanned []ordinateRow
	if err := scanOrdinateTable(ctx, pool, spec, func(r ordinateRow) error {
		scanned = append(scanned, r)
		return nil
	}); err != nil || len(scanned) != 1 {
		t.Fatalf("scan: %v (rows=%d)", err, len(scanned))
	}
	// The live gateway refreshes the check-in in clear (an old pod).
	if _, err := pool.Exec(ctx, `UPDATE contract_work_sessions SET check_in_lat = 1, check_in_lng = 2 WHERE id::text = $1`, session); err != nil {
		t.Fatalf("concurrent write: %v", err)
	}
	r := scanned[0]
	args := []any{r.id}
	for i, p := range r.pairs {
		enc, _, err := reconcileOrdinatePair(kr, spec.pairs[i].encCol, p)
		if err != nil {
			t.Fatalf("reconcile: %v", err)
		}
		args = append(args, enc)
	}
	for _, p := range r.pairs {
		args = append(args, p.enc, p.lat, p.lng)
	}
	tag, err := pool.Exec(ctx, spec.updateSQL, args...)
	if err != nil {
		t.Fatalf("guarded update: %v", err)
	}
	if tag.RowsAffected() != 0 {
		t.Fatal("guarded update overwrote a row that changed after the scan")
	}
	// The next full run picks up the newer value.
	if err := run(ctx, pool, kr, false); err != nil {
		t.Fatalf("run: %v", err)
	}
	var inEnc string
	if err := pool.QueryRow(ctx, `SELECT check_in_location_encrypted FROM contract_work_sessions WHERE id::text = $1`, session).Scan(&inEnc); err != nil {
		t.Fatalf("read: %v", err)
	}
	if got, ok := open(kr.primary, inEnc); !ok || got != formatExactPoint(1, 2) {
		t.Fatalf("check-in sibling = (%q, %v), want the concurrently written point", got, ok)
	}
}
