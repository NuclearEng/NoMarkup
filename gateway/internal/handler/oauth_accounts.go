package handler

// OAuth linked-account list + unlink (ASR-5.1.1.v partial).
//
// Routes (on UserHandler — reuses the existing db pool):
//
//   GET    /api/v1/users/me/oauth-accounts
//   DELETE /api/v1/users/me/oauth-accounts/{provider}
//
// Lockout prevention: refuse to unlink the last sign-in method when the
// user has no password set (OAuth-only accounts). Unlink is allowed when
// password_hash is non-null OR at least one other oauth_accounts row remains.

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// oauthAccountJSON is the public list shape. provider_id is omitted — it is
// an opaque third-party subject that the user cannot act on.
type oauthAccountJSON struct {
	Provider string    `json:"provider"`
	Email    *string   `json:"email,omitempty"`
	LinkedAt time.Time `json:"linked_at"`
}

// allowedOAuthProviders mirrors oauth_accounts.provider CHECK plus facebook
// (gateway OAuth exists; older DBs only accept google|apple until a migration
// widens the constraint — DELETE for an unknown row returns 404 either way).
var allowedOAuthProviders = map[string]struct{}{
	"google":   {},
	"apple":    {},
	"facebook": {},
}

// canUnlinkOAuth reports whether unlinking one linked provider is safe.
// hasPassword: users.password_hash is set. oauthCount: rows currently linked.
// After unlink, oauthCount-1 remain; we need password OR ≥1 remaining method.
func canUnlinkOAuth(hasPassword bool, oauthCount int) bool {
	if oauthCount <= 0 {
		return false
	}
	if hasPassword {
		return true
	}
	return oauthCount > 1
}

// ListOAuthAccounts handles GET /api/v1/users/me/oauth-accounts.
func (h *UserHandler) ListOAuthAccounts(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT provider, email, created_at
		FROM oauth_accounts
		WHERE user_id = $1
		ORDER BY created_at ASC`, claims.UserID)
	if err != nil {
		slog.ErrorContext(r.Context(), "list oauth accounts failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to list connected accounts")
		return
	}
	defer rows.Close()

	out := make([]oauthAccountJSON, 0)
	for rows.Next() {
		var provider string
		var email pgtype.Text
		var createdAt time.Time
		if scanErr := rows.Scan(&provider, &email, &createdAt); scanErr != nil {
			slog.ErrorContext(r.Context(), "list oauth accounts scan failed", "error", scanErr, "user_id", claims.UserID)
			writeError(w, http.StatusInternalServerError, "failed to list connected accounts")
			return
		}
		item := oauthAccountJSON{Provider: provider, LinkedAt: createdAt}
		if email.Valid && email.String != "" {
			e := email.String
			item.Email = &e
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		slog.ErrorContext(r.Context(), "list oauth accounts rows failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to list connected accounts")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"accounts": out,
	})
}

// UnlinkOAuthAccount handles DELETE /api/v1/users/me/oauth-accounts/{provider}.
//
// Returns 409 when unlinking would leave the user with no sign-in method.
func (h *UserHandler) UnlinkOAuthAccount(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	provider := strings.ToLower(strings.TrimSpace(chi.URLParam(r, "provider")))
	if _, ok := allowedOAuthProviders[provider]; !ok {
		writeError(w, http.StatusBadRequest, "unsupported provider")
		return
	}

	ctx := r.Context()

	// Password present? (OAuth-only users have NULL password_hash.)
	var passwordHash *string
	if err := h.db.QueryRow(ctx,
		`SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
		claims.UserID,
	).Scan(&passwordHash); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		slog.ErrorContext(ctx, "unlink oauth: user lookup failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to unlink account")
		return
	}
	hasPassword := passwordHash != nil && strings.TrimSpace(*passwordHash) != ""

	// Count linked OAuth providers before delete.
	var oauthCount int
	if err := h.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM oauth_accounts WHERE user_id = $1`,
		claims.UserID,
	).Scan(&oauthCount); err != nil {
		slog.ErrorContext(ctx, "unlink oauth: count failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to unlink account")
		return
	}

	// Does this provider row exist?
	var exists bool
	if err := h.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM oauth_accounts WHERE user_id = $1 AND provider = $2)`,
		claims.UserID, provider,
	).Scan(&exists); err != nil {
		slog.ErrorContext(ctx, "unlink oauth: existence check failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to unlink account")
		return
	}
	if !exists {
		writeError(w, http.StatusNotFound, "connected account not found")
		return
	}

	if !canUnlinkOAuth(hasPassword, oauthCount) {
		writeError(w, http.StatusConflict,
			"cannot disconnect your only sign-in method — set a password first, or link another account")
		return
	}

	tag, err := h.db.Exec(ctx,
		`DELETE FROM oauth_accounts WHERE user_id = $1 AND provider = $2`,
		claims.UserID, provider,
	)
	if err != nil {
		slog.ErrorContext(ctx, "unlink oauth: delete failed", "error", err, "user_id", claims.UserID, "provider", provider)
		writeError(w, http.StatusInternalServerError, "failed to unlink account")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "connected account not found")
		return
	}

	slog.InfoContext(ctx, "oauth account unlinked", "user_id", claims.UserID, "provider", provider)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"unlinked": true,
		"provider": provider,
	})
}
