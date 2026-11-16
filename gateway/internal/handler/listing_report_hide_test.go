package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestResolveReport_ActionedHidesFromCatalog proves an actioned listing report
// drops the row from the public catalog (status = active AND is_hidden = false).
// Dismiss and review do not.
func TestResolveReport_ActionedHidesFromCatalog(t *testing.T) {
	pool := liveTestPool(t)
	ctx := context.Background()
	suffix := uuid.NewString()[:8]
	seller := seedTestUser(t, pool, "lr-seller-"+suffix+"@test.invalid")
	reporter := seedTestUser(t, pool, "lr-reporter-"+suffix+"@test.invalid")
	admin := seedTestUser(t, pool, "lr-admin-"+suffix+"@test.invalid")

	var categoryID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM service_categories LIMIT 1`).Scan(&categoryID); err != nil {
		t.Skipf("no service_categories: %v", err)
	}

	needle := "HIDEREPORT-" + suffix
	listingID := uuid.NewString()
	ends := time.Now().Add(24 * time.Hour)
	if _, err := pool.Exec(ctx, `
		INSERT INTO listings (
			id, seller_id, title, category_id, location, pickup_zip_code,
			starting_price_cents, auction_duration_hours,
			auction_ends_at, original_auction_ends_at, status, is_hidden
		) VALUES (
			$1, $2, $3, $4,
			ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326), '78701',
			1000, 24, $5, $5, 'active', false
		)`, listingID, seller, needle+" oak table", categoryID, ends); err != nil {
		t.Fatalf("seed listing: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM listing_reports WHERE listing_id = $1`, listingID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM listings WHERE id = $1`, listingID)
	})

	h := NewAdminMarketplaceHandler(pool)
	listings := NewListingsHandler(pool, nil)

	if !listingOnPublicCatalog(t, pool, listings, listingID, needle) {
		t.Fatal("seeded listing missing from public catalog")
	}

	first := createListingReport(t, h, listingID, reporter, `{"reason":"spam","description":"noise"}`)
	dismiss := resolveListingReport(t, h, first, admin, `{"action":"dismiss","notes":"not a violation"}`)
	if dismiss.Code != http.StatusOK {
		t.Fatalf("dismiss: got %d want 200 (body=%s)", dismiss.Code, dismiss.Body.String())
	}
	if !listingOnPublicCatalog(t, pool, listings, listingID, needle) {
		t.Fatal("dismiss hid the listing from the public catalog")
	}

	second := createListingReport(t, h, listingID, reporter, `{"reason":"prohibited","description":"`+prohibitedUGCFixture+`"}`)
	review := resolveListingReport(t, h, second, admin, `{"action":"review","notes":"looking"}`)
	if review.Code != http.StatusOK {
		t.Fatalf("review: got %d want 200 (body=%s)", review.Code, review.Body.String())
	}
	if !listingOnPublicCatalog(t, pool, listings, listingID, needle) {
		t.Fatal("review hid the listing from the public catalog")
	}

	action := resolveListingReport(t, h, second, admin, `{"action":"actioned","notes":"removed"}`)
	if action.Code != http.StatusOK {
		t.Fatalf("actioned: got %d want 200 (body=%s)", action.Code, action.Body.String())
	}
	if listingOnPublicCatalog(t, pool, listings, listingID, needle) {
		t.Fatal("actioned report left the listing on the public catalog")
	}

	var hidden bool
	var reason string
	if err := pool.QueryRow(ctx, `
		SELECT is_hidden, COALESCE(hidden_reason, '')
		  FROM listings WHERE id = $1`, listingID).Scan(&hidden, &reason); err != nil {
		t.Fatalf("read hide flag: %v", err)
	}
	if !hidden {
		t.Fatal("actioned report did not set listings.is_hidden")
	}
	if reason == "" {
		t.Fatal("actioned report cleared hidden_reason")
	}
}

func createListingReport(t *testing.T, h *AdminMarketplaceHandler, listingID, userID, body string) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/listings/"+listingID+"/report", strings.NewReader(body))
	req = withChiURLParam(req, "id", listingID)
	req = authReq(req, userID)
	rec := httptest.NewRecorder()
	h.CreateReport(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create report: got %d want 201 (body=%s)", rec.Code, rec.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil || created.ID == "" {
		t.Fatalf("create report payload: %v body=%s", err, rec.Body.String())
	}
	return created.ID
}

func resolveListingReport(t *testing.T, h *AdminMarketplaceHandler, reportID, userID, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/goods-reports/"+reportID+"/resolve", strings.NewReader(body))
	req = withChiURLParam(req, "id", reportID)
	req = authReq(req, userID)
	rec := httptest.NewRecorder()
	h.ResolveReport(rec, req)
	return rec
}

// listingOnPublicCatalog is true when both the public SQL predicate and
// ListListings return the row.
func listingOnPublicCatalog(t *testing.T, pool *pgxpool.Pool, h *ListingsHandler, listingID, needle string) bool {
	t.Helper()
	var n int
	err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM listings l
		 WHERE l.id = $1
		   AND l.status = 'active'
		   AND l.is_hidden = false
		   AND (l.auction_ends_at IS NULL OR l.auction_ends_at > now())`, listingID).Scan(&n)
	if err != nil {
		t.Fatalf("public predicate: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/listings?q="+needle, nil)
	rec := httptest.NewRecorder()
	h.ListListings(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("ListListings: got %d (body=%s)", rec.Code, rec.Body.String())
	}
	inJSON := strings.Contains(rec.Body.String(), listingID)
	if (n == 1) != inJSON {
		t.Fatalf("SQL count=%d list contains id=%v", n, inJSON)
	}
	return n == 1 && inJSON
}

// TestEvictHiddenListing_NilMeiliNoop is the hide path with search
// unconfigured. A nil client must not call Meilisearch (a nil ServiceManager
// method panics) and must not fail. The SQL hide itself is
// TestResolveReport_ActionedHidesFromCatalog, which needs Postgres.
func TestEvictHiddenListing_NilMeiliNoop(t *testing.T) {
	t.Parallel()
	h := NewAdminMarketplaceHandler(nil)
	if h.meili != nil {
		t.Fatal("meili must default to nil")
	}
	id := "11111111-1111-1111-1111-111111111111"
	h.evictHiddenListing(context.Background(), id)
	h.SetMeili(nil)
	h.evictHiddenListing(context.Background(), id)
	deleteListingSearchDocument(context.Background(), nil, id)
	deleteListingSearchDocument(context.Background(), nil, "")
	(*ListingsHandler)(nil).deleteListingDocument(context.Background(), id)
	(&ListingsHandler{}).deleteListingDocument(context.Background(), id)
}
