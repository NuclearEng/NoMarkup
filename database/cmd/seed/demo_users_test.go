package main

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// Regression guard for the 2026-04 seed extension: every demo user must have
// `dob` + `dob_verified_at` populated (otherwise account-creation gates trip
// in the gateway) AND must have a `tos_acceptances` row at version 1.0
// (otherwise the dashboard blocks behind the ToS modal on first load).
//
// These tests need a live, already-seeded database. They are skipped when
// SEED_TEST_DATABASE_URL (or DATABASE_URL) isn't set or the connection fails,
// so the package's pure-fixture tests still run in environments without
// Postgres. Locally:
//   DATABASE_URL="postgresql://nomarkup@localhost:5433/nomarkup?sslmode=disable" \
//     go test ./cmd/seed/... -run TestDemoUsers
//
// Assumes the seeder has already been run against the target DB (the
// idempotent ON CONFLICT clauses in main.go mean the rows exist after the
// first `make seed`).

var demoUserIDs = []struct {
	id   string
	name string
}{
	{adminUserID, "admin"},
	{customerUserID, "customer"},
	{providerUserID, "provider"},
	{provider2UserID, "provider2"},
}

func connectSeedTestDB(t *testing.T) *pgx.Conn {
	t.Helper()
	dbURL := os.Getenv("SEED_TEST_DATABASE_URL")
	if dbURL == "" {
		dbURL = os.Getenv("DATABASE_URL")
	}
	if dbURL == "" {
		t.Skip("DATABASE_URL not set — skipping DB-backed seed test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Skipf("connect to seed DB: %v — skipping", err)
	}
	return conn
}

func TestDemoUsers_DOBAndVerification(t *testing.T) {
	conn := connectSeedTestDB(t)
	defer conn.Close(context.Background())

	for _, u := range demoUserIDs {
		u := u
		t.Run(u.name, func(t *testing.T) {
			var (
				dob         *time.Time
				dobVerified *time.Time
			)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			err := conn.QueryRow(ctx,
				`SELECT dob, dob_verified_at FROM users WHERE id = $1`,
				u.id,
			).Scan(&dob, &dobVerified)
			if err != nil {
				t.Fatalf("query user %s (%s): %v — was the seeder run?", u.name, u.id, err)
			}
			if dob == nil {
				t.Errorf("user %s (%s) has NULL dob — seeder regression", u.name, u.id)
			}
			if dobVerified == nil {
				t.Errorf("user %s (%s) has NULL dob_verified_at — seeder regression", u.name, u.id)
			}
		})
	}
}

func TestDemoUsers_ToSAccepted(t *testing.T) {
	conn := connectSeedTestDB(t)
	defer conn.Close(context.Background())

	for _, u := range demoUserIDs {
		u := u
		t.Run(u.name, func(t *testing.T) {
			var count int
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			err := conn.QueryRow(ctx, `
				SELECT COUNT(*) FROM tos_acceptances
				WHERE user_id = $1 AND tos_version = '1.0'`,
				u.id,
			).Scan(&count)
			if err != nil {
				t.Fatalf("query tos_acceptances for %s (%s): %v", u.name, u.id, err)
			}
			if count == 0 {
				t.Errorf("user %s (%s) missing tos_acceptances row at v1.0 — seeder regression", u.name, u.id)
			}
			// Idempotency: the (user_id, tos_version) UNIQUE constraint
			// should prevent duplicates even if the seeder runs multiple
			// times. Make that contract explicit here.
			if count > 1 {
				t.Errorf("user %s (%s) has %d tos_acceptances rows at v1.0 — idempotency broken", u.name, u.id, count)
			}
		})
	}
}
