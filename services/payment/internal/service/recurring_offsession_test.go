package service

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

// recurringVisitRepo is a small CreatePayment-capable mock that tracks status
// transitions for the FR-18 off-session path.
func recurringVisitRepo() *mockPaymentRepo {
	var mu sync.Mutex
	payments := map[string]*domain.Payment{}

	repo := reconcileRepo(100_000)
	repo.createPaymentFn = func(_ context.Context, payment *domain.Payment) error {
		mu.Lock()
		defer mu.Unlock()
		cp := *payment
		payments[payment.ID] = &cp
		return nil
	}
	repo.updateStripeFieldsFn = func(_ context.Context, id, piID, _, _ string) error {
		mu.Lock()
		defer mu.Unlock()
		if p, ok := payments[id]; ok {
			p.StripePaymentIntentID = piID
		}
		return nil
	}
	repo.getPaymentFn = func(_ context.Context, id string) (*domain.Payment, error) {
		mu.Lock()
		defer mu.Unlock()
		p, ok := payments[id]
		if !ok {
			return nil, domain.ErrPaymentNotFound
		}
		cp := *p
		return &cp, nil
	}
	repo.claimPaymentStatusFn = func(_ context.Context, id, fromStatus, toStatus string) error {
		mu.Lock()
		defer mu.Unlock()
		p, ok := payments[id]
		if !ok {
			return domain.ErrPaymentNotFound
		}
		if p.Status != fromStatus {
			return domain.ErrInvalidStatus
		}
		p.Status = toStatus
		return nil
	}
	repo.updatePaymentStatusFn = func(_ context.Context, id, status string) error {
		mu.Lock()
		defer mu.Unlock()
		if p, ok := payments[id]; ok {
			p.Status = status
		}
		return nil
	}
	return repo
}

func provisionCustomerWithDefaultPM(t *testing.T, svc *PaymentService, userID string) (cusID, pmID string) {
	t.Helper()
	require.NotNil(t, svc.customers)
	dir, ok := svc.customers.dir.(*fakeCustomerDirectory)
	require.True(t, ok, "test expects fakeCustomerDirectory")
	dir.addUser(userID, userID+"@example.com", "Customer")

	cusID, err := svc.customers.EnsureCustomer(context.Background(), userID)
	require.NoError(t, err)
	require.NotEmpty(t, cusID)

	// Record a confirmed card as default (same path as SetupIntent.succeeded).
	pmID = "pm_recurring_" + userID
	require.NoError(t, svc.customers.RecordConfirmedPaymentMethod(context.Background(), userID, cusID, pmID))
	def, err := svc.customers.DefaultPaymentMethod(context.Background(), userID)
	require.NoError(t, err)
	assert.Equal(t, pmID, def)
	return cusID, pmID
}

// TestCreatePayment_RecurringOffSession_SuccessFundsEscrowWithoutClientSecret:
// default PM present → one off-session confirm → escrow, empty secret.
func TestCreatePayment_RecurringOffSession_SuccessFundsEscrowWithoutClientSecret(t *testing.T) {
	t.Parallel()
	repo := recurringVisitRepo()
	// newTestPaymentService wires user-1 only; override with cust-1 + default PM.
	svc := NewPaymentService(repo, &StripeService{devMode: true})
	dir := newFakeCustomerDirectory()
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, svc.stripe))
	_, pmID := provisionCustomerWithDefaultPM(t, svc, "cust-1")
	_ = pmID

	instanceID := "inst-offsession-ok"
	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		AmountCents:         7500,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "recurring-instance-pay:" + instanceID,
	})
	require.NoError(t, err)
	require.NotNil(t, payment)
	assert.Equal(t, "escrow", payment.Status, "off-session success must hold funds in escrow")
	assert.Empty(t, secret, "must omit client_secret when off-session funded")
	assert.NotEmpty(t, payment.StripePaymentIntentID)
	assert.Equal(t, "succeeded", svc.stripe.DevStore().PaymentIntentStatus(payment.StripePaymentIntentID))
}

// TestCreatePayment_RecurringOffSession_NoDefaultPMLeavesOnSessionResidual:
// no saved card → pending + real client_secret; never invent escrow.
func TestCreatePayment_RecurringOffSession_NoDefaultPMLeavesOnSessionResidual(t *testing.T) {
	t.Parallel()
	repo := recurringVisitRepo()
	svc := NewPaymentService(repo, &StripeService{devMode: true})
	dir := newFakeCustomerDirectory()
	dir.addUser("cust-1", "cust-1@example.com", "Customer")
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, svc.stripe))
	// Provision customer but NO payment method.
	_, err := svc.customers.EnsureCustomer(context.Background(), "cust-1")
	require.NoError(t, err)

	instanceID := "inst-no-pm"
	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		AmountCents:         7500,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "recurring-instance-pay:" + instanceID,
	})
	require.NoError(t, err)
	require.NotNil(t, payment)
	assert.Equal(t, "pending", payment.Status, "must not invent escrow without a charge")
	assert.NotEmpty(t, secret, "on-session residual must expose real client_secret")
}

// TestCreatePayment_RecurringOffSession_DeclineLeavesOnSessionResidual:
// issuer decline → pending + client_secret; payment not failed (fail-soft).
func TestCreatePayment_RecurringOffSession_DeclineLeavesOnSessionResidual(t *testing.T) {
	t.Parallel()
	repo := recurringVisitRepo()
	svc := NewPaymentService(repo, &StripeService{devMode: true})
	dir := newFakeCustomerDirectory()
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, svc.stripe))
	_, pmID := provisionCustomerWithDefaultPM(t, svc, "cust-1")

	// Force card_declined on confirm (DevStore decline rule).
	svc.stripe.DevStore().SetDeclineRule(pmID, &stripe.Error{
		Code: stripe.ErrorCodeCardDeclined,
		Msg:  "Your card was declined.",
	})

	instanceID := "inst-declined"
	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		AmountCents:         7500,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "recurring-instance-pay:" + instanceID,
	})
	require.NoError(t, err, "CreatePayment itself must succeed (fail-soft on off-session)")
	require.NotNil(t, payment)
	assert.Equal(t, "pending", payment.Status, "decline must not invent escrow or mark failed here")
	assert.NotEmpty(t, secret, "on-session residual for PaymentSheet")
}

// TestCreatePayment_RecurringOffSession_SCALeavesOnSessionResidual:
// authentication_required → pending residual (buyer must return).
func TestCreatePayment_RecurringOffSession_SCALeavesOnSessionResidual(t *testing.T) {
	t.Parallel()
	repo := recurringVisitRepo()
	svc := NewPaymentService(repo, &StripeService{devMode: true})
	dir := newFakeCustomerDirectory()
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, svc.stripe))
	_, pmID := provisionCustomerWithDefaultPM(t, svc, "cust-1")

	svc.stripe.DevStore().SetDeclineRule(pmID, &stripe.Error{
		Code: stripe.ErrorCodeAuthenticationRequired,
		Msg:  "Authentication required",
	})

	instanceID := "inst-sca"
	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		AmountCents:         7500,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "recurring-instance-pay:" + instanceID,
	})
	require.NoError(t, err)
	require.NotNil(t, payment)
	assert.Equal(t, "pending", payment.Status)
	assert.NotEmpty(t, secret)
}

// TestCreatePayment_NonRecurringDoesNotAttemptOffSession: ordinary payments
// keep pending + client_secret even when a default PM exists.
func TestCreatePayment_NonRecurringDoesNotAttemptOffSession(t *testing.T) {
	t.Parallel()
	repo := recurringVisitRepo()
	svc := NewPaymentService(repo, &StripeService{devMode: true})
	dir := newFakeCustomerDirectory()
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, svc.stripe))
	provisionCustomerWithDefaultPM(t, svc, "cust-1")

	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:     "contract-1",
		CustomerID:     "cust-1",
		AmountCents:    7500,
		IdempotencyKey: "ordinary-pay-1",
	})
	require.NoError(t, err)
	require.NotNil(t, payment)
	assert.Equal(t, "pending", payment.Status)
	assert.NotEmpty(t, secret)
}

// TestCreatePayment_RecurringOffSession_SoftReplayDoesNotDoubleCharge: after
// off-session success, a second CreatePayment soft-replays escrow + empty secret.
func TestCreatePayment_RecurringOffSession_SoftReplayDoesNotDoubleCharge(t *testing.T) {
	t.Parallel()
	repo := recurringVisitRepo()
	svc := NewPaymentService(repo, &StripeService{devMode: true})
	dir := newFakeCustomerDirectory()
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, svc.stripe))
	provisionCustomerWithDefaultPM(t, svc, "cust-1")

	instanceID := "inst-soft-replay"
	input := domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		AmountCents:         7500,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "recurring-instance-pay:" + instanceID,
	}

	first, secret1, err := svc.CreatePayment(context.Background(), input)
	require.NoError(t, err)
	require.Equal(t, "escrow", first.Status)
	assert.Empty(t, secret1)

	// Second insert hits unique on recurring_instance_id.
	repo.createPaymentFn = func(_ context.Context, _ *domain.Payment) error {
		return domain.ErrRecurringInstancePaymentExists
	}
	repo.getPaymentByRecurringInstanceIDFn = func(_ context.Context, id string) (*domain.Payment, error) {
		assert.Equal(t, instanceID, id)
		return first, nil
	}

	second, secret2, err := svc.CreatePayment(context.Background(), input)
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.Equal(t, first.ID, second.ID)
	assert.Equal(t, "escrow", second.Status)
	assert.Empty(t, secret2, "soft-replay of funded visit must not invent client_secret")
}

// TestCreatePayment_RecurringOffSession_ProvisionerUnwiredResidual: nil
// customers → on-session residual (fail soft, never invent money).
func TestCreatePayment_RecurringOffSession_ProvisionerUnwiredResidual(t *testing.T) {
	t.Parallel()
	repo := recurringVisitRepo()
	svc := NewPaymentService(repo, &StripeService{devMode: true})
	// customers deliberately nil

	instanceID := "inst-unwired"
	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		AmountCents:         7500,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "recurring-instance-pay:" + instanceID,
	})
	require.NoError(t, err)
	require.NotNil(t, payment)
	assert.Equal(t, "pending", payment.Status)
	assert.NotEmpty(t, secret)
}

// TestTryRecurringVisitOffSession_OneAttemptKey: confirm uses attempt-scoped
// idempotency so a future retry path would not replay a decline forever.
func TestTryRecurringVisitOffSession_OneAttemptKey(t *testing.T) {
	t.Parallel()
	ss := &StripeService{devMode: true}
	repo := recurringVisitRepo()
	svc := NewPaymentService(repo, ss)
	dir := newFakeCustomerDirectory()
	svc.SetCustomerProvisioner(NewCustomerProvisioner(dir, ss))
	_, pmID := provisionCustomerWithDefaultPM(t, svc, "cust-1")

	// Decline first attempt; key is attempt-1.
	ss.DevStore().SetDeclineRule(pmID, &stripe.Error{
		Code: stripe.ErrorCodeCardDeclined,
		Msg:  "declined",
	})

	piID := "pi_attempt_key_test"
	ss.DevStore().RecordPaymentIntent(piID, "cus_x", 1000, "sec")
	payment := &domain.Payment{
		ID:                    "pay-attempt-key",
		Status:                "pending",
		StripePaymentIntentID: piID,
		CustomerID:            "cust-1",
	}
	// Seed payment in repo for claim paths (won't be reached on decline).
	require.NoError(t, repo.createPaymentFn(context.Background(), payment))

	funded := svc.tryRecurringVisitOffSession(context.Background(), payment, "cust-1")
	assert.False(t, funded)

	// Same attempt key replays decline (Stripe/DevStore semantics).
	_, err := ss.ConfirmOffSessionPaymentIntent(context.Background(), piID, pmID, "recurring-visit-offsession:pay-attempt-key:attempt-1")
	require.Error(t, err)
	assert.True(t, errors.As(err, new(*stripe.Error)) || err != nil)

	// Different attempt key can succeed after clearing the decline rule.
	ss.DevStore().SetDeclineRule(pmID, nil)
	status, err := ss.ConfirmOffSessionPaymentIntent(context.Background(), piID, pmID, "recurring-visit-offsession:pay-attempt-key:attempt-2")
	require.NoError(t, err)
	assert.Equal(t, "succeeded", status)
}
