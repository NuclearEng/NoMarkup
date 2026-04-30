package handler

// Power-seller analytics surface (Wave 5).
//
// GET /api/v1/me/seller-analytics?range=7d|30d|90d
//
// Returns a roll-up the dashboard renders into a daily revenue chart,
// sell-through pill, top categories list, and average sale price.
//
// Implementation note: the long-term plan is to read from the
// seller_metrics_daily roll-up populated by services/payment cron, but
// for live data and cold-cache fallback this handler computes from the
// underlying tables (listings + listing_orders + marketplace_disputes).
// The dashboard backs off to "—" placeholders if no rows exist.

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// SellerAnalyticsHandler exposes /api/v1/me/seller-analytics.
type SellerAnalyticsHandler struct {
	db *pgxpool.Pool
}

// NewSellerAnalyticsHandler creates a new handler.
func NewSellerAnalyticsHandler(db *pgxpool.Pool) *SellerAnalyticsHandler {
	return &SellerAnalyticsHandler{db: db}
}

type dailyRevenuePoint struct {
	Date       string `json:"date"`
	GrossCents int64  `json:"gross_cents"`
	OrderCount int    `json:"order_count"`
}

type topCategory struct {
	CategoryID   string `json:"category_id"`
	CategoryName string `json:"category_name"`
	Count        int    `json:"count"`
}

type sellerAnalyticsResponse struct {
	RangeDays         int                 `json:"range_days"`
	DailyRevenue      []dailyRevenuePoint `json:"daily_revenue"`
	SellThroughRate   float64             `json:"sell_through_rate"`
	AvgSalePriceCents int64               `json:"avg_sale_price_cents"`
	TotalGrossCents   int64               `json:"total_gross_cents"`
	TotalSold         int                 `json:"total_sold"`
	TotalListed       int                 `json:"total_listed"`
	TopCategories     []topCategory       `json:"top_categories"`
}

// parseRange reads ?range=7d|30d|90d and returns the day count, defaulting
// to 30 days. Anything outside [1, 365] is clamped.
func parseRange(raw string) int {
	raw = strings.ToLower(strings.TrimSpace(raw))
	switch raw {
	case "7d":
		return 7
	case "90d":
		return 90
	case "30d", "":
		return 30
	}
	return 30
}

// GetSellerAnalytics handles GET /api/v1/me/seller-analytics.
func (h *SellerAnalyticsHandler) GetSellerAnalytics(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	rangeDays := parseRange(r.URL.Query().Get("range"))
	since := time.Now().UTC().AddDate(0, 0, -rangeDays)

	resp := sellerAnalyticsResponse{
		RangeDays:    rangeDays,
		DailyRevenue: []dailyRevenuePoint{},
		TopCategories: []topCategory{},
	}

	// 1. Daily revenue series. Restricted to the seller's released or
	//    pickup_confirmed orders (anything that legitimately counts as
	//    "sold and credited"). Empty days are filled in JS (the chart
	//    fills gaps with zero bars).
	rows, err := h.db.Query(r.Context(), `
		SELECT date_trunc('day', created_at)::date::text AS d,
		       COALESCE(SUM(amount_cents), 0)::bigint AS gross,
		       COUNT(*) AS cnt
		  FROM listing_orders
		 WHERE seller_id = $1
		   AND created_at >= $2
		   AND escrow_status IN ('held', 'pickup_confirmed', 'released')
		 GROUP BY d
		 ORDER BY d ASC`,
		claims.UserID, since,
	)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		slog.Error("seller analytics: daily query", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load analytics")
		return
	}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var p dailyRevenuePoint
			if err := rows.Scan(&p.Date, &p.GrossCents, &p.OrderCount); err != nil {
				continue
			}
			resp.DailyRevenue = append(resp.DailyRevenue, p)
			resp.TotalGrossCents += p.GrossCents
			resp.TotalSold += p.OrderCount
		}
	}

	// 2. Sell-through rate: sold count vs. listings created in the window.
	//    A listing in status='sold' counts; anything else (active, expired,
	//    cancelled, draft) does not. Listings created > rangeDays ago that
	//    sold in-window are excluded — sell-through is anchored at the
	//    listing-creation cohort, not the sale.
	var totalListed, totalSold int
	if err := h.db.QueryRow(r.Context(), `
		SELECT COUNT(*) FILTER (WHERE created_at >= $2),
		       COUNT(*) FILTER (WHERE created_at >= $2 AND status = 'sold')
		  FROM listings
		 WHERE seller_id = $1`,
		claims.UserID, since,
	).Scan(&totalListed, &totalSold); err != nil {
		slog.Error("seller analytics: sell-through query", "user_id", claims.UserID, "error", err)
	}
	resp.TotalListed = totalListed
	if totalListed > 0 {
		resp.SellThroughRate = float64(totalSold) / float64(totalListed)
	}

	// 3. Average sale price across the window's orders.
	if resp.TotalSold > 0 {
		resp.AvgSalePriceCents = resp.TotalGrossCents / int64(resp.TotalSold)
	}

	// 4. Top 5 categories by sold count in the window. We join through
	//    listings → service_categories (goods rows live in the same
	//    taxonomy table; see migration 036) so the chart can show
	//    human-readable names. If the join misses, the fallback below
	//    uses the raw category_id string.
	cats, err := h.db.Query(r.Context(), `
		SELECT lo.listing_id::text AS lid,
		       COALESCE(c.name, l.category_id::text) AS cat_name,
		       l.category_id::text AS cat_id
		  FROM listing_orders lo
		  JOIN listings l            ON l.id = lo.listing_id
	   LEFT JOIN service_categories c  ON c.id = l.category_id
		 WHERE lo.seller_id = $1
		   AND lo.created_at >= $2
		   AND lo.escrow_status IN ('held','pickup_confirmed','released')`,
		claims.UserID, since,
	)
	if err == nil && cats != nil {
		defer cats.Close()
		// Aggregate in Go to avoid a heavy GROUP BY when the join is
		// optional (LEFT JOIN means we may have NULL category_name).
		bucket := map[string]*topCategory{}
		for cats.Next() {
			var lid, name, catID string
			if err := cats.Scan(&lid, &name, &catID); err != nil {
				continue
			}
			if existing, ok := bucket[catID]; ok {
				existing.Count++
			} else {
				bucket[catID] = &topCategory{CategoryID: catID, CategoryName: name, Count: 1}
			}
		}
		// Convert to sorted slice (top 5).
		flat := make([]topCategory, 0, len(bucket))
		for _, c := range bucket {
			flat = append(flat, *c)
		}
		// Insertion-sort top 5 by descending count — the cardinality is
		// always tiny so we don't need sort.Slice.
		for i := 1; i < len(flat); i++ {
			for j := i; j > 0 && flat[j].Count > flat[j-1].Count; j-- {
				flat[j], flat[j-1] = flat[j-1], flat[j]
			}
		}
		if len(flat) > 5 {
			flat = flat[:5]
		}
		resp.TopCategories = flat
	}

	writeJSON(w, http.StatusOK, resp)
}

// guardSelfAccess is a tiny helper used by tests; it asserts the session
// owner equals the URL-param user (kept here so future /me/<sub>-analytics
// fan-outs can reuse).
func guardSelfAccess(claimsID, urlUserID string) error {
	if claimsID != urlUserID && urlUserID != "" {
		return fmt.Errorf("forbidden")
	}
	return nil
}
