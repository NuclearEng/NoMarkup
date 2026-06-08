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
		// Dev fallback. The /confirm endpoint accepts the bond_id
		// regardless of stripe_pi_id; this is only used when Stripe is
		// not configured.
		clientSecret = "dev_bond_seti_" + claims.UserID
	}

	// Persist the bond row in 'pending'. stripe_pi_id is NOT NULL UNIQUE
	// in the schema, so we use the client_secret as a stable key — Stripe
	// SetupIntent client_secrets are unique per intent.
	var bondID string
	err = h.db.QueryRow(r.Context(), `
		INSERT INTO bid_bonds (user_id, listing_id, stripe_pi_id, amount_cents, status)
		VALUES ($1, $2, $3, $4, 'pending')
		RETURNING id`,
		claims.UserID, listingID, clientSecret, bondCents,
	).Scan(&bondID)
	if err != nil {
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

// ConfirmBidBond flips the bond row from 'pending' to 'authorized' after
// the Stripe Elements client successfully confirms the SetupIntent. The
// bidder may now place the bid that triggered the bond.
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

	// Tag-team UPDATE: only flip when the user owns the bond, the listing
	// matches, and the row is currently 'pending'. Returns the row id so
	// we can detect no-op (not found / already authorized) vs success.
	var updatedID string
	err := h.db.QueryRow(r.Context(), `
		UPDATE bid_bonds
		   SET status = 'authorized', updated_at = now()
		 WHERE id = $1
		   AND user_id = $2
		   AND listing_id = $3
		   AND status = 'pending'
		 RETURNING id`,
		req.BondID, claims.UserID, listingID,
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
