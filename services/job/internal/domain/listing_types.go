package domain

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors for the listing (goods marketplace) domain.
var (
	ErrListingNotFound        = errors.New("listing not found")
	ErrListingNotActive       = errors.New("listing is not active")
	ErrNotListingSeller       = errors.New("not the listing seller")
	ErrInvalidListingDuration = errors.New("auction duration must be 24, 48, or 168 hours")
	ErrBidBelowCurrent        = errors.New("bid must be greater than current bid")
	ErrBidBelowStarting       = errors.New("bid must be at least starting price")
	ErrSelfBid                = errors.New("seller cannot bid on own listing")
	ErrListingOrderNotFound   = errors.New("listing order not found")
	ErrNotListingBuyer        = errors.New("not the buyer for this order")
	ErrEscrowNotHeld          = errors.New("escrow is not in held state")
	ErrPickupAlreadyConfirmed = errors.New("pickup already confirmed")
	ErrListingRadiusExceeded  = errors.New("pickup location exceeds 25-mile radius cap")
)

// Listing is a goods marketplace listing with a forward auction.
type Listing struct {
	ID                     string
	SellerID               string
	Title                  string
	Description            string
	CategoryID             string
	Latitude               float64
	Longitude              float64
	PickupAddress          string
	PickupZipCode          string
	StartingPriceCents     int64
	CurrentBidCents        *int64
	CurrentBidderID        *string
	BidCount               int32
	AuctionDurationHours   int32
	AuctionEndsAt          time.Time
	OriginalAuctionEndsAt  time.Time
	SnipeExtensionCount    int32
	Status                 string
	CreatedAt              time.Time
	UpdatedAt              time.Time

	// Populated via JOINs.
	Photos []ListingPhoto
}

// ListingPhoto is a photo attached to a listing.
type ListingPhoto struct {
	ID        string
	ListingID string
	URL       string
	SortOrder int32
	CreatedAt time.Time
}

// ListingBid is a single forward-auction bid on a listing.
type ListingBid struct {
	ID          string
	ListingID   string
	BidderID    string
	AmountCents int64
	Status      string // active | outbid | winning | awarded | withdrawn
	CreatedAt   time.Time
	WithdrawnAt *time.Time
	IPAddress   *string
	Fingerprint *string
}

// ListingOrder is the post-award escrow record (analog of Contract for jobs).
type ListingOrder struct {
	ID                string
	ListingID         string
	SellerID          string
	BuyerID           string
	AmountCents       int64
	FeeCents          int64
	EscrowStatus      string // held | pickup_confirmed | released | disputed | refunded
	PaymentIntentID   *string
	PickupConfirmedAt *time.Time
	ReleasedAt        *time.Time
	DisputeID         *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// CreateListingInput holds inputs to create a new listing.
type CreateListingInput struct {
	SellerID             string
	Title                string
	Description          string
	CategoryID           string
	Latitude             float64
	Longitude            float64
	PickupAddress        string
	PickupZipCode        string
	StartingPriceCents   int64
	AuctionDurationHours int32 // 24, 48, or 168
	PhotoURLs            []string
	Publish              bool
}

// UpdateListingInput holds optional fields for updating a draft listing.
type UpdateListingInput struct {
	Title                *string
	Description          *string
	StartingPriceCents   *int64
	AuctionDurationHours *int32
	PhotoURLs            []string // nil = no change
}

// PlaceListingBidInput captures a forward-auction bid attempt.
type PlaceListingBidInput struct {
	ListingID   string
	BidderID    string
	AmountCents int64
	IPAddress   string
	Fingerprint string
}

// PlaceListingBidResult bundles the placed bid plus snipe-extension metadata.
type PlaceListingBidResult struct {
	Bid                     *ListingBid
	SnipeExtensionTriggered bool
	NewAuctionEndsAt        time.Time
	SnipeExtensionCount     int32
}

// ListListingsInput defines listing search/filter parameters.
type ListListingsInput struct {
	StatusFilter  *string
	SellerID      *string
	CategoryID    *string
	NearLatitude  *float64
	NearLongitude *float64
	RadiusMiles   *float64 // capped at 25
	MaxPriceCents *int64
	TextQuery     string
	Page          int
	PageSize      int
}

// ListingRepository defines persistence operations for the goods marketplace.
type ListingRepository interface {
	CreateListing(ctx context.Context, input CreateListingInput) (*Listing, error)
	GetListing(ctx context.Context, listingID string) (*Listing, error)
	UpdateListing(ctx context.Context, listingID, sellerID string, input UpdateListingInput) (*Listing, error)
	CancelListing(ctx context.Context, listingID, sellerID, reason string) (*Listing, error)
	ListListings(ctx context.Context, input ListListingsInput) ([]*Listing, *Pagination, error)

	// Bidding
	PlaceListingBid(ctx context.Context, input PlaceListingBidInput) (*PlaceListingBidResult, error)
	GetListingBids(ctx context.Context, listingID string, page, pageSize int) ([]*ListingBid, *Pagination, error)

	// Auction lifecycle
	FindEndedAuctions(ctx context.Context, limit int) ([]string, error)
	CloseListingAuction(ctx context.Context, listingID string) (*Listing, *ListingOrder, error)

	// Post-award
	GetListingOrder(ctx context.Context, orderID string) (*ListingOrder, error)
	ConfirmPickup(ctx context.Context, orderID, buyerID string) (*ListingOrder, error)
	FileListingDispute(ctx context.Context, orderID, filingUserID, disputeType, description string, evidenceURLs []string) (string, *ListingOrder, error)
}
