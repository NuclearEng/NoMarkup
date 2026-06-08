package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PricingHandler handles public Fair Price Index endpoints.
// Reads directly from the fair_price_index materialized view in PostgreSQL.
type PricingHandler struct {
	db *pgxpool.Pool
}

// NewPricingHandler creates a new PricingHandler.
// If db is nil (e.g. DATABASE_URL not set), endpoints return empty responses.
func NewPricingHandler(db *pgxpool.Pool) *PricingHandler {
	return &PricingHandler{db: db}
}

// pricingRow represents a single row from the fair_price_index materialized view.
type pricingRow struct {
	CategoryName   string    `json:"category_name"`
	CategorySlug   string    `json:"category_slug"`
	ZipCode        string    `json:"zip_code"`
	CompletedJobs  int64     `json:"completed_jobs"`
	AvgPriceCents  int64     `json:"avg_price_cents"`
	P25PriceCents  int64     `json:"p25_price_cents"`
	MedianCents    int64     `json:"median_price_cents"`
	P75PriceCents  int64     `json:"p75_price_cents"`
	MinPriceCents  int64     `json:"min_price_cents"`
	MaxPriceCents  int64     `json:"max_price_cents"`
	AvgSavingsCents *int64   `json:"avg_savings_cents"`
	RefreshedAt    time.Time `json:"refreshed_at"`
}

// GetPricingByCategory handles GET /api/v1/pricing/{category}.
// Returns aggregated pricing data for a service category, optionally filtered by ZIP code.
// Public endpoint — no authentication required.
func (h *PricingHandler) GetPricingByCategory(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"prices": []interface{}{}})
		return
	}

	categorySlug := chi.URLParam(r, "category")
	if categorySlug == "" {
		writeError(w, http.StatusBadRequest, "category is required")
		return
	}

	zipCode := r.URL.Query().Get("zip")

	var query string
	var args []interface{}

	if zipCode != "" {
		query = `SELECT category_name, category_slug, zip_code, completed_jobs,
		                avg_price_cents, p25_price_cents, median_price_cents, p75_price_cents,
		                min_price_cents, max_price_cents, avg_savings_cents, refreshed_at
		         FROM fair_price_index
		         WHERE category_slug = $1 AND zip_code = $2`
		args = []interface{}{categorySlug, zipCode}
	} else {
		query = `SELECT category_name, category_slug, zip_code, completed_jobs,
		                avg_price_cents, p25_price_cents, median_price_cents, p75_price_cents,
		                min_price_cents, max_price_cents, avg_savings_cents, refreshed_at
		         FROM fair_price_index
		         WHERE category_slug = $1
		         ORDER BY completed_jobs DESC
		         LIMIT 50`
		args = []interface{}{categorySlug}
	}

	rows, err := h.db.Query(r.Context(), query, args...)
	if err != nil {
		slog.Error("failed to query fair price index", "category", categorySlug, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get pricing data")
		return
	}
	defer rows.Close()

	var prices []pricingRow
	for rows.Next() {
		var p pricingRow
		if err := rows.Scan(
			&p.CategoryName, &p.CategorySlug, &p.ZipCode, &p.CompletedJobs,
			&p.AvgPriceCents, &p.P25PriceCents, &p.MedianCents, &p.P75PriceCents,
			&p.MinPriceCents, &p.MaxPriceCents, &p.AvgSavingsCents, &p.RefreshedAt,
		); err != nil {
			slog.Error("failed to scan pricing row", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read pricing data")
			return
		}
		prices = append(prices, p)
	}
	if err := rows.Err(); err != nil {
		slog.Error("error iterating pricing rows", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read pricing data")
		return
	}

	if prices == nil {
		prices = []pricingRow{}
	}

	// Cacheable at the CDN edge: public Fair Price Index data, no per-user content.
	writeCachedJSON(w, r, http.StatusOK, map[string]interface{}{"prices": prices}, 300, 3600)
}

// GetPricingOverview handles GET /api/v1/pricing.
// Returns a summary of pricing data across all categories.
// Public endpoint — no authentication required.
func (h *PricingHandler) GetPricingOverview(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"categories": []interface{}{}})
		return
	}

	rows, err := h.db.Query(r.Context(),
		`SELECT category_name, category_slug,
		        SUM(completed_jobs) AS total_jobs,
		        ROUND(AVG(median_price_cents)) AS avg_median_cents,
		        ROUND(AVG(avg_savings_cents) FILTER (WHERE avg_savings_cents IS NOT NULL)) AS avg_savings_cents
		 FROM fair_price_index
		 GROUP BY category_name, category_slug
		 ORDER BY total_jobs DESC`)
	if err != nil {
		slog.Error("failed to query pricing overview", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get pricing overview")
		return
	}
	defer rows.Close()

	type overviewRow struct {
		CategoryName    string `json:"category_name"`
		CategorySlug    string `json:"category_slug"`
		TotalJobs       int64  `json:"total_jobs"`
		AvgMedianCents  int64  `json:"avg_median_cents"`
		AvgSavingsCents *int64 `json:"avg_savings_cents"`
	}

	var categories []overviewRow
	for rows.Next() {
		var row overviewRow
		if err := rows.Scan(
			&row.CategoryName, &row.CategorySlug,
			&row.TotalJobs, &row.AvgMedianCents, &row.AvgSavingsCents,
		); err != nil {
			slog.Error("failed to scan pricing overview row", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to read pricing overview")
			return
		}
		categories = append(categories, row)
	}
	if err := rows.Err(); err != nil {
		slog.Error("error iterating pricing overview rows", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to read pricing overview")
		return
	}

	if categories == nil {
		categories = []overviewRow{}
	}

	// Cacheable at the CDN edge: public pricing overview, no per-user content.
	writeCachedJSON(w, r, http.StatusOK, map[string]interface{}{"categories": categories}, 300, 3600)
}
