package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

// offSessionFixture builds a marketplace service with a fully wired buyer
// billing stack: a provisioner over an in-memory directory plus the dev Stripe
// stub, so the whole provision -> save card -> charge path runs without Stripe
// credentials.
func offSessionFixture(t *testing.T) (*MarketplaceService, *mockMarketplaceRepo, *captureNotifier, *fakeCustomerDirectory, *StripeService) {
	t.Helper()
	repo := newMockRepo()
	notifier := &captureNotifier{}
	ss := &StripeService{devMode: true}
	dir := newFakeCustomerDirectory()

	svc := NewMarketplaceService(repo, ss)
	svc.SetNotifier(notifier)
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, ss))
	cfg := DefaultMarketplaceConfig()
	cfg.PaymentWindow = 72 * time.Hour
	svc.SetConfig(cfg)
	return svc, repo, notifier, dir, ss
}

// saveCardFor runs the real card-saving path for a buyer: provision a Stripe
// Customer, create a SetupIntent bound to it, confirm it, and persist the
// resulting payment method. Returns the payment method id.
func saveCardFor(t *testing.T, dir *fakeCustomerDirectory, ss *StripeService, buyerID string) string {
	t.Helper()
	ctx := context.Background()

	dir.addUser(buyerID, buyerID+"@example.com", "Buyer")
	p := NewCustomerProvisioner(dir, ss)

	cus, err := p.EnsureCustomer(ctx, buyerID)
	require.NoError(t, err)
	require.NotEmpty(t, cus)

	secret, err := ss.CreateSetupIntent(ctx, cus, buyerID)
	require.NoError(t, err)

	status, err := ss.GetSetupIntentStatus(ctx, secret, buyerID)
	require.NoError(t, err)
	require.True(t, status.Succeeded)
	require.NotEmpty(t, status.PaymentMethodID)
	require.Equal(t, cus, status.CustomerID,
		"the confirmed card must be attached to the buyer's customer, not to nothing")

	require.NoError(t, p.RecordConfirmedPaymentMethod(ctx, buyerID, status.CustomerID, status.PaymentMethodID))
	return status.PaymentMethodID
}

// TestOffSession_EndToEnd_ProvisionSaveChargeHold is the full path the task
// asks for, in one test:
//
//	provision customer -> setup intent -> payment method persisted ->
//	pending_payment order -> off-session charge -> escrow held
//
// Before this change every one of those arrows was broken at the first step: no
// Stripe Customer was ever created, so the SetupIntent attached the card to
// nothing, so there was nothing to charge, so the order sat in pending_payment
// forever.
func TestOffSession_EndToEnd_ProvisionSaveChargeHold(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	svc, repo, notifier, dir, ss := offSessionFixture(t)

	// --- provision + save a card ---
	o := newOrder("e2e", "pending_payment", 50000, 5000)
	o.PickupZipCode = "94016" // CA, 7.25%
	pmID := saveCardFor(t, dir, ss, o.BuyerID)

	methods, err := dir.ListUserPaymentMethods(ctx, o.BuyerID)
	require.NoError(t, err)
	require.Len(t, methods, 1, "the saved card must be persisted, not lost")
	assert.True(t, methods[0].IsDefault)
	assert.Equal(t, pmID, methods[0].ID)

	// --- an auction win lands as an unfunded order ---
	repo.addOrder(o)

	// --- the sweeper charges it off-session ---
	stats, err := svc.SettlePendingListingOrders(ctx, 10)
	require.NoError(t, err)

	assert.Equal(t, 1, stats.Scanned)
	assert.Equal(t, 1, stats.Charged, "a PaymentIntent is attached")
	assert.Equal(t, 1, stats.Collected, "and money is actually collected")
	assert.Equal(t, 0, stats.NoInstrument)
	assert.Equal(t, 0, stats.Declined)
	assert.Equal(t, 0, stats.AuthRequired)
	assert.Equal(t, 0, stats.CollectError)
	assert.Equal(t, 0, stats.Expired)

	// --- escrow is funded ---
	got, err := repo.GetListingOrder(ctx, o.ID)
	require.NoError(t, err)
	assert.Equal(t, "held", got.EscrowStatus, "escrow is funded end to end")
	assert.NotEmpty(t, got.PaymentIntentID)
	assert.Equal(t, "listing-charge:"+o.ID, got.IdempotencyKey,
		"the PaymentIntent key stays deterministic per order")

	// MONEY: the buyer is charged bid + fee + tax, in integer cents.
	// 50000 @ 1000bps => 5000 fee; 50000 @ 7.25% CA => 3625 tax.
	wantFee := feeFromBPS(o.AmountCents, DefaultMarketplaceConfig().MarketplaceFeeBps)
	_, wantTax := ComputeTaxCentsForZip(o.AmountCents, o.PickupZipCode)
	assert.Equal(t, int64(5000), wantFee)
	assert.Equal(t, wantFee, got.FeeCents)
	assert.Equal(t, wantTax, got.TaxCents)

	// --- the buyer was told ---
	events := notifier.snapshot()
	var captured string
	for _, e := range events {
		if strings.HasPrefix(e, "payment_captured:") {
			captured = e
		}
	}
	require.NotEmpty(t, captured, "a buyer charged while away must be told")
	assert.Contains(t, captured, o.BuyerID)
	assert.Contains(t, captured, "58625", "notified total = 50000 + 5000 + 3625")
}

// TestOffSession_SecondPassDoesNotDoubleCharge: the cron runs every 15 minutes
// and several replicas may run at once. A funded order must never be charged
// again.
func TestOffSession_SecondPassDoesNotDoubleCharge(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	svc, repo, _, dir, ss := offSessionFixture(t)

	o := newOrder("twice", "pending_payment", 20000, 2000)
	saveCardFor(t, dir, ss, o.BuyerID)
	repo.addOrder(o)

	first, err := svc.SettlePendingListingOrders(ctx, 10)
	require.NoError(t, err)
	require.Equal(t, 1, first.Collected)

	after, err := repo.GetListingOrder(ctx, o.ID)
	require.NoError(t, err)
	require.Equal(t, "held", after.EscrowStatus)
	piID := after.PaymentIntentID

	second, err := svc.SettlePendingListingOrders(ctx, 10)
	require.NoError(t, err)
	assert.Equal(t, 0, second.Scanned, "a held order has left the unfunded input set")
	assert.Equal(t, 0, second.Collected)

	final, err := repo.GetListingOrder(ctx, o.ID)
	require.NoError(t, err)
	assert.Equal(t, piID, final.PaymentIntentID, "same PaymentIntent throughout")
}

// TestOffSession_FailureModesAreDistinctOutcomes drives each real issuer failure
// through the FULL sweeper and asserts they land in different buckets, leave
// different rows behind, and tell the buyer different things.
//
// This is the integration-level counterpart to TestClassifyChargeError: it
// proves the distinctions survive the whole path, not just the classifier.
func TestOffSession_FailureModesAreDistinctOutcomes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		// declineErr is what Stripe raises; nil means "buyer never saved a card".
		declineErr    error
		saveCard      bool
		wantOutcome   ChargeOutcome
		wantStat      func(s SettlementStats) int
		wantReasonHas string
	}{
		{
			name:          "no_payment_method_on_file",
			saveCard:      false,
			wantOutcome:   ChargeOutcomeNoPaymentMethod,
			wantStat:      func(s SettlementStats) int { return s.NoInstrument },
			wantReasonHas: "no_payment_method",
		},
		{
			name:     "authentication_required",
			saveCard: true,
			declineErr: &stripe.Error{
				Code: stripe.ErrorCodeAuthenticationRequired,
				Msg:  "The payment requires authentication",
			},
			wantOutcome:   ChargeOutcomeAuthenticationRequired,
			wantStat:      func(s SettlementStats) int { return s.AuthRequired },
			wantReasonHas: "authentication_required",
		},
		{
			name:     "insufficient_funds",
			saveCard: true,
			declineErr: &stripe.Error{
				Code:        stripe.ErrorCodeCardDeclined,
				DeclineCode: stripe.DeclineCodeInsufficientFunds,
				Msg:         "Your card has insufficient funds.",
			},
			wantOutcome:   ChargeOutcomeInsufficientFunds,
			wantStat:      func(s SettlementStats) int { return s.InsufficientFn },
			wantReasonHas: "insufficient_funds",
		},
		{
			name:     "generic_card_decline",
			saveCard: true,
			declineErr: &stripe.Error{
				Code:        stripe.ErrorCodeCardDeclined,
				DeclineCode: stripe.DeclineCodeGenericDecline,
				Msg:         "Your card was declined.",
			},
			wantOutcome:   ChargeOutcomeCardDeclined,
			wantStat:      func(s SettlementStats) int { return s.Declined },
			wantReasonHas: "card_declined",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ctx := context.Background()
			svc, repo, notifier, dir, ss := offSessionFixture(t)

			o := newOrder("fail-"+tc.name, "pending_payment", 30000, 3000)
			if tc.saveCard {
				pmID := saveCardFor(t, dir, ss, o.BuyerID)
				ss.DevStore().SetDeclineRule(pmID, tc.declineErr)
			} else {
				// The buyer exists but never saved a card.
				dir.addUser(o.BuyerID, o.BuyerID+"@example.com", "Buyer")
			}
			repo.addOrder(o)

			stats, err := svc.SettlePendingListingOrders(ctx, 10)
			require.NoError(t, err, "one bad order must never fail the whole sweep")

			// The right bucket, and only that bucket.
			assert.Equal(t, 1, tc.wantStat(stats), "expected outcome %s", tc.wantOutcome)
			assert.Equal(t, 0, stats.Collected, "no money may be collected on a failure")

			// Escrow is NOT funded — the money invariant.
			got, err := repo.GetListingOrder(ctx, o.ID)
			require.NoError(t, err)
			assert.Equal(t, "pending_payment", got.EscrowStatus,
				"a failed charge must never fund escrow")

			// The row records WHY, distinguishably.
			assert.Contains(t, repo.lastPaymentErr[o.ID], tc.wantReasonHas,
				"the order must record which failure this was, not a generic error")

			// The buyer was told, with the specific outcome.
			var problem string
			for _, e := range notifier.snapshot() {
				if strings.HasPrefix(e, "payment_problem:") {
					problem = e
				}
			}
			require.NotEmpty(t, problem, "the buyer must be told their payment failed")
			assert.Contains(t, problem, string(tc.wantOutcome))
		})
	}
}

// TestOffSession_AuthRequiredDoesNotExpireTheOrder: SCA means the buyer must
// come back. Expiring the order underneath them would cancel a purchase that is
// waiting on a step WE asked them to take.
func TestOffSession_AuthRequiredDoesNotExpireTheOrder(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	svc, repo, _, dir, ss := offSessionFixture(t)

	// Window already elapsed, and expiry ARMED — the order would otherwise die.
	cfg := DefaultMarketplaceConfig()
	cfg.PaymentWindow = time.Nanosecond
	svc.SetConfig(cfg)
	svc.SetExpireUnfunded(true)

	o := newOrder("sca", "pending_payment", 10000, 1000)
	o.CreatedAt = time.Now().Add(-30 * 24 * time.Hour)
	pmID := saveCardFor(t, dir, ss, o.BuyerID)
	ss.DevStore().SetDeclineRule(pmID, &stripe.Error{
		Code: stripe.ErrorCodeAuthenticationRequired,
		Msg:  "The payment requires authentication",
	})
	repo.addOrder(o)

	// Pass 1 attaches the PaymentIntent and hits SCA.
	first, err := svc.SettlePendingListingOrders(ctx, 10)
	require.NoError(t, err)
	require.Equal(t, 1, first.AuthRequired)

	// Pass 2 is the one that matters: the (1ns) window has elapsed and expiry is
	// ARMED, so an ordinary decline would be terminated here — see
	// TestOffSession_DeclinedOrderStillExpires, which is identical except for
	// the failure mode and DOES expire on this pass. SCA must not.
	second, err := svc.SettlePendingListingOrders(ctx, 10)
	require.NoError(t, err)
	assert.Equal(t, 1, second.AuthRequired)
	assert.Equal(t, 0, second.Expired,
		"an order awaiting buyer authentication must not be cancelled underneath them")
	assert.Equal(t, 0, second.Overdue,
		"SCA short-circuits before the overdue branch entirely")

	got, err := repo.GetListingOrder(ctx, o.ID)
	require.NoError(t, err)
	assert.Equal(t, "pending_payment", got.EscrowStatus)
}

// TestOffSession_DeclinedOrderStillExpires: a decline is NOT a reason to keep an
// order alive forever. With expiry armed and the window elapsed it must still
// reach the terminal state, or a permanently bad card produces an immortal order.
func TestOffSession_DeclinedOrderStillExpires(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	svc, repo, _, dir, ss := offSessionFixture(t)

	cfg := DefaultMarketplaceConfig()
	cfg.PaymentWindow = time.Nanosecond
	svc.SetConfig(cfg)
	svc.SetExpireUnfunded(true)

	o := newOrder("dead-card", "pending_payment", 10000, 1000)
	o.CreatedAt = time.Now().Add(-30 * 24 * time.Hour)
	pmID := saveCardFor(t, dir, ss, o.BuyerID)
	ss.DevStore().SetDeclineRule(pmID, &stripe.Error{
		Code:        stripe.ErrorCodeCardDeclined,
		DeclineCode: stripe.DeclineCodeStolenCard,
	})
	repo.addOrder(o)

	// Pass 1 attaches the PaymentIntent and the card declines. The order is NOT
	// expired in the same pass that first touched it — the deadline is stamped
	// here, and an order gets at least one full window before it can die.
	first, err := svc.SettlePendingListingOrders(ctx, 10)
	require.NoError(t, err)
	require.Equal(t, 1, first.Charged)
	require.Equal(t, 1, first.Declined)
	require.Equal(t, 0, first.Expired)

	// Pass 2: the (1ns) window has elapsed, the card still declines, and the
	// order reaches the terminal state. Without this a permanently bad card
	// would produce an immortal order that the sweeper retries forever.
	second, err := svc.SettlePendingListingOrders(ctx, 10)
	require.NoError(t, err)
	assert.Equal(t, 1, second.Declined)
	assert.Equal(t, 1, second.Expired)

	got, err := repo.GetListingOrder(ctx, o.ID)
	require.NoError(t, err)
	assert.Equal(t, "payment_failed", got.EscrowStatus)
}

// TestOffSession_DisarmedCollectsNothing: with the kill switch off the sweeper
// must behave exactly as it did before off-session collection existed — attach a
// PaymentIntent, move no money.
func TestOffSession_DisarmedCollectsNothing(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	svc, repo, _, dir, ss := offSessionFixture(t)
	svc.SetOffSessionCharge(false)

	o := newOrder("disarmed", "pending_payment", 10000, 1000)
	saveCardFor(t, dir, ss, o.BuyerID)
	repo.addOrder(o)

	stats, err := svc.SettlePendingListingOrders(ctx, 10)
	require.NoError(t, err)
	assert.Equal(t, 1, stats.Charged)
	assert.Equal(t, 0, stats.Collected)
	assert.Equal(t, 0, stats.NoInstrument, "disarmed is not the same as 'buyer has no card'")

	got, err := repo.GetListingOrder(ctx, o.ID)
	require.NoError(t, err)
	assert.Equal(t, "pending_payment", got.EscrowStatus)
}

// TestOffSession_RetryAfterDeclineSucceeds proves the attempt-scoped idempotency
// key does its job through the whole sweeper: a buyer whose card declined once
// can pay on a later pass.
func TestOffSession_RetryAfterDeclineSucceeds(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	svc, repo, _, dir, ss := offSessionFixture(t)

	o := newOrder("retry", "pending_payment", 10000, 1000)
	pmID := saveCardFor(t, dir, ss, o.BuyerID)
	ss.DevStore().SetDeclineRule(pmID, &stripe.Error{
		Code:        stripe.ErrorCodeCardDeclined,
		DeclineCode: stripe.DeclineCodeInsufficientFunds,
	})
	repo.addOrder(o)

	first, err := svc.SettlePendingListingOrders(ctx, 10)
	require.NoError(t, err)
	require.Equal(t, 1, first.InsufficientFn)
	require.Equal(t, 0, first.Collected)

	// The buyer adds funds.
	ss.DevStore().SetDeclineRule(pmID, nil)

	second, err := svc.SettlePendingListingOrders(ctx, 10)
	require.NoError(t, err)
	assert.Equal(t, 1, second.Collected,
		"a later pass must be a REAL retry, not a replay of the cached decline")

	got, err := repo.GetListingOrder(ctx, o.ID)
	require.NoError(t, err)
	assert.Equal(t, "held", got.EscrowStatus)
}
