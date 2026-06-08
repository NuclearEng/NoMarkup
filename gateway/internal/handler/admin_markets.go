package handler

// Admin market-rollout controls. Lets an admin launch (or pull back) a market at
// any granularity — a single city, a whole state, or a whole country — by
// flipping markets.is_active. This is the marketing-launch lever: the public
// catalog (GET /api/v1/markets) only surfaces active markets, so activating a
// city here makes it appear across the app within the catalog cache TTL.
//
// Routes (all under /api/v1/admin, RequireAdmin):
//   GET  /api/v1/admin/markets            — full catalog (active + inactive)
//   POST /api/v1/admin/markets/activate   — bulk set is_active by city/state/country

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// AdminMarketsHandler exposes admin market-rollout endpoints.
type AdminMarketsHandler struct {
	db *pgxpool.Pool
}

// NewAdminMarketsHandler returns an AdminMarketsHandler.
func NewAdminMarketsHandler(db *pgxpool.Pool) *AdminMarketsHandler {
	return &AdminMarketsHandler{db: db}
}

// List handles GET /api/v1/admin/markets — the FULL catalog (no active gate), so
// admins can see and launch not-yet-live markets. Reuses marketJSON (markets.go).
func (h *AdminMarketsHandler) List(w http.ResponseWriter, r *http.Request) {
	out := make([]marketJSON, 0, 512)
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"markets": out})
		return
	}

	rows, err := h.db.Query(r.Context(),
		`SELECT id, slug, name, region, region_code, country, is_active, lat, lng
		   FROM markets
		  ORDER BY (country <> 'US'), country, region NULLS LAST, name`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load markets")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var m marketJSON
		if err := rows.Scan(&m.ID, &m.Slug, &m.Name, &m.Region, &m.RegionCode,
			&m.Country, &m.IsActive, &m.Lat, &m.Lng); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read markets")
			return
		}
		out = append(out, m)
	}
	if rows.Err() != nil {
		writeError(w, http.StatusInternalServerError, "failed to read markets")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"markets": out})
}

type setMarketsActiveRequest struct {
	// Provide at least one selector. They are OR-combined: every market matching
	// any selector is updated. Empty request is rejected (no accidental mass flip).
	Slugs      []string `json:"slugs"`       // specific cities, e.g. ["seattle","spokane"]
	RegionCode *string  `json:"region_code"` // a US state, e.g. "WA" (launches the whole state)
	Country    *string  `json:"country"`     // "US" or "MX" (launches the whole country)
	Active     bool     `json:"active"`      // target state: true = launch, false = pull back
}

// SetActive handles POST /api/v1/admin/markets/activate.
func (h *AdminMarketsHandler) SetActive(w http.ResponseWriter, r *http.Request) {
	var body setMarketsActiveRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	// Build an OR of the provided selectors. Require at least one so a malformed
	// request can never flip the entire catalog by accident.
	ors := make([]string, 0, 3)
	args := make([]interface{}, 0, 4)
	args = append(args, body.Active) // $1 = target active state

	if len(body.Slugs) > 0 {
		args = append(args, body.Slugs)
		ors = append(ors, "slug = ANY($"+itoa(len(args))+")")
	}
	if body.RegionCode != nil && strings.TrimSpace(*body.RegionCode) != "" {
		args = append(args, strings.ToUpper(strings.TrimSpace(*body.RegionCode)))
		ors = append(ors, "(country = 'US' AND region_code = $"+itoa(len(args))+")")
	}
	if body.Country != nil {
		c := strings.ToUpper(strings.TrimSpace(*body.Country))
		if c == "US" || c == "MX" {
			args = append(args, c)
			ors = append(ors, "country = $"+itoa(len(args)))
		}
	}

	if len(ors) == 0 {
		writeError(w, http.StatusBadRequest, "provide at least one of slugs, region_code, or country")
		return
	}

	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	tag, err := h.db.Exec(r.Context(),
		`UPDATE markets SET is_active = $1, updated_at = now() WHERE (`+strings.Join(ors, " OR ")+`)`,
		args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update markets")
		return
	}

	adminID := ""
	if claims, ok := middleware.GetClaims(r.Context()); ok {
		adminID = claims.UserID
	}
	slog.Info("admin set markets active",
		"admin_id", adminID,
		"active", body.Active,
		"slugs", body.Slugs,
		"region_code", body.RegionCode,
		"country", body.Country,
		"updated", tag.RowsAffected(),
	)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"updated": tag.RowsAffected(),
		"active":  body.Active,
	})
}
