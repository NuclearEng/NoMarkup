package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
)

// TestMyListings_setsPrivateNoStore pins C6: MyListings is reachable from the
// public GET /listings/{id} path when id=="mine", outside the PrivateNoStore
// authenticated subtree. Without an explicit header a future optionalAuth
// mount would emit a per-seller body with no cache directive.
func TestMyListings_setsPrivateNoStore(t *testing.T) {
	t.Parallel()
	h := NewListingsHandler(nil, nil) // nil DB takes the empty early return

	r := chi.NewRouter()
	r.Get("/api/v1/listings/mine", h.MyListings)
	// Also the collision path GetListing uses.
	r.Get("/api/v1/listings/{id}", h.GetListing)

	t.Run("direct mine route", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/listings/mine", nil)
		req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "s@example.com", []string{"customer"})
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, privateCachePolicy, rec.Header().Get("Cache-Control"),
			"MyListings must set private, no-store even on the happy path")
	})

	t.Run("collision via GetListing id=mine", func(t *testing.T) {
		t.Parallel()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/listings/mine", nil)
		// Hit the {id} route explicitly by constructing a request that chi
		// routes to GetListing — same path string, separate registration above
		// would race; use a dedicated router with only the wildcard.
		r2 := chi.NewRouter()
		r2.Get("/api/v1/listings/{id}", h.GetListing)
		req = addClaimsToRequest(req, "33333333-3333-3333-3333-333333333333", "s@example.com", []string{"customer"})
		rec := httptest.NewRecorder()
		r2.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, privateCachePolicy, rec.Header().Get("Cache-Control"),
			"GetListing→MyListings must still set private, no-store")
	})

	t.Run("unauthenticated still stamps the header before 401", func(t *testing.T) {
		t.Parallel()
		// With a non-nil DB we'd 401; with nil DB we 200 empty. Either way the
		// header must be set first. Use a handler with a non-nil claims check
		// path by simulating missing claims on the nil-db short path — header
		// is set before the nil check... actually nil check is after the header
		// set, so 200 empty still proves the stamp. Force no claims:
		req := httptest.NewRequest(http.MethodGet, "/api/v1/listings/mine", nil)
		rec := httptest.NewRecorder()
		// Non-nil DB would 401 without claims — we only have nil. Stamp is
		// still visible on the empty response.
		r.ServeHTTP(rec, req)
		assert.Equal(t, privateCachePolicy, rec.Header().Get("Cache-Control"))
	})
}

// TestStaleIfErrorBounds pins C5: SIE is a function of s-maxage/swr, never a
// flat day that would keep a disabled financial feature flag hot for 24h.
func TestStaleIfErrorBounds(t *testing.T) {
	t.Parallel()
	cases := []struct {
		sMaxAge, swr, want int
	}{
		{60, 300, 600},   // feature flags: 10× s-maxage
		{15, 60, 150},    // listing detail
		{300, 3600, 3600}, // catalog: 2×swr=7200 hard-capped at 1h
		{0, 0, 0},
	}
	for _, tc := range cases {
		got := staleIfErrorSeconds(tc.sMaxAge, tc.swr)
		assert.Equal(t, tc.want, got, "sMaxAge=%d swr=%d", tc.sMaxAge, tc.swr)
		assert.LessOrEqual(t, got, 3600, "SIE must never exceed 1h hard cap")
		if tc.sMaxAge > 0 {
			assert.NotEqual(t, 86400, got, "flat day-long SIE is the bug this pins")
		}
	}
}
