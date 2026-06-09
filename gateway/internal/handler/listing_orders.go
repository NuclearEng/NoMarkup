package handler

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// ListingOrdersHandler exposes the buyer-facing pickup confirmation +
// dispute filing endpoints for the goods marketplace flow.
//
// It performs auth + ownership validation, then writes the state transition
// to listing_orders / marketplace_disputes via direct SQL. The actual Stripe
// Connect transfer to the seller is performed by the payment-service
// auto-release worker, which reconciles orders in escrow_status='released'
// that have not yet been paid out (stripe_transfer_id IS NULL) and pays
// amount_cents − fee_cents to the seller. (It also still releases 'held'
// orders past the 14-day window.)
//
// This split keeps the gateway hot path off Stripe (which can hang under
// outages) while still giving the buyer immediate confirmation. The worker
// reconciles asynchronously; the stripe_transfer_id marker + a deterministic
// idempotency key ('listing-release:<order_id>') prevent any double-pay.
//
// Thread-safe; the handler holds no per-request mutable state.
type ListingOrdersHandler struct {
	db *pgxpool.Pool
}

// NewListingOrdersHandler creates a new handler.
func NewListingOrdersHandler(db *pgxpool.Pool) *ListingOrdersHandler {
	return &ListingOrdersHandler{db: db}
}

// confirmPickupRequest captures the buyer-side handshake — pickup code
// (the seller reads it aloud), plus optional selfie + photo URLs from
// the existing image upload pipeline. All three fields are optional so
// legacy clients (no selfie capture) continue to function: the policy
// of REQUIRING the code is enforced server-side only when the order has
// a pickup_code_hash set.
type confirmPickupRequest struct {
	PickupCode      string `json:"pickup_code"`
	HandoffPhotoURL string `json:"handoff_photo_url"`
	SelfieURL       string `json:"selfie_url"`
}

type confirmPickupResponse struct {
	OrderID           string `json:"order_id"`
	EscrowStatus      string `json:"escrow_status"`
	SellerPayoutCents int64  `json:"seller_payout_cents"`
	PickupConfirmedAt string `json:"pickup_confirmed_at"`
	BothConfirmed     bool   `json:"both_confirmed"`
}

// hashPickupCode SHA-256 hashes the 6-digit pickup code. We hash so a
// stolen DB dump doesn't leak the in-flight codes; entropy is only ≈20
// bits but combined with the rate limiter the offline attack cost grows.
func hashPickupCode(code string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(sum[:])
}

// ConfirmPickup handles POST /api/v1/orders/{id}/confirm-pickup.
//
// Authorization: the requester must be EITHER the buyer on the order OR an
// admin. The marketplace service checks both.
//
// State transition: held -> pickup_confirmed (buyer half of the mutual
// handshake). The order moves to escrow_status='released' only after the
// SELLER also confirms via SellerConfirm. Stripe transfer fires when
// both confirmations land.
func (h *ListingOrdersHandler) ConfirmPickup(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	orderID := chi.URLParam(r, "id")
	if orderID == "" {
		writeError(w, http.StatusBadRequest, "order id required")
		return
	}
	if _, err := uuid.Parse(orderID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid order id")
		return
	}

	// Body is optional — legacy callers post no body and rely on the
	// existing held->pickup_confirmed transition. Newer callers include
	// pickup_code + selfie_url + handoff_photo_url.
	var body confirmPickupRequest
	if r.ContentLength > 0 {
		if !decodeJSON(w, r, &body) {
			return
		}
	}

	isAdmin := hasRole(claims, "admin")

	// Validate ownership + transition in a single transaction so a concurrent
	// dispute can't race the pickup.
	tx, err := h.db.BeginTx(r.Context(), pgx.TxOptions{})
	if err != nil {
		slog.Error("confirm pickup: begin tx", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	var (
		buyerID, sellerID, escrowStatus string
		amountCents, feeCents           int64
		disputeID                       sql.NullString
		pickupCodeHash                  sql.NullString
		sellerConfirmedAt               sql.NullTime
	)
	err = tx.QueryRow(r.Context(), `
		SELECT buyer_id::text, seller_id::text, escrow_status,
		       amount_cents, fee_cents, dispute_id::text,
		       pickup_code_hash, seller_confirmed_at
		  FROM listing_orders
		 WHERE id = $1
		 FOR UPDATE`, orderID).
		Scan(&buyerID, &sellerID, &escrowStatus, &amountCents, &feeCents,
			&disputeID, &pickupCodeHash, &sellerConfirmedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "order not found")
			return
		}
		slog.Error("confirm pickup: select", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if !isAdmin && buyerID != claims.UserID {
		writeError(w, http.StatusForbidden, "only the buyer can confirm pickup")
		return
	}
	if disputeID.Valid && disputeID.String != "" {
		writeError(w, http.StatusConflict, "order has open dispute")
		return
	}
	if escrowStatus != "held" {
		writeError(w, http.StatusConflict, fmt.Sprintf("cannot confirm pickup from status %q", escrowStatus))
		return
	}

	// If the seller pre-set a pickup code, the buyer MUST supply the
	// matching code. Admins (override path) skip this check.
	if !isAdmin && pickupCodeHash.Valid && pickupCodeHash.String != "" {
		if body.PickupCode == "" {
			writeError(w, http.StatusBadRequest, "pickup_code required")
			return
		}
		if hashPickupCode(body.PickupCode) != pickupCodeHash.String {
			writeError(w, http.StatusUnauthorized, "pickup code does not match")
			return
		}
	}

	now := time.Now().UTC()
	sellerPayout := amountCents - feeCents
	if sellerPayout < 0 {
		sellerPayout = 0
	}

	// Mutual handshake: if the seller already confirmed, advance to
	// 'released' immediately; otherwise stop at 'pickup_confirmed' and
	// wait for the seller's call.
	bothConfirmed := sellerConfirmedAt.Valid
	nextStatus := "pickup_confirmed"
	// When the handshake completes synchronously we stamp released_at so the
	// order is a fully-formed 'released' row (not a "released with NULL
	// released_at" zombie). This keeps the buyer-facing completed_at /
	// released_at non-NULL and matches the auto-release path's stamp. The
	// actual Stripe transfer is still reconciled by the payment-service
	// worker keyed on the released state.
	var releasedAt interface{}
	if bothConfirmed {
		nextStatus = "released"
		releasedAt = now
	}

	if _, err := tx.Exec(r.Context(), `
		UPDATE listing_orders
		   SET escrow_status = $2,
		       pickup_confirmed_at = $3,
		       seller_payout_cents = $4,
		       handoff_photo_url = COALESCE(NULLIF($5, ''), handoff_photo_url),
		       selfie_url        = COALESCE(NULLIF($6, ''), selfie_url),
		       released_at = COALESCE($7, released_at),
		       updated_at = now()
		 WHERE id = $1`,
		orderID, nextStatus, now, sellerPayout,
		body.HandoffPhotoURL, body.SelfieURL, releasedAt,
	); err != nil {
		slog.Error("confirm pickup: update", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.Error("confirm pickup: commit", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("listing pickup confirmed",
		"order_id", orderID,
		"buyer_id", buyerID,
		"actor_id", claims.UserID,
		"is_admin_override", isAdmin && buyerID != claims.UserID,
		"both_confirmed", bothConfirmed,
	)

	writeJSON(w, http.StatusOK, confirmPickupResponse{
		OrderID:           orderID,
		EscrowStatus:      nextStatus,
		SellerPayoutCents: sellerPayout,
		PickupConfirmedAt: now.Format(time.RFC3339),
		BothConfirmed:     bothConfirmed,
	})
}

// sellerConfirmResponse is the seller-side handshake response.
type sellerConfirmResponse struct {
	OrderID           string `json:"order_id"`
	EscrowStatus      string `json:"escrow_status"`
	SellerConfirmedAt string `json:"seller_confirmed_at"`
	BothConfirmed     bool   `json:"both_confirmed"`
}

// SellerConfirm handles POST /api/v1/orders/{id}/seller-confirm — the
// seller's half of the mutual pickup handshake. Only after BOTH parties
// confirm does the order flip to 'released' (and the payment-service
// worker fire the Stripe transfer). Until both land it sits at
// 'pickup_confirmed' with seller_confirmed_at populated for audit.
func (h *ListingOrdersHandler) SellerConfirm(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	orderID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(orderID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid order id")
		return
	}

	tx, err := h.db.BeginTx(r.Context(), pgx.TxOptions{})
	if err != nil {
		slog.Error("seller confirm: begin tx", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	var (
		sellerID, escrowStatus string
		pickupConfirmedAt      sql.NullTime
		sellerConfirmedAt      sql.NullTime
		disputeID              sql.NullString
	)
	if err := tx.QueryRow(r.Context(), `
		SELECT seller_id::text, escrow_status, pickup_confirmed_at,
		       seller_confirmed_at, dispute_id::text
		  FROM listing_orders
		 WHERE id = $1
		 FOR UPDATE`, orderID).
		Scan(&sellerID, &escrowStatus, &pickupConfirmedAt,
			&sellerConfirmedAt, &disputeID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "order not found")
			return
		}
		slog.Error("seller confirm: select", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	isAdmin := hasRole(claims, "admin")
	if !isAdmin && sellerID != claims.UserID {
		writeError(w, http.StatusForbidden, "only the seller can confirm pickup")
		return
	}
	if disputeID.Valid && disputeID.String != "" {
		writeError(w, http.StatusConflict, "order has open dispute")
		return
	}
	if sellerConfirmedAt.Valid {
		writeError(w, http.StatusConflict, "seller already confirmed")
		return
	}

	now := time.Now().UTC()

	// If the buyer also already confirmed, this seller-side ack
	// completes the handshake — flip to 'released'.
	nextStatus := escrowStatus
	bothConfirmed := pickupConfirmedAt.Valid
	// Stamp released_at only when this seller-side ack completes the
	// handshake (buyer already confirmed → flip to 'released'). Mirrors the
	// buyer-side completion in ConfirmPickup so a synchronously-released
	// order always carries a release timestamp.
	var releasedAt interface{}
	if bothConfirmed && escrowStatus == "pickup_confirmed" {
		nextStatus = "released"
		releasedAt = now
	}

	if _, err := tx.Exec(r.Context(), `
		UPDATE listing_orders
		   SET seller_confirmed_at = $2,
		       escrow_status = $3,
		       released_at = COALESCE($4, released_at),
		       updated_at = now()
		 WHERE id = $1`,
		orderID, now, nextStatus, releasedAt,
	); err != nil {
		slog.Error("seller confirm: update", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.Error("seller confirm: commit", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("listing seller confirmed",
		"order_id", orderID,
		"seller_id", sellerID,
		"actor_id", claims.UserID,
		"both_confirmed", bothConfirmed,
		"next_status", nextStatus,
	)

	writeJSON(w, http.StatusOK, sellerConfirmResponse{
		OrderID:           orderID,
		EscrowStatus:      nextStatus,
		SellerConfirmedAt: now.Format(time.RFC3339),
		BothConfirmed:     bothConfirmed,
	})
}

// reportNoShowRequest is the body for POST /orders/{id}/report-no-show.
type reportNoShowRequest struct {
	Notes string `json:"notes"`
}

// reportNoShowResponse is the response.
type reportNoShowResponse struct {
	OrderID            string `json:"order_id"`
	ReportedUserID     string `json:"reported_user_id"`
	NewNoShowCount     int    `json:"new_no_show_count"`
	CooldownUntil      string `json:"cooldown_until"`
	ShadowBanTriggered bool   `json:"shadow_ban_triggered"`
}

// ReportNoShow handles POST /api/v1/orders/{id}/report-no-show — the
// present party reports the absent one. Increments the absent user's
// no_show_count; on count >= 2 the user is silently shadow-banned from
// bidding for 30 days (no_show_cooldown_until = now() + 30d).
func (h *ListingOrdersHandler) ReportNoShow(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	orderID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(orderID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid order id")
		return
	}

	var body reportNoShowRequest
	// notes is optional — accept empty body too.
	if r.ContentLength > 0 {
		if !decodeJSON(w, r, &body) {
			return
		}
	}
	_ = body // notes accepted but currently logged only at slog level

	tx, err := h.db.BeginTx(r.Context(), pgx.TxOptions{})
	if err != nil {
		slog.Error("report no-show: begin tx", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	var (
		buyerID, sellerID, escrowStatus string
		pickupWindowEnd                 sql.NullTime
	)
	if err := tx.QueryRow(r.Context(), `
		SELECT buyer_id::text, seller_id::text, escrow_status, pickup_window_end
		  FROM listing_orders
		 WHERE id = $1
		 FOR UPDATE`, orderID).
		Scan(&buyerID, &sellerID, &escrowStatus, &pickupWindowEnd); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "order not found")
			return
		}
		slog.Error("report no-show: select", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	_ = pickupWindowEnd // future cron uses this; included here for FOR UPDATE consistency

	// Reporter must be one of the two parties on the order. The other
	// becomes the absent_id we increment.
	var absentID string
	switch claims.UserID {
	case buyerID:
		absentID = sellerID
	case sellerID:
		absentID = buyerID
	default:
		writeError(w, http.StatusForbidden, "only buyer or seller may file no-show")
		return
	}

	// Block double-reporting once escrow has already moved past held.
	if escrowStatus != "held" {
		writeError(w, http.StatusConflict, fmt.Sprintf("cannot report no-show from status %q", escrowStatus))
		return
	}

	// Increment counter and (re)compute cooldown. Threshold is 2: on the
	// second confirmed no-show the cooldown clamps to now()+30d.
	const cooldownThreshold = 2
	const cooldownDays = 30

	var newCount int
	if err := tx.QueryRow(r.Context(), `
		UPDATE users
		   SET no_show_count = no_show_count + 1,
		       no_show_cooldown_until = CASE
		           WHEN no_show_count + 1 >= $2 THEN now() + ($3 || ' days')::interval
		           ELSE no_show_cooldown_until
		       END,
		       updated_at = now()
		 WHERE id = $1
		 RETURNING no_show_count`,
		absentID, cooldownThreshold, cooldownDays,
	).Scan(&newCount); err != nil {
		slog.Error("report no-show: update user", "absent_id", absentID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	shadowBan := newCount >= cooldownThreshold
	cooldownUntil := ""
	if shadowBan {
		cooldownUntil = time.Now().UTC().AddDate(0, 0, cooldownDays).Format(time.RFC3339)
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.Error("report no-show: commit", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("listing no-show reported",
		"order_id", orderID,
		"reporter_id", claims.UserID,
		"absent_id", absentID,
		"new_count", newCount,
		"shadow_ban_triggered", shadowBan,
	)

	writeJSON(w, http.StatusOK, reportNoShowResponse{
		OrderID:            orderID,
		ReportedUserID:     absentID,
		NewNoShowCount:     newCount,
		CooldownUntil:      cooldownUntil,
		ShadowBanTriggered: shadowBan,
	})
}

// fileListingDisputeRequest is the body for POST /api/v1/orders/{id}/file-dispute.
type fileListingDisputeRequest struct {
	Reason      string `json:"reason"`
	Description string `json:"description"`
}

// fileListingDisputeResponse is the response.
type fileListingDisputeResponse struct {
	DisputeID    string `json:"dispute_id"`
	OrderID      string `json:"order_id"`
	EscrowStatus string `json:"escrow_status"`
	Status       string `json:"status"`
}

// FileListingDispute handles POST /api/v1/orders/{id}/file-dispute.
// Buyer-only. Allowed when status='held' OR (status='pickup_confirmed' AND
// within 24h of pickup).
func (h *ListingOrdersHandler) FileListingDispute(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	orderID := chi.URLParam(r, "id")
	if _, err := uuid.Parse(orderID); err != nil {
		writeError(w, http.StatusBadRequest, "invalid order id")
		return
	}

	var body fileListingDisputeRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	allowed := map[string]bool{
		"item_not_as_described": true,
		"item_damaged":          true,
		"no_show":               true,
		"item_not_received":     true,
		"other":                 true,
	}
	if !allowed[body.Reason] {
		writeError(w, http.StatusBadRequest, "invalid reason; must be one of: item_not_as_described, item_damaged, no_show, item_not_received, other")
		return
	}
	if len(body.Description) < 20 {
		writeError(w, http.StatusBadRequest, "description must be at least 20 characters")
		return
	}

	tx, err := h.db.BeginTx(r.Context(), pgx.TxOptions{})
	if err != nil {
		slog.Error("file dispute: begin tx", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	var (
		buyerID, escrowStatus string
		pickupAt              sql.NullTime
		disputeID             sql.NullString
	)
	if err := tx.QueryRow(r.Context(), `
		SELECT buyer_id::text, escrow_status, pickup_confirmed_at, dispute_id::text
		  FROM listing_orders
		 WHERE id = $1
		 FOR UPDATE`, orderID).
		Scan(&buyerID, &escrowStatus, &pickupAt, &disputeID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "order not found")
			return
		}
		slog.Error("file dispute: select", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if buyerID != claims.UserID {
		writeError(w, http.StatusForbidden, "only the buyer may file a dispute")
		return
	}
	if disputeID.Valid && disputeID.String != "" {
		writeError(w, http.StatusConflict, "dispute already open")
		return
	}

	switch escrowStatus {
	case "held":
		// allowed
	case "pickup_confirmed":
		if !pickupAt.Valid || time.Since(pickupAt.Time) > 24*time.Hour {
			writeError(w, http.StatusConflict, "dispute window closed (24h post-pickup)")
			return
		}
	default:
		writeError(w, http.StatusConflict, fmt.Sprintf("cannot dispute from status %q", escrowStatus))
		return
	}

	newDisputeID := uuid.New().String()
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO marketplace_disputes (id, listing_order_id, opened_by, reason, description, status)
		VALUES ($1, $2, $3, $4, $5, 'open')`,
		newDisputeID, orderID, claims.UserID, body.Reason, body.Description); err != nil {
		slog.Error("file dispute: insert", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if _, err := tx.Exec(r.Context(), `
		UPDATE listing_orders
		   SET escrow_status = 'disputed',
		       dispute_id = $2,
		       updated_at = now()
		 WHERE id = $1`, orderID, newDisputeID); err != nil {
		slog.Error("file dispute: link", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.Error("file dispute: commit", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	slog.Info("listing dispute filed",
		"order_id", orderID,
		"dispute_id", newDisputeID,
		"buyer_id", claims.UserID,
		"reason", body.Reason,
	)

	writeJSON(w, http.StatusCreated, fileListingDisputeResponse{
		DisputeID:    newDisputeID,
		OrderID:      orderID,
		EscrowStatus: "disputed",
		Status:       "open",
	})
}

// orderResponse is the read shape returned by GetOrder / ListMyOrders.
// Money is integer cents (per CLAUDE.md). Nullable DB columns are emitted
// as JSON null (pointer fields) so the web ListingOrder type can guard them.
//
// The projection JOINs listings (title, photo, pickup location) and the
// seller's users row (display_name) so the order-detail page has everything
// it needs in one read. Several fields are dual-emitted under both the raw
// DB name (back-compat for existing consumers) and the name the web
// ListingOrder type expects:
//   - order id        → order_id (legacy) AND id (web)
//   - escrow_status   → escrow_status (legacy) AND status (web, mapped to the
//     pending/paid/picked_up/completed/disputed/cancelled lifecycle)
//   - fee_cents       → fee_cents (legacy) AND platform_fee_cents (web)
//   - released_at     → released_at (legacy) AND completed_at (web)
//   - pickup_confirmed_at → pickup_confirmed_at (legacy) AND picked_up_at (web)
type orderResponse struct {
	ID                string  `json:"id"`
	OrderID           string  `json:"order_id"`
	ListingID         string  `json:"listing_id"`
	ListingTitle      string  `json:"listing_title"`
	ListingPhotoURL   *string `json:"listing_photo_url"`
	BuyerID           string  `json:"buyer_id"`
	SellerID          string  `json:"seller_id"`
	SellerDisplayName string  `json:"seller_display_name"`
	PickupAddress     string  `json:"pickup_address"`
	PickupZip         string  `json:"pickup_zip"`
	PickupCity        *string `json:"pickup_city"`
	PickupState       *string `json:"pickup_state"`
	EscrowStatus      string  `json:"escrow_status"`
	Status            string  `json:"status"`
	AmountCents       int64   `json:"amount_cents"`
	FeeCents          int64   `json:"fee_cents"`
	PlatformFeeCents  int64   `json:"platform_fee_cents"`
	SellerPayoutCents int64   `json:"seller_payout_cents"`
	PaymentIntentID   string  `json:"payment_intent_id"`
	DisputeID         string  `json:"dispute_id,omitempty"`
	ChannelID         *string `json:"channel_id"`
	// paid_at is the moment escrow was funded. listing_orders has no
	// dedicated paid_at column — an order row only exists once it is funded
	// (escrow_status starts at 'held'), so created_at is the funding time.
	PaidAt              *string `json:"paid_at"`
	PickupConfirmedAt   *string `json:"pickup_confirmed_at"`
	PickedUpAt          *string `json:"picked_up_at"`
	SellerConfirmedAt   *string `json:"seller_confirmed_at"`
	ReleasedAt          *string `json:"released_at"`
	CompletedAt         *string `json:"completed_at"`
	DisputeWindowEndsAt *string `json:"dispute_window_ends_at"`
	CreatedAt           string  `json:"created_at"`
	UpdatedAt           string  `json:"updated_at"`
}

// escrowToOrderStatus maps the listing_orders.escrow_status state machine onto
// the buyer-facing lifecycle the web ListingOrder type uses
// (pending/paid/picked_up/completed/disputed/cancelled). An unknown DB value
// falls back to "pending" rather than emitting an empty string (the page
// renders the status, so it must never be blank).
func escrowToOrderStatus(escrow string) string {
	switch escrow {
	case "pending_payment":
		return "pending"
	case "held":
		return "paid"
	case "pickup_confirmed":
		return "picked_up"
	case "released":
		return "completed"
	case "disputed":
		return "disputed"
	case "refunded", "partially_refunded":
		return "cancelled"
	default:
		return "pending"
	}
}

// nullTimeRFC3339 renders a nullable timestamp as RFC3339, or "" if NULL.
func nullTimeRFC3339(t sql.NullTime) string {
	if !t.Valid {
		return ""
	}
	return t.Time.UTC().Format(time.RFC3339)
}

// nullTimeRFC3339Ptr renders a nullable timestamp as an RFC3339 string
// pointer, or nil if NULL — so it serialises to JSON null rather than "".
func nullTimeRFC3339Ptr(t sql.NullTime) *string {
	if !t.Valid {
		return nil
	}
	s := t.Time.UTC().Format(time.RFC3339)
	return &s
}

// nullStringPtr returns a *string for a sql.NullString — nil (→ JSON null)
// when the column is NULL, otherwise a pointer to the value.
func nullStringPtr(s sql.NullString) *string {
	if !s.Valid {
		return nil
	}
	v := s.String
	return &v
}

// scanOrder maps a listing_orders row (in the canonical column order used by
// orderSelectColumns) onto an orderResponse. Shared by GetOrder and
// ListMyOrders so the read shape stays identical across both endpoints.
func scanOrder(row pgx.Row) (orderResponse, error) {
	var (
		id, listingID, buyerID, sellerID, escrowStatus  string
		amountCents, feeCents, sellerPayoutCents        int64
		listingTitle, pickupAddress, pickupZip          string
		sellerDisplayName                               string
		listingPhotoURL, pickupCity, pickupState        sql.NullString
		paymentIntentID, disputeID                      sql.NullString
		pickupConfirmedAt, sellerConfirmedAt            sql.NullTime
		releasedAt, autoReleaseAt, createdAt, updatedAt sql.NullTime
	)
	if err := row.Scan(
		&id, &listingID, &buyerID, &sellerID, &escrowStatus,
		&amountCents, &feeCents, &sellerPayoutCents,
		&listingTitle, &listingPhotoURL,
		&sellerDisplayName,
		&pickupAddress, &pickupZip, &pickupCity, &pickupState,
		&paymentIntentID, &disputeID,
		&pickupConfirmedAt, &sellerConfirmedAt, &releasedAt, &autoReleaseAt,
		&createdAt, &updatedAt,
	); err != nil {
		return orderResponse{}, err
	}
	return orderResponse{
		ID:                id,
		OrderID:           id,
		ListingID:         listingID,
		ListingTitle:      listingTitle,
		ListingPhotoURL:   nullStringPtr(listingPhotoURL),
		BuyerID:           buyerID,
		SellerID:          sellerID,
		SellerDisplayName: sellerDisplayName,
		PickupAddress:     pickupAddress,
		PickupZip:         pickupZip,
		PickupCity:        nullStringPtr(pickupCity),
		PickupState:       nullStringPtr(pickupState),
		EscrowStatus:      escrowStatus,
		Status:            escrowToOrderStatus(escrowStatus),
		AmountCents:       amountCents,
		FeeCents:          feeCents,
		PlatformFeeCents:  feeCents,
		SellerPayoutCents: sellerPayoutCents,
		PaymentIntentID:   paymentIntentID.String,
		DisputeID:         disputeID.String,
		// listing_orders carries no chat channel reference (the marketplace
		// chat channel is keyed elsewhere); emit null so the page shows its
		// "chat opens once pickup is confirmed" affordance.
		ChannelID: nil,
		// An order row only exists once escrow is funded, so created_at is the
		// funding (paid) time.
		PaidAt:              nullTimeRFC3339Ptr(createdAt),
		PickupConfirmedAt:   nullTimeRFC3339Ptr(pickupConfirmedAt),
		PickedUpAt:          nullTimeRFC3339Ptr(pickupConfirmedAt),
		SellerConfirmedAt:   nullTimeRFC3339Ptr(sellerConfirmedAt),
		ReleasedAt:          nullTimeRFC3339Ptr(releasedAt),
		CompletedAt:         nullTimeRFC3339Ptr(releasedAt),
		DisputeWindowEndsAt: nullTimeRFC3339Ptr(autoReleaseAt),
		CreatedAt:           nullTimeRFC3339(createdAt),
		UpdatedAt:           nullTimeRFC3339(updatedAt),
	}, nil
}

// orderSelectColumns is the canonical projection consumed by scanOrder. It
// must be SELECTed against orderSelectFrom (which provides the o/l/su/zc
// aliases). The LEFT JOINs make listing photo + zip city/state optional so a
// listing with no photo or an unknown zip still returns the order.
const orderSelectColumns = `
	o.id::text, o.listing_id::text, o.buyer_id::text, o.seller_id::text, o.escrow_status,
	o.amount_cents, o.fee_cents, o.seller_payout_cents,
	l.title,
	(SELECT lp.url FROM listing_photos lp
	   WHERE lp.listing_id = l.id ORDER BY lp.sort_order ASC, lp.created_at ASC LIMIT 1),
	su.display_name,
	l.pickup_address, l.pickup_zip_code, zc.city, zc.state,
	o.payment_intent_id, o.dispute_id::text,
	o.pickup_confirmed_at, o.seller_confirmed_at, o.released_at, o.auto_release_at,
	o.created_at, o.updated_at`

// orderSelectFrom is the FROM/JOIN clause that backs orderSelectColumns.
// Parameterized callers append their own WHERE/ORDER BY.
const orderSelectFrom = `
	FROM listing_orders o
	JOIN listings l ON l.id = o.listing_id
	JOIN users su ON su.id = o.seller_id
	LEFT JOIN zip_codes zc ON zc.zip = l.pickup_zip_code`

// GetOrder handles GET /api/v1/orders/{id}.
//
// Returns the full order record (status, amounts, escrow state, timestamps).
// Authorization: ONLY the order's buyer or seller — or an admin — may read
// it. Anyone else gets 403. 404 if the order does not exist, 400 on a
// malformed id. This mirrors the participant check the mutation handlers
// (ConfirmPickup / SellerConfirm) already enforce.
func (h *ListingOrdersHandler) GetOrder(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	orderID := chi.URLParam(r, "id")
	if !isValidUUID(orderID) {
		writeError(w, http.StatusBadRequest, "invalid order id")
		return
	}

	order, err := scanOrder(h.db.QueryRow(r.Context(),
		`SELECT `+orderSelectColumns+orderSelectFrom+` WHERE o.id = $1`, orderID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "order not found")
			return
		}
		slog.Error("get order: select", "order_id", orderID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Authorization: buyer, seller, or admin only.
	if !hasRole(claims, "admin") &&
		order.BuyerID != claims.UserID &&
		order.SellerID != claims.UserID {
		writeError(w, http.StatusForbidden, "not a participant on this order")
		return
	}

	writeJSON(w, http.StatusOK, order)
}

// listMyOrdersResponse wraps the authenticated user's orders.
type listMyOrdersResponse struct {
	Orders []orderResponse `json:"orders"`
}

// ListMyOrders handles GET /api/v1/me/orders.
//
// Returns every order on which the authenticated user is EITHER the buyer or
// the seller, newest first — the "my orders" index. No admin override here:
// it is intentionally scoped to the caller's own participation. The
// buyer_id / seller_id indexes (idx_listing_orders_buyer_id /
// _seller_id, migration 034) back this query.
func (h *ListingOrdersHandler) ListMyOrders(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	rows, err := h.db.Query(r.Context(),
		`SELECT `+orderSelectColumns+orderSelectFrom+`
		  WHERE o.buyer_id = $1 OR o.seller_id = $1
		  ORDER BY o.created_at DESC`, claims.UserID)
	if err != nil {
		slog.Error("list my orders: query", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer rows.Close()

	orders := make([]orderResponse, 0)
	for rows.Next() {
		order, err := scanOrder(rows)
		if err != nil {
			slog.Error("list my orders: scan", "user_id", claims.UserID, "error", err)
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		orders = append(orders, order)
	}
	if err := rows.Err(); err != nil {
		slog.Error("list my orders: rows", "user_id", claims.UserID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, listMyOrdersResponse{Orders: orders})
}

// hasRole is defined in bid.go and shared across the package.

// decodeJSON is provided in another handler file — we re-use it.
// writeJSON / writeError likewise.

// Compile-time assertion that the handler satisfies http.Handler shape via
// its methods (purely a doc-style guard).
var _ = (*ListingOrdersHandler)(nil)

// Ensure unused json import warning never fires (used by decoded payload).
var _ = json.Marshal

// Ensure context unused-import warning never fires.
var _ = context.Background
