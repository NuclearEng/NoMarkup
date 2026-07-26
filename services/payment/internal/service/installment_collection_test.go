package service

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// BNPL collection — ProcessDueInstallments had no caller, so installments 2..N
// were never charged while the provider had already been paid the full contract
// amount at plan creation. These tests pin the collection semantics the new
// scheduler depends on, and in particular the distinction the old code did not
// make: a customer whose card declined has defaulted; a customer the platform
// has no chargeable Stripe customer for has not.

// statusRecorder captures every UpdateScheduledInstallmentStatus call so a test
// can assert exactly which transitions happened, in order.
type statusRecorder struct {
	calls []string
}

func (r *statusRecorder) fn() func(context.Context, string, string, *string) error {
	return func(_ context.Context, _, status string, _ *string) error {
		r.calls = append(r.calls, status)
		return nil
	}
}

func dueInstallment(id, planID string, attempts int) domain.ScheduledInstallment {
	return domain.ScheduledInstallment{
		ID:                id,
		PlanID:            planID,
		InstallmentNumber: 2,
		AmountCents:       10000,
		DueDate:           time.Now().Add(-24 * time.Hour),
		Status:            "scheduled",
		Attempts:          attempts,
	}
}

// TestProcessDueInstallments_blocked_when_no_payment_instrument is the
// fail-closed behaviour. GetStripeCustomerID reads
// subscriptions.stripe_customer_id, which is never populated anywhere in this
// repo, so it returns ("", nil) — no error — for every user. The old code only
// substituted on a returned error, so the empty case reached Stripe as
// Customer:"" + PaymentMethod:"", was rejected, and three passes later defaulted
// a plan belonging to a customer who had done nothing wrong.
func TestProcessDueInstallments_blocked_when_no_payment_instrument(t *testing.T) {
	t.Parallel()

	rec := &statusRecorder{}
	var defaulted []string
	repo := &mockPaymentRepo{
		getDueInstallmentsFn: func(_ context.Context, _ time.Time) ([]domain.ScheduledInstallment, error) {
			return []domain.ScheduledInstallment{dueInstallment("i1", "plan-1", 0)}, nil
		},
		getInstallmentPlanFn: func(_ context.Context, planID string) (*domain.InstallmentPlan, error) {
			return &domain.InstallmentPlan{ID: planID, CustomerID: "cust-1"}, nil
		},
		getStripeCustomerIDFn: func(_ context.Context, _ string) (string, error) {
			return "", nil // the production reality: no row, no error
		},
		updateScheduledInstallmentStatusFn: rec.fn(),
		updateInstallmentPlanStatusFn: func(_ context.Context, planID, status string) error {
			defaulted = append(defaulted, planID+":"+status)
			return nil
		},
	}

	// Production mode: no dev stub to paper over the missing customer.
	svc := NewInstallmentService(repo, &StripeService{devMode: false})

	stats, err := svc.ProcessDueInstallments(context.Background())
	require.NoError(t, err, "a blocked installment must not fail the whole pass")

	assert.Equal(t, 1, stats.Due)
	assert.Equal(t, 1, stats.Blocked)
	assert.Equal(t, 0, stats.Declined, "not a customer payment failure")
	assert.Equal(t, 0, stats.Charged)
	assert.Equal(t, 0, stats.PlansDefaulted)

	assert.Empty(t, rec.calls,
		"the row must be left untouched so no retry attempt is burned")
	assert.Empty(t, defaulted,
		"a platform configuration failure must never default a customer's plan")
}

// TestProcessDueInstallments_does_not_burn_two_attempts_per_try guards the
// double-increment. UpdateScheduledInstallmentStatus increments `attempts` for
// BOTH 'processing' and the terminal status, so pre-marking 'processing' cost
// two attempts per real attempt — halving the retry budget, and changing the
// attempt number that seeds the Stripe idempotency key, so a crash between the
// Stripe call and the status write would retry under a different key and charge
// the customer twice.
func TestProcessDueInstallments_does_not_burn_two_attempts_per_try(t *testing.T) {
	t.Parallel()

	rec := &statusRecorder{}
	repo := &mockPaymentRepo{
		getDueInstallmentsFn: func(_ context.Context, _ time.Time) ([]domain.ScheduledInstallment, error) {
			return []domain.ScheduledInstallment{dueInstallment("i1", "plan-1", 0)}, nil
		},
		getInstallmentPlanFn: func(_ context.Context, planID string) (*domain.InstallmentPlan, error) {
			return &domain.InstallmentPlan{ID: planID, CustomerID: "cust-1"}, nil
		},
		updateScheduledInstallmentStatusFn: rec.fn(),
		getScheduledInstallmentsForPlanFn: func(_ context.Context, _ string) ([]domain.ScheduledInstallment, error) {
			return []domain.ScheduledInstallment{{Status: "scheduled"}}, nil
		},
	}
	svc := newTestInstallmentService(repo)

	stats, err := svc.ProcessDueInstallments(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, stats.Charged)
	assert.Equal(t, []string{"paid"}, rec.calls,
		"exactly one status write per attempt — no 'processing' pre-mark")
}

func TestProcessDueInstallments_batchOutcomes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		due         []domain.ScheduledInstallment
		planFn      func(context.Context, string) (*domain.InstallmentPlan, error)
		wantDue     int
		wantCharged int
	}{
		{
			name:        "no_due_installments",
			due:         nil,
			wantDue:     0,
			wantCharged: 0,
		},
		{
			name: "charges_every_due_installment",
			due: []domain.ScheduledInstallment{
				dueInstallment("i1", "plan-1", 0),
				dueInstallment("i2", "plan-2", 0),
			},
			wantDue:     2,
			wantCharged: 2,
		},
		{
			name: "one_unreadable_plan_does_not_stall_the_batch",
			due: []domain.ScheduledInstallment{
				dueInstallment("bad", "plan-missing", 0),
				dueInstallment("ok", "plan-2", 0),
			},
			planFn: func(_ context.Context, planID string) (*domain.InstallmentPlan, error) {
				if planID == "plan-missing" {
					return nil, errors.New("plan vanished")
				}
				return &domain.InstallmentPlan{ID: planID, CustomerID: "cust-1"}, nil
			},
			wantDue:     2,
			wantCharged: 1,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			planFn := tc.planFn
			if planFn == nil {
				planFn = func(_ context.Context, planID string) (*domain.InstallmentPlan, error) {
					return &domain.InstallmentPlan{ID: planID, CustomerID: "cust-1"}, nil
				}
			}
			repo := &mockPaymentRepo{
				getDueInstallmentsFn: func(_ context.Context, _ time.Time) ([]domain.ScheduledInstallment, error) {
					return tc.due, nil
				},
				getInstallmentPlanFn:               planFn,
				updateScheduledInstallmentStatusFn: func(context.Context, string, string, *string) error { return nil },
				getScheduledInstallmentsForPlanFn: func(_ context.Context, _ string) ([]domain.ScheduledInstallment, error) {
					return []domain.ScheduledInstallment{{Status: "scheduled"}}, nil
				},
			}
			svc := newTestInstallmentService(repo)

			stats, err := svc.ProcessDueInstallments(context.Background())
			require.NoError(t, err)
			assert.Equal(t, tc.wantDue, stats.Due)
			assert.Equal(t, tc.wantCharged, stats.Charged)
		})
	}
}

// TestProcessDueInstallments_declined_card_defaults_on_the_final_attempt is the
// other half of the distinction: Stripe DID attempt the charge and refused, so
// this genuinely is the customer's payment failure. It burns an attempt and, on
// the third one, defaults the plan.
//
// Not parallel: useStripeTestBackend swaps the package-level Stripe backend.
func TestProcessDueInstallments_declined_card_defaults_on_the_final_attempt(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{"error":{"type":"card_error","code":"card_declined","message":"Your card was declined."}}`))
	}))
	t.Cleanup(srv.Close)
	useStripeTestBackend(t, srv.URL, 0, 5*time.Second)

	tests := []struct {
		name              string
		attemptsSoFar     int
		wantPlanDefaulted int
	}{
		{name: "first_decline_retries", attemptsSoFar: 0, wantPlanDefaulted: 0},
		{name: "second_decline_retries", attemptsSoFar: 1, wantPlanDefaulted: 0},
		{name: "third_decline_defaults_the_plan", attemptsSoFar: 2, wantPlanDefaulted: 1},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := &statusRecorder{}
			repo := &mockPaymentRepo{
				getDueInstallmentsFn: func(_ context.Context, _ time.Time) ([]domain.ScheduledInstallment, error) {
					return []domain.ScheduledInstallment{dueInstallment("i1", "plan-1", tc.attemptsSoFar)}, nil
				},
				getInstallmentPlanFn: func(_ context.Context, planID string) (*domain.InstallmentPlan, error) {
					return &domain.InstallmentPlan{ID: planID, CustomerID: "cust-1"}, nil
				},
				getStripeCustomerIDFn: func(_ context.Context, _ string) (string, error) {
					return "cus_live_customer", nil
				},
				updateScheduledInstallmentStatusFn: rec.fn(),
				updateInstallmentPlanStatusFn:      func(context.Context, string, string) error { return nil },
			}
			svc := NewInstallmentService(repo, &StripeService{devMode: false})

			stats, err := svc.ProcessDueInstallments(context.Background())
			require.NoError(t, err)

			assert.Equal(t, 1, stats.Declined, "Stripe attempted and refused: a real payment failure")
			assert.Equal(t, 0, stats.Blocked)
			assert.Equal(t, 0, stats.Charged)
			assert.Equal(t, tc.wantPlanDefaulted, stats.PlansDefaulted)
			assert.Equal(t, []string{"failed"}, rec.calls,
				"one status write per attempt — the repo derives retrying/failed from the attempt count")
		})
	}
}
