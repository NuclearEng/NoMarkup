package handler

// Web Push subscription handler — closes audit Section J's "FCM-only push"
// gap. Buyers (and sellers) who opt in to browser notifications POST the
// W3C PushSubscription returned by pushManager.subscribe; we upsert into
// `push_subscriptions` keyed on (user_id, endpoint). The notification
// service iterates every row owned by a recipient when fanning out a
// notification — coexists with FCM/APNs device tokens.
//
// Routes:
//   POST   /api/v1/me/push-subscriptions       Subscribe   (auth)
//   DELETE /api/v1/me/push-subscriptions/{id}  Unsubscribe (auth)
//
// Pattern matches follows.go: pgx-direct, nil-safe pool (503 when
// DATABASE_URL is unset), structured slog errors, claims-based ownership.

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// PushSubscriptionsHandler exposes the web-push subscription store.
type PushSubscriptionsHandler struct {
	db *pgxpool.Pool
}

// NewPushSubscriptionsHandler returns a handler. A nil db short-circuits
// every endpoint to a 503, mirroring the rest of the marketplace surface.
func NewPushSubscriptionsHandler(db *pgxpool.Pool) *PushSubscriptionsHandler {
	return &PushSubscriptionsHandler{db: db}
}

// subscribeRequest mirrors the JSON shape of PushSubscription.toJSON()
// returned by the browser. We accept both `endpoint` + `keys.{p256dh,auth}`
// and a flatter `p256dh_key` / `auth_key` form for resilience against
// older client builds.
type subscribeRequest struct {
	Endpoint  string `json:"endpoint"`
	Keys      *keys  `json:"keys,omitempty"`
	P256dhKey string `json:"p256dh_key,omitempty"`
	AuthKey   string `json:"auth_key,omitempty"`
	UserAgent string `json:"user_agent,omitempty"`
}

type keys struct {
	P256dh string `json:"p256dh"`
	Auth   string `json:"auth"`
}

type subscribeResponse struct {
	ID       string `json:"id"`
	Endpoint string `json:"endpoint"`
}

// Subscribe upserts a push subscription row. Idempotent on the
// (user_id, endpoint) UNIQUE constraint — repeated calls update
// last_seen_at and the keys (which can rotate after a long absence).
func (h *PushSubscriptionsHandler) Subscribe(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}

	var req subscribeRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Normalize the dual-shape body so the rest of the handler is simple.
	p256 := req.P256dhKey
	auth := req.AuthKey
	if req.Keys != nil {
		if p256 == "" {
			p256 = req.Keys.P256dh
		}
		if auth == "" {
			auth = req.Keys.Auth
		}
	}

	if req.Endpoint == "" || p256 == "" || auth == "" {
		writeError(w, http.StatusBadRequest, "endpoint, p256dh, and auth are required")
		return
	}
	// The endpoint is a URL the notification service will POST to later, so
	// it is an SSRF sink, not just a string column. validatePushEndpoint
	// enforces https + the browser-vendor host allowlist + no IP literals
	// and bounds the length. See push_endpoint.go for the threat model.
	if err := validatePushEndpoint(req.Endpoint); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var id string
	err := h.db.QueryRow(r.Context(), `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key, user_agent)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''))
		ON CONFLICT (user_id, endpoint) DO UPDATE
		   SET p256dh_key   = EXCLUDED.p256dh_key,
		       auth_key     = EXCLUDED.auth_key,
		       user_agent   = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent),
		       last_seen_at = now()
		RETURNING id`,
		claims.UserID, req.Endpoint, p256, auth, req.UserAgent,
	).Scan(&id)
	if err != nil {
		slog.ErrorContext(r.Context(), "push subscription upsert failed",
			"error", err,
			"user_id", claims.UserID,
		)
		writeError(w, http.StatusInternalServerError, "failed to save subscription")
		return
	}

	writeJSON(w, http.StatusOK, subscribeResponse{ID: id, Endpoint: req.Endpoint})
}

// Unsubscribe deletes a single subscription by id. Only the owner can
// delete; the WHERE clause enforces this. A non-existent or already-
// deleted row is a no-op (200) — matches the watchlist/follows pattern.
func (h *PushSubscriptionsHandler) Unsubscribe(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid subscription id")
		return
	}

	_, err := h.db.Exec(r.Context(),
		`DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2`,
		id, claims.UserID,
	)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		slog.ErrorContext(r.Context(), "push subscription delete failed",
			"error", err,
			"user_id", claims.UserID,
			"subscription_id", id,
		)
		writeError(w, http.StatusInternalServerError, "failed to remove subscription")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}
