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
	_, err := svc.CreateRefund(context.Background(), "pay-acc", 4000, "remainder", ReleaseActor{IsAdmin: true})
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

// --- CreatePayment contract reconciliation guard ---
//
// Regression: /qa 2026-06-09 found CreatePayment trusted the client's
// amount_cents and provider_id with no contract reconciliation — a customer
// could charge $10,000,000 (or an int64-overflowing value) against a $700
// contract and direct the payout at an arbitrary provider. The fix loads the
// contract server-side, bounds the amount, and derives the payee.
func reconcileRepo(contractAmount int64) *mockPaymentRepo {
	return &mockPaymentRepo{
		getContractForPaymentFn: func(_ context.Context, contractID string) (*domain.ContractForPayment, error) {
			return &domain.ContractForPayment{
				ID:          contractID,
				CustomerID:  "cust-1",
				ProviderID:  "prov-real",
				AmountCents: contractAmount,
				Status:      "active",
			}, nil
		},
		getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) { return defaultFeeConfig(), nil },
		getFeeConfigFn:        func(_ context.Context, _ string) (*domain.FeeConfig, error) { return nil, domain.ErrFeeConfigNotFound },
		getStripeAccountIDFn:  func(_ context.Context, _ string) (string, error) { return "acct_prov_real", nil },
		createPaymentFn:       func(_ context.Context, _ *domain.Payment) error { return nil },
		updateStripeFieldsFn:  func(_ context.Context, _, _, _, _ string) error { return nil },
		getPaymentFn:          func(_ context.Context, _ string) (*domain.Payment, error) { return &domain.Payment{Status: "pending"}, nil },
	}
}

func TestPaymentService_CreatePayment_RejectsOverchargeAboveContract(t *testing.T) {
	t.Parallel()
	svc := newTestPaymentService(reconcileRepo(70000), nil) // $700 contract
	_, _, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:     "contract-1",
		CustomerID:     "cust-1",
		ProviderID:     "prov-1",
		AmountCents:    1_000_000_000, // $10M
		IdempotencyKey: "k1",
	})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrInvalidAmount), "amount above the contract total must be rejected")
}

func TestPaymentService_CreatePayment_RejectsNonOwnerCustomer(t *testing.T) {
	t.Parallel()
	svc := newTestPaymentService(reconcileRepo(70000), nil)
	_, _, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:     "contract-1",
		CustomerID:     "cust-attacker", // not the contract's customer
		ProviderID:     "prov-1",
		AmountCents:    5000,
		IdempotencyKey: "k2",
	})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrContractNotOwned), "a non-owning customer must not pay on the contract")
}

func TestPaymentService_CreatePayment_DerivesProviderFromContract(t *testing.T) {
	t.Parallel()
	var stored *domain.Payment
	repo := reconcileRepo(70000)
	repo.createPaymentFn = func(_ context.Context, p *domain.Payment) error { stored = p; return nil }
	repo.getPaymentFn = func(_ context.Context, _ string) (*domain.Payment, error) { return stored, nil }
	svc := newTestPaymentService(repo, nil)

	_, _, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:     "contract-1",
		CustomerID:     "cust-1",
		ProviderID:     "prov-attacker-controlled", // must be ignored
		AmountCents:    5000,
		IdempotencyKey: "k3",
	})
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, "prov-real", stored.ProviderID, "payee must come from the contract, never the client body")
}

// --- CreatePayment dual-PI soft-replay (recurring_instance_id UNIQUE) ---

func TestPaymentService_CreatePayment_SoftReplayRecurringInstance(t *testing.T) {
	t.Parallel()
	instanceID := "inst-visit-1"
	existing := &domain.Payment{
		ID:                    "pay-existing-1",
		ContractID:            "contract-1",
		RecurringInstanceID:   &instanceID,
		CustomerID:            "cust-1",
		ProviderID:            "prov-real",
		AmountCents:           5000,
		Status:                "pending",
		StripePaymentIntentID: "pi_dev_recurring-instance-pay:inst-visit-1",
		IdempotencyKey:        "recurring-instance-pay:inst-visit-1",
	}
	repo := reconcileRepo(70000)
	// First create path hits unique on recurring_instance_id (gateway vs iOS keys).
	repo.createPaymentFn = func(_ context.Context, _ *domain.Payment) error {
		return domain.ErrRecurringInstancePaymentExists
	}
	repo.getPaymentByRecurringInstanceIDFn = func(_ context.Context, id string) (*domain.Payment, error) {
		assert.Equal(t, instanceID, id)
		return existing, nil
	}
	svc := newTestPaymentService(repo, nil)
	// Seed DevStore with the PI secret CreatePaymentIntent would have recorded.
	svc.stripe.DevStore().RecordPaymentIntent(existing.StripePaymentIntentID, "", 5000, "pi_dev_secret_recurring-instance-pay:inst-visit-1")

	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		AmountCents:         5000,
		RecurringInstanceID: &instanceID,
		// Different sticky key than the original insert — dual-key race.
		IdempotencyKey: "create-payment:contract-1:5000:inst-visit-1",
	})
	require.NoError(t, err)
	require.NotNil(t, payment)
	assert.Equal(t, "pay-existing-1", payment.ID, "must reuse existing payment, not mint a second")
	assert.Equal(t, "pi_dev_secret_recurring-instance-pay:inst-visit-1", secret)
	assert.NotEmpty(t, secret, "soft-replay must return a real client_secret")
}

func TestPaymentService_CreatePayment_SoftReplayIdempotencyKey(t *testing.T) {
	t.Parallel()
	existing := &domain.Payment{
		ID:                    "pay-idem-1",
		ContractID:            "contract-1",
		CustomerID:            "cust-1",
		ProviderID:            "prov-real",
		AmountCents:           5000,
		Status:                "pending",
		StripePaymentIntentID: "pi_dev_idem-sticky-1",
		IdempotencyKey:        "idem-sticky-1",
	}
	repo := reconcileRepo(70000)
	repo.createPaymentFn = func(_ context.Context, _ *domain.Payment) error {
		return domain.ErrIdempotencyConflict
	}
	repo.getPaymentByIdempotencyKeyFn = func(_ context.Context, key string) (*domain.Payment, error) {
		assert.Equal(t, "idem-sticky-1", key)
		return existing, nil
	}
	svc := newTestPaymentService(repo, nil)
	svc.stripe.DevStore().RecordPaymentIntent(existing.StripePaymentIntentID, "", 5000, "pi_dev_secret_idem-sticky-1")

	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:     "contract-1",
		CustomerID:     "cust-1",
		AmountCents:    5000,
		IdempotencyKey: "idem-sticky-1",
	})
	require.NoError(t, err)
	require.NotNil(t, payment)
	assert.Equal(t, "pay-idem-1", payment.ID)
	assert.Equal(t, "pi_dev_secret_idem-sticky-1", secret)
}

func TestPaymentService_CreatePayment_SoftReplayMissingPIFailClosed(t *testing.T) {
	t.Parallel()
	instanceID := "inst-no-pi"
	existing := &domain.Payment{
		ID:                    "pay-no-pi",
		ContractID:            "contract-1",
		RecurringInstanceID:   &instanceID,
		CustomerID:            "cust-1",
		ProviderID:            "prov-real",
		AmountCents:           5000,
		Status:                "pending",
		StripePaymentIntentID: "", // PI never minted — fail closed
		IdempotencyKey:        "recurring-instance-pay:inst-no-pi",
	}
	repo := reconcileRepo(70000)
	repo.createPaymentFn = func(_ context.Context, _ *domain.Payment) error {
		return domain.ErrRecurringInstancePaymentExists
	}
	repo.getPaymentByRecurringInstanceIDFn = func(_ context.Context, _ string) (*domain.Payment, error) {
		return existing, nil
	}
	svc := newTestPaymentService(repo, nil)

	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		AmountCents:         5000,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "create-payment:other-key",
	})
	require.Error(t, err)
	assert.Nil(t, payment)
	assert.Empty(t, secret, "must never invent client_secret when PI is missing")
	assert.True(t, errors.Is(err, domain.ErrPaymentIntentMissing), "got %v", err)
}

func TestPaymentService_CreatePayment_SoftReplayWrongCustomerFailClosed(t *testing.T) {
	t.Parallel()
	instanceID := "inst-owned"
	existing := &domain.Payment{
		ID:                    "pay-owned",
		ContractID:            "contract-1",
		RecurringInstanceID:   &instanceID,
		CustomerID:            "cust-1",
		ProviderID:            "prov-real",
		AmountCents:           5000,
		Status:                "pending",
		StripePaymentIntentID: "pi_dev_x",
		IdempotencyKey:        "k",
	}
	repo := reconcileRepo(70000)
	// Bypass contract ownership on create (attacker passes) — soft-replay must still deny.
	repo.getContractForPaymentFn = func(_ context.Context, contractID string) (*domain.ContractForPayment, error) {
		return &domain.ContractForPayment{
			ID: contractID, CustomerID: "cust-attacker", ProviderID: "prov-real",
			AmountCents: 70000, Status: "active",
		}, nil
	}
	repo.createPaymentFn = func(_ context.Context, _ *domain.Payment) error {
		return domain.ErrRecurringInstancePaymentExists
	}
	repo.getPaymentByRecurringInstanceIDFn = func(_ context.Context, _ string) (*domain.Payment, error) {
		return existing, nil
	}
	svc := newTestPaymentService(repo, nil)

	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-attacker",
		AmountCents:         5000,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "attacker-key",
	})
	require.Error(t, err)
	assert.Nil(t, payment)
	assert.Empty(t, secret)
	assert.True(t, errors.Is(err, domain.ErrContractNotOwned), "got %v", err)
}

func TestPaymentService_CreatePayment_SoftReplayAlreadyEscrowEmptySecret(t *testing.T) {
	t.Parallel()
	instanceID := "inst-held"
	existing := &domain.Payment{
		ID:                    "pay-held",
		ContractID:            "contract-1",
		RecurringInstanceID:   &instanceID,
		CustomerID:            "cust-1",
		ProviderID:            "prov-real",
		AmountCents:           5000,
		Status:                "escrow",
		StripePaymentIntentID: "pi_dev_held",
		IdempotencyKey:        "k-held",
	}
	repo := reconcileRepo(70000)
	repo.createPaymentFn = func(_ context.Context, _ *domain.Payment) error {
		return domain.ErrRecurringInstancePaymentExists
	}
	repo.getPaymentByRecurringInstanceIDFn = func(_ context.Context, _ string) (*domain.Payment, error) {
		return existing, nil
	}
	svc := newTestPaymentService(repo, nil)

	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-1",
		CustomerID:          "cust-1",
		AmountCents:         5000,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "retry-key",
	})
	require.NoError(t, err)
	require.NotNil(t, payment)
	assert.Equal(t, "pay-held", payment.ID)
	assert.Empty(t, secret, "already-held payment has no confirmable secret — never invent one")
}

// Soft-replay refuses cross-contract reuse even if recurring_instance unique
// somehow pointed at a row for another contract (defense in depth).
func TestPaymentService_CreatePayment_SoftReplayContractMismatchFailClosed(t *testing.T) {
	t.Parallel()
	instanceID := "inst-xcontract"
	existing := &domain.Payment{
		ID:                    "pay-other-contract",
		ContractID:            "contract-ORIGINAL",
		RecurringInstanceID:   &instanceID,
		CustomerID:            "cust-1",
		ProviderID:            "prov-real",
		AmountCents:           5000,
		Status:                "pending",
		StripePaymentIntentID: "pi_dev_xcontract",
		IdempotencyKey:        "k-x",
	}
	repo := reconcileRepo(70000)
	repo.getContractForPaymentFn = func(_ context.Context, contractID string) (*domain.ContractForPayment, error) {
		return &domain.ContractForPayment{
			ID: contractID, CustomerID: "cust-1", ProviderID: "prov-real",
			AmountCents: 70000, Status: "active",
		}, nil
	}
	repo.createPaymentFn = func(_ context.Context, _ *domain.Payment) error {
		return domain.ErrRecurringInstancePaymentExists
	}
	repo.getPaymentByRecurringInstanceIDFn = func(_ context.Context, _ string) (*domain.Payment, error) {
		return existing, nil
	}
	svc := newTestPaymentService(repo, nil)

	payment, secret, err := svc.CreatePayment(context.Background(), domain.CreatePaymentInput{
		ContractID:          "contract-ATTACKER",
		CustomerID:          "cust-1",
		AmountCents:         5000,
		RecurringInstanceID: &instanceID,
		IdempotencyKey:      "attacker-xcontract",
	})
	require.Error(t, err)
	assert.Nil(t, payment)
	assert.Empty(t, secret, "must never invent client_secret on contract mismatch")
	assert.True(t, errors.Is(err, domain.ErrInvalidStatus), "got %v", err)
}
