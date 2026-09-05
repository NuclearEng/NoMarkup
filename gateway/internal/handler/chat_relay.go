package handler

// Chat relay — anonymous email/phone aliasing. Closes audit Section F's
// "no Craigslist-style relay" gap.
//
// In dev, neither the inbound mail forwarder (Postmark/SES inbound) nor
// the Twilio Proxy service is wired up. The contract here is:
//
//   - Email: ALWAYS generate an alias-{nanoid}@relay.nomarkup.com on first
//     POST. The notification service uses this as the From: header when a
//     message is "cold-open" (recipient has not yet replied). Setting up
//     the inbound forwarder (POST /webhooks/inbound-mail → look up alias
//     row → forward to user's real email) is a deploy step.
//
//   - Phone: ONLY generate twilio_proxy_phone when both
//     TWILIO_ACCOUNT_SID and TWILIO_PROXY_SERVICE_SID are set. Otherwise
//     leave NULL — the chat UI hides the "call" button when the alias
//     row's twilio_proxy_phone is empty.
//
// Routes:
//
//   POST /api/v1/me/chat/aliases          CreateAlias (idempotent on
//                                          UNIQUE (user_id, context_type,
//                                          context_id))
//   GET  /api/v1/me/chat/aliases          ListAliases
//
// Pattern follows follows.go / watchlist.go: pgx-direct, nil-safe DB pool,
// structured slog errors, additive endpoints under the auth-protected
// /api/v1 block.

import (
	"crypto/rand"
	"encoding/base32"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ChatRelayHandler exposes per-user proxy aliases. A nil db short-circuits
// every endpoint to a 503 (matches the rest of the marketplace surface).
type ChatRelayHandler struct {
	db *pgxpool.Pool
}

// NewChatRelayHandler returns a ChatRelayHandler.
func NewChatRelayHandler(db *pgxpool.Pool) *ChatRelayHandler {
	return &ChatRelayHandler{db: db}
}

// relayDomain is the subdomain inbound mail is routed to. Override with
// CHAT_RELAY_DOMAIN in production (e.g. relay.nomarkup.com).
func relayDomain() string {
	if d := os.Getenv("CHAT_RELAY_DOMAIN"); d != "" {
		return d
	}
	return "relay.nomarkup.com"
}

// twilioConfigured reports whether the Twilio proxy service is wired up.
// Without both env vars the alias row's twilio_proxy_phone is left NULL
// and the UI hides the "call" affordance.
func twilioConfigured() bool {
	return os.Getenv("TWILIO_ACCOUNT_SID") != "" && os.Getenv("TWILIO_PROXY_SERVICE_SID") != ""
}

// nanoID returns a 16-character URL-safe slug derived from 10 bytes of
// CSPRNG output. Base32 keeps the result lowercase-ish and DNS-safe.
func nanoID() (string, error) {
	buf := make([]byte, 10)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	s := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf))
	return s, nil
}

// chatAliasJSON is the wire shape returned by both endpoints.
type chatAliasJSON struct {
	ID               string     `json:"id"`
	UserID           string     `json:"user_id"`
	ContextType      string     `json:"context_type"`
	ContextID        string     `json:"context_id"`
	EmailAlias       string     `json:"email_alias"`
	TwilioProxyPhone *string    `json:"twilio_proxy_phone"`
	CreatedAt        time.Time  `json:"created_at"`
	ExpiresAt        *time.Time `json:"expires_at"`
}

type createAliasRequest struct {
	ContextType string `json:"context_type"`
	ContextID   string `json:"context_id"`
}

// CreateAlias handles POST /api/v1/me/chat/aliases.
//
// The DB UNIQUE (user_id, context_type, context_id) constraint makes this
// idempotent: a second call for the same context returns the existing row
// (200 OK), a fresh insert returns 201 Created.
func (h *ChatRelayHandler) CreateAlias(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req createAliasRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.ContextType != "listing" && req.ContextType != "job" {
		writeError(w, http.StatusBadRequest, "context_type must be 'listing' or 'job'")
		return
	}
	if !isValidUUID(req.ContextID) {
		writeError(w, http.StatusBadRequest, "invalid context_id")
		return
	}

	// Existing-row fast path. Avoids burning a fresh nanoid on every retry.
	var existing chatAliasJSON
	row := h.db.QueryRow(r.Context(), `
		SELECT id, user_id, context_type, context_id,
		       email_alias, twilio_proxy_phone, created_at, expires_at
		  FROM chat_aliases
		 WHERE user_id = $1 AND context_type = $2 AND context_id = $3`,
		claims.UserID, req.ContextType, req.ContextID,
	)
	var twilioNullable *string
	var expiresAt *time.Time
	if err := row.Scan(
		&existing.ID, &existing.UserID, &existing.ContextType, &existing.ContextID,
		&existing.EmailAlias, &twilioNullable, &existing.CreatedAt, &expiresAt,
	); err == nil {
		existing.TwilioProxyPhone = twilioNullable
		existing.ExpiresAt = expiresAt
		writeJSON(w, http.StatusOK, existing)
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		slog.ErrorContext(r.Context(), "chat-alias: lookup failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to lookup alias")
		return
	}

	// Fresh insert. Generate a nanoid; the email alias is stable forever.
	slug, err := nanoID()
	if err != nil {
		slog.ErrorContext(r.Context(), "chat-alias: nanoid generation failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to generate alias")
		return
	}
	emailAlias := "alias-" + slug + "@" + relayDomain()

	// Twilio proxy phone is only minted when the env wires it up. In dev
	// we leave it NULL — the UI hides the "call" affordance accordingly.
	// Real deploys would call the Twilio Proxy API here to mint a number.
	var twilioPhone *string

	var created chatAliasJSON
	created.UserID = claims.UserID
	created.ContextType = req.ContextType
	created.ContextID = req.ContextID
	created.EmailAlias = emailAlias

	if err := h.db.QueryRow(r.Context(), `
		INSERT INTO chat_aliases (user_id, context_type, context_id,
		                          email_alias, twilio_proxy_phone)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, context_type, context_id) DO UPDATE
		    SET email_alias = chat_aliases.email_alias
		RETURNING id, email_alias, twilio_proxy_phone, created_at, expires_at`,
		claims.UserID, req.ContextType, req.ContextID, emailAlias, twilioPhone,
	).Scan(&created.ID, &created.EmailAlias, &twilioPhone, &created.CreatedAt, &expiresAt); err != nil {
		slog.ErrorContext(r.Context(), "chat-alias: insert failed", "error", err, "user_id", claims.UserID)
		writeError(w, http.StatusInternalServerError, "failed to create alias")
		return
	}
	created.TwilioProxyPhone = twilioPhone
	created.ExpiresAt = expiresAt

	writeJSON(w, http.StatusCreated, created)
}

// ListAliases handles GET /api/v1/me/chat/aliases.
func (h *ChatRelayHandler) ListAliases(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"aliases":           []chatAliasJSON{},
			"twilio_configured": false,
		})
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	rows, err := h.db.Query(r.Context(), `
		SELECT id, user_id, context_type, context_id,
		       email_alias, twilio_proxy_phone, created_at, expires_at
		  FROM chat_aliases
		 WHERE user_id = $1
		 ORDER BY created_at DESC
		 LIMIT 200`,
		claims.UserID,
	)
	if err != nil {
		slog.ErrorContext(r.Context(), "chat-alias: list failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to list aliases")
		return
	}
	defer rows.Close()

	out := make([]chatAliasJSON, 0)
	for rows.Next() {
		var a chatAliasJSON
		var twilio *string
		var expiresAt *time.Time
		if err := rows.Scan(&a.ID, &a.UserID, &a.ContextType, &a.ContextID,
			&a.EmailAlias, &twilio, &a.CreatedAt, &expiresAt); err != nil {
			slog.ErrorContext(r.Context(), "chat-alias: scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		a.TwilioProxyPhone = twilio
		a.ExpiresAt = expiresAt
		out = append(out, a)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"aliases":           out,
		"twilio_configured": twilioConfigured(),
	})
}
