package handler

// Buyer-side and seller-side write paths for the goods marketplace.
// Read paths live in listings.go; this file is the bid placement loop +
// "my listings" + create-listing surface.
//
// All routes here require an authenticated user. Bid placement broadcasts
// a `listing:{id}` Redis event consumed by the marketplace spectator
// WebSocket (gateway/internal/handler/marketplace_spectator_ws.go).
//
// Why direct SQL in the gateway: the job service does not yet expose a
// gRPC listing surface (the proto exists but no server impl). The
// transactional bid placement here mirrors the reference implementation
// in services/job/internal/repository/listing_repo.go (FOR UPDATE on the
// listings row + insert into listing_bids + atomic counter update).

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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nomarkup/nomarkup/gateway/internal/middleware"
)

const (
	// snipeWindow: bids placed within this much of the deadline trigger
	// a snipe extension. Matches services/job repo behavior.
	listingSnipeWindow = 60 * time.Second

	// snipeExtension: how much time the auction is bumped on a snipe.
	listingSnipeExtension = 30 * time.Second

	// minBidIncrement: smallest legal increment over the current high bid.
	listingMinIncrementCents int64 = 100
)

type placeListingBidRequest struct {
	AmountCents int64 `json:"amount_cents"`
}

// PlaceListingBid handles POST /api/v1/listings/{id}/bid.
//
// Concurrency safety: SELECT … FOR UPDATE on the listings row serializes
// concurrent bids on the same auction. The increment check happens AFTER
// the lock is acquired so racing bids are forced to compare against a
// committed current_bid_cents.
func (h *ListingsHandler) PlaceListingBid(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusBadRequest, "invalid listing id")
		return
	}

	var req placeListingBidRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.AmountCents <= 0 {
		writeError(w, http.StatusBadRequest, "amount_cents must be positive")
		return
	}

	bid, current, bidderCount, snipe, newEnds, errCode, errMsg := h.placeBidTx(
		r.Context(), id, claims.UserID, req.AmountCents,
	)
	if errCode != 0 {
		writeError(w, errCode, errMsg)
		return
	}

	// Publish to spectator stream. Best-effort — bid is already committed.
	h.publishBidPlaced(r.Context(), id, claims.UserID, req.AmountCents, snipe, newEnds)

	slog.InfoContext(r.Context(), "listing bid placed",
		"listing_id", id,
		"bidder_id", claims.UserID,
		"amount_cents", req.AmountCents,
		"snipe_extension", snipe,
	)

	resp := map[string]interface{}{
		"bid": bid,
		"current_bid_cents":      current,
		"bidder_count":           bidderCount,
		"snipe_extension_applied": snipe,
		"new_auction_ends_at":     formatRFC3339OrNull(newEnds),
	}
	writeJSON(w, http.StatusCreated, resp)
}

// placeBidTx runs the bid placement inside a transaction. Returns the
// new ListingBid JSON, the new current_bid_cents, the new bidder count,
// snipe-applied flag, and the (possibly extended) auction end time.
//
// On validation failure, returns errCode != 0 and an errMsg suitable for
// the user.
func (h *ListingsHandler) placeBidTx(ctx context.Context, listingID, bidderID string, amountCents int64) (
	bid listingBidJSON, currentCents int64, bidderCount int, snipeApplied bool, newEnds time.Time, errCode int, errMsg string,
) {
	tx, err := h.db.Begin(ctx)
	if err != nil {
		return bid, 0, 0, false, time.Time{}, http.StatusInternalServerError, "failed to start tx"
	}
	defer tx.Rollback(ctx)

	var (
		sellerID         string
		status           string
		startCents       int64
		currentBidCents  pgtype.Int8
		minIncrement     pgtype.Int8
		auctionEndsAt    pgtype.Timestamptz
		snipeCount       int
	)
	err = tx.QueryRow(ctx, `
		SELECT seller_id, status, starting_price_cents,
			current_bid_cents,
			auction_ends_at, COALESCE(snipe_extension_count, 0)
		  FROM listings WHERE id = $1 FOR UPDATE`, listingID,
	).Scan(&sellerID, &status, &startCents, &currentBidCents,
		&auctionEndsAt, &snipeCount)
	_ = minIncrement // legacy schema does not yet have a per-listing column
	if errors.Is(err, pgx.ErrNoRows) {
		return bid, 0, 0, false, time.Time{}, http.StatusNotFound, "listing not found"
	}
	if err != nil {
		slog.ErrorContext(ctx, "place bid: select for update failed", "error", err, "listing_id", listingID)
		return bid, 0, 0, false, time.Time{}, http.StatusInternalServerError, "failed to lock listing"
	}

	if sellerID == bidderID {
		return bid, 0, 0, false, time.Time{}, http.StatusForbidden, "sellers cannot bid on their own listing"
	}
	if status != "active" {
		return bid, 0, 0, false, time.Time{}, http.StatusConflict, "auction is not active"
	}
	if !auctionEndsAt.Valid || auctionEndsAt.Time.Before(time.Now()) {
		return bid, 0, 0, false, time.Time{}, http.StatusConflict, "auction has ended"
	}

	// Increment validation.
	prevCents := startCents
	if currentBidCents.Valid {
		prevCents = currentBidCents.Int64
	}
	inc := listingMinIncrementCents
	required := startCents
	if currentBidCents.Valid {
		required = prevCents + inc
	}
	if amountCents < required {
		return bid, prevCents, 0, false, auctionEndsAt.Time,
			http.StatusBadRequest,
			fmt.Sprintf("bid must be at least %d cents", required)
	}

	// Snipe extension: if we're inside the window, bump the deadline.
	now := time.Now()
	endsAt := auctionEndsAt.Time
	snipeApplied = false
	if endsAt.Sub(now) <= listingSnipeWindow {
		endsAt = endsAt.Add(listingSnipeExtension)
		snipeApplied = true
		snipeCount++
	}

	// Demote the previous high bid (if any).
	if currentBidCents.Valid {
		if _, err := tx.Exec(ctx, `
			UPDATE listing_bids SET status='outbid', updated_at=now()
			 WHERE listing_id=$1 AND status='active'`, listingID); err != nil {
			slog.ErrorContext(ctx, "place bid: demote outbid failed", "error", err)
			return bid, 0, 0, false, time.Time{}, http.StatusInternalServerError, "demote failed"
		}
	}

	var newBidID string
	var bidCreatedAt time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO listing_bids (listing_id, bidder_id, amount_cents, status, created_at, updated_at)
		VALUES ($1, $2, $3, 'active', now(), now())
		RETURNING id, created_at`,
		listingID, bidderID, amountCents,
	).Scan(&newBidID, &bidCreatedAt); err != nil {
		slog.ErrorContext(ctx, "place bid: insert bid failed", "error", err)
		return bid, 0, 0, false, time.Time{}, http.StatusInternalServerError, "insert bid failed"
	}

	if _, err := tx.Exec(ctx, `
		UPDATE listings
		   SET current_bid_cents=$2, current_bidder_id=$3,
		       bid_count=COALESCE(bid_count,0)+1,
		       auction_ends_at=$4, snipe_extension_count=$5,
		       updated_at=now()
		 WHERE id=$1`,
		listingID, amountCents, bidderID, endsAt, snipeCount,
	); err != nil {
		slog.ErrorContext(ctx, "place bid: update listing failed", "error", err)
		return bid, 0, 0, false, time.Time{}, http.StatusInternalServerError, "update listing failed"
	}

	// Get bidder display name for the response.
	var displayName sql.NullString
	if err := tx.QueryRow(ctx,
		`SELECT display_name FROM users WHERE id=$1`, bidderID,
	).Scan(&displayName); err != nil {
		// Non-fatal — fall back to "Bidder".
		displayName = sql.NullString{String: "Bidder", Valid: true}
	}

	// Refresh bidder count.
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(DISTINCT bidder_id) FROM listing_bids WHERE listing_id=$1`,
		listingID).Scan(&bidderCount); err != nil {
		bidderCount = 0
	}

	if err := tx.Commit(ctx); err != nil {
		slog.ErrorContext(ctx, "place bid: commit failed", "error", err)
		return bid, 0, 0, false, time.Time{}, http.StatusInternalServerError, "commit failed"
	}

	bid = listingBidJSON{
		ID:                newBidID,
		ListingID:         listingID,
		BidderID:          bidderID,
		BidderDisplayName: displayName.String,
		AmountCents:       amountCents,
		IsWinning:         true,
		CreatedAt:         bidCreatedAt,
	}
	return bid, amountCents, bidderCount, snipeApplied, endsAt, 0, ""
}

// publishBidPlaced fires the spectator-stream event. Best-effort.
func (h *ListingsHandler) publishBidPlaced(ctx context.Context, listingID, bidderID string, amountCents int64, snipe bool, newEnds time.Time) {
	rdb := h.redisClient()
	if rdb == nil {
		return
	}
	payload := map[string]interface{}{
		"type":                "bid_placed",
		"listing_id":          listingID,
		"bidder_id":           bidderID,
		"amount_cents":        amountCents,
		"snipe_extension":     snipe,
		"new_auction_ends_at": newEnds.UTC().Format(time.RFC3339),
		"timestamp":           time.Now().UTC().Format(time.RFC3339Nano),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	channel := fmt.Sprintf("listing:%s", listingID)
	if err := rdb.Publish(ctx, channel, data).Err(); err != nil {
		slog.WarnContext(ctx, "publish bid_placed failed",
			"listing_id", listingID, "error", err)
	}
}

func formatRFC3339OrNull(t time.Time) interface{} {
	if t.IsZero() {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

// MyListings handles GET /api/v1/listings/me — seller's own listings.
func (h *ListingsHandler) MyListings(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"listings":   []listingJSON{},
			"pagination": pageMeta(1, 0, 0),
		})
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	q := r.URL.Query()
	page, pageSize := parseDirectPagination(q, 1, 20, 100)

	statusFilter := q.Get("status")
	args := []interface{}{claims.UserID}
	where := "l.seller_id = $1"
	if statusFilter != "" {
		args = append(args, statusFilter)
		where += " AND l.status = $2"
	}

	var total int
	if err := h.db.QueryRow(r.Context(),
		"SELECT COUNT(*) FROM listings l WHERE "+where, args...).Scan(&total); err != nil {
		writeError(w, http.StatusInternalServerError, "count failed")
		return
	}
	args = append(args, pageSize, (page-1)*pageSize)

	rows, err := h.db.Query(r.Context(), `
		SELECT l.id, l.seller_id, l.category_id,
			COALESCE(c.name,''), COALESCE(c.slug,''),
			l.title, COALESCE(l.description,''),
			l.status, l.pickup_zip_code,
			NULL::text, NULL::text, NULL::text,
			ST_Y(l.location), ST_X(l.location),
			l.starting_price_cents,
			COALESCE(l.current_bid_cents, l.starting_price_cents),
			100::bigint,
			COALESCE((SELECT COUNT(DISTINCT bidder_id) FROM listing_bids WHERE listing_id=l.id),0),
			COALESCE(l.bid_count,0),
			l.auction_duration_hours, l.auction_ends_at,
			COALESCE(l.snipe_extension_count,0),
			l.created_at, l.updated_at
		  FROM listings l
		  LEFT JOIN service_categories c ON c.id = l.category_id
		 WHERE `+where+`
		 ORDER BY l.created_at DESC
		 LIMIT $`+itoa(len(args)-1)+` OFFSET $`+itoa(len(args)), args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	results := make([]listingJSON, 0)
	for rows.Next() {
		var l listingJSON
		var lat, lng pgtype.Float8
		var endsAt pgtype.Timestamptz
		if err := rows.Scan(&l.ID, &l.SellerID, &l.CategoryID,
			&l.CategoryName, &l.CategorySlug,
			&l.Title, &l.Description,
			&l.Status, &l.PickupZip,
			&l.PickupCity, &l.PickupState, &l.PickupAddress,
			&lat, &lng,
			&l.StartingPriceCents, &l.CurrentBidCents, &l.MinIncrementCents,
			&l.BidderCount, &l.BidCount,
			&l.AuctionDurationHours, &endsAt,
			&l.SnipeExtensionCount,
			&l.CreatedAt, &l.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
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
		l.Photos = []listingPhotoJSON{}
		results = append(results, l)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"listings":   results,
		"pagination": pageMeta(page, pageSize, total),
	})
}

// MyListingBids handles GET /api/v1/listings/me/bids — bids the user placed.
func (h *ListingsHandler) MyListingBids(w http.ResponseWriter, r *http.Request) {
	if h.db == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"bids":       []map[string]interface{}{},
			"pagination": pageMeta(1, 0, 0),
		})
		return
	}
	claims, ok := middleware.GetClaims(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing claims")
		return
	}
	q := r.URL.Query()
	page, pageSize := parseDirectPagination(q, 1, 20, 100)

	rows, err := h.db.Query(r.Context(), `
		SELECT b.id, b.listing_id, b.bidder_id,
			COALESCE(u.display_name,'Bidder'),
			b.amount_cents, (b.status='active'),
			b.created_at,
			l.id, l.seller_id, l.title, l.status,
			COALESCE(l.current_bid_cents, l.starting_price_cents),
			COALESCE(l.bid_count,0),
			l.auction_ends_at
		  FROM listing_bids b
		  JOIN listings l ON l.id = b.listing_id
		  LEFT JOIN users u ON u.id = b.bidder_id
		 WHERE b.bidder_id = $1
		 ORDER BY b.created_at DESC
		 LIMIT $2 OFFSET $3`,
		claims.UserID, pageSize, (page-1)*pageSize)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	type myBid struct {
		Bid     listingBidJSON `json:"bid"`
		Listing map[string]interface{} `json:"listing"`
	}
	out := make([]myBid, 0)
	for rows.Next() {
		var b listingBidJSON
		var lid, sid, ltitle, lstatus string
		var lcurrent int64
		var lbidcount int
		var lendsAt pgtype.Timestamptz
		if err := rows.Scan(
			&b.ID, &b.ListingID, &b.BidderID, &b.BidderDisplayName,
			&b.AmountCents, &b.IsWinning, &b.CreatedAt,
			&lid, &sid, &ltitle, &lstatus,
			&lcurrent, &lbidcount, &lendsAt,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "scan error")
			return
		}
		listingMap := map[string]interface{}{
			"id":                lid,
			"seller_id":         sid,
			"title":             ltitle,
			"status":            lstatus,
			"current_bid_cents": lcurrent,
			"bid_count":         lbidcount,
		}
		if lendsAt.Valid {
			listingMap["auction_ends_at"] = lendsAt.Time.UTC().Format(time.RFC3339)
		}
		out = append(out, myBid{Bid: b, Listing: listingMap})
	}

	var total int
	h.db.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM listing_bids WHERE bidder_id=$1`, claims.UserID,
	).Scan(&total)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"bids":       out,
		"pagination": pageMeta(page, pageSize, total),
	})
}

func itoa(i int) string { return fmt.Sprintf("%d", i) }
