//go:build integration

// Auction-close worker integration tests — drive the repository + service
// against a live Postgres at $DATABASE_URL.
//
// Covers the gaps the worker (CloseEndedAuctions) depends on, end-to-end
// against real SQL (FOR UPDATE lock, status guard, UNIQUE(listing_id),
// reserve check, expired transition):
//
//   - winning bid at/above reserve → exactly ONE listing_orders row + sold;
//     a worker re-run is an idempotent no-op (no second order).
//   - no bids → expired, no order.
//   - high bid BELOW reserve → expired, no order, no money.
//   - FindEndedAuctions surfaces only past-deadline active listings and
//     stops surfacing one once it has been closed.
//
// Run:
//   DATABASE_URL=postgres://nomarkup@localhost:5433/nomarkup?sslmode=disable \
//   go test -tags=integration -count=1 \
//     -run 'TestCloseEndedAuctions_(Integration|Reserve|NoBids)' ./internal/service/...

package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/nomarkup/nomarkup/services/job/internal/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCloseEndedAuctions_Integration walks the worker's happy path end to end:
// a real ended auction with a winning bid → exactly one escrow order + sold,
// and a worker re-run does nothing (money-safety: no double order).
func TestCloseEndedAuctions_Integration(t *testing.T) {
	pool := listingTestDB(t)
	defer pool.Close()

	users := pickAnyUserIDs(t, pool, 2)
	seller, buyer := users[0], users[1]
	categoryID := pickAnyCategoryID(t, pool)

	repo := repository.NewListingPostgresRepository(pool)
	svc := NewListingService(repo)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	listing, err := svc.CreateListing(ctx, seller, domain.CreateListingInput{
		Title:                "Worker close — winner " + uuid.NewString(),
		Description:          "integration",
		CategoryID:           categoryID,
		Latitude:             37.7749,
		Longitude:            -122.4194,
		PickupAddress:        "94103",
		PickupZipCode:        "94103",
		StartingPriceCents:   10000,
		AuctionDurationHours: 24,
		Publish:              true,
	})
	require.NoError(t, err)
	defer cleanupListing(t, pool, listing.ID)

	_, err = svc.PlaceListingBid(ctx, domain.PlaceListingBidInput{
		ListingID: listing.ID, BidderID: buyer, AmountCents: 12000,
	})
	require.NoError(t, err)

	// Force the deadline into the past.
	_, err = pool.Exec(ctx,
		`UPDATE listings SET auction_ends_at = now() - interval '1 minute' WHERE id = $1`, listing.ID)
	require.NoError(t, err)

	// FindEndedAuctions must surface it.
	ids, err := repo.FindEndedAuctions(ctx, 500)
	require.NoError(t, err)
	assert.Contains(t, ids, listing.ID, "ended active auction must be found")

	// Worker pass closes it.
	closed, expired, err := svc.CloseEndedAuctions(ctx, 500)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, closed, 1)
	_ = expired

	// Exactly one order, listing sold.
	var orderCount int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM listing_orders WHERE listing_id = $1`, listing.ID).Scan(&orderCount))
	assert.Equal(t, 1, orderCount, "exactly one escrow order")

	var status string
	var escrow string
	var amount, fee int64
	var buyerID string
	require.NoError(t, pool.QueryRow(ctx, `SELECT status FROM listings WHERE id = $1`, listing.ID).Scan(&status))
	assert.Equal(t, "sold", status)
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT escrow_status, amount_cents, fee_cents, buyer_id::text
		   FROM listing_orders WHERE listing_id = $1`, listing.ID).
		Scan(&escrow, &amount, &fee, &buyerID))
	assert.Equal(t, "pending_payment", escrow)
	assert.Equal(t, int64(12000), amount)
	assert.Equal(t, int64(1200), fee, "10%% of 12000 = 1200 (8%%+2%%)")
	assert.Equal(t, buyer, buyerID)

	// Money-safety: a worker re-run must NOT create a second order.
	ids2, err := repo.FindEndedAuctions(ctx, 500)
	require.NoError(t, err)
	assert.NotContains(t, ids2, listing.ID, "a sold listing is no longer 'ended active'")

	_, _, err = svc.CloseEndedAuctions(ctx, 500)
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM listing_orders WHERE listing_id = $1`, listing.ID).Scan(&orderCount))
	assert.Equal(t, 1, orderCount, "re-run must not double the order")
}

// TestCloseEndedAuctions_ReserveNotMet: a high bid below the seller's reserve
// closes the auction with NO sale — expired, no order, no money moved.
func TestCloseEndedAuctions_ReserveNotMet(t *testing.T) {
	pool := listingTestDB(t)
	defer pool.Close()

	users := pickAnyUserIDs(t, pool, 2)
	seller, bidder := users[0], users[1]
	categoryID := pickAnyCategoryID(t, pool)

	repo := repository.NewListingPostgresRepository(pool)
	svc := NewListingService(repo)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	listing, err := svc.CreateListing(ctx, seller, domain.CreateListingInput{
		Title:                "Worker close — reserve not met " + uuid.NewString(),
		Description:          "integration",
		CategoryID:           categoryID,
		Latitude:             37.7749,
		Longitude:            -122.4194,
		PickupAddress:        "94103",
		PickupZipCode:        "94103",
		StartingPriceCents:   10000,
		AuctionDurationHours: 24,
		Publish:              true,
	})
	require.NoError(t, err)
	defer cleanupListing(t, pool, listing.ID)

	// Set a reserve well above what the bidder will pay.
	_, err = pool.Exec(ctx,
		`UPDATE listings SET reserve_price_cents = 50000 WHERE id = $1`, listing.ID)
	require.NoError(t, err)

	_, err = svc.PlaceListingBid(ctx, domain.PlaceListingBidInput{
		ListingID: listing.ID, BidderID: bidder, AmountCents: 12000,
	})
	require.NoError(t, err)

	_, err = pool.Exec(ctx,
		`UPDATE listings SET auction_ends_at = now() - interval '1 minute' WHERE id = $1`, listing.ID)
	require.NoError(t, err)

	closed, expired, err := svc.CloseEndedAuctions(ctx, 500)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, expired, 1)
	_ = closed

	var status string
	require.NoError(t, pool.QueryRow(ctx, `SELECT status FROM listings WHERE id = $1`, listing.ID).Scan(&status))
	assert.Equal(t, "expired", status, "reserve-not-met auction expires")

	var orderCount int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM listing_orders WHERE listing_id = $1`, listing.ID).Scan(&orderCount))
	assert.Equal(t, 0, orderCount, "reserve not met → NO order, no money moved")
}

// TestCloseEndedAuctions_NoBids: an auction that simply ends with no bids
// expires with no order.
func TestCloseEndedAuctions_NoBids(t *testing.T) {
	pool := listingTestDB(t)
	defer pool.Close()

	users := pickAnyUserIDs(t, pool, 1)
	seller := users[0]
	categoryID := pickAnyCategoryID(t, pool)

	repo := repository.NewListingPostgresRepository(pool)
	svc := NewListingService(repo)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	listing, err := svc.CreateListing(ctx, seller, domain.CreateListingInput{
		Title:                fmt.Sprintf("Worker close — no bids %s", uuid.NewString()),
		Description:          "integration",
		CategoryID:           categoryID,
		Latitude:             37.7749,
		Longitude:            -122.4194,
		PickupAddress:        "94103",
		PickupZipCode:        "94103",
		StartingPriceCents:   10000,
		AuctionDurationHours: 24,
		Publish:              true,
	})
	require.NoError(t, err)
	defer cleanupListing(t, pool, listing.ID)

	_, err = pool.Exec(ctx,
		`UPDATE listings SET auction_ends_at = now() - interval '1 minute' WHERE id = $1`, listing.ID)
	require.NoError(t, err)

	_, expired, err := svc.CloseEndedAuctions(ctx, 500)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, expired, 1)

	var status string
	require.NoError(t, pool.QueryRow(ctx, `SELECT status FROM listings WHERE id = $1`, listing.ID).Scan(&status))
	assert.Equal(t, "expired", status)

	var orderCount int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT count(*) FROM listing_orders WHERE listing_id = $1`, listing.ID).Scan(&orderCount))
	assert.Equal(t, 0, orderCount, "no bids → no order")
}
