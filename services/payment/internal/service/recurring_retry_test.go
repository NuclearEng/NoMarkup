package service

import (
	"context"
	"sync"
	"testing"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

func TestOffSessionAttemptFromIdempotencyKey(t *testing.T) {
	t.Parallel()
	assert.Equal(t, 1, offSessionAttemptFromIdempotencyKey(""))
	assert.Equal(t, 1, offSessionAttemptFromIdempotencyKey("recurring-instance-pay:inst-1"))
	assert.Equal(t, 2, offSessionAttemptFromIdempotencyKey("recurring-instance-pay:inst-1:attempt-2"))
	assert.Equal(t, 3, offSessionAttemptFromIdempotencyKey("x:attempt-3"))
	assert.Equal(t, 1, offSessionAttemptFromIdempotencyKey("x:attempt-0"))
	assert.Equal(t, 1, offSessionAttemptFromIdempotencyKey("x:attempt-nope"))
}

// TestCreatePayment_FailedRecurringRemintWithAttemptN: unique(recurring_instance)
// row in failed status is reminted with attempt-scoped key and can fund off-session.
func TestCreatePayment_FailedRecurringRemintWithAttemptN(t *testing.T) {
	t.Parallel()
	repo := recurringVisitRepo()
	ss := &StripeService{devMode: true}
	svc := NewPaymentService(repo, ss)
	dir := newFakeCustomerDirectory()
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, ss))
	_, _ = provisionCustomerWithDefaultPM(t, svc, "cust-1")

	instanceID := "inst-remint-1"
	failed := &domain.Payment{
		ID:                  "pay-failed-1",
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		ProviderID:          "user-1",
		AmountCents:         7500,
		PlatformFeeCents:    750,
		ProviderPayoutCents: 6750,
		Status:              "failed",
		IdempotencyKey:      "recurring-instance-pay:" + instanceID,
		RecurringInstanceID: &instanceID,
	}
	require.NoError(t, repo.createPaymentFn(context.Background(), failed))

	// Next CreatePayment hits unique on recurring_instance → soft-replay remint path.
	var mu sync.Mutex
	repo.getPaymentByRecurringInstanceIDFn = func(_ context.Context, id string) (*domain.Payment, error) {
		assert.Equal(t, instanceID, id)
		mu.Lock()
		defer mu.Unlock()
		p, err := repo.getPaymentFn(context.Background(), failed.ID)
		return p, err
	}
	repo.createPaymentFn = func(_ context.Context, _ *domain.Payment) error {
		return domain.ErrRecurringInstancePaymentExists
	}

	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		AmountCents:         7500,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "recurring-instance-pay:" + instanceID + ":attempt-2",
	})
	require.NoError(t, err)
	require.NotNil(t, payment)
	assert.Equal(t, "escrow", payment.Status, "remint + off-session should fund")
	assert.Empty(t, secret)
	assert.NotEmpty(t, payment.StripePaymentIntentID)
}

// TestCreatePayment_PendingSoftReplayReOffSessionAttempt2: scheduled retry with
// attempt-2 re-enters off-session on an existing pending PI after a day-0 decline.
func TestCreatePayment_PendingSoftReplayReOffSessionAttempt2(t *testing.T) {
	t.Parallel()
	repo := recurringVisitRepo()
	ss := &StripeService{devMode: true}
	svc := NewPaymentService(repo, ss)
	dir := newFakeCustomerDirectory()
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, ss))
	_, pmID := provisionCustomerWithDefaultPM(t, svc, "cust-1")

	instanceID := "inst-pending-retry"
	// First create succeeds with on-session residual (decline off-session).
	ss.DevStore().SetDeclineRule(pmID, &stripe.Error{
		Code: stripe.ErrorCodeCardDeclined,
		Msg:  "declined",
	})
	first, secret1, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		AmountCents:         7500,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "recurring-instance-pay:" + instanceID,
	})
	require.NoError(t, err)
	require.NotNil(t, first)
	assert.Equal(t, "pending", first.Status)
	assert.NotEmpty(t, secret1)

	// Soft-replay path: unique conflict + load by instance.
	repo.getPaymentByRecurringInstanceIDFn = func(_ context.Context, id string) (*domain.Payment, error) {
		assert.Equal(t, instanceID, id)
		return repo.getPaymentFn(context.Background(), first.ID)
	}
	repo.createPaymentFn = func(_ context.Context, _ *domain.Payment) error {
		return domain.ErrRecurringInstancePaymentExists
	}

	// Card fixed; attempt-2 must not replay attempt-1 decline.
	ss.DevStore().SetDeclineRule(pmID, nil)
	second, secret2, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		AmountCents:         7500,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "recurring-instance-pay:" + instanceID + ":attempt-2",
	})
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.Equal(t, first.ID, second.ID)
	assert.Equal(t, "escrow", second.Status)
	assert.Empty(t, secret2)
}
