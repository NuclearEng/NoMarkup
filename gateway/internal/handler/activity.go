package handler

// Server-side request activity (GDPR-scoped hop log).
//
// GET /api/v1/me/activity — authenticated, owner-only. Keys exclusively off
// claims.UserID; there is no {id} param. Query: limit (default 50, max 200)
// and optional before (timestamptz cursor). Empty list is 200 { "events": [] }.
//
// Writes happen in middleware.Activity (fail-soft INSERT). This handler is
// the read path so Account → Request log / Settings → Request log can reload
// hops after a reinstall. Paths are re-sanitized on read (no query/hash).

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

const (
	activityListDefault = 50
	activityListMax     = 200
	activityPathMaxLen  = 200
)

// ActivityHandler serves the authenticated user's API hop log.
type ActivityHandler struct {
	db *pgxpool.Pool
}

// NewActivityHandler returns an ActivityHandler. A nil db lists as an empty
// 200 so a missing DATABASE_URL never fails the request-log UI.
func NewActivityHandler(db *pgxpool.Pool) *ActivityHandler {
	return &ActivityHandler{db: db}
}

type activityEventJSON struct {
	ID         string    `json:"id"`
	RequestID  string    `json:"request_id"`
	Method     string    `json:"method"`
	Path       string    `json:"path"`
	Status     int       `json:"status"`
	DurationMs int       `json:"duration_ms"`
	CreatedAt  time.Time `json:"created_at"`
}

type activityListResponse struct {
	Events []activityEventJSON `json:"events"`
}

// ListMyActivity handles GET /api/v1/me/activity.
func (h *ActivityHandler) ListMyActivity(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok || claims.UserID == "" || !isValidUUID(claims.UserID) {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	limit := parseActivityLimit(r.URL.Query().Get("limit"))
	var before *time.Time
	if raw := strings.TrimSpace(r.URL.Query().Get("before")); raw != "" {
		t, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			t, err = time.Parse(time.RFC3339, raw)
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, "before must be an RFC3339 timestamp")
			return
		}
		before = &t
	}

	events := make([]activityEventJSON, 0)
	if h.db == nil {
		writeJSON(w, http.StatusOK, activityListResponse{Events: events})
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id::text, request_id, method, path, status, duration_ms, created_at
		  FROM user_request_activity
		 WHERE user_id = $1
		   AND ($2::timestamptz IS NULL OR created_at < $2)
		 ORDER BY created_at DESC
		 LIMIT $3`,
		claims.UserID, before, limit,
	)
	if err != nil {
		slog.ErrorContext(r.Context(), "activity: list failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load activity")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var ev activityEventJSON
		if err := rows.Scan(&ev.ID, &ev.RequestID, &ev.Method, &ev.Path, &ev.Status, &ev.DurationMs, &ev.CreatedAt); err != nil {
			slog.ErrorContext(r.Context(), "activity: scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to load activity")
			return
		}
		ev.Path = sanitizeActivityPath(ev.Path)
		events = append(events, ev)
	}
	if err := rows.Err(); err != nil {
		slog.ErrorContext(r.Context(), "activity: iterate failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load activity")
		return
	}

	writeJSON(w, http.StatusOK, activityListResponse{Events: events})
}

func parseActivityLimit(raw string) int {
	if raw == "" {
		return activityListDefault
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return activityListDefault
	}
	if n > activityListMax {
		return activityListMax
	}
	return n
}

// sanitizeActivityPath strips query/hash, defaults empty to "/", and caps
// length at 200. Fail-closed: never emit '?' or '#' on the read path either.
func sanitizeActivityPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "/"
	}
	if i := strings.IndexAny(raw, "?#"); i >= 0 {
		raw = raw[:i]
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "/"
	}
	if len(raw) > activityPathMaxLen {
		raw = raw[:activityPathMaxLen]
	}
	return raw
}
