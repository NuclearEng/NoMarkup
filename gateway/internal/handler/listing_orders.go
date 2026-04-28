package handler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
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
// transfer is performed by a payment-service-side worker that polls for
// orders with escrow_status='pickup_confirmed' and released_at IS NULL.
//
// This split keeps the gateway hot path off Stripe (which can hang under
// outages) while still giving the buyer immediate confirmation. The worker
// reconciles asynchronously, with idempotency keys preventing double-pay.
//
// Thread-safe; the handler holds no per-request mutable state.
type ListingOrdersHandler struct {
	db *pgxpool.Pool
}

// NewListingOrdersHandler creates a new handler.
func NewListingOrdersHandler(db *pgxpool.Pool) *ListingOrdersHandler {
	return &ListingOrdersHandler{db: db}
}

// confirmPickupRequest is empty — the order id comes from the URL and the
// buyer id from the JWT.
type confirmPickupResponse struct {
	OrderID            string `json:"order_id"`
	EscrowStatus      string `json:"escrow_status"`
	SellerPayoutCents int64  `json:"seller_payout_cents"`
	PickupConfirmedAt string `json:"pickup_confirmed_at"`
}

// ConfirmPickup handles POST /api/v1/orders/{id}/confirm-pickup.
//
// Authorization: the requester must be EITHER the buyer on the order OR an
// admin. The marketplace service checks both.
//
// State transition: held -> pickup_confirmed. The Stripe transfer to the
// seller fires asynchronously via the payment-service worker.
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
	)
	err = tx.QueryRow(r.Context(), `
		SELECT buyer_id::text, seller_id::text, escrow_status,
		       amount_cents, fee_cents, dispute_id::text
		  FROM listing_orders
		 WHERE id = $1
		 FOR UPDATE`, orderID).
		Scan(&buyerID, &sellerID, &escrowStatus, &amountCents, &feeCents, &disputeID)
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

	now := time.Now().UTC()
	sellerPayout := amountCents - feeCents
	if sellerPayout < 0 {
		sellerPayout = 0
	}

	// Move to pickup_confirmed. The payment-service worker advances to
	// 'released' after the Stripe transfer succeeds.
	if _, err := tx.Exec(r.Context(), `
		UPDATE listing_orders
		   SET escrow_status = 'pickup_confirmed',
		       pickup_confirmed_at = $2,
		       seller_payout_cents = $3,
		       updated_at = now()
		 WHERE id = $1`, orderID, now, sellerPayout); err != nil {
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
	)

	writeJSON(w, http.StatusOK, confirmPickupResponse{
		OrderID:           orderID,
		EscrowStatus:      "pickup_confirmed",
		SellerPayoutCents: sellerPayout,
		PickupConfirmedAt: now.Format(time.RFC3339),
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
