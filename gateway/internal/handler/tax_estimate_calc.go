package handler

// Self-employment / estimated income-tax computation for the provider Tax
// Center. All math is authoritative and server-side, in integer cents.
//
// WHY THIS EXISTS (founder rule: financial figures must be exact + defensible,
// never a hand-wavy flat rate): the previous Tax Center estimated tax entirely
// in the browser as a flat 15.3% SE tax + a flat 22% federal income-tax bracket
// applied to the FULL net earnings with no standard deduction. On $1,620 of net
// SE income that produced ~$248 SE + ~$356 income ≈ 37% — and rendered against
// the YTD figure it read like ~50%, which is wildly wrong (a sole proprietor
// with $1,620 of net SE income owes ~$0 federal income tax after the standard
// deduction, so the real estimate is essentially just the SE tax, ~14%).
//
// This file computes a defensible US federal + state estimate:
//   (a) SE tax  = 15.3% on 92.35% of net SE earnings (IRS Schedule SE).
//   (b) Federal income tax via the real 2025 single-filer brackets, on taxable
//       income = net SE earnings − standard deduction − ½ of the SE tax
//       (the above-the-line SE-tax deduction, IRC §164(f)).
//   (c) State income tax by the provider's state (flat rate, or 0 for the nine
//       no-income-tax states). Bracketed states are approximated with a single
//       representative effective rate documented inline — this is an ESTIMATE,
//       clearly labeled as such in the UI, not a filed return.
//
// Sources are cited per-constant below. These are estimates for planning; the
// UI states "consult a tax professional."

// --- (a) Self-employment tax (IRS Schedule SE, 2024/2025; unchanged rate) ---

// seTaxableFraction is the 92.35% of net earnings that is subject to SE tax
// (Schedule SE line 4a: net earnings × 0.9235).
const seTaxableFraction = 0.9235

// seTaxRate is the combined SE tax rate: 12.4% Social Security + 2.9% Medicare.
// (For 2025 the 12.4% SS portion applies up to the $176,100 wage base; above
// that only the 2.9% Medicare portion continues. We model the wage base so a
// high earner isn't over-charged the SS portion.)
const seTaxRate = 0.153

// seMedicareRate is the Medicare-only portion that continues above the SS wage
// base.
const seMedicareRate = 0.029

// ssWageBase2025Cents is the 2025 Social Security wage base ($176,100).
// Source: SSA 2025 COLA fact sheet.
const ssWageBase2025Cents int64 = 176_100_00

// --- (b) Federal income tax (2025 single-filer brackets) ---
//
// Source: IRS Rev. Proc. 2024-40 (2025 inflation adjustments).
// Standard deduction (single): $15,000.
const stdDeductionSingle2025Cents int64 = 15_000_00

// federalBracket is one marginal income-tax bracket: income from LowerCents up
// to (but not including) UpperCents is taxed at Rate. The top bracket uses a
// very large UpperCents as a sentinel for "and above."
type federalBracket struct {
	UpperCents int64
	Rate       float64
}

// federalBrackets2025Single are the 2025 single-filer marginal brackets.
// Source: IRS Rev. Proc. 2024-40.
//
//	10%   $0        – $11,925
//	12%   $11,925   – $48,475
//	22%   $48,475   – $103,350
//	24%   $103,350  – $197,300
//	32%   $197,300  – $250,525
//	35%   $250,525  – $626,350
//	37%   $626,350  – and above
var federalBrackets2025Single = []federalBracket{
	{UpperCents: 11_925_00, Rate: 0.10},
	{UpperCents: 48_475_00, Rate: 0.12},
	{UpperCents: 103_350_00, Rate: 0.22},
	{UpperCents: 197_300_00, Rate: 0.24},
	{UpperCents: 250_525_00, Rate: 0.32},
	{UpperCents: 626_350_00, Rate: 0.35},
	{UpperCents: 1<<62 - 1, Rate: 0.37},
}

// --- (c) State income tax (2025 estimates) ---
//
// We model state income tax with a single representative effective rate per
// state. Nine states levy NO state income tax (rate 0). Several states are flat.
// Graduated states are approximated by a mid/representative effective rate at
// the low-to-moderate income typical of a self-employed provider — this is an
// ESTIMATE and is labeled as such in the UI. Keyed by USPS 2-letter code,
// uppercase. Unknown/empty state → 0 (we do not invent a tax we can't source).
//
// Sources: Tax Foundation "State Individual Income Tax Rates and Brackets, 2025"
// and state DOR rate schedules.
var stateIncomeTaxRate = map[string]float64{
	// No state income tax (9 states):
	"AK": 0.00, "FL": 0.00, "NV": 0.00, "NH": 0.00, // NH taxes only interest/dividends, not earned income
	"SD": 0.00, "TN": 0.00, "TX": 0.00, "WA": 0.00, "WY": 0.00,

	// Flat-rate states (2025):
	"AZ": 0.025,   // 2.5% flat
	"CO": 0.044,   // 4.40% flat
	"ID": 0.05695, // 5.695% flat
	"IL": 0.0495,  // 4.95% flat
	"IN": 0.0305,  // 3.05% flat
	"KY": 0.04,    // 4.0% flat
	"MI": 0.0425,  // 4.25% flat
	"MS": 0.044,   // 4.4% flat (on income over $10k)
	"NC": 0.0425,  // 4.25% flat
	"PA": 0.0307,  // 3.07% flat
	"UT": 0.0455,  // 4.55% flat

	// Graduated states — representative effective rate for low/moderate SE income.
	// (Approximations; labeled as estimates in the UI.)
	"AL": 0.05, "AR": 0.039, "CA": 0.04, "CT": 0.05, "DE": 0.052,
	"GA": 0.0539, "HI": 0.06, "IA": 0.038, "KS": 0.0558, "LA": 0.03,
	"MA": 0.05, "MD": 0.0475, "ME": 0.058, "MN": 0.0535, "MO": 0.047,
	"MT": 0.047, "ND": 0.0195, "NE": 0.0512, "NJ": 0.0357, "NM": 0.047,
	"NY": 0.055, "OH": 0.0275, "OK": 0.0475, "OR": 0.0875, "RI": 0.0475,
	"SC": 0.062, "VA": 0.0575, "VT": 0.066, "WI": 0.053, "WV": 0.0482,
	"DC": 0.06,
}

// TaxEstimate is the itemized, transparent breakdown returned to the client.
// All monetary fields are integer cents.
type TaxEstimate struct {
	NetEarningsCents      int64   `json:"net_earnings_cents"`
	SECalcBaseCents       int64   `json:"se_calc_base_cents"` // 92.35% of net (Schedule SE basis)
	SETaxCents            int64   `json:"se_tax_cents"`
	HalfSETaxDeductCents  int64   `json:"half_se_tax_deduction_cents"`
	StandardDeductCents   int64   `json:"standard_deduction_cents"`
	FederalTaxableCents   int64   `json:"federal_taxable_cents"`
	FederalIncomeTaxCents int64   `json:"federal_income_tax_cents"`
	StateCode             string  `json:"state_code"`
	StateTaxRate          float64 `json:"state_tax_rate"`
	StateIncomeTaxCents   int64   `json:"state_income_tax_cents"`
	TotalTaxCents         int64   `json:"total_tax_cents"`
	EffectiveRate         float64 `json:"effective_rate"` // total tax / net earnings, 0..1
	HasStateData          bool    `json:"has_state_data"`
}

// roundHalfUp converts a float dollar/cent amount to integer cents, rounding to
// the nearest cent (half away from zero). The float math is bounded (single
// multiply on a known-finite input), so this never loses precision at the
// dollar amounts we handle.
func roundHalfUpCents(f float64) int64 {
	if f >= 0 {
		return int64(f + 0.5)
	}
	return int64(f - 0.5)
}

// computeSETaxCents returns the self-employment tax on the given net SE earnings
// (integer cents), modeling the Social Security wage base so high earners are
// not over-charged the 12.4% SS portion above the cap.
func computeSETaxCents(netEarningsCents int64) (seTaxCents, seBaseCents int64) {
	if netEarningsCents <= 0 {
		return 0, 0
	}
	base := roundHalfUpCents(float64(netEarningsCents) * seTaxableFraction)
	if base <= ssWageBase2025Cents {
		return roundHalfUpCents(float64(base) * seTaxRate), base
	}
	// SS portion (12.4%) caps at the wage base; Medicare (2.9%) applies to all.
	ssPortion := roundHalfUpCents(float64(ssWageBase2025Cents) * (seTaxRate - seMedicareRate))
	medicarePortion := roundHalfUpCents(float64(base) * seMedicareRate)
	return ssPortion + medicarePortion, base
}

// computeFederalIncomeTaxCents applies the 2025 single-filer marginal brackets
// to the given taxable income (integer cents, already net of deductions).
func computeFederalIncomeTaxCents(taxableCents int64) int64 {
	if taxableCents <= 0 {
		return 0
	}
	var tax float64
	var lower int64
	for _, b := range federalBrackets2025Single {
		if taxableCents <= lower {
			break
		}
		upper := b.UpperCents
		if taxableCents < upper {
			upper = taxableCents
		}
		tax += float64(upper-lower) * b.Rate
		lower = b.UpperCents
	}
	return roundHalfUpCents(tax)
}

// computeTaxEstimate produces the full SE + federal income + state estimate for
// a provider with the given net SE earnings (integer cents) located in
// `stateCode` (USPS 2-letter, any case; empty/unknown → no state tax).
//
// Federal income tax follows the sole-proprietor flow: taxable income = net
// earnings − standard deduction − ½ SE tax (the deductible employer-equivalent
// portion, IRC §164(f)), floored at 0, then run through the brackets.
func computeTaxEstimate(netEarningsCents int64, stateCode string) TaxEstimate {
	if netEarningsCents < 0 {
		netEarningsCents = 0
	}

	seTaxCents, seBaseCents := computeSETaxCents(netEarningsCents)
	halfSE := seTaxCents / 2

	// Federal taxable income after the standard deduction and the ½-SE-tax
	// above-the-line deduction. Floored at 0 (no negative taxable income).
	federalTaxable := netEarningsCents - stdDeductionSingle2025Cents - halfSE
	if federalTaxable < 0 {
		federalTaxable = 0
	}
	federalIncomeTax := computeFederalIncomeTaxCents(federalTaxable)

	code := normalizeStateCode(stateCode)
	rate, hasState := stateIncomeTaxRate[code]
	var stateTax int64
	if hasState && rate > 0 {
		// State taxable income mirrors the federal taxable base for this
		// estimate (most states start from federal AGI/taxable income). This is
		// a planning estimate, not a filed return.
		stateTax = roundHalfUpCents(float64(federalTaxable) * rate)
	}

	total := seTaxCents + federalIncomeTax + stateTax
	var effective float64
	if netEarningsCents > 0 {
		effective = float64(total) / float64(netEarningsCents)
	}

	return TaxEstimate{
		NetEarningsCents:      netEarningsCents,
		SECalcBaseCents:       seBaseCents,
		SETaxCents:            seTaxCents,
		HalfSETaxDeductCents:  halfSE,
		StandardDeductCents:   stdDeductionSingle2025Cents,
		FederalTaxableCents:   federalTaxable,
		FederalIncomeTaxCents: federalIncomeTax,
		StateCode:             code,
		StateTaxRate:          rate,
		StateIncomeTaxCents:   stateTax,
		TotalTaxCents:         total,
		EffectiveRate:         effective,
		HasStateData:          hasState,
	}
}

// normalizeStateCode upper-cases and trims a 2-letter state code; returns "" for
// anything that isn't exactly two ASCII letters.
func normalizeStateCode(s string) string {
	out := make([]byte, 0, 2)
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		if c >= 'A' && c <= 'Z' {
			out = append(out, c)
		}
	}
	if len(out) != 2 {
		return ""
	}
	return string(out)
}
