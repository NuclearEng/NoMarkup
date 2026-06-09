package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ─────────────────────────────────────────────────────────────────────────
// Routing + validation smoke tests (db = nil) — mirrors wishlist_test.go:
// proves the routes are wired, auth propagates, and the nil-db guard fails
// closed (503) on writes before persisting anything.
// ─────────────────────────────────────────────────────────────────────────

func newUserReportsRouter(h *UserReportsHandler) chi.Router {
	r := chi.NewRouter()
	r.Post("/api/v1/users/{id}/report", h.CreateUserReport)
	r.Get("/api/v1/admin/user-reports", h.ListUserReports)
	r.Post("/api/v1/admin/user-reports/{id}/resolve", h.ResolveUserReport)
	return r
}

func authReq(req *http.Request, userID string) *http.Request {
	c := &middleware.Claims{UserID: userID, Email: "a@b.c", Roles: []string{"customer"}}
	return req.WithContext(context.WithValue(req.Context(), middleware.ClaimsContextKey, c))
}

func TestUserReportsRoutingNilDB(t *testing.T) {
	h := NewUserReportsHandler(nil)
	r := newUserReportsRouter(h)

	const target = "11111111-1111-1111-1111-111111111111"

	cases := []struct {
		name       string
		method     string
		path       string
		body       []byte
		authed     bool
		wantStatus int
	}{
		// Write fails closed on nil db (503) regardless of auth.
		{"create-no-auth-503", http.MethodPost, "/api/v1/users/" + target + "/report", []byte(`{"reason":"spam"}`), false, http.StatusServiceUnavailable},
		{"create-authed-503", http.MethodPost, "/api/v1/users/" + target + "/report", []byte(`{"reason":"spam"}`), true, http.StatusServiceUnavailable},
		// Admin list degrades to empty 200 on nil db.
		{"admin-list-200-empty", http.MethodGet, "/api/v1/admin/user-reports", nil, true, http.StatusOK},
		// Admin resolve fails closed (503) on nil db.
		{"admin-resolve-503", http.MethodPost, "/api/v1/admin/user-reports/" + target + "/resolve", []byte(`{"action":"dismiss"}`), true, http.StatusServiceUnavailable},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, bytes.NewReader(tc.body))
			if tc.authed {
				req = authReq(req, "22222222-2222-2222-2222-222222222222")
			}
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Fatalf("%s %s: got %d want %d (body=%s)", tc.method, tc.path, rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Live-DB tests — exercise persistence, owner-scoping, self-report rejection,
// reason validation, dedup, and admin-queue visibility against a real
// Postgres. Skips when GATEWAY_TEST_DATABASE_URL (or DATABASE_URL) is unset.
// ─────────────────────────────────────────────────────────────────────────

func liveTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("GATEWAY_TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no GATEWAY_TEST_DATABASE_URL/DATABASE_URL set — skipping live-db user-reports test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot connect to test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("test db unreachable: %v", err)
	}
	// Register close via Cleanup (not defer) so it runs AFTER the per-user
	// cleanups registered later — t.Cleanup is LIFO, and a `defer pool.Close()`
	// in the test body would otherwise close the pool before those row deletes.
	t.Cleanup(pool.Close)
	return pool
}

// seedTestUser inserts a throwaway user and returns its id, registering
// cleanup that removes it (cascading away any reports it filed/received).
func seedTestUser(t *testing.T, pool *pgxpool.Pool, email string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	err := pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, roles, display_name)
		 VALUES ($1, 'x', ARRAY['customer'], 'Test User')
		 RETURNING id`, email).Scan(&id)
	if err != nil {
		t.Fatalf("seed user %s: %v", email, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

func TestUserReportsLiveDB(t *testing.T) {
	pool := liveTestPool(t)

	h := NewUserReportsHandler(pool)
	r := newUserReportsRouter(h)

	// Unique per-run suffix so reruns (and a prior crashed run whose cleanup
	// didn't fire) never collide on the users.email UNIQUE constraint.
	suffix := uuid.NewString()[:8]
	reporter := seedTestUser(t, pool, "ur-reporter-"+suffix+"@test.invalid")
	target := seedTestUser(t, pool, "ur-target-"+suffix+"@test.invalid")
	admin := seedTestUser(t, pool, "ur-admin-"+suffix+"@test.invalid")

	post := func(t *testing.T, path, body, asUser string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader([]byte(body)))
		req = authReq(req, asUser)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec
	}

	// 1. Self-report → 400, nothing persisted.
	if rec := post(t, "/api/v1/users/"+reporter+"/report", `{"reason":"spam"}`, reporter); rec.Code != http.StatusBadRequest {
		t.Fatalf("self-report: got %d want 400 (body=%s)", rec.Code, rec.Body.String())
	}

	// 2. Invalid reason → 400.
	if rec := post(t, "/api/v1/users/"+target+"/report", `{"reason":"bogus"}`, reporter); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad reason: got %d want 400 (body=%s)", rec.Code, rec.Body.String())
	}

	// 3. Valid report → 201, persisted owner-scoped (reporter = authed user).
	rec := post(t, "/api/v1/users/"+target+"/report",
		`{"reason":"harassment","description":"abusive DMs"}`, reporter)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create report: got %d want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	var created struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal create: %v", err)
	}
	if created.ID == "" || created.Status != "open" {
		t.Fatalf("unexpected create payload: %+v", created)
	}

	// Verify owner-scoping + persistence directly.
	var gotReporter, gotTarget, gotReason, gotStatus string
	if err := pool.QueryRow(context.Background(),
		`SELECT reporter_id, reported_user_id, reason, status FROM user_reports WHERE id = $1`, created.ID,
	).Scan(&gotReporter, &gotTarget, &gotReason, &gotStatus); err != nil {
		t.Fatalf("read back report: %v", err)
	}
	if gotReporter != reporter || gotTarget != target || gotReason != "harassment" || gotStatus != "open" {
		t.Fatalf("persisted row mismatch: reporter=%s target=%s reason=%s status=%s",
			gotReporter, gotTarget, gotReason, gotStatus)
	}

	// 4. Dedup: same reporter re-reports same target while open → 200 already_reported,
	//    no second row.
	rec = post(t, "/api/v1/users/"+target+"/report", `{"reason":"spam"}`, reporter)
	if rec.Code != http.StatusOK {
		t.Fatalf("dedup report: got %d want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var openCount int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM user_reports WHERE reporter_id=$1 AND reported_user_id=$2 AND status='open'`,
		reporter, target).Scan(&openCount); err != nil {
		t.Fatalf("count open: %v", err)
	}
	if openCount != 1 {
		t.Fatalf("dedup failed: %d open reports, want 1", openCount)
	}

	// 5. Surfaces to the admin queue.
	listReq := httptest.NewRequest(http.MethodGet,
		"/api/v1/admin/user-reports?reported_user_id="+target, nil)
	listReq = authReq(listReq, admin)
	listRec := httptest.NewRecorder()
	r.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("admin list: got %d want 200 (body=%s)", listRec.Code, listRec.Body.String())
	}
	var listResp struct {
		Reports []struct {
			ID             string `json:"id"`
			ReportedUserID string `json:"reported_user_id"`
			Reason         string `json:"reason"`
			Status         string `json:"status"`
		} `json:"reports"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("unmarshal admin list: %v", err)
	}
	found := false
	for _, rep := range listResp.Reports {
		if rep.ID == created.ID {
			found = true
			if rep.ReportedUserID != target || rep.Reason != "harassment" || rep.Status != "open" {
				t.Fatalf("admin row mismatch: %+v", rep)
			}
		}
	}
	if !found {
		t.Fatalf("created report %s not visible in admin queue", created.ID)
	}

	// 6. Admin resolve → status flips to dismissed.
	resolveRec := post(t, "/api/v1/admin/user-reports/"+created.ID+"/resolve",
		`{"action":"dismiss","notes":"reviewed"}`, admin)
	if resolveRec.Code != http.StatusOK {
		t.Fatalf("resolve: got %d want 200 (body=%s)", resolveRec.Code, resolveRec.Body.String())
	}
	var afterStatus string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM user_reports WHERE id=$1`, created.ID).Scan(&afterStatus); err != nil {
		t.Fatalf("read status after resolve: %v", err)
	}
	if afterStatus != "dismissed" {
		t.Fatalf("after resolve: status=%s want dismissed", afterStatus)
	}
}
