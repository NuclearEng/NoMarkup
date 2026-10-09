package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// testExportPool dials the live dev Postgres for the data-export tests. Like
// the notification-emit tests, these need a real DB (they assert the export
// returns the RIGHT user's rows and NONE of another user's), so they self-skip
// when EXPORT_TEST_DATABASE_URL is unset — keeping the default `go test` run
// hermetic. Run them against the running stack with:
//
//	EXPORT_TEST_DATABASE_URL='postgresql://nomarkup@localhost:5433/nomarkup?sslmode=disable' \
//	  go -C gateway test ./internal/handler/ -run TestDataExport -v
func testExportPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("EXPORT_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("EXPORT_TEST_DATABASE_URL unset — skipping live-DB data-export test")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// TestDataExportNilDBRoutes verifies the route resolves and the db-nil
// short-circuit returns 503 (matches the rest of the DB-backed surface).
// This runs in the default hermetic suite (no DB needed).
func TestDataExportNilDBRoutes(t *testing.T) {
	t.Parallel()
	h := NewDataExportHandler(nil)

	r := chi.NewRouter()
	r.Get("/api/v1/users/me/export", h.ExportMyData)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/export", nil)
	req = addClaimsToRequest(req, "11111111-1111-1111-1111-111111111111", "a@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("got %d, want %d (body=%s)", rec.Code, http.StatusServiceUnavailable, rec.Body.String())
	}
}

// seedExportUser inserts a throwaway user and returns its id, registering
// cleanup of the user and every table the export reads.
func seedExportUser(t *testing.T, pool *pgxpool.Pool, email, displayName string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (email, password_hash, display_name, phone, roles, status)
		VALUES ($1, 'x', $2, $3, ARRAY['customer','provider'], 'active')
		RETURNING id::text`, email, displayName, "+1555"+randSuffix()[:7]).Scan(&id)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM saved_searches WHERE user_id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

// TestDataExportOwnerScopedLiveDB is the core IDOR / owner-scoping proof.
//
// It seeds two distinct users (A and B), gives each a notification and a saved
// search carrying a UNIQUE marker string, then runs the export AS USER A and
// asserts:
//   - the response is 200 and the metadata user_id is A,
//   - A's marker strings ARE present in the export body,
//   - NONE of B's marker strings (or B's id/email/phone) appear anywhere,
//   - an unauthenticated request returns 401.
func TestDataExportOwnerScopedLiveDB(t *testing.T) {
	pool := testExportPool(t)
	ctx := context.Background()

	aMark := "AMARK-" + randSuffix()
	bMark := "BMARK-" + randSuffix()

	userA := seedExportUser(t, pool, "exp-a-"+randSuffix()+"@nomarkup.test", "Alice Export "+aMark)
	userB := seedExportUser(t, pool, "exp-b-"+randSuffix()+"@nomarkup.test", "Bob Export "+bMark)

	// Read back B's email + phone so we can assert they NEVER leak into A's export.
	var bEmail, bPhone string
	if err := pool.QueryRow(ctx, `SELECT email, COALESCE(phone,'') FROM users WHERE id = $1`, userB).Scan(&bEmail, &bPhone); err != nil {
		t.Fatalf("read B contact: %v", err)
	}

	// Seed a notification for each user carrying their marker in the title.
	for _, s := range []struct {
		uid, mark string
	}{{userA, aMark}, {userB, bMark}} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO notifications (user_id, notification_type, title, body, channels)
			VALUES ($1, 'system', $2, 'body', ARRAY['in_app'])`,
			s.uid, "Notif "+s.mark); err != nil {
			t.Fatalf("seed notification for %s: %v", s.uid, err)
		}
	}

	// Seed a saved search for each user carrying their marker in the name.
	for _, s := range []struct {
		uid, mark string
	}{{userA, aMark}, {userB, bMark}} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO saved_searches (user_id, name, query_json, alert_frequency)
			VALUES ($1, $2, '{}'::jsonb, 'daily')`,
			s.uid, "Search "+s.mark); err != nil {
			t.Fatalf("seed saved_search for %s: %v", s.uid, err)
		}
	}

	h := NewDataExportHandler(pool)
	r := chi.NewRouter()
	r.Get("/api/v1/users/me/export", h.ExportMyData)

	// ── Unauthenticated → 401 ──────────────────────────────────────────────
	unauthReq := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/export", nil)
	unauthRec := httptest.NewRecorder()
	r.ServeHTTP(unauthRec, unauthReq)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated export: got %d, want 401 (body=%s)", unauthRec.Code, unauthRec.Body.String())
	}

	// ── Authenticated as A → 200, only A's data ────────────────────────────
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/export", nil)
	req = addClaimsToRequest(req, userA, "exp-a@nomarkup.test", []string{"customer", "provider"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("export: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	// Metadata user_id must be A.
	var parsed map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("unmarshal export: %v", err)
	}
	meta, _ := parsed["export_metadata"].(map[string]interface{})
	if meta == nil || meta["user_id"] != userA {
		t.Fatalf("export metadata user_id mismatch: got %v, want %s", meta["user_id"], userA)
	}

	body := rec.Body.String()

	// A's markers MUST be present (proves the export actually returns A's data).
	if !strings.Contains(body, aMark) {
		t.Fatalf("A's marker %q missing from A's export — export is not returning the owner's data", aMark)
	}

	// ── The IDOR guarantee: NONE of B's private data may appear. ───────────
	for _, leak := range []struct {
		what, val string
	}{
		{"B's marker", bMark},
		{"B's user id", userB},
		{"B's email", bEmail},
	} {
		if leak.val != "" && strings.Contains(body, leak.val) {
			t.Fatalf("IDOR LEAK: %s (%q) appears in user A's export", leak.what, leak.val)
		}
	}
	if bPhone != "" && strings.Contains(body, bPhone) {
		t.Fatalf("IDOR LEAK: B's phone (%q) appears in user A's export", bPhone)
	}
}
