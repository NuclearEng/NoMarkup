package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestListListings_omitsPastDeadlineActiveRows pins the public catalog
// live-floor: an 'active' row whose auction_ends_at is in the past must not
// appear on GET /listings (SQL predicate + post-scan skip). Mirrors
// TestJobHandler_Search_openOmitsPastDeadlineActiveRows.
func TestListListings_omitsPastDeadlineActiveRows(t *testing.T) {
	t.Parallel()

	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)

	if includeInPublicListingCatalog("active", &past) {
		t.Fatal("active past deadline must be omitted from public catalog")
	}
	if !includeInPublicListingCatalog("active", &future) {
		t.Fatal("active before deadline must stay on public catalog")
	}
	if !includeInPublicListingCatalog("active", nil) {
		t.Fatal("active nil deadline must stay on public catalog")
	}
	if includeInPublicListingCatalog("sold", &future) {
		t.Fatal("sold must never appear on public catalog")
	}
	if includeInPublicListingCatalog("expired", &future) {
		t.Fatal("expired must never appear on public catalog")
	}

	if publicListingLiveWindowSQL != "(l.auction_ends_at IS NULL OR l.auction_ends_at > now())" {
		t.Fatalf("live-window SQL drifted: %q", publicListingLiveWindowSQL)
	}

	t.Run("handler live db", func(t *testing.T) {
		pool := liveTestPool(t)
		liveID, staleID, needle := seedLiveWindowListings(t, pool)

		h := NewListingsHandler(pool, nil)
		req := httptest.NewRequest(http.MethodGet, "/api/v1/listings?page=1&page_size=60&q="+needle, nil)
		rec := httptest.NewRecorder()
		h.ListListings(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("ListListings: got %d want 200 (body=%s)", rec.Code, rec.Body.String())
		}

		var body struct {
			Listings []struct {
				ID     string `json:"id"`
				Status string `json:"status"`
				Title  string `json:"title"`
			} `json:"listings"`
			Pagination struct {
				Total int `json:"total"`
			} `json:"pagination"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v body=%s", err, rec.Body.String())
		}

		gotIDs := make(map[string]string, len(body.Listings))
		for _, l := range body.Listings {
			gotIDs[l.ID] = l.Status
			if l.Status != "active" {
				t.Errorf("listing %s status=%q want active", l.ID, l.Status)
			}
		}
		if _, ok := gotIDs[liveID]; !ok {
			t.Errorf("live listing %s missing from catalog (got %v)", liveID, gotIDs)
		}
		if _, ok := gotIDs[staleID]; ok {
			t.Errorf("past-deadline listing %s leaked into catalog", staleID)
		}
		if body.Pagination.Total != 1 {
			t.Errorf("pagination.total=%d want 1 (SQL live-window should exclude the stale row from COUNT)", body.Pagination.Total)
		}
		if len(body.Listings) != 1 {
			t.Errorf("len(listings)=%d want 1", len(body.Listings))
		}
	})
}

func seedLiveWindowListings(t *testing.T, pool *pgxpool.Pool) (liveID, staleID, needle string) {
	t.Helper()
	ctx := context.Background()
	suffix := uuid.NewString()[:8]
	needle = "LIVEWINDOW-" + suffix

	var sellerID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, roles, status)
		VALUES ($1, 'x', 'live-window-test', ARRAY['customer'], 'active')
		RETURNING id::text`,
		"live-window-"+suffix+"@test.invalid",
	).Scan(&sellerID); err != nil {
		t.Fatalf("seed seller: %v", err)
	}

	var categoryID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM service_categories WHERE COALESCE(is_goods, false) = true ORDER BY slug LIMIT 1`,
	).Scan(&categoryID); err != nil {
		if err := pool.QueryRow(ctx,
			`SELECT id::text FROM service_categories ORDER BY created_at LIMIT 1`,
		).Scan(&categoryID); err != nil {
			t.Fatalf("pick category: %v", err)
		}
	}

	liveID = uuid.NewString()
	staleID = uuid.NewString()
	insert := func(id, title string, endsAt time.Time) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO listings (
				id, seller_id, title, category_id, location, pickup_zip_code,
				starting_price_cents, auction_duration_hours,
				auction_ends_at, original_auction_ends_at, status, is_hidden
			) VALUES (
				$1, $2, $3, $4,
				ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326), '78701',
				1000, 24, $5, $5, 'active', false
			)`, id, sellerID, title, categoryID, endsAt); err != nil {
			t.Fatalf("insert listing %s: %v", title, err)
		}
	}
	insert(liveID, needle+" live", time.Now().Add(24*time.Hour))
	insert(staleID, needle+" stale", time.Now().Add(-time.Hour))

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM listings WHERE id IN ($1, $2)`, liveID, staleID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id = $1`, sellerID)
	})
	return liveID, staleID, needle
}
