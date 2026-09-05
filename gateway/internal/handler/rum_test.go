package handler

import (
	"bytes"
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

func newRumRouter(h *RumHandler) chi.Router {
	r := chi.NewRouter()
	r.Post("/api/v1/rum", h.PostSample)
	r.Get("/api/v1/admin/rum", h.GetSummary)
	return r
}

func TestSanitizeRumPath(t *testing.T) {
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
		{"https://no-markup.com/jobs/abc?utm=1", "/jobs/abc"},
		{"http://localhost:3000/marketplace", "/marketplace"},
		{strings.Repeat("a", 250), strings.Repeat("a", 200)},
		{"/" + strings.Repeat("b", 250), "/" + strings.Repeat("b", 199)},
	}
	for _, tc := range cases {
		got := sanitizeRumPath(tc.in)
		if got != tc.want {
			t.Errorf("sanitizeRumPath(%q) = %q want %q", tc.in, got, tc.want)
		}
		if len(got) > rumPathMaxLen {
			t.Errorf("sanitizeRumPath(%q) length %d exceeds %d", tc.in, len(got), rumPathMaxLen)
		}
	}
}

func TestPostSampleNilDBAccepted(t *testing.T) {
	t.Parallel()
	h := NewRumHandler(nil)
	r := newRumRouter(h)

	body := `{"name":"LCP","value":1800,"rating":"good","path":"/jobs"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/rum", strings.NewReader(body))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("got %d want 202 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestPostSampleValidation(t *testing.T) {
	t.Parallel()
	h := NewRumHandler(nil)
	r := newRumRouter(h)

	cases := []struct {
		name string
		body string
		want int
	}{
		{"ok", `{"name":"INP","value":120,"rating":"good","path":"/"}`, http.StatusAccepted},
		{"unknown-name", `{"name":"FID","value":12,"rating":"good","path":"/"}`, http.StatusBadRequest},
		{"empty-name", `{"name":"","value":12,"rating":"good","path":"/"}`, http.StatusBadRequest},
		{"bad-rating", `{"name":"LCP","value":12,"rating":"excellent","path":"/"}`, http.StatusBadRequest},
		{"negative", `{"name":"LCP","value":-1,"rating":"good","path":"/"}`, http.StatusBadRequest},
		{"too-large", `{"name":"LCP","value":10000000,"rating":"good","path":"/"}`, http.StatusBadRequest},
		{"invalid-json", `{`, http.StatusBadRequest},
		{"extra-pii-ignored", `{"name":"CLS","value":0.05,"rating":"good","path":"/?q=1","user_id":"u1","email":"a@b.c","ip":"1.2.3.4"}`, http.StatusAccepted},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/rum", strings.NewReader(tc.body))
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("got %d want %d (body=%s)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}

func TestGetSummaryNilDBEmpty(t *testing.T) {
	t.Parallel()
	h := NewRumHandler(nil)
	r := newRumRouter(h)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/rum", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var got map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["window_hours"] != float64(24) {
		t.Fatalf("window_hours = %v want 24", got["window_hours"])
	}
	metrics, ok := got["metrics"].([]interface{})
	if !ok || len(metrics) != 0 {
		t.Fatalf("metrics = %#v want empty list", got["metrics"])
	}
}

func rumLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("GATEWAY_TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no GATEWAY_TEST_DATABASE_URL/DATABASE_URL set — skipping live-db rum test")
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
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rum_samples')`,
	).Scan(&exists); err != nil || !exists {
		pool.Close()
		t.Skip("rum_samples table not present — apply migration 125")
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestRumSamplesHasNoPIIColumns(t *testing.T) {
	pool := rumLivePool(t)
	rows, err := pool.Query(context.Background(),
		`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rum_samples'`)
	if err != nil {
		t.Fatalf("columns: %v", err)
	}
	defer rows.Close()
	forbidden := map[string]struct{}{
		"user_id": {}, "userid": {}, "email": {}, "ip": {}, "ip_address": {},
		"cookie": {}, "session_id": {}, "device_id": {}, "phone": {},
	}
	var cols []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan: %v", err)
		}
		cols = append(cols, name)
		if _, bad := forbidden[strings.ToLower(name)]; bad {
			t.Errorf("rum_samples must not store PII column %q", name)
		}
	}
	want := map[string]struct{}{"id": {}, "name": {}, "value_ms": {}, "rating": {}, "path": {}, "created_at": {}}
	if len(cols) != len(want) {
		t.Fatalf("columns = %v want exactly %v", cols, want)
	}
	for _, c := range cols {
		if _, ok := want[c]; !ok {
			t.Errorf("unexpected column %q", c)
		}
	}
}

func TestPostSampleAndAdminP75Live(t *testing.T) {
	pool := rumLivePool(t)
	h := NewRumHandler(pool)
	r := newRumRouter(h)
	ctx := context.Background()

	marker := "/rum-test-" + strings.ReplaceAll(t.Name(), "/", "-")
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM rum_samples WHERE path = $1`, marker)
	})

	// Four LCP samples: 100, 200, 300, 400 → p75 = 325.
	for _, v := range []float64{100, 200, 300, 400} {
		body := map[string]interface{}{
			"name":   "LCP",
			"value":  v,
			"rating": "good",
			"path":   marker + "?token=should-be-stripped&user=nope",
		}
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/rum", bytes.NewReader(raw))
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("POST: got %d want 202 (body=%s)", rec.Code, rec.Body.String())
		}
	}

	// Extra PII fields must not persist as columns — path query must be stripped.
	var storedPath string
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT path, COUNT(*) FROM rum_samples WHERE path = $1 GROUP BY path`, marker,
	).Scan(&storedPath, &n); err != nil {
		t.Fatalf("stored path: %v", err)
	}
	if storedPath != marker {
		t.Fatalf("stored path %q want %q (query string leaked)", storedPath, marker)
	}
	if n != 4 {
		t.Fatalf("stored %d rows want 4", n)
	}

	// Old sample (25h) must not affect the 24h window.
	if _, err := pool.Exec(ctx, `
		INSERT INTO rum_samples (name, value_ms, rating, path, created_at)
		VALUES ('LCP', 99999, 'poor', $1, NOW() - INTERVAL '25 hours')`, marker); err != nil {
		t.Fatalf("insert old: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/rum", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET admin: got %d want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	var got struct {
		WindowHours int `json:"window_hours"`
		Metrics     []struct {
			Name    string  `json:"name"`
			P75     float64 `json:"p75"`
			Samples int64   `json:"samples"`
		} `json:"metrics"`
		Routes []struct {
			Name    string  `json:"name"`
			Path    string  `json:"path"`
			P75     float64 `json:"p75"`
			Samples int64   `json:"samples"`
		} `json:"routes"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode admin: %v", err)
	}
	if got.WindowHours != 24 {
		t.Fatalf("window_hours = %d want 24", got.WindowHours)
	}

	var lcp *struct {
		Name    string  `json:"name"`
		P75     float64 `json:"p75"`
		Samples int64   `json:"samples"`
	}
	for i := range got.Metrics {
		if got.Metrics[i].Name == "LCP" {
			lcp = &got.Metrics[i]
			break
		}
	}
	if lcp == nil {
		t.Fatal("admin metrics missing LCP")
	}
	// Other tests / leftover rows may add LCP samples; the route breakout is
	// isolated by path so assert p75 + count there, and that the name rollup
	// at least includes our 4 samples.
	if lcp.Samples < 4 {
		t.Fatalf("LCP samples = %d want >= 4", lcp.Samples)
	}

	var route *struct {
		Name    string  `json:"name"`
		Path    string  `json:"path"`
		P75     float64 `json:"p75"`
		Samples int64   `json:"samples"`
	}
	for i := range got.Routes {
		if got.Routes[i].Name == "LCP" && got.Routes[i].Path == marker {
			route = &got.Routes[i]
			break
		}
	}
	if route == nil {
		t.Fatalf("admin routes missing LCP path %q", marker)
	}
	if route.Samples != 4 {
		t.Fatalf("route samples = %d want 4 (old 25h row leaked into 24h window)", route.Samples)
	}
	if route.P75 != 325 {
		t.Fatalf("route p75 = %v want 325", route.P75)
	}
}
