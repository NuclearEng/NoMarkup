//go:build integration

// Goods-marketplace settlement, exercised against a real PostgreSQL through the
// real repository.
//
// The defect these cover: the job service closes a won auction by inserting
// listing_orders in escrow_status='pending_payment' with no payment_intent_id,
// and nothing ever called ChargeListingWinner on that path. The order sat
// unfunded and invisible forever, and the escrow_status CHECK had no state that
// could even express "the buyer never paid" (migration 101 adds it).
//
// The unit tests in internal/service prove the sweeper's logic against a mock.
// These prove the parts only a real database can: that the CHECK constraint
// accepts the new state, that COALESCE(payment_due_at, $2) really is
// first-writer-wins, that the status-guarded UPDATE really loses to a funded
// order, and — the invariant that matters most — that a payment_failed row is
// invisible to the query that pays sellers.
//
// Run:
//
//	cd services/payment && DATABASE_URL=... go test -tags=integration \
//	    -run TestListingSettlement ./internal/repository/...
//
// Requires DATABASE_URL pointing at a database with the full migration chain
// applied. Every fixture row is created under a unique id and dropped in
// t.Cleanup, so the tests leave no residue.

package repository

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/services/payment/internal/service"
)

type settlementFixture struct {
	pool      *pgxpool.Pool
	repo      *MarketplaceRepository
	sellerID  string
	buyerID   string
	listingID string
	orderID   string
}

// newSettlementFixture builds one seller, one buyer, one goods listing and one
// unfunded order — the exact row shape services/job writes when an auction
// closes with a winner.
func newSettlementFixture(t *testing.T, amountCents, feeCents int64, createdAt time.Time) *settlementFixture {
	t.Helper()
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, moneyDatabaseURL())
	if err != nil {
		t.Fatalf("connect db: %v", err)
	}
	t.Cleanup(pool.Close)

	f := &settlementFixture{
		pool:      pool,
		repo:      NewMarketplaceRepository(pool),
		sellerID:  uuid.NewString(),
		buyerID:   uuid.NewString(),
		listingID: uuid.NewString(),
		orderID:   uuid.NewString(),
	}

	suffix := uuid.NewString()
	for _, u := range []struct{ id, role string }{
		{f.sellerID, "seller"},
		{f.buyerID, "buyer"},
	} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO users (id, email, display_name, roles, status)
			VALUES ($1, $2, $3, ARRAY['customer'], 'active')`,
			u.id, fmt.Sprintf("settle-%s-%s@example.test", u.role, suffix), "settle "+u.role,
		); err != nil {
			t.Fatalf("insert %s: %v", u.role, err)
		}
	}

	var categoryID string
	if err := pool.QueryRow(ctx,
		`SELECT id::text FROM service_categories ORDER BY created_at LIMIT 1`).Scan(&categoryID); err != nil {
		t.Fatalf("pick category: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO listings (
			id, seller_id, title, category_id, location, pickup_zip_code,
			starting_price_cents, auction_duration_hours,
			auction_ends_at, original_auction_ends_at, status
		) VALUES (
			$1, $2, 'settlement fixture', $3,
			ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326), '94103',
			$4, 24, now() - interval '1 hour', now() - interval '1 hour', 'sold'
		)`, f.listingID, f.sellerID, categoryID, amountCents,
	); err != nil {
		t.Fatalf("insert listing: %v", err)
	}

	// Exactly what listing_repo.CloseListing writes: pending_payment, no PI.
	if _, err := pool.Exec(ctx, `
		INSERT INTO listing_orders (
			id, listing_id, seller_id, buyer_id, amount_cents, fee_cents,
			escrow_status, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, 'pending_payment', $7)`,
		f.orderID, f.listingID, f.sellerID, f.buyerID, amountCents, feeCents, createdAt,
	); err != nil {
		t.Fatalf("insert listing order: %v", err)
	}

	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM listing_orders WHERE id = $1`, f.orderID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM listings WHERE id = $1`, f.listingID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM seller_tax_forms WHERE seller_id = $1`, f.sellerID)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id IN ($1, $2)`, f.sellerID, f.buyerID)
	})

	return f
}

func (f *settlementFixture) escrowStatus(t *testing.T) string {
	t.Helper()
	var s string
	if err := f.pool.QueryRow(context.Background(),
		`SELECT escrow_status FROM listing_orders WHERE id = $1`, f.orderID).Scan(&s); err != nil {
		t.Fatalf("read escrow_status: %v", err)
	}
	return s
}

func (f *settlementFixture) paymentColumns(t *testing.T) (piID string, attempts int, dueAt *time.Time, lastErr *string) {
	t.Helper()
	if err := f.pool.QueryRow(context.Background(), `
		SELECT COALESCE(payment_intent_id,''), payment_attempts, payment_due_at, last_payment_error
		  FROM listing_orders WHERE id = $1`, f.orderID,
	).Scan(&piID, &attempts, &dueAt, &lastErr); err != nil {
		t.Fatalf("read payment columns: %v", err)
	}
	return piID, attempts, dueAt, lastErr
}

// newSettlementService wires the REAL repository into the marketplace service
// with the dev Stripe stub, so every database interaction is genuine and only
// the Stripe call is stubbed.
func newSettlementService(f *settlementFixture, window time.Duration, expire bool) *service.MarketplaceService {
	svc := service.NewMarketplaceService(f.repo, service.NewStripeService("development"))
	cfg := service.DefaultMarketplaceConfig()
	cfg.PaymentWindow = window
	svc.SetConfig(cfg)
	svc.SetExpireUnfunded(expire)
	return svc
}

// TestListingSettlement_ChargesOnceAndReachesHeld walks the happy path end to
// end on real rows: pending_payment -> PI attached -> (verified
// payment_intent.succeeded) -> held. It runs the sweeper twice to prove the
// second pass creates no second charge.
func TestListingSettlement_ChargesOnceAndReachesHeld(t *testing.T) {
	ctx := context.Background()
	f := newSettlementFixture(t, 50_000, 5_000, time.Now().Add(-time.Hour))
	svc := newSettlementService(f, 72*time.Hour, false)

	if got := f.escrowStatus(t); got != "pending_payment" {
		t.Fatalf("fixture precondition: escrow_status = %q, want pending_payment", got)
	}
	if pi, _, _, _ := f.paymentColumns(t); pi != "" {
		t.Fatalf("fixture precondition: payment_intent_id = %q, want empty", pi)
	}

	first, err := svc.SettlePendingListingOrders(ctx, 50)
	if err != nil {
		t.Fatalf("first settle pass: %v", err)
	}
	if first.Charged < 1 {
		t.Fatalf("first pass charged %d orders, want >= 1", first.Charged)
	}

	piAfterFirst, attempts, dueAt, lastErr := f.paymentColumns(t)
	if piAfterFirst == "" {
		t.Fatal("payment_intent_id is still empty — the whole defect")
	}
	if attempts != 1 {
		t.Fatalf("payment_attempts = %d, want 1", attempts)
	}
	if dueAt == nil {
		t.Fatal("payment_due_at was not stamped — the buyer has no deadline")
	}
	if lastErr != nil {
		t.Fatalf("last_payment_error = %q, want NULL on success", *lastErr)
	}
	if got := f.escrowStatus(t); got != "pending_payment" {
		t.Fatalf("escrow_status = %q after charge; attaching a PI must NOT fund escrow", got)
	}
	firstDeadline := *dueAt

	// Second pass: the cron re-runs, or a second replica wins the lock.
	if _, err := svc.SettlePendingListingOrders(ctx, 50); err != nil {
		t.Fatalf("second settle pass: %v", err)
	}
	piAfterSecond, attemptsAfter, dueAfter, _ := f.paymentColumns(t)
	if piAfterSecond != piAfterFirst {
		t.Fatalf("PaymentIntent changed across passes: %q -> %q; exactly one charge per order",
			piAfterFirst, piAfterSecond)
	}
	if attemptsAfter != 1 {
		t.Fatalf("payment_attempts = %d after two passes, want 1 — the re-entry short-circuit did not hold", attemptsAfter)
	}
	if !dueAfter.Equal(firstDeadline) {
		t.Fatalf("payment_due_at moved: %v -> %v; a retry must never extend the buyer's clock",
			firstDeadline, *dueAfter)
	}

	// Funds captured: the verified payment_intent.succeeded event promotes the
	// order to held. This is the ONLY transition that funds escrow.
	if err := svc.HandleListingPaymentIntentSucceeded(ctx, piAfterFirst); err != nil {
		t.Fatalf("handle payment intent succeeded: %v", err)
	}
	if got := f.escrowStatus(t); got != "held" {
		t.Fatalf("escrow_status = %q, want held", got)
	}

	// Replayed event must be a no-op, not an error and not a second transition.
	if err := svc.HandleListingPaymentIntentSucceeded(ctx, piAfterFirst); err != nil {
		t.Fatalf("replayed succeeded event must be idempotent, got: %v", err)
	}
	if got := f.escrowStatus(t); got != "held" {
		t.Fatalf("escrow_status = %q after replay, want held", got)
	}

	// A held order is no longer settleable.
	third, err := svc.SettlePendingListingOrders(ctx, 50)
	if err != nil {
		t.Fatalf("third settle pass: %v", err)
	}
	for _, o := range mustListPending(t, f) {
		if o.ID == f.orderID {
			t.Fatalf("held order %s is still in the settlement input set (scanned=%d)", f.orderID, third.Scanned)
		}
	}
}

// TestListingSettlement_UnfundedOrderExpiresAndNeverPaysASeller is the failure
// path plus the escrow invariant.
func TestListingSettlement_UnfundedOrderExpiresAndNeverPaysASeller(t *testing.T) {
	ctx := context.Background()
	// Created two hours ago with a one-hour window: already past its deadline.
	f := newSettlementFixture(t, 42_000, 4_200, time.Now().Add(-2*time.Hour))
	svc := newSettlementService(f, time.Hour, true)

	// Pass 1 attaches the PI and stamps a deadline that is already in the past
	// (now + 1h is future, so this pass does not expire it).
	if _, err := svc.SettlePendingListingOrders(ctx, 50); err != nil {
		t.Fatalf("charge pass: %v", err)
	}
	// Force the deadline into the past to simulate the window elapsing without
	// sleeping for it.
	if _, err := f.pool.Exec(ctx,
		`UPDATE listing_orders SET payment_due_at = now() - interval '1 minute' WHERE id = $1`,
		f.orderID); err != nil {
		t.Fatalf("age the deadline: %v", err)
	}

	stats, err := svc.SettlePendingListingOrders(ctx, 50)
	if err != nil {
		t.Fatalf("expiry pass: %v", err)
	}
	if stats.Overdue < 1 || stats.Expired < 1 {
		t.Fatalf("expiry pass: overdue=%d expired=%d, want >= 1 each", stats.Overdue, stats.Expired)
	}
	if got := f.escrowStatus(t); got != "payment_failed" {
		t.Fatalf("escrow_status = %q, want payment_failed", got)
	}
	if _, _, _, lastErr := f.paymentColumns(t); lastErr == nil || *lastErr == "" {
		t.Fatal("last_payment_error must record why the order failed")
	}

	// THE INVARIANT: an unfunded order must be invisible to the query that pays
	// sellers, no matter how old it gets.
	orders, err := f.repo.ListListingOrdersForAutoRelease(ctx, time.Now().Add(365*24*time.Hour), 500)
	if err != nil {
		t.Fatalf("list for auto release: %v", err)
	}
	for _, o := range orders {
		if o.ID == f.orderID {
			t.Fatalf("payment_failed order %s is payable by the auto-release worker", f.orderID)
		}
	}

	released, err := svc.AutoReleaseListingOrders(ctx, 500)
	if err != nil {
		t.Fatalf("auto release: %v", err)
	}
	var transferID *string
	if err := f.pool.QueryRow(ctx,
		`SELECT stripe_transfer_id FROM listing_orders WHERE id = $1`, f.orderID).Scan(&transferID); err != nil {
		t.Fatalf("read transfer id: %v", err)
	}
	if transferID != nil {
		t.Fatalf("unfunded order got a Stripe transfer %q (released=%d)", *transferID, released)
	}

	// Terminal: a second expiry pass must not re-fail it.
	if err := f.repo.FailListingOrderPayment(ctx, f.orderID, "second try"); !errors.Is(err, service.ErrInvalidEscrowState) {
		t.Fatalf("re-failing a payment_failed order: got %v, want ErrInvalidEscrowState", err)
	}
}

// TestListingSettlement_ExpiryLosesToAFundedOrder closes the race between the
// sweeper's SELECT and its UPDATE. The status guard lives in the UPDATE, so a
// buyer who funds in that window keeps their order.
func TestListingSettlement_ExpiryLosesToAFundedOrder(t *testing.T) {
	ctx := context.Background()
	f := newSettlementFixture(t, 30_000, 3_000, time.Now().Add(-72*time.Hour))

	// The buyer funds between the sweeper reading the row and writing to it.
	if _, err := f.pool.Exec(ctx,
		`UPDATE listing_orders SET escrow_status = 'held', payment_intent_id = $2 WHERE id = $1`,
		f.orderID, "pi_funded_"+f.orderID); err != nil {
		t.Fatalf("fund the order: %v", err)
	}

	err := f.repo.FailListingOrderPayment(ctx, f.orderID, "stale read said unfunded")
	if !errors.Is(err, service.ErrInvalidEscrowState) {
		t.Fatalf("got %v, want ErrInvalidEscrowState", err)
	}
	if got := f.escrowStatus(t); got != "held" {
		t.Fatalf("escrow_status = %q — a funded order was cancelled by a stale read", got)
	}
}

// TestListingSettlement_DisarmedSweeperChangesNothing pins the default posture:
// with expiry unarmed the sweeper reports the overdue order and leaves it alone.
func TestListingSettlement_DisarmedSweeperChangesNothing(t *testing.T) {
	ctx := context.Background()
	f := newSettlementFixture(t, 15_000, 1_500, time.Now().Add(-96*time.Hour))
	svc := newSettlementService(f, time.Hour, false) // NOT armed

	if _, err := svc.SettlePendingListingOrders(ctx, 50); err != nil {
		t.Fatalf("charge pass: %v", err)
	}
	if _, err := f.pool.Exec(ctx,
		`UPDATE listing_orders SET payment_due_at = now() - interval '1 minute' WHERE id = $1`,
		f.orderID); err != nil {
		t.Fatalf("age the deadline: %v", err)
	}

	stats, err := svc.SettlePendingListingOrders(ctx, 50)
	if err != nil {
		t.Fatalf("report pass: %v", err)
	}
	if stats.Overdue < 1 {
		t.Fatalf("overdue = %d, want >= 1 — the condition must still be reported", stats.Overdue)
	}
	if stats.Expired != 0 {
		t.Fatalf("expired = %d, want 0 — the sweeper must not act while disarmed", stats.Expired)
	}
	if got := f.escrowStatus(t); got != "pending_payment" {
		t.Fatalf("escrow_status = %q, want pending_payment (unchanged)", got)
	}
}

func mustListPending(t *testing.T, f *settlementFixture) []*service.PendingListingOrder {
	t.Helper()
	out, err := f.repo.ListListingOrdersAwaitingPayment(context.Background(), 500)
	if err != nil {
		t.Fatalf("list awaiting payment: %v", err)
	}
	return out
}
