package handler

import "testing"

// The headline regression: $1,620 of net SE income previously estimated ~50%
// effective tax. The correct, defensible estimate is ~SE tax only (federal
// income tax is $0 after the standard deduction), ~14% in a no-income-tax state.
func TestComputeTaxEstimate_1620_NoStateTax(t *testing.T) {
	t.Parallel()

	// $1,620.00 net SE income, Texas (no state income tax).
	est := computeTaxEstimate(1_620_00, "TX")

	// SE base = 1620 * 0.9235 = 1496.07 → $1,496.07.
	if est.SECalcBaseCents != 1_496_07 {
		t.Errorf("SE base: got %d cents, want 149607", est.SECalcBaseCents)
	}
	// SE tax = 1496.07 * 0.153 = 228.899... → $228.90 (rounded).
	if est.SETaxCents != 228_90 {
		t.Errorf("SE tax: got %d cents, want 22890", est.SETaxCents)
	}
	// Federal taxable = 1620 − 15000 (std ded) − halfSE → floored at 0.
	if est.FederalTaxableCents != 0 {
		t.Errorf("federal taxable: got %d, want 0", est.FederalTaxableCents)
	}
	if est.FederalIncomeTaxCents != 0 {
		t.Errorf("federal income tax: got %d, want 0", est.FederalIncomeTaxCents)
	}
	// TX has no income tax.
	if est.StateIncomeTaxCents != 0 {
		t.Errorf("state tax (TX): got %d, want 0", est.StateIncomeTaxCents)
	}
	// Total = SE tax only.
	if est.TotalTaxCents != 228_90 {
		t.Errorf("total tax: got %d, want 22890", est.TotalTaxCents)
	}
	// Effective ≈ 228.90 / 1620 = 0.1413 → must be well under the old ~0.50.
	if est.EffectiveRate < 0.13 || est.EffectiveRate > 0.16 {
		t.Errorf("effective rate: got %.4f, want ~0.14 (0.13..0.16)", est.EffectiveRate)
	}
	if est.EffectiveRate >= 0.50 {
		t.Fatalf("REGRESSION: effective rate %.4f is back at the old ~50%%", est.EffectiveRate)
	}
}

// Same income in a flat-tax state adds a small state line but stays far from 50%.
func TestComputeTaxEstimate_1620_FlatStateTax(t *testing.T) {
	t.Parallel()

	// Colorado flat 4.40%. Federal taxable is 0 here, so the state tax (which
	// mirrors the federal taxable base for this estimate) is also 0.
	est := computeTaxEstimate(1_620_00, "CO")
	if est.StateTaxRate != 0.044 {
		t.Errorf("CO rate: got %.4f, want 0.044", est.StateTaxRate)
	}
	if est.StateIncomeTaxCents != 0 {
		t.Errorf("CO state tax on $0 taxable: got %d, want 0", est.StateIncomeTaxCents)
	}
	if !est.HasStateData {
		t.Error("CO should be recognized state data")
	}
}

// A higher income exercises the federal brackets + a non-zero state line, and
// the effective rate should still be a sane mid-twenties percent, not 50%.
func TestComputeTaxEstimate_80k_California(t *testing.T) {
	t.Parallel()

	est := computeTaxEstimate(80_000_00, "ca") // lower-case to test normalization

	if est.StateCode != "CA" {
		t.Errorf("state code normalization: got %q, want CA", est.StateCode)
	}
	if est.SETaxCents <= 0 {
		t.Error("SE tax should be positive at $80k")
	}
	if est.FederalIncomeTaxCents <= 0 {
		t.Error("federal income tax should be positive at $80k")
	}
	if est.StateIncomeTaxCents <= 0 {
		t.Error("CA state tax should be positive at $80k")
	}
	// Sanity: combined effective rate for $80k SE income lands roughly 20-30%.
	if est.EffectiveRate < 0.18 || est.EffectiveRate > 0.35 {
		t.Errorf("effective rate at $80k: got %.4f, want 0.18..0.35", est.EffectiveRate)
	}
}

func TestComputeTaxEstimate_ZeroAndNegative(t *testing.T) {
	t.Parallel()

	for _, in := range []int64{0, -500} {
		est := computeTaxEstimate(in, "TX")
		if est.TotalTaxCents != 0 || est.EffectiveRate != 0 {
			t.Errorf("net=%d: expected zero tax/rate, got total=%d rate=%.4f",
				in, est.TotalTaxCents, est.EffectiveRate)
		}
	}
}

func TestNormalizeStateCode(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"tx": "TX", "TX": "TX", " ca ": "CA", "Tex": "", "": "", "T": "", "T1": "",
	}
	for in, want := range cases {
		if got := normalizeStateCode(in); got != want {
			t.Errorf("normalizeStateCode(%q): got %q, want %q", in, got, want)
		}
	}
}

// SS wage base: above $176,100 of SE base, only the 2.9% Medicare portion
// continues on the excess (the 12.4% SS portion caps), so we don't over-charge.
func TestComputeSETax_WageBaseCap(t *testing.T) {
	t.Parallel()

	// Net = $250,000 → SE base = 230,875.00, above the $176,100 cap.
	seTax, base := computeSETaxCents(250_000_00)
	if base != 230_875_00 {
		t.Errorf("SE base: got %d, want 23087500", base)
	}
	// Uncapped would be 230875 * 0.153 = 35323.875 → $35,323.88.
	// Capped: 176100*0.124 + 230875*0.029 = 21836.40 + 6695.375 = $28,531.78.
	uncapped := int64(float64(base)*0.153 + 0.5)
	if seTax >= uncapped {
		t.Errorf("wage-base cap not applied: capped=%d should be < uncapped=%d", seTax, uncapped)
	}
	if seTax != 28_531_78 {
		t.Errorf("capped SE tax: got %d cents, want 2853178", seTax)
	}
}
