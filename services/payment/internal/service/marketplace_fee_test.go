package service

import (
	"context"
	"testing"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

func TestMarketplaceSellerFeeCents_defaultConfigMatches1000bps(t *testing.T) {
	t.Parallel()
	fc := domain.DefaultFeeConfig() // 0.08 + 0.02
	cases := []struct {
		name   string
		amount int64
		want   int64
	}{
		{"zero", 0, 0},
		{"exact_10pct", 20000, 2000},
		{"rounds_up", 101, 11},
		{"one_cent", 1, 1},
		{"fifty_dollars", 50000, 5000},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := MarketplaceSellerFeeCents(tc.amount, fc)
			if got != tc.want {
				t.Fatalf("MarketplaceSellerFeeCents(%d) = %d, want %d", tc.amount, got, tc.want)
			}
		})
	}
}

func TestMarketplaceSellerFeeCents_adminRateChange(t *testing.T) {
	t.Parallel()
	// 5% platform + 2% guarantee = 700 bps combined
	fc := &domain.FeeConfig{
		FeePercentage:       0.05,
		GuaranteePercentage: 0.02,
		MinFeeCents:         0,
	}
	got := MarketplaceSellerFeeCents(10000, fc)
	if got != 700 {
		t.Fatalf("got %d want 700 for 7%% of 10000", got)
	}
}

func TestMarketplaceSellerFeeCents_minMax(t *testing.T) {
	t.Parallel()
	max := int64(500)
	fc := &domain.FeeConfig{
		FeePercentage:       0.08,
		GuaranteePercentage: 0.02,
		MinFeeCents:         100,
		MaxFeeCents:         &max,
	}
	// 1 cent → 10% ceiling would be 1, but min floor lifts to 100
	if got := MarketplaceSellerFeeCents(1, fc); got != 100 {
		t.Fatalf("min floor: got %d want 100", got)
	}
	// 100000 * 10% = 10000, capped at 500
	if got := MarketplaceSellerFeeCents(100000, fc); got != 500 {
		t.Fatalf("max cap: got %d want 500", got)
	}
}

func TestMarketplaceSellerFeeCents_nilConfigUsesDefault(t *testing.T) {
	t.Parallel()
	got := MarketplaceSellerFeeCents(20000, nil)
	if got != 2000 {
		t.Fatalf("nil config: got %d want 2000", got)
	}
}

type stubCustomFees struct {
	fees []*domain.CustomFee
	err  error
}

func (s stubCustomFees) ListActiveCustomFees(context.Context) ([]*domain.CustomFee, error) {
	return s.fees, s.err
}

type stubFeeConfig struct {
	fc *domain.FeeConfig
}

func (s stubFeeConfig) GetDefaultFeeConfig(context.Context) (*domain.FeeConfig, error) {
	return s.fc, nil
}

func (s stubFeeConfig) GetFeeConfig(context.Context, string) (*domain.FeeConfig, error) {
	return s.fc, nil
}

func TestResolveMarketplaceFeeCents_addsActiveCustomFees(t *testing.T) {
	t.Parallel()
	svc := NewMarketplaceService(nil, nil)
	svc.SetFeeConfigLoader(stubFeeConfig{fc: &domain.FeeConfig{
		FeePercentage:       0.08,
		GuaranteePercentage: 0.02,
	}})
	svc.SetCustomFeeLoader(stubCustomFees{fees: []*domain.CustomFee{
		{RateBPS: 100}, // +1%
	}})
	// 20000 * 10% = 2000, plus 1% custom = 200
	got := svc.resolveMarketplaceFeeCents(context.Background(), 20000)
	if got != 2200 {
		t.Fatalf("got %d want 2200 (10%% + 1%% of 20000)", got)
	}
}

func TestResolveMarketplaceFeeCents_skipsCustomWhenCapExceeded(t *testing.T) {
	t.Parallel()
	svc := NewMarketplaceService(nil, nil)
	svc.SetFeeConfigLoader(stubFeeConfig{fc: &domain.FeeConfig{
		FeePercentage:       0.40,
		GuaranteePercentage: 0.05,
	}})
	svc.SetCustomFeeLoader(stubCustomFees{fees: []*domain.CustomFee{
		{RateBPS: 1000}, // +10% → 55% combined > 50% cap
	}})
	got := svc.resolveMarketplaceFeeCents(context.Background(), 20000)
	// 45% of 20000 = 9000; custom skipped
	if got != 9000 {
		t.Fatalf("got %d want 9000 (custom skipped over cap)", got)
	}
}
