package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestStateTaxRate covers the published rates and a couple of edge cases.
func TestStateTaxRate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		code string
		want float64
	}{
		{"texas", "TX", 0.0625},
		{"california", "CA", 0.0725},
		{"new_york", "NY", 0.0400},
		{"oregon_zero", "OR", 0.0000},
		{"new_hampshire_zero", "NH", 0.0000},
		{"alaska_zero", "AK", 0.0000},
		{"unknown_returns_zero", "XX", 0.0000},
		{"empty_returns_zero", "", 0.0000},
		{"lowercase_normalized", "tx", 0.0625},
		{"whitespace_trimmed", "  CA ", 0.0725},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.InDelta(t, tt.want, StateTaxRate(tt.code), 1e-9)
		})
	}
}

// TestComputeTaxCents — known zip → known rate → known total. Per spec.
func TestComputeTaxCents(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		subtotal    int64
		state       string
		wantTax     int64
	}{
		{"100_dollars_in_california", 10000, "CA", 725},   // 10000 * 0.0725 = 725
		{"100_dollars_in_texas", 10000, "TX", 625},        // 10000 * 0.0625 = 625
		{"100_dollars_in_oregon_no_tax", 10000, "OR", 0},  // 0% rate
		{"50_dollars_in_new_york", 5000, "NY", 200},       // 5000 * 0.04 = 200
		{"99_cents_california", 99, "CA", 7},              // 99 * 0.0725 = 7.1775 -> 7
		{"1_cent_california", 1, "CA", 0},                 // 1 * 0.0725 = 0.0725 -> 0
		{"unknown_state_zero", 10000, "ZZ", 0},
		{"zero_subtotal", 0, "CA", 0},
		{"negative_subtotal_clamps", -100, "CA", 0},
		{"large_amount_no_overflow", 100000000, "CA", 7250000}, // $1M -> $72,500 tax
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := ComputeTaxCents(tt.subtotal, tt.state)
			assert.Equal(t, tt.wantTax, got)
		})
	}
}

// TestStateFromZip — a sample of zips covering each state we care about.
func TestStateFromZip(t *testing.T) {
	t.Parallel()

	tests := []struct {
		zip   string
		state string
	}{
		{"94016", "CA"}, // San Francisco
		{"90210", "CA"}, // Beverly Hills
		{"75201", "TX"}, // Dallas
		{"77001", "TX"}, // Houston
		{"10001", "NY"}, // New York
		{"97201", "OR"}, // Portland — no tax
		{"03101", "NH"}, // Manchester NH — no tax
		{"99501", "AK"}, // Anchorage — no tax
		{"02108", "MA"}, // Boston
		{"00501", ""},   // unknown / govt
		{"abc", ""},     // invalid
		{"", ""},        // empty
	}
	for _, tt := range tests {
		t.Run(tt.zip, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.state, StateFromZip(tt.zip))
		})
	}
}

// TestComputeTaxCentsForZip — convenience wrapper, end-to-end zip→tax.
func TestComputeTaxCentsForZip(t *testing.T) {
	t.Parallel()

	state, tax := ComputeTaxCentsForZip(10000, "94016")
	assert.Equal(t, "CA", state)
	assert.Equal(t, int64(725), tax)

	state, tax = ComputeTaxCentsForZip(10000, "97201")
	assert.Equal(t, "OR", state)
	assert.Equal(t, int64(0), tax)

	state, tax = ComputeTaxCentsForZip(10000, "")
	assert.Equal(t, "", state)
	assert.Equal(t, int64(0), tax)
}
