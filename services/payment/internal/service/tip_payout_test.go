package service

import (
	"context"
	"testing"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/require"
)

func tipRepo(stored **domain.Payment) *mockPaymentRepo {
	repo := &mockPaymentRepo{}
	repo.getContractForPaymentFn = func(_ context.Context, contractID string) (*domain.ContractForPayment, error) {
		return &domain.ContractForPayment{
			ID:          contractID,
			CustomerID:  "cust-1",
			ProviderID:  "prov-1",
			AmountCents: 10_000,
			Status:      "completed",
		}, nil
	}
	repo.createPaymentFn = func(_ context.Context, payment *domain.Payment) error {
		if *stored != nil {
			return domain.ErrIdempotencyConflict
		}
		cp := *payment
		*stored = &cp
		return nil
	}
	repo.updateStripeFieldsFn = func(_ context.Context, id, piID, _, transferID string) error {
		if *stored == nil || (*stored).ID != id {
			return nil
		}
		if piID != "" {
			(*stored).StripePaymentIntentID = piID
		}
		if transferID != "" {
			(*stored).StripeTransferID = transferID
		}
		return nil
	}
	repo.getPaymentByIdempotencyKeyFn = func(_ context.Context, key string) (*domain.Payment, error) {
		if *stored == nil || (*stored).IdempotencyKey != key {
			return nil, domain.ErrPaymentNotFound
		}
		cp := **stored
		return &cp, nil
	}
	return repo
}

func TestChargeContractTip_TransferFailureDoesNotStampTip(t *testing.T) {
	t.Parallel()
	var stored *domain.Payment
	repo := tipRepo(&stored)
	stamped := false
	repo.setContractTipIfZeroFn = func(context.Context, string, int64) (bool, error) {
		stamped = true
		return true, nil
	}
	var status string
	repo.updatePaymentStatusFn = func(_ context.Context, _, next string) error {
		status = next
		return nil
	}
	svc := newTestPaymentService(repo, nil)
	svc.stripe.testFailTransfer = true
	provisionCustomerWithDefaultPM(t, svc, "cust-1")

	_, piID, tip, gotStatus, succeeded, err := svc.ChargeContractTip(context.Background(), "contract-1", "cust-1", 500, "tip-key-1")
	require.ErrorIs(t, err, domain.ErrTipPayoutPending)
	require.False(t, succeeded)
	require.False(t, stamped)
	require.Equal(t, "processing", gotStatus)
	require.Equal(t, "processing", status)
	require.NotEmpty(t, piID)
	require.Equal(t, int64(0), tip)
}

func TestChargeContractTip_ResumeRetriesTransferWithoutSecondCharge(t *testing.T) {
	t.Parallel()
	var stored *domain.Payment
	repo := tipRepo(&stored)
	stamped := 0
	repo.setContractTipIfZeroFn = func(context.Context, string, int64) (bool, error) {
		stamped++
		return true, nil
	}
	svc := newTestPaymentService(repo, nil)
	svc.stripe.testFailTransfer = true
	provisionCustomerWithDefaultPM(t, svc, "cust-1")
	ctx := context.Background()

	_, _, _, _, _, err := svc.ChargeContractTip(ctx, "contract-1", "cust-1", 500, "tip-key-2")
	require.ErrorIs(t, err, domain.ErrTipPayoutPending)
	require.NotEmpty(t, stored.StripePaymentIntentID)

	svc.stripe.testFailTransfer = false
	svc.stripe.testFailOffSession = true
	_, _, tip, status, succeeded, err := svc.ChargeContractTip(ctx, "contract-1", "cust-1", 500, "tip-key-2")
	require.NoError(t, err)
	require.True(t, succeeded)
	require.Equal(t, "completed", status)
	require.Equal(t, int64(500), tip)
	require.Equal(t, 1, stamped)
	require.NotEmpty(t, stored.StripeTransferID)
}

func TestChargeContractTip_InFlightKeepsPaymentIntent(t *testing.T) {
	t.Parallel()
	var stored *domain.Payment
	repo := tipRepo(&stored)
	var status string
	repo.updatePaymentStatusFn = func(_ context.Context, _, next string) error {
		status = next
		if stored != nil {
			stored.Status = next
		}
		return nil
	}
	repo.setContractTipIfZeroFn = func(context.Context, string, int64) (bool, error) {
		t.Fatal("tip must not be recorded while the charge is still processing")
		return false, nil
	}
	svc := newTestPaymentService(repo, nil)
	svc.stripe.testInFlightOffSessionID = "pi_tip_flight"
	provisionCustomerWithDefaultPM(t, svc, "cust-1")

	_, piID, _, gotStatus, succeeded, err := svc.ChargeContractTip(context.Background(), "contract-1", "cust-1", 500, "tip-key-flight")
	require.ErrorIs(t, err, ErrOffSessionInFlight)
	require.False(t, succeeded)
	require.Equal(t, "processing", gotStatus)
	require.Equal(t, "processing", status)
	require.Equal(t, "pi_tip_flight", piID)
	require.Equal(t, "pi_tip_flight", stored.StripePaymentIntentID)
	require.NotEqual(t, "failed", stored.Status)
}

func TestChargeContractTip_ResumeWithoutChargeDoesNotMintAnother(t *testing.T) {
	t.Parallel()
	existing := &domain.Payment{
		ID:             "pay-1",
		ContractID:     "contract-1",
		CustomerID:     "cust-1",
		ProviderID:     "prov-1",
		AmountCents:    500,
		IdempotencyKey: "tip-key-3",
		Status:         "failed",
	}
	repo := tipRepo(&existing)
	svc := newTestPaymentService(repo, nil)
	svc.stripe.testFailOffSession = true
	provisionCustomerWithDefaultPM(t, svc, "cust-1")

	_, _, _, _, _, err := svc.ChargeContractTip(context.Background(), "contract-1", "cust-1", 500, "tip-key-3")
	require.ErrorIs(t, err, domain.ErrPaymentIntentMissing)
	require.Empty(t, existing.StripePaymentIntentID)
}

func TestCreatePayment_RecurringVisitAmountIsExactAndInstanceScoped(t *testing.T) {
	t.Parallel()
	const contractID = "contract-1"
	visit1 := "inst-1"
	visit2 := "inst-2"
	repo := reconcileRepo(7500)
	repo.getRecurringInstanceAmountFn = func(_ context.Context, instanceID string) (string, int64, error) {
		return contractID, 7500, nil
	}
	repo.getPaymentsForContractFn = func(context.Context, string) ([]*domain.Payment, error) {
		return []*domain.Payment{{
			ContractID:          contractID,
			RecurringInstanceID: &visit1,
			AmountCents:         7500,
			Status:              "escrow",
		}}, nil
	}
	var createdAmount int64
	repo.createPaymentFn = func(_ context.Context, payment *domain.Payment) error {
		createdAmount = payment.AmountCents
		return nil
	}
	svc := newTestPaymentService(repo, nil)

	_, _, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          contractID,
		CustomerID:          "cust-1",
		AmountCents:         1,
		RecurringInstanceID: &visit2,
		IdempotencyKey:      "visit-2-penny",
	})
	require.ErrorIs(t, err, domain.ErrInvalidAmount)

	_, _, err = svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          contractID,
		CustomerID:          "cust-1",
		AmountCents:         7500,
		RecurringInstanceID: &visit2,
		IdempotencyKey:      "visit-2-full",
	})
	require.NoError(t, err)
	require.Equal(t, int64(7500), createdAmount)
}
