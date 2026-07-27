package handler

// Bid bond pre-auth surface (Wave 4 — eBay/Whatnot ship this, we don't).
// First-time bidders post a Stripe SetupIntent-backed bond before their
// first bid is accepted; the bond is released the moment they complete OR
// lose the auction. Captured on confirmed no-show.
//
// Tied into placeBidTx by an early-return: when the bidder has zero
// 'released' history rows AND no 'authorized' bond covering ≥10% of the
// intended bid, the placement returns 402 with `requires_bid_bond: true`
// and a fresh SetupIntent client_secret. The web client renders Stripe
// Elements + retries the bid on confirm.
//
// Routes (registered in router.go):
//   POST /api/v1/listings/{id}/bid-bond           (auth)
//   POST /api/v1/listings/{id}/bid-bond/confirm   (auth)
//
// pending → authorized requires server-side confirmation from Stripe that
// the SetupIntent succeeded with a payment method attached; that PM id is
// persisted on bid_bonds.stripe_payment_method_id. The gate this bond waives
// is an anti-fraud control, so it fails closed: if the payment service cannot
// be reached, or succeeded without a PM, the bond stays pending.
//
// State machine (also documented in migration 043):
//   pending → authorized → captured (no-show forfeit, future cron)
//           → authorized → released (won + paid OR lost auction, future cron)
//           → cancelled  (auction cancelled / SetupIntent expired)

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// BidBondHandler exposes the SetupIntent flow + state-machine endpoints.
type BidBondHandler struct {
	db            *pgxpool.Pool
	paymentClient paymentv1.PaymentServiceClient
}

// NewBidBondHandler returns a handler. paymentClient may be nil — in that
// case the SetupIntent step is skipped (a sentinel client_secret is
// returned) so dev/sandbox stacks without Stripe still work.
func NewBidBondHandler(db *pgxpool.Pool, paymentClient paymentv1.PaymentServiceClient) *BidBondHandler {
	return &BidBondHandler{db: db, paymentClient: paymentClient}
}

// bidBondMinPercent is the percent of the intended bid that the bond must
// cover. eBay/Whatnot policy is in the 10–15% range; we anchor at 10%.
const bidBondMinPercent = 10

// bidBondMinCents is the floor — even small bids require a $5 bond so the
// bond actually deters no-shows.
const bidBondMinCents int64 = 500

// requiredBondCents computes the required bond for a given intended bid.
func requiredBondCents(intendedBidCents int64) int64 {
	bond := intendedBidCents * int64(bidBondMinPercent) / 100
	if bond < bidBondMinCents {
		bond = bidBondMinCents
	}
	return bond
}

// bidBondConfirmSoftReplayOutcome classifies ConfirmBidBond's durable path for
// an owned bond row. "replay" = already authorized (return 200); "confirm" =
// still pending (verify Stripe + CAS); "not_found" = terminal/unknown status.
// Extracted for unit tests so the soft-replay matrix cannot drift silently.
func bidBondConfirmSoftReplayOutcome(status string) string {
	switch status {
	case "authorized":
		return "replay"
	case "pending":
		return "confirm"
	default:
		return "not_found"
	}
}

// bidBondAuthorizedPaymentMethod resolves the PaymentMethod id to persist on
// pending→authorized. Stripe path requires a non-empty id from
// GetSetupIntentStatus (succeeded without a PM is not capturable — refuse).
// Dev nil-client short-circuit uses a stable sentinel so authorized rows still
// carry a non-NULL artifact for local stacks without Stripe.
// ok=false means the caller must 402 and leave the bond pending.
func bidBondAuthorizedPaymentMethod(bondID, stripePaymentMethodID string, devNilClient bool) (pmID string, ok bool) {
	if devNilClient {
		return "pm_dev_" + bondID, true
	}
	if stripePaymentMethodID == "" {
		return "", false
	}
	return stripePaymentMethodID, true
}

// releaseAuthorizedBidBondsForListing CAS-updates authorized → released for
// a listing. excludeUserID keeps the winner authorized until escrow funds
// (empty = release everyone, e.g. buy-now closeout of losers only when set
// to winner). Fail-soft: returns rows affected; errors are logged by callers.
func releaseAuthorizedBidBondsForListing(ctx context.Context, db *pgxpool.Pool, listingID, excludeUserID string) (int64, error) {
	if db == nil || listingID == "" {
		return 0, nil
	}
	if excludeUserID == "" {
		tag, err := db.Exec(ctx, `
			UPDATE bid_bonds
			   SET status = 'released', updated_at = now()
			 WHERE listing_id = $1 AND status = 'authorized'`,
			listingID,
		)
		if err != nil {
			return 0, err
		}
		return tag.RowsAffected(), nil
	}
	tag, err := db.Exec(ctx, `
		UPDATE bid_bonds
		   SET status = 'released', updated_at = now()
		 WHERE listing_id = $1
		   AND status = 'authorized'
		   AND user_id <> $2`,
		listingID, excludeUserID,
	)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// hasReleasedBond returns true if the user has at least one historical
// 'released' bid_bonds row — they're considered trusted and skip the
// pre-auth gate. Errors fall through to "treat as untrusted" (defensive).
func hasReleasedBond(ctx context.Context, db *pgxpool.Pool, userID string) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM bid_bonds
			 WHERE user_id = $1 AND status = 'released'
		)`, userID).Scan(&exists)
	return exists, err
}

// activeBondCovers returns true when the user has a non-stale 'authorized'
// bond row for this listing covering at least required cents.
func activeBondCovers(ctx context.Context, db *pgxpool.Pool, userID, listingID string, requiredCents int64) (bool, error) {
	var amount int64
	err := db.QueryRow(ctx, `
		SELECT amount_cents FROM bid_bonds
		 WHERE user_id = $1 AND listing_id = $2 AND status = 'authorized'
		 ORDER BY created_at DESC
		 LIMIT 1`, userID, listingID).Scan(&amount)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return amount >= requiredCents, nil
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shapes
// ─────────────────────────────────────────────────────────────────────────

type createBidBondRequest struct {
	IntendedBidCents int64 `json:"intended_bid_cents"`
}

type confirmBidBondRequest struct {
	BondID string `json:"bond_id"`
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/listings/{id}/bid-bond
// ─────────────────────────────────────────────────────────────────────────

// CreateBidBond mints a Stripe SetupIntent + a bid_bonds row in 'pending'.
// Returns the client_secret + bond_id; the web client confirms the
// SetupIntent via Stripe Elements, then POSTs to /confirm to flip the row
// to 'authorized'.
func (h *BidBondHandler) CreateBidBond(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	listingID := chi.URLParam(r, "id")
	if !isValidUUID(listingID) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}
	var req createBidBondRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.IntendedBidCents <= 0 {
		writeError(w, http.StatusBadRequest, "intended_bid_cents must be positive")
		return
	}

	// Verify the listing exists before minting a SetupIntent + bond row.
	// Without this, a bond on a bogus listing_id trips the
	// bid_bonds_listing_id_fkey FK (SQLSTATE 23503) and surfaces as a raw
	// 500. Map the missing-listing case to a clean 404 instead. Also reject
	// the seller posting a bond on their OWN listing (mirrors the bid /
	// offer seller-self checks) so sellers can't mint junk bonds +
	// SetupIntents against their own auctions.
	var listingSellerID string
	err := h.db.QueryRow(r.Context(),
		`SELECT seller_id::text FROM listings WHERE id = $1`, listingID,
	).Scan(&listingSellerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "bid-bond: listing lookup failed", "error", err, "listing_id", listingID)
		writeError(w, http.StatusInternalServerError, "failed to verify listing")
		return
	}
	if listingSellerID == claims.UserID {
		writeError(w, http.StatusForbidden, "sellers cannot post a bid bond on their own listing")
		return
	}

	bondCents := requiredBondCents(req.IntendedBidCents)

	// Durable SQL soft-replay (R2): same Idempotency-Key + user + listing
	// returns the prior bond without minting another SetupIntent. Middleware
	// Redis covers the happy path; this survives Redis loss / TTL.
	idempotencyKey := r.Header.Get("Idempotency-Key")
	if idempotencyKey != "" {
		var priorID, priorSecret string
		var priorAmount int64
		lookupErr := h.db.QueryRow(r.Context(), `
			SELECT id::text, stripe_pi_id, amount_cents
			  FROM bid_bonds
			 WHERE user_id = $1 AND listing_id = $2 AND idempotency_key = $3
			 LIMIT 1`,
			claims.UserID, listingID, idempotencyKey,
		).Scan(&priorID, &priorSecret, &priorAmount)
		switch {
		case lookupErr == nil:
			slog.InfoContext(r.Context(), "bid-bond create idempotency replay",
				"listing_id", listingID, "user_id", claims.UserID, "bond_id", priorID)
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"bond_id":                    priorID,
				"setup_intent_client_secret": priorSecret,
				"bond_amount_cents":          priorAmount,
				"idempotent_replay":          true,
			})
			return
		case errors.Is(lookupErr, pgx.ErrNoRows):
			// fall through to mint
		default:
			slog.ErrorContext(r.Context(), "bid-bond idempotency lookup failed",
				"error", lookupErr, "listing_id", listingID)
			writeError(w, http.StatusInternalServerError, "idempotency lookup failed")
			return
		}
	}

	// Mint the SetupIntent. If the payment service is not wired, fall back
	// to a sentinel client_secret so dev environments can still exercise
	// the flow end-to-end.
	clientSecret := ""
	if h.paymentClient != nil {
		resp, err := h.paymentClient.CreateSetupIntent(r.Context(), &paymentv1.CreateSetupIntentRequest{
			CustomerId: claims.UserID,
		})
		if err != nil {
			slog.ErrorContext(r.Context(), "bid-bond setup intent failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to create setup intent")
			return
		}
		clientSecret = resp.GetClientSecret()
	}
	if clientSecret == "" {
		// Dev fallback, used only when Stripe is not configured. /confirm
		// refuses to authorize a bond it cannot verify against Stripe unless
		// ENVIRONMENT=development, so this sentinel cannot reach production.
		clientSecret = "dev_bond_seti_" + claims.UserID
	}

	// Persist the bond row in 'pending'. stripe_pi_id is NOT NULL UNIQUE
	// in the schema, so we use the client_secret as a stable key — Stripe
	// SetupIntent client_secrets are unique per intent.
	// idempotency_key is optional for legacy clients; middleware requires it
	// on this money route so production always has a key.
	var bondID string
	var idemArg interface{}
	if idempotencyKey != "" {
		idemArg = idempotencyKey
	}
	err = h.db.QueryRow(r.Context(), `
		INSERT INTO bid_bonds (user_id, listing_id, stripe_pi_id, amount_cents, status, idempotency_key)
		VALUES ($1, $2, $3, $4, 'pending', $5)
		RETURNING id`,
		claims.UserID, listingID, clientSecret, bondCents, idemArg,
	).Scan(&bondID)
	if err != nil {
		// Concurrent create with same key: soft-replay prior row (may leave an
		// orphan SetupIntent — payment service treats extra seti as harmless).
		if idempotencyKey != "" {
			var priorID, priorSecret string
			var priorAmount int64
			if replayErr := h.db.QueryRow(r.Context(), `
				SELECT id::text, stripe_pi_id, amount_cents
				  FROM bid_bonds
				 WHERE user_id = $1 AND listing_id = $2 AND idempotency_key = $3
				 LIMIT 1`,
				claims.UserID, listingID, idempotencyKey,
			).Scan(&priorID, &priorSecret, &priorAmount); replayErr == nil {
				slog.InfoContext(r.Context(), "bid-bond create idempotency race replay",
					"listing_id", listingID, "user_id", claims.UserID, "bond_id", priorID)
				writeJSON(w, http.StatusOK, map[string]interface{}{
					"bond_id":                    priorID,
					"setup_intent_client_secret": priorSecret,
					"bond_amount_cents":          priorAmount,
					"idempotent_replay":          true,
				})
				return
			}
		}
		slog.ErrorContext(r.Context(), "bid-bond insert failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to record bond")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"bond_id":                    bondID,
		"setup_intent_client_secret": clientSecret,
		"bond_amount_cents":          bondCents,
	})
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/listings/{id}/bid-bond/confirm
// ─────────────────────────────────────────────────────────────────────────

// ConfirmBidBond flips the bond row from 'pending' to 'authorized' once
// Stripe confirms — server-side — that the SetupIntent actually succeeded and
// a payment method is attached. The bidder may then place the bid that
// triggered the bond.
//
// The client's word is not evidence. An earlier revision flipped the row on a
// bare POST carrying only bond_id, which meant any account could self-issue an
// 'authorized' bond with no card attached and permanently waive the
// requires_bid_bond gate on that auction (bidBondCheck in listings_bid.go).
// The bond exists to make a no-show cost something; a bond with nothing behind
// it is worse than no bond, because it reads as verified.
//
// Double-tap / Redis-miss soft-replay: if the bond is already 'authorized' for
// this (user, listing, bond_id), return 200 with the same success shape instead
// of 404. Concurrent first-confirm is still CAS on status='pending'.
//
// Future work (cron): release on win + payment OR lose auction; capture
// on confirmed no-show after pickup window expires.
func (h *BidBondHandler) ConfirmBidBond(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	listingID := chi.URLParam(r, "id")
	if !isValidUUID(listingID) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}
	var req confirmBidBondRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !isValidUUID(req.BondID) {
		writeError(w, http.StatusBadRequest, "invalid bond id")
		return
	}

	// Load the bond + SetupIntent secret. Ownership is enforced in the WHERE
	// clause. Soft-replay already-authorized bonds so double-tap confirm is
	// idempotent (Redis middleware may miss after TTL/flush).
	var clientSecret, bondStatus string
	err := h.db.QueryRow(r.Context(), `
		SELECT stripe_pi_id, status
		  FROM bid_bonds
		 WHERE id = $1
		   AND user_id = $2
		   AND listing_id = $3`,
		req.BondID, claims.UserID, listingID,
	).Scan(&clientSecret, &bondStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "bond not found or already finalized")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "bid-bond confirm lookup failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to confirm bond")
		return
	}
	switch bidBondConfirmSoftReplayOutcome(bondStatus) {
	case "replay":
		slog.InfoContext(r.Context(), "bid-bond confirm idempotency replay",
			"listing_id", listingID, "user_id", claims.UserID, "bond_id", req.BondID)
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"authorized":        true,
			"bond_id":           req.BondID,
			"idempotent_replay": true,
		})
		return
	case "confirm":
		// fall through to Stripe verify + CAS pending→authorized
	default:
		// captured / released / cancelled — not re-confirmable.
		writeError(w, http.StatusNotFound, "bond not found or already finalized")
		return
	}

	// Verify with Stripe. Fail closed: no payment client outside development
	// means we cannot verify, and an unverifiable bond must not be authorized.
	// On success we also require a non-empty payment_method_id so the authorized
	// row is capturable later (no-show forfeit). Soft-replay of already-
	// authorized bonds above leaves legacy NULL PMs alone.
	var paymentMethodID string
	if h.paymentClient == nil {
		if !isDevelopmentEnv() {
			slog.ErrorContext(r.Context(), "bid-bond confirm: payment service unavailable, refusing to authorize")
			writeError(w, http.StatusServiceUnavailable, "payment verification is unavailable, please try again shortly")
			return
		}
		slog.WarnContext(r.Context(), "bid-bond confirm: development short-circuit, no Stripe verification",
			"bond_id", req.BondID,
		)
		var ok bool
		paymentMethodID, ok = bidBondAuthorizedPaymentMethod(req.BondID, "", true)
		if !ok {
			// Defensive — dev sentinel path always returns ok.
			writeJSON(w, http.StatusPaymentRequired, map[string]interface{}{
				"requires_bid_bond": true,
				"error":             "your payment method has not been confirmed yet — please complete card setup and try again",
			})
			return
		}
	} else {
		resp, verr := h.paymentClient.GetSetupIntentStatus(r.Context(), &paymentv1.GetSetupIntentStatusRequest{
			ClientSecret: clientSecret,
			CustomerId:   claims.UserID,
		})
		if verr != nil {
			slog.ErrorContext(r.Context(), "bid-bond confirm: setup intent verification failed",
				"error", verr,
				"bond_id", req.BondID,
			)
			writeError(w, http.StatusServiceUnavailable, "could not verify your payment method, please try again shortly")
			return
		}
		if !resp.GetSucceeded() {
			// The card was never confirmed. 402 so the client re-opens Stripe
			// Elements rather than treating this as a permanent failure.
			writeJSON(w, http.StatusPaymentRequired, map[string]interface{}{
				"requires_bid_bond":   true,
				"setup_intent_status": resp.GetStatus(),
				"error":               "your payment method has not been confirmed yet — please complete card setup and try again",
			})
			return
		}
		// Succeeded but no PM attached — not capturable. Refuse with 402.
		var ok bool
		paymentMethodID, ok = bidBondAuthorizedPaymentMethod(req.BondID, resp.GetPaymentMethodId(), false)
		if !ok {
			slog.WarnContext(r.Context(), "bid-bond confirm: setup intent succeeded without payment method",
				"bond_id", req.BondID,
				"setup_intent_status", resp.GetStatus(),
			)
			writeJSON(w, http.StatusPaymentRequired, map[string]interface{}{
				"requires_bid_bond":   true,
				"setup_intent_status": resp.GetStatus(),
				"error":               "your payment method has not been confirmed yet — please complete card setup and try again",
			})
			return
		}
	}

	// Flip only from 'pending', so a concurrent confirm cannot double-apply.
	// Persist the capturable PaymentMethod id on the same CAS.
	var updatedID string
	err = h.db.QueryRow(r.Context(), `
		UPDATE bid_bonds
		   SET status = 'authorized',
		       stripe_payment_method_id = $4,
		       updated_at = now()
		 WHERE id = $1
		   AND user_id = $2
		   AND listing_id = $3
		   AND status = 'pending'
		 RETURNING id`,
		req.BondID, claims.UserID, listingID, paymentMethodID,
	).Scan(&updatedID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "bond not found or already finalized")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "bid-bond confirm failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to confirm bond")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"authorized": true,
		"bond_id":    updatedID,
	})
}
