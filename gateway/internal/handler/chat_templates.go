package handler

// Quick-reply chat templates — closes audit Section F's "no canned
// responses" gap. Per-user; the empty-state UI falls back to a built-in
// default list when the user has no rows yet.
//
// Routes (all auth-gated, mounted under /api/v1):
//
//   GET    /api/v1/me/chat/templates           ListMyTemplates
//   POST   /api/v1/me/chat/templates           CreateTemplate
//   PATCH  /api/v1/me/chat/templates/{id}      UpdateTemplate
//   DELETE /api/v1/me/chat/templates/{id}      DeleteTemplate
//   POST   /api/v1/me/chat/templates/{id}/use  UseTemplate (bumps use_count)

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ChatTemplatesHandler exposes per-user quick-reply CRUD. A nil db
// short-circuits read endpoints to a safe empty-state and write endpoints
// to a 503.
type ChatTemplatesHandler struct {
	db *pgxpool.Pool
}

// NewChatTemplatesHandler returns a ChatTemplatesHandler.
func NewChatTemplatesHandler(db *pgxpool.Pool) *ChatTemplatesHandler {
	return &ChatTemplatesHandler{db: db}
}

const (
	templateMaxLen = 500
)

type messageTemplateJSON struct {
	ID        string    `json:"id"`
	Body      string    `json:"body"`
	UseCount  int       `json:"use_count"`
	CreatedAt time.Time `json:"created_at"`
}

type createTemplateRequest struct {
	Body string `json:"body"`
}

type updateTemplateRequest struct {
	Body string `json:"body"`
}

// defaultTemplates is the built-in fallback list returned alongside the
// user's own templates when the empty state would otherwise be barren.
// Marketplace-friendly defaults — match the cold-open patterns sellers
// see most often.
var defaultTemplates = []string{
	"Is this still available?",
	"What's your best price?",
	"Can you do $___?",
	"I can pick up tomorrow at 5pm.",
	"Would you take $___ cash today?",
	"Can you send more photos?",
	"Where is the pickup location?",
	"Thanks, I'll pass for now.",
}

// ListMyTemplates returns the user's templates plus the built-in default
// list. The defaults are returned in a separate field so the UI can choose
// to merge or display them as a "suggested" rail.
func (h *ChatTemplatesHandler) ListMyTemplates(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"templates": []messageTemplateJSON{},
			"defaults":  defaultTemplates,
		})
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id, body, use_count, created_at
		  FROM message_templates
		 WHERE user_id = $1
		 ORDER BY use_count DESC, created_at DESC
		 LIMIT 100`,
		claims.UserID,
	)
	if err != nil {
		slog.ErrorContext(r.Context(), "templates: list failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list templates")
		return
	}
	defer rows.Close()

	out := make([]messageTemplateJSON, 0)
	for rows.Next() {
		var t messageTemplateJSON
		if err := rows.Scan(&t.ID, &t.Body, &t.UseCount, &t.CreatedAt); err != nil {
			slog.ErrorContext(r.Context(), "templates: scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, t)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"templates": out,
		"defaults":  defaultTemplates,
	})
}

// CreateTemplate handles POST /api/v1/me/chat/templates.
func (h *ChatTemplatesHandler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req createTemplateRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	body := strings.TrimSpace(req.Body)
	if body == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}
	if len(body) > templateMaxLen {
		writeError(w, http.StatusBadRequest, "body too long")
		return
	}

	var t messageTemplateJSON
	t.Body = body
	if err := h.db.QueryRow(r.Context(), `
		INSERT INTO message_templates (user_id, body)
		VALUES ($1, $2)
		RETURNING id, use_count, created_at`,
		claims.UserID, body,
	).Scan(&t.ID, &t.UseCount, &t.CreatedAt); err != nil {
		slog.ErrorContext(r.Context(), "templates: insert failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create template")
		return
	}

	writeJSON(w, http.StatusCreated, t)
}

// UpdateTemplate handles PATCH /api/v1/me/chat/templates/{id}.
func (h *ChatTemplatesHandler) UpdateTemplate(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid template id")
		return
	}

	var req updateTemplateRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	body := strings.TrimSpace(req.Body)
	if body == "" {
		writeError(w, http.StatusBadRequest, "body is required")
		return
	}
	if len(body) > templateMaxLen {
		writeError(w, http.StatusBadRequest, "body too long")
		return
	}

	var t messageTemplateJSON
	t.ID = id
	t.Body = body
	err := h.db.QueryRow(r.Context(), `
		UPDATE message_templates
		   SET body = $1
		 WHERE id = $2 AND user_id = $3
		 RETURNING use_count, created_at`,
		body, id, claims.UserID,
	).Scan(&t.UseCount, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "templates: update failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to update template")
		return
	}

	writeJSON(w, http.StatusOK, t)
}

// DeleteTemplate handles DELETE /api/v1/me/chat/templates/{id}.
func (h *ChatTemplatesHandler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid template id")
		return
	}

	tag, err := h.db.Exec(r.Context(),
		`DELETE FROM message_templates WHERE id = $1 AND user_id = $2`,
		id, claims.UserID,
	)
	if err != nil {
		slog.ErrorContext(r.Context(), "templates: delete failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to delete template")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// UseTemplate increments use_count so the most-used templates sort first.
// Idempotency is intentionally NOT enforced — a user clicking the same
// template twice should see it bubble up each time.
func (h *ChatTemplatesHandler) UseTemplate(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid template id")
		return
	}

	var useCount int
	err := h.db.QueryRow(r.Context(), `
		UPDATE message_templates
		   SET use_count = use_count + 1
		 WHERE id = $1 AND user_id = $2
		 RETURNING use_count`,
		id, claims.UserID,
	).Scan(&useCount)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "templates: use bump failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to bump use count")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":        id,
		"use_count": useCount,
	})
}
