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

// These tests cover the thin service-layer proxies (1-3 line delegations) for
// Stripe Connect onboarding, payment-method management, list endpoints, and
// admin/fee-config operations. They exist primarily to lock in error-path
// behavior and lift coverage on the otherwise untested 0% functions.

// --- Listing + simple proxies ---

func TestPaymentService_ListPayments(t *testing.T) {
	t.Parallel()
	expected := []*domain.Payment{{ID: "p1"}, {ID: "p2"}}
	repo := &mockPaymentRepo{
		listPaymentsFn: func(_ context.Context, userID, status string, page, pageSize int) ([]*domain.Payment, int, error) {
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "released", status)
			return expected, 42, nil
		},
	}
	svc := newTestPaymentService(repo, nil)
	got, total, err := svc.ListPayments(context.Background(), "user-1", "released", 1, 20)
	require.NoError(t, err)
	assert.Equal(t, expected, got)
	assert.Equal(t, 42, total)
}

func TestPaymentService_GetFeeConfig_FallbackPaths(t *testing.T) {
	t.Parallel()

	t.Run("falls_back_to_default_when_category_lookup_fails", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getFeeConfigFn: func(_ context.Context, _ string) (*domain.FeeConfig, error) {
				return nil, domain.ErrFeeConfigNotFound
			},
			getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
				return defaultFeeConfig(), nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		cat := "cat-1"
		fc, err := svc.GetFeeConfig(context.Background(), &cat)
		require.NoError(t, err)
		assert.NotNil(t, fc)
	})

	t.Run("uses_default_when_category_id_nil", func(t *testing.T) {
		t.Parallel()
		var defaultCalled bool
		repo := &mockPaymentRepo{
			getDefaultFeeConfigFn: func(_ context.Context) (*domain.FeeConfig, error) {
				defaultCalled = true
				return defaultFeeConfig(), nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		fc, err := svc.GetFeeConfig(context.Background(), nil)
		require.NoError(t, err)
		assert.NotNil(t, fc)
		assert.True(t, defaultCalled)
	})
}

// --- Stripe Connect onboarding ---

func TestPaymentService_GetStripeAccountID(t *testing.T) {
	t.Parallel()
	repo := &mockPaymentRepo{
		getStripeAccountIDFn: func(_ context.Context, userID string) (string, error) {
			assert.Equal(t, "user-1", userID)
			return "acct_xyz", nil
		},
	}
	svc := newTestPaymentService(repo, nil)
	got, err := svc.GetStripeAccountID(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Equal(t, "acct_xyz", got)
}

func TestPaymentService_CreateStripeAccount(t *testing.T) {
	t.Parallel()

	t.Run("happy_path_creates_and_persists", func(t *testing.T) {
		t.Parallel()
		var stored string
		repo := &mockPaymentRepo{
			setStripeAccountIDFn: func(_ context.Context, _, accountID string) error {
				stored = accountID
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		// Dev-mode Stripe returns "acct_dev_<email>".
		acctID, err := svc.CreateStripeAccount(context.Background(), "user-1", "test@example.com", "Acme")
		require.NoError(t, err)
		assert.True(t, strings.HasPrefix(acctID, "acct_dev_"))
		assert.Equal(t, acctID, stored, "service must persist the new Stripe account ID")
	})

	t.Run("propagates_persist_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			setStripeAccountIDFn: func(_ context.Context, _, _ string) error {
				return errors.New("db down")
			},
		}
		svc := newTestPaymentService(repo, nil)
		_, err := svc.CreateStripeAccount(context.Background(), "user-1", "test@example.com", "Acme")
		require.Error(t, err)
	})
}

func TestPaymentService_GetStripeOnboardingLink(t *testing.T) {
	t.Parallel()

	t.Run("happy_path", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
				return "acct_xyz", nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		url, err := svc.GetStripeOnboardingLink(context.Background(), "user-1", "https://app/return", "https://app/refresh")
		require.NoError(t, err)
		assert.Contains(t, url, "acct_xyz")
	})

	t.Run("missing_account_propagates_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
				return "", errors.New("no account")
			},
		}
		svc := newTestPaymentService(repo, nil)
		_, err := svc.GetStripeOnboardingLink(context.Background(), "user-1", "", "")
		require.Error(t, err)
	})
}

func TestPaymentService_GetStripeAccountStatus(t *testing.T) {
	t.Parallel()

	t.Run("returns_default_status_when_no_account", func(t *testing.T) {
		t.Parallel()
		// When no Stripe account exists for the user, service swallows the
		// repo error and returns a sensible "not started" default.
		repo := &mockPaymentRepo{
			getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
				return "", errors.New("no account")
			},
		}
		svc := newTestPaymentService(repo, nil)
		status, err := svc.GetStripeAccountStatus(context.Background(), "user-1")
		require.NoError(t, err)
		assert.False(t, status.ChargesEnabled)
		assert.False(t, status.PayoutsEnabled)
		assert.False(t, status.DetailsSubmitted)
	})

	t.Run("happy_path_via_dev_stripe", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
				return "acct_xyz", nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		status, err := svc.GetStripeAccountStatus(context.Background(), "user-1")
		require.NoError(t, err)
		assert.Equal(t, "acct_xyz", status.AccountID)
		// Dev-mode Stripe stub returns charges/payouts/details all enabled.
		assert.True(t, status.ChargesEnabled)
	})
}

func TestPaymentService_GetStripeDashboardLink(t *testing.T) {
	t.Parallel()

	t.Run("happy_path", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
				return "acct_xyz", nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		url, err := svc.GetStripeDashboardLink(context.Background(), "user-1")
		require.NoError(t, err)
		assert.Contains(t, url, "acct_xyz")
	})

	t.Run("missing_account_propagates_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getStripeAccountIDFn: func(_ context.Context, _ string) (string, error) {
				return "", errors.New("no account")
			},
		}
		svc := newTestPaymentService(repo, nil)
		_, err := svc.GetStripeDashboardLink(context.Background(), "user-1")
		require.Error(t, err)
	})
}

// --- Payment methods (DevStore-backed in dev mode) ---

func TestPaymentService_CreateSetupIntent(t *testing.T) {
	t.Parallel()

	t.Run("uses_stripe_customer_id_when_available", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getStripeCustomerIDFn: func(_ context.Context, _ string) (string, error) {
				return "cus_xyz", nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		secret, err := svc.CreateSetupIntent(context.Background(), "user-1")
		require.NoError(t, err)
		// Dev-mode setup intents are sentinel-prefixed.
		assert.True(t, strings.HasPrefix(secret, "dev_seti_"))
	})

	t.Run("falls_back_to_user_id_when_no_stripe_customer", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			getStripeCustomerIDFn: func(_ context.Context, _ string) (string, error) {
				return "", errors.New("not configured")
			},
		}
		svc := newTestPaymentService(repo, nil)
		secret, err := svc.CreateSetupIntent(context.Background(), "user-1")
		require.NoError(t, err)
		assert.NotEmpty(t, secret)
	})
}

func TestPaymentService_PaymentMethodLifecycle_DevMode(t *testing.T) {
	t.Parallel()

	repo := &mockPaymentRepo{}
	svc := newTestPaymentService(repo, nil)

	// AddDevPaymentMethod (dev-only)
	pm, err := svc.AddDevPaymentMethod(context.Background(), "user-1", "visa", "4242", 12, 2030)
	require.NoError(t, err)
	require.NotNil(t, pm)
	assert.Equal(t, "visa", pm.Brand)
	assert.Equal(t, "4242", pm.LastFour)
	assert.True(t, strings.HasPrefix(pm.ID, "pm_dev_"))

	// ListPaymentMethods returns it
	methods, err := svc.ListPaymentMethods(context.Background(), "user-1")
	require.NoError(t, err)
	require.Len(t, methods, 1)
	assert.Equal(t, "4242", methods[0].LastFour)

	// DeletePaymentMethod removes it
	err = svc.DeletePaymentMethod(context.Background(), pm.ID)
	require.NoError(t, err)

	methods, err = svc.ListPaymentMethods(context.Background(), "user-1")
	require.NoError(t, err)
	assert.Empty(t, methods)
}

func TestPaymentService_AddDevPaymentMethod_RejectsProduction(t *testing.T) {
	t.Parallel()
	// Manually construct a non-dev-mode StripeService.
	prodStripe := &StripeService{devMode: false}
	repo := &mockPaymentRepo{}
	svc := NewPaymentService(repo, prodStripe)

	_, err := svc.AddDevPaymentMethod(context.Background(), "user-1", "visa", "4242", 12, 2030)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not in dev mode")
}

// --- Admin operations ---

func TestPaymentService_AdminListPayments(t *testing.T) {
	t.Parallel()
	expected := []*domain.Payment{{ID: "p1"}}
	start := time.Now().AddDate(0, -1, 0)
	end := time.Now()
	repo := &mockPaymentRepo{
		adminListPaymentsFn: func(_ context.Context, userID, status string, s, e *time.Time, page, pageSize int) ([]*domain.Payment, int, int64, int64, error) {
			assert.Equal(t, "user-1", userID)
			assert.Equal(t, "released", status)
			require.NotNil(t, s)
			require.NotNil(t, e)
			return expected, 100, 50000, 2500, nil
		},
	}
	svc := newTestPaymentService(repo, nil)
	got, total, gross, fees, err := svc.AdminListPayments(context.Background(), "user-1", "released", &start, &end, 1, 20)
	require.NoError(t, err)
	assert.Equal(t, expected, got)
	assert.Equal(t, 100, total)
	assert.Equal(t, int64(50000), gross)
	assert.Equal(t, int64(2500), fees)
}

func TestPaymentService_AdminUpdateFeeConfig(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name                string
		feePct, guaranteePct float64
		minFee              int64
		maxFee              *int64
		wantErr             bool
		errContains         string
	}{
		{name: "happy_path", feePct: 0.05, guaranteePct: 0.02, minFee: 100},
		{name: "fee_pct_negative", feePct: -0.01, wantErr: true, errContains: "fee_percentage"},
		{name: "fee_pct_over_one", feePct: 1.5, wantErr: true, errContains: "fee_percentage"},
		{name: "guarantee_pct_negative", feePct: 0.05, guaranteePct: -0.01, wantErr: true, errContains: "guarantee_percentage"},
		{name: "guarantee_pct_over_one", feePct: 0.05, guaranteePct: 1.5, wantErr: true, errContains: "guarantee_percentage"},
		{name: "min_fee_negative", feePct: 0.05, minFee: -1, wantErr: true, errContains: "min_fee_cents"},
		{
			name: "max_fee_below_min",
			feePct: 0.05, minFee: 200,
			maxFee:      func() *int64 { v := int64(100); return &v }(),
			wantErr:     true,
			errContains: "max_fee_cents",
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			repo := &mockPaymentRepo{}
			svc := newTestPaymentService(repo, nil)
			_, err := svc.AdminUpdateFeeConfig(context.Background(), nil, tt.feePct, tt.guaranteePct, tt.minFee, tt.maxFee)
			if tt.wantErr {
				require.Error(t, err)
				assert.True(t, strings.Contains(err.Error(), tt.errContains),
					"expected %q in %v", tt.errContains, err)
				return
			}
			require.NoError(t, err)
		})
	}
}

// --- AdminGetPaymentDetails + GetRevenueReport ---

func TestPaymentService_AdminGetPaymentDetails(t *testing.T) {
	t.Parallel()

	t.Run("happy_path", func(t *testing.T) {
		t.Parallel()
		expected := &domain.Payment{ID: "pmt-1", Status: "released"}
		repo := &mockPaymentRepo{
			adminGetPaymentDetailsFn: func(_ context.Context, paymentID string) (*domain.Payment, error) {
				assert.Equal(t, "pmt-1", paymentID)
				return expected, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		got, err := svc.AdminGetPaymentDetails(context.Background(), "pmt-1")
		require.NoError(t, err)
		assert.Equal(t, expected, got)
	})

	t.Run("propagates_not_found", func(t *testing.T) {
		t.Parallel()
		repo := &mockPaymentRepo{
			adminGetPaymentDetailsFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return nil, domain.ErrPaymentNotFound
			},
		}
		svc := newTestPaymentService(repo, nil)
		_, err := svc.AdminGetPaymentDetails(context.Background(), "pmt-x")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrPaymentNotFound)
	})
}

func TestPaymentService_GetRevenueReport(t *testing.T) {
	t.Parallel()
	expected := &domain.RevenueReport{
		TotalGMVCents:     20000000,
		TotalRevenueCents: 1000000,
	}
	start := time.Now().AddDate(0, -1, 0)
	end := time.Now()
	repo := &mockPaymentRepo{
		getRevenueReportFn: func(_ context.Context, s, e *time.Time, groupBy string) (*domain.RevenueReport, error) {
			require.NotNil(t, s)
			require.NotNil(t, e)
			assert.Equal(t, "month", groupBy)
			return expected, nil
		},
	}
	svc := newTestPaymentService(repo, nil)
	got, err := svc.GetRevenueReport(context.Background(), &start, &end, "month")
	require.NoError(t, err)
	assert.Equal(t, expected, got)
}

// --- Insurance: GetPolicy / ListPolicies / GetClaim / AdminListClaims (delegations) ---

func TestInsuranceService_GetPolicyAndList(t *testing.T) {
	t.Parallel()

	t.Run("get_policy_delegates", func(t *testing.T) {
		t.Parallel()
		expected := &domain.InsurancePolicy{ID: "pol-1"}
		repo := &mockInsuranceRepo{
			getInsurancePolicyFn: func(_ context.Context, id string) (*domain.InsurancePolicy, error) {
				assert.Equal(t, "pol-1", id)
				return expected, nil
			},
		}
		svc := newTestInsuranceService(repo)
		got, err := svc.GetPolicy(context.Background(), "pol-1")
		require.NoError(t, err)
		assert.Equal(t, expected, got)
	})

	t.Run("list_policies_delegates", func(t *testing.T) {
		t.Parallel()
		expected := []*domain.InsurancePolicy{{ID: "p1"}, {ID: "p2"}}
		repo := &mockInsuranceRepo{
			listInsurancePoliciesFn: func(_ context.Context, userID string, page, pageSize int) ([]*domain.InsurancePolicy, int, error) {
				assert.Equal(t, "user-1", userID)
				return expected, 50, nil
			},
		}
		svc := newTestInsuranceService(repo)
		got, total, err := svc.ListPolicies(context.Background(), "user-1", 1, 25)
		require.NoError(t, err)
		assert.Equal(t, expected, got)
		assert.Equal(t, 50, total)
	})

	t.Run("get_claim_delegates", func(t *testing.T) {
		t.Parallel()
		expected := &domain.InsuranceClaim{ID: "clm-1"}
		repo := &mockInsuranceRepo{
			getInsuranceClaimFn: func(_ context.Context, id string) (*domain.InsuranceClaim, error) {
				assert.Equal(t, "clm-1", id)
				return expected, nil
			},
		}
		svc := newTestInsuranceService(repo)
		got, err := svc.GetClaim(context.Background(), "clm-1")
		require.NoError(t, err)
		assert.Equal(t, expected, got)
	})

	t.Run("admin_list_claims_delegates", func(t *testing.T) {
		t.Parallel()
		expected := []*domain.InsuranceClaim{{ID: "c1"}, {ID: "c2"}}
		repo := &mockInsuranceRepo{
			adminListInsuranceClaimsFn: func(_ context.Context, status string, page, pageSize int) ([]*domain.InsuranceClaim, int, error) {
				assert.Equal(t, "filed", status)
				return expected, 10, nil
			},
		}
		svc := newTestInsuranceService(repo)
		got, total, err := svc.AdminListClaims(context.Background(), "filed", 1, 50)
		require.NoError(t, err)
		assert.Equal(t, expected, got)
		assert.Equal(t, 10, total)
	})
}
