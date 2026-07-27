// Unit tests for ListingService — forward-auction (goods marketplace).
//
// These tests cover the service-layer validation that runs *before* the
// repository's FOR UPDATE-protected bid path: input validation, duration
// allowlist, radius clamp on buyer queries, and the bid-direction guard
// (forward auctions reject bids <= current high).

package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Mock listing repository ---

type mockListingRepo struct {
	createListingFn      func(ctx context.Context, input domain.CreateListingInput) (*domain.Listing, error)
	getListingFn         func(ctx context.Context, listingID string) (*domain.Listing, error)
	updateListingFn      func(ctx context.Context, listingID, sellerID string, input domain.UpdateListingInput) (*domain.Listing, error)
	cancelListingFn      func(ctx context.Context, listingID, sellerID, reason string) (*domain.Listing, error)
	listListingsFn       func(ctx context.Context, input domain.ListListingsInput) ([]*domain.Listing, *domain.Pagination, error)
	placeBidFn           func(ctx context.Context, input domain.PlaceListingBidInput) (*domain.PlaceListingBidResult, error)
	getBidsFn            func(ctx context.Context, listingID string, page, pageSize int) ([]*domain.ListingBid, *domain.Pagination, error)
	findEndedFn          func(ctx context.Context, limit int) ([]string, error)
	closeAuctionFn       func(ctx context.Context, listingID string) (*domain.Listing, *domain.ListingOrder, error)
	releaseBondsFn       func(ctx context.Context, listingID, excludeUserID string) (int64, error)
	getOrderFn           func(ctx context.Context, orderID string) (*domain.ListingOrder, error)
	confirmPickupFn      func(ctx context.Context, orderID, buyerID string) (*domain.ListingOrder, error)
	fileDisputeFn        func(ctx context.Context, orderID, filingUserID, disputeType, description string, evidenceURLs []string) (string, *domain.ListingOrder, error)
	lastListListingsArgs *domain.ListListingsInput
}

func (m *mockListingRepo) CreateListing(ctx context.Context, input domain.CreateListingInput) (*domain.Listing, error) {
	return m.createListingFn(ctx, input)
}
func (m *mockListingRepo) GetListing(ctx context.Context, listingID string) (*domain.Listing, error) {
	return m.getListingFn(ctx, listingID)
}
func (m *mockListingRepo) UpdateListing(ctx context.Context, listingID, sellerID string, input domain.UpdateListingInput) (*domain.Listing, error) {
	return m.updateListingFn(ctx, listingID, sellerID, input)
}
func (m *mockListingRepo) CancelListing(ctx context.Context, listingID, sellerID, reason string) (*domain.Listing, error) {
	return m.cancelListingFn(ctx, listingID, sellerID, reason)
}
func (m *mockListingRepo) ListListings(ctx context.Context, input domain.ListListingsInput) ([]*domain.Listing, *domain.Pagination, error) {
	m.lastListListingsArgs = &input
	if m.listListingsFn != nil {
		return m.listListingsFn(ctx, input)
	}
	return nil, &domain.Pagination{}, nil
}
func (m *mockListingRepo) PlaceListingBid(ctx context.Context, input domain.PlaceListingBidInput) (*domain.PlaceListingBidResult, error) {
	return m.placeBidFn(ctx, input)
}
func (m *mockListingRepo) GetListingBids(ctx context.Context, listingID string, page, pageSize int) ([]*domain.ListingBid, *domain.Pagination, error) {
	return m.getBidsFn(ctx, listingID, page, pageSize)
}
func (m *mockListingRepo) FindEndedAuctions(ctx context.Context, limit int) ([]string, error) {
	if m.findEndedFn != nil {
		return m.findEndedFn(ctx, limit)
	}
	return nil, nil
}
func (m *mockListingRepo) ReleaseAuthorizedBidBonds(ctx context.Context, listingID, excludeUserID string) (int64, error) {
	if m.releaseBondsFn != nil {
		return m.releaseBondsFn(ctx, listingID, excludeUserID)
	}
	return 0, nil
}

func (m *mockListingRepo) CloseListingAuction(ctx context.Context, listingID string) (*domain.Listing, *domain.ListingOrder, error) {
	return m.closeAuctionFn(ctx, listingID)
}
func (m *mockListingRepo) GetListingOrder(ctx context.Context, orderID string) (*domain.ListingOrder, error) {
	return m.getOrderFn(ctx, orderID)
}
func (m *mockListingRepo) ConfirmPickup(ctx context.Context, orderID, buyerID string) (*domain.ListingOrder, error) {
	return m.confirmPickupFn(ctx, orderID, buyerID)
}
func (m *mockListingRepo) FileListingDispute(ctx context.Context, orderID, filingUserID, disputeType, description string, evidenceURLs []string) (string, *domain.ListingOrder, error) {
	return m.fileDisputeFn(ctx, orderID, filingUserID, disputeType, description, evidenceURLs)
}

// --- CreateListing validation tests ---

func TestCreateListing_Validation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		input   domain.CreateListingInput
		wantErr string
	}{
		{
			name: "missing title",
			input: domain.CreateListingInput{
				CategoryID: "cat-1", StartingPriceCents: 1000, AuctionDurationHours: 24,
			},
			wantErr: "title required",
		},
		{
			name: "missing category",
			input: domain.CreateListingInput{
				Title: "Bike", StartingPriceCents: 1000, AuctionDurationHours: 24,
			},
			wantErr: "category_id required",
		},
		{
			name: "zero starting price",
			input: domain.CreateListingInput{
				Title: "Bike", CategoryID: "cat-1", AuctionDurationHours: 24,
			},
			wantErr: "must be positive",
		},
		{
			name: "invalid duration (1 hour)",
			input: domain.CreateListingInput{
				Title: "Bike", CategoryID: "cat-1", StartingPriceCents: 1000,
				AuctionDurationHours: 1,
			},
			wantErr: "auction duration must be 24, 48, or 168 hours",
		},
		{
			name: "invalid duration (72 — service auction default, not allowed for goods)",
			input: domain.CreateListingInput{
				Title: "Bike", CategoryID: "cat-1", StartingPriceCents: 1000,
				AuctionDurationHours: 72,
			},
			wantErr: "auction duration must be 24, 48, or 168 hours",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			repo := &mockListingRepo{}
			s := NewListingService(repo)
			_, err := s.CreateListing(context.Background(), "seller-1", tt.input)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestCreateListing_AcceptsAllowedDurations(t *testing.T) {
	t.Parallel()
	for _, h := range []int32{24, 48, 168} {
		h := h
		t.Run(fmtHours(h), func(t *testing.T) {
			t.Parallel()
			called := false
			repo := &mockListingRepo{
				createListingFn: func(ctx context.Context, input domain.CreateListingInput) (*domain.Listing, error) {
					called = true
					return &domain.Listing{ID: "l-1", SellerID: input.SellerID, Status: "draft", AuctionDurationHours: input.AuctionDurationHours}, nil
				},
			}
			s := NewListingService(repo)
			l, err := s.CreateListing(context.Background(), "seller-1", domain.CreateListingInput{
				Title: "Bike", CategoryID: "cat-1", StartingPriceCents: 1000,
				AuctionDurationHours: h,
			})
			require.NoError(t, err)
			assert.True(t, called)
			assert.Equal(t, "l-1", l.ID)
		})
	}
}

func fmtHours(h int32) string {
	switch h {
	case 24:
		return "24h"
	case 48:
		return "48h"
	case 168:
		return "7-day"
	default:
		return "?"
	}
}

// --- CancelListing bid-bond closeout ---

func TestCancelListing_ReleasesAllAuthorizedBidBonds(t *testing.T) {
	t.Parallel()
	var releaseListingID, releaseExclude string
	var releaseCalls int
	repo := &mockListingRepo{
		cancelListingFn: func(ctx context.Context, listingID, sellerID, reason string) (*domain.Listing, error) {
			return &domain.Listing{ID: listingID, SellerID: sellerID, Status: "cancelled"}, nil
		},
		releaseBondsFn: func(ctx context.Context, listingID, excludeUserID string) (int64, error) {
			releaseCalls++
			releaseListingID = listingID
			releaseExclude = excludeUserID
			return 3, nil
		},
	}
	s := NewListingService(repo)
	l, err := s.CancelListing(context.Background(), "listing-1", "seller-1", "changed mind")
	require.NoError(t, err)
	assert.Equal(t, "cancelled", l.Status)
	assert.Equal(t, 1, releaseCalls, "must release bonds once after successful cancel")
	assert.Equal(t, "listing-1", releaseListingID)
	assert.Equal(t, "", releaseExclude, "cancel has no winner — release everyone")
}

func TestCancelListing_BondReleaseFailSoft(t *testing.T) {
	t.Parallel()
	// Cancel already committed at the repo; bond release must not poison the result.
	repo := &mockListingRepo{
		cancelListingFn: func(ctx context.Context, listingID, sellerID, reason string) (*domain.Listing, error) {
			return &domain.Listing{ID: listingID, SellerID: sellerID, Status: "cancelled"}, nil
		},
		releaseBondsFn: func(ctx context.Context, listingID, excludeUserID string) (int64, error) {
			return 0, errors.New("db down")
		},
	}
	s := NewListingService(repo)
	l, err := s.CancelListing(context.Background(), "listing-2", "seller-1", "policy")
	require.NoError(t, err, "bond release failure is fail-soft")
	assert.Equal(t, "cancelled", l.Status)
}

func TestCancelListing_RepoErrorSkipsBondRelease(t *testing.T) {
	t.Parallel()
	releaseCalls := 0
	repo := &mockListingRepo{
		cancelListingFn: func(ctx context.Context, listingID, sellerID, reason string) (*domain.Listing, error) {
			return nil, errors.New("not found")
		},
		releaseBondsFn: func(ctx context.Context, listingID, excludeUserID string) (int64, error) {
			releaseCalls++
			return 0, nil
		},
	}
	s := NewListingService(repo)
	_, err := s.CancelListing(context.Background(), "listing-x", "seller-1", "n/a")
	require.Error(t, err)
	assert.Equal(t, 0, releaseCalls, "must not release bonds when cancel itself failed")
}

// --- PlaceListingBid forward-direction tests ---

func TestPlaceListingBid_RejectsZeroAmount(t *testing.T) {
	t.Parallel()
	s := NewListingService(&mockListingRepo{})
	_, err := s.PlaceListingBid(context.Background(), domain.PlaceListingBidInput{
		ListingID: "l-1", BidderID: "b-1", AmountCents: 0,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "amount must be positive")
}

func TestPlaceListingBid_RejectsMissingBidder(t *testing.T) {
	t.Parallel()
	s := NewListingService(&mockListingRepo{})
	_, err := s.PlaceListingBid(context.Background(), domain.PlaceListingBidInput{
		ListingID: "l-1", AmountCents: 1000,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "bidder_id required")
}

func TestPlaceListingBid_PropagatesBelowCurrent(t *testing.T) {
	t.Parallel()
	repo := &mockListingRepo{
		placeBidFn: func(ctx context.Context, input domain.PlaceListingBidInput) (*domain.PlaceListingBidResult, error) {
			return nil, domain.ErrBidBelowCurrent
		},
	}
	s := NewListingService(repo)
	_, err := s.PlaceListingBid(context.Background(), domain.PlaceListingBidInput{
		ListingID: "l-1", BidderID: "b-1", AmountCents: 1000,
	})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrBidBelowCurrent))
}

func TestPlaceListingBid_PropagatesBelowStarting(t *testing.T) {
	t.Parallel()
	repo := &mockListingRepo{
		placeBidFn: func(ctx context.Context, input domain.PlaceListingBidInput) (*domain.PlaceListingBidResult, error) {
			return nil, domain.ErrBidBelowStarting
		},
	}
	s := NewListingService(repo)
	_, err := s.PlaceListingBid(context.Background(), domain.PlaceListingBidInput{
		ListingID: "l-1", BidderID: "b-1", AmountCents: 500,
	})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrBidBelowStarting))
}

func TestPlaceListingBid_PassesSnipeExtensionThrough(t *testing.T) {
	t.Parallel()
	end := time.Now().Add(5 * time.Minute)
	repo := &mockListingRepo{
		placeBidFn: func(ctx context.Context, input domain.PlaceListingBidInput) (*domain.PlaceListingBidResult, error) {
			return &domain.PlaceListingBidResult{
				Bid:                     &domain.ListingBid{ID: "b-1", AmountCents: input.AmountCents, Status: "active"},
				SnipeExtensionTriggered: true,
				NewAuctionEndsAt:        end,
				SnipeExtensionCount:     1,
			}, nil
		},
	}
	s := NewListingService(repo)
	res, err := s.PlaceListingBid(context.Background(), domain.PlaceListingBidInput{
		ListingID: "l-1", BidderID: "b-1", AmountCents: 5000,
	})
	require.NoError(t, err)
	assert.True(t, res.SnipeExtensionTriggered)
	assert.Equal(t, int32(1), res.SnipeExtensionCount)
	assert.WithinDuration(t, end, res.NewAuctionEndsAt, time.Second)
}

// --- ListListings radius clamp ---

func TestListListings_ClampsRadiusTo25Miles(t *testing.T) {
	t.Parallel()
	repo := &mockListingRepo{}
	s := NewListingService(repo)
	huge := 1000.0
	_, _, err := s.ListListings(context.Background(), domain.ListListingsInput{RadiusMiles: &huge})
	require.NoError(t, err)
	require.NotNil(t, repo.lastListListingsArgs)
	require.NotNil(t, repo.lastListListingsArgs.RadiusMiles)
	assert.Equal(t, 25.0, *repo.lastListListingsArgs.RadiusMiles)
}

// --- listingDistanceMiles ---

func TestListingDistanceMiles(t *testing.T) {
	t.Parallel()
	// SF to LA — roughly 347 miles.
	d := listingDistanceMiles(37.7749, -122.4194, 34.0522, -118.2437)
	assert.InDelta(t, 347, d, 5)
}

// --- freshAuctionEnd ---

func TestFreshAuctionEnd(t *testing.T) {
	t.Parallel()
	got := freshAuctionEnd(24)
	expected := time.Now().Add(24 * time.Hour)
	assert.WithinDuration(t, expected, got, 2*time.Second)
}

// --- CloseEndedAuctions (auction-close worker) ---

// closeOutcome models what the repo's CloseListingAuction would return for a
// given listing, plus a stateful "already closed" flag so the same fake can
// exercise the idempotent re-run path.
type closeOutcome struct {
	listing *domain.Listing
	order   *domain.ListingOrder // nil → expired (no sale)
	closed  bool                 // flips true after the first close
}

// fakeCloseRepo is a mock that drives CloseEndedAuctions deterministically:
// FindEndedAuctions returns the listing ids whose outcome is not yet closed,
// and CloseListingAuction returns the configured outcome and marks it closed
// (so a second worker pass finds nothing and creates no second order).
func newFakeCloseRepo(outcomes map[string]*closeOutcome, order []string) *mockListingRepo {
	var closeCalls int
	return &mockListingRepo{
		findEndedFn: func(_ context.Context, _ int) ([]string, error) {
			var ids []string
			for _, id := range order {
				if oc := outcomes[id]; oc != nil && !oc.closed {
					ids = append(ids, id)
				}
			}
			return ids, nil
		},
		closeAuctionFn: func(_ context.Context, id string) (*domain.Listing, *domain.ListingOrder, error) {
			closeCalls++
			oc := outcomes[id]
			if oc == nil {
				return nil, nil, errors.New("unexpected close for " + id)
			}
			oc.closed = true // status-guard analog: never awards twice
			return oc.listing, oc.order, nil
		},
	}
}

func TestCloseEndedAuctions_WinnerCreatesExactlyOneOrder(t *testing.T) {
	t.Parallel()
	outcomes := map[string]*closeOutcome{
		"won": {
			listing: &domain.Listing{ID: "won", SellerID: "seller", Title: "Bike", Status: "sold"},
			order: &domain.ListingOrder{
				ID: "order-1", ListingID: "won", SellerID: "seller",
				BuyerID: "buyer", AmountCents: 15500, FeeCents: 1550, EscrowStatus: "pending_payment",
			},
		},
	}
	repo := newFakeCloseRepo(outcomes, []string{"won"})
	s := NewListingService(repo)

	closed, expired, err := s.CloseEndedAuctions(context.Background(), 100)
	require.NoError(t, err)
	assert.Equal(t, 1, closed, "one auction closed with an order")
	assert.Equal(t, 0, expired)

	// Money-safety: a re-run must be a no-op — no second order.
	closed2, expired2, err := s.CloseEndedAuctions(context.Background(), 100)
	require.NoError(t, err)
	assert.Equal(t, 0, closed2, "re-run must not re-close (no double order)")
	assert.Equal(t, 0, expired2)
}

func TestCloseEndedAuctions_NoBidsExpiresNoOrder(t *testing.T) {
	t.Parallel()
	outcomes := map[string]*closeOutcome{
		"nobids": {
			listing: &domain.Listing{ID: "nobids", SellerID: "seller", Title: "Lamp", Status: "expired"},
			order:   nil, // no sale
		},
	}
	repo := newFakeCloseRepo(outcomes, []string{"nobids"})
	s := NewListingService(repo)

	closed, expired, err := s.CloseEndedAuctions(context.Background(), 100)
	require.NoError(t, err)
	assert.Equal(t, 0, closed, "no order created for a no-bid auction")
	assert.Equal(t, 1, expired)
}

func TestCloseEndedAuctions_ReserveNotMetExpiresNoOrder(t *testing.T) {
	t.Parallel()
	// Repo returns nil order when the high bid is below reserve — same shape
	// as the no-bids expiry. The worker must treat it as a no-sale (no money).
	outcomes := map[string]*closeOutcome{
		"reserve": {
			listing: &domain.Listing{ID: "reserve", SellerID: "seller", Title: "Watch", Status: "expired"},
			order:   nil,
		},
	}
	repo := newFakeCloseRepo(outcomes, []string{"reserve"})
	s := NewListingService(repo)

	closed, expired, err := s.CloseEndedAuctions(context.Background(), 100)
	require.NoError(t, err)
	assert.Equal(t, 0, closed, "reserve-not-met must not create an order")
	assert.Equal(t, 1, expired)
}

func TestCloseEndedAuctions_FailSoftContinuesPastBadListing(t *testing.T) {
	t.Parallel()
	// One listing errors on close; the worker must log+skip and still close
	// the healthy one. A poisoned row never stalls the batch.
	repo := &mockListingRepo{
		findEndedFn: func(_ context.Context, _ int) ([]string, error) {
			return []string{"bad", "good"}, nil
		},
		closeAuctionFn: func(_ context.Context, id string) (*domain.Listing, *domain.ListingOrder, error) {
			if id == "bad" {
				return nil, nil, errors.New("boom")
			}
			return &domain.Listing{ID: "good", Status: "sold"},
				&domain.ListingOrder{ID: "o-good", ListingID: "good", EscrowStatus: "held",
					BuyerID: "b", SellerID: "s", AmountCents: 1000, FeeCents: 50}, nil
		},
	}
	s := NewListingService(repo)

	closed, expired, err := s.CloseEndedAuctions(context.Background(), 100)
	require.NoError(t, err, "a single bad listing must not fail the whole tick")
	assert.Equal(t, 1, closed, "the healthy listing still closes")
	assert.Equal(t, 0, expired)
}

func TestCloseEndedAuctions_EmptyBatchIsNoop(t *testing.T) {
	t.Parallel()
	repo := &mockListingRepo{
		findEndedFn: func(_ context.Context, _ int) ([]string, error) { return nil, nil },
	}
	s := NewListingService(repo)
	closed, expired, err := s.CloseEndedAuctions(context.Background(), 100)
	require.NoError(t, err)
	assert.Equal(t, 0, closed)
	assert.Equal(t, 0, expired)
}
