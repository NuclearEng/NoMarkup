package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FeatureFlagHandler handles HTTP endpoints for feature flag management.
// Feature flags are a gateway-level concern stored directly in PostgreSQL,
// not routed through a downstream gRPC service.
type FeatureFlagHandler struct {
	db *pgxpool.Pool
}

// NewFeatureFlagHandler creates a new FeatureFlagHandler.
// If db is nil (e.g. DATABASE_URL not set), endpoints return empty/default responses.
func NewFeatureFlagHandler(db *pgxpool.Pool) *FeatureFlagHandler {
	return &FeatureFlagHandler{db: db}
}

// GetFeatureFlags handles GET /api/v1/flags (public).
// Returns a flat map of flag key → enabled boolean for frontend consumption.
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

	writeJSON(w, http.StatusOK, flags)
}

// ListFeatureFlags handles GET /api/v1/admin/flags (admin).
// Returns all flags with full metadata for the admin dashboard.
func (h *FeatureFlagHandler) ListFeatureFlags(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"flags": []interface{}{}})
		return
	}

	rows, err := h.db.Query(r.Context(),
		`SELECT key, enabled, description, updated_at FROM feature_flags ORDER BY key`)
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
		var updatedAt time.Time
		if err := rows.Scan(&key, &enabled, &description, &updatedAt); err != nil {
			slog.Error("failed to scan feature flag", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to scan feature flag")
			return
		}
		flags = append(flags, map[string]interface{}{
			"key":         key,
			"enabled":     enabled,
			"description": description,
			"updated_at":  updatedAt,
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
// Updates the enabled status of a feature flag by key.
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
		Enabled bool `json:"enabled"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	result, err := h.db.Exec(r.Context(),
		`UPDATE feature_flags SET enabled = $1 WHERE key = $2`, req.Enabled, key)
	if err != nil {
		slog.Error("failed to update feature flag", "key", key, "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update feature flag")
		return
	}
	if result.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "feature flag not found")
		return
	}

	slog.Info("feature flag updated", "key", key, "enabled", req.Enabled)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"key":     key,
		"enabled": req.Enabled,
	})
}
