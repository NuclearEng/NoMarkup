package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

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

func TestActivityNilDBDoesNotFailRequest(t *testing.T) {
	t.Parallel()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("ok"))
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs?token=secret", nil)
	rec := httptest.NewRecorder()
	Activity(nil)(inner).ServeHTTP(rec, req)

	if rec.Code != http.StatusTeapot {
		t.Fatalf("got %d want 418 — nil db must not fail the request", rec.Code)
	}
	if rec.Body.String() != "ok" {
		t.Fatalf("body = %q want ok", rec.Body.String())
	}
}

type fakeActivityDB struct {
	sql  string
	args []any
	err  error
}

func (f *fakeActivityDB) Exec(_ context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	f.sql = sql
	f.args = arguments
	if f.err != nil {
		return pgconn.CommandTag{}, f.err
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func TestActivityAuthenticatedInsertIncludesUserID(t *testing.T) {
	t.Parallel()

	const userID = "11111111-1111-1111-1111-111111111111"
	fake := &fakeActivityDB{}
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/jobs?token=should-strip", nil)
	req.Header.Set("X-Request-ID", "req-activity-1")
	req = req.WithContext(context.WithValue(req.Context(), ClaimsContextKey, &Claims{
		UserID: userID,
		Email:  "a@example.com",
		Roles:  []string{"customer"},
	}))
	rec := httptest.NewRecorder()
	activity(fake, nil)(inner).ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("got %d want 201", rec.Code)
	}
	if fake.sql == "" {
		t.Fatal("expected INSERT, got none")
	}
	if len(fake.args) < 6 {
		t.Fatalf("args = %#v want 6", fake.args)
	}
	if fake.args[0] != userID {
		t.Fatalf("user_id = %v want %s", fake.args[0], userID)
	}
	if fake.args[1] != "req-activity-1" {
		t.Fatalf("request_id = %v want req-activity-1", fake.args[1])
	}
	if fake.args[2] != http.MethodPost {
		t.Fatalf("method = %v want POST", fake.args[2])
	}
	if fake.args[3] != "/api/v1/jobs" {
		t.Fatalf("path = %v want /api/v1/jobs (query leaked)", fake.args[3])
	}
	if fake.args[4] != http.StatusCreated {
		t.Fatalf("status = %v want 201", fake.args[4])
	}
}

func TestActivityInsertErrorDoesNotFailRequest(t *testing.T) {
	t.Parallel()

	fake := &fakeActivityDB{err: context.DeadlineExceeded}
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs", nil)
	rec := httptest.NewRecorder()
	activity(fake, nil)(inner).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d want 200 — insert error must be fail-soft", rec.Code)
	}
}

func TestActivitySkipsHealthAndMetrics(t *testing.T) {
	t.Parallel()

	fake := &fakeActivityDB{}
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := activity(fake, nil)(inner)

	for _, path := range []string{"/healthz", "/health", "/readyz", "/metrics", "/static/app.js"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: got %d want 200", path, rec.Code)
		}
	}
	if fake.sql != "" {
		t.Fatalf("health/metrics/static must not INSERT, got %q", fake.sql)
	}
}

func TestActivityUnauthenticatedInsertsNullUserID(t *testing.T) {
	t.Parallel()

	fake := &fakeActivityDB{}
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/listings", nil)
	rec := httptest.NewRecorder()
	activity(fake, nil)(inner).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d want 200", rec.Code)
	}
	if len(fake.args) < 1 {
		t.Fatal("expected INSERT args")
	}
	if fake.args[0] != nil {
		t.Fatalf("user_id = %v want nil for unauthenticated", fake.args[0])
	}
}

func TestActivityUserIDFromBearer(t *testing.T) {
	t.Parallel()

	key := generateTestKeyPair(t)
	auth := NewAuthMiddleware(&key.PublicKey, nil)
	userID := "22222222-2222-2222-2222-222222222222"
	token := signTestJWT(t, key, userID, "b@example.com", []string{"customer"}, time.Now().Add(15*time.Minute))

	fake := &fakeActivityDB{}
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	activity(fake, auth)(inner).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d want 200", rec.Code)
	}
	if len(fake.args) < 1 {
		t.Fatal("expected INSERT args")
	}
	if fake.args[0] != userID {
		t.Fatalf("user_id = %v want %s (Bearer fallback)", fake.args[0], userID)
	}
}
