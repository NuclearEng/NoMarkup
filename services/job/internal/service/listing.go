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
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// ListingService implements goods-marketplace business logic.
type ListingService struct {
	repo domain.ListingRepository
	// rdb is optional. When non-nil, PlaceListingBid publishes a
	// `listing:{id}` event consumed by the gateway marketplace
	// spectator WebSocket. nil-safe — service still works without it.
	rdb *redis.Client
	// search is optional. When non-nil, lifecycle events (create/update/
	// cancel/close) trigger Meilisearch upserts/deletes via fire-and-forget
	// goroutines with retry. Mirrors JobService's search wiring.
	search *ListingSearchEngine
	// hydrate optionally fills in fields not present on the domain.Listing
	// struct (category_name, category_slug, condition, pickup_city). When
	// nil, the indexed document carries only the bare fields the listing
	// already has — search still works against title/description.
	hydrate ListingHydrator
}

// NewListingService wires a ListingService against a repository.
func NewListingService(repo domain.ListingRepository) *ListingService {
	return &ListingService{repo: repo}
}

// WithRedis attaches an optional Redis client used to publish bid-placed
// events to the `listing:{id}` channel. Returns the service for chaining.
func (s *ListingService) WithRedis(rdb *redis.Client) *ListingService {
	s.rdb = rdb
	return s
}

// WithSearch attaches an optional Meilisearch indexer. The hydrate callback
// supplies denormalized fields (category name/slug, condition, pickup
// city/state) that aren't on the domain.Listing struct.
func (s *ListingService) WithSearch(search *ListingSearchEngine, hydrate ListingHydrator) *ListingService {
	s.search = search
	s.hydrate = hydrate
	return s
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
	// Search indexing — only published listings are searchable.
	if listing.Status == "active" && s.search != nil {
		indexListingWithRetry(s.search, listing, s.hydrate, "create")
	}
	// Followable-seller fan-out: publish a `notify:seller_new_listing:{seller_id}`
	// Redis event so the notification service can fan to followers.
	// Drafts don't publish — followers don't see drafts. The publish
	// path on draft -> active activation is owned by listings_write.go
	// in the gateway (we can't double-fire from here without an event id).
	if listing.Status == "active" {
		s.publishListingCreated(ctx, listing)
	}
	return listing, nil
}

// publishListingCreated fires the `notify:seller_new_listing:{seller_id}`
// Redis event consumed by services/notification/cmd/server/follows_pubsub.go.
// Best-effort: any failure is logged and never propagated.
func (s *ListingService) publishListingCreated(ctx context.Context, listing *domain.Listing) {
	if s.rdb == nil {
		return
	}
	payload := map[string]interface{}{
		"type":                 "seller_new_listing",
		"listing_id":           listing.ID,
		"seller_id":            listing.SellerID,
		"title":                listing.Title,
		"starting_price_cents": listing.StartingPriceCents,
		"timestamp":            time.Now().UTC().Format(time.RFC3339Nano),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		slog.Warn("publish seller_new_listing: marshal failed", "error", err)
		return
	}
	channel := fmt.Sprintf("notify:seller_new_listing:%s", listing.SellerID)
	if err := s.rdb.Publish(ctx, channel, data).Err(); err != nil {
		slog.Warn("publish seller_new_listing: redis publish failed",
			"listing_id", listing.ID,
			"seller_id", listing.SellerID,
			"error", err,
		)
	}
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
	// Re-index when the listing is currently active. Drafts aren't searchable.
	if l != nil && l.Status == "active" && s.search != nil {
		indexListingWithRetry(s.search, l, s.hydrate, "update")
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
	if s.search != nil {
		removeListingFromSearchWithRetry(s.search, listingID, "cancel")
	}
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
	s.publishBidPlaced(ctx, input, res)
	return res, nil
}

// publishBidPlaced fires the `listing:{id}` Redis event consumed by the
// marketplace spectator WebSocket. Best-effort: any failure is logged
// at WARN and never propagated. The bid has already committed.
//
// Payload is intentionally minimal — bidder_id is included only because
// the gateway spectator handler strips it before forwarding to clients
// (defense in depth: server-only logs retain it for fraud forensics).
func (s *ListingService) publishBidPlaced(ctx context.Context, input domain.PlaceListingBidInput, res *domain.PlaceListingBidResult) {
	if s.rdb == nil {
		return
	}
	payload := map[string]interface{}{
		"type":            "bid_placed",
		"listing_id":      input.ListingID,
		"bidder_id":       input.BidderID,
		"amount_cents":    input.AmountCents,
		"snipe_extension":       res.SnipeExtensionTriggered,
		"snipe_extension_count": res.SnipeExtensionCount,
		"new_auction_ends_at":   res.NewAuctionEndsAt.UTC().Format(time.RFC3339),
		"timestamp":       time.Now().UTC().Format(time.RFC3339Nano),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		slog.Warn("publish bid_placed: marshal failed", "error", err)
		return
	}
	channel := fmt.Sprintf("listing:%s", input.ListingID)
	if err := s.rdb.Publish(ctx, channel, data).Err(); err != nil {
		slog.Warn("publish bid_placed: redis publish failed",
			"listing_id", input.ListingID,
			"error", err,
		)
	}
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
// to 'awarded' and creates a listing_orders row in pending_payment (never held
// without a PaymentIntent — MON-06). Idempotent.
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
		// Losers: release authorized bid bonds. Winner keeps bond until pay (held).
		s.releaseListingBidBonds(ctx, listingID, o.BuyerID)
	} else {
		slog.Info("listing auction expired with no bids", "listing_id", l.ID)
		// No sale: release every authorized bond for this listing.
		s.releaseListingBidBonds(ctx, listingID, "")
	}
	// Sold or expired listings should disappear from search.
	if s.search != nil {
		removeListingFromSearchWithRetry(s.search, listingID, "close")
	}
	return l, o, nil
}

// releaseListingBidBonds fail-soft releases authorized bonds. excludeUserID
// is the winner to keep authorized until escrow is funded (empty = all).
func (s *ListingService) releaseListingBidBonds(ctx context.Context, listingID, excludeUserID string) {
	if s.repo == nil || listingID == "" {
		return
	}
	n, err := s.repo.ReleaseAuthorizedBidBonds(ctx, listingID, excludeUserID)
	if err != nil {
		slog.WarnContext(ctx, "listing close: bid bond release failed (auction still closed)",
			"listing_id", listingID,
			"exclude_user_id", excludeUserID,
			"error", err,
		)
		return
	}
	if n > 0 {
		slog.InfoContext(ctx, "listing close: released authorized bid bonds",
			"listing_id", listingID,
			"released_count", n,
			"exclude_user_id", excludeUserID,
		)
	}
}

// CloseEndedAuctions resolves auctions whose deadline has passed but that are
// still status='active'. It fetches a bounded batch of ended auctions and
// closes each one via CloseListingAuction. Returns (closed, expired) counts:
//   - closed  = listings that produced a winning order. The order is written in
//     escrow_status='pending_payment' and left there: the payment service's
//     settlement worker attaches the PaymentIntent, and only a verified
//     payment_intent.succeeded event promotes it to 'held'. See
//     runListingSettlementCron and SettlePendingListingOrders in the payment
//     service for why the charge is not made here.
//   - expired = listings closed with no sale (no bids OR reserve not met)
//
// Money-safety: each close runs in its own FOR UPDATE-locked, status-guarded
// transaction in the repository, and listing_orders has a UNIQUE(listing_id)
// constraint, so a listing can never produce two orders even if two worker
// ticks (or two job-service instances) race the same row — the loser's
// status guard turns its close into a no-op. A re-run over an already-resolved
// listing does nothing.
//
// Fail-soft: a single listing that errors is logged and skipped; the loop
// continues so one poisoned row can never stall the whole backlog or crash
// the worker.
func (s *ListingService) CloseEndedAuctions(ctx context.Context, batchSize int) (closed, expired int, err error) {
	if batchSize <= 0 {
		batchSize = 100
	}
	ids, err := s.repo.FindEndedAuctions(ctx, batchSize)
	if err != nil {
		return 0, 0, fmt.Errorf("close ended auctions: find: %w", err)
	}
	for _, id := range ids {
		l, o, closeErr := s.CloseListingAuction(ctx, id)
		if closeErr != nil {
			// Fail-soft: log and continue. Do not abort the batch.
			slog.ErrorContext(ctx, "close ended auctions: listing close failed",
				"listing_id", id, "error", closeErr)
			continue
		}
		if o != nil {
			closed++
			s.publishAuctionWon(ctx, l, o)
		} else {
			expired++
			s.publishAuctionExpired(ctx, l)
		}
	}
	return closed, expired, nil
}

// publishAuctionWon fires best-effort `notify:auction_won:{user_id}` Redis
// events to the winning buyer and the seller after an auction closes with a
// sale. Best-effort: any failure is logged and never propagated (a missing
// notification must never undo a committed order). nil-safe when rdb is unset.
func (s *ListingService) publishAuctionWon(ctx context.Context, l *domain.Listing, o *domain.ListingOrder) {
	if s.rdb == nil || l == nil || o == nil {
		return
	}
	base := map[string]interface{}{
		"type":         "auction_won",
		"listing_id":   o.ListingID,
		"order_id":     o.ID,
		"title":        l.Title,
		"amount_cents": o.AmountCents,
		"buyer_id":     o.BuyerID,
		"seller_id":    o.SellerID,
		"timestamp":    time.Now().UTC().Format(time.RFC3339Nano),
	}
	for _, userID := range []string{o.BuyerID, o.SellerID} {
		data, marshalErr := json.Marshal(base)
		if marshalErr != nil {
			slog.Warn("publish auction_won: marshal failed", "error", marshalErr)
			return
		}
		channel := fmt.Sprintf("notify:auction_won:%s", userID)
		if pubErr := s.rdb.Publish(ctx, channel, data).Err(); pubErr != nil {
			slog.Warn("publish auction_won: redis publish failed",
				"listing_id", o.ListingID, "user_id", userID, "error", pubErr)
		}
	}
}

// publishAuctionExpired fires a best-effort `notify:auction_expired:{seller_id}`
// Redis event after an auction closes WITHOUT a sale (no bids or reserve not
// met). Best-effort and nil-safe — failures are logged only.
func (s *ListingService) publishAuctionExpired(ctx context.Context, l *domain.Listing) {
	if s.rdb == nil || l == nil {
		return
	}
	payload := map[string]interface{}{
		"type":       "auction_expired",
		"listing_id": l.ID,
		"seller_id":  l.SellerID,
		"title":      l.Title,
		"timestamp":  time.Now().UTC().Format(time.RFC3339Nano),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		slog.Warn("publish auction_expired: marshal failed", "error", err)
		return
	}
	channel := fmt.Sprintf("notify:auction_expired:%s", l.SellerID)
	if err := s.rdb.Publish(ctx, channel, data).Err(); err != nil {
		slog.Warn("publish auction_expired: redis publish failed",
			"listing_id", l.ID, "seller_id", l.SellerID, "error", err)
	}
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
