package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// TestListWishlist_ResponseShape pins the response contract after pagination
// was added. GET /api/v1/me/wishlist used to SELECT every row for a user with
// no LIMIT, so an account with 100K items produced a 100K-row response.
//
// "wishlist_items" MUST keep its exact shape — the web client reads
// `data?.wishlist_items ?? []` (web/src/hooks/useWishlist.ts) and would break
// if the array moved or was renamed. "pagination" is purely additive.
func TestListWishlist_ResponseShape(t *testing.T) {
	t.Parallel()

	// nil db exercises the graceful-degradation path, which must emit the same
	// keys as the live path so clients can rely on them unconditionally.
	h := NewWishlistHandler(nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me/wishlist", nil)
	claims := &middleware.Claims{
		UserID: "11111111-1111-1111-1111-111111111111",
		Email:  "a@b.c",
		Roles:  []string{"customer"},
	}
	req = req.WithContext(context.WithValue(req.Context(), middleware.ClaimsContextKey, claims))

	rec := httptest.NewRecorder()
	h.ListWishlist(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
	}

	items, ok := body["wishlist_items"]
	if !ok {
		t.Fatal(`response must keep the "wishlist_items" key`)
	}
	var arr []json.RawMessage
	if err := json.Unmarshal(items, &arr); err != nil {
		t.Fatalf(`"wishlist_items" must be an array: %v`, err)
	}
	if len(arr) != 0 {
		t.Errorf("want empty array on the nil-db path, got %d items", len(arr))
	}

	pg, ok := body["pagination"]
	if !ok {
		t.Fatal(`response must include the additive "pagination" key`)
	}
	var meta map[string]any
	if err := json.Unmarshal(pg, &meta); err != nil {
		t.Fatalf(`"pagination" must be an object: %v`, err)
	}
	for _, key := range []string{"page", "page_size", "total", "total_pages", "has_next", "has_prev"} {
		if _, ok := meta[key]; !ok {
			t.Errorf("pagination is missing %q", key)
		}
	}
}

// TestWishlistPageBounds pins the wishlist's page-size policy: large enough
// that no realistic account is silently truncated (the current web client has
// no pager), small enough that the unbounded tail is gone.
func TestWishlistPageBounds(t *testing.T) {
	t.Parallel()

	if wishlistPageDefault <= 0 || wishlistPageDefault > wishlistPageMax {
		t.Errorf("wishlistPageDefault=%d must be in (0, wishlistPageMax=%d]",
			wishlistPageDefault, wishlistPageMax)
	}

	tests := []struct {
		name     string
		query    map[string][]string
		wantPage int
		wantSize int
	}{
		{name: "no params", query: map[string][]string{}, wantPage: 1, wantSize: wishlistPageDefault},
		{name: "explicit small page", query: map[string][]string{"page_size": {"5"}}, wantPage: 1, wantSize: 5},
		{name: "oversized page_size clamps", query: map[string][]string{"page_size": {"1000000"}}, wantPage: 1, wantSize: wishlistPageMax},
		{name: "deep page clamps", query: map[string][]string{"page": {"5000000"}}, wantPage: maxPageNumber, wantSize: wishlistPageDefault},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			page, size := parseDirectPagination(tt.query, 1, wishlistPageDefault, wishlistPageMax)
			if page != tt.wantPage {
				t.Errorf("page = %d, want %d", page, tt.wantPage)
			}
			if size != tt.wantSize {
				t.Errorf("page_size = %d, want %d", size, tt.wantSize)
			}
		})
	}
}

// TestKeepLiveListings_FailsClosed covers the autocomplete phantom guard's
// degradation policy. With no DB handle the hits cannot be verified against
// Postgres, and unverified listing suggestions must be DROPPED rather than
// served — the endpoint is CDN-cached, so a phantom stays clickable for the
// whole TTL.
func TestKeepLiveListings_FailsClosed(t *testing.T) {
	t.Parallel()

	h := NewListingsSearchHandler(nil, nil, nil)

	got := h.keepLiveListings(context.Background(), []autocompleteSuggestionJSON{
		{Type: "listing", ID: "11111111-1111-1111-1111-111111111111", Title: "phantom"},
	})
	if len(got) != 0 {
		t.Errorf("unverified suggestions must be dropped, got %d", len(got))
	}

	// An empty input is passed through untouched (no pointless DB round trip).
	if got := h.keepLiveListings(context.Background(), nil); len(got) != 0 {
		t.Errorf("empty input must stay empty, got %d", len(got))
	}
}
