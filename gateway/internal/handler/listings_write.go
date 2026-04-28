package handler

// Seller-side write paths for the goods marketplace.
//
// Read paths (anonymous browse) live in listings.go. Bid-placement +
// "my listings" / "my bids" live in listings_bid.go. This file owns
// the create / update / cancel / delete-draft surface called by the
// web client at web/src/hooks/useListings.ts:101-153.
//
// Routes (all auth-required, mounted inside the protected /api/v1
// group in router/router.go):
//
//   POST   /api/v1/listings              CreateListing
//   PATCH  /api/v1/listings/{id}         UpdateListing
//   POST   /api/v1/listings/{id}/cancel  CancelListing
//   DELETE /api/v1/listings/{id}         DeleteListingDraft
//
// All four mirror the transactional pgx pattern in listings_bid.go and
// return JSON shaped like `listingJSON` (see listings.go). On 4xx the
// body is `{ "error": "..." }` matching the rest of the gateway.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

// allowedListingDurations matches the CHECK constraint on
// listings.auction_duration_hours (24h, 48h, 7d).
var allowedListingDurations = map[int]struct{}{
	24:  {},
	48:  {},
	168: {},
}

// ─────────────────────────────────────────────────────────────────────────
// Request shapes — keep field names aligned with web/src/types/index.ts
// (CreateListingInput, UpdateListingInput).
// ─────────────────────────────────────────────────────────────────────────

type createListingRequest struct {
	CategoryID           string   `json:"category_id"`
	Title                string   `json:"title"`
	Description          string   `json:"description"`
	PhotoURLs            []string `json:"photo_urls"`
	PickupZip            string   `json:"pickup_zip"`
	PickupAddress        *string  `json:"pickup_address"`
	PickupLat            *float64 `json:"pickup_lat"`
	PickupLng            *float64 `json:"pickup_lng"`
	StartingPriceCents   int64    `json:"starting_price_cents"`
	AuctionDurationHours int      `json:"auction_duration_hours"`
	Publish              bool     `json:"publish"`
}

type updateListingRequest struct {
	Title                *string   `json:"title"`
	Description          *string   `json:"description"`
	PhotoURLs            *[]string `json:"photo_urls"`
	PickupZip            *string   `json:"pickup_zip"`
	PickupAddress        *string   `json:"pickup_address"`
	StartingPriceCents   *int64    `json:"starting_price_cents"`
	AuctionDurationHours *int      `json:"auction_duration_hours"`
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/listings — create
// ─────────────────────────────────────────────────────────────────────────

// CreateListing inserts a new listing + its photos in a single transaction.
//
// Validation rules (mirrors services/job/internal/repository/listing_repo.go):
//
//   - title non-empty
//   - category_id is a UUID and exists in service_categories
//   - starting_price_cents > 0
//   - auction_duration_hours ∈ {24, 48, 168}
//
// The `location` column is NOT NULL geometry(Point, 4326). When the client
// supplies pickup_lat/lng we use ST_SetSRID(ST_MakePoint(lng, lat), 4326);
// otherwise we fall back to ST_MakePoint(0, 0) — the seller can refine
// pickup coordinates via PATCH or by editing in the UI before publish.
// (We don't have a zip-code → centroid table in v1; the placeholder keeps
// the constraint satisfied without blocking listing creation.)
func (h *ListingsHandler) CreateListing(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}

	var req createListingRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// ── Validation ──────────────────────────────────────────────────
	title := strings.TrimSpace(req.Title)
	if title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	if !isValidUUID(req.CategoryID) {
		writeError(w, http.StatusBadRequest, "invalid category_id")
		return
	}
	if req.StartingPriceCents <= 0 {
		writeError(w, http.StatusBadRequest, "starting_price_cents must be positive")
		return
	}
	if _, ok := allowedListingDurations[req.AuctionDurationHours]; !ok {
		writeError(w, http.StatusBadRequest, "auction_duration_hours must be 24, 48, or 168")
		return
	}

	// Verify category exists. Cheap lookup; gives a clean 400 instead
	// of a foreign-key violation surfaced as a 500.
	var catExists bool
	if err := h.db.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM service_categories WHERE id = $1)`, req.CategoryID,
	).Scan(&catExists); err != nil {
		slog.ErrorContext(r.Context(), "create listing: category lookup failed", "error", err)
		writeError(w, http.StatusInternalServerError, "category lookup failed")
		return
	}
	if !catExists {
		writeError(w, http.StatusBadRequest, "unknown category_id")
		return
	}

	// ── Defaults / derived fields ───────────────────────────────────
	status := "draft"
	if req.Publish {
		status = "active"
	}
	endsAt := time.Now().Add(time.Duration(req.AuctionDurationHours) * time.Hour)

	pickupAddr := ""
	if req.PickupAddress != nil {
		pickupAddr = strings.TrimSpace(*req.PickupAddress)
	}

	// ST_MakePoint takes (lng, lat). Fall back to (0,0) if the client
	// didn't pin a pickup point; PATCH can refine before publish.
	lng, lat := 0.0, 0.0
	if req.PickupLng != nil {
		lng = *req.PickupLng
	}
	if req.PickupLat != nil {
		lat = *req.PickupLat
	}

	// ── Insert + photos in one transaction ──────────────────────────
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start tx")
		return
	}
	defer tx.Rollback(r.Context())

	var newID string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO listings (
			seller_id, title, description, category_id,
			location, pickup_address, pickup_zip_code,
			starting_price_cents, auction_duration_hours,
			auction_ends_at, original_auction_ends_at, status
		) VALUES (
			$1, $2, $3, $4,
			ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8,
			$9, $10,
			$11, $11, $12
		) RETURNING id`,
		claims.UserID, title, req.Description, req.CategoryID,
		lng, lat, pickupAddr, strings.TrimSpace(req.PickupZip),
		req.StartingPriceCents, req.AuctionDurationHours,
		endsAt, status,
	).Scan(&newID)
	if err != nil {
		slog.ErrorContext(r.Context(), "create listing insert failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to create listing")
		return
	}

	for i, url := range req.PhotoURLs {
		url = strings.TrimSpace(url)
		if url == "" {
			continue
		}
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO listing_photos (listing_id, url, sort_order) VALUES ($1, $2, $3)`,
			newID, url, i,
		); err != nil {
			slog.ErrorContext(r.Context(), "create listing photo failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to attach photo")
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.ErrorContext(r.Context(), "create listing commit failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to commit listing")
		return
	}

	listing, err := h.loadListingJSON(r.Context(), newID)
	if err != nil {
		slog.ErrorContext(r.Context(), "create listing post-load failed", "error", err, "id", newID)
		writeError(w, http.StatusInternalServerError, "listing created but reload failed")
		return
	}
	writeJSON(w, http.StatusCreated, listing)
}

// ─────────────────────────────────────────────────────────────────────────
// PATCH /api/v1/listings/{id} — update
// ─────────────────────────────────────────────────────────────────────────

// UpdateListing applies a partial update.
//
// Authorization: only the listing's seller may update.
//
// Lifecycle gates:
//
//   - Listing must currently be in 'draft' or 'active' status (sold /
//     cancelled / expired listings are immutable).
//   - Once the listing has any active bid, the price-and-terms fields
//     (title, description, starting_price_cents, auction_duration_hours)
//     are locked. Only benign edits (photos, pickup_address, pickup_zip)
//     are allowed.
func (h *ListingsHandler) UpdateListing(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	var req updateListingRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Validate fields that are being changed.
	if req.Title != nil && strings.TrimSpace(*req.Title) == "" {
		writeError(w, http.StatusBadRequest, "title cannot be empty")
		return
	}
	if req.StartingPriceCents != nil && *req.StartingPriceCents <= 0 {
		writeError(w, http.StatusBadRequest, "starting_price_cents must be positive")
		return
	}
	if req.AuctionDurationHours != nil {
		if _, ok := allowedListingDurations[*req.AuctionDurationHours]; !ok {
			writeError(w, http.StatusBadRequest, "auction_duration_hours must be 24, 48, or 168")
			return
		}
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start tx")
		return
	}
	defer tx.Rollback(r.Context())

	// Ownership + lifecycle check inside the same row lock that the
	// update will take, so concurrent edits are serialized.
	var sellerID, status string
	var bidCount int
	err = tx.QueryRow(r.Context(), `
		SELECT seller_id, status, COALESCE(bid_count, 0)
		  FROM listings WHERE id = $1 FOR UPDATE`, id,
	).Scan(&sellerID, &status, &bidCount)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "update listing: lock failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to load listing")
		return
	}
	if sellerID != claims.UserID {
		writeError(w, http.StatusForbidden, "only the seller may update this listing")
		return
	}
	if status != "draft" && status != "active" {
		writeError(w, http.StatusConflict, "cannot edit a listing in status "+status)
		return
	}
	if bidCount > 0 {
		// Price-and-terms fields are locked once bidding starts.
		if req.Title != nil || req.Description != nil ||
			req.StartingPriceCents != nil || req.AuctionDurationHours != nil {
			writeError(w, http.StatusConflict,
				"title, description, starting_price_cents, and auction_duration_hours are locked once bids exist")
			return
		}
	}

	// ── Build the dynamic UPDATE ────────────────────────────────────
	sets := make([]string, 0, 6)
	args := make([]interface{}, 0, 8)

	addSet := func(col string, val interface{}) {
		args = append(args, val)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
	}

	if req.Title != nil {
		addSet("title", strings.TrimSpace(*req.Title))
	}
	if req.Description != nil {
		addSet("description", *req.Description)
	}
	if req.PickupZip != nil {
		addSet("pickup_zip_code", strings.TrimSpace(*req.PickupZip))
	}
	if req.PickupAddress != nil {
		addSet("pickup_address", strings.TrimSpace(*req.PickupAddress))
	}
	if req.StartingPriceCents != nil {
		addSet("starting_price_cents", *req.StartingPriceCents)
	}
	if req.AuctionDurationHours != nil {
		// Reset auction_ends_at relative to now() when duration changes
		// on a draft. Once active, we preserve the original deadline
		// the buyers were expecting — guard above already blocks the
		// duration edit if there are bids; for an active no-bids
		// listing we still extend from now() so the seller's intent
		// is honored.
		newEnds := time.Now().Add(time.Duration(*req.AuctionDurationHours) * time.Hour)
		addSet("auction_duration_hours", *req.AuctionDurationHours)
		addSet("auction_ends_at", newEnds)
		if status == "draft" {
			addSet("original_auction_ends_at", newEnds)
		}
	}

	if len(sets) > 0 {
		args = append(args, id)
		query := "UPDATE listings SET " + strings.Join(sets, ", ") +
			", updated_at = now() WHERE id = $" + fmt.Sprintf("%d", len(args))
		if _, err := tx.Exec(r.Context(), query, args...); err != nil {
			slog.ErrorContext(r.Context(), "update listing exec failed", "error", err, "id", id)
			writeError(w, http.StatusInternalServerError, "failed to update listing")
			return
		}
	}

	// Replace photo set if provided. Wholesale replace is the simplest
	// correct semantics for an MVP — the client always sends the full
	// ordered list it wants.
	if req.PhotoURLs != nil {
		if _, err := tx.Exec(r.Context(),
			`DELETE FROM listing_photos WHERE listing_id = $1`, id,
		); err != nil {
			slog.ErrorContext(r.Context(), "update listing: photo delete failed", "error", err)
			writeError(w, http.StatusInternalServerError, "failed to replace photos")
			return
		}
		for i, url := range *req.PhotoURLs {
			url = strings.TrimSpace(url)
			if url == "" {
				continue
			}
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO listing_photos (listing_id, url, sort_order) VALUES ($1, $2, $3)`,
				id, url, i,
			); err != nil {
				slog.ErrorContext(r.Context(), "update listing: photo insert failed", "error", err)
				writeError(w, http.StatusInternalServerError, "failed to attach photo")
				return
			}
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.ErrorContext(r.Context(), "update listing commit failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to commit update")
		return
	}

	listing, err := h.loadListingJSON(r.Context(), id)
	if err != nil {
		slog.ErrorContext(r.Context(), "update listing post-load failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "listing updated but reload failed")
		return
	}
	writeJSON(w, http.StatusOK, listing)
}

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/listings/{id}/cancel — cancel
// ─────────────────────────────────────────────────────────────────────────

// CancelListing transitions a listing to status='cancelled'.
//
// Refuses to cancel a listing that has any active bids — once bidders
// have money on the line, the seller can't yank the auction. Sellers
// who genuinely need to back out hit /admin/listings/{id}/cancel via
// support, which has the privileged path.
func (h *ListingsHandler) CancelListing(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start tx")
		return
	}
	defer tx.Rollback(r.Context())

	var sellerID, status string
	var bidCount int
	err = tx.QueryRow(r.Context(), `
		SELECT seller_id, status, COALESCE(bid_count, 0)
		  FROM listings WHERE id = $1 FOR UPDATE`, id,
	).Scan(&sellerID, &status, &bidCount)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "cancel listing: lock failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to load listing")
		return
	}
	if sellerID != claims.UserID {
		writeError(w, http.StatusForbidden, "only the seller may cancel this listing")
		return
	}
	if status == "cancelled" {
		writeError(w, http.StatusConflict, "listing is already cancelled")
		return
	}
	if status == "sold" || status == "expired" {
		writeError(w, http.StatusConflict, "cannot cancel a "+status+" listing")
		return
	}

	// Block on active bids — the tightest gate that still lets sellers
	// kill drafts or zero-bid live listings.
	var activeBids int
	if err := tx.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM listing_bids WHERE listing_id = $1 AND status = 'active'`,
		id,
	).Scan(&activeBids); err != nil {
		slog.ErrorContext(r.Context(), "cancel listing: bid count failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to count bids")
		return
	}
	if activeBids > 0 {
		writeError(w, http.StatusConflict,
			"cannot cancel a listing with active bids — contact support to escalate")
		return
	}

	if _, err := tx.Exec(r.Context(),
		`UPDATE listings SET status = 'cancelled', updated_at = now() WHERE id = $1`,
		id,
	); err != nil {
		slog.ErrorContext(r.Context(), "cancel listing exec failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to cancel listing")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		slog.ErrorContext(r.Context(), "cancel listing commit failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to commit cancel")
		return
	}

	listing, err := h.loadListingJSON(r.Context(), id)
	if err != nil {
		slog.ErrorContext(r.Context(), "cancel listing post-load failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "listing cancelled but reload failed")
		return
	}
	writeJSON(w, http.StatusOK, listing)
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/listings/{id} — hard delete (drafts only)
// ─────────────────────────────────────────────────────────────────────────

// DeleteListingDraft hard-deletes a listing that is still in 'draft'.
// Cascades through listing_photos / listing_bids via FK ON DELETE CASCADE.
//
// Only drafts can be deleted. Active / sold / cancelled listings carry
// audit value (price discovery, dispute trail) and stay soft-statused.
func (h *ListingsHandler) DeleteListingDraft(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	if h.db == nil {
		writeError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	id := chi.URLParam(r, "id")
	if !isValidUUID(id) {
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start tx")
		return
	}
	defer tx.Rollback(r.Context())

	var sellerID, status string
	err = tx.QueryRow(r.Context(),
		`SELECT seller_id, status FROM listings WHERE id = $1 FOR UPDATE`, id,
	).Scan(&sellerID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "listing not found")
		return
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "delete draft: lock failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to load listing")
		return
	}
	if sellerID != claims.UserID {
		writeError(w, http.StatusForbidden, "only the seller may delete this listing")
		return
	}
	if status != "draft" {
		writeError(w, http.StatusConflict, "only draft listings may be deleted; cancel instead")
		return
	}

	if _, err := tx.Exec(r.Context(), `DELETE FROM listings WHERE id = $1`, id); err != nil {
		slog.ErrorContext(r.Context(), "delete draft exec failed", "error", err, "id", id)
		writeError(w, http.StatusInternalServerError, "failed to delete listing")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		slog.ErrorContext(r.Context(), "delete draft commit failed", "error", err)
		writeError(w, http.StatusInternalServerError, "failed to commit delete")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

// loadListingJSON re-reads a listing into the canonical listingJSON shape
// (the same shape ListListings / GetListing return in listings.go). Used
// by the create / update / cancel handlers to send back a fully hydrated
// representation, so the client doesn't have to refetch.
func (h *ListingsHandler) loadListingJSON(ctx context.Context, id string) (*listingJSON, error) {
	var l listingJSON
	var lat, lng pgtype.Float8
	var endsAt pgtype.Timestamptz
	var pickupCity, pickupState, pickupAddress sql.NullString
	err := h.db.QueryRow(ctx, `
		SELECT l.id, l.seller_id, l.category_id,
			COALESCE(c.name, ''), COALESCE(c.slug, ''),
			l.title, COALESCE(l.description, ''),
			l.status,
			l.pickup_zip_code,
			NULL::text, NULL::text,
			NULLIF(l.pickup_address, ''),
			ST_Y(l.location), ST_X(l.location),
			l.starting_price_cents,
			COALESCE(l.current_bid_cents, l.starting_price_cents),
			100::bigint,
			COALESCE((SELECT COUNT(DISTINCT bidder_id) FROM listing_bids WHERE listing_id = l.id), 0),
			COALESCE(l.bid_count, 0),
			l.auction_duration_hours, l.auction_ends_at,
			COALESCE(l.snipe_extension_count, 0),
			l.created_at, l.updated_at
		  FROM listings l
		  LEFT JOIN service_categories c ON c.id = l.category_id
		 WHERE l.id = $1`,
		id,
	).Scan(
		&l.ID, &l.SellerID, &l.CategoryID,
		&l.CategoryName, &l.CategorySlug,
		&l.Title, &l.Description,
		&l.Status,
		&l.PickupZip,
		&pickupCity, &pickupState, &pickupAddress,
		&lat, &lng,
		&l.StartingPriceCents, &l.CurrentBidCents, &l.MinIncrementCents,
		&l.BidderCount, &l.BidCount,
		&l.AuctionDurationHours, &endsAt,
		&l.SnipeExtensionCount,
		&l.CreatedAt, &l.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	if pickupCity.Valid {
		s := pickupCity.String
		l.PickupCity = &s
	}
	if pickupState.Valid {
		s := pickupState.String
		l.PickupState = &s
	}
	if pickupAddress.Valid {
		s := pickupAddress.String
		l.PickupAddress = &s
	}
	if lat.Valid {
		v := lat.Float64
		l.PickupLat = &v
	}
	if lng.Valid {
		v := lng.Float64
		l.PickupLng = &v
	}
	if endsAt.Valid {
		t := endsAt.Time
		l.AuctionEndsAt = &t
	}
	if photoMap, perr := h.fetchPhotosForListings(ctx, []string{id}); perr == nil {
		l.Photos = photoMap[id]
	}
	if l.Photos == nil {
		l.Photos = []listingPhotoJSON{}
	}
	return &l, nil
}
