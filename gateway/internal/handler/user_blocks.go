package handler

// User blocks — closes audit Section F's "no block/report" gap.
//
// A row in user_blocks (blocker_id, blocked_id) does two things:
//
//   1. Mutes incoming chat from blocked_id to blocker_id. The chat
//      SendMessage path (gateway/internal/handler/chat.go) checks this
//      table and returns 403 with "blocked" before forwarding to the chat
//      gRPC service.
//
//   2. Prevents blocked_id from bidding on any of blocker_id's listings.
//      That second check is enforced by the listings_bid handler — but
//      surfacing the table here keeps the data model in one migration.
//
// Routes:
//
//   POST   /api/v1/users/{id}/block   Block      (auth, idempotent)
//   DELETE /api/v1/users/{id}/block   Unblock    (auth, idempotent)
//   GET    /api/v1/me/blocks          MyBlocks   (auth, paginated)

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// UserBlocksHandler exposes the block/unblock surface. A nil db
// short-circuits every endpoint to a 503.
type UserBlocksHandler struct {
	db *pgxpool.Pool
}

// NewUserBlocksHandler returns a UserBlocksHandler.
func NewUserBlocksHandler(db *pgxpool.Pool) *UserBlocksHandler {
	return &UserBlocksHandler{db: db}
}

type blockedUserJSON struct {
	BlockedID   string    `json:"blocked_id"`
	DisplayName string    `json:"display_name"`
	AvatarURL   *string   `json:"avatar_url"`
	Reason      *string   `json:"reason"`
	BlockedAt   time.Time `json:"blocked_at"`
}

type blockRequest struct {
	Reason string `json:"reason"`
}

// Block handles POST /api/v1/users/{id}/block.
//
// Idempotent on the (blocker_id, blocked_id) UNIQUE constraint. Self-block
// is rejected at both the DB level (CHECK constraint) and here with 400.
func (h *UserBlocksHandler) Block(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	targetID := chi.URLParam(r, "id")
	if !isValidUUID(targetID) {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if targetID == claims.UserID {
		writeError(w, http.StatusBadRequest, "cannot block yourself")
		return
	}

	// Verify the target exists. Cheaper than swallowing a foreign-key
	// violation later.
	var exists bool
	if err := h.db.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, targetID,
	).Scan(&exists); err != nil {
		slog.ErrorContext(r.Context(), "block: user existence check failed", "error", err, "target_id", targetID)
		writeError(w, http.StatusInternalServerError, "failed to verify user")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	// Reason is optional — body may be empty/missing. Don't reject malformed
	// JSON for an optional field.
	var req blockRequest
	_ = decodeJSONOptional(r, &req)
	var reason *string
	if req.Reason != "" {
		r := req.Reason
		if len(r) > 500 {
			r = r[:500]
		}
		reason = &r
	}

	if _, err := h.db.Exec(r.Context(), `
		INSERT INTO user_blocks (blocker_id, blocked_id, reason)
		VALUES ($1, $2, $3)
		ON CONFLICT (blocker_id, blocked_id) DO UPDATE
		    SET reason = COALESCE(EXCLUDED.reason, user_blocks.reason)`,
		claims.UserID, targetID, reason,
	); err != nil {
		slog.ErrorContext(r.Context(), "block: insert failed", "error", err, "blocker_id", claims.UserID, "blocked_id", targetID)
		writeError(w, http.StatusInternalServerError, "failed to block user")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"blocked":    true,
		"blocked_id": targetID,
	})
}

// Unblock handles DELETE /api/v1/users/{id}/block.
//
// Idempotent — DELETE on a non-existent row is a no-op and returns the
// same 200 envelope.
func (h *UserBlocksHandler) Unblock(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	targetID := chi.URLParam(r, "id")
	if !isValidUUID(targetID) {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	if _, err := h.db.Exec(r.Context(),
		`DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
		claims.UserID, targetID,
	); err != nil {
		slog.ErrorContext(r.Context(), "unblock: delete failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to unblock user")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"blocked":    false,
		"blocked_id": targetID,
	})
}

// MyBlocks handles GET /api/v1/me/blocks.
func (h *UserBlocksHandler) MyBlocks(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"blocks":     []blockedUserJSON{},
			"pagination": pageMeta(1, 0, 0),
		})
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	q := r.URL.Query()
	page, pageSize := parseDirectPagination(q, 1, 50, 200)

	var total int
	if err := h.db.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM user_blocks WHERE blocker_id = $1`, claims.UserID,
	).Scan(&total); err != nil {
		slog.ErrorContext(r.Context(), "my blocks count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to count blocks")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT u.id, COALESCE(u.display_name, ''), u.avatar_url, ub.reason, ub.created_at
		  FROM user_blocks ub
		  JOIN users u ON u.id = ub.blocked_id
		 WHERE ub.blocker_id = $1
		 ORDER BY ub.created_at DESC
		 LIMIT $2 OFFSET $3`,
		claims.UserID, pageSize, (page-1)*pageSize)
	if err != nil {
		slog.ErrorContext(r.Context(), "my blocks query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list blocks")
		return
	}
	defer rows.Close()

	out := make([]blockedUserJSON, 0)
	for rows.Next() {
		var b blockedUserJSON
		var avatar, reason sql.NullString
		if err := rows.Scan(&b.BlockedID, &b.DisplayName, &avatar, &reason, &b.BlockedAt); err != nil {
			slog.ErrorContext(r.Context(), "my blocks scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		if avatar.Valid {
			s := avatar.String
			b.AvatarURL = &s
		}
		if reason.Valid {
			s := reason.String
			b.Reason = &s
		}
		out = append(out, b)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"blocks":     out,
		"pagination": pageMeta(page, pageSize, total),
	})
}

// decodeJSONOptional decodes a JSON body if present; an empty/missing body
// is not an error. Used by Block where `reason` is purely optional.
func decodeJSONOptional(r *http.Request, dst interface{}) error {
	if r.Body == nil || r.ContentLength == 0 {
		return nil
	}
	return json.NewDecoder(r.Body).Decode(dst)
}
