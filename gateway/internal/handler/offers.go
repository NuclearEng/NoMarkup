package handler

// Best-Offer / counter-offer chain for the goods marketplace.
//
// Mounted under the auth-protected /api/v1 block. Routes:
//
//   POST   /api/v1/listings/{id}/offers     CreateOffer
//   GET    /api/v1/listings/{id}/offers     ListOffersForListing
//   PATCH  /api/v1/offers/{id}              UpdateOffer
//
// Why a thin pgx-backed handler: matches the rest of the goods-marketplace
// surface (see listings.go for rationale). Accepting an offer mints a
// listing_orders row in escrow_status='held' inside the same transaction
// as the listings.status='sold' flip, mirroring the buy-now closeout
// path in listings_bid.go::BuyItNow.
//
// PATCH actions:
//
//   accept     pending|countered → accepted   (also flips listing to 'sold'
//                                              and creates a listing_orders row)
//   reject     pending|countered → rejected
//   counter    pending|countered → countered  (creates a NEW pending offer
//                                              whose parent_offer_id points
//                                              back at this one)
//   withdraw   pending|countered → withdrawn  (buyer-only; pulls own offer)
//
// expires_at defaults to 24h after creation. Pending offers past expires_at
// are reaped lazily by the same scheduler that picks up auction-close.

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// OffersHandler exposes the Best-Offer surface.
type OffersHandler struct {
	db *pgxpool.Pool
}

// NewOffersHandler returns an OffersHandler. A nil db short-circuits every
// endpoint to a 503 (matches the rest of the marketplace handler family).
func NewOffersHandler(db *pgxpool.Pool) *OffersHandler {
	return &OffersHandler{db: db}
}

// ─────────────────────────────────────────────────────────────────────────
// JSON shapes — must mirror web/src/types/index.ts {Offer, OffersResponse}
// ─────────────────────────────────────────────────────────────────────────

type offerJSON struct {
	ID             string     `json:"id"`
	ListingID      string     `json:"listing_id"`
	BuyerID        string     `json:"buyer_id"`
	AmountCents    int64      `json:"amount_cents"`
	Status         string     `json:"status"`
	ParentOfferID  *string    `json:"parent_offer_id"`
	ExpiresAt      time.Time  `json:"expires_at"`
	Message        *string    `json:"message"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type createOfferRequest struct {
	AmountCents int64  `json:"amount_cents"`
	Message     string `json:"message"`
}

type updateOfferRequest struct {
	Action             string `json:"action"`
	CounterAmountCents int64  `json:"counter_amount_cents"`
	Message            string `json:"message"`
}

// offerExpiry — every new offer (and counter-offer) lives for 24h before
// the scheduled sweep marks it 'expired'. The window is intentionally
// short so listings don't sit indefinitely with a phantom offer pinning
// the seller in a holding pattern.
const offerExpiry = 24 * time.Hour

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/listings/{id}/offers — buyer creates an offer
// ─────────────────────────────────────────────────────────────────────────

// CreateOffer accepts a sub-asking offer for an active listing.
// Validates listing.status='active' AND buyer != seller. Returns the new
// offer row.
func (h *OffersHandler) CreateOffer(w http.ResponseWriter, r *http.Request) {
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
	var req createOfferRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.AmountCents <= 0 {
		writeError(w, http.StatusBadRequest, "amount_cents must be > 0")
		return
	}

	// Verify listing exists, is active, and the buyer is not the seller.
	var sellerID, status string
	err := h.db.QueryRow(r.Context(),
		`SELECT seller_id::text, status FROM listings WHERE id = $1`,
		listingID,
	).Scan(&sellerID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "create offer: listing lookup failed", "error", err, "listing_id", listingID)
		writeError(w, http.StatusInternalServerError, "failed to verify listing")
		return
	}
	if status != "active" {
		writeError(w, http.StatusConflict, "listing is not accepting offers")
		return
	}
	if sellerID == claims.UserID {
		writeError(w, http.StatusForbidden, "you cannot make an offer on your own listing")
		return
	}

	message := strings.TrimSpace(req.Message)
	var msgArg interface{}
	if message != "" {
		msgArg = message
	}

	expiresAt := time.Now().UTC().Add(offerExpiry)

	out := offerJSON{}
	var msg pgtype.Text
	var parent pgtype.Text
	err = h.db.QueryRow(r.Context(), `
		INSERT INTO listing_offers (
			listing_id, buyer_id, amount_cents, status, expires_at, message
		) VALUES ($1, $2, $3, 'pending', $4, $5)
		RETURNING id::text, listing_id::text, buyer_id::text,
		          amount_cents, status, parent_offer_id::text,
		          expires_at, message, created_at, updated_at`,
		listingID, claims.UserID, req.AmountCents, expiresAt, msgArg,
	).Scan(&out.ID, &out.ListingID, &out.BuyerID,
		&out.AmountCents, &out.Status, &parent,
		&out.ExpiresAt, &msg, &out.CreatedAt, &out.UpdatedAt)
	if err != nil {
		slog.ErrorContext(r.Context(), "create offer: insert failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create offer")
		return
	}
	if parent.Valid {
		s := parent.String
		out.ParentOfferID = &s
	}
	if msg.Valid {
		s := msg.String
		out.Message = &s
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{"offer": out})
}

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/listings/{id}/offers — list offers for a listing
// ─────────────────────────────────────────────────────────────────────────

// ListOffersForListing returns the offer history for a listing. Sellers
// see every offer; buyers see only the offers they created. Anyone else
// (including admins, who go through their own admin surface) gets 403.
func (h *OffersHandler) ListOffersForListing(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"offers": []offerJSON{}})
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

	// Look up the seller so we can decide what filter to apply.
	var sellerID string
	err := h.db.QueryRow(r.Context(),
		`SELECT seller_id::text FROM listings WHERE id = $1`,
		listingID,
	).Scan(&sellerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "list offers: listing lookup failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load listing")
		return
	}

	// Sellers see all offers; buyers see only their own.
	var rows pgx.Rows
	if sellerID == claims.UserID {
		rows, err = h.db.Query(r.Context(), `
			SELECT id::text, listing_id::text, buyer_id::text,
			       amount_cents, status, parent_offer_id::text,
			       expires_at, message, created_at, updated_at
			  FROM listing_offers
			 WHERE listing_id = $1
			 ORDER BY created_at DESC`, listingID)
	} else {
		rows, err = h.db.Query(r.Context(), `
			SELECT id::text, listing_id::text, buyer_id::text,
			       amount_cents, status, parent_offer_id::text,
			       expires_at, message, created_at, updated_at
			  FROM listing_offers
			 WHERE listing_id = $1 AND buyer_id = $2
			 ORDER BY created_at DESC`, listingID, claims.UserID)
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "list offers: query failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to load offers")
		return
	}
	defer rows.Close()

	out := make([]offerJSON, 0)
	for rows.Next() {
		var o offerJSON
		var parent pgtype.Text
		var msg pgtype.Text
		if err := rows.Scan(&o.ID, &o.ListingID, &o.BuyerID,
			&o.AmountCents, &o.Status, &parent,
			&o.ExpiresAt, &msg, &o.CreatedAt, &o.UpdatedAt); err != nil {
			slog.ErrorContext(r.Context(), "list offers: scan failed", "error", err)
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		if parent.Valid {
			s := parent.String
			o.ParentOfferID = &s
		}
		if msg.Valid {
			s := msg.String
			o.Message = &s
		}
		out = append(out, o)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"offers": out})
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/offers/{id} — accept | reject | counter | withdraw
// ─────────────────────────────────────────────────────────────────────────

// UpdateOffer dispatches an offer-state-machine action. Permissions:
//
//   accept | reject | counter   — seller only
//   withdraw                    — buyer only
//
// Accept flips the listing to 'sold' and mints a listing_orders row in
// escrow_status='held' atomically. Counter creates a new pending offer
// whose parent_offer_id points at the original; both rows live, with the
// original now in status='countered'.
func (h *OffersHandler) UpdateOffer(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	offerID := chi.URLParam(r, "id")
	if !isValidUUID(offerID) {
		writeError(w, http.StatusBadRequest, "invalid offer id")
		return
	}
	var req updateOfferRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	action := strings.ToLower(strings.TrimSpace(req.Action))
	switch action {
	case "accept", "reject", "counter", "withdraw":
		// ok
	default:
		writeError(w, http.StatusBadRequest, "action must be one of: accept, reject, counter, withdraw")
		return
	}

	// Pull the offer + parent listing in one round-trip so we can authorize
	// the action with full context. `depth` is the offer's distance from the
	// root of its counter-chain (root buyer offer = 0); we use its parity to
	// decide which participant the offer is currently awaiting.
	var (
		listingID    string
		buyerID      string
		sellerID     string
		amountCents  int64
		status       string
		listingState string
		depth        int
	)
	err := h.db.QueryRow(r.Context(), `
		WITH RECURSIVE chain AS (
			SELECT id, parent_offer_id, 0 AS depth
			  FROM listing_offers
			 WHERE id = $1
			UNION ALL
			SELECT p.id, p.parent_offer_id, c.depth + 1
			  FROM listing_offers p
			  JOIN chain c ON p.id = c.parent_offer_id
		)
		SELECT lo.listing_id::text, lo.buyer_id::text,
		       l.seller_id::text, lo.amount_cents,
		       lo.status, l.status,
		       (SELECT MAX(depth) FROM chain)
		  FROM listing_offers lo
		  JOIN listings l ON l.id = lo.listing_id
		 WHERE lo.id = $1`, offerID,
	).Scan(&listingID, &buyerID, &sellerID, &amountCents, &status, &listingState, &depth)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "offer not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "update offer: lookup failed", "error", err, "offer_id", offerID)
		writeError(w, http.StatusInternalServerError, "failed to load offer")
		return
	}

	// Determine who the offer is currently awaiting, and who authored it,
	// from the counter-chain depth parity.
	awaitingUserID, authorUserID := offerParticipantsForDepth(depth, buyerID, sellerID)

	// Only the two participants may act; everyone else (incl. admins, who
	// use their own surface) is forbidden.
	if claims.UserID != sellerID && claims.UserID != buyerID {
		writeError(w, http.StatusForbidden, "only the offer's buyer or seller can act on it")
		return
	}

	// Authorization keyed on who the offer is awaiting (not a fixed role),
	// so a seller's counter can be accepted/rejected/countered by the
	// buyer it now awaits — and vice-versa. withdraw is reserved for the
	// participant who authored the offer (pulling their own proposal).
	switch action {
	case "accept", "reject", "counter":
		if claims.UserID != awaitingUserID {
			writeError(w, http.StatusForbidden, "you cannot act on an offer that is not awaiting your response")
			return
		}
	case "withdraw":
		if claims.UserID != authorUserID {
			writeError(w, http.StatusForbidden, "only the participant who made this offer can withdraw it")
			return
		}
	}

	// Only pending or countered offers can transition. counter-on-counter
	// is allowed (seller counters the buyer's response — common dance).
	if status != "pending" && status != "countered" {
		writeError(w, http.StatusConflict, "offer is no longer pending")
		return
	}

	switch action {
	case "reject":
		if _, err := h.db.Exec(r.Context(),
			`UPDATE listing_offers SET status='rejected', updated_at=now() WHERE id=$1`,
			offerID,
		); err != nil {
			slog.ErrorContext(r.Context(), "reject offer failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to reject offer")
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"offer": h.loadOffer(r.Context(), offerID)})
		return

	case "withdraw":
		if _, err := h.db.Exec(r.Context(),
			`UPDATE listing_offers SET status='withdrawn', updated_at=now() WHERE id=$1`,
			offerID,
		); err != nil {
			slog.ErrorContext(r.Context(), "withdraw offer failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to withdraw offer")
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"offer": h.loadOffer(r.Context(), offerID)})
		return

	case "counter":
		if req.CounterAmountCents <= 0 {
			writeError(w, http.StatusBadRequest, "counter_amount_cents must be > 0")
			return
		}
		// Open a tx — we flip the original to 'countered' and INSERT the
		// new pending offer in one shot.
		tx, err := h.db.Begin(r.Context())
		if err != nil {
			slog.ErrorContext(r.Context(), "counter offer: begin tx failed", "error", err)
			writeError(w, http.StatusInternalServerError, "tx error")
			return
		}
		defer func() { _ = tx.Rollback(r.Context()) }()

		if _, err := tx.Exec(r.Context(),
			`UPDATE listing_offers SET status='countered', updated_at=now() WHERE id=$1`,
			offerID,
		); err != nil {
			slog.ErrorContext(r.Context(), "counter offer: parent flip failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to counter")
			return
		}

		message := strings.TrimSpace(req.Message)
		var msgArg interface{}
		if message != "" {
			msgArg = message
		}
		expiresAt := time.Now().UTC().Add(offerExpiry)

		// The counter-offer is FROM the seller. We keep buyer_id pointing
		// at the original buyer (so they can accept/withdraw); the parent
		// chain encodes the seller's response.
		var newID string
		if err := tx.QueryRow(r.Context(), `
			INSERT INTO listing_offers (
				listing_id, buyer_id, amount_cents, status, parent_offer_id, expires_at, message
			) VALUES ($1, $2, $3, 'pending', $4, $5, $6)
			RETURNING id::text`,
			listingID, buyerID, req.CounterAmountCents, offerID, expiresAt, msgArg,
		).Scan(&newID); err != nil {
			slog.ErrorContext(r.Context(), "counter offer: insert failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to counter")
			return
		}

		if err := tx.Commit(r.Context()); err != nil {
			slog.ErrorContext(r.Context(), "counter offer: commit failed", "error", err)
			writeError(w, http.StatusInternalServerError, "tx commit failed")
			return
		}

		writeJSON(w, http.StatusCreated, map[string]interface{}{
			"offer":          h.loadOffer(r.Context(), newID),
			"parent_offer":   h.loadOffer(r.Context(), offerID),
		})
		return

	case "accept":
		if listingState != "active" {
			writeError(w, http.StatusConflict, "listing is no longer active")
			return
		}
		// Atomic: flip offer → accepted, listing → sold, mint listing_orders.
		tx, err := h.db.Begin(r.Context())
		if err != nil {
			slog.ErrorContext(r.Context(), "accept offer: begin tx failed", "error", err)
			writeError(w, http.StatusInternalServerError, "tx error")
			return
		}
		defer func() { _ = tx.Rollback(r.Context()) }()

		if _, err := tx.Exec(r.Context(),
			`UPDATE listing_offers SET status='accepted', updated_at=now() WHERE id=$1`,
			offerID,
		); err != nil {
			slog.ErrorContext(r.Context(), "accept offer: flip offer failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to accept offer")
			return
		}

		if _, err := tx.Exec(r.Context(), `
			UPDATE listings
			   SET status='sold',
			       current_bid_cents=$2,
			       current_bidder_id=$3,
			       updated_at=now()
			 WHERE id=$1`,
			listingID, amountCents, buyerID,
		); err != nil {
			slog.ErrorContext(r.Context(), "accept offer: flip listing failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to close listing")
			return
		}

		// Reject all other still-pending offers on the same listing —
		// once one offer is accepted, the rest are dead.
		if _, err := tx.Exec(r.Context(), `
			UPDATE listing_offers
			   SET status='rejected', updated_at=now()
			 WHERE listing_id=$1 AND id<>$2 AND status IN ('pending','countered')`,
			listingID, offerID,
		); err != nil {
			slog.WarnContext(r.Context(), "accept offer: sibling reject failed (non-fatal)", "error", err)
		}

		// Mint the order — same shape as buy-now.
		var orderID string
		if err := tx.QueryRow(r.Context(), `
			INSERT INTO listing_orders (
				listing_id, seller_id, buyer_id,
				amount_cents, fee_cents, escrow_status
			) VALUES ($1, $2, $3, $4, 0, 'held')
			RETURNING id::text`,
			listingID, sellerID, buyerID, amountCents,
		).Scan(&orderID); err != nil {
			slog.ErrorContext(r.Context(), "accept offer: insert listing_orders failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to create order")
			return
		}

		if err := tx.Commit(r.Context()); err != nil {
			slog.ErrorContext(r.Context(), "accept offer: commit failed", "error", err)
			writeError(w, http.StatusInternalServerError, "tx commit failed")
			return
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"offer":    h.loadOffer(r.Context(), offerID),
			"order_id": orderID,
		})
		return
	}
}

// offerParticipantsForDepth derives, from a counter-chain depth, which
// participant the offer is currently awaiting and which participant
// authored it.
//
// The chain strictly alternates authorship:
//
//	depth 0 (root buyer offer) — authored by buyer,  awaiting SELLER
//	depth 1 (seller's counter) — authored by seller, awaiting BUYER
//	depth 2 (buyer's counter)  — authored by buyer,  awaiting SELLER
//	...
//
// so even depth → awaiting seller, odd depth → awaiting buyer; the author
// is always the other participant.
func offerParticipantsForDepth(depth int, buyerID, sellerID string) (awaitingUserID, authorUserID string) {
	if depth%2 == 1 {
		return buyerID, sellerID
	}
	return sellerID, buyerID
}

// loadOffer best-effort fetches a single offer row. Returns nil on any
// error (caller has already committed; the response is informational).
func (h *OffersHandler) loadOffer(ctx context.Context, id string) *offerJSON {
	var o offerJSON
	var parent pgtype.Text
	var msg pgtype.Text
	err := h.db.QueryRow(ctx, `
		SELECT id::text, listing_id::text, buyer_id::text,
		       amount_cents, status, parent_offer_id::text,
		       expires_at, message, created_at, updated_at
		  FROM listing_offers
		 WHERE id = $1`, id,
	).Scan(&o.ID, &o.ListingID, &o.BuyerID,
		&o.AmountCents, &o.Status, &parent,
		&o.ExpiresAt, &msg, &o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		slog.Warn("load offer failed", "error", err, "id", id)
		return nil
	}
	if parent.Valid {
		s := parent.String
		o.ParentOfferID = &s
	}
	if msg.Valid {
		s := msg.String
		o.Message = &s
	}
	return &o
}
