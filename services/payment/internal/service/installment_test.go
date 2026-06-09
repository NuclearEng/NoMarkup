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

// --- Fee rate ---

func TestFeeRateForCount(t *testing.T) {
	t.Parallel()

	cases := []struct {
		count   int
		want    float64
		wantErr bool
	}{
		{3, 0.03, false},
		{6, 0.05, false},
		{1, 0, true},
		{4, 0, true},
		{12, 0, true},
		{0, 0, true},
		{-1, 0, true},
	}

	for _, tt := range cases {
		t.Run("", func(t *testing.T) {
			t.Parallel()
			rate, err := feeRateForCount(tt.count)
			if tt.wantErr {
				require.Error(t, err)
				assert.ErrorIs(t, err, domain.ErrInvalidInstallmentCount)
				return
			}
			require.NoError(t, err)
			assert.InDelta(t, tt.want, rate, 0.0001)
		})
	}
}

// --- helpers ---

func newTestInstallmentService(repo *mockPaymentRepo) *InstallmentService {
	ss := &StripeService{devMode: true}
	return NewInstallmentService(repo, ss)
}

// --- CreateInstallmentPlan ---

func TestInstallmentService_CreateInstallmentPlan(t *testing.T) {
	t.Parallel()

	t.Run("rejects_unsupported_count", func(t *testing.T) {
		t.Parallel()
		svc := newTestInstallmentService(&mockPaymentRepo{})
		_, _, err := svc.CreateInstallmentPlan(context.Background(), domain.CreateInstallmentPlanInput{
			ContractID:       "c1",
			CustomerID:       "cust-1",
			ProviderID:       "prov-1",
			TotalAmountCents: 30000,
			InstallmentCount: 4, // not 3 or 6
			PaymentMethodID:  "pm_1",
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInvalidInstallmentCount)
	})

	t.Run("rejects_zero_amount", func(t *testing.T) {
		t.Parallel()
		svc := newTestInstallmentService(&mockPaymentRepo{})
		_, _, err := svc.CreateInstallmentPlan(context.Background(), domain.CreateInstallmentPlanInput{
			ContractID:       "c1",
			CustomerID:       "cust-1",
			ProviderID:       "prov-1",
			TotalAmountCents: 0,
			InstallmentCount: 3,
		})
		require.Error(t, err)
	})

	// Regression: /qa 2026-06-09 — CreateInstallmentPlan trusted the client's
	// total_amount_cents and provider_id and paid that provider immediately. The
	// fix derives both from the contract. The principal billed and the payee must
	// come from the contract, never the request body.
	t.Run("derives_amount_and_provider_from_contract", func(t *testing.T) {
		t.Parallel()
		var capturedPlan *domain.InstallmentPlan
		repo := &mockPaymentRepo{
			getContractForPaymentFn: func(_ context.Context, contractID string) (*domain.ContractForPayment, error) {
				return &domain.ContractForPayment{ID: contractID, CustomerID: "cust-1", ProviderID: "prov-real", AmountCents: 30000, Status: "active"}, nil
			},
			createInstallmentPlanFn:             func(_ context.Context, p *domain.InstallmentPlan) error { capturedPlan = p; return nil },
			createScheduledInstallmentsFn:       func(_ context.Context, _ []domain.ScheduledInstallment) error { return nil },
			getStripeAccountIDFn:                func(_ context.Context, _ string) (string, error) { return "acct_dev", nil },
			updateInstallmentPlanProviderPaidFn: func(_ context.Context, _, _ string) error { return nil },
			updateScheduledInstallmentStatusFn:  func(_ context.Context, _, _ string, _ *string) error { return nil },
			getInstallmentPlanFn:                func(_ context.Context, _ string) (*domain.InstallmentPlan, error) { return capturedPlan, nil },
		}
		svc := newTestInstallmentService(repo)
		plan, _, err := svc.CreateInstallmentPlan(context.Background(), domain.CreateInstallmentPlanInput{
			ContractID:       "c1",
			CustomerID:       "cust-1",
			ProviderID:       "prov-attacker", // ignored
			TotalAmountCents: 999_999_999,      // ignored
			InstallmentCount: 3,
			PaymentMethodID:  "pm_1",
		})
		require.NoError(t, err)
		require.NotNil(t, plan)
		assert.Equal(t, int64(30000), plan.TotalAmountCents, "principal must be the contract amount, not the client's")
		assert.Equal(t, "prov-real", plan.ProviderID, "payee must be the contract provider, not the client's")
	})

	t.Run("rejects_non_owner_customer", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getContractForPaymentFn: func(_ context.Context, contractID string) (*domain.ContractForPayment, error) {
				return &domain.ContractForPayment{ID: contractID, CustomerID: "cust-1", ProviderID: "prov-real", AmountCents: 30000, Status: "active"}, nil
			},
		}
		svc := newTestInstallmentService(repo)
		_, _, err := svc.CreateInstallmentPlan(context.Background(), domain.CreateInstallmentPlanInput{
			ContractID:       "c1",
			CustomerID:       "cust-attacker",
			ProviderID:       "prov-1",
			TotalAmountCents: 30000,
			InstallmentCount: 3,
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrContractNotOwned)
	})

	t.Run("3_installment_plan_fee_and_distribution", func(t *testing.T) {
		t.Parallel()
		// $300.00 × 3% fee = $9.00 → $309.00 total ÷ 3 = $103.00 each.
		var capturedPlan *domain.InstallmentPlan
		var capturedInstallments []domain.ScheduledInstallment
		repo := &mockPaymentRepo{
			getContractForPaymentFn: func(_ context.Context, contractID string) (*domain.ContractForPayment, error) {
				return &domain.ContractForPayment{ID: contractID, CustomerID: "cust-1", ProviderID: "prov-1", AmountCents: 30000, Status: "active"}, nil
			},
			createInstallmentPlanFn: func(_ context.Context, p *domain.InstallmentPlan) error {
				capturedPlan = p
				return nil
			},
			createScheduledInstallmentsFn: func(_ context.Context, ins []domain.ScheduledInstallment) error {
				capturedInstallments = ins
				return nil
			},
			getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
				return "acct_provider_dev", nil
			},
			updateInstallmentPlanProviderPaidFn: func(_ context.Context, _, _ string) error { return nil },
			updateScheduledInstallmentStatusFn:  func(_ context.Context, _, _ string, _ *string) error { return nil },
			getInstallmentPlanFn: func(_ context.Context, _ string) (*domain.InstallmentPlan, error) {
				return capturedPlan, nil
			},
		}
		svc := newTestInstallmentService(repo)

		plan, _, err := svc.CreateInstallmentPlan(context.Background(), domain.CreateInstallmentPlanInput{
			ContractID:       "c1",
			CustomerID:       "cust-1",
			ProviderID:       "prov-1",
			TotalAmountCents: 30000,
			InstallmentCount: 3,
			PaymentMethodID:  "pm_1",
			IdempotencyKey:   "idem-1",
		})
		require.NoError(t, err)
		require.NotNil(t, plan)
		assert.Equal(t, int64(900), plan.BNPLFeeCents,
			"3% of $300 should be $9.00 = 900 cents")
		assert.Equal(t, int64(30900), plan.TotalWithFeeCents)
		assert.Equal(t, int64(10300), plan.PerInstallmentCents,
			"$309/3 = $103.00 per installment")
		assert.InDelta(t, 0.03, plan.FeeRate, 0.0001)
		assert.Equal(t, "active", plan.Status)
		require.Len(t, capturedInstallments, 3)
		// Sum of installments must equal totalWithFee, even with rounding.
		var sum int64
		for _, inst := range capturedInstallments {
			sum += inst.AmountCents
		}
		assert.Equal(t, int64(30900), sum,
			"sum of installments must equal totalWithFee (no money lost to rounding)")
	})

	t.Run("6_installment_with_rounding_remainder_in_last", func(t *testing.T) {
		t.Parallel()
		// $100.00 × 5% fee = $5.00 → $105.00 / 6 = $17.50 each.
		// Per-installment = 105_00 / 6 = 1750 (integer division).
		// 1750 × 6 = 10500 — exactly evenly divisible. No remainder here.
		// Pick an amount that DOES produce a remainder: $100.01 × 5% = $5.00 (rounded down)
		// → totalWithFee = $105.01 = 10501 cents / 6 = 1750. 1750*6 = 10500. Remainder = 1.
		var captured []domain.ScheduledInstallment
		repo := &mockPaymentRepo{
			getContractForPaymentFn: func(_ context.Context, contractID string) (*domain.ContractForPayment, error) {
				return &domain.ContractForPayment{ID: contractID, CustomerID: "cust-1", ProviderID: "prov-1", AmountCents: 10001, Status: "active"}, nil
			},
			createScheduledInstallmentsFn: func(_ context.Context, ins []domain.ScheduledInstallment) error {
				captured = ins
				return nil
			},
			getStripeAccountIDFn:                func(_ context.Context, _ string) (string, error) { return "acct_dev", nil },
			updateInstallmentPlanProviderPaidFn: func(_ context.Context, _, _ string) error { return nil },
			updateScheduledInstallmentStatusFn:  func(_ context.Context, _, _ string, _ *string) error { return nil },
			getInstallmentPlanFn: func(_ context.Context, _ string) (*domain.InstallmentPlan, error) {
				return &domain.InstallmentPlan{}, nil
			},
		}
		svc := newTestInstallmentService(repo)

		_, _, err := svc.CreateInstallmentPlan(context.Background(), domain.CreateInstallmentPlanInput{
			ContractID:       "c1",
			CustomerID:       "cust-1",
			ProviderID:       "prov-1",
			TotalAmountCents: 10001,
			InstallmentCount: 6,
			PaymentMethodID:  "pm_1",
		})
		require.NoError(t, err)
		require.Len(t, captured, 6)
		var sum int64
		for _, inst := range captured {
			sum += inst.AmountCents
		}
		// 10001 + (10001 * 0.05) = 10001 + 500 = 10501.
		assert.Equal(t, int64(10501), sum,
			"sum of installments must equal totalWithFee = principal + fee")
		// First 5 installments are equal; last absorbs remainder.
		for i := 0; i < 5; i++ {
			assert.Equal(t, captured[0].AmountCents, captured[i].AmountCents,
				"installments 1..5 must be equal")
		}
	})

	t.Run("propagates_create_plan_db_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			createInstallmentPlanFn: func(_ context.Context, _ *domain.InstallmentPlan) error {
				return errors.New("constraint violation")
			},
		}
		svc := newTestInstallmentService(repo)
		_, _, err := svc.CreateInstallmentPlan(context.Background(), domain.CreateInstallmentPlanInput{
			ContractID:       "c1",
			CustomerID:       "cust-1",
			ProviderID:       "prov-1",
			TotalAmountCents: 30000,
			InstallmentCount: 3,
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "constraint violation")
	})

	t.Run("propagates_provider_stripe_account_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
				return "", errors.New("provider not connected")
			},
		}
		svc := newTestInstallmentService(repo)
		_, _, err := svc.CreateInstallmentPlan(context.Background(), domain.CreateInstallmentPlanInput{
			ContractID:       "c1",
			CustomerID:       "cust-1",
			ProviderID:       "prov-1",
			TotalAmountCents: 30000,
			InstallmentCount: 3,
		})
		require.Error(t, err)
		assert.True(t, strings.Contains(err.Error(), "provider not connected"))
	})
}

// --- ConfirmInstallmentPaymentSucceeded ---

func TestInstallmentService_ConfirmInstallmentPaymentSucceeded(t *testing.T) {
	t.Parallel()

	t.Run("marks_paid_and_completes_plan_when_all_paid", func(t *testing.T) {
		t.Parallel()
		var planStatusUpdate string
		repo := &mockPaymentRepo{
			updateScheduledInstallmentStatusFn: func(_ context.Context, _, status string, _ *string) error {
				assert.Equal(t, "paid", status)
				return nil
			},
			getScheduledInstallmentsForPlanFn: func(_ context.Context, _ string) ([]domain.ScheduledInstallment, error) {
				// All installments paid → plan should complete.
				return []domain.ScheduledInstallment{
					{ID: "i1", Status: "paid"},
					{ID: "i2", Status: "paid"},
					{ID: "i3", Status: "paid"},
				}, nil
			},
			updateInstallmentPlanStatusFn: func(_ context.Context, _, status string) error {
				planStatusUpdate = status
				return nil
			},
		}
		svc := newTestInstallmentService(repo)
		err := svc.ConfirmInstallmentPaymentSucceeded(context.Background(), "plan-1", "i3", "pi_x")
		require.NoError(t, err)
		assert.Equal(t, "completed", planStatusUpdate,
			"plan should be marked completed when all installments paid")
	})

	t.Run("does_not_complete_plan_with_outstanding_installments", func(t *testing.T) {
		t.Parallel()
		var planStatusUpdated bool
		repo := &mockPaymentRepo{
			updateScheduledInstallmentStatusFn: func(_ context.Context, _, _ string, _ *string) error { return nil },
			getScheduledInstallmentsForPlanFn: func(_ context.Context, _ string) ([]domain.ScheduledInstallment, error) {
				return []domain.ScheduledInstallment{
					{ID: "i1", Status: "paid"},
					{ID: "i2", Status: "scheduled"}, // still outstanding
					{ID: "i3", Status: "paid"},
				}, nil
			},
			updateInstallmentPlanStatusFn: func(_ context.Context, _, _ string) error {
				planStatusUpdated = true
				return nil
			},
		}
		svc := newTestInstallmentService(repo)
		err := svc.ConfirmInstallmentPaymentSucceeded(context.Background(), "plan-1", "i1", "pi_x")
		require.NoError(t, err)
		assert.False(t, planStatusUpdated,
			"plan must NOT be completed when installments are still outstanding")
	})

	t.Run("propagates_update_status_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			updateScheduledInstallmentStatusFn: func(_ context.Context, _, _ string, _ *string) error {
				return errors.New("db down")
			},
		}
		svc := newTestInstallmentService(repo)
		err := svc.ConfirmInstallmentPaymentSucceeded(context.Background(), "plan-1", "i1", "pi_x")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "db down")
	})
}

// --- ProcessDueInstallments ---

func TestInstallmentService_ProcessDueInstallments(t *testing.T) {
	t.Parallel()

	t.Run("no_due_installments_is_noop", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getDueInstallmentsFn: func(_ context.Context, _ time.Time) ([]domain.ScheduledInstallment, error) {
				return nil, nil
			},
		}
		svc := newTestInstallmentService(repo)
		err := svc.ProcessDueInstallments(context.Background())
		require.NoError(t, err)
	})

	t.Run("propagates_fetch_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getDueInstallmentsFn: func(_ context.Context, _ time.Time) ([]domain.ScheduledInstallment, error) {
				return nil, errors.New("db unreachable")
			},
		}
		svc := newTestInstallmentService(repo)
		err := svc.ProcessDueInstallments(context.Background())
		require.Error(t, err)
		assert.Contains(t, err.Error(), "db unreachable")
	})

	t.Run("processes_each_due_installment_via_dev_stripe", func(t *testing.T) {
		t.Parallel()
		// Dev-mode Stripe always succeeds. Verify we attempt to update each
		// installment's status to "paid".
		var paidCount int
		repo := &mockPaymentRepo{
			getDueInstallmentsFn: func(_ context.Context, _ time.Time) ([]domain.ScheduledInstallment, error) {
				return []domain.ScheduledInstallment{
					{ID: "i1", PlanID: "plan-1", AmountCents: 10000, InstallmentNumber: 2},
					{ID: "i2", PlanID: "plan-2", AmountCents: 5000, InstallmentNumber: 2},
				}, nil
			},
			getInstallmentPlanFn: func(_ context.Context, planID string) (*domain.InstallmentPlan, error) {
				return &domain.InstallmentPlan{ID: planID, CustomerID: "cust-1"}, nil
			},
			updateScheduledInstallmentStatusFn: func(_ context.Context, _, status string, _ *string) error {
				if status == "paid" {
					paidCount++
				}
				return nil
			},
			getScheduledInstallmentsForPlanFn: func(_ context.Context, _ string) ([]domain.ScheduledInstallment, error) {
				// Don't auto-complete the plan in this test.
				return []domain.ScheduledInstallment{{Status: "scheduled"}}, nil
			},
		}
		svc := newTestInstallmentService(repo)
		err := svc.ProcessDueInstallments(context.Background())
		require.NoError(t, err)
		assert.Equal(t, 2, paidCount, "both installments should be marked paid")
	})
}

// --- GetInstallmentPlan / ListInstallmentPlans ---

func TestInstallmentService_GetAndList(t *testing.T) {
	t.Parallel()

	t.Run("get_returns_plan_for_owning_customer", func(t *testing.T) {
		t.Parallel()
		expected := &domain.InstallmentPlan{ID: "plan-1", CustomerID: "cust-1", ProviderID: "prov-1"}
		repo := &mockPaymentRepo{
			getInstallmentPlanFn: func(_ context.Context, planID string) (*domain.InstallmentPlan, error) {
				assert.Equal(t, "plan-1", planID)
				return expected, nil
			},
		}
		svc := newTestInstallmentService(repo)
		got, err := svc.GetInstallmentPlan(context.Background(), "plan-1", "cust-1", false)
		require.NoError(t, err)
		assert.Equal(t, expected, got)
	})

	t.Run("get_returns_plan_for_owning_provider", func(t *testing.T) {
		t.Parallel()
		expected := &domain.InstallmentPlan{ID: "plan-1", CustomerID: "cust-1", ProviderID: "prov-1"}
		repo := &mockPaymentRepo{
			getInstallmentPlanFn: func(_ context.Context, _ string) (*domain.InstallmentPlan, error) {
				return expected, nil
			},
		}
		svc := newTestInstallmentService(repo)
		got, err := svc.GetInstallmentPlan(context.Background(), "plan-1", "prov-1", false)
		require.NoError(t, err)
		assert.Equal(t, expected, got)
	})

	t.Run("get_denies_non_owner_with_not_found", func(t *testing.T) {
		t.Parallel()
		plan := &domain.InstallmentPlan{ID: "plan-1", CustomerID: "cust-1", ProviderID: "prov-1"}
		repo := &mockPaymentRepo{
			getInstallmentPlanFn: func(_ context.Context, _ string) (*domain.InstallmentPlan, error) {
				return plan, nil
			},
		}
		svc := newTestInstallmentService(repo)
		got, err := svc.GetInstallmentPlan(context.Background(), "plan-1", "attacker", false)
		require.ErrorIs(t, err, domain.ErrInstallmentPlanNotFound)
		assert.Nil(t, got)
	})

	t.Run("get_allows_admin_for_any_plan", func(t *testing.T) {
		t.Parallel()
		expected := &domain.InstallmentPlan{ID: "plan-1", CustomerID: "cust-1", ProviderID: "prov-1"}
		repo := &mockPaymentRepo{
			getInstallmentPlanFn: func(_ context.Context, _ string) (*domain.InstallmentPlan, error) {
				return expected, nil
			},
		}
		svc := newTestInstallmentService(repo)
		got, err := svc.GetInstallmentPlan(context.Background(), "plan-1", "some-admin", true)
		require.NoError(t, err)
		assert.Equal(t, expected, got)
	})

	t.Run("list_delegates_to_repo", func(t *testing.T) {
		t.Parallel()
		expected := []*domain.InstallmentPlan{{ID: "p1"}, {ID: "p2"}}
		repo := &mockPaymentRepo{
			listInstallmentPlansFn: func(_ context.Context, userID, statusFilter string, page, pageSize int) ([]*domain.InstallmentPlan, int, error) {
				assert.Equal(t, "user-1", userID)
				assert.Equal(t, "active", statusFilter)
				assert.Equal(t, 2, page)
				assert.Equal(t, 25, pageSize)
				return expected, 100, nil
			},
		}
		svc := newTestInstallmentService(repo)
		got, total, err := svc.ListInstallmentPlans(context.Background(), "user-1", "active", 2, 25)
		require.NoError(t, err)
		assert.Equal(t, expected, got)
		assert.Equal(t, 100, total)
	})
}
