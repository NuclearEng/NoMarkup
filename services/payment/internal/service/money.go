package service

import "math"

// Integer money arithmetic.
//
// CLAUDE.md §5: "money is BIGINT cents (never DECIMAL/FLOAT)". Every cent this
// package computes is produced by the helpers below using int64 arithmetic
// only. float64 survives in exactly one place — the *stored rate* — and is
// converted to an exact integer basis-point value at the read boundary by
// rateToBPS before any cent is computed.
//
// ---------------------------------------------------------------------------
// Rounding conventions (single, explicit, repo-wide)
// ---------------------------------------------------------------------------
//
//	feeFromBPS  — round any fractional cent UP (ceiling).
//	    Used for every platform *take*: platform commission, guarantee fee,
//	    lead-gen fee, BNPL fee, marketplace (goods) fee, insurance premium,
//	    instant-payout fee, advance repayment withholding.
//
//	    Rationale: (a) the platform must never under-collect; (b) it is the
//	    only rounding convention actually written down in this repo —
//	    services/job/internal/repository/listing_repo.go computes the goods
//	    fee as `(*currentBid)*feeBps/10000 + roundup` and PERSISTS it on
//	    listing_orders.fee_cents. That persisted value is the authority for a
//	    goods order, so the payment-side recompute has to match it exactly or
//	    the buyer is charged a total that disagrees with the order row.
//
//	roundHalfUpFromBPS — round to the nearest cent, ties away from zero.
//	    Used for statutory sales tax (state authorities specify half-up; a
//	    ceiling would systematically over-collect tax, which is a remittance
//	    liability rather than platform revenue) and for time-prorated interest
//	    accrual on working-capital advances (an interest computation, not a
//	    transaction take — nearest-cent is the standard and is what the
//	    existing code documents).
//
// ---------------------------------------------------------------------------

// bpsScale is the basis-point denominator: 1 bps = 1/10000.
const bpsScale int64 = 10000

// maxRateBPS bounds a converted rate. The rate columns are NUMERIC(5,4)
// (migrations 001 and 049), i.e. at most 9.9999, so 99999 bps is the widest
// legal value. Anything beyond that is a corrupt config and is clamped rather
// than allowed to overflow downstream multiplication.
const maxRateBPS int64 = 99999

// rateToBPS converts a stored fractional rate (0.0825) into exact integer
// basis points (825).
//
// Exactness: every rate reaching this function comes from a NUMERIC(5,4)
// column (platform_fee_config.fee_percentage / guarantee_percentage /
// lead_gen_percentage — see migrations 001 and 049) or from a compile-time
// constant written with at most four decimal places. In exact arithmetic
// rate*10000 is therefore an integer. The binary float64 nearest 0.0825 is
// not exactly 0.0825, so rate*10000 lands a hair either side of 825; the
// absolute error is bounded by ~1e-12 for any rate in [0, 10), which is
// twelve orders of magnitude below the 0.5 that would be needed to round to
// the wrong integer. math.Round therefore recovers the intended basis points
// exactly and deterministically over the entire domain of NUMERIC(5,4).
//
// Non-finite and negative rates yield 0 (fail closed: charge nothing rather
// than an undefined amount).
func rateToBPS(rate float64) int64 {
	if math.IsNaN(rate) || math.IsInf(rate, 0) || rate <= 0 {
		return 0
	}
	bps := int64(math.Round(rate * float64(bpsScale)))
	if bps > maxRateBPS {
		return maxRateBPS
	}
	return bps
}

// feeFromBPS returns amountCents * bps / 10000 with any fractional cent
// rounded UP. See the rounding-convention note above.
//
// The multiplication is split so it cannot overflow: with
// amountCents = q*10000 + r, the product is q*bps*10000 + r*bps, so the
// result is q*bps + (r*bps)/10000. q*bps is bounded by the result itself and
// r*bps < 10000*99999 < 2^30, so neither term can wrap an int64 unless the
// answer itself would not fit.
func feeFromBPS(amountCents, bps int64) int64 {
	if amountCents <= 0 || bps <= 0 {
		return 0
	}
	whole := (amountCents / bpsScale) * bps
	rem := (amountCents % bpsScale) * bps
	fee := whole + rem/bpsScale
	if rem%bpsScale != 0 {
		fee++
	}
	return fee
}

// roundHalfUpFromBPS returns amountCents * bps / 10000 rounded to the nearest
// cent, ties away from zero. Used for sales tax and interest accrual; see the
// rounding-convention note above. Overflow is avoided by the same split as
// feeFromBPS.
func roundHalfUpFromBPS(amountCents, bps int64) int64 {
	if amountCents <= 0 || bps <= 0 {
		return 0
	}
	whole := (amountCents / bpsScale) * bps
	rem := (amountCents % bpsScale) * bps
	out := whole + rem/bpsScale
	if (rem%bpsScale)*2 >= bpsScale {
		out++
	}
	return out
}

// prorateHalfUp returns (amountCents * bps * numer) / (10000 * denom) rounded
// to the nearest cent, ties away from zero, in pure integer arithmetic.
//
// This is the simple-interest accrual used for working-capital advances:
// fee = principal x APR x (termDays / 365). Evaluating it as one rational with
// a single rounding step at the end (rather than dividing twice) means the
// result never drifts by an intermediate truncation.
//
// Overflow: for the realistic domain — advance principal well under $1B
// (1e11 cents), aprBps <= 10000, termDays <= 365 — the numerator stays below
// 4e17, comfortably inside int64. mulOverflows guards the corrupt-input case
// so a bad config saturates instead of wrapping to a negative fee.
func prorateHalfUp(amountCents, bps, numer, denom int64) int64 {
	if amountCents <= 0 || bps <= 0 || numer <= 0 || denom <= 0 {
		return 0
	}
	num, ok := mul3(amountCents, bps, numer)
	if !ok {
		return math.MaxInt64
	}
	den := bpsScale * denom
	out := num / den
	if (num%den)*2 >= den {
		out++
	}
	return out
}

// mul3 multiplies three non-negative int64s, reporting false on overflow.
func mul3(a, b, c int64) (int64, bool) {
	ab := a * b
	if a != 0 && ab/a != b {
		return 0, false
	}
	abc := ab * c
	if ab != 0 && abc/ab != c {
		return 0, false
	}
	return abc, true
}
