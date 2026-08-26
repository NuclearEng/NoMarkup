package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

// TestEscrowStateMachine consolidates the payment-side escrow lifecycle into
// a single readable suite. Each subtest drives one transition end-to-end and
// asserts both the resulting status AND the side effects (Stripe call, DB
// writes) that should accompany it.
//
// Coverage map (see qa/payment-test-plan.md Test 5):
//
//   pending       -- ProcessPayment ----------> escrow
//   escrow        -- ReleaseEscrow -----------> released         (also creates transfer)
//   escrow        -- CreateRefund (full) -----> refunded
//   escrow        -- CreateRefund (partial) --> partially_refunded
//   escrow        -- charge.dispute.created -> disputed          (webhook)
//   released      -- CreateRefund -----------> refunded
//   pending       -- ReleaseEscrow ----------> ErrInvalidStatus  (rejected)
//   pending       -- CreateRefund -----------> ErrInvalidStatus  (rejected)
//   escrow        -- ProcessPayment ---------> ErrPaymentAlreadyProcessed
//
// The auto-release timer lives in services/job/internal/service/contract.go
// (AutoReleaseCompletedContracts). It walks contracts where the provider
// marked complete > 7 days ago. We exercise the *payment* side of release in
// "escrow_to_released" — the time-based selection is covered in the contract
// service tests.

type escrowFixture struct {
	t              *testing.T
	currentStatus  string
	transferCalls  int
	refundCalls    int
	updateCalls    map[string]int
	stripeAcctID   string
	transferAmount int64
	repo           *mockPaymentRepo
	svc            *PaymentService
}

func newEscrowFixture(t *testing.T, initialStatus string, payment *domain.Payment) *escrowFixture {
	t.Helper()
	f := &escrowFixture{
		t:             t,
		currentStatus: initialStatus,
		updateCalls:   make(map[string]int),
		stripeAcctID:  "acct_prov_test",
	}

	payment.Status = initialStatus

	f.repo = &mockPaymentRepo{
		getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
			p := *payment
			p.Status = f.currentStatus
			return &p, nil
		},
		updatePaymentStatusFn: func(_ context.Context, _ string, status string) error {
			f.updateCalls[status]++
			f.currentStatus = status
			return nil
		},
		claimPaymentStatusFn: func(_ context.Context, _ string, from, to string) error {
			if f.currentStatus != from {
				return domain.ErrInvalidStatus
			}
			f.updateCalls[to]++
			f.currentStatus = to
			return nil
		},
		getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
			return f.stripeAcctID, nil
		},
		updateStripeFieldsFn: func(_ context.Context, _, _, _, transferID string) error {
			if transferID != "" {
				f.transferCalls++
			}
			return nil
		},
		updateRefundFn: func(_ context.Context, _ string, amt int64, _ string, _ time.Time, _ string, status string) error {
			f.refundCalls++
			f.currentStatus = status
			f.transferAmount = amt
			return nil
		},
		updateRefundCASFn: func(_ context.Context, _ string, _, newTotal int64, _ string, _ time.Time, _ string, status string) error {
			f.refundCalls++
			f.currentStatus = status
			f.transferAmount = newTotal
			return nil
		},
		getActiveAdvancesFn: func(_ context.Context, _ string) ([]*domain.Advance, error) {
			return nil, nil
		},
	}
	f.svc = newTestPaymentService(f.repo, nil)
	return f
}

// activeAdvancesFn must satisfy the repo interface; the mock already provides
// stubs for all advance methods so we don't need to wire it explicitly here.

func TestEscrowStateMachine_pending_to_escrow(t *testing.T) {
	t.Parallel()

	payment := &domain.Payment{
		ID:                    "pay-1",
		ProviderID:            "prov-1",
		AmountCents:           38500,
		ProviderPayoutCents:   35795,
		StripePaymentIntentID: "pi_test",
	}
	f := newEscrowFixture(t, "pending", payment)

	got, err := f.svc.ProcessPayment(context.Background(), payment.ID, "pm_test", ReleaseActor{IsAdmin: true})
	require.NoError(t, err)
	assert.Equal(t, "escrow", got.Status)
	assert.Equal(t, 1, f.updateCalls["processing"], "must transition through processing")
	assert.Equal(t, 1, f.updateCalls["escrow"], "must end on escrow")
}

func TestEscrowStateMachine_escrow_to_released_creates_transfer(t *testing.T) {
	t.Parallel()

	payment := &domain.Payment{
		ID:                    "pay-2",
		ProviderID:            "prov-1",
		AmountCents:           38500,
		ProviderPayoutCents:   35795,
		StripePaymentIntentID: "pi_test_2",
	}
	f := newEscrowFixture(t, "escrow", payment)

	got, err := f.svc.ReleaseEscrow(context.Background(), payment.ID, "customer accepted", ReleaseActor{IsAdmin: true})
	require.NoError(t, err)
	assert.Equal(t, "released", got.Status)
	assert.Equal(t, 1, f.updateCalls["released"], "must transition to released exactly once")
	assert.Equal(t, 1, f.transferCalls, "must record transfer ID via UpdateStripeFields")
}

func TestEscrowStateMachine_escrow_to_refunded_full(t *testing.T) {
	t.Parallel()

	payment := &domain.Payment{
		ID:                    "pay-3",
		ProviderID:            "prov-1",
		AmountCents:           38500,
		ProviderPayoutCents:   35795,
		StripePaymentIntentID: "pi_test_3",
	}
	f := newEscrowFixture(t, "escrow", payment)

	got, err := f.svc.CreateRefund(context.Background(), payment.ID, 0, "customer requested", ReleaseActor{IsAdmin: true})
	require.NoError(t, err)
	assert.Equal(t, "refunded", got.Status)
	assert.Equal(t, 2, f.refundCalls, "claim pending then stamp Stripe refund id")
	assert.Equal(t, int64(38500), f.transferAmount, "full refund records full amount")
}

func TestEscrowStateMachine_escrow_to_partially_refunded(t *testing.T) {
	t.Parallel()

	payment := &domain.Payment{
		ID:                    "pay-4",
		ProviderID:            "prov-1",
		AmountCents:           38500,
		ProviderPayoutCents:   35795,
		StripePaymentIntentID: "pi_test_4",
	}
	f := newEscrowFixture(t, "escrow", payment)

	got, err := f.svc.CreateRefund(context.Background(), payment.ID, 10000, "minor revision", ReleaseActor{IsAdmin: true})
	require.NoError(t, err)
	assert.Equal(t, "partially_refunded", got.Status)
	assert.Equal(t, int64(10000), f.transferAmount, "partial refund records partial amount")
}

func TestEscrowStateMachine_released_to_refunded(t *testing.T) {
	t.Parallel()

	// Refund is allowed after release (e.g. dispute resolution after payout).
	payment := &domain.Payment{
		ID:                    "pay-5",
		ProviderID:            "prov-1",
		AmountCents:           38500,
		ProviderPayoutCents:   35795,
		StripePaymentIntentID: "pi_test_5",
	}
	f := newEscrowFixture(t, "released", payment)

	got, err := f.svc.CreateRefund(context.Background(), payment.ID, 0, "post-release dispute", ReleaseActor{IsAdmin: true})
	require.NoError(t, err)
	assert.Equal(t, "refunded", got.Status)
}

func TestEscrowStateMachine_pending_cannot_release(t *testing.T) {
	t.Parallel()

	payment := &domain.Payment{ID: "pay-6", ProviderID: "prov-1", StripePaymentIntentID: "pi_x"}
	f := newEscrowFixture(t, "pending", payment)

	_, err := f.svc.ReleaseEscrow(context.Background(), payment.ID, "premature", ReleaseActor{IsAdmin: true})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrInvalidStatus))
	assert.Equal(t, 0, f.transferCalls, "no transfer must occur on rejected transition")
}

func TestEscrowStateMachine_pending_cannot_refund(t *testing.T) {
	t.Parallel()

	payment := &domain.Payment{ID: "pay-7", ProviderID: "prov-1", StripePaymentIntentID: "pi_y"}
	f := newEscrowFixture(t, "pending", payment)

	_, err := f.svc.CreateRefund(context.Background(), payment.ID, 0, "", ReleaseActor{IsAdmin: true})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrInvalidStatus))
	assert.Equal(t, 0, f.refundCalls)
}

func TestEscrowStateMachine_escrow_cannot_be_processed_again(t *testing.T) {
	t.Parallel()

	payment := &domain.Payment{ID: "pay-8", ProviderID: "prov-1", StripePaymentIntentID: "pi_z"}
	f := newEscrowFixture(t, "escrow", payment)

	_, err := f.svc.ProcessPayment(context.Background(), payment.ID, "pm_test", ReleaseActor{IsAdmin: true})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrPaymentAlreadyProcessed))
}

// TestEscrowStateMachine_dispute_during_escrow exercises the webhook path.
// A charge.dispute.created event for a payment in escrow must flip the
// payment to "disputed" so payout is blocked downstream.
func TestEscrowStateMachine_dispute_during_escrow(t *testing.T) {
	t.Parallel()

	piID := "pi_disputed_1"
	disputeJSON, err := json.Marshal(stripe.Dispute{
		ID:            "dp_1",
		PaymentIntent: &stripe.PaymentIntent{ID: piID},
	})
	require.NoError(t, err)

	event := stripe.Event{ID: "evt_disp_1", Type: "charge.dispute.created"}
	event.Data = &stripe.EventData{Raw: disputeJSON}

	var statusUpdates []string
	repo := &mockPaymentRepo{
		recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
		markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
		findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
			return &domain.Payment{ID: "pay-disputed", Status: "escrow"}, nil
		},
		updatePaymentStatusFn: func(_ context.Context, _ string, status string) error {
			statusUpdates = append(statusUpdates, status)
			return nil
		},
	}
	svc := newTestPaymentService(repo, nil)
	svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

	err = svc.HandleWebhook(context.Background(), disputeJSON, "sig")
	require.NoError(t, err)
	require.Len(t, statusUpdates, 1, "exactly one status update must be applied")
	assert.Equal(t, "disputed", statusUpdates[0])
}

// TestEscrowStateMachine_dispute_replay_is_idempotent verifies that a redelivered
// charge.dispute.created event is NOT applied a second time. The dedup row in
// stripe_events guards against double-flipping the payment status (which would
// be a no-op here, but the principle matters for refund/transfer events that
// have real side effects).
func TestEscrowStateMachine_dispute_replay_is_idempotent(t *testing.T) {
	t.Parallel()

	piID := "pi_disputed_2"
	disputeJSON, err := json.Marshal(stripe.Dispute{
		ID:            "dp_2",
		PaymentIntent: &stripe.PaymentIntent{ID: piID},
	})
	require.NoError(t, err)

	event := stripe.Event{ID: "evt_disp_2", Type: "charge.dispute.created"}
	event.Data = &stripe.EventData{Raw: disputeJSON}

	var findCalls int
	repo := &mockPaymentRepo{
		recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) {
			// Simulate a duplicate delivery — the row already exists.
			return true, nil
		},
		findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
			findCalls++
			return nil, nil
		},
	}
	svc := newTestPaymentService(repo, nil)
	svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

	err = svc.HandleWebhook(context.Background(), disputeJSON, "sig")
	require.NoError(t, err)
	assert.Zero(t, findCalls, "duplicate dispute event must not re-flip the payment status")
}
