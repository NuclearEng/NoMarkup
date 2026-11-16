package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateRefund_parsePendingRefundID(t *testing.T) {
	t.Parallel()

	t.Run("legacy_4_part", func(t *testing.T) {
		t.Parallel()
		orig, prior, total, prev, ok := parsePendingRefundID("pending:escrow:4000:7000")
		require.True(t, ok)
		assert.Equal(t, "escrow", orig)
		assert.Equal(t, int64(4000), prior)
		assert.Equal(t, int64(7000), total)
		assert.Empty(t, prev)
	})

	t.Run("5_part_empty_prev", func(t *testing.T) {
		t.Parallel()
		orig, prior, total, prev, ok := parsePendingRefundID("pending:escrow:0:5000:-")
		require.True(t, ok)
		assert.Equal(t, "escrow", orig)
		assert.Equal(t, int64(0), prior)
		assert.Equal(t, int64(5000), total)
		assert.Empty(t, prev)
	})

	t.Run("5_part_with_prev", func(t *testing.T) {
		t.Parallel()
		orig, prior, total, prev, ok := parsePendingRefundID("pending:partially_refunded:5000:8000:re_abc")
		require.True(t, ok)
		assert.Equal(t, "partially_refunded", orig)
		assert.Equal(t, int64(5000), prior)
		assert.Equal(t, int64(8000), total)
		assert.Equal(t, "re_abc", prev)
	})

	t.Run("rejects_malformed", func(t *testing.T) {
		t.Parallel()
		_, _, _, _, ok := parsePendingRefundID("re_abc")
		assert.False(t, ok)
		_, _, _, _, ok = parsePendingRefundID("pending:escrow:x:y")
		assert.False(t, ok)
	})
}

func TestCreateRefund_pendingRefundIDEncodesPrev(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "pending:escrow:0:5000:-", pendingRefundID("escrow", 0, 5000, ""))
	assert.Equal(t, "pending:escrow:0:5000:-", pendingRefundID("escrow", 0, 5000, "pending:x:0:1"))
	assert.Equal(t, "pending:partially_refunded:5000:8000:re_abc",
		pendingRefundID("partially_refunded", 5000, 8000, "re_abc"))
}

func TestCreateRefund_secondPartialStripeFailRestoresPriorID(t *testing.T) {
	t.Parallel()

	store := &concurrentEscrowRepo{
		payment: &domain.Payment{
			ID:                    "pay-revert-prev",
			CustomerID:            "cust-1",
			ProviderID:            "prov-1",
			Status:                "escrow",
			AmountCents:           10000,
			StripePaymentIntentID: "pi_revert_prev",
		},
	}
	svc := newTestPaymentService(store.asMock(), nil)

	first, err := svc.CreateRefund(context.Background(), "pay-revert-prev", 4000, "first", ReleaseActor{IsAdmin: true})
	require.NoError(t, err)
	require.Equal(t, int64(4000), first.RefundAmountCents)
	require.False(t, strings.HasPrefix(first.StripeRefundID, "pending:"))
	priorID := first.StripeRefundID
	require.NotEmpty(t, priorID)

	stripeErr := errors.New("stripe declined")
	svc.stripe.testFailRefund = stripeErr
	_, err = svc.CreateRefund(context.Background(), "pay-revert-prev", 3000, "second", ReleaseActor{IsAdmin: true})
	require.ErrorIs(t, err, stripeErr)

	store.mu.Lock()
	assert.Equal(t, int64(4000), store.payment.RefundAmountCents)
	assert.Equal(t, priorID, store.payment.StripeRefundID, "revert must restore the previous Stripe refund id")
	assert.False(t, strings.HasPrefix(store.payment.StripeRefundID, "pending:"))
	assert.Equal(t, "partially_refunded", store.payment.Status)
	store.mu.Unlock()

	svc.stripe.testFailRefund = nil
	got, err := svc.CreateRefund(context.Background(), "pay-revert-prev", 3000, "second retry", ReleaseActor{IsAdmin: true})
	require.NoError(t, err, "remaining balance must stay refundable after a reverted Stripe failure")
	assert.Equal(t, int64(7000), got.RefundAmountCents)
	assert.Equal(t, "partially_refunded", got.Status)
	assert.False(t, strings.HasPrefix(got.StripeRefundID, "pending:"))
	assert.NotEqual(t, priorID, got.StripeRefundID)
}

func TestCreateRefund_revertFailureSurfacesWithStripeError(t *testing.T) {
	t.Parallel()

	stripeErr := errors.New("card declined")
	revertErr := errors.New("db down")
	payment := &domain.Payment{
		ID:                    "pay-revert-err",
		Status:                "escrow",
		AmountCents:           10000,
		StripePaymentIntentID: "pi_revert_err",
	}
	repo := &mockPaymentRepo{
		getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
			p := *payment
			return &p, nil
		},
		updateRefundCASFn: func(_ context.Context, _ string, _, newTotal int64, _ string, _ time.Time, refundID, status string) error {
			payment.RefundAmountCents = newTotal
			payment.StripeRefundID = refundID
			payment.Status = status
			return nil
		},
		revertRefundClaimFn: func(_ context.Context, _ string, _ int64, _, _ string) error {
			return revertErr
		},
	}
	svc := newTestPaymentService(repo, nil)
	svc.stripe.testFailRefund = stripeErr

	_, err := svc.CreateRefund(context.Background(), payment.ID, 0, "fail", ReleaseActor{IsAdmin: true})
	require.ErrorIs(t, err, stripeErr, "stripe error is primary")
	assert.Contains(t, err.Error(), "revert")
	assert.Contains(t, err.Error(), revertErr.Error())
}

func TestCreateRefund_stampCASMissStampsIDOnly(t *testing.T) {
	t.Parallel()

	payment := &domain.Payment{
		ID:                    "pay-stamp-miss",
		Status:                "escrow",
		AmountCents:           10000,
		StripePaymentIntentID: "pi_stamp_miss",
	}
	var pendingKey string
	repo := &mockPaymentRepo{
		getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
			p := *payment
			return &p, nil
		},
		updateRefundCASFn: func(_ context.Context, _ string, _, newTotal int64, _ string, _ time.Time, refundID, status string) error {
			if strings.HasPrefix(refundID, "pending:") {
				pendingKey = refundID
				payment.RefundAmountCents = newTotal
				payment.StripeRefundID = refundID
				payment.Status = status
				return nil
			}
			return domain.ErrInvalidAmount
		},
		stampRefundIDFn: func(_ context.Context, _ string, gotPending, refundID string) error {
			if gotPending != pendingKey || payment.StripeRefundID != pendingKey {
				return domain.ErrInvalidAmount
			}
			payment.StripeRefundID = refundID
			return nil
		},
	}
	svc := newTestPaymentService(repo, nil)

	got, err := svc.CreateRefund(context.Background(), payment.ID, 0, "full", ReleaseActor{IsAdmin: true})
	require.NoError(t, err)
	assert.Equal(t, "refunded", got.Status)
	assert.False(t, strings.HasPrefix(got.StripeRefundID, "pending:"))
	assert.NotEmpty(t, got.StripeRefundID)
}

func TestCreateRefund_customerMayResumePendingEscrowRefund(t *testing.T) {
	t.Parallel()

	store := &concurrentEscrowRepo{
		payment: &domain.Payment{
			ID:                    "pay-resume-pending",
			CustomerID:            "cust-1",
			ProviderID:            "prov-1",
			Status:                "refunded",
			AmountCents:           10000,
			RefundAmountCents:     10000,
			StripePaymentIntentID: "pi_resume_pending",
			StripeRefundID:        pendingRefundID("escrow", 0, 10000, ""),
		},
	}
	svc := newTestPaymentService(store.asMock(), nil)

	got, err := svc.CreateRefund(context.Background(), "pay-resume-pending", 0, "retry after timeout",
		ReleaseActor{UserID: "cust-1"})
	require.NoError(t, err)
	assert.Equal(t, "refunded", got.Status)
	assert.False(t, strings.HasPrefix(got.StripeRefundID, "pending:"))
	assert.Equal(t, int64(10000), got.RefundAmountCents)
}

func TestCreateRefund_strangerCannotResumePending(t *testing.T) {
	t.Parallel()

	store := &concurrentEscrowRepo{
		payment: &domain.Payment{
			ID:                    "pay-resume-stranger",
			CustomerID:            "cust-1",
			ProviderID:            "prov-1",
			Status:                "partially_refunded",
			AmountCents:           10000,
			RefundAmountCents:     4000,
			StripePaymentIntentID: "pi_resume_stranger",
			StripeRefundID:        pendingRefundID("escrow", 0, 4000, ""),
		},
	}
	svc := newTestPaymentService(store.asMock(), nil)

	_, err := svc.CreateRefund(context.Background(), "pay-resume-stranger", 4000, "not mine",
		ReleaseActor{UserID: "bystander"})
	require.ErrorIs(t, err, domain.ErrNotAuthorizedActor)
}

func TestCreateRefund_stampDoesNotSucceedWhilePending(t *testing.T) {
	t.Parallel()

	payment := &domain.Payment{
		ID:                    "pay-stamp-pending",
		Status:                "escrow",
		AmountCents:           10000,
		RefundAmountCents:     10000,
		StripePaymentIntentID: "pi_stamp_pending",
		StripeRefundID:        pendingRefundID("escrow", 0, 10000, ""),
	}
	repo := &mockPaymentRepo{
		getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
			p := *payment
			return &p, nil
		},
		updateRefundCASFn: func(_ context.Context, _ string, _, _ int64, _ string, _ time.Time, refundID, _ string) error {
			if strings.HasPrefix(refundID, "pending:") {
				return nil
			}
			return domain.ErrInvalidAmount
		},
		stampRefundIDFn: func(_ context.Context, _ string, _, _ string) error {
			return domain.ErrInvalidAmount
		},
	}
	svc := newTestPaymentService(repo, nil)

	_, err := svc.CreateRefund(context.Background(), payment.ID, 0, "retry", ReleaseActor{IsAdmin: true})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "stamp")
}

func TestCreateRefund_revertFirstClaimClearsPending(t *testing.T) {
	t.Parallel()

	store := &concurrentEscrowRepo{
		payment: &domain.Payment{
			ID:                    "pay-revert-first",
			Status:                "escrow",
			AmountCents:           10000,
			StripePaymentIntentID: "pi_revert_first",
		},
	}
	svc := newTestPaymentService(store.asMock(), nil)
	svc.stripe.testFailRefund = errors.New("stripe timeout")

	_, err := svc.CreateRefund(context.Background(), "pay-revert-first", 0, "full", ReleaseActor{IsAdmin: true})
	require.Error(t, err)

	store.mu.Lock()
	defer store.mu.Unlock()
	assert.Equal(t, int64(0), store.payment.RefundAmountCents)
	assert.Empty(t, store.payment.StripeRefundID)
	assert.Equal(t, "escrow", store.payment.Status)
}
