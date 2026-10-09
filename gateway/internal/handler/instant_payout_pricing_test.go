package handler

import "testing"

func TestComputeInstantPayoutFeeCents(t *testing.T) {
	t.Parallel()

	const (
		feeBps15 = 150 // 1.50%
		minFee   = 100 // $1.00 floor
	)

	tests := []struct {
		name         string
		amountCents  int64
		feeBps       int64
		minFeeCents  int64
		wantFeeCents int64
	}{
		// Half-up 1.5% (bps=150): fee = (amount*bps + 5000) / 10000
		{
			name:         "exact_1_5_pct_of_100_dollars",
			amountCents:  10_000,
			feeBps:       feeBps15,
			minFeeCents:  0,
			wantFeeCents: 150, // exactly $1.50
		},
		{
			name:         "exact_1_5_pct_of_200_dollars",
			amountCents:  20_000,
			feeBps:       feeBps15,
			minFeeCents:  0,
			wantFeeCents: 300,
		},
		{
			// 100 * 150 = 15000 → 1.5 cents; +5000 half-up → 2
			name:         "half_up_1_5_cents_rounds_to_2",
			amountCents:  100,
			feeBps:       feeBps15,
			minFeeCents:  0,
			wantFeeCents: 2,
		},
		{
			// 33 * 150 = 4950 → 0.495; +5000 → 0 (below half)
			name:         "half_up_below_half_rounds_down",
			amountCents:  33,
			feeBps:       feeBps15,
			minFeeCents:  0,
			wantFeeCents: 0,
		},
		{
			// 34 * 150 = 5100 → 0.51; +5000 → 1
			name:         "half_up_above_half_rounds_up",
			amountCents:  34,
			feeBps:       feeBps15,
			minFeeCents:  0,
			wantFeeCents: 1,
		},

		// Min $1.00 floor — small amounts must never under-price Stripe's cost
		{
			name:         "min_floor_binds_on_20_dollars",
			amountCents:  2_000, // 1.5% = $0.30 → floor $1.00
			feeBps:       feeBps15,
			minFeeCents:  minFee,
			wantFeeCents: 100,
		},
		{
			name:         "min_floor_binds_on_50_dollars",
			amountCents:  5_000, // 1.5% = $0.75 → floor $1.00
			feeBps:       feeBps15,
			minFeeCents:  minFee,
			wantFeeCents: 100,
		},
		{
			name:         "min_floor_binds_on_zero_amount",
			amountCents:  0,
			feeBps:       feeBps15,
			minFeeCents:  minFee,
			wantFeeCents: 100,
		},
		{
			name:         "above_min_floor_100_dollars",
			amountCents:  10_000, // 1.5% = $1.50 > $1.00
			feeBps:       feeBps15,
			minFeeCents:  minFee,
			wantFeeCents: 150,
		},
		{
			// ~$66.67 is where 1.5% equals $1.00
			name:         "at_min_floor_boundary",
			amountCents:  6_667,
			feeBps:       feeBps15,
			minFeeCents:  minFee,
			wantFeeCents: 100,
		},

		// Small amounts with no floor (document raw half-up only)
		{
			name:         "small_amount_no_floor_raw_zero",
			amountCents:  0,
			feeBps:       feeBps15,
			minFeeCents:  0,
			wantFeeCents: 0,
		},
		{
			name:         "small_amount_no_floor_one_dollar",
			amountCents:  100,
			feeBps:       feeBps15,
			minFeeCents:  0,
			wantFeeCents: 2,
		},
		{
			name:         "default_production_shape_20_dollars",
			amountCents:  2_000,
			feeBps:       defaultInstantPayoutFeeBps,
			minFeeCents:  defaultInstantPayoutMinFeeCents,
			wantFeeCents: 100,
		},
		{
			name:         "default_production_shape_100_dollars",
			amountCents:  10_000,
			feeBps:       defaultInstantPayoutFeeBps,
			minFeeCents:  defaultInstantPayoutMinFeeCents,
			wantFeeCents: 150,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := computeInstantPayoutFeeCents(tt.amountCents, tt.feeBps, tt.minFeeCents)
			if got != tt.wantFeeCents {
				t.Fatalf("computeInstantPayoutFeeCents(%d, %d, %d) = %d, want %d",
					tt.amountCents, tt.feeBps, tt.minFeeCents, got, tt.wantFeeCents)
			}
		})
	}
}
