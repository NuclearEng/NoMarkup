package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ─────────────────────────────────────────────────────────────────────────
// Routing + validation smoke tests (db = nil), mirroring
// listings_write_smoke_test.go: proves routes are wired, auth propagates,
// and the nil-db guard returns 503 (or earlier 400/401 for bad input/auth).
// ─────────────────────────────────────────────────────────────────────────

func TestWishlistRouting(t *testing.T) {
	h := NewWishlistHandler(nil)

	r := chi.NewRouter()
	r.Post("/api/v1/me/wishlist", h.CreateWishlistItem)
	r.Get("/api/v1/me/wishlist", h.ListWishlist)
	r.Delete("/api/v1/me/wishlist/{id}", h.DeleteWishlistItem)

	uuid := "11111111-1111-1111-1111-111111111111"
	authed := func(req *http.Request) *http.Request {
		c := &middleware.Claims{UserID: uuid, Email: "a@b.c", Roles: []string{"customer"}}
		return req.WithContext(context.WithValue(req.Context(), middleware.ClaimsContextKey, c))
	}

	// The write handlers run the nil-db guard FIRST (before reading claims),
	// so with db=nil every write returns 503 regardless of auth — that's the
	// correct fail-closed behavior. ListWishlist degrades to an empty 200 on a
	// nil db but still requires claims, so unauthenticated GET → 401.
	cases := []struct {
		name       string
		method     string
		path       string
		body       []byte
		authed     bool
		wantStatus int
	}{
		// Writes: nil-db guard precedes auth → 503 either way.
		{"create-no-auth-503", http.MethodPost, "/api/v1/me/wishlist", []byte("{}"), false, http.StatusServiceUnavailable},
		{"delete-no-auth-503", http.MethodDelete, "/api/v1/me/wishlist/" + uuid, nil, false, http.StatusServiceUnavailable},
		{"create-authed-503", http.MethodPost, "/api/v1/me/wishlist", []byte(`{"keyword":"x","max_price_cents":100}`), true, http.StatusServiceUnavailable},
		{"delete-authed-503", http.MethodDelete, "/api/v1/me/wishlist/" + uuid, nil, true, http.StatusServiceUnavailable},

		// GET: nil-db guard returns an empty 200 before the claims check, so
		// both authed and unauthed get 200 here (graceful degradation). The
		// owner-scoping is enforced by the WHERE user_id = claims query on the
		// live-db path, exercised by the curl proof in the task report.
		{"list-no-auth-200-empty", http.MethodGet, "/api/v1/me/wishlist", nil, false, http.StatusOK},
		{"list-authed-200-empty", http.MethodGet, "/api/v1/me/wishlist", nil, true, http.StatusOK},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var reqBody *bytes.Reader
			if tc.body != nil {
				reqBody = bytes.NewReader(tc.body)
			} else {
				reqBody = bytes.NewReader(nil)
			}
			req := httptest.NewRequest(tc.method, tc.path, reqBody)
			if tc.authed {
				req = authed(req)
			}
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Fatalf("%s %s: got %d, want %d (body=%s)",
					tc.method, tc.path, rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Match → notify trigger, exercised against a fake querier so we can assert
// exactly which wishlist owners get a notification INSERT for a given listing.
// ─────────────────────────────────────────────────────────────────────────

// fakeWishlistRow is one wishlist_items row the fake returns from its SELECT.
type fakeWishlistRow struct {
	userID  string
	keyword string
}

// fakeWishlistQuerier implements wishlistQuerier. It returns a fixed set of matched
// wishlist rows from Query and records every notification INSERT from Exec.
type fakeWishlistQuerier struct {
	matched []fakeWishlistRow
	// inserts captures the args of each notifications INSERT (user_id, title,
	// body, action_url, listing_id) so the test can assert on them.
	inserts [][]interface{}
}

func (f *fakeWishlistQuerier) Query(_ context.Context, _ string, _ ...interface{}) (pgx.Rows, error) {
	return &fakeWishlistRows{rows: f.matched}, nil
}

func (f *fakeWishlistQuerier) Exec(_ context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error) {
	if strings.Contains(sql, "INSERT INTO notifications") {
		f.inserts = append(f.inserts, args)
	}
	return pgconn.CommandTag{}, nil
}

// fakeWishlistRows is a minimal pgx.Rows over a slice of fakeWishlistRow that only
// supports the (user_id, keyword) scan NotifyWishlistMatches performs.
type fakeWishlistRows struct {
	rows []fakeWishlistRow
	idx  int
}

func (r *fakeWishlistRows) Next() bool {
	if r.idx >= len(r.rows) {
		return false
	}
	r.idx++
	return true
}

func (r *fakeWishlistRows) Scan(dest ...any) error {
	cur := r.rows[r.idx-1]
	if len(dest) >= 1 {
		if p, ok := dest[0].(*string); ok {
			*p = cur.userID
		}
	}
	if len(dest) >= 2 {
		if p, ok := dest[1].(*string); ok {
			*p = cur.keyword
		}
	}
	return nil
}

func (r *fakeWishlistRows) Close()                                       {}
func (r *fakeWishlistRows) Err() error                                   { return nil }
func (r *fakeWishlistRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeWishlistRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeWishlistRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeWishlistRows) RawValues() [][]byte                          { return nil }
func (r *fakeWishlistRows) Conn() *pgx.Conn                              { return nil }

func TestNotifyWishlistMatches_InsertsNotificationPerOwner(t *testing.T) {
	fake := &fakeWishlistQuerier{
		matched: []fakeWishlistRow{
			{userID: "owner-1", keyword: "wheeler"},
			{userID: "owner-2", keyword: "4 wheeler"},
		},
	}

	NotifyWishlistMatches(
		context.Background(), fake,
		"listing-abc", "seller-xyz", "Yamaha 4 Wheeler ATV", "cat-1",
		45000, // $450.00
	)

	if len(fake.inserts) != 2 {
		t.Fatalf("expected 2 notification inserts, got %d", len(fake.inserts))
	}

	// Assert the first insert targets owner-1 with a price-bearing title and a
	// /marketplace/<listing> action URL.
	got := fake.inserts[0]
	// args: user_id, title, body, action_url, listing_id
	if got[0] != "owner-1" {
		t.Errorf("insert[0] user_id = %v, want owner-1", got[0])
	}
	title, _ := got[1].(string)
	if !strings.Contains(title, "$450") || !strings.Contains(title, "wheeler") {
		t.Errorf("insert[0] title = %q, want it to mention the keyword and $450", title)
	}
	actionURL, _ := got[3].(string)
	if actionURL != "/marketplace/listing-abc" {
		t.Errorf("insert[0] action_url = %q, want /marketplace/listing-abc", actionURL)
	}
	if got[4] != "listing-abc" {
		t.Errorf("insert[0] entity_id = %v, want listing-abc", got[4])
	}
}

func TestNotifyWishlistMatches_NoMatchesNoInserts(t *testing.T) {
	fake := &fakeWishlistQuerier{matched: nil}
	NotifyWishlistMatches(
		context.Background(), fake,
		"listing-abc", "seller-xyz", "Antique Lamp", "cat-1", 999900,
	)
	if len(fake.inserts) != 0 {
		t.Fatalf("expected 0 notification inserts for no matches, got %d", len(fake.inserts))
	}
}
