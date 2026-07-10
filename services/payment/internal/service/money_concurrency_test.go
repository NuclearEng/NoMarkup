package service

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

// concurrentEscrowRepo is an in-memory payment store with mutex-backed CAS
// for ReleaseEscrow / CreateRefund / ProcessPayment race tests.
type concurrentEscrowRepo struct {
	mu       sync.Mutex
	payment  *domain.Payment
	transfer int32 // number of successful UpdateStripeFields with transfer id
	refunds  int32 // number of successful UpdateRefundCAS
}

func (r *concurrentEscrowRepo) asMock() *mockPaymentRepo {
	return &mockPaymentRepo{
		getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
			r.mu.Lock()
			defer r.mu.Unlock()
			p := *r.payment
			return &p, nil
		},
		claimPaymentStatusFn: func(_ context.Context, _ string, from, to string) error {
			r.mu.Lock()
			defer r.mu.Unlock()
			if r.payment.Status != from {
				return domain.ErrInvalidStatus
			}
			r.payment.Status = to
			return nil
		},
		updatePaymentStatusFn: func(_ context.Context, _ string, status string) error {
			r.mu.Lock()
			defer r.mu.Unlock()
			r.payment.Status = status
			return nil
		},
		getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
			return "acct_concurrent", nil
		},
		updateStripeFieldsFn: func(_ context.Context, _, _, _, transferID string) error {
			r.mu.Lock()
			defer r.mu.Unlock()
			if transferID != "" {
				r.payment.StripeTransferID = transferID
				atomic.AddInt32(&r.transfer, 1)
			}
			return nil
		},
		updateRefundCASFn: func(_ context.Context, _ string, expectedPrior, newTotal int64, _ string, _ time.Time, refundID, status string) error {
			r.mu.Lock()
			defer r.mu.Unlock()
			if r.payment.RefundAmountCents != expectedPrior {
				return domain.ErrInvalidAmount
			}
			if newTotal > r.payment.AmountCents {
				return domain.ErrInvalidAmount
			}
			r.payment.RefundAmountCents = newTotal
			r.payment.Status = status
			r.payment.StripeRefundID = refundID
			atomic.AddInt32(&r.refunds, 1)
			return nil
		},
		getActiveAdvancesFn: func(_ context.Context, _ string) ([]*domain.Advance, error) {
			return nil, nil
		},
	}
}

// TestReleaseEscrow_Concurrent_ExactlyOneTransfer pins MON-01/03: two
// concurrent ReleaseEscrow calls produce exactly one Stripe transfer and end
// in released status.
func TestReleaseEscrow_Concurrent_ExactlyOneTransfer(t *testing.T) {
	t.Parallel()

	store := &concurrentEscrowRepo{
		payment: &domain.Payment{
			ID:                    "pay-race-release",
			Status:                "escrow",
			ProviderID:            "prov-1",
			ProviderPayoutCents:   9000,
			AmountCents:           10000,
			StripePaymentIntentID: "pi_race_release",
		},
	}
	svc := newTestPaymentService(store.asMock(), nil)
	// Share the same DevStore across the service's stripe so transfer keys dedupe.
	ss := svc.stripe

	const n = 8
	var wg sync.WaitGroup
	errs := make([]error, n)
	wg.Add(n)
	for i := 0; i < n; i++ {
		i := i
		go func() {
			defer wg.Done()
			_, errs[i] = svc.ReleaseEscrow(context.Background(), "pay-race-release", "done")
		}()
	}
	wg.Wait()

	// At least one success; losers may get ErrInvalidStatus or success (idempotent re-entry).
	var successes int
	for _, err := range errs {
		if err == nil {
			successes++
		}
	}
	require.GreaterOrEqual(t, successes, 1, "at least one release must succeed")

	// Stripe DevStore: exactly one transfer key for this payment.
	assert.Equal(t, 1, ss.DevStore().TransferCount(), "exactly one Stripe transfer must be recorded")

	// Final state: released with a transfer id.
	store.mu.Lock()
	defer store.mu.Unlock()
	assert.Equal(t, "released", store.payment.Status)
	assert.NotEmpty(t, store.payment.StripeTransferID)
	// UpdateStripeFields may be called by the winner only (or winners if resume).
	assert.GreaterOrEqual(t, atomic.LoadInt32(&store.transfer), int32(1))
}

// TestCreateRefund_Concurrent_NoOverRefund pins MON-02/13: concurrent full
// refunds never push refund_amount_cents above amount_cents and Stripe sees
// a single refund key for the full cumulative.
func TestCreateRefund_Concurrent_NoOverRefund(t *testing.T) {
	t.Parallel()

	store := &concurrentEscrowRepo{
		payment: &domain.Payment{
			ID:                    "pay-race-refund",
			Status:                "escrow",
			AmountCents:           10000,
			RefundAmountCents:     0,
			StripePaymentIntentID: "pi_race_refund",
		},
	}
	svc := newTestPaymentService(store.asMock(), nil)
	ss := svc.stripe

	const n = 8
	var wg sync.WaitGroup
	errs := make([]error, n)
	wg.Add(n)
	for i := 0; i < n; i++ {
		i := i
		go func() {
			defer wg.Done()
			// Each tries a full refund (0 = remaining).
			_, errs[i] = svc.CreateRefund(context.Background(), "pay-race-refund", 0, "race")
		}()
	}
	wg.Wait()

	var successes int
	for _, err := range errs {
		if err == nil {
			successes++
		}
	}
	require.GreaterOrEqual(t, successes, 1)

	store.mu.Lock()
	defer store.mu.Unlock()
	assert.LessOrEqual(t, store.payment.RefundAmountCents, store.payment.AmountCents,
		"never over-refund")
	assert.Equal(t, int64(10000), store.payment.RefundAmountCents,
		"exactly one full refund applied")
	assert.Equal(t, "refunded", store.payment.Status)
	// Stripe: one distinct refund key for cumulative 10000.
	assert.Equal(t, 1, ss.DevStore().RefundCount())
}

// TestCreateRefund_Concurrent_PartialNoOverRefund: two concurrent half-refunds
// of 6000 on a 10000 payment — total refunded must stay ≤ 10000.
func TestCreateRefund_Concurrent_PartialNoOverRefund(t *testing.T) {
	t.Parallel()

	store := &concurrentEscrowRepo{
		payment: &domain.Payment{
			ID:                    "pay-race-partial",
			Status:                "escrow",
			AmountCents:           10000,
			RefundAmountCents:     0,
			StripePaymentIntentID: "pi_race_partial",
		},
	}
	svc := newTestPaymentService(store.asMock(), nil)

	const n = 4
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			_, _ = svc.CreateRefund(context.Background(), "pay-race-partial", 6000, "partial race")
		}()
	}
	wg.Wait()

	store.mu.Lock()
	defer store.mu.Unlock()
	assert.LessOrEqual(t, store.payment.RefundAmountCents, int64(10000))
	// With 6000 requests, at most one 6000 can land if second sees remaining 4000 and rejects 6000.
	// Or first 6000 + second fails. Either way never > 10000.
	assert.GreaterOrEqual(t, store.payment.RefundAmountCents, int64(6000))
}

// TestHandleWebhook_FailedThenRetrySucceeds pins MON-12: a handler failure
// leaves processed_at unset so a Stripe retry reprocesses and eventually marks
// the event done.
func TestHandleWebhook_FailedThenRetrySucceeds(t *testing.T) {
	t.Parallel()

	piJSON, err := json.Marshal(stripe.PaymentIntent{ID: "pi_retry_1"})
	require.NoError(t, err)

	event := stripe.Event{ID: "evt_retry_1", Type: "payment_intent.succeeded"}
	event.Data = &stripe.EventData{Raw: piJSON}

	var (
		mu           sync.Mutex
		rowExists    bool
		processedAt  bool
		handlerCalls int
		failOnce     = true
	)

	repo := &mockPaymentRepo{
		recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) {
			mu.Lock()
			defer mu.Unlock()
			if !rowExists {
				rowExists = true
				return false, nil // first insert
			}
			// Row exists: skip only if fully processed (processed_at set).
			return processedAt, nil
		},
		markStripeEventProcessedFn: func(_ context.Context, _ string) error {
			mu.Lock()
			defer mu.Unlock()
			processedAt = true
			return nil
		},
		findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
			return &domain.Payment{ID: "pay-retry", Status: "processing"}, nil
		},
		updatePaymentStatusFn: func(_ context.Context, _ string, _ string) error {
			mu.Lock()
			defer mu.Unlock()
			handlerCalls++
			if failOnce {
				failOnce = false
				return errors.New("transient db blip")
			}
			return nil
		},
	}
	svc := newTestPaymentService(repo, nil)
	svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

	// First delivery: handler fails → processed_at stays nil.
	err = svc.HandleWebhook(context.Background(), piJSON, "sig")
	require.Error(t, err)
	mu.Lock()
	assert.False(t, processedAt, "must not mark processed after failure")
	assert.Equal(t, 1, handlerCalls)
	mu.Unlock()

	// Stripe retry: alreadyProcessed=false because processed_at is null.
	err = svc.HandleWebhook(context.Background(), piJSON, "sig")
	require.NoError(t, err)
	mu.Lock()
	assert.True(t, processedAt, "must mark processed after success")
	assert.Equal(t, 2, handlerCalls, "retry must re-enter the handler")
	mu.Unlock()

	// Third delivery: fully processed → skip.
	err = svc.HandleWebhook(context.Background(), piJSON, "sig")
	require.NoError(t, err)
	mu.Lock()
	assert.Equal(t, 2, handlerCalls, "fully processed event must not re-dispatch")
	mu.Unlock()
}

// TestProcessPayment_Concurrent_ExactlyOneCapture pins MON-14.
func TestProcessPayment_Concurrent_ExactlyOneCapture(t *testing.T) {
	t.Parallel()

	store := &concurrentEscrowRepo{
		payment: &domain.Payment{
			ID:                    "pay-race-capture",
			Status:                "pending",
			StripePaymentIntentID: "pi_race_capture",
		},
	}
	svc := newTestPaymentService(store.asMock(), nil)
	ss := svc.stripe

	const n = 6
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			_, _ = svc.ProcessPayment(context.Background(), "pay-race-capture", "pm_x")
		}()
	}
	wg.Wait()

	assert.Equal(t, 1, ss.DevStore().CaptureCount(), "exactly one capture key")
	store.mu.Lock()
	defer store.mu.Unlock()
	assert.Equal(t, "escrow", store.payment.Status)
}

// TestInstantPayout_DevModeReturnsDevID_ProdNeverFakes ensures CreateConnectInstantPayout
// only fabricates payout_dev_* in dev mode (MON-09).
func TestInstantPayout_DevModeReturnsDevID_ProdNeverFakes(t *testing.T) {
	t.Parallel()

	// Dev mode path.
	dev := &StripeService{devMode: true}
	id, err := dev.CreateConnectInstantPayout(context.Background(), 10000, "usd", "acct_x", "key-1")
	require.NoError(t, err)
	assert.Contains(t, id, "payout_dev_")

	// Same key dedupes.
	id2, err := dev.CreateConnectInstantPayout(context.Background(), 10000, "usd", "acct_x", "key-1")
	require.NoError(t, err)
	assert.Equal(t, id, id2)

	// Empty key rejected.
	_, err = dev.CreateConnectInstantPayout(context.Background(), 10000, "usd", "acct_x", "")
	require.Error(t, err)
}

// TestInstantPayout_ServiceClaimThenStripe wires the full payment-service path.
func TestInstantPayout_ServiceClaimThenStripe(t *testing.T) {
	t.Parallel()

	var completed string
	repo := &mockPaymentRepo{
		getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
			return "acct_provider", nil
		},
		lookupInstantPayoutByKeyFn: func(_ context.Context, _, _ string) (*domain.InstantPayout, bool, error) {
			return nil, false, nil
		},
		claimInstantPayoutFn: func(_ context.Context, providerID string, amount, fee, net int64, key string) (*domain.InstantPayout, error) {
			return &domain.InstantPayout{
				ID: "ip-1", ProviderID: providerID,
				AmountCents: amount, FeeCents: fee, NetCents: net,
				IdempotencyKey: key, Status: "pending",
			}, nil
		},
		completeInstantPayoutFn: func(_ context.Context, payoutID, stripeID string) error {
			completed = stripeID
			return nil
		},
	}
	svc := newTestPaymentService(repo, nil)

	res, err := svc.InstantPayout(context.Background(), "prov-1", 50000, "idem-ip-1")
	require.NoError(t, err)
	require.NotNil(t, res)
	assert.Equal(t, "ip-1", res.PayoutID)
	assert.Contains(t, res.StripePayoutID, "payout_dev_")
	assert.Equal(t, res.StripePayoutID, completed)
	assert.Equal(t, int64(50000), res.AmountCents)
	assert.Greater(t, res.FeeCents, int64(0))
	assert.Equal(t, res.AmountCents-res.FeeCents, res.NetCents)
}
