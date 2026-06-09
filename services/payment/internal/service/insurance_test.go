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

// --- mockInsuranceRepo ---

type mockInsuranceRepo struct {
	listInsuranceProductsFn         func(ctx context.Context, activeOnly bool) ([]*domain.InsuranceProduct, error)
	getInsuranceProductFn           func(ctx context.Context, id string) (*domain.InsuranceProduct, error)
	getInsuranceProductBySlugFn     func(ctx context.Context, slug string) (*domain.InsuranceProduct, error)
	createInsurancePolicyFn         func(ctx context.Context, p *domain.InsurancePolicy) error
	getInsurancePolicyFn            func(ctx context.Context, id string) (*domain.InsurancePolicy, error)
	listInsurancePoliciesFn         func(ctx context.Context, userID string, page, pageSize int) ([]*domain.InsurancePolicy, int, error)
	updateInsurancePolicyStatusFn   func(ctx context.Context, id string, status string) error
	updateInsurancePolicyPaidFn     func(ctx context.Context, id string, stripePIID string) error
	findPolicyByStripePIFn          func(ctx context.Context, piID string) (*domain.InsurancePolicy, error)
	createInsuranceClaimFn          func(ctx context.Context, claim *domain.InsuranceClaim) error
	getInsuranceClaimFn             func(ctx context.Context, id string) (*domain.InsuranceClaim, error)
	adminListInsuranceClaimsFn      func(ctx context.Context, statusFilter string, page, pageSize int) ([]*domain.InsuranceClaim, int, error)
	updateInsuranceClaimReviewFn    func(ctx context.Context, id string, status string, approved *int64, notes, denial, reviewer string) error
	updateInsuranceClaimPayoutFn    func(ctx context.Context, id string, payoutCents int64, transferID string) error
	getContractForInsuranceFn       func(ctx context.Context, contractID string) (*domain.ContractForInsurance, error)
	nextPolicyNumberFn              func(ctx context.Context) (string, error)
	nextClaimNumberFn               func(ctx context.Context) (string, error)
}

func (m *mockInsuranceRepo) ListInsuranceProducts(ctx context.Context, activeOnly bool) ([]*domain.InsuranceProduct, error) {
	if m.listInsuranceProductsFn != nil {
		return m.listInsuranceProductsFn(ctx, activeOnly)
	}
	return nil, nil
}
func (m *mockInsuranceRepo) GetInsuranceProduct(ctx context.Context, id string) (*domain.InsuranceProduct, error) {
	if m.getInsuranceProductFn != nil {
		return m.getInsuranceProductFn(ctx, id)
	}
	return nil, domain.ErrInsuranceProductNotFound
}
func (m *mockInsuranceRepo) GetInsuranceProductBySlug(ctx context.Context, slug string) (*domain.InsuranceProduct, error) {
	if m.getInsuranceProductBySlugFn != nil {
		return m.getInsuranceProductBySlugFn(ctx, slug)
	}
	return nil, domain.ErrInsuranceProductNotFound
}
func (m *mockInsuranceRepo) CreateInsurancePolicy(ctx context.Context, p *domain.InsurancePolicy) error {
	if m.createInsurancePolicyFn != nil {
		return m.createInsurancePolicyFn(ctx, p)
	}
	return nil
}
func (m *mockInsuranceRepo) GetInsurancePolicy(ctx context.Context, id string) (*domain.InsurancePolicy, error) {
	if m.getInsurancePolicyFn != nil {
		return m.getInsurancePolicyFn(ctx, id)
	}
	return nil, domain.ErrInsurancePolicyNotFound
}
func (m *mockInsuranceRepo) ListInsurancePolicies(ctx context.Context, userID string, page, pageSize int) ([]*domain.InsurancePolicy, int, error) {
	if m.listInsurancePoliciesFn != nil {
		return m.listInsurancePoliciesFn(ctx, userID, page, pageSize)
	}
	return nil, 0, nil
}
func (m *mockInsuranceRepo) UpdateInsurancePolicyStatus(ctx context.Context, id, status string) error {
	if m.updateInsurancePolicyStatusFn != nil {
		return m.updateInsurancePolicyStatusFn(ctx, id, status)
	}
	return nil
}
func (m *mockInsuranceRepo) UpdateInsurancePolicyPaid(ctx context.Context, id, piID string) error {
	if m.updateInsurancePolicyPaidFn != nil {
		return m.updateInsurancePolicyPaidFn(ctx, id, piID)
	}
	return nil
}
func (m *mockInsuranceRepo) FindPolicyByStripePaymentIntentID(ctx context.Context, piID string) (*domain.InsurancePolicy, error) {
	if m.findPolicyByStripePIFn != nil {
		return m.findPolicyByStripePIFn(ctx, piID)
	}
	return nil, domain.ErrInsurancePolicyNotFound
}
func (m *mockInsuranceRepo) CreateInsuranceClaim(ctx context.Context, c *domain.InsuranceClaim) error {
	if m.createInsuranceClaimFn != nil {
		return m.createInsuranceClaimFn(ctx, c)
	}
	return nil
}
func (m *mockInsuranceRepo) GetInsuranceClaim(ctx context.Context, id string) (*domain.InsuranceClaim, error) {
	if m.getInsuranceClaimFn != nil {
		return m.getInsuranceClaimFn(ctx, id)
	}
	return nil, domain.ErrInsuranceClaimNotFound
}
func (m *mockInsuranceRepo) AdminListInsuranceClaims(ctx context.Context, statusFilter string, page, pageSize int) ([]*domain.InsuranceClaim, int, error) {
	if m.adminListInsuranceClaimsFn != nil {
		return m.adminListInsuranceClaimsFn(ctx, statusFilter, page, pageSize)
	}
	return nil, 0, nil
}
func (m *mockInsuranceRepo) UpdateInsuranceClaimReview(ctx context.Context, id, status string, approved *int64, notes, denial, reviewer string) error {
	if m.updateInsuranceClaimReviewFn != nil {
		return m.updateInsuranceClaimReviewFn(ctx, id, status, approved, notes, denial, reviewer)
	}
	return nil
}
func (m *mockInsuranceRepo) UpdateInsuranceClaimPayout(ctx context.Context, id string, payoutCents int64, transferID string) error {
	if m.updateInsuranceClaimPayoutFn != nil {
		return m.updateInsuranceClaimPayoutFn(ctx, id, payoutCents, transferID)
	}
	return nil
}
func (m *mockInsuranceRepo) GetContractForInsurance(ctx context.Context, contractID string) (*domain.ContractForInsurance, error) {
	if m.getContractForInsuranceFn != nil {
		return m.getContractForInsuranceFn(ctx, contractID)
	}
	return nil, domain.ErrInsuranceContractNotFound
}
func (m *mockInsuranceRepo) NextPolicyNumber(ctx context.Context) (string, error) {
	if m.nextPolicyNumberFn != nil {
		return m.nextPolicyNumberFn(ctx)
	}
	return "POL-2026-00001", nil
}
func (m *mockInsuranceRepo) NextClaimNumber(ctx context.Context) (string, error) {
	if m.nextClaimNumberFn != nil {
		return m.nextClaimNumberFn(ctx)
	}
	return "CLM-2026-00001", nil
}

func newTestInsuranceService(repo *mockInsuranceRepo) *InsuranceService {
	ss := &StripeService{devMode: true}
	return NewInsuranceService(repo, ss)
}

// --- categoryRiskMultiplier ---

func TestCategoryRiskMultiplier(t *testing.T) {
	t.Parallel()

	cases := []struct {
		slug string
		want float64
	}{
		{"roofing", 1.5},
		{"electrical", 1.5},
		{"plumbing", 1.5},
		{"ROOFING", 1.5}, // case-insensitive
		{"Plumbing", 1.5},
		{"cleaning", 0.8},
		{"landscaping", 0.8},
		{"painting", 1.0}, // not in either list
		{"", 1.0},
		{"unknown_xyz", 1.0},
	}

	for _, tt := range cases {
		t.Run(tt.slug, func(t *testing.T) {
			t.Parallel()
			got := categoryRiskMultiplier(tt.slug)
			assert.InDelta(t, tt.want, got, 0.0001)
		})
	}
}

// --- ListProducts ---

func TestInsuranceService_ListProducts(t *testing.T) {
	t.Parallel()

	t.Run("delegates_with_active_only", func(t *testing.T) {
		t.Parallel()
		expected := []*domain.InsuranceProduct{{ID: "p1", Name: "Workmanship", Active: true}}
		repo := &mockInsuranceRepo{
			listInsuranceProductsFn: func(_ context.Context, activeOnly bool) ([]*domain.InsuranceProduct, error) {
				assert.True(t, activeOnly, "service must request active-only products")
				return expected, nil
			},
		}
		svc := newTestInsuranceService(repo)
		got, err := svc.ListProducts(context.Background())
		require.NoError(t, err)
		assert.Equal(t, expected, got)
	})

	t.Run("propagates_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockInsuranceRepo{
			listInsuranceProductsFn: func(_ context.Context, _ bool) ([]*domain.InsuranceProduct, error) {
				return nil, errors.New("db down")
			},
		}
		svc := newTestInsuranceService(repo)
		_, err := svc.ListProducts(context.Background())
		require.Error(t, err)
		assert.Contains(t, err.Error(), "db down")
	})
}

// --- GetInsuranceQuote ---

func TestInsuranceService_GetInsuranceQuote(t *testing.T) {
	t.Parallel()

	productActive := &domain.InsuranceProduct{
		ID:                   "p1",
		Name:                 "Workmanship Warranty",
		CoverageType:         "workmanship_warranty",
		BaseRateBPS:          150, // 1.5%
		MinPremiumCents:      1000,
		CoverageDurationDays: 365,
		DeductibleCents:      5000,
		Active:               true,
	}

	t.Run("base_premium_calculation_no_category", func(t *testing.T) {
		t.Parallel()
		// $10,000 contract × 1.5% = $150 premium
		repo := &mockInsuranceRepo{
			getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
				p := *productActive
				return &p, nil
			},
		}
		svc := newTestInsuranceService(repo)
		q, err := svc.GetInsuranceQuote(context.Background(), "p1", 1000000, "")
		require.NoError(t, err)
		assert.Equal(t, int64(15000), q.PremiumCents)
		assert.Equal(t, int64(1000000), q.CoverageAmountCents)
		assert.Equal(t, "workmanship_warranty", q.CoverageType)
	})

	t.Run("high_risk_category_multiplier_applied", func(t *testing.T) {
		t.Parallel()
		// Base = $150 × 1.5 (roofing) = $225
		repo := &mockInsuranceRepo{
			getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
				p := *productActive
				return &p, nil
			},
		}
		svc := newTestInsuranceService(repo)
		q, err := svc.GetInsuranceQuote(context.Background(), "p1", 1000000, "roofing")
		require.NoError(t, err)
		assert.Equal(t, int64(22500), q.PremiumCents)
	})

	t.Run("low_risk_category_multiplier_applied", func(t *testing.T) {
		t.Parallel()
		// Base = $150 × 0.8 (cleaning) = $120
		repo := &mockInsuranceRepo{
			getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
				p := *productActive
				return &p, nil
			},
		}
		svc := newTestInsuranceService(repo)
		q, err := svc.GetInsuranceQuote(context.Background(), "p1", 1000000, "cleaning")
		require.NoError(t, err)
		assert.Equal(t, int64(12000), q.PremiumCents)
	})

	t.Run("min_premium_floor_enforced", func(t *testing.T) {
		t.Parallel()
		// Tiny contract: $50 × 1.5% = $0.75 → clamped up to MinPremiumCents = $10.
		repo := &mockInsuranceRepo{
			getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
				p := *productActive
				return &p, nil
			},
		}
		svc := newTestInsuranceService(repo)
		q, err := svc.GetInsuranceQuote(context.Background(), "p1", 5000, "")
		require.NoError(t, err)
		assert.Equal(t, int64(1000), q.PremiumCents,
			"premium must be floored at MinPremiumCents")
	})

	t.Run("max_coverage_cap_applied", func(t *testing.T) {
		t.Parallel()
		// Contract is $50k but max coverage is $20k.
		max := int64(2000000)
		p := *productActive
		p.MaxCoverageCents = &max
		repo := &mockInsuranceRepo{
			getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
				return &p, nil
			},
		}
		svc := newTestInsuranceService(repo)
		q, err := svc.GetInsuranceQuote(context.Background(), "p1", 5000000, "")
		require.NoError(t, err)
		assert.Equal(t, int64(2000000), q.CoverageAmountCents,
			"coverage amount must be capped at MaxCoverageCents")
	})

	t.Run("inactive_product_rejected", func(t *testing.T) {
		t.Parallel()
		inactive := *productActive
		inactive.Active = false
		repo := &mockInsuranceRepo{
			getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
				return &inactive, nil
			},
		}
		svc := newTestInsuranceService(repo)
		_, err := svc.GetInsuranceQuote(context.Background(), "p1", 1000000, "")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInsuranceProductNotFound)
	})

	t.Run("propagates_get_product_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockInsuranceRepo{
			getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
				return nil, errors.New("not found")
			},
		}
		svc := newTestInsuranceService(repo)
		_, err := svc.GetInsuranceQuote(context.Background(), "p1", 1000000, "")
		require.Error(t, err)
		assert.True(t, strings.Contains(err.Error(), "not found"))
	})

	t.Run("expiration_date_uses_coverage_duration", func(t *testing.T) {
		t.Parallel()
		repo := &mockInsuranceRepo{
			getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
				p := *productActive
				p.CoverageDurationDays = 90
				return &p, nil
			},
		}
		svc := newTestInsuranceService(repo)
		q, err := svc.GetInsuranceQuote(context.Background(), "p1", 1000000, "")
		require.NoError(t, err)
		// 90 days between effective and expiration.
		days := int(q.ExpirationDate.Sub(q.EffectiveDate).Hours() / 24)
		assert.Equal(t, 90, days)
	})
}

// --- PurchaseInsurance ---

func TestInsuranceService_PurchaseInsurance(t *testing.T) {
	t.Parallel()

	productActive := &domain.InsuranceProduct{
		ID:                   "p1",
		Name:                 "Workmanship",
		CoverageType:         "workmanship_warranty",
		BaseRateBPS:          150,
		MinPremiumCents:      1000,
		CoverageDurationDays: 365,
		DeductibleCents:      5000,
		Active:               true,
	}

	// ownedContract returns a contract owned by cust-1, with provider prov-1 and a
	// $10,000 amount, so the derived premium ($150 base) is deterministic.
	ownedContract := &domain.ContractForInsurance{
		ID:          "c1",
		CustomerID:  "cust-1",
		ProviderID:  "prov-1",
		AmountCents: 1000000,
		Status:      "active",
	}

	t.Run("happy_path_creates_policy_pending_payment", func(t *testing.T) {
		t.Parallel()
		var captured *domain.InsurancePolicy
		repo := &mockInsuranceRepo{
			getContractForInsuranceFn: func(_ context.Context, _ string) (*domain.ContractForInsurance, error) {
				c := *ownedContract
				return &c, nil
			},
			getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
				p := *productActive
				return &p, nil
			},
			nextPolicyNumberFn: func(_ context.Context) (string, error) {
				return "POL-2026-00042", nil
			},
			createInsurancePolicyFn: func(_ context.Context, p *domain.InsurancePolicy) error {
				captured = p
				return nil
			},
		}
		svc := newTestInsuranceService(repo)
		policy, clientSecret, err := svc.PurchaseInsurance(context.Background(), domain.PurchaseInsuranceInput{
			ContractID: "c1",
			ProductID:  "p1",
			CustomerID: "cust-1",
		})
		require.NoError(t, err)
		require.NotNil(t, policy)
		assert.Equal(t, "POL-2026-00042", policy.PolicyNumber)
		assert.Equal(t, "pending_payment", policy.Status)
		assert.NotEmpty(t, clientSecret)
		require.NotNil(t, captured)
		assert.Equal(t, policy.ID, captured.ID)
		// Provider + premium are derived from the contract, not from client input.
		assert.Equal(t, "prov-1", captured.ProviderID, "provider must be derived from the contract")
		assert.Equal(t, int64(15000), captured.PremiumCents, "$10k × 1.5% premium derived from contract amount")
		assert.Equal(t, int64(1000000), captured.CoverageAmountCents)
	})

	t.Run("rejects_non_owned_contract", func(t *testing.T) {
		t.Parallel()
		var createCalled bool
		repo := &mockInsuranceRepo{
			getContractForInsuranceFn: func(_ context.Context, _ string) (*domain.ContractForInsurance, error) {
				// Contract belongs to someone else.
				c := *ownedContract
				c.CustomerID = "other-customer"
				return &c, nil
			},
			createInsurancePolicyFn: func(_ context.Context, _ *domain.InsurancePolicy) error {
				createCalled = true
				return nil
			},
		}
		svc := newTestInsuranceService(repo)
		_, _, err := svc.PurchaseInsurance(context.Background(), domain.PurchaseInsuranceInput{
			ContractID: "c1",
			ProductID:  "p1",
			CustomerID: "cust-1", // not the contract's customer
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrContractNotOwned)
		assert.False(t, createCalled, "must not create a policy for a non-owned contract")
	})

	t.Run("rejects_missing_contract", func(t *testing.T) {
		t.Parallel()
		repo := &mockInsuranceRepo{
			getContractForInsuranceFn: func(_ context.Context, _ string) (*domain.ContractForInsurance, error) {
				return nil, domain.ErrInsuranceContractNotFound
			},
		}
		svc := newTestInsuranceService(repo)
		_, _, err := svc.PurchaseInsurance(context.Background(), domain.PurchaseInsuranceInput{
			ContractID: "missing",
			ProductID:  "p1",
			CustomerID: "cust-1",
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInsuranceContractNotFound)
	})

	t.Run("propagates_quote_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockInsuranceRepo{
			getContractForInsuranceFn: func(_ context.Context, _ string) (*domain.ContractForInsurance, error) {
				c := *ownedContract
				return &c, nil
			},
			getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
				return nil, errors.New("missing")
			},
		}
		svc := newTestInsuranceService(repo)
		_, _, err := svc.PurchaseInsurance(context.Background(), domain.PurchaseInsuranceInput{
			ContractID: "c1",
			ProductID:  "p1",
			CustomerID: "cust-1",
		})
		require.Error(t, err)
	})

	t.Run("propagates_policy_number_error", func(t *testing.T) {
		t.Parallel()
		repo := &mockInsuranceRepo{
			getContractForInsuranceFn: func(_ context.Context, _ string) (*domain.ContractForInsurance, error) {
				c := *ownedContract
				return &c, nil
			},
			getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
				p := *productActive
				return &p, nil
			},
			nextPolicyNumberFn: func(_ context.Context) (string, error) {
				return "", errors.New("seq exhausted")
			},
		}
		svc := newTestInsuranceService(repo)
		_, _, err := svc.PurchaseInsurance(context.Background(), domain.PurchaseInsuranceInput{
			ContractID: "c1",
			ProductID:  "p1",
			CustomerID: "cust-1",
		})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "seq exhausted")
	})
}

// --- GetQuoteForContract ---

func TestInsuranceService_GetQuoteForContract(t *testing.T) {
	t.Parallel()

	productActive := &domain.InsuranceProduct{
		ID:                   "p1",
		Name:                 "Workmanship",
		CoverageType:         "workmanship_warranty",
		BaseRateBPS:          150,
		MinPremiumCents:      1000,
		CoverageDurationDays: 365,
		DeductibleCents:      5000,
		Active:               true,
	}

	t.Run("derives_amount_and_category_from_contract", func(t *testing.T) {
		t.Parallel()
		repo := &mockInsuranceRepo{
			getContractForInsuranceFn: func(_ context.Context, _ string) (*domain.ContractForInsurance, error) {
				return &domain.ContractForInsurance{
					ID: "c1", CustomerID: "cust-1", ProviderID: "prov-1",
					AmountCents: 1000000, CategorySlug: "roofing", Status: "active",
				}, nil
			},
			getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
				p := *productActive
				return &p, nil
			},
		}
		svc := newTestInsuranceService(repo)
		q, err := svc.GetQuoteForContract(context.Background(), "p1", "c1")
		require.NoError(t, err)
		// $10k × 1.5% = $150 base, × 1.5 (roofing) = $225.
		assert.Equal(t, int64(22500), q.PremiumCents,
			"premium must derive from the server-side contract amount and category")
	})

	t.Run("propagates_missing_contract", func(t *testing.T) {
		t.Parallel()
		repo := &mockInsuranceRepo{
			getContractForInsuranceFn: func(_ context.Context, _ string) (*domain.ContractForInsurance, error) {
				return nil, domain.ErrInsuranceContractNotFound
			},
		}
		svc := newTestInsuranceService(repo)
		_, err := svc.GetQuoteForContract(context.Background(), "p1", "missing")
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrInsuranceContractNotFound)
	})
}

// --- ActivatePolicy ---

func TestInsuranceService_ActivatePolicy(t *testing.T) {
	t.Parallel()

	t.Run("activates_pending_policy_via_paid_update", func(t *testing.T) {
		t.Parallel()
		var paidUpdate string
		repo := &mockInsuranceRepo{
			findPolicyByStripePIFn: func(_ context.Context, _ string) (*domain.InsurancePolicy, error) {
				return &domain.InsurancePolicy{ID: "pol-1", Status: "pending_payment"}, nil
			},
			updateInsurancePolicyPaidFn: func(_ context.Context, _, piID string) error {
				paidUpdate = piID
				return nil
			},
		}
		svc := newTestInsuranceService(repo)
		err := svc.ActivatePolicy(context.Background(), "pi_xyz")
		require.NoError(t, err)
		assert.Equal(t, "pi_xyz", paidUpdate,
			"ActivatePolicy must record the Stripe PaymentIntent ID via UpdateInsurancePolicyPaid; the repo SQL handles the status flip to 'active'")
	})

	t.Run("noop_when_policy_already_active", func(t *testing.T) {
		t.Parallel()
		var paidCalled bool
		repo := &mockInsuranceRepo{
			findPolicyByStripePIFn: func(_ context.Context, _ string) (*domain.InsurancePolicy, error) {
				return &domain.InsurancePolicy{ID: "pol-1", Status: "active"}, nil
			},
			updateInsurancePolicyPaidFn: func(_ context.Context, _, _ string) error {
				paidCalled = true
				return nil
			},
		}
		svc := newTestInsuranceService(repo)
		err := svc.ActivatePolicy(context.Background(), "pi_xyz")
		require.NoError(t, err)
		assert.False(t, paidCalled, "must not double-update an already-active policy")
	})

	t.Run("policy_not_found", func(t *testing.T) {
		t.Parallel()
		repo := &mockInsuranceRepo{
			findPolicyByStripePIFn: func(_ context.Context, _ string) (*domain.InsurancePolicy, error) {
				return nil, domain.ErrInsurancePolicyNotFound
			},
		}
		svc := newTestInsuranceService(repo)
		err := svc.ActivatePolicy(context.Background(), "pi_xyz")
		require.Error(t, err)
	})
}

// --- FileInsuranceClaim ---

func TestInsuranceService_FileInsuranceClaim(t *testing.T) {
	t.Parallel()

	activePolicy := &domain.InsurancePolicy{
		ID:                  "pol-1",
		Status:              "active",
		CustomerID:          "cust-1",
		CoverageAmountCents: 1000000,
		// Future expiration so the time-window check passes.
		ExpirationDate: time.Now().UTC().AddDate(1, 0, 0),
	}

	t.Run("happy_path_creates_filed_claim", func(t *testing.T) {
		t.Parallel()
		var captured *domain.InsuranceClaim
		repo := &mockInsuranceRepo{
			getInsurancePolicyFn: func(_ context.Context, _ string) (*domain.InsurancePolicy, error) {
				p := *activePolicy
				return &p, nil
			},
			nextClaimNumberFn: func(_ context.Context) (string, error) { return "CLM-X", nil },
			createInsuranceClaimFn: func(_ context.Context, c *domain.InsuranceClaim) error {
				captured = c
				return nil
			},
			getInsuranceClaimFn: func(_ context.Context, _ string) (*domain.InsuranceClaim, error) {
				return captured, nil
			},
		}
		svc := newTestInsuranceService(repo)
		claim, err := svc.FileInsuranceClaim(context.Background(), domain.FileInsuranceClaimInput{
			PolicyID:           "pol-1",
			ClaimantID:         "cust-1",
			ClaimType:          "workmanship_defect",
			Description:        "Tile cracked within 30 days",
			ClaimedAmountCents: 50000,
		})
		require.NoError(t, err)
		require.NotNil(t, claim)
		assert.Equal(t, "CLM-X", claim.ClaimNumber)
		assert.Equal(t, "filed", claim.Status)
	})

	t.Run("rejects_when_policy_not_active", func(t *testing.T) {
		t.Parallel()
		repo := &mockInsuranceRepo{
			getInsurancePolicyFn: func(_ context.Context, _ string) (*domain.InsurancePolicy, error) {
				return &domain.InsurancePolicy{ID: "pol-1", Status: "expired", CoverageAmountCents: 100}, nil
			},
		}
		svc := newTestInsuranceService(repo)
		_, err := svc.FileInsuranceClaim(context.Background(), domain.FileInsuranceClaimInput{
			PolicyID: "pol-1", ClaimedAmountCents: 50,
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrPolicyNotActive)
	})

	t.Run("rejects_claim_exceeding_coverage", func(t *testing.T) {
		t.Parallel()
		repo := &mockInsuranceRepo{
			getInsurancePolicyFn: func(_ context.Context, _ string) (*domain.InsurancePolicy, error) {
				p := *activePolicy
				return &p, nil
			},
		}
		svc := newTestInsuranceService(repo)
		_, err := svc.FileInsuranceClaim(context.Background(), domain.FileInsuranceClaimInput{
			PolicyID:           "pol-1",
			ClaimantID:         "cust-1",
			ClaimType:          "workmanship_defect",
			Description:        "x",
			ClaimedAmountCents: 5000000, // exceeds $10k coverage
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrClaimExceedsCoverage)
	})

	t.Run("rejects_claimant_who_is_not_policyholder", func(t *testing.T) {
		t.Parallel()
		var createCalled bool
		repo := &mockInsuranceRepo{
			getInsurancePolicyFn: func(_ context.Context, _ string) (*domain.InsurancePolicy, error) {
				p := *activePolicy
				return &p, nil
			},
			createInsuranceClaimFn: func(_ context.Context, _ *domain.InsuranceClaim) error {
				createCalled = true
				return nil
			},
		}
		svc := newTestInsuranceService(repo)
		_, err := svc.FileInsuranceClaim(context.Background(), domain.FileInsuranceClaimInput{
			PolicyID:           "pol-1",
			ClaimantID:         "attacker-2", // not the policy's customer
			ClaimType:          "workmanship_defect",
			Description:        "trying to drain someone else's policy",
			ClaimedAmountCents: 50000,
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrClaimantNotPolicyholder)
		assert.False(t, createCalled, "must not create a claim for a non-policyholder")
	})
}

// --- ReviewInsuranceClaim ---

func TestInsuranceService_ReviewInsuranceClaim(t *testing.T) {
	t.Parallel()

	t.Run("approves_claim_within_filed_status", func(t *testing.T) {
		t.Parallel()
		var capturedStatus string
		repo := &mockInsuranceRepo{
			getInsuranceClaimFn: func(_ context.Context, _ string) (*domain.InsuranceClaim, error) {
				return &domain.InsuranceClaim{ID: "clm-1", Status: "filed", PolicyID: "pol-1"}, nil
			},
			// Approval path needs to load the parent policy to compute the payout.
			getInsurancePolicyFn: func(_ context.Context, _ string) (*domain.InsurancePolicy, error) {
				return &domain.InsurancePolicy{
					ID: "pol-1", Status: "active",
					CoverageAmountCents: 1000000, DeductibleCents: 5000,
				}, nil
			},
			updateInsuranceClaimReviewFn: func(_ context.Context, _, status string, _ *int64, _, _, _ string) error {
				capturedStatus = status
				return nil
			},
		}
		svc := newTestInsuranceService(repo)
		_, err := svc.ReviewInsuranceClaim(context.Background(), domain.ReviewInsuranceClaimInput{
			ClaimID:             "clm-1",
			ReviewerID:          "admin-1",
			Approved:            true,
			ApprovedAmountCents: 25000,
			AssessorNotes:       "Damage confirmed",
		})
		require.NoError(t, err)
		assert.Equal(t, "approved", capturedStatus)
	})

	t.Run("rejects_approved_amount_exceeding_coverage", func(t *testing.T) {
		t.Parallel()
		var reviewCalled bool
		repo := &mockInsuranceRepo{
			getInsuranceClaimFn: func(_ context.Context, _ string) (*domain.InsuranceClaim, error) {
				return &domain.InsuranceClaim{ID: "clm-1", Status: "filed", PolicyID: "pol-1"}, nil
			},
			getInsurancePolicyFn: func(_ context.Context, _ string) (*domain.InsurancePolicy, error) {
				return &domain.InsurancePolicy{
					ID: "pol-1", Status: "active",
					CoverageAmountCents: 50000, DeductibleCents: 5000,
				}, nil
			},
			updateInsuranceClaimReviewFn: func(_ context.Context, _, _ string, _ *int64, _, _, _ string) error {
				reviewCalled = true
				return nil
			},
		}
		svc := newTestInsuranceService(repo)
		_, err := svc.ReviewInsuranceClaim(context.Background(), domain.ReviewInsuranceClaimInput{
			ClaimID:             "clm-1",
			ReviewerID:          "admin-1",
			Approved:            true,
			ApprovedAmountCents: 99999999, // far above the 50000 coverage limit
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrClaimExceedsCoverage)
		assert.False(t, reviewCalled, "must not approve/pay out an over-coverage amount")
	})

	t.Run("denies_claim", func(t *testing.T) {
		t.Parallel()
		var capturedStatus string
		repo := &mockInsuranceRepo{
			getInsuranceClaimFn: func(_ context.Context, _ string) (*domain.InsuranceClaim, error) {
				return &domain.InsuranceClaim{ID: "clm-1", Status: "filed"}, nil
			},
			updateInsuranceClaimReviewFn: func(_ context.Context, _, status string, _ *int64, _, _, _ string) error {
				capturedStatus = status
				return nil
			},
		}
		svc := newTestInsuranceService(repo)
		_, err := svc.ReviewInsuranceClaim(context.Background(), domain.ReviewInsuranceClaimInput{
			ClaimID:      "clm-1",
			ReviewerID:   "admin-1",
			Approved:     false,
			DenialReason: "Outside coverage scope",
		})
		require.NoError(t, err)
		assert.Equal(t, "denied", capturedStatus)
	})

	t.Run("rejects_review_of_already_reviewed_claim", func(t *testing.T) {
		t.Parallel()
		repo := &mockInsuranceRepo{
			getInsuranceClaimFn: func(_ context.Context, _ string) (*domain.InsuranceClaim, error) {
				return &domain.InsuranceClaim{ID: "clm-1", Status: "approved"}, nil
			},
		}
		svc := newTestInsuranceService(repo)
		_, err := svc.ReviewInsuranceClaim(context.Background(), domain.ReviewInsuranceClaimInput{
			ClaimID:    "clm-1",
			ReviewerID: "admin-1",
			Approved:   false,
		})
		require.Error(t, err)
		assert.ErrorIs(t, err, domain.ErrClaimNotReviewable)
	})
}
