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
//   2. Creates a Stripe SetupIntent via the payment service so the seller
//      can save a card.
//   3. Inserts a promotion_charges row in 'pending'.
//   4. Returns the client_secret + tier metadata for the web client to
//      confirm via Stripe Elements.
//
// The boost is granted by POST .../promote/confirm, which charges the
// tier price off-session against the saved card and flips
// status='succeeded' / listings.is_promoted=true only when Stripe reports
// the charge succeeded. Nothing activates a promotion without money having
// moved — see ConfirmPromotion below for the full rationale.
//
// In dev (paymentClient==nil AND ENVIRONMENT=development) we skip Stripe and
// return a sentinel client_secret so the e2e tests can run without a Stripe
// key. Outside development a missing payment client is fatal to the confirm
// path rather than a bypass.

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

// ConfirmPromotion collects the promotion fee and, only if the charge
// succeeds, lights up the placement boost.
//
// An earlier revision flipped promotion_charges.status='succeeded' and
// listings.is_promoted=true on a bare authenticated POST, deferring the
// actual charge to an out-of-band Stripe event handler that was never
// implemented — and PromoteListing minted a SetupIntent ($0, save-a-card),
// not a PaymentIntent, so no charge existed to succeed. Any seller could
// grant themselves an unlimited number of paid promotions for free and leave
// the revenue ledger asserting they had paid.
//
// The amount charged is read from the server-side pricebook keyed on the
// duration stored on the charge row — never from the request body — and the
// row id is used as the Stripe idempotency key so a retried or concurrent
// confirm collapses onto one charge.
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

	// Read the charge outside the write transaction: the Stripe call below
	// is a network round-trip and must not be made while holding a row lock.
	var (
		userID       string
		duration     int
		status       string
		clientSecret string
	)
	if err := h.db.QueryRow(r.Context(), `
		SELECT user_id::text, duration_hours, status, stripe_pi_id
		  FROM promotion_charges
		 WHERE id = $1 AND listing_id = $2`,
		body.ChargeID, listingID,
	).Scan(&userID, &duration, &status, &clientSecret); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "charge not found")
			return
		}
		slog.Error("promote confirm: charge lookup failed", "error", err, "charge_id", body.ChargeID)
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

	// Price comes from the server-side pricebook, keyed on the duration
	// persisted at promote time. The client never supplies an amount.
	tier, ok := promotionTiers[duration]
	if !ok {
		slog.Error("promote confirm: charge has an unknown duration tier",
			"charge_id", body.ChargeID,
			"duration_hours", duration,
		)
		writeError(w, http.StatusConflict, "this promotion can no longer be confirmed, please start a new one")
		return
	}

	// Collect the fee. Fail closed: outside development, no payment client
	// means we cannot charge, and an uncharged promotion must not activate.
	if h.paymentClient == nil {
		if !isDevelopmentEnv() {
			slog.Error("promote confirm: payment service unavailable, refusing to activate promotion",
				"charge_id", body.ChargeID,
			)
			writeError(w, http.StatusServiceUnavailable, "payments are temporarily unavailable, please try again shortly")
			return
		}
		slog.Warn("promote confirm: development short-circuit, no charge collected",
			"charge_id", body.ChargeID,
		)
	} else {
		resp, cerr := h.paymentClient.ChargePromotion(r.Context(), &paymentv1.ChargePromotionRequest{
			CustomerId:     claims.UserID,
			ClientSecret:   clientSecret,
			AmountCents:    tier.AmountCents,
			IdempotencyKey: body.ChargeID,
			ListingId:      listingID,
		})
		if cerr != nil {
			slog.Error("promote confirm: charge failed", "error", cerr, "charge_id", body.ChargeID)
			// Record the failure so the row does not sit in 'pending' forever
			// and the seller can start a fresh promotion.
			if _, uerr := h.db.Exec(r.Context(),
				`UPDATE promotion_charges SET status = 'failed' WHERE id = $1 AND status = 'pending'`,
				body.ChargeID,
			); uerr != nil {
				slog.Error("promote confirm: failed to mark charge failed", "error", uerr, "charge_id", body.ChargeID)
			}
			writeError(w, http.StatusPaymentRequired, "we could not complete the payment for this promotion")
			return
		}
		if !resp.GetSucceeded() {
			writeJSON(w, http.StatusPaymentRequired, map[string]interface{}{
				"requires_payment_method": true,
				"status":                  resp.GetStatus(),
				"error":                   "your card has not been confirmed yet — please complete card setup and try again",
			})
			return
		}
	}

	tx, err := h.db.BeginTx(r.Context(), pgx.TxOptions{})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	now := time.Now().UTC()
	until := now.Add(time.Duration(duration) * time.Hour)

	// Re-assert 'pending' inside the transaction. A concurrent confirm that
	// won the race already activated the promotion; the Stripe idempotency
	// key means it collected the fee exactly once, and this one is a no-op.
	var finalized string
	if err := tx.QueryRow(r.Context(), `
		UPDATE promotion_charges
		   SET status = 'succeeded'
		 WHERE id = $1 AND status = 'pending'
		 RETURNING id`, body.ChargeID).Scan(&finalized); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusConflict, "charge already finalized")
			return
		}
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
