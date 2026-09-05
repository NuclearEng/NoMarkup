//go:build dbtest

// Package repository — DB-backed tests for the batch public-user lookup and
// the refresh-token family/lineage columns added in migration 100.
//
// These run the REAL pgx code against a real PostgreSQL, which is the only way
// to prove two things unit tests cannot:
//   - `= ANY($1::uuid[])` actually round-trips a Go []string through pgx and
//     hits users_pkey, rather than erroring on the cast or silently degrading.
//   - the atomic rotation gate and family revoke behave under real concurrency,
//     where Postgres — not a mutex in a fake — is the arbiter.
//
// Run with:
//
//	DATABASE_URL=postgres://... go test -tags=dbtest ./internal/repository/...
package repository

import (
	"context"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/user/internal/domain"
)

// queryCounter is a pgx QueryTracer that counts every statement the pool
// executes. It is the direct, non-negotiable evidence for the "ONE database
// query for N ids, not a loop" requirement: if the implementation ever
// regresses to a per-id loop, the count moves off 1 and the test fails.
type queryCounter struct {
	n atomic.Int64
}

func (q *queryCounter) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	q.n.Add(1)
	return ctx
}

func (q *queryCounter) TraceQueryEnd(_ context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) {}

func (q *queryCounter) reset() { q.n.Store(0) }
func (q *queryCounter) count() int64 {
	return q.n.Load()
}

// newCountingRepo builds a repository whose pool counts executed statements.
// cipher is nil: neither the batch projection nor the refresh-token statements
// touch encrypted columns.
func newCountingRepo(t *testing.T) (*PostgresRepository, *queryCounter) {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set; skipping db-backed test")
	}

	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse config: %v", err)
	}
	counter := &queryCounter{}
	cfg.ConnConfig.Tracer = counter
	// One connection makes the statement count deterministic.
	cfg.MinConns = 1
	cfg.MaxConns = 4

	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)

	return NewPostgresRepository(pool, nil), counter
}

// seedUser inserts a throwaway user and registers its cleanup.
func seedUser(t *testing.T, r *PostgresRepository, email, displayName string, softDeleted bool) string {
	t.Helper()
	ctx := context.Background()

	var id string
	err := r.pool.QueryRow(ctx,
		`INSERT INTO users (email, display_name, roles, status, deleted_at)
		 VALUES ($1, $2, ARRAY['customer'], 'active', CASE WHEN $3 THEN now() ELSE NULL END)
		 RETURNING id`,
		email, displayName, softDeleted,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}

	t.Cleanup(func() {
		//nolint:errcheck // best-effort cleanup
		r.pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

// TestGetPublicUsersByIDs_SingleQuery is the load-bearing performance proof:
// N ids cost exactly ONE statement.
func TestGetPublicUsersByIDs_SingleQuery(t *testing.T) {
	repo, counter := newCountingRepo(t)
	ctx := context.Background()

	const n = 50
	ids := make([]string, 0, n)
	for i := 0; i < n; i++ {
		ids = append(ids, seedUser(t,
			repo,
			"dbtest-batch-"+time.Now().Format("150405.000000")+"-"+itoa(i)+"@example.test",
			"Batch "+itoa(i),
			false,
		))
	}

	counter.reset()
	users, err := repo.GetPublicUsersByIDs(ctx, ids)
	if err != nil {
		t.Fatalf("GetPublicUsersByIDs: %v", err)
	}

	if got := counter.count(); got != 1 {
		t.Errorf("expected exactly 1 database query for %d ids, got %d — the batch path has regressed to a loop", n, got)
	}
	if len(users) != n {
		t.Errorf("expected %d users, got %d", n, len(users))
	}
}

// TestGetPublicUsersByIDs_MissingAndDeleted proves a missing or soft-deleted id
// yields an absence, not a failed call — the hydration paths must fail soft.
func TestGetPublicUsersByIDs_MissingAndDeleted(t *testing.T) {
	repo, _ := newCountingRepo(t)
	ctx := context.Background()

	stamp := time.Now().Format("150405.000000")
	liveID := seedUser(t, repo, "dbtest-live-"+stamp+"@example.test", "Live User", false)
	deletedID := seedUser(t, repo, "dbtest-deleted-"+stamp+"@example.test", "Deleted User", true)
	const absentID = "00000000-0000-4000-8000-000000000000"

	users, err := repo.GetPublicUsersByIDs(ctx, []string{liveID, deletedID, absentID})
	if err != nil {
		t.Fatalf("GetPublicUsersByIDs: %v", err)
	}

	if len(users) != 1 {
		t.Fatalf("expected only the live user, got %d rows", len(users))
	}
	if users[0].ID != liveID {
		t.Errorf("expected live user %s, got %s", liveID, users[0].ID)
	}
	if users[0].DisplayName != "Live User" {
		t.Errorf("display name not hydrated: %q", users[0].DisplayName)
	}
}

// TestRefreshTokenFamily_RotationAndRevoke exercises migration 100 end to end
// against real SQL: a rotation stamps rotated_at, the successor inherits the
// family, and revoking the family kills every live descendant.
func TestRefreshTokenFamily_RotationAndRevoke(t *testing.T) {
	repo, _ := newCountingRepo(t)
	ctx := context.Background()

	userID := seedUser(t, repo, "dbtest-family-"+time.Now().Format("150405.000000")+"@example.test", "Family User", false)

	// Session root: no family supplied, so the DB mints one.
	root := &domain.RefreshToken{
		UserID:    userID,
		TokenHash: "dbtest-hash-root-" + time.Now().Format("150405.000000"),
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
	}
	if err := repo.CreateRefreshToken(ctx, root); err != nil {
		t.Fatalf("create root: %v", err)
	}
	if root.FamilyID == "" {
		t.Fatal("expected the database to mint a family id for a session root")
	}

	// Rotate it.
	ok, err := repo.RotateRefreshTokenIfActive(ctx, root.TokenHash)
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if !ok {
		t.Fatal("expected the first rotation of an active token to win the gate")
	}

	// A second rotation of the same token must lose (single-use).
	ok, err = repo.RotateRefreshTokenIfActive(ctx, root.TokenHash)
	if err != nil {
		t.Fatalf("rotate again: %v", err)
	}
	if ok {
		t.Error("a token must not be rotatable twice")
	}

	// The rotated token must now report rotated_at — the reuse-detection premise.
	reread, err := repo.GetRefreshToken(ctx, root.TokenHash)
	if err != nil {
		t.Fatalf("re-read root: %v", err)
	}
	if reread.RotatedAt == nil {
		t.Error("rotation must stamp rotated_at, otherwise replays cannot be told from logouts")
	}
	if reread.RevokedAt == nil {
		t.Error("rotation must also revoke the token")
	}

	// Child inherits the family.
	child := &domain.RefreshToken{
		UserID:    userID,
		TokenHash: "dbtest-hash-child-" + time.Now().Format("150405.000000"),
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
		FamilyID:  root.FamilyID,
		ParentID:  &root.ID,
	}
	if err := repo.CreateRefreshToken(ctx, child); err != nil {
		t.Fatalf("create child: %v", err)
	}
	if child.FamilyID != root.FamilyID {
		t.Errorf("child family %s != root family %s", child.FamilyID, root.FamilyID)
	}

	// Revoking the family must kill the live child (the root is already revoked
	// by rotation, so exactly one row should be affected).
	n, err := repo.RevokeRefreshTokenFamily(ctx, root.FamilyID)
	if err != nil {
		t.Fatalf("revoke family: %v", err)
	}
	if n != 1 {
		t.Errorf("expected 1 live descendant revoked, got %d", n)
	}

	childAfter, err := repo.GetRefreshToken(ctx, child.TokenHash)
	if err != nil {
		t.Fatalf("re-read child: %v", err)
	}
	if childAfter.RevokedAt == nil {
		t.Error("family revocation must revoke the live descendant — otherwise a thief keeps their session")
	}
	if childAfter.RotatedAt != nil {
		t.Error("family revocation must NOT stamp rotated_at; only rotation may")
	}
}

// TestRotateRefreshTokenIfActive_ConcurrentSingleWinner proves the atomic gate
// with Postgres as the arbiter, not a Go mutex.
func TestRotateRefreshTokenIfActive_ConcurrentSingleWinner(t *testing.T) {
	repo, _ := newCountingRepo(t)
	ctx := context.Background()

	userID := seedUser(t, repo, "dbtest-race-"+time.Now().Format("150405.000000")+"@example.test", "Race User", false)

	tok := &domain.RefreshToken{
		UserID:    userID,
		TokenHash: "dbtest-hash-race-" + time.Now().Format("150405.000000"),
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
	}
	if err := repo.CreateRefreshToken(ctx, tok); err != nil {
		t.Fatalf("create: %v", err)
	}

	const n = 8
	var winners atomic.Int32
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			ok, err := repo.RotateRefreshTokenIfActive(context.Background(), tok.TokenHash)
			if err != nil {
				t.Errorf("rotate: %v", err)
				return
			}
			if ok {
				winners.Add(1)
			}
		}()
	}
	wg.Wait()

	if got := winners.Load(); got != 1 {
		t.Errorf("expected exactly 1 winner among %d concurrent rotations, got %d", n, got)
	}
}

// itoa avoids pulling strconv in for two call sites.
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var buf [8]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(buf[pos:])
}
