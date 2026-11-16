package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Settlement sweeper — the missing caller for ChargeListingWinner on the
// auction path.
//
// The regression being guarded: a won auction produced a listing_orders row in
// escrow_status='pending_payment' with no payment_intent_id, and nothing in the
// tree ever touched it again. These tests pin (a) that the sweeper attaches the
// PI, (b) that running it twice does not charge twice, (c) that an unfunded
// order past its deadline is surfaced and — only when armed — expired, and
// (d) that no state the sweeper can reach ever pays a seller.

func settlementFixture(t *testing.T, window time.Duration, expire bool) (*MarketplaceService, *mockMarketplaceRepo) {
	t.Helper()
	svc, repo, _ := newMarketplaceFixture()
	cfg := DefaultMarketplaceConfig()
	cfg.PaymentWindow = window
	svc.SetConfig(cfg)
	svc.SetExpireUnfunded(expire)
	return svc, repo
}

func TestSettlePendingListingOrders_selection(t *testing.T) {
	t.Parallel()

	// Only 'pending_payment' is settleable. Every other escrow state is either
	// already funded or already terminal, and the sweeper must never touch it.
	tests := []struct {
		name        string
		status      string
		wantScanned int
	}{
		{name: "pending_payment_is_swept", status: "pending_payment", wantScanned: 1},
		{name: "held_is_not_swept", status: "held", wantScanned: 0},
		{name: "released_is_not_swept", status: "released", wantScanned: 0},
		{name: "disputed_is_not_swept", status: "disputed", wantScanned: 0},
		{name: "refunded_is_not_swept", status: "refunded", wantScanned: 0},
		{name: "payment_failed_is_not_swept", status: "payment_failed", wantScanned: 0},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc, repo := settlementFixture(t, 72*time.Hour, false)

			o := newOrder("sel-"+tc.status, tc.status, 50000, 5000)
			if tc.status != "pending_payment" {
				o.PaymentIntentID = "pi_already"
			}
			repo.addOrder(o)

			stats, err := svc.SettlePendingListingOrders(context.Background(), 10)
			require.NoError(t, err)
			assert.Equal(t, tc.wantScanned, stats.Scanned)
		})
	}
}

// TestSettlePendingListingOrders_attaches_payment_intent is the core regression:
// before this sweeper existed, an auction-won order kept payment_intent_id NULL
// forever.
func TestSettlePendingListingOrders_attaches_payment_intent(t *testing.T) {
	t.Parallel()
	svc, repo := settlementFixture(t, 72*time.Hour, false)

	o := newOrder("auction-win", "pending_payment", 50000, 5000)
	repo.addOrder(o)

	stats, err := svc.SettlePendingListingOrders(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, stats.Scanned)
	assert.Equal(t, 1, stats.Charged)
	assert.Equal(t, 0, stats.ChargeFailed)
	assert.Equal(t, 0, stats.Expired)

	got, err := repo.GetListingOrder(context.Background(), o.ID)
	require.NoError(t, err)
	assert.NotEmpty(t, got.PaymentIntentID, "the whole point: a PI is now attached")
	assert.Equal(t, "pending_payment", got.EscrowStatus,
		"attaching a PI does NOT fund escrow — only a signature-verified payment_intent.succeeded event moves pending_payment -> held")
	assert.Equal(t, "listing-charge:"+o.ID, got.IdempotencyKey,
		"deterministic Stripe key, derived from the order id alone")

	require.NotNil(t, repo.paymentDueAt[o.ID], "the buyer's payment clock must start")
	assert.Equal(t, 1, repo.paymentAttempts[o.ID])
	assert.Empty(t, repo.lastPaymentErr[o.ID])
}

// TestSettlePendingListingOrders_second_pass_does_not_recharge proves the
// idempotency the cron depends on: it can run twice, and N replicas can race,
// without producing a second PaymentIntent.
func TestSettlePendingListingOrders_second_pass_does_not_recharge(t *testing.T) {
	t.Parallel()
	svc, repo := settlementFixture(t, 72*time.Hour, false)

	o := newOrder("twice", "pending_payment", 12345, 1235)
	repo.addOrder(o)

	first, err := svc.SettlePendingListingOrders(context.Background(), 10)
	require.NoError(t, err)
	require.Equal(t, 1, first.Charged)

	after, err := repo.GetListingOrder(context.Background(), o.ID)
	require.NoError(t, err)
	firstPI := after.PaymentIntentID
	require.NotEmpty(t, firstPI)

	second, err := svc.SettlePendingListingOrders(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, second.Scanned, "still unfunded, so still in the input set")
	assert.Equal(t, 0, second.Charged, "no second charge")
	assert.Equal(t, 0, second.Overdue, "deadline has not passed")

	final, err := repo.GetListingOrder(context.Background(), o.ID)
	require.NoError(t, err)
	assert.Equal(t, firstPI, final.PaymentIntentID, "same PaymentIntent, not a new one")
	assert.Equal(t, 1, repo.paymentAttempts[o.ID], "exactly one attempt recorded")
}

// TestSettlePendingListingOrders_deadline_is_not_extended_by_retries: an order
// whose clock is already running must not have it pushed back, or an unfunded
// order could outlive its window forever.
func TestSettlePendingListingOrders_deadline_is_not_extended_by_retries(t *testing.T) {
	t.Parallel()
	svc, repo := settlementFixture(t, 72*time.Hour, false)

	o := newOrder("clock", "pending_payment", 20000, 2000)
	repo.addOrder(o)

	_, err := svc.SettlePendingListingOrders(context.Background(), 10)
	require.NoError(t, err)
	require.NotNil(t, repo.paymentDueAt[o.ID])
	original := *repo.paymentDueAt[o.ID]

	// Force another attempt to be recorded with a later proposed deadline.
	later := original.Add(48 * time.Hour)
	require.NoError(t, repo.RecordListingPaymentAttempt(context.Background(), o.ID, &later, ""))

	assert.True(t, repo.paymentDueAt[o.ID].Equal(original),
		"first deadline wins (COALESCE(payment_due_at, $2)); got %v want %v",
		repo.paymentDueAt[o.ID], original)
}

func TestSettlePendingListingOrders_overdue(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		expireArmed bool
		wantExpired int
		wantStatus  string
	}{
		{
			name:        "disarmed_reports_but_does_not_change_the_row",
			expireArmed: false,
			wantExpired: 0,
			wantStatus:  "pending_payment",
		},
		{
			name:        "armed_moves_to_terminal_payment_failed",
			expireArmed: true,
			wantExpired: 1,
			wantStatus:  "payment_failed",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			// A one-nanosecond window makes every order instantly overdue on the
			// pass AFTER the one that stamps the deadline.
			svc, repo := settlementFixture(t, time.Nanosecond, tc.expireArmed)

			o := newOrder("late", "pending_payment", 30000, 3000)
			repo.addOrder(o)

			// Pass 1 attaches the PI and stamps a deadline already in the past.
			first, err := svc.SettlePendingListingOrders(context.Background(), 10)
			require.NoError(t, err)
			require.Equal(t, 1, first.Charged)
			require.Equal(t, 0, first.Overdue, "the charging pass never expires the order it just stamped")

			// Pass 2 sees it unfunded past the deadline.
			second, err := svc.SettlePendingListingOrders(context.Background(), 10)
			require.NoError(t, err)
			assert.Equal(t, 1, second.Overdue)
			assert.Equal(t, tc.wantExpired, second.Expired)

			got, err := repo.GetListingOrder(context.Background(), o.ID)
			require.NoError(t, err)
			assert.Equal(t, tc.wantStatus, got.EscrowStatus)
		})
	}
}

// TestSettlePendingListingOrders_missing_deadline_falls_back_to_created_at
// covers rows written before migration 101, which have payment_due_at NULL.
// Without the fallback those orders would be immortal.
func TestSettlePendingListingOrders_missing_deadline_falls_back_to_created_at(t *testing.T) {
	t.Parallel()
	svc, repo := settlementFixture(t, 30*time.Minute, true)

	o := newOrder("legacy", "pending_payment", 40000, 4000)
	o.PaymentIntentID = "pi_legacy_from_buy_now" // already has a PI, no deadline
	o.CreatedAt = time.Now().Add(-24 * time.Hour)
	repo.addOrder(o)
	require.Nil(t, repo.paymentDueAt[o.ID])

	stats, err := svc.SettlePendingListingOrders(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, stats.Overdue)
	assert.Equal(t, 1, stats.Expired)

	got, err := repo.GetListingOrder(context.Background(), o.ID)
	require.NoError(t, err)
	assert.Equal(t, "payment_failed", got.EscrowStatus)
}

// TestSettlePendingListingOrders_charge_failure_is_recorded_and_soft: a failing
// order must be logged on the row (so support can see it) and must not stop the
// rest of the batch.
func TestSettlePendingListingOrders_charge_failure_is_recorded_and_soft(t *testing.T) {
	t.Parallel()
	svc, repo := settlementFixture(t, 72*time.Hour, false)

	bad := newOrder("aaa-bad", "pending_payment", 10000, 1000)
	bad.CreatedAt = time.Now().Add(-2 * time.Hour)
	repo.addOrder(bad)
	repo.updatePIErr[bad.ID] = errors.New("stamp exploded")

	good := newOrder("bbb-good", "pending_payment", 20000, 2000)
	good.CreatedAt = time.Now().Add(-time.Hour)
	repo.addOrder(good)

	stats, err := svc.SettlePendingListingOrders(context.Background(), 10)
	require.NoError(t, err, "one poisoned row must never fail the pass")
	assert.Equal(t, 2, stats.Scanned)
	assert.Equal(t, 1, stats.Charged, "the healthy order still got charged")
	assert.Equal(t, 1, stats.ChargeFailed)

	assert.Equal(t, 1, repo.paymentAttempts[bad.ID])
	assert.Contains(t, repo.lastPaymentErr[bad.ID], "stamp exploded")
	assert.Nil(t, repo.paymentDueAt[bad.ID],
		"a platform-side failure must not start the buyer's clock")
	assert.Equal(t, 0, stats.Overdue, "neither order is past created_at + 72h yet")
}

// TestSettlePendingListingOrders_permanently_failing_order_still_terminates:
// an order the platform can never charge must not be retried every tick
// forever. With no payment_due_at ever stamped, the deadline falls back to
// created_at + window, so it ages out like any other unfunded order.
func TestSettlePendingListingOrders_permanently_failing_order_still_terminates(t *testing.T) {
	t.Parallel()
	svc, repo := settlementFixture(t, time.Hour, true)

	o := newOrder("poison", "pending_payment", 10000, 1000)
	o.CreatedAt = time.Now().Add(-48 * time.Hour) // long past created_at + 1h
	repo.addOrder(o)
	repo.updatePIErr[o.ID] = errors.New("permanently broken")

	stats, err := svc.SettlePendingListingOrders(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 1, stats.ChargeFailed)
	assert.Equal(t, 1, stats.Overdue, "a never-chargeable order must still be evaluated for expiry")
	assert.Equal(t, 1, stats.Expired)

	got, err := repo.GetListingOrder(context.Background(), o.ID)
	require.NoError(t, err)
	assert.Equal(t, "payment_failed", got.EscrowStatus)
}

// TestSettlePendingListingOrders_never_pays_a_seller is the escrow invariant.
// Nothing the sweeper can do — charge, expire, or both — may make a seller
// payable, because a seller is only ever paid out of funds actually captured.
func TestSettlePendingListingOrders_never_pays_a_seller(t *testing.T) {
	t.Parallel()
	svc, repo := settlementFixture(t, time.Nanosecond, true)

	o := newOrder("no-payout", "pending_payment", 99999, 10000)
	o.CreatedAt = time.Now().Add(-time.Hour)
	repo.addOrder(o)

	// Charge, then expire.
	_, err := svc.SettlePendingListingOrders(context.Background(), 10)
	require.NoError(t, err)
	_, err = svc.SettlePendingListingOrders(context.Background(), 10)
	require.NoError(t, err)

	got, err := repo.GetListingOrder(context.Background(), o.ID)
	require.NoError(t, err)
	require.Equal(t, "payment_failed", got.EscrowStatus)

	// The auto-release worker must not see it, and must not pay it.
	released, err := svc.AutoReleaseListingOrders(context.Background(), 10)
	require.NoError(t, err)
	assert.Equal(t, 0, released)
	assert.Empty(t, repo.transferStamps, "no Stripe transfer for an unfunded order")
	assert.Empty(t, repo.taxIncs, "no 1099-K accrual for an unfunded order")
}

// TestFailListingOrderPayment_loses_to_a_funded_order closes the race between
// the sweeper's SELECT and its UPDATE: if the buyer funds in between, the
// status-guarded write must not cancel a paid order.
func TestFailListingOrderPayment_loses_to_a_funded_order(t *testing.T) {
	t.Parallel()
	_, repo := settlementFixture(t, time.Nanosecond, true)

	o := newOrder("raced", "held", 50000, 5000)
	o.PaymentIntentID = "pi_raced"
	repo.addOrder(o)

	err := repo.FailListingOrderPayment(context.Background(), o.ID, "too late")
	require.ErrorIs(t, err, ErrInvalidEscrowState)

	got, err := repo.GetListingOrder(context.Background(), o.ID)
	require.NoError(t, err)
	assert.Equal(t, "held", got.EscrowStatus, "a funded order is never cancelled")
}

// TestSettlePendingListingOrders_respects_batch_limit keeps the worker bounded:
// an unbounded scan over a large listing_orders table is a production hazard.
func TestSettlePendingListingOrders_respects_batch_limit(t *testing.T) {
	t.Parallel()
	svc, repo := settlementFixture(t, 72*time.Hour, false)

	for i := range 5 {
		o := newOrder(string(rune('a'+i))+"-batch", "pending_payment", 10000, 1000)
		repo.addOrder(o)
	}

	stats, err := svc.SettlePendingListingOrders(context.Background(), 2)
	require.NoError(t, err)
	assert.Equal(t, 2, stats.Scanned)
	assert.Equal(t, 2, stats.Charged)
}
