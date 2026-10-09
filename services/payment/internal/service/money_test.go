package service

// Tests for the integer money helpers.
//
// These exist because this package moved every fee computation off float64
// (CLAUDE.md §5: "money is BIGINT cents — never DECIMAL/FLOAT"). The risky part
// of that migration is not the arithmetic, it is the CONVERSION of a stored
// float rate into exact basis points: if rateToBPS is ever off by one, every
// fee in the system shifts. So the bulk of what follows pins that boundary
// over the full domain of the NUMERIC(5,4) rate columns.

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRateToBPS(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		rate float64
		want int64
	}{
		{"platform 8.25%", 0.0825, 825},
		{"guarantee 2%", 0.02, 200},
		{"lead gen 5%", 0.05, 500},
		{"one basis point", 0.0001, 1},
		{"whole 1.0", 1.0, 10000},
		{"max NUMERIC(5,4)", 9.9999, 99999},
		{"zero", 0, 0},
		{"negative fails closed", -0.05, 0},
		{"NaN fails closed", math.NaN(), 0},
		{"+Inf fails closed", math.Inf(1), 0},
		{"-Inf fails closed", math.Inf(-1), 0},
		{"above max clamps", 12.5, 99999},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, rateToBPS(tt.rate))
		})
	}
}

// The correctness argument in money.go is that float64 representation error is
// ~12 orders of magnitude below what would round to the wrong integer. Assert
// that over EVERY value the NUMERIC(5,4) columns can hold, rather than trusting
// the argument — 100k cases is cheap and this is money.
func TestRateToBPS_exactAcrossNumeric5_4Domain(t *testing.T) {
	t.Parallel()

	for want := int64(1); want <= 99999; want++ {
		rate := float64(want) / 10000.0
		if got := rateToBPS(rate); got != want {
			t.Fatalf("rateToBPS(%v) = %d, want %d — float conversion is not exact", rate, got, want)
		}
	}
}

func TestFeeFromBPS(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		amount int64
		bps    int64
		want   int64
	}{
		{"exact, no remainder", 10000, 500, 500},
		{"fractional cent rounds UP", 10001, 500, 501},
		{"smallest possible fee rounds up from near-zero", 1, 1, 1},
		{"zero amount", 0, 500, 0},
		{"zero bps", 10000, 0, 0},
		{"negative amount fails closed", -10000, 500, 0},
		{"negative bps fails closed", 10000, -500, 0},
		{"100% passes through", 12345, 10000, 12345},
		{"large amount stays exact", 1_000_000_000, 825, 82_500_000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, feeFromBPS(tt.amount, tt.bps))
		})
	}
}

// The ceiling convention exists so the platform never under-collects. Pin that
// property directly rather than only through examples.
func TestFeeFromBPS_neverUnderCollects(t *testing.T) {
	t.Parallel()

	for amount := int64(1); amount <= 5000; amount++ {
		for _, bps := range []int64{1, 250, 825, 10000} {
			got := feeFromBPS(amount, bps)
			// Exact rational value, scaled by 10000 to stay in integers.
			scaled := amount * bps
			require.GreaterOrEqual(t, got*bpsScale, scaled,
				"fee must never be less than the exact value (amount=%d bps=%d)", amount, bps)
			// And never more than one cent above it.
			require.Less(t, (got-1)*bpsScale, scaled,
				"fee must not exceed the exact value by a whole cent (amount=%d bps=%d)", amount, bps)
		}
	}
}

func TestRoundHalfUpFromBPS(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		amount int64
		bps    int64
		want   int64
	}{
		{"exact", 10000, 825, 825},
		{"below half rounds down", 10040, 100, 100},           // 100.40 -> 100
		{"above half rounds up", 10060, 100, 101},             // 100.60 -> 101
		{"exact half rounds away from zero", 10050, 100, 101}, // 100.50 -> 101
		{"zero amount", 0, 825, 0},
		{"zero bps", 10000, 0, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, roundHalfUpFromBPS(tt.amount, tt.bps))
		})
	}
}

// Sales tax must round half-up, NOT ceiling: rounding a remittance liability up
// systematically over-collects on someone else's behalf. This guards the one
// place the two conventions must differ.
func TestRoundHalfUp_differsFromCeiling_whereItMatters(t *testing.T) {
	t.Parallel()

	// $100.01 at 1% = 100.01 cents. Half-up keeps 100; ceiling pushes to 101.
	// One cent per transaction, in opposite directions, on a remittance
	// liability versus platform revenue.
	assert.Equal(t, int64(100), roundHalfUpFromBPS(10001, 100), "tax rounds to nearest")
	assert.Equal(t, int64(101), feeFromBPS(10001, 100), "platform take rounds up")
}

// ComputeTaxCents moved from `int64(float64(x)*rate + 0.5)` to integer bps.
// Both are half-up, so the result must be UNCHANGED — this is the regression
// guard for that claim.
func TestComputeTaxCents_matchesPreviousFloatBehaviour(t *testing.T) {
	t.Parallel()

	oldImpl := func(subtotalCents int64, rate float64) int64 {
		if subtotalCents <= 0 || rate <= 0 {
			return 0
		}
		return int64(float64(subtotalCents)*rate + 0.5)
	}

	for _, state := range []string{"CA", "NY", "TX", "WA", "FL"} {
		rate := StateTaxRate(state)
		if rate <= 0 {
			continue
		}
		for _, subtotal := range []int64{1, 99, 100, 999, 1000, 1234, 9999, 10000, 12345, 99999, 100000, 1000000} {
			assert.Equal(t, oldImpl(subtotal, rate), ComputeTaxCents(subtotal, state),
				"tax changed for state=%s subtotal=%d — this conversion must be behaviour-preserving", state, subtotal)
		}
	}
}

func TestComputeTaxCents_guards(t *testing.T) {
	t.Parallel()

	assert.Zero(t, ComputeTaxCents(0, "CA"), "zero subtotal")
	assert.Zero(t, ComputeTaxCents(-100, "CA"), "negative subtotal")
	assert.Zero(t, ComputeTaxCents(10000, "ZZ"), "unknown state")
	assert.Zero(t, ComputeTaxCents(10000, ""), "empty state")
}

func TestProrateHalfUp(t *testing.T) {
	t.Parallel()

	// $1,000 principal, 12% APR, 30 of 365 days = 1000_00 * 0.12 * 30/365.
	// Exact: 986.30... cents -> 986.
	assert.Equal(t, int64(986), prorateHalfUp(100_000, 1200, 30, 365))

	assert.Zero(t, prorateHalfUp(0, 1200, 30, 365), "zero principal")
	assert.Zero(t, prorateHalfUp(100_000, 0, 30, 365), "zero rate")
	assert.Zero(t, prorateHalfUp(100_000, 1200, 0, 365), "zero term")
	assert.Zero(t, prorateHalfUp(100_000, 1200, 30, 0), "zero denominator")
}

// Corrupt config must saturate, never wrap to a negative amount — a negative
// fee would be a credit to the counterparty.
func TestProrateHalfUp_overflowSaturates(t *testing.T) {
	t.Parallel()

	got := prorateHalfUp(math.MaxInt64, 10000, 365, 365)
	assert.Equal(t, int64(math.MaxInt64), got)
	assert.Positive(t, got, "overflow must never produce a negative fee")
}

func TestMul3(t *testing.T) {
	t.Parallel()

	got, ok := mul3(2, 3, 4)
	require.True(t, ok)
	assert.Equal(t, int64(24), got)

	_, ok = mul3(math.MaxInt64, 2, 1)
	assert.False(t, ok, "must report overflow rather than wrapping")

	_, ok = mul3(math.MaxInt64/2, 2, 3)
	assert.False(t, ok, "must report overflow in the second multiply")
}
