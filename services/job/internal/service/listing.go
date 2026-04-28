// Package service — listing (goods marketplace) business logic.
//
// Forward-auction mechanics for the goods marketplace. The service layer is
// thin: most invariant enforcement lives in the repository (DB-level CHECK
// constraints, triggers, and the FOR-UPDATE-locked PlaceListingBid path).
//
// This file is intentionally co-located with job.go and contract.go because
// the bidding shape is similar enough to share helpers (e.g. snipe-extension
// metrics, lifecycle event emission). Goods != services, but the auction
// engine is one half-step away.
package service

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// ListingService implements goods-marketplace business logic.
type ListingService struct {
	repo domain.ListingRepository
}

// NewListingService wires a ListingService against a repository.
func NewListingService(repo domain.ListingRepository) *ListingService {
	return &ListingService{repo: repo}
}

// CreateListing validates input and persists a new listing.
func (s *ListingService) CreateListing(ctx context.Context, sellerID string, input domain.CreateListingInput) (*domain.Listing, error) {
	if sellerID == "" {
		return nil, fmt.Errorf("create listing: seller_id required")
	}
	if input.Title == "" {
		return nil, fmt.Errorf("create listing: title required")
	}
	if input.CategoryID == "" {
		return nil, fmt.Errorf("create listing: category_id required")
	}
	if input.StartingPriceCents <= 0 {
		return nil, fmt.Errorf("create listing: starting_price_cents must be positive")
	}
	if !(input.AuctionDurationHours == 24 || input.AuctionDurationHours == 48 || input.AuctionDurationHours == 168) {
		return nil, fmt.Errorf("create listing: %w", domain.ErrInvalidListingDuration)
	}
	input.SellerID = sellerID

	listing, err := s.repo.CreateListing(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("create listing: %w", err)
	}
	slog.Info("listing created",
		"listing_id", listing.ID,
		"seller_id", listing.SellerID,
		"status", listing.Status,
		"starting_price_cents", listing.StartingPriceCents,
		"auction_duration_hours", listing.AuctionDurationHours,
	)
	return listing, nil
}

// GetListing returns a listing by ID.
func (s *ListingService) GetListing(ctx context.Context, listingID string) (*domain.Listing, error) {
	l, err := s.repo.GetListing(ctx, listingID)
	if err != nil {
		return nil, fmt.Errorf("get listing: %w", err)
	}
	return l, nil
}

// ListListings returns a paginated list of listings (with optional filters).
//
// Buyer-side queries clamp radius to 25 miles per product spec.
func (s *ListingService) ListListings(ctx context.Context, input domain.ListListingsInput) ([]*domain.Listing, *domain.Pagination, error) {
	if input.RadiusMiles != nil && *input.RadiusMiles > 25 {
		clamped := 25.0
		input.RadiusMiles = &clamped
	}
	listings, pag, err := s.repo.ListListings(ctx, input)
	if err != nil {
		return nil, nil, fmt.Errorf("list listings: %w", err)
	}
	return listings, pag, nil
}

// UpdateListing edits a draft listing. Active listings are immutable.
func (s *ListingService) UpdateListing(ctx context.Context, listingID, sellerID string, input domain.UpdateListingInput) (*domain.Listing, error) {
	l, err := s.repo.UpdateListing(ctx, listingID, sellerID, input)
	if err != nil {
		return nil, fmt.Errorf("update listing: %w", err)
	}
	return l, nil
}

// CancelListing cancels a draft or active listing (no winner is awarded).
func (s *ListingService) CancelListing(ctx context.Context, listingID, sellerID, reason string) (*domain.Listing, error) {
	l, err := s.repo.CancelListing(ctx, listingID, sellerID, reason)
	if err != nil {
		return nil, fmt.Errorf("cancel listing: %w", err)
	}
	slog.Info("listing cancelled", "listing_id", listingID, "seller_id", sellerID, "reason", reason)
	return l, nil
}

// PlaceListingBid places a forward-auction bid. Validates amount > current_bid_cents
// and >= starting_price for the first bid.
func (s *ListingService) PlaceListingBid(ctx context.Context, input domain.PlaceListingBidInput) (*domain.PlaceListingBidResult, error) {
	if input.BidderID == "" {
		return nil, fmt.Errorf("place listing bid: bidder_id required")
	}
	if input.AmountCents <= 0 {
		return nil, fmt.Errorf("place listing bid: amount must be positive")
	}
	res, err := s.repo.PlaceListingBid(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("place listing bid: %w", err)
	}
	slog.Info("listing bid placed",
		"listing_id", input.ListingID,
		"bidder_id", input.BidderID,
		"amount_cents", input.AmountCents,
		"snipe_extension", res.SnipeExtensionTriggered,
	)
	return res, nil
}

// GetListingBids returns bids for a listing, sorted highest-first.
func (s *ListingService) GetListingBids(ctx context.Context, listingID string, page, pageSize int) ([]*domain.ListingBid, *domain.Pagination, error) {
	bids, pag, err := s.repo.GetListingBids(ctx, listingID, page, pageSize)
	if err != nil {
		return nil, nil, fmt.Errorf("get listing bids: %w", err)
	}
	return bids, pag, nil
}

// CloseListingAuction is the post-deadline transition. Promotes the high bid
// to 'awarded' and creates a listing_orders row in escrow. Idempotent.
func (s *ListingService) CloseListingAuction(ctx context.Context, listingID string) (*domain.Listing, *domain.ListingOrder, error) {
	l, o, err := s.repo.CloseListingAuction(ctx, listingID)
	if err != nil {
		return nil, nil, fmt.Errorf("close listing auction: %w", err)
	}
	if o != nil {
		slog.Info("listing auction closed and order created",
			"listing_id", l.ID,
			"order_id", o.ID,
			"buyer_id", o.BuyerID,
			"amount_cents", o.AmountCents,
			"fee_cents", o.FeeCents,
		)
	} else {
		slog.Info("listing auction expired with no bids", "listing_id", l.ID)
	}
	return l, o, nil
}

// ConfirmPickup is the buyer-only escrow release.
func (s *ListingService) ConfirmPickup(ctx context.Context, orderID, buyerID string) (*domain.ListingOrder, error) {
	o, err := s.repo.ConfirmPickup(ctx, orderID, buyerID)
	if err != nil {
		return nil, fmt.Errorf("confirm pickup: %w", err)
	}
	slog.Info("listing order pickup confirmed", "order_id", orderID, "buyer_id", buyerID)
	return o, nil
}

// FileListingDispute opens a dispute against a held order.
func (s *ListingService) FileListingDispute(ctx context.Context, orderID, filingUserID, disputeType, description string, evidenceURLs []string) (string, *domain.ListingOrder, error) {
	id, o, err := s.repo.FileListingDispute(ctx, orderID, filingUserID, disputeType, description, evidenceURLs)
	if err != nil {
		return "", nil, fmt.Errorf("file listing dispute: %w", err)
	}
	slog.Info("listing dispute filed",
		"dispute_id", id, "order_id", orderID, "filing_user_id", filingUserID, "type", disputeType,
	)
	return id, o, nil
}

// listingDistanceMiles computes the great-circle distance between two
// lat/lng pairs (haversine, miles). Used for the 25-mile radius cap when
// listings include explicit pickup vs. buyer location queries.
func listingDistanceMiles(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusMiles = 3958.8
	rad := func(d float64) float64 { return d * math.Pi / 180 }
	dLat := rad(lat2 - lat1)
	dLon := rad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusMiles * c
}

// freshAuctionEnd returns the auction-end timestamp for a given duration
// starting now. Encapsulates the discrete-bucket policy (24/48/168 hours).
func freshAuctionEnd(durationHours int32) time.Time {
	return time.Now().Add(time.Duration(durationHours) * time.Hour)
}
