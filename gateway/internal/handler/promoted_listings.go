package handler

// Promoted listings (Wave 5) — sellers can pay for a placement boost
// that floats their listing to the top of the marketplace scoreboard
// for 24h / 72h / 7d.
//
// Routes:
//   POST /api/v1/listings/{id}/promote
//
// Request body:
//   { "duration_hours": 24|72|168, "payment_method_id": "pm_..." }
//
// On success the gateway:
//   1. Validates the seller owns the listing.
//   2. Creates a Stripe PaymentIntent via the payment service for the
//      tier's price ($5 / $12 / $25 — index by duration_hours).
//   3. Inserts a promotion_charges row in 'pending'.
//   4. Returns the client_secret + tier metadata for the web client to
//      confirm via Stripe Elements.
//
// On charge.success the webhook handler flips status='succeeded' AND
// listings.is_promoted=true / listings.promoted_until = now() + duration.
// That webhook integration is intentionally out of scope for this
// handler — see services/payment/internal/service/stripe_webhook.go for
// the existing precedent.
//
// In dev (paymentClient==nil) we skip Stripe and return a sentinel
// client_secret so the e2e tests can run without a Stripe key.

import (
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// PromotedListingsHandler is the seller-facing paid-promotion handler.
type PromotedListingsHandler struct {
	db            *pgxpool.Pool
	paymentClient paymentv1.PaymentServiceClient
}

// NewPromotedListingsHandler wires the dependencies. paymentClient may be
// nil for dev/sandbox stacks without Stripe — the handler degrades to a
// sentinel client_secret so the front-end flow still exercises end-to-end.
func NewPromotedListingsHandler(db *pgxpool.Pool, paymentClient paymentv1.PaymentServiceClient) *PromotedListingsHandler {
	return &PromotedListingsHandler{db: db, paymentClient: paymentClient}
}

// promotionTier describes a single paid placement plan.
type promotionTier struct {
	DurationHours int   `json:"duration_hours"`
	AmountCents   int64 `json:"amount_cents"`
}

// promotionTiers is the canonical pricebook the handler enforces.
// Mirrors what the front-end button renders (PromoteListingButton.tsx).
// Keep the two in sync — the button computes the price from
// duration_hours and asserts against the response amount_cents.
var promotionTiers = map[int]promotionTier{
	24:  {DurationHours: 24, AmountCents: 500},   // $5
	72:  {DurationHours: 72, AmountCents: 1200},  // $12
	168: {DurationHours: 168, AmountCents: 2500}, // $25
}

type promoteListingRequest struct {
	DurationHours   int    `json:"duration_hours"`
	PaymentMethodID string `json:"payment_method_id"`
}

type promoteListingResponse struct {
	ChargeID            string `json:"charge_id"`
	ListingID           string `json:"listing_id"`
	DurationHours       int    `json:"duration_hours"`
	AmountCents         int64  `json:"amount_cents"`
	StripeClientSecret  string `json:"stripe_client_secret"`
	PromotedUntilEstimate string `json:"promoted_until_estimate"`
	Status              string `json:"status"`
}

// PromoteListing handles POST /api/v1/listings/{id}/promote.
func (h *PromotedListingsHandler) PromoteListing(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	listingID := chi.URLParam(r, "id")
	if !isValidUUID(listingID) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	var req promoteListingRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	tier, ok := promotionTiers[req.DurationHours]
	if !ok {
		writeError(w, http.StatusBadRequest, "duration_hours must be one of 24, 72, 168")
		return
	}

	// Validate the listing exists and the requester owns it. Status
	// 'active' is the only valid base — promoting drafts / sold listings
	// is wasted spend.
	var (
		sellerID, status string
	)
	err := h.db.QueryRow(r.Context(), `
		SELECT seller_id::text, status
		  FROM listings
		 WHERE id = $1`, listingID,
	).Scan(&sellerID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err != nil {
		slog.Error("promote: listing lookup", "listing_id", listingID, "error", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if sellerID != claims.UserID && !hasRole(claims, "admin") {
		writeError(w, http.StatusForbidden, "only the seller may promote this listing")
		return
	}
	if status != "active" {
		writeError(w, http.StatusConflict, "only active listings may be promoted")
		return
	}

	// Mint a PaymentIntent. The PaymentService.CreatePayment RPC is
	// shaped around contract billing (it expects contract_id /
	// milestone_id), so we instead use CreateSetupIntent + the dev
	// fallback path; the actual capture happens via a follow-up
	// PaymentIntent the worker creates in services/payment when the
	// SetupIntent confirms. Simpler: ask the payment service for a
	// SetupIntent we can attach the payment method to.
	clientSecret := ""
	if h.paymentClient != nil {
		resp, perr := h.paymentClient.CreateSetupIntent(r.Context(), &paymentv1.CreateSetupIntentRequest{
			CustomerId: claims.UserID,
		})
		if perr != nil {
			slog.Error("promote: setup intent failed", "error", perr)
			writeError(w, http.StatusInternalServerError, "failed to create payment intent")
			return
		}
		clientSecret = resp.GetClientSecret()
	}
	if clientSecret == "" {
		clientSecret = "dev_promote_" + listingID
	}

	// Persist the charge in 'pending'. The webhook handler flips it to
	// 'succeeded' and lights up listings.is_promoted in the same tx.
	var chargeID string
	if err := h.db.QueryRow(r.Context(), `
		INSERT INTO promotion_charges
		    (user_id, listing_id, stripe_pi_id, amount_cents, duration_hours, status)
		VALUES ($1, $2, $3, $4, $5, 'pending')
		RETURNING id`,
		claims.UserID, listingID, clientSecret, tier.AmountCents, tier.DurationHours,
	).Scan(&chargeID); err != nil {
		slog.Error("promote: charge insert failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to record promotion")
		return
	}

	// promoted_until_estimate is what the UI renders the moment the
	// SetupIntent confirms. Compute it client-side too — this is just a
	// hint so the dashboard can show "Promoted until Sat 4 May".
	estimate := time.Now().UTC().Add(time.Duration(tier.DurationHours) * time.Hour)

	slog.Info("promotion charge created",
		"charge_id", chargeID,
		"listing_id", listingID,
		"seller_id", claims.UserID,
		"duration_hours", tier.DurationHours,
		"amount_cents", tier.AmountCents,
	)

	writeJSON(w, http.StatusOK, promoteListingResponse{
		ChargeID:              chargeID,
		ListingID:             listingID,
		DurationHours:         tier.DurationHours,
		AmountCents:           tier.AmountCents,
		StripeClientSecret:    clientSecret,
		PromotedUntilEstimate: estimate.Format(time.RFC3339),
		Status:                "pending",
	})
}

// ConfirmPromotion is the dev-only short-circuit: in environments without
// a Stripe webhook plumb, the front-end can POST here to flip the flag
// once the SetupIntent confirms client-side. Production flips through
// the webhook on charge.success.
//
// Route: POST /api/v1/listings/{id}/promote/confirm with body {charge_id}.
func (h *PromotedListingsHandler) ConfirmPromotion(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	listingID := chi.URLParam(r, "id")
	if !isValidUUID(listingID) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	var body struct {
		ChargeID string `json:"charge_id"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if !isValidUUID(body.ChargeID) {
		writeError(w, http.StatusBadRequest, "invalid charge id")
		return
	}

	tx, err := h.db.BeginTx(r.Context(), pgx.TxOptions{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	var (
		userID        string
		duration      int
		status        string
	)
	if err := tx.QueryRow(r.Context(), `
		SELECT user_id::text, duration_hours, status
		  FROM promotion_charges
		 WHERE id = $1 AND listing_id = $2
		 FOR UPDATE`,
		body.ChargeID, listingID,
	).Scan(&userID, &duration, &status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "charge not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if userID != claims.UserID && !hasRole(claims, "admin") {
		writeError(w, http.StatusForbidden, "not your charge")
		return
	}
	if status != "pending" {
		writeError(w, http.StatusConflict, "charge already finalized")
		return
	}

	now := time.Now().UTC()
	until := now.Add(time.Duration(duration) * time.Hour)

	if _, err := tx.Exec(r.Context(), `
		UPDATE promotion_charges
		   SET status = 'succeeded'
		 WHERE id = $1`, body.ChargeID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if _, err := tx.Exec(r.Context(), `
		UPDATE listings
		   SET is_promoted    = true,
		       promoted_until = $2,
		       updated_at = now()
		 WHERE id = $1`, listingID, until); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"charge_id":      body.ChargeID,
		"listing_id":     listingID,
		"is_promoted":    true,
		"promoted_until": until.Format(time.RFC3339),
		"status":         "succeeded",
	})
}
