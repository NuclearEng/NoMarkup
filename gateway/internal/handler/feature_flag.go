package handler

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/cache"
	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// featureFlagCachePrefix must match middleware.featureFlagPrefix so an admin
// toggle invalidates the same key the RequireFlag middleware reads.
const featureFlagCachePrefix = "feature_flag_v2"

// FeatureFlagHandler handles HTTP endpoints for feature flag management.
// Feature flags are a gateway-level concern stored directly in PostgreSQL,
// not routed through a downstream gRPC service.
//
// ARC-10: admin list/update expose optional rollout_percent (0-100). Public
// GET /flags stays a flat key→bool map (CDN-cacheable; no per-user %). Money
// / regulated keys reject partial (1-99) rollout at write time.
type FeatureFlagHandler struct {
	db    *pgxpool.Pool
	cache *cache.Client
}

// NewFeatureFlagHandler creates a new FeatureFlagHandler.
// If db is nil (e.g. DATABASE_URL not set), endpoints return empty/default responses.
func NewFeatureFlagHandler(db *pgxpool.Pool, cacheClient *cache.Client) *FeatureFlagHandler {
	return &FeatureFlagHandler{db: db, cache: cacheClient}
}

// GetFeatureFlags handles GET /api/v1/flags (public).
// Returns a flat map of flag key → enabled boolean for frontend consumption.
// rollout_percent is intentionally omitted: the public map is identical for
// every caller and CDN-cached; sticky % is enforced only server-side.
func (h *FeatureFlagHandler) GetFeatureFlags(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]bool{})
		return
	}

	rows, err := h.db.Query(r.Context(),
		`SELECT key, enabled FROM feature_flags`)
	if err != nil {
		slog.Error("failed to query feature flags", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get feature flags")
		return
	}
	defer rows.Close()

	flags := make(map[string]bool)
	for rows.Next() {
		var key string
		var enabled bool
		if err := rows.Scan(&key, &enabled); err != nil {
			slog.Error("failed to scan feature flag row", "error", err)
			continue
		}
		flags[key] = enabled
	}
	if err := rows.Err(); err != nil {
		slog.Error("error iterating feature flag rows", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to get feature flags")
		return
	}

	// Cacheable at the CDN edge: public flag map, identical for every caller (no per-user data).
	writeCachedJSON(w, r, http.StatusOK, flags, 60, 300)
}

// ListFeatureFlags handles GET /api/v1/admin/flags (admin).
// Returns all flags with full metadata for the admin dashboard.
func (h *FeatureFlagHandler) ListFeatureFlags(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"flags": []interface{}{}})
		return
	}

	rows, err := h.db.Query(r.Context(),
		`SELECT key, enabled, description, rollout_percent, updated_at FROM feature_flags ORDER BY key`)
	if err != nil {
		slog.Error("failed to list feature flags", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list feature flags")
		return
	}
	defer rows.Close()

	var flags []map[string]interface{}
	for rows.Next() {
		var key, description string
		var enabled bool
		var rolloutPercent int
		var updatedAt time.Time
		if err := rows.Scan(&key, &enabled, &description, &rolloutPercent, &updatedAt); err != nil {
			slog.Error("failed to scan feature flag", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to scan feature flag")
			return
		}
		flags = append(flags, map[string]interface{}{
			"key":             key,
			"enabled":         enabled,
			"description":     description,
			"rollout_percent": rolloutPercent,
			"binary_only":     middleware.IsBinaryOnlyFlag(key),
			"updated_at":      updatedAt,
		})
	}
	if err := rows.Err(); err != nil {
		slog.Error("error iterating feature flag rows", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list feature flags")
		return
	}

	if flags == nil {
		flags = []map[string]interface{}{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"flags": flags})
}

// UpdateFeatureFlag handles PUT /api/v1/admin/flags/{key} (admin).
// Updates enabled and optionally rollout_percent (0-100). Money/regulated
// keys reject partial rollout (1-99) so those surfaces stay binary.
func (h *FeatureFlagHandler) UpdateFeatureFlag(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database not available")
		return
	}

	key := chi.URLParam(r, "key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "flag key is required")
		return
	}

	var req struct {
		Enabled        bool `json:"enabled"`
		RolloutPercent *int `json:"rollout_percent"` // optional; omit leaves column unchanged
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	if req.RolloutPercent != nil {
		p := *req.RolloutPercent
		if p < 0 || p > 100 {
			writeError(w, http.StatusBadRequest, "rollout_percent must be between 0 and 100")
			return
		}
		if middleware.IsBinaryOnlyFlag(key) && p != 0 && p != 100 {
			writeError(w, http.StatusBadRequest,
				"money/regulated flags must use binary rollout_percent (0 or 100)")
			return
		}
	}

	var (
		enabledOut bool
		rollout    int
		err        error
	)
	if req.RolloutPercent != nil {
		err = h.db.QueryRow(r.Context(),
			`UPDATE feature_flags SET enabled = $1, rollout_percent = $2 WHERE key = $3
			 RETURNING enabled, rollout_percent`,
			req.Enabled, *req.RolloutPercent, key,
		).Scan(&enabledOut, &rollout)
	} else {
		err = h.db.QueryRow(r.Context(),
			`UPDATE feature_flags SET enabled = $1 WHERE key = $2
			 RETURNING enabled, rollout_percent`,
			req.Enabled, key,
		).Scan(&enabledOut, &rollout)
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "feature flag not found")
			return
		}
		slog.Error("failed to update feature flag", "key", key, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update feature flag")
		return
	}

	// Invalidate the RequireFlag middleware's cache so the toggle applies
	// immediately instead of after the 30s TTL.
	if h.cache != nil {
		h.cache.Delete(r.Context(), cache.Key(featureFlagCachePrefix, key))
	}

	slog.Info("feature flag updated",
		"key", key,
		"enabled", enabledOut,
		"rollout_percent", rollout,
	)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"key":             key,
		"enabled":         enabledOut,
		"rollout_percent": rollout,
		"binary_only":     middleware.IsBinaryOnlyFlag(key),
	})
}
