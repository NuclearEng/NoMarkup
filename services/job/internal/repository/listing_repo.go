// Package repository — listing (goods marketplace) persistence.
//
// This file implements domain.ListingRepository using the same pgx pool the
// existing job service uses. The bidding mechanics for goods listings are
// the *forward* analog of the reverse-auction bids table:
//
//   - Highest bid wins
//   - listings.current_bid_cents tracks MAX(amount_cents) and is maintained
//     by a database trigger (migration 034).
//   - listings.bid_count uses the same atomic-delta pattern as jobs.bid_count
//     (migration 030) — re-evaluated under READ COMMITTED on each retry.
//
// Concurrency safety in PlaceListingBid relies on a SELECT … FOR UPDATE on
// the listings row before the INSERT. This serialises bids on the same
// listing without taking a service-wide lock; bids on different listings
// proceed in parallel.

package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// ListingPostgresRepository implements domain.ListingRepository.
type ListingPostgresRepository struct {
	pool *pgxpool.Pool
}

// NewListingPostgresRepository creates a Postgres-backed listing repository.
func NewListingPostgresRepository(pool *pgxpool.Pool) *ListingPostgresRepository {
	return &ListingPostgresRepository{pool: pool}
}

// allowedDurations matches the CHECK constraint on listings.auction_duration_hours.
func allowedDuration(h int32) bool {
	return h == 24 || h == 48 || h == 168
}

func (r *ListingPostgresRepository) CreateListing(ctx context.Context, input domain.CreateListingInput) (*domain.Listing, error) {
	if !allowedDuration(input.AuctionDurationHours) {
		return nil, fmt.Errorf("create listing: %w", domain.ErrInvalidListingDuration)
	}

	status := "draft"
	if input.Publish {
		status = "active"
	}

	endsAt := time.Now().Add(time.Duration(input.AuctionDurationHours) * time.Hour)

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("create listing begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var id string
	var createdAt, updatedAt time.Time
	err = tx.QueryRow(ctx, `
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
		) RETURNING id, created_at, updated_at`,
		input.SellerID, input.Title, input.Description, input.CategoryID,
		input.Longitude, input.Latitude, input.PickupAddress, input.PickupZipCode,
		input.StartingPriceCents, input.AuctionDurationHours,
		endsAt, status,
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return nil, fmt.Errorf("create listing insert: %w", err)
	}

	for i, url := range input.PhotoURLs {
		_, err = tx.Exec(ctx,
			`INSERT INTO listing_photos (listing_id, url, sort_order) VALUES ($1, $2, $3)`,
			id, url, i)
		if err != nil {
			return nil, fmt.Errorf("create listing photo: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("create listing commit: %w", err)
	}
	return r.GetListing(ctx, id)
}

func (r *ListingPostgresRepository) GetListing(ctx context.Context, listingID string) (*domain.Listing, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT id, seller_id, title, description, category_id,
		       ST_X(location) AS lng, ST_Y(location) AS lat,
		       pickup_address, pickup_zip_code,
		       starting_price_cents, current_bid_cents, current_bidder_id, bid_count,
		       auction_duration_hours, auction_ends_at, original_auction_ends_at,
		       snipe_extension_count, status, created_at, updated_at
		  FROM listings WHERE id = $1`, listingID)

	var l domain.Listing
	var lng, lat float64
	if err := row.Scan(&l.ID, &l.SellerID, &l.Title, &l.Description, &l.CategoryID,
		&lng, &lat,
		&l.PickupAddress, &l.PickupZipCode,
		&l.StartingPriceCents, &l.CurrentBidCents, &l.CurrentBidderID, &l.BidCount,
		&l.AuctionDurationHours, &l.AuctionEndsAt, &l.OriginalAuctionEndsAt,
		&l.SnipeExtensionCount, &l.Status, &l.CreatedAt, &l.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get listing: %w", domain.ErrListingNotFound)
		}
		return nil, fmt.Errorf("get listing scan: %w", err)
	}
	l.Latitude = lat
	l.Longitude = lng

	// Photos
	rows, err := r.pool.Query(ctx,
		`SELECT id, url, sort_order, created_at FROM listing_photos
		  WHERE listing_id = $1 ORDER BY sort_order ASC`, listingID)
	if err != nil {
		return nil, fmt.Errorf("get listing photos: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var p domain.ListingPhoto
		if err := rows.Scan(&p.ID, &p.URL, &p.SortOrder, &p.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan listing photo: %w", err)
		}
		p.ListingID = listingID
		l.Photos = append(l.Photos, p)
	}
	return &l, nil
}

func (r *ListingPostgresRepository) UpdateListing(ctx context.Context, listingID, sellerID string, input domain.UpdateListingInput) (*domain.Listing, error) {
	// Verify ownership and that listing is still a draft (no edits after going live).
	var currentStatus, ownerID string
	err := r.pool.QueryRow(ctx,
		`SELECT status, seller_id FROM listings WHERE id = $1`, listingID).
		Scan(&currentStatus, &ownerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("update listing: %w", domain.ErrListingNotFound)
		}
		return nil, fmt.Errorf("update listing get: %w", err)
	}
	if ownerID != sellerID {
		return nil, fmt.Errorf("update listing: %w", domain.ErrNotListingSeller)
	}
	if currentStatus != "draft" {
		return nil, fmt.Errorf("update listing: %w", domain.ErrListingNotActive)
	}

	if input.AuctionDurationHours != nil && !allowedDuration(*input.AuctionDurationHours) {
		return nil, fmt.Errorf("update listing: %w", domain.ErrInvalidListingDuration)
	}

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1
	if input.Title != nil {
		setClauses = append(setClauses, fmt.Sprintf("title = $%d", argIdx))
		args = append(args, *input.Title)
		argIdx++
	}
	if input.Description != nil {
		setClauses = append(setClauses, fmt.Sprintf("description = $%d", argIdx))
		args = append(args, *input.Description)
		argIdx++
	}
	if input.StartingPriceCents != nil {
		setClauses = append(setClauses, fmt.Sprintf("starting_price_cents = $%d", argIdx))
		args = append(args, *input.StartingPriceCents)
		argIdx++
	}
	if input.AuctionDurationHours != nil {
		setClauses = append(setClauses, fmt.Sprintf("auction_duration_hours = $%d", argIdx))
		args = append(args, *input.AuctionDurationHours)
		argIdx++
	}
	if len(setClauses) > 0 {
		args = append(args, listingID)
		query := fmt.Sprintf(`UPDATE listings SET %s WHERE id = $%d`,
			strings.Join(setClauses, ", "), argIdx)
		if _, err := r.pool.Exec(ctx, query, args...); err != nil {
			return nil, fmt.Errorf("update listing exec: %w", err)
		}
	}

	if input.PhotoURLs != nil {
		tx, err := r.pool.Begin(ctx)
		if err != nil {
			return nil, fmt.Errorf("update listing photos tx: %w", err)
		}
		defer tx.Rollback(ctx)
		if _, err = tx.Exec(ctx, `DELETE FROM listing_photos WHERE listing_id = $1`, listingID); err != nil {
			return nil, fmt.Errorf("delete listing photos: %w", err)
		}
		for i, url := range input.PhotoURLs {
			if _, err = tx.Exec(ctx,
				`INSERT INTO listing_photos (listing_id, url, sort_order) VALUES ($1, $2, $3)`,
				listingID, url, i); err != nil {
				return nil, fmt.Errorf("insert listing photo: %w", err)
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit listing photos: %w", err)
		}
	}

	return r.GetListing(ctx, listingID)
}

func (r *ListingPostgresRepository) CancelListing(ctx context.Context, listingID, sellerID, _ string) (*domain.Listing, error) {
	tag, err := r.pool.Exec(ctx,
		`UPDATE listings SET status = 'cancelled' WHERE id = $1 AND seller_id = $2 AND status IN ('draft','active')`,
		listingID, sellerID)
	if err != nil {
		return nil, fmt.Errorf("cancel listing: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("cancel listing: %w", domain.ErrListingNotFound)
	}
	return r.GetListing(ctx, listingID)
}

func (r *ListingPostgresRepository) ListListings(ctx context.Context, input domain.ListListingsInput) ([]*domain.Listing, *domain.Pagination, error) {
	page := input.Page
	if page < 1 {
		page = 1
	}
	pageSize := input.PageSize
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}

	var where []string
	var args []interface{}
	idx := 1
	if input.StatusFilter != nil {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, *input.StatusFilter)
		idx++
	}
	if input.SellerID != nil {
		where = append(where, fmt.Sprintf("seller_id = $%d", idx))
		args = append(args, *input.SellerID)
		idx++
	}
	if input.CategoryID != nil {
		where = append(where, fmt.Sprintf("category_id = $%d", idx))
		args = append(args, *input.CategoryID)
		idx++
	}
	if input.MaxPriceCents != nil {
		where = append(where, fmt.Sprintf("starting_price_cents <= $%d", idx))
		args = append(args, *input.MaxPriceCents)
		idx++
	}
	if input.TextQuery != "" {
		where = append(where, fmt.Sprintf("(title ILIKE $%d OR description ILIKE $%d)", idx, idx))
		args = append(args, "%"+input.TextQuery+"%")
		idx++
	}
	if input.NearLatitude != nil && input.NearLongitude != nil && input.RadiusMiles != nil {
		// Cap radius at 25 miles per product spec.
		radius := *input.RadiusMiles
		if radius > 25 {
			radius = 25
		}
		// 1 mile = 1609.344 m
		where = append(where, fmt.Sprintf(
			"ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($%d, $%d), 4326)::geography, $%d)",
			idx, idx+1, idx+2))
		args = append(args, *input.NearLongitude, *input.NearLatitude, radius*1609.344)
		idx += 3
	}

	clause := ""
	if len(where) > 0 {
		clause = "WHERE " + strings.Join(where, " AND ")
	}

	// total count
	var total int
	if err := r.pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT COUNT(*) FROM listings %s`, clause), args...).Scan(&total); err != nil {
		return nil, nil, fmt.Errorf("list listings count: %w", err)
	}

	args = append(args, pageSize, (page-1)*pageSize)
	query := fmt.Sprintf(`
		SELECT id, seller_id, title, description, category_id,
		       ST_X(location) AS lng, ST_Y(location) AS lat,
		       pickup_address, pickup_zip_code,
		       starting_price_cents, current_bid_cents, current_bidder_id, bid_count,
		       auction_duration_hours, auction_ends_at, original_auction_ends_at,
		       snipe_extension_count, status, created_at, updated_at
		  FROM listings %s
		 ORDER BY created_at DESC
		 LIMIT $%d OFFSET $%d`, clause, idx, idx+1)

	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("list listings query: %w", err)
	}
	defer rows.Close()

	var out []*domain.Listing
	for rows.Next() {
		var l domain.Listing
		var lng, lat float64
		if err := rows.Scan(&l.ID, &l.SellerID, &l.Title, &l.Description, &l.CategoryID,
			&lng, &lat,
			&l.PickupAddress, &l.PickupZipCode,
			&l.StartingPriceCents, &l.CurrentBidCents, &l.CurrentBidderID, &l.BidCount,
			&l.AuctionDurationHours, &l.AuctionEndsAt, &l.OriginalAuctionEndsAt,
			&l.SnipeExtensionCount, &l.Status, &l.CreatedAt, &l.UpdatedAt,
		); err != nil {
			return nil, nil, fmt.Errorf("scan listing: %w", err)
		}
		l.Latitude = lat
		l.Longitude = lng
		out = append(out, &l)
	}

	totalPages := (total + pageSize - 1) / pageSize
	pag := &domain.Pagination{
		TotalCount: total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
		HasNext:    page < totalPages,
	}
	return out, pag, nil
}

// PlaceListingBid is the heart of the forward-auction engine.
//
// Concurrency strategy:
//   1. Open a transaction.
//   2. SELECT … FOR UPDATE on the listings row to serialise bids on the same
//      listing. Different listings remain parallel.
//   3. Validate the auction is active and the bid is strictly greater than
//      the current high bid (and >= starting price for the first bid).
//   4. INSERT the new bid; mark the previous high bid (if any) as 'outbid'.
//   5. Snipe extension: if we are within 60s of close and we have not
//      extended N times, extend by 5 minutes.
//   6. The trigger updates current_bid_cents and bid_count atomically.
//   7. Commit.
func (r *ListingPostgresRepository) PlaceListingBid(ctx context.Context, input domain.PlaceListingBidInput) (*domain.PlaceListingBidResult, error) {
	if input.AmountCents <= 0 {
		return nil, fmt.Errorf("place listing bid: amount must be positive")
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("place listing bid begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the listing row to serialise concurrent bidders on the same listing.
	var (
		sellerID            string
		status              string
		startingPrice       int64
		currentBid          *int64
		auctionEndsAt       time.Time
		snipeExtensionCount int32
	)
	err = tx.QueryRow(ctx,
		`SELECT seller_id, status, starting_price_cents, current_bid_cents,
		        auction_ends_at, snipe_extension_count
		   FROM listings WHERE id = $1 FOR UPDATE`,
		input.ListingID).
		Scan(&sellerID, &status, &startingPrice, &currentBid,
			&auctionEndsAt, &snipeExtensionCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("place listing bid: %w", domain.ErrListingNotFound)
		}
		return nil, fmt.Errorf("place listing bid lock: %w", err)
	}

	if status != "active" {
		return nil, fmt.Errorf("place listing bid: %w", domain.ErrListingNotActive)
	}
	if time.Now().After(auctionEndsAt) {
		return nil, fmt.Errorf("place listing bid: %w", domain.ErrListingNotActive)
	}
	if input.BidderID == sellerID {
		return nil, fmt.Errorf("place listing bid: %w", domain.ErrSelfBid)
	}
	// Forward auction: bid MUST exceed current high (and starting price for first bid).
	if currentBid == nil {
		if input.AmountCents < startingPrice {
			return nil, fmt.Errorf("place listing bid: %w", domain.ErrBidBelowStarting)
		}
	} else if input.AmountCents <= *currentBid {
		return nil, fmt.Errorf("place listing bid: %w", domain.ErrBidBelowCurrent)
	}

	// Mark previous active bid (if any) as outbid.
	if _, err = tx.Exec(ctx,
		`UPDATE listing_bids SET status = 'outbid'
		  WHERE listing_id = $1 AND status = 'active'`,
		input.ListingID); err != nil {
		return nil, fmt.Errorf("place listing bid mark outbid: %w", err)
	}

	var bidID string
	var createdAt time.Time
	err = tx.QueryRow(ctx,
		`INSERT INTO listing_bids
			(listing_id, bidder_id, amount_cents, status, ip_address, fingerprint)
		 VALUES ($1, $2, $3, 'active', NULLIF($4, '')::inet, NULLIF($5, ''))
		 RETURNING id, created_at`,
		input.ListingID, input.BidderID, input.AmountCents,
		input.IPAddress, input.Fingerprint,
	).Scan(&bidID, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("place listing bid insert: %w", err)
	}

	// Snipe extension: bid in last 60s extends by 5 minutes (cap at 5 extensions).
	const snipeWindowSec = 60
	const snipeExtensionMin = 5
	const maxExtensions = int32(5)
	snipeTriggered := false
	newEndsAt := auctionEndsAt
	newExtensionCount := snipeExtensionCount

	timeRemaining := time.Until(auctionEndsAt)
	if timeRemaining > 0 && timeRemaining <= snipeWindowSec*time.Second && snipeExtensionCount < maxExtensions {
		err = tx.QueryRow(ctx,
			`UPDATE listings
			    SET auction_ends_at = auction_ends_at + INTERVAL '5 minutes',
			        snipe_extension_count = snipe_extension_count + 1
			  WHERE id = $1
			RETURNING auction_ends_at, snipe_extension_count`,
			input.ListingID).
			Scan(&newEndsAt, &newExtensionCount)
		if err != nil {
			return nil, fmt.Errorf("place listing bid extend: %w", err)
		}
		snipeTriggered = true
		_ = snipeExtensionMin // referenced for clarity
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("place listing bid commit: %w", err)
	}

	bid := &domain.ListingBid{
		ID:          bidID,
		ListingID:   input.ListingID,
		BidderID:    input.BidderID,
		AmountCents: input.AmountCents,
		Status:      "active",
		CreatedAt:   createdAt,
	}
	if input.IPAddress != "" {
		bid.IPAddress = &input.IPAddress
	}
	if input.Fingerprint != "" {
		bid.Fingerprint = &input.Fingerprint
	}
	return &domain.PlaceListingBidResult{
		Bid:                     bid,
		SnipeExtensionTriggered: snipeTriggered,
		NewAuctionEndsAt:        newEndsAt,
		SnipeExtensionCount:     newExtensionCount,
	}, nil
}

func (r *ListingPostgresRepository) GetListingBids(ctx context.Context, listingID string, page, pageSize int) ([]*domain.ListingBid, *domain.Pagination, error) {
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 50
	}

	var total int
	if err := r.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM listing_bids WHERE listing_id = $1`, listingID).
		Scan(&total); err != nil {
		return nil, nil, fmt.Errorf("count listing bids: %w", err)
	}

	rows, err := r.pool.Query(ctx,
		`SELECT id, listing_id, bidder_id, amount_cents, status, created_at,
		        withdrawn_at, host(ip_address) AS ip, fingerprint
		   FROM listing_bids
		  WHERE listing_id = $1
		  ORDER BY amount_cents DESC, created_at ASC
		  LIMIT $2 OFFSET $3`,
		listingID, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, nil, fmt.Errorf("query listing bids: %w", err)
	}
	defer rows.Close()
	var out []*domain.ListingBid
	for rows.Next() {
		var b domain.ListingBid
		if err := rows.Scan(&b.ID, &b.ListingID, &b.BidderID, &b.AmountCents, &b.Status,
			&b.CreatedAt, &b.WithdrawnAt, &b.IPAddress, &b.Fingerprint); err != nil {
			return nil, nil, fmt.Errorf("scan listing bid: %w", err)
		}
		out = append(out, &b)
	}
	totalPages := (total + pageSize - 1) / pageSize
	pag := &domain.Pagination{
		TotalCount: total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
		HasNext:    page < totalPages,
	}
	return out, pag, nil
}

// FindEndedAuctions returns the IDs of listings whose auction deadline has
// passed but are still status='active' — i.e. auctions that need closing.
// Ordered oldest-deadline-first so the most-overdue auctions resolve first,
// and bounded by limit so a backlog can't blow up a single worker tick.
//
// This is a pure read; the actual close (and its FOR UPDATE lock + status
// guard) happens per-listing in CloseListingAuction, so an ID returned here
// that a concurrent worker already closed is harmless — the close is a no-op.
func (r *ListingPostgresRepository) FindEndedAuctions(ctx context.Context, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := r.pool.Query(ctx,
		`SELECT id::text
		   FROM listings
		  WHERE status = 'active'
		    AND auction_ends_at < now()
		  ORDER BY auction_ends_at ASC
		  LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("find ended auctions: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("find ended auctions scan: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("find ended auctions rows: %w", err)
	}
	return ids, nil
}

// CloseListingAuction transitions an expired auction to sold (or expired, if
// no bids), promotes the winning bid, and creates the listing_orders row.
// Idempotent: re-calling on a sold listing is a no-op (returns the existing
// order). Uses a transaction with FOR UPDATE on the listings row.
func (r *ListingPostgresRepository) CloseListingAuction(ctx context.Context, listingID string) (*domain.Listing, *domain.ListingOrder, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("close listing begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var sellerID, currentStatus string
	var currentBid *int64
	var currentBidderID *string
	var reservePrice *int64
	err = tx.QueryRow(ctx,
		`SELECT seller_id, status, current_bid_cents, current_bidder_id, reserve_price_cents
		   FROM listings WHERE id = $1 FOR UPDATE`, listingID).
		Scan(&sellerID, &currentStatus, &currentBid, &currentBidderID, &reservePrice)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, fmt.Errorf("close listing: %w", domain.ErrListingNotFound)
		}
		return nil, nil, fmt.Errorf("close listing lock: %w", err)
	}

	// Idempotency. A re-run over an already-closed listing is a no-op: a
	// 'sold' listing returns its existing order; an 'expired'/'cancelled'/
	// 'draft' listing is past the active window and returns no order. The
	// status-guarded transitions below never re-fire because we only ever
	// reach them from status='active'.
	if currentStatus != "active" {
		if currentStatus != "sold" {
			// expired / cancelled / draft — nothing to award, no order.
			_ = tx.Commit(ctx)
			l, err := r.GetListing(ctx, listingID)
			return l, nil, err
		}
		// Re-fetch listing + order outside the tx to keep things simple.
		_ = tx.Commit(ctx)
		l, err := r.GetListing(ctx, listingID)
		if err != nil {
			return nil, nil, err
		}
		var orderID string
		if err := r.pool.QueryRow(ctx,
			`SELECT id FROM listing_orders WHERE listing_id = $1`, listingID).
			Scan(&orderID); err != nil {
			return nil, nil, fmt.Errorf("close listing get order: %w", err)
		}
		o, err := r.GetListingOrder(ctx, orderID)
		if err != nil {
			return nil, nil, err
		}
		return l, o, nil
	}

	// No bids, OR a high bid that fails to meet a set reserve → expired.
	// reserve_price_cents is the hidden minimum the seller will accept; NULL
	// means "no reserve" and the high bid wins outright. When the high bid is
	// strictly below the reserve, the auction closes WITHOUT a sale: no
	// winner, no listing_orders row, no money moved. This matches the
	// documented contract in migration 039_listing_reserve_bin_zips.up.sql.
	reserveNotMet := reservePrice != nil && currentBid != nil && *currentBid < *reservePrice
	if currentBid == nil || currentBidderID == nil || reserveNotMet {
		// Bids that existed but didn't win the item are finalised as 'outbid'
		// so no stale 'active' bid lingers on an expired listing.
		if _, err := tx.Exec(ctx,
			`UPDATE listing_bids
			    SET status = 'outbid'
			  WHERE listing_id = $1 AND status = 'active'`, listingID); err != nil {
			return nil, nil, fmt.Errorf("close listing expire finalise bids: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`UPDATE listings SET status = 'expired' WHERE id = $1`, listingID); err != nil {
			return nil, nil, fmt.Errorf("close listing expire: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, nil, fmt.Errorf("close listing commit: %w", err)
		}
		l, err := r.GetListing(ctx, listingID)
		return l, nil, err
	}

	// Promote winning bid: set its status to 'awarded'.
	if _, err = tx.Exec(ctx,
		`UPDATE listing_bids
		    SET status = 'awarded'
		  WHERE listing_id = $1 AND status = 'active'`,
		listingID); err != nil {
		return nil, nil, fmt.Errorf("close listing award: %w", err)
	}

	// Mark all other bids as outbid (they already are after each new bid, but
	// be explicit so the post-award DB reflects the final state).
	if _, err = tx.Exec(ctx,
		`UPDATE listing_bids
		    SET status = 'outbid'
		  WHERE listing_id = $1 AND status NOT IN ('awarded','withdrawn','outbid')`,
		listingID); err != nil {
		return nil, nil, fmt.Errorf("close listing finalise: %w", err)
	}

	// Update listing.
	if _, err = tx.Exec(ctx,
		`UPDATE listings SET status = 'sold' WHERE id = $1`, listingID); err != nil {
		return nil, nil, fmt.Errorf("close listing mark sold: %w", err)
	}

	// R6.1: platform_fee_config (fee% + guarantee%) → combined fee_cents.
	// Same active default row as payment GetDefaultFeeConfig; charge path
	// recomputes from the same table so mint and charge stay aligned.
	feeCents := r.marketplaceSellerFeeCents(ctx, *currentBid)

	// MON-06 / goods auction close: insert as pending_payment, NOT held.
	// held requires a captured PaymentIntent (payment_intent_id set via
	// ChargeListingWinner + payment_intent.succeeded webhook). Release /
	// auto-release / confirm-pickup only apply to held orders with a PI —
	// never release unpaid pending_payment rows.
	var orderID string
	err = tx.QueryRow(ctx,
		`INSERT INTO listing_orders (listing_id, seller_id, buyer_id, amount_cents, fee_cents, escrow_status)
		 VALUES ($1, $2, $3, $4, $5, 'pending_payment')
		 ON CONFLICT (listing_id) DO NOTHING
		 RETURNING id`,
		listingID, sellerID, *currentBidderID, *currentBid, feeCents).
		Scan(&orderID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Conflict: already had an order (race or prior close). Fetch it.
			if scanErr := tx.QueryRow(ctx, `SELECT id FROM listing_orders WHERE listing_id = $1`, listingID).Scan(&orderID); scanErr != nil {
				return nil, nil, fmt.Errorf("close listing get existing order after conflict: %w", scanErr)
			}
		} else {
			return nil, nil, fmt.Errorf("close listing create order: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("close listing commit: %w", err)
	}

	l, err := r.GetListing(ctx, listingID)
	if err != nil {
		return nil, nil, err
	}
	o, err := r.GetListingOrder(ctx, orderID)
	if err != nil {
		return nil, nil, err
	}
	return l, o, nil
}

func boolToInt64(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// marketplaceSellerFeeCents loads platform_fee_config default row and computes
// listing_orders.fee_cents. Mirrors payment MarketplaceSellerFeeCents:
// combined bps = rateToBPS(fee%) + rateToBPS(guarantee%), feeFromBPS ceiling,
// then min/max. Fail closed to 8%+2% (1000 bps) when the row is missing.
func (r *ListingPostgresRepository) marketplaceSellerFeeCents(ctx context.Context, amountCents int64) int64 {
	if amountCents <= 0 {
		return 0
	}
	var feePct, guaranteePct float64
	var minFee int64
	var maxFee *int64
	err := r.pool.QueryRow(ctx, `
		SELECT fee_percentage, guarantee_percentage, min_fee_cents, max_fee_cents
		FROM platform_fee_config
		WHERE category_id IS NULL AND active = true
		ORDER BY effective_from DESC
		LIMIT 1`).Scan(&feePct, &guaranteePct, &minFee, &maxFee)
	if err != nil {
		// Documented default take when config missing (seed 0.08+0.02).
		return listingFeeFromBPS(amountCents, 1000)
	}
	bps := listingRateToBPS(feePct) + listingRateToBPS(guaranteePct)
	if bps <= 0 {
		bps = 1000
	}
	fee := listingFeeFromBPS(amountCents, bps)
	if fee < minFee {
		fee = minFee
	}
	if maxFee != nil && *maxFee > 0 && fee > *maxFee {
		fee = *maxFee
	}
	return fee
}

// listingRateToBPS / listingFeeFromBPS mirror payment money.go (NUMERIC→bps +
// ceiling rem). Duplicated here so job service does not import payment.
func listingRateToBPS(rate float64) int64 {
	if rate <= 0 {
		return 0
	}
	bps := int64(rate*10000 + 0.5) // round half away from zero for positive rates
	if bps > 99999 {
		return 99999
	}
	return bps
}

func listingFeeFromBPS(amountCents, bps int64) int64 {
	if amountCents <= 0 || bps <= 0 {
		return 0
	}
	const scale int64 = 10000
	whole := (amountCents / scale) * bps
	rem := (amountCents % scale) * bps
	fee := whole + rem/scale
	if rem%scale != 0 {
		fee++
	}
	return fee
}

func (r *ListingPostgresRepository) GetListingOrder(ctx context.Context, orderID string) (*domain.ListingOrder, error) {
	var o domain.ListingOrder
	err := r.pool.QueryRow(ctx,
		`SELECT id, listing_id, seller_id, buyer_id, amount_cents, fee_cents,
		        escrow_status, payment_intent_id, pickup_confirmed_at, released_at,
		        dispute_id, created_at, updated_at
		   FROM listing_orders WHERE id = $1`, orderID).
		Scan(&o.ID, &o.ListingID, &o.SellerID, &o.BuyerID, &o.AmountCents, &o.FeeCents,
			&o.EscrowStatus, &o.PaymentIntentID, &o.PickupConfirmedAt, &o.ReleasedAt,
			&o.DisputeID, &o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get listing order: %w", domain.ErrListingOrderNotFound)
		}
		return nil, fmt.Errorf("get listing order: %w", err)
	}
	return &o, nil
}

func (r *ListingPostgresRepository) ConfirmPickup(ctx context.Context, orderID, buyerID string) (*domain.ListingOrder, error) {
	// Single-statement transition that enforces buyer + held status atomically.
	// Release/confirm-pickup only for held (funds captured via PaymentIntent) —
	// never pending_payment rows without payment_intent_id (MON-06).
	tag, err := r.pool.Exec(ctx,
		`UPDATE listing_orders
		    SET escrow_status = 'released',
		        pickup_confirmed_at = now(),
		        released_at = now()
		  WHERE id = $1 AND buyer_id = $2 AND escrow_status = 'held'`,
		orderID, buyerID)
	if err != nil {
		return nil, fmt.Errorf("confirm pickup: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Disambiguate the failure: did the order not exist, was the user
		// not the buyer, or was the escrow not held? One follow-up SELECT
		// is fine — this is rare.
		var existingBuyer, existingStatus string
		err := r.pool.QueryRow(ctx,
			`SELECT buyer_id, escrow_status FROM listing_orders WHERE id = $1`, orderID).
			Scan(&existingBuyer, &existingStatus)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("confirm pickup: %w", domain.ErrListingOrderNotFound)
		}
		if err != nil {
			return nil, fmt.Errorf("confirm pickup verify: %w", err)
		}
		if existingBuyer != buyerID {
			return nil, fmt.Errorf("confirm pickup: %w", domain.ErrNotListingBuyer)
		}
		if existingStatus == "released" || existingStatus == "pickup_confirmed" {
			return nil, fmt.Errorf("confirm pickup: %w", domain.ErrPickupAlreadyConfirmed)
		}
		return nil, fmt.Errorf("confirm pickup: %w", domain.ErrEscrowNotHeld)
	}
	return r.GetListingOrder(ctx, orderID)
}

// FileListingDispute creates a dispute row and flips the order to 'disputed'.
// In v1 we reuse the existing `disputes` table from the contract domain;
// listing_orders.dispute_id is a soft FK.
func (r *ListingPostgresRepository) FileListingDispute(ctx context.Context, orderID, filingUserID, disputeType, description string, evidenceURLs []string) (string, *domain.ListingOrder, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", nil, fmt.Errorf("file dispute begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var sellerID, buyerID, escrowStatus string
	err = tx.QueryRow(ctx,
		`SELECT seller_id, buyer_id, escrow_status
		   FROM listing_orders WHERE id = $1 FOR UPDATE`, orderID).
		Scan(&sellerID, &buyerID, &escrowStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil, fmt.Errorf("file dispute: %w", domain.ErrListingOrderNotFound)
		}
		return "", nil, fmt.Errorf("file dispute lookup: %w", err)
	}
	if filingUserID != sellerID && filingUserID != buyerID {
		return "", nil, fmt.Errorf("file dispute: %w", domain.ErrNotListingBuyer)
	}
	if escrowStatus == "released" || escrowStatus == "refunded" {
		return "", nil, fmt.Errorf("file dispute: %w", domain.ErrEscrowNotHeld)
	}

	// We don't have a contracts row for goods, so we record the dispute in a
	// lightweight form: just bump the order status. Full dispute schema reuse
	// is deferred until v2.
	disputeID := generateUUID()
	_, _ = disputeType, description // recorded in the future when we add a goods_disputes table
	_ = evidenceURLs

	if _, err = tx.Exec(ctx,
		`UPDATE listing_orders
		    SET escrow_status = 'disputed', dispute_id = $1
		  WHERE id = $2`,
		disputeID, orderID); err != nil {
		return "", nil, fmt.Errorf("file dispute update: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", nil, fmt.Errorf("file dispute commit: %w", err)
	}
	o, err := r.GetListingOrder(ctx, orderID)
	if err != nil {
		return "", nil, err
	}
	return disputeID, o, nil
}

// generateUUID returns a fresh UUID v4 string.
func generateUUID() string {
	return uuid.NewString()
}
