package service

// Regression guards for the security/integrity fixes landed in the audit sweep.
// Each test pins a money-safety invariant so the fix cannot silently regress:
//
//   - CreatePlatformTransfer REQUIRES a non-empty idempotency key, and a repeated
//     key dedups to the SAME transfer (no double payout). (commit 4a88bc3)
//   - CreateRefund accumulates the cumulative refunded total and caps it at the
//     captured amount — never refunds more than was escrowed. (commit baed610)
//   - DisburseAdvance on a non-approved advance returns the typed
//     ErrAdvanceNotApproved sentinel (gRPC maps it to 422, not 500), and a
//     repeated disburse for the same advance dedups the platform transfer.
//     (commit 4a88bc3)

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

// --- CreatePlatformTransfer idempotency guard ---

func TestStripeService_CreatePlatformTransfer_RequiresIdempotencyKey(t *testing.T) {
	t.Parallel()
	ss := &StripeService{devMode: true}

	_, err := ss.CreatePlatformTransfer(context.Background(), 50000, "usd", "acct_x", "")
	require.Error(t, err, "an empty idempotency key must be rejected so every platform payout is keyed")
	assert.Contains(t, err.Error(), "idempotency key required")
}

func TestStripeService_CreatePlatformTransfer_DedupsOnSameKey(t *testing.T) {
	t.Parallel()
	ss := &StripeService{devMode: true}

	const key = "advance-disburse:adv-42"
	first, err := ss.CreatePlatformTransfer(context.Background(), 50000, "usd", "acct_x", key)
	require.NoError(t, err)
	require.NotEmpty(t, first)

	// A retried / racing call with the SAME key must NOT move money twice — it
	// returns the SAME transfer id (no second payout). This is the double-payout guard.
	second, err := ss.CreatePlatformTransfer(context.Background(), 50000, "usd", "acct_x", key)
	require.NoError(t, err)
	assert.Equal(t, first, second, "same idempotency key must return the same transfer id (no double payout)")

	// A genuinely distinct payout (different key) gets its own transfer.
	other, err := ss.CreatePlatformTransfer(context.Background(), 25000, "usd", "acct_x", "advance-disburse:adv-99")
	require.NoError(t, err)
	assert.NotEqual(t, first, other, "distinct idempotency keys must yield distinct transfers")
}

// --- CreateRefund cumulative accumulation ---

// TestPaymentService_CreateRefund_AccumulatesTotalRefunded pins that the value
// PERSISTED via UpdateRefund is the CUMULATIVE total (prior + this call), not
// just this call's amount. The original bug overwrote rather than accumulated,
// so a second partial refund could silently exceed the captured amount.
func TestPaymentService_CreateRefund_AccumulatesTotalRefunded(t *testing.T) {
	t.Parallel()

	var persistedTotal int64
	var persistedStatus string
	repo := &mockPaymentRepo{
		getPaymentFn: func(_ context.Context, _ string) (*domain.Payment, error) {
			return &domain.Payment{
				ID:                    "pay-acc",
				Status:                "escrow",
				AmountCents:           10000,
				RefundAmountCents:     6000, // already refunded 6000, 4000 remaining
				StripePaymentIntentID: "pi_acc",
			}, nil
		},
		updateRefundFn: func(_ context.Context, _ string, refundAmountCents int64, _ string, _ time.Time, _ string, status string) error {
			persistedTotal = refundAmountCents
			persistedStatus = status
			return nil
		},
	}
	svc := newTestPaymentService(repo, nil)

	// Refund the remaining 4000 -> cumulative must be 10000 (fully refunded), not 4000.
	_, err := svc.CreateRefund(context.Background(), "pay-acc", 4000, "remainder")
	require.NoError(t, err)
	assert.Equal(t, int64(10000), persistedTotal, "UpdateRefund must persist the CUMULATIVE refunded total (6000 prior + 4000)")
	assert.Equal(t, "refunded", persistedStatus, "reaching the captured amount must mark the payment fully refunded")
}

// --- DisburseAdvance typed sentinel + idempotent transfer ---

func TestPaymentService_DisburseAdvance_NotApprovedReturnsTypedSentinel(t *testing.T) {
	t.Parallel()

	for _, status := range []string{"requested", "disbursed", "rejected"} {
		status := status
		t.Run(status, func(t *testing.T) {
			t.Parallel()
			repo := &mockPaymentRepo{
				getAdvanceFn: func(_ context.Context, _ string) (*domain.Advance, error) {
					return &domain.Advance{ID: "adv-1", Status: status}, nil
				},
			}
			svc := newTestPaymentService(repo, nil)

			_, _, err := svc.DisburseAdvance(context.Background(), "adv-1", "admin-1")
			require.Error(t, err)
			// The typed sentinel is what the gRPC layer maps to 422 (not 500). If
			// the fix regressed to a bare fmt.Errorf, errors.Is would fail here.
			assert.True(t, errors.Is(err, domain.ErrAdvanceNotApproved),
				"a non-approved disburse must return ErrAdvanceNotApproved so it maps to 422")
		})
	}
}

func TestPaymentService_DisburseAdvance_IdempotentTransferOnRepeat(t *testing.T) {
	t.Parallel()

	// Use ONE dev-mode StripeService across both calls so the idempotency-key
	// dedup store is shared (mirrors a single running service handling a retry).
	repo := &mockPaymentRepo{
		getAdvanceFn: func(_ context.Context, _ string) (*domain.Advance, error) {
			return &domain.Advance{ID: "adv-7", ProviderID: "prov-7", AdvanceAmountCents: 50000, Status: "approved"}, nil
		},
		getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
			return "acct_prov_7", nil
		},
		updateAdvanceDisbursementFn: func(_ context.Context, advanceID, transferID string) (*domain.Advance, error) {
			return &domain.Advance{ID: advanceID, Status: "disbursed"}, nil
		},
	}
	svc := newTestPaymentService(repo, nil)

	_, transfer1, err := svc.DisburseAdvance(context.Background(), "adv-7", "admin-1")
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(transfer1, "tr_platform_dev_"))

	// Second disburse of the SAME advance (e.g. a retry) reuses the deterministic
	// key "advance-disburse:adv-7" -> SAME transfer id -> no second money movement.
	_, transfer2, err := svc.DisburseAdvance(context.Background(), "adv-7", "admin-1")
	require.NoError(t, err)
	assert.Equal(t, transfer1, transfer2, "repeat disburse of the same advance must dedup the platform transfer (no double payout)")
}
