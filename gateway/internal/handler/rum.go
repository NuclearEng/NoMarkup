package handler

// Field RUM ingest + admin p75 (F8).
//
// POST /api/v1/rum is public, rate-limited at the gateway, and stores no
// identity: no user id, cookies, or IP. The browser beacon must never error
// the page — nil DB and insert failures return 202 and drop the sample.
//
// GET /api/v1/admin/rum (RequireAdmin) returns p75 per metric over the last
// 24h plus sample counts, and the same broken out by route.

import (
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RumHandler stores anonymous Core Web Vitals samples and serves admin p75.
type RumHandler struct {
	db *pgxpool.Pool
}

// NewRumHandler returns a RumHandler. A nil db accepts POSTs (202) and drops
// them so a missing DATABASE_URL never fails the browser beacon.
func NewRumHandler(db *pgxpool.Pool) *RumHandler {
	return &RumHandler{db: db}
}

const rumPathMaxLen = 200

var rumMetricNames = map[string]struct{}{
	"LCP":  {},
	"INP":  {},
	"CLS":  {},
	"FCP":  {},
	"TTFB": {},
}

var rumRatings = map[string]struct{}{
	"good":              {},
	"needs-improvement": {},
	"poor":              {},
}

type rumSampleRequest struct {
	Name   string  `json:"name"`
	Value  float64 `json:"value"`
	Rating string  `json:"rating"`
	Path   string  `json:"path"`
}

type rumMetricSummary struct {
	Name    string  `json:"name"`
	P75     float64 `json:"p75"`
	Samples int64   `json:"samples"`
}

type rumRouteSummary struct {
	Name    string  `json:"name"`
	Path    string  `json:"path"`
	P75     float64 `json:"p75"`
	Samples int64   `json:"samples"`
}

// sanitizeRumPath strips query/hash (and scheme/host if a full URL slipped
// in), defaults empty to "/", and caps length at 200.
func sanitizeRumPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "/"
	}
	if u, err := url.Parse(raw); err == nil {
		switch {
		case u.Path != "" || u.Host != "" || u.Scheme != "":
			if u.Path != "" {
				raw = u.Path
			} else {
				raw = "/"
			}
		default:
			if i := strings.IndexAny(raw, "?#"); i >= 0 {
				raw = raw[:i]
			}
		}
	} else if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "/"
	}
	if len(raw) > rumPathMaxLen {
		raw = raw[:rumPathMaxLen]
	}
	return raw
}

// PostSample handles POST /api/v1/rum.
func (h *RumHandler) PostSample(w http.ResponseWriter, r *http.Request) {
	var body rumSampleRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	if _, ok := rumMetricNames[body.Name]; !ok {
		writeError(w, http.StatusBadRequest, "name must be LCP|INP|CLS|FCP|TTFB")
		return
	}
	if math.IsNaN(body.Value) || math.IsInf(body.Value, 0) || body.Value < 0 || body.Value >= 1e7 {
		writeError(w, http.StatusBadRequest, "value must be a finite non-negative number")
		return
	}
	if _, ok := rumRatings[body.Rating]; !ok {
		writeError(w, http.StatusBadRequest, "rating must be good|needs-improvement|poor")
		return
	}

	path := sanitizeRumPath(body.Path)

	if h.db == nil {
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
		return
	}

	// Columns are exactly name, value_ms, rating, path — never user_id / IP.
	_, err := h.db.Exec(r.Context(),
		`INSERT INTO rum_samples (name, value_ms, rating, path) VALUES ($1, $2, $3, $4)`,
		body.Name, body.Value, body.Rating, path,
	)
	if err != nil {
		slog.ErrorContext(r.Context(), "rum: insert failed", "error", err)
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

// GetSummary handles GET /api/v1/admin/rum — p75 per name (and per route)
// over the last 24 hours plus sample counts.
func (h *RumHandler) GetSummary(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"window_hours": 24,
			"metrics":      []rumMetricSummary{},
			"routes":       []rumRouteSummary{},
		})
		return
	}

	metrics, err := h.p75ByName(r)
	if err != nil {
		slog.ErrorContext(r.Context(), "rum: admin p75 by name failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load rum summary")
		return
	}
	routes, err := h.p75ByRoute(r)
	if err != nil {
		slog.ErrorContext(r.Context(), "rum: admin p75 by route failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load rum summary")
		return
	}
	if metrics == nil {
		metrics = []rumMetricSummary{}
	}
	if routes == nil {
		routes = []rumRouteSummary{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"window_hours": 24,
		"metrics":      metrics,
		"routes":       routes,
	})
}

func (h *RumHandler) p75ByName(r *http.Request) ([]rumMetricSummary, error) {
	rows, err := h.db.Query(r.Context(), `
		SELECT name,
		       percentile_cont(0.75) WITHIN GROUP (ORDER BY value_ms) AS p75,
		       COUNT(*)::bigint AS samples
		  FROM rum_samples
		 WHERE created_at >= NOW() - INTERVAL '24 hours'
		 GROUP BY name
		 ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]rumMetricSummary, 0, 5)
	for rows.Next() {
		var row rumMetricSummary
		if err := rows.Scan(&row.Name, &row.P75, &row.Samples); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (h *RumHandler) p75ByRoute(r *http.Request) ([]rumRouteSummary, error) {
	rows, err := h.db.Query(r.Context(), `
		SELECT name, path,
		       percentile_cont(0.75) WITHIN GROUP (ORDER BY value_ms) AS p75,
		       COUNT(*)::bigint AS samples
		  FROM rum_samples
		 WHERE created_at >= NOW() - INTERVAL '24 hours'
		 GROUP BY name, path
		 ORDER BY samples DESC, name, path
		 LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]rumRouteSummary, 0)
	for rows.Next() {
		var row rumRouteSummary
		if err := rows.Scan(&row.Name, &row.Path, &row.P75, &row.Samples); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
