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
)

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
