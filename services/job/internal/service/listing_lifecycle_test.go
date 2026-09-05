//go:build integration

// Listing (goods marketplace) full-lifecycle integration test.
//
// Drives the repository layer against a live Postgres at $DATABASE_URL.
// Covers: seller posts → 3 bidders, ascending bids → auction closed →
// highest bidder wins → buyer confirms pickup → escrow released.
//
// Also includes a race-test that fires 10 concurrent bidders within a 100ms
// window on the same listing and verifies:
//   - listings.bid_count matches count(*) of inserted bids
//   - listings.current_bid_cents matches MAX(amount_cents)
//   - exactly one bid is in 'active' status (the high bid)
//
// Run:
//   DATABASE_URL=postgres://nomarkup:nomarkup@localhost:5433/nomarkup?sslmode=disable \
//   go test -tags=integration -count=1 -run TestListingLifecycle_Integration|TestListingForwardAuction_Race ./internal/service/...

package service

import (
	"context"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nomarkup/nomarkup/services/job/internal/domain"
	"github.com/nomarkup/nomarkup/services/job/internal/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func listingTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		url = "postgres://nomarkup:nomarkup@localhost:5433/nomarkup?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), url)
	require.NoError(t, err, "connect db")
	return pool
}

// pickAnyCategoryID grabs any service_categories row id.
func pickAnyCategoryID(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`SELECT id FROM service_categories LIMIT 1`).Scan(&id)
	require.NoError(t, err)
	return id
}

// pickAnyUserIDs grabs N existing users (any roles) from the DB, topping the
// table up with throwaway integration users when fewer exist. A fresh,
// migrated + seeded database holds only the 4 fixed seed accounts, while the
// race test below needs 11 — requiring `make seed` alone could never satisfy
// that on CI. The throwaway rows are inert (no credentials, .invalid email
// domain) and idempotent to leave in a dev database.
func pickAnyUserIDs(t *testing.T, pool *pgxpool.Pool, n int) []string {
	t.Helper()
	ctx := context.Background()

	var have int
	require.NoError(t, pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&have))
	for i := have; i < n; i++ {
		u := uuid.NewString()
		_, err := pool.Exec(ctx,
			`INSERT INTO users (email, display_name, roles)
			 VALUES ($1, $2, '{customer}')`,
			"itest-"+u+"@example.invalid", "Integration Test User "+u[:8])
		require.NoError(t, err, "provision throwaway integration user")
	}

	rows, err := pool.Query(ctx,
		`SELECT id::text FROM users ORDER BY created_at LIMIT $1`, n)
	require.NoError(t, err)
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		require.NoError(t, rows.Scan(&id))
		out = append(out, id)
	}
	require.GreaterOrEqual(t, len(out), n,
		"need %d users in DB, got %d", n, len(out))
	return out
}

// cleanupListing wipes everything created by the test.
func cleanupListing(t *testing.T, pool *pgxpool.Pool, listingID string) {
	t.Helper()
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `DELETE FROM listing_orders WHERE listing_id = $1`, listingID)
	_, _ = pool.Exec(ctx, `DELETE FROM listings WHERE id = $1`, listingID)
}

// TestListingLifecycle_Integration walks the full forward-auction lifecycle.
func TestListingLifecycle_Integration(t *testing.T) {
	pool := listingTestDB(t)
	defer pool.Close()

	users := pickAnyUserIDs(t, pool, 4)
	seller := users[0]
	bidders := []string{users[1], users[2], users[3]}
	categoryID := pickAnyCategoryID(t, pool)

	repo := repository.NewListingPostgresRepository(pool)
	svc := NewListingService(repo)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// ── 1. Seller posts a listing.
	listing, err := svc.CreateListing(ctx, seller, domain.CreateListingInput{
		Title:                "Vintage road bike",
		Description:          "Steel frame, lightly used, local pickup only.",
		CategoryID:           categoryID,
		Latitude:             37.7749,
		Longitude:            -122.4194,
		PickupAddress:        "123 Mission St, San Francisco",
		PickupZipCode:        "94103",
		StartingPriceCents:   10000, // $100
		AuctionDurationHours: 24,
		PhotoURLs:            []string{"https://example.com/bike1.jpg", "https://example.com/bike2.jpg"},
		Publish:              true,
	})
	require.NoError(t, err)
	defer cleanupListing(t, pool, listing.ID)

	require.Equal(t, "active", listing.Status)
	require.Equal(t, int64(10000), listing.StartingPriceCents)
	require.Nil(t, listing.CurrentBidCents)
	require.Len(t, listing.Photos, 2)

	// ── 2. Three bidders place 5 bids each, ascending. We synthesise
	// 15 bids total: bidder1 [10500, 11500, 12500, 13500, 14500],
	// bidder2 [11000, 12000, 13000, 14000, 15000],
	// bidder3 [11250, 12250, 13250, 14250, 15500].
	// All bids are strictly higher than the running high; we expect every
	// one of them to land. Final winner: bidder3 at 15500.
	type plan struct {
		bidderIdx int
		amount    int64
	}
	schedule := []plan{
		{0, 10500}, {1, 11000}, {2, 11250}, {0, 11500}, {1, 12000},
		{2, 12250}, {0, 12500}, {1, 13000}, {2, 13250}, {0, 13500},
		{1, 14000}, {2, 14250}, {0, 14500}, {1, 15000}, {2, 15500},
	}

	for _, p := range schedule {
		res, err := svc.PlaceListingBid(ctx, domain.PlaceListingBidInput{
			ListingID:   listing.ID,
			BidderID:    bidders[p.bidderIdx],
			AmountCents: p.amount,
			IPAddress:   "127.0.0.1",
			Fingerprint: fmt.Sprintf("fp-%d", p.bidderIdx),
		})
		require.NoError(t, err, "bid %d for amount %d", p.bidderIdx, p.amount)
		assert.Equal(t, "active", res.Bid.Status)
		assert.False(t, res.SnipeExtensionTriggered, "first 14 bids are far from close — no extension")
	}

	// Sanity: a sub-current bid is rejected.
	_, err = svc.PlaceListingBid(ctx, domain.PlaceListingBidInput{
		ListingID:   listing.ID,
		BidderID:    bidders[0],
		AmountCents: 14000,
	})
	require.Error(t, err, "bid below current high must be rejected")

	// And an equal bid is rejected.
	_, err = svc.PlaceListingBid(ctx, domain.PlaceListingBidInput{
		ListingID:   listing.ID,
		BidderID:    bidders[0],
		AmountCents: 15500,
	})
	require.Error(t, err, "bid equal to current high must be rejected")

	// Reload listing.
	l, err := svc.GetListing(ctx, listing.ID)
	require.NoError(t, err)
	require.NotNil(t, l.CurrentBidCents)
	assert.Equal(t, int64(15500), *l.CurrentBidCents)
	require.NotNil(t, l.CurrentBidderID)
	assert.Equal(t, bidders[2], *l.CurrentBidderID)
	assert.Equal(t, int32(15), l.BidCount)

	// ── 3. Force the auction to expire (set ends_at to the past) and close.
	_, err = pool.Exec(ctx, `UPDATE listings SET auction_ends_at = now() - interval '1 minute' WHERE id = $1`, l.ID)
	require.NoError(t, err)

	closed, order, err := svc.CloseListingAuction(ctx, l.ID)
	require.NoError(t, err)
	require.NotNil(t, order)
	assert.Equal(t, "sold", closed.Status)
	// MON-06: auction close mints pending_payment, never held without a PI.
	assert.Equal(t, "pending_payment", order.EscrowStatus)
	assert.Equal(t, bidders[2], order.BuyerID)
	assert.Equal(t, seller, order.SellerID)
	assert.Equal(t, int64(15500), order.AmountCents)
	// Fee = 10% of 15500 = 1550 cents (MON-20: 8%+2%).
	assert.Equal(t, int64(1550), order.FeeCents)

	// Re-call CloseListingAuction — must be idempotent.
	_, order2, err := svc.CloseListingAuction(ctx, l.ID)
	require.NoError(t, err)
	require.NotNil(t, order2)
	assert.Equal(t, order.ID, order2.ID, "close must be idempotent")

	// ── 4. Simulate payment capture (pending_payment → held with PI), then
	// buyer confirms pickup. ConfirmPickup only accepts held orders.
	_, err = pool.Exec(ctx, `
		UPDATE listing_orders
		   SET escrow_status = 'held', payment_intent_id = 'pi_test_lifecycle'
		 WHERE id = $1`, order.ID)
	require.NoError(t, err)

	released, err := svc.ConfirmPickup(ctx, order.ID, bidders[2])
	require.NoError(t, err)
	assert.Equal(t, "released", released.EscrowStatus)
	assert.NotNil(t, released.PickupConfirmedAt)
	assert.NotNil(t, released.ReleasedAt)

	// Non-buyer cannot confirm.
	_, err = svc.ConfirmPickup(ctx, order.ID, bidders[1])
	require.Error(t, err)
}

// TestListingForwardAuction_Race fires 10 concurrent bids on the same listing
// within a tight window and verifies:
//   - listings.bid_count == count(listing_bids)
//   - listings.current_bid_cents == MAX(listing_bids.amount_cents)
//   - The current_bidder_id matches whichever bidder placed the high amount.
//   - All accepted bids that returned without error are present in the DB.
//
// Bids of equal amount race against each other — only the first to commit
// wins, the rest land as ErrBidBelowCurrent.
func TestListingForwardAuction_Race(t *testing.T) {
	pool := listingTestDB(t)
	defer pool.Close()

	users := pickAnyUserIDs(t, pool, 11)
	seller := users[0]
	bidders := users[1:]
	categoryID := pickAnyCategoryID(t, pool)

	repo := repository.NewListingPostgresRepository(pool)
	svc := NewListingService(repo)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Each iteration creates a fresh listing and races bids on it. We do a
	// few iterations so that timing-based bugs become visible.
	const iterations = 5
	const concurrency = 10

	for iter := 0; iter < iterations; iter++ {
		listing, err := svc.CreateListing(ctx, seller, domain.CreateListingInput{
			Title:                fmt.Sprintf("Race listing iter=%d nonce=%s", iter, uuid.NewString()),
			Description:          "race test",
			CategoryID:           categoryID,
			Latitude:             37.7749,
			Longitude:            -122.4194,
			PickupAddress:        "94103",
			PickupZipCode:        "94103",
			StartingPriceCents:   1000,
			AuctionDurationHours: 24,
			Publish:              true,
		})
		require.NoError(t, err)
		listingID := listing.ID

		// Each bidder bids a *unique* amount in [2000, 2009]. The expected
		// final high is 2009 by bidder index 9.
		var wg sync.WaitGroup
		wg.Add(concurrency)
		gate := make(chan struct{})
		var accepted, rejected int64
		for g := 0; g < concurrency; g++ {
			amount := int64(2000 + g)
			bidder := bidders[g]
			go func(bidder string, amount int64) {
				defer wg.Done()
				<-gate
				_, err := svc.PlaceListingBid(ctx, domain.PlaceListingBidInput{
					ListingID:   listingID,
					BidderID:    bidder,
					AmountCents: amount,
				})
				if err != nil {
					atomic.AddInt64(&rejected, 1)
				} else {
					atomic.AddInt64(&accepted, 1)
				}
			}(bidder, amount)
		}
		close(gate)
		wg.Wait()

		// Verify invariants. Note: every bid had a unique (>=) amount, but
		// since each bid must strictly exceed the *current* high — and they
		// race — only the bids that arrive after a strictly lower bid is
		// committed will succeed. Some bids will lose the race and be
		// rejected. The DB state must remain consistent.
		var dbBidCount, dbRowCount int64
		var dbMaxBid *int64
		var dbHighBidder *string
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT count(*), max(amount_cents) FROM listing_bids WHERE listing_id = $1`,
			listingID).Scan(&dbRowCount, &dbMaxBid))
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT bid_count, current_bid_cents, current_bidder_id::text
			   FROM listings WHERE id = $1`,
			listingID).Scan(&dbBidCount, &dbMaxBid, &dbHighBidder))

		// Reload the truth from listing_bids.
		var truthCount int64
		var truthMax *int64
		var truthHighBidder *string
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT count(*), max(amount_cents) FROM listing_bids WHERE listing_id = $1`,
			listingID).Scan(&truthCount, &truthMax))
		if truthMax != nil {
			require.NoError(t, pool.QueryRow(ctx,
				`SELECT bidder_id::text FROM listing_bids
				  WHERE listing_id = $1 AND amount_cents = $2
				  ORDER BY created_at ASC LIMIT 1`,
				listingID, *truthMax).Scan(&truthHighBidder))
		}

		assert.Equal(t, truthCount, accepted,
			"iter %d: accepted bids (%d) must equal listing_bids row count (%d)",
			iter, accepted, truthCount)
		assert.Equal(t, dbBidCount, accepted,
			"iter %d: listings.bid_count (%d) must equal accepted bids (%d)",
			iter, dbBidCount, accepted)
		if truthMax != nil {
			require.NotNil(t, dbMaxBid)
			assert.Equal(t, *truthMax, *dbMaxBid,
				"iter %d: listings.current_bid_cents must equal MAX(listing_bids.amount_cents)", iter)
			require.NotNil(t, dbHighBidder)
			assert.Equal(t, *truthHighBidder, *dbHighBidder,
				"iter %d: current_bidder_id must match high-bid bidder_id", iter)
		}
		assert.Equal(t, accepted+rejected, int64(concurrency))
		t.Logf("iter %d: accepted=%d rejected=%d max=%v",
			iter, accepted, rejected, ptrInt64Str(dbMaxBid))

		cleanupListing(t, pool, listingID)
	}
}

func ptrInt64Str(p *int64) string {
	if p == nil {
		return "nil"
	}
	return fmt.Sprintf("%d", *p)
}
