package handler

// Public-facing handler for the market catalog (the cities/regions NoMarkup
// can operate in, modeled on craigslist's one-site-per-metro coverage). Backed
// by the `markets` table seeded in migration 051. Mirrors the pgxpool-direct
// pattern used by listings.go — the market catalog is admin/ops-managed and has
// no gRPC surface, so a direct read is the simplest correct path.
//
// Routes:
//   GET /api/v1/markets        — list catalog markets (city selector source)
//
// Query params (all optional):
//   ?country=US|MX             — restrict to one country
//   ?active=true               — only launched markets (is_active=true)
//   ?q=<text>                  — case-insensitive prefix/substring on name or region
//
// The catalog is near-static and public, so responses are edge-cached
// (writeCachedJSON, 5m s-maxage + 1h stale-while-revalidate), same posture as
// the categories endpoint.

import (
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// MarketsHandler exposes the public market-catalog endpoint.
type MarketsHandler struct {
	db *pgxpool.Pool
}

// NewMarketsHandler returns a MarketsHandler. A nil DB returns an empty
// catalog (degrades gracefully in dev/sandbox without a database).
func NewMarketsHandler(db *pgxpool.Pool) *MarketsHandler {
	return &MarketsHandler{db: db}
}

// marketJSON must match web/src/types/index.ts {Market}.
type marketJSON struct {
	ID         string   `json:"id"`
	Slug       string   `json:"slug"`
	Name       string   `json:"name"`
	Region     *string  `json:"region"`
	RegionCode *string  `json:"region_code"`
	Country    string   `json:"country"`
	IsActive   bool     `json:"is_active"`
	Lat        *float64 `json:"lat"`
	Lng        *float64 `json:"lng"`
}

// List handles GET /api/v1/markets — the PUBLIC catalog.
//
// Public reads are gated to launched markets only (is_active = true). Rollout is
// controlled by admins flipping is_active (migration 055 launched Washington;
// further launches via the admin Markets tool). Gating here, server-side, is
// defense-in-depth: even a client that forgets to filter can never surface a
// city we haven't launched. Admins see the full catalog via the separate
// /api/v1/admin/markets endpoint.
func (h *MarketsHandler) List(w http.ResponseWriter, r *http.Request) {
	out := make([]marketJSON, 0, 64)

	if h.db == nil {
		writeCachedJSON(w, r, http.StatusOK, map[string]interface{}{"markets": out}, 30, 300)
		return
	}

	// Always active-only. Optional country/q filters layer on top. Parameterized.
	conds := []string{"is_active = true"}
	args := make([]interface{}, 0, 2)

	if c := strings.ToUpper(r.URL.Query().Get("country")); c == "US" || c == "MX" {
		args = append(args, c)
		conds = append(conds, "country = $"+itoa(len(args)))
	}
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		args = append(args, "%"+q+"%")
		n := itoa(len(args))
		conds = append(conds, "(name ILIKE $"+n+" OR region ILIKE $"+n+")")
	}

	query := `SELECT id, slug, name, region, region_code, country, is_active, lat, lng
	            FROM markets WHERE ` + strings.Join(conds, " AND ") +
		// US first, then by region then name — a stable, human-scannable list
		// grouped by state in the UI (no MX-before-US default).
		" ORDER BY (country <> 'US'), country, region NULLS LAST, name"

	rows, err := h.db.Query(r.Context(), query, args...)
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

	// Short TTL so an admin launching a new city propagates to the public
	// catalog within seconds (a marketing-launch moment), while still absorbing
	// catalog read load. stale-while-revalidate keeps it snappy.
	writeCachedJSON(w, r, http.StatusOK, map[string]interface{}{"markets": out}, 30, 300)
}
