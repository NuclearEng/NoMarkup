package handler

import (
	"math"
	"os"
	"strconv"
)

// Risk-based advance pricing — mirror of
// services/payment/internal/service/advance.go. The payment service is the
// authority that CHARGES this; the gateway recomputes it only to show the
// provider an accurate quote on the credit-limit response. Keep the two in
// sync (same base rate env, bands, and formula).

func baseAdvanceRateBps() int {
	if v := os.Getenv("ADVANCE_BASE_RATE_BPS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			return n
		}
	}
	return 300
}

const (
	advanceRateFloorBps   = 300
	advanceRateCeilingBps = 1500
	minLendingScore       = 35

	// defaultAdvanceTermDays mirrors the payment service's assumed
	// time-to-repayment used to prorate APR interest. Kept in sync with
	// services/payment/internal/service/advance.go so the term shown to the
	// provider matches the term used to charge them.
	defaultAdvanceTermDays = 30

	// advanceServiceFeeBps mirrors domain.AdvanceServiceFeeBps (300 = 3% flat
	// origination/service fee on principal). Kept here so the gateway can show
	// an itemized quote without an extra round-trip.
	advanceServiceFeeBps int64 = 300
)

// advanceServiceFeeRate is the fractional form of advanceServiceFeeBps for API
// display only (service_fee_rate JSON). Fee cents are never derived from this.
const advanceServiceFeeRate = float64(advanceServiceFeeBps) / 10000.0

// businessCreditScore: 0-100 from repayment history, completed-job volume, and
// earnings. onTimeRate nil → neutral baseline (no advance history yet).
func businessCreditScore(onTimeRate *float64, jobsCompleted int, totalEarningsCents int64) int {
	// Thin-file (no advance history) starts eligible-but-high-rate (grade D);
	// proven repayment scores higher, defaulters lower. Mirror of advance.go.
	repayment := 35.0
	if onTimeRate != nil {
		repayment = *onTimeRate * 50.0
	}
	vol := float64(jobsCompleted)
	if vol > 20 {
		vol = 20
	}
	volume := vol / 20.0 * 30.0
	earnings := 0.0
	switch {
	case totalEarningsCents >= 1_000_000:
		earnings = 20
	case totalEarningsCents >= 250_000:
		earnings = 12
	case totalEarningsCents >= 50_000:
		earnings = 6
	}
	score := int(math.Round(repayment + volume + earnings))
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return score
}

func creditGrade(score int) string {
	switch {
	case score >= 80:
		return "A"
	case score >= 65:
		return "B"
	case score >= 50:
		return "C"
	case score >= minLendingScore:
		return "D"
	default:
		return "F"
	}
}

func riskPremiumBps(grade string) int {
	switch grade {
	case "A":
		return 0
	case "B":
		return 200
	case "C":
		return 500
	case "D":
		return 900
	default:
		return 1200
	}
}

func dynamicAPRBps(score int) int {
	apr := baseAdvanceRateBps() + riskPremiumBps(creditGrade(score))
	if apr < advanceRateFloorBps {
		apr = advanceRateFloorBps
	}
	if apr > advanceRateCeilingBps {
		apr = advanceRateCeilingBps
	}
	return apr
}

// advanceServiceFeeCents mirrors domain.AdvanceServiceFeeCents — the flat 3%
// origination/service fee on principal, half-up via integer basis points (MON-24).
func advanceServiceFeeCents(amountCents int64) int64 {
	if amountCents <= 0 {
		return 0
	}
	const scale int64 = 10000
	bps := advanceServiceFeeBps
	whole := (amountCents / scale) * bps
	rem := (amountCents % scale) * bps
	out := whole + rem/scale
	if (rem%scale)*2 >= scale {
		out++
	}
	return out
}

// advanceInterestCents mirrors computeAdvanceFeeCentsAPR in the payment service:
// simple interest = principal × APR × (termDays / 365), half-up integer proration.
func advanceInterestCents(amountCents int64, aprBps, termDays int) int64 {
	if termDays <= 0 {
		termDays = defaultAdvanceTermDays
	}
	if amountCents <= 0 || aprBps <= 0 || termDays <= 0 {
		return 0
	}
	// (amount * bps * term) / (10000 * 365), half-up. Same rational as
	// payment/service.prorateHalfUp for realistic principal/APR domains.
	const scale int64 = 10000
	const daysPerYear int64 = 365
	num := amountCents * int64(aprBps) * int64(termDays)
	den := scale * daysPerYear
	out := num / den
	if (num%den)*2 >= den {
		out++
	}
	return out
}
