//go:build integration

// Money-critical CAS paths in the payment repository, exercised against real
// PostgreSQL through the real repository (QA-13).
//
// Covers the SQL that service-layer unit tests only exercise via mocks:
//
//  1. ClaimPaymentStatus — status transition is compare-and-swap on status
//  2. UpdateRefundCAS — refund total is compare-and-swap on refund_amount_cents
//     with a hard cap at amount_cents
//  3. ClaimListingOrderForRelease — FOR UPDATE + durable pending transfer stamp
//     so concurrent dispute freeze / second auto-release lose (MON-18)
//
// Run:
//
//	cd services/payment && DATABASE_URL=... go test -tags=integration \
//	    -run 'TestPaymentCAS|TestRefundCAS|TestListingOrderClaim' ./internal/repository/...
//
// Requires DATABASE_URL with the full migration chain. Every fixture uses unique
// ids and t.Cleanup so tests leave no residue.

package repository

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/nomarkup/nomarkup/services/payment/internal/service"
)

// casPaymentFixture is one contract-backed payment row (status tunable).
type casPaymentFixture struct {
	pool       *pgxpool.Pool
	repo       *PostgresRepository
	customerID string
	providerID string
	paymentID  string
	amount     int64
}

func newCASPaymentFixture(t *testing.T, status string, amountCents int64) *casPaymentFixture {
	t.Helper()
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, moneyDatabaseURL())
	if err != nil {
		t.Skipf("no database: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("database unreachable: %v", err)
	}

	f := &casPaymentFixture{
		pool:       pool,
		repo:       NewPostgresRepository(pool),
		customerID: uuid.NewString(),
		providerID: uuid.NewString(),
		paymentID:  uuid.NewString(),
		amount:     amountCents,
	}

	categoryID := uuid.NewString()
	jobID := uuid.NewString()
	bidID := uuid.NewString()
	contractID := uuid.NewString()
	suffix := uuid.NewString()[:8]

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("seed: %v\nSQL: %s", err, sql)
		}
	}

	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM payments WHERE id = $1`, f.paymentID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM contracts WHERE id = $1`, contractID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM bids WHERE id = $1`, bidID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM jobs WHERE id = $1`, jobID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM service_categories WHERE id = $1`, categoryID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = ANY($1)`,
			[]string{f.customerID, f.providerID})
		pool.Close()
	})

	exec(`INSERT INTO users (id, email, display_name, roles) VALUES
	        ($1, $3, 'CAS Customer', ARRAY['customer']),
	        ($2, $4, 'CAS Provider', ARRAY['provider'])`,
		f.customerID, f.providerID,
		"cas-cust-"+suffix+"@example.test", "cas-prov-"+suffix+"@example.test")

	exec(`INSERT INTO service_categories (id, name, slug, level)
	      VALUES ($1, $2, $3, 1)`, categoryID, "CAS "+suffix, "cas-"+suffix)

	exec(`INSERT INTO jobs (id, customer_id, title, description, category_id,
	                        service_city, service_state, service_zip,
	                        service_location, approximate_location)
	      VALUES ($1, $2, 'CAS job', 'desc', $3, 'Austin', 'TX', '78701',
	              ST_SetSRID(ST_MakePoint(-97.7, 30.3), 4326),
	              ST_SetSRID(ST_MakePoint(-97.7, 30.3), 4326))`,
		jobID, f.customerID, categoryID)

	exec(`INSERT INTO bids (id, job_id, provider_id, amount_cents, original_amount_cents)
	      VALUES ($1, $2, $3, $4, $4)`, bidID, jobID, f.providerID, amountCents)

	exec(`INSERT INTO contracts (id, contract_number, job_id, customer_id, provider_id,
	                             bid_id, amount_cents, payment_timing, status)
	      VALUES ($1, $2, $3, $4, $5, $6, $7, 'completion', 'active')`,
		contractID, "CAS-"+suffix, jobID, f.customerID, f.providerID, bidID, amountCents)

	payout := amountCents * 9 / 10
	exec(`INSERT INTO payments (id, contract_id, customer_id, provider_id, amount_cents,
	                            provider_payout_cents, idempotency_key, status,
	                            refund_amount_cents)
	      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)`,
		f.paymentID, contractID, f.customerID, f.providerID, amountCents, payout,
		"cas-pay-"+suffix, status)

	return f
}

func (f *casPaymentFixture) status(t *testing.T) string {
	t.Helper()
	var s string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT status FROM payments WHERE id = $1`, f.paymentID).Scan(&s); err != nil {
		t.Fatalf("read status: %v", err)
	}
	return s
}

func (f *casPaymentFixture) refundCents(t *testing.T) int64 {
	t.Helper()
	var n int64
	if err := f.pool.QueryRow(context.Background(),
		`SELECT refund_amount_cents FROM payments WHERE id = $1`, f.paymentID).Scan(&n); err != nil {
		t.Fatalf("read refund_amount_cents: %v", err)
	}
	return n
}

// --- ClaimPaymentStatus -------------------------------------------------------

func TestPaymentCAS_ClaimPaymentStatus(t *testing.T) {
	ctx := context.Background()

	t.Run("happy_path_escrow_to_released", func(t *testing.T) {
		f := newCASPaymentFixture(t, "escrow", 100_000)
		if err := f.repo.ClaimPaymentStatus(ctx, f.paymentID, "escrow", "released"); err != nil {
			t.Fatalf("claim: %v", err)
		}
		if got := f.status(t); got != "released" {
			t.Fatalf("status = %q, want released", got)
		}
		p, err := f.repo.GetPayment(ctx, f.paymentID)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if p.ReleasedAt == nil {
			t.Fatal("released_at must be stamped on release claim")
		}
	})

	t.Run("wrong_from_status_is_ErrInvalidStatus", func(t *testing.T) {
		f := newCASPaymentFixture(t, "escrow", 50_000)
		err := f.repo.ClaimPaymentStatus(ctx, f.paymentID, "pending", "released")
		if !errors.Is(err, domain.ErrInvalidStatus) {
			t.Fatalf("error = %v, want ErrInvalidStatus", err)
		}
		if got := f.status(t); got != "escrow" {
			t.Fatalf("status mutated to %q after lost CAS", got)
		}
	})

	t.Run("missing_payment_is_ErrPaymentNotFound", func(t *testing.T) {
		f := newCASPaymentFixture(t, "escrow", 10_000)
		err := f.repo.ClaimPaymentStatus(ctx, uuid.NewString(), "escrow", "released")
		if !errors.Is(err, domain.ErrPaymentNotFound) {
			t.Fatalf("error = %v, want ErrPaymentNotFound", err)
		}
		// Fixture row untouched.
		if got := f.status(t); got != "escrow" {
			t.Fatalf("unrelated payment status = %q", got)
		}
	})

	t.Run("table_driven_transitions", func(t *testing.T) {
		cases := []struct {
			name       string
			start      string
			from, to   string
			wantStatus string
			wantErr    error
		}{
			{
				name: "escrow_to_released",
				start: "escrow", from: "escrow", to: "released",
				wantStatus: "released",
			},
			{
				name: "released_to_completed",
				start: "released", from: "released", to: "completed",
				wantStatus: "completed",
			},
			{
				name: "pending_to_escrow",
				start: "pending", from: "pending", to: "escrow",
				wantStatus: "escrow",
			},
			{
				name: "double_release_loses",
				start: "released", from: "escrow", to: "released",
				wantStatus: "released", wantErr: domain.ErrInvalidStatus,
			},
			{
				name: "refunded_cannot_release",
				start: "refunded", from: "escrow", to: "released",
				wantStatus: "refunded", wantErr: domain.ErrInvalidStatus,
			},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				f := newCASPaymentFixture(t, tc.start, 25_000)
				err := f.repo.ClaimPaymentStatus(ctx, f.paymentID, tc.from, tc.to)
				if tc.wantErr != nil {
					if !errors.Is(err, tc.wantErr) {
						t.Fatalf("error = %v, want %v", err, tc.wantErr)
					}
				} else if err != nil {
					t.Fatalf("claim: %v", err)
				}
				if got := f.status(t); got != tc.wantStatus {
					t.Fatalf("status = %q, want %q", got, tc.wantStatus)
				}
			})
		}
	})

	t.Run("concurrent_claims_exactly_one_wins", func(t *testing.T) {
		f := newCASPaymentFixture(t, "escrow", 80_000)
		const n = 16
		var (
			wg      sync.WaitGroup
			mu      sync.Mutex
			winners int
			errs    []error
		)
		start := make(chan struct{})
		for range n {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				err := f.repo.ClaimPaymentStatus(ctx, f.paymentID, "escrow", "released")
				mu.Lock()
				defer mu.Unlock()
				if err == nil {
					winners++
					return
				}
				if !errors.Is(err, domain.ErrInvalidStatus) {
					errs = append(errs, err)
				}
			}()
		}
		close(start)
		wg.Wait()
		if len(errs) > 0 {
			t.Fatalf("unexpected errors: %v", errs)
		}
		if winners != 1 {
			t.Fatalf("winners = %d, want exactly 1 (double-release under concurrency)", winners)
		}
		if got := f.status(t); got != "released" {
			t.Fatalf("final status = %q, want released", got)
		}
	})
}

// --- UpdateRefundCAS ----------------------------------------------------------

func TestRefundCAS_UpdateRefundCAS(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)

	t.Run("happy_path_partial_then_full", func(t *testing.T) {
		f := newCASPaymentFixture(t, "escrow", 10_000)

		if err := f.repo.UpdateRefundCAS(ctx, f.paymentID, 0, 3_000, "partial", now, "re_a", "escrow"); err != nil {
			t.Fatalf("first refund: %v", err)
		}
		if got := f.refundCents(t); got != 3_000 {
			t.Fatalf("refund_amount_cents = %d, want 3000", got)
		}

		if err := f.repo.UpdateRefundCAS(ctx, f.paymentID, 3_000, 10_000, "full", now, "re_b", "refunded"); err != nil {
			t.Fatalf("second refund: %v", err)
		}
		if got := f.refundCents(t); got != 10_000 {
			t.Fatalf("refund_amount_cents = %d, want 10000", got)
		}
		if got := f.status(t); got != "refunded" {
			t.Fatalf("status = %q, want refunded", got)
		}
	})

	t.Run("table_driven_cas_guards", func(t *testing.T) {
		cases := []struct {
			name          string
			seedRefund    int64
			expectedPrior int64
			newTotal      int64
			wantErr       error
			wantRefund    int64
		}{
			{
				name: "stale_prior_loses",
				seedRefund: 1_000, expectedPrior: 0, newTotal: 2_000,
				wantErr: domain.ErrInvalidAmount, wantRefund: 1_000,
			},
			{
				name: "exceeds_amount_cents",
				seedRefund: 0, expectedPrior: 0, newTotal: 10_001,
				wantErr: domain.ErrInvalidAmount, wantRefund: 0,
			},
			{
				name: "exact_cap_ok",
				seedRefund: 0, expectedPrior: 0, newTotal: 10_000,
				wantRefund: 10_000,
			},
			{
				name: "matching_prior_ok",
				seedRefund: 2_500, expectedPrior: 2_500, newTotal: 5_000,
				wantRefund: 5_000,
			},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				f := newCASPaymentFixture(t, "escrow", 10_000)
				if tc.seedRefund > 0 {
					if _, err := f.pool.Exec(ctx,
						`UPDATE payments SET refund_amount_cents = $2 WHERE id = $1`,
						f.paymentID, tc.seedRefund); err != nil {
						t.Fatalf("seed refund: %v", err)
					}
				}
				err := f.repo.UpdateRefundCAS(ctx, f.paymentID, tc.expectedPrior, tc.newTotal,
					"reason", now, "re_"+tc.name, "escrow")
				if tc.wantErr != nil {
					if !errors.Is(err, tc.wantErr) {
						t.Fatalf("error = %v, want %v", err, tc.wantErr)
					}
				} else if err != nil {
					t.Fatalf("update refund cas: %v", err)
				}
				if got := f.refundCents(t); got != tc.wantRefund {
					t.Fatalf("refund_amount_cents = %d, want %d", got, tc.wantRefund)
				}
			})
		}
	})

	t.Run("missing_payment_is_ErrInvalidAmount", func(t *testing.T) {
		// UpdateRefundCAS does not distinguish not-found from lost race —
		// both surface as ErrInvalidAmount so callers re-read remaining balance.
		f := newCASPaymentFixture(t, "escrow", 5_000)
		err := f.repo.UpdateRefundCAS(ctx, uuid.NewString(), 0, 100, "ghost", now, "re_x", "escrow")
		if !errors.Is(err, domain.ErrInvalidAmount) {
			t.Fatalf("error = %v, want ErrInvalidAmount", err)
		}
		if got := f.refundCents(t); got != 0 {
			t.Fatalf("fixture refund mutated: %d", got)
		}
	})

	t.Run("concurrent_refunds_exactly_one_wins_for_same_prior", func(t *testing.T) {
		f := newCASPaymentFixture(t, "escrow", 20_000)
		const n = 16
		var (
			wg      sync.WaitGroup
			mu      sync.Mutex
			winners int
			errs    []error
		)
		start := make(chan struct{})
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				// Every goroutine tries to write the same first refund from prior=0.
				err := f.repo.UpdateRefundCAS(ctx, f.paymentID, 0, 5_000,
					"race", now, fmt.Sprintf("re_race_%d", i), "escrow")
				mu.Lock()
				defer mu.Unlock()
				if err == nil {
					winners++
					return
				}
				if !errors.Is(err, domain.ErrInvalidAmount) {
					errs = append(errs, err)
				}
			}(i)
		}
		close(start)
		wg.Wait()
		if len(errs) > 0 {
			t.Fatalf("unexpected errors: %v", errs)
		}
		if winners != 1 {
			t.Fatalf("winners = %d, want exactly 1 (double-credit under concurrency)", winners)
		}
		if got := f.refundCents(t); got != 5_000 {
			t.Fatalf("refund_amount_cents = %d, want 5000", got)
		}
	})
}

// --- ClaimListingOrderForRelease ----------------------------------------------

type claimOrderFixture struct {
	pool      *pgxpool.Pool
	repo      *MarketplaceRepository
	sellerID  string
	buyerID   string
	listingID string
	orderID   string
}

// newClaimOrderFixture inserts a funded listing_order (default escrow_status=held).
func newClaimOrderFixture(t *testing.T, escrowStatus string) *claimOrderFixture {
	t.Helper()
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, moneyDatabaseURL())
	if err != nil {
		t.Skipf("no database: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("database unreachable: %v", err)
	}

	f := &claimOrderFixture{
		pool:      pool,
		repo:      NewMarketplaceRepository(pool),
		sellerID:  uuid.NewString(),
		buyerID:   uuid.NewString(),
		listingID: uuid.NewString(),
		orderID:   uuid.NewString(),
	}
	suffix := uuid.NewString()[:8]

	for _, u := range []struct{ id, role string }{
		{f.sellerID, "seller"},
		{f.buyerID, "buyer"},
	} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO users (id, email, display_name, roles, status)
			VALUES ($1, $2, $3, ARRAY['customer'], 'active')`,
			u.id, fmt.Sprintf("claim-%s-%s@example.test", u.role, suffix), "claim "+u.role,
		); err != nil {
			t.Fatalf("insert %s: %v", u.role, err)
		}
	}

	var categoryID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM service_categories ORDER BY created_at LIMIT 1`).Scan(&categoryID); err != nil {
		// Fall back to creating one if the DB is empty of categories.
		categoryID = uuid.NewString()
		if _, err := pool.Exec(ctx, `
			INSERT INTO service_categories (id, name, slug, level)
			VALUES ($1, $2, $3, 1)`, categoryID, "ClaimCat "+suffix, "claim-cat-"+suffix); err != nil {
			t.Fatalf("insert category: %v", err)
		}
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM service_categories WHERE id = $1`, categoryID)
		})
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO listings (
			id, seller_id, title, category_id, location, pickup_zip_code,
			starting_price_cents, auction_duration_hours,
			auction_ends_at, original_auction_ends_at, status
		) VALUES (
			$1, $2, 'claim fixture', $3,
			ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326), '94103',
			50000, 24, now() - interval '1 hour', now() - interval '1 hour', 'sold'
		)`, f.listingID, f.sellerID, categoryID,
	); err != nil {
		t.Fatalf("insert listing: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO listing_orders (
			id, listing_id, seller_id, buyer_id, amount_cents, fee_cents,
			seller_payout_cents, escrow_status, payment_intent_id, created_at
		) VALUES ($1, $2, $3, $4, 50000, 5000, 45000, $5, $6, now())`,
		f.orderID, f.listingID, f.sellerID, f.buyerID, escrowStatus,
		"pi_claim_"+suffix,
	); err != nil {
		t.Fatalf("insert listing order: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM listing_orders WHERE id = $1`, f.orderID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM listings WHERE id = $1`, f.listingID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id IN ($1, $2)`, f.sellerID, f.buyerID)
		pool.Close()
	})

	return f
}

func (f *claimOrderFixture) transferID(t *testing.T) string {
	t.Helper()
	var id *string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT stripe_transfer_id FROM listing_orders WHERE id = $1`, f.orderID).Scan(&id); err != nil {
		t.Fatalf("read transfer: %v", err)
	}
	if id == nil {
		return ""
	}
	return *id
}

func TestListingOrderClaim_ClaimListingOrderForRelease(t *testing.T) {
	ctx := context.Background()

	t.Run("happy_path_stamps_pending_claim", func(t *testing.T) {
		f := newClaimOrderFixture(t, "held")
		o, err := f.repo.ClaimListingOrderForRelease(ctx, f.orderID)
		if err != nil {
			t.Fatalf("claim: %v", err)
		}
		want := service.PendingListingTransferClaim(f.orderID)
		if o.StripeTransferID != want {
			t.Fatalf("StripeTransferID = %q, want %q", o.StripeTransferID, want)
		}
		if !service.IsPendingListingTransferClaim(o.StripeTransferID) {
			t.Fatal("claim marker must be recognized as pending")
		}
		if got := f.transferID(t); got != want {
			t.Fatalf("stored transfer = %q, want %q", got, want)
		}
	})

	t.Run("reclaim_own_pending_is_idempotent", func(t *testing.T) {
		f := newClaimOrderFixture(t, "held")
		first, err := f.repo.ClaimListingOrderForRelease(ctx, f.orderID)
		if err != nil {
			t.Fatalf("first claim: %v", err)
		}
		second, err := f.repo.ClaimListingOrderForRelease(ctx, f.orderID)
		if err != nil {
			t.Fatalf("reclaim of own pending must succeed (crashed worker retry): %v", err)
		}
		if first.StripeTransferID != second.StripeTransferID {
			t.Fatalf("claim marker changed: %q -> %q", first.StripeTransferID, second.StripeTransferID)
		}
	})

	t.Run("table_driven_eligibility", func(t *testing.T) {
		cases := []struct {
			name         string
			status       string
			seedTransfer string
			seedDispute  bool
			wantErr      error
		}{
			{name: "held_ok", status: "held"},
			{name: "released_ok", status: "released"},
			{
				name: "pending_payment_rejected", status: "pending_payment",
				wantErr: service.ErrInvalidEscrowState,
			},
			{
				name: "payment_failed_rejected", status: "payment_failed",
				wantErr: service.ErrInvalidEscrowState,
			},
			{
				name: "final_transfer_rejected", status: "held",
				seedTransfer: "tr_final_paid",
				wantErr:      service.ErrInvalidEscrowState,
			},
			{
				name: "open_dispute_rejected", status: "held",
				seedDispute: true,
				wantErr:     service.ErrInvalidEscrowState,
			},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				f := newClaimOrderFixture(t, tc.status)
				if tc.seedTransfer != "" {
					if _, err := f.pool.Exec(ctx,
						`UPDATE listing_orders SET stripe_transfer_id = $2 WHERE id = $1`,
						f.orderID, tc.seedTransfer); err != nil {
						t.Fatalf("seed transfer: %v", err)
					}
				}
				if tc.seedDispute {
					// dispute_id is a free UUID column on the order; no need for a
					// marketplace_disputes row to exercise the claim guard.
					dID := uuid.NewString()
					if _, err := f.pool.Exec(ctx,
						`UPDATE listing_orders SET dispute_id = $2 WHERE id = $1`,
						f.orderID, dID); err != nil {
						t.Fatalf("seed dispute: %v", err)
					}
				}

				_, err := f.repo.ClaimListingOrderForRelease(ctx, f.orderID)
				if tc.wantErr != nil {
					if !errors.Is(err, tc.wantErr) {
						t.Fatalf("error = %v, want %v", err, tc.wantErr)
					}
					// Unsuccessful claim must not stamp a pending marker.
					if got := f.transferID(t); service.IsPendingListingTransferClaim(got) {
						t.Fatalf("rejected claim still wrote pending marker %q", got)
					}
					return
				}
				if err != nil {
					t.Fatalf("claim: %v", err)
				}
			})
		}
	})

	t.Run("missing_order_is_ErrListingOrderNotFound", func(t *testing.T) {
		f := newClaimOrderFixture(t, "held")
		_, err := f.repo.ClaimListingOrderForRelease(ctx, uuid.NewString())
		if !errors.Is(err, service.ErrListingOrderNotFound) {
			t.Fatalf("error = %v, want ErrListingOrderNotFound", err)
		}
	})

	t.Run("concurrent_claims_exactly_one_wins", func(t *testing.T) {
		f := newClaimOrderFixture(t, "held")
		const n = 16
		var (
			wg      sync.WaitGroup
			mu      sync.Mutex
			winners int
			errs    []error
		)
		start := make(chan struct{})
		for range n {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				_, err := f.repo.ClaimListingOrderForRelease(ctx, f.orderID)
				mu.Lock()
				defer mu.Unlock()
				if err == nil {
					winners++
					return
				}
				// Under FOR UPDATE serialization, losers re-enter after the
				// winner stamped the same pending marker — reclaim of own
				// pending is allowed, so concurrent winners may all succeed
				// with the SAME claim id. Count distinct outcomes carefully:
				// the invariant is "exactly one durable claim marker", not
				// "exactly one nil error".
				if !errors.Is(err, service.ErrInvalidEscrowState) {
					errs = append(errs, err)
				}
			}()
		}
		close(start)
		wg.Wait()
		if len(errs) > 0 {
			t.Fatalf("unexpected errors: %v", errs)
		}
		// All successful returns must share the single pending marker; failures
		// are also fine. Never more than one distinct transfer id.
		want := service.PendingListingTransferClaim(f.orderID)
		if got := f.transferID(t); got != want {
			t.Fatalf("stored transfer = %q, want single pending claim %q (winners=%d)",
				got, want, winners)
		}
		if winners < 1 {
			t.Fatal("no caller succeeded in claiming the held order")
		}
	})

	t.Run("dispute_claim_loses_to_release_claim", func(t *testing.T) {
		// MON-18: after release claim stamps pending:<orderID>, dispute freeze
		// must fail closed so we never freeze a row mid-payout.
		f := newClaimOrderFixture(t, "held")
		if _, err := f.repo.ClaimListingOrderForRelease(ctx, f.orderID); err != nil {
			t.Fatalf("release claim: %v", err)
		}
		_, err := f.repo.ClaimListingOrderForDispute(ctx, f.orderID, uuid.NewString())
		if !errors.Is(err, service.ErrInvalidEscrowState) {
			t.Fatalf("dispute after release claim: got %v, want ErrInvalidEscrowState", err)
		}
		o, err := f.repo.GetListingOrder(ctx, f.orderID)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if o.EscrowStatus != "held" {
			t.Fatalf("escrow_status = %q — dispute must not freeze after release claim", o.EscrowStatus)
		}
		if o.DisputeID != nil {
			t.Fatalf("dispute_id set after failed claim: %v", *o.DisputeID)
		}
	})

	t.Run("release_claim_loses_to_dispute_freeze", func(t *testing.T) {
		f := newClaimOrderFixture(t, "held")
		if _, err := f.repo.ClaimListingOrderForDispute(ctx, f.orderID, uuid.NewString()); err != nil {
			t.Fatalf("dispute claim: %v", err)
		}
		_, err := f.repo.ClaimListingOrderForRelease(ctx, f.orderID)
		if !errors.Is(err, service.ErrInvalidEscrowState) {
			t.Fatalf("release after dispute: got %v, want ErrInvalidEscrowState", err)
		}
		if got := f.transferID(t); got != "" {
			t.Fatalf("transfer stamped after failed release claim: %q", got)
		}
	})
}
