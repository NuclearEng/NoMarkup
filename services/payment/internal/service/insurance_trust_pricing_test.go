package service

import (
	"context"
	"errors"
	"testing"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- trustDiscountBps (pure tier → discount table) ---

func TestTrustDiscountBps(t *testing.T) {
	t.Parallel()

	cases := []struct {
		tier string
		want int64
	}{
		{"top_rated", 1500},
		{"trusted", 1000},
		{"rising", 500},
		{"new", 0},
		{"under_review", 0},
		{"", 0},
		{"bogus_tier", 0},
		{"TOP_RATED", 0}, // case-sensitive: the trust engine emits lowercase
	}
	for _, tt := range cases {
		t.Run(tt.tier, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, trustDiscountBps(tt.tier))
		})
	}
}

// --- applyTrustDiscountToPremium (pure money math) ---

func TestApplyTrustDiscountToPremium(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name            string
		premiumCents    int64
		minPremiumCents int64
		tier            string
		want            int64
	}{
		{"top_rated_15pct", 10000, 0, "top_rated", 8500},
		{"trusted_10pct", 10000, 0, "trusted", 9000},
		{"rising_5pct", 10000, 0, "rising", 9500},
		{"new_no_discount", 10000, 0, "new", 10000},
		{"under_review_no_discount", 10000, 0, "under_review", 10000},
		{"unknown_tier_no_discount", 10000, 0, "", 10000},
		// Floor: a discount can never drop below the product minimum premium.
		{"floored_at_min", 1000, 950, "top_rated", 950},
		// Integer truncation: rising = 5% of 999 = 49.95 → discount 49 → 950.
		{"integer_truncation", 999, 0, "rising", 950},
		// Zero / negative premium is a no-op.
		{"zero_premium", 0, 0, "top_rated", 0},
		// Discount never raises the premium even with a high floor.
		{"degenerate_high_floor", 100, 9999, "top_rated", 100},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := applyTrustDiscountToPremium(tt.premiumCents, tt.minPremiumCents, tt.tier)
			assert.Equal(t, tt.want, got)
		})
	}
}

// applyTrustDiscountToPremium must be a strict reduction: result is always in
// [0, premium] for any tier and any non-negative premium.
func TestApplyTrustDiscountToPremium_NeverIncreases(t *testing.T) {
	t.Parallel()
	tiers := []string{"top_rated", "trusted", "rising", "new", "under_review", "", "weird"}
	premiums := []int64{0, 1, 99, 100, 12345, 1_000_000_00}
	for _, tier := range tiers {
		for _, p := range premiums {
			got := applyTrustDiscountToPremium(p, 0, tier)
			assert.LessOrEqual(t, got, p, "tier=%s premium=%d", tier, p)
			assert.GreaterOrEqual(t, got, int64(0), "tier=%s premium=%d", tier, p)
		}
	}
}

// --- end-to-end through GetQuoteForContract (flag + fail-closed wiring) ---

func quoteTestProduct() *domain.InsuranceProduct {
	return &domain.InsuranceProduct{
		ID:                   "p1",
		Name:                 "Workmanship Warranty",
		CoverageType:         "workmanship_warranty",
		BaseRateBPS:          150, // 1.5%
		MinPremiumCents:      1000,
		CoverageDurationDays: 365,
		DeductibleCents:      5000,
		Active:               true,
	}
}

// repo whose contract carries a known provider id, and whose product yields a
// $150 base premium on a $10,000 contract (no category multiplier).
func quoteTestRepo(providerID string) *mockInsuranceRepo {
	return &mockInsuranceRepo{
		getInsuranceProductFn: func(_ context.Context, _ string) (*domain.InsuranceProduct, error) {
			return quoteTestProduct(), nil
		},
		getContractForInsuranceFn: func(_ context.Context, _ string) (*domain.ContractForInsurance, error) {
			return &domain.ContractForInsurance{
				ID:           "c1",
				CustomerID:   "cust1",
				ProviderID:   providerID,
				AmountCents:  1_000_000, // $10,000 → base premium $150 = 15000c
				CategorySlug: "",
			}, nil
		},
	}
}

func trustSourceReturning(tier string, err error) *mockTrustSource {
	return &mockTrustSource{
		fn: func(_ context.Context, _ string) (float64, float64, float64, string, error) {
			return 0, 0, 0, tier, err
		},
	}
}

func TestGetQuoteForContract_TrustPricing(t *testing.T) {
	t.Parallel()

	const basePremium = int64(15000) // $10,000 × 1.5%

	t.Run("flag_off_no_discount_even_with_top_rated", func(t *testing.T) {
		t.Parallel()
		svc := newTestInsuranceService(quoteTestRepo("prov1"))
		svc.SetTrustSource(trustSourceReturning("top_rated", nil))
		// SetTrustPricingEnabled NOT called → defaults false → fail closed.
		q, err := svc.GetQuoteForContract(context.Background(), "p1", "c1")
		require.NoError(t, err)
		assert.Equal(t, basePremium, q.PremiumCents)
	})

	t.Run("flag_on_top_rated_15pct_discount", func(t *testing.T) {
		t.Parallel()
		svc := newTestInsuranceService(quoteTestRepo("prov1"))
		svc.SetTrustSource(trustSourceReturning("top_rated", nil))
		svc.SetTrustPricingEnabled(true)
		q, err := svc.GetQuoteForContract(context.Background(), "p1", "c1")
		require.NoError(t, err)
		assert.Equal(t, int64(12750), q.PremiumCents) // 15000 − 15%
	})

	t.Run("flag_on_trusted_10pct_discount", func(t *testing.T) {
		t.Parallel()
		svc := newTestInsuranceService(quoteTestRepo("prov1"))
		svc.SetTrustSource(trustSourceReturning("trusted", nil))
		svc.SetTrustPricingEnabled(true)
		q, err := svc.GetQuoteForContract(context.Background(), "p1", "c1")
		require.NoError(t, err)
		assert.Equal(t, int64(13500), q.PremiumCents) // 15000 − 10%
	})

	t.Run("flag_on_new_tier_no_discount", func(t *testing.T) {
		t.Parallel()
		svc := newTestInsuranceService(quoteTestRepo("prov1"))
		svc.SetTrustSource(trustSourceReturning("new", nil))
		svc.SetTrustPricingEnabled(true)
		q, err := svc.GetQuoteForContract(context.Background(), "p1", "c1")
		require.NoError(t, err)
		assert.Equal(t, basePremium, q.PremiumCents)
	})

	t.Run("flag_on_trust_lookup_error_fails_closed", func(t *testing.T) {
		t.Parallel()
		svc := newTestInsuranceService(quoteTestRepo("prov1"))
		svc.SetTrustSource(trustSourceReturning("top_rated", errors.New("trust engine down")))
		svc.SetTrustPricingEnabled(true)
		q, err := svc.GetQuoteForContract(context.Background(), "p1", "c1")
		require.NoError(t, err) // never surfaces an error
		assert.Equal(t, basePremium, q.PremiumCents)
	})

	t.Run("flag_on_no_trust_source_fails_closed", func(t *testing.T) {
		t.Parallel()
		svc := newTestInsuranceService(quoteTestRepo("prov1"))
		// No trust source wired at all.
		svc.SetTrustPricingEnabled(true)
		q, err := svc.GetQuoteForContract(context.Background(), "p1", "c1")
		require.NoError(t, err)
		assert.Equal(t, basePremium, q.PremiumCents)
	})

	t.Run("flag_on_empty_provider_id_fails_closed", func(t *testing.T) {
		t.Parallel()
		svc := newTestInsuranceService(quoteTestRepo("")) // contract has no provider
		svc.SetTrustSource(trustSourceReturning("top_rated", nil))
		svc.SetTrustPricingEnabled(true)
		q, err := svc.GetQuoteForContract(context.Background(), "p1", "c1")
		require.NoError(t, err)
		assert.Equal(t, basePremium, q.PremiumCents)
	})
}
