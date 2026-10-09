package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newActivityRouter(h *ActivityHandler) chi.Router {
	r := chi.NewRouter()
	r.Get("/api/v1/me/activity", h.ListMyActivity)
	return r
}

func TestActivitySanitizePath(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in, want string
	}{
		{"", "/"},
		{"   ", "/"},
		{"/jobs/abc", "/jobs/abc"},
		{"/jobs/abc?token=secret&foo=1", "/jobs/abc"},
		{"/jobs/abc#section", "/jobs/abc"},
		{"/jobs/abc?x=1#y", "/jobs/abc"},
		{"?token=secret", "/"},
		{"#hash", "/"},
		{strings.Repeat("a", 250), strings.Repeat("a", 200)},
		{"/" + strings.Repeat("b", 250), "/" + strings.Repeat("b", 199)},
	}
	for _, tc := range cases {
		got := sanitizeActivityPath(tc.in)
		if got != tc.want {
			t.Errorf("sanitizeActivityPath(%q) = %q want %q", tc.in, got, tc.want)
		}
		if strings.ContainsAny(got, "?#") {
			t.Errorf("sanitizeActivityPath(%q) leaked query/hash: %q", tc.in, got)
		}
		if len(got) > activityPathMaxLen {
			t.Errorf("sanitizeActivityPath(%q) length %d exceeds %d", tc.in, len(got), activityPathMaxLen)
		}
	}
}

func TestActivityListUnauthenticated(t *testing.T) {
	t.Parallel()
	h := NewActivityHandler(nil)
	r := newActivityRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/activity", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("got %d want 401 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestActivityListNilDBEmpty(t *testing.T) {
	t.Parallel()
	h := NewActivityHandler(nil)
	r := newActivityRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/activity", nil)
	req = addClaimsToRequest(req, "11111111-1111-1111-1111-111111111111", "a@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var got activityListResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Events == nil || len(got.Events) != 0 {
		t.Fatalf("events = %#v want []", got.Events)
	}
}

func TestActivityParseLimit(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want int
	}{
		{"", 50},
		{"10", 10},
		{"200", 200},
		{"201", 200},
		{"0", 50},
		{"-1", 50},
		{"abc", 50},
	}
	for _, tc := range cases {
		if got := parseActivityLimit(tc.in); got != tc.want {
			t.Errorf("parseActivityLimit(%q) = %d want %d", tc.in, got, tc.want)
		}
	}
}

func TestActivityListInvalidBefore(t *testing.T) {
	t.Parallel()
	h := NewActivityHandler(nil)
	r := newActivityRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/activity?before=not-a-time", nil)
	req = addClaimsToRequest(req, "11111111-1111-1111-1111-111111111111", "a@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("got %d want 400 (body=%s)", rec.Code, rec.Body.String())
	}
}

func activityLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("GATEWAY_TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no GATEWAY_TEST_DATABASE_URL/DATABASE_URL set — skipping live-db activity test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot connect to test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("test db unreachable: %v", err)
	}
	var exists bool
	if err := pool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_request_activity')`,
	).Scan(&exists); err != nil || !exists {
		pool.Close()
		t.Skip("user_request_activity table not present — apply migration 132")
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedActivityUser(t *testing.T, pool *pgxpool.Pool, email string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (email, password_hash, display_name, roles, status)
		VALUES ($1, 'x', 'activity-test', ARRAY['customer'], 'active')
		RETURNING id::text`, email).Scan(&id)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM user_request_activity WHERE user_id = $1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func TestActivityInsertAndListOwnerIsolation(t *testing.T) {
	pool := activityLivePool(t)
	ctx := context.Background()
	h := NewActivityHandler(pool)
	r := newActivityRouter(h)

	userA := seedActivityUser(t, pool, "act-a-"+strings.ReplaceAll(t.Name(), "/", "-")+"@nomarkup.test")
	userB := seedActivityUser(t, pool, "act-b-"+strings.ReplaceAll(t.Name(), "/", "-")+"@nomarkup.test")

	marker := "/activity-test-" + strings.ReplaceAll(t.Name(), "/", "-")
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_request_activity (user_id, request_id, method, path, status, duration_ms)
		VALUES ($1, 'req-a', 'GET', $2, 200, 12),
		       ($3, 'req-b', 'POST', $2, 201, 30)`,
		userA, marker, userB); err != nil {
		t.Fatalf("insert: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/activity?limit=50", nil)
	req = addClaimsToRequest(req, userA, "a@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner list: got %d want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	var got activityListResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Events) != 1 {
		t.Fatalf("owner events = %d want 1 (IDOR or missing row): %+v", len(got.Events), got.Events)
	}
	ev := got.Events[0]
	if ev.RequestID != "req-a" {
		t.Fatalf("request_id = %q want req-a", ev.RequestID)
	}
	if ev.Path != marker {
		t.Fatalf("path = %q want %q", ev.Path, marker)
	}
	if ev.Status != 200 || ev.DurationMs != 12 || ev.Method != "GET" {
		t.Fatalf("event = %+v", ev)
	}
	if ev.ID == "" || ev.CreatedAt.IsZero() {
		t.Fatalf("missing id/created_at: %+v", ev)
	}

	other := httptest.NewRequest(http.MethodGet, "/api/v1/me/activity", nil)
	other = addClaimsToRequest(other, userB, "b@example.com", []string{"customer"})
	otherRec := httptest.NewRecorder()
	r.ServeHTTP(otherRec, other)
	if otherRec.Code != http.StatusOK {
		t.Fatalf("other list: got %d want 200 (body=%s)", otherRec.Code, otherRec.Body.String())
	}
	var otherGot activityListResponse
	if err := json.NewDecoder(otherRec.Body).Decode(&otherGot); err != nil {
		t.Fatalf("decode other: %v", err)
	}
	if len(otherGot.Events) != 1 {
		t.Fatalf("other events = %d want 1", len(otherGot.Events))
	}
	if otherGot.Events[0].RequestID != "req-b" {
		t.Fatalf("other saw %q — owner isolation failed", otherGot.Events[0].RequestID)
	}

	unauth := httptest.NewRequest(http.MethodGet, "/api/v1/me/activity", nil)
	unauthRec := httptest.NewRecorder()
	r.ServeHTTP(unauthRec, unauth)
	if unauthRec.Code != http.StatusUnauthorized {
		t.Fatalf("unauth: got %d want 401", unauthRec.Code)
	}
}

func TestActivityListStripsStoredQuery(t *testing.T) {
	t.Parallel()
	// Defense-in-depth on the read path: even if a row slipped in with a
	// query string, the list response must not emit it.
	raw := sanitizeActivityPath("/jobs/abc?token=secret#x")
	if raw != "/jobs/abc" {
		t.Fatalf("sanitizeActivityPath = %q want /jobs/abc", raw)
	}
}

func TestActivityListCursorBefore(t *testing.T) {
	pool := activityLivePool(t)
	ctx := context.Background()
	h := NewActivityHandler(pool)
	r := newActivityRouter(h)

	userID := seedActivityUser(t, pool, "act-c-"+strings.ReplaceAll(t.Name(), "/", "-")+"@nomarkup.test")
	old := time.Now().UTC().Add(-2 * time.Hour)
	recent := time.Now().UTC().Add(-time.Minute)
	if _, err := pool.Exec(ctx, `
		INSERT INTO user_request_activity (user_id, request_id, method, path, status, duration_ms, created_at)
		VALUES ($1, 'req-old', 'GET', '/old', 200, 1, $2),
		       ($1, 'req-new', 'GET', '/new', 200, 1, $3)`,
		userID, old, recent); err != nil {
		t.Fatalf("insert: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/activity?before="+recent.Format(time.RFC3339Nano), nil)
	req = addClaimsToRequest(req, userID, "c@example.com", []string{"customer"})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var got activityListResponse
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Events) != 1 || got.Events[0].RequestID != "req-old" {
		t.Fatalf("cursor events = %+v want only req-old", got.Events)
	}
}
