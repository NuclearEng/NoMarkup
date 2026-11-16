package handler

import (
	"os"
	"strconv"
)

// Instant-payout pricing + risk limits.
//
// ECONOMICS — why a flat 1% loses money.
// Stripe charges the PLATFORM ~1.0% (minimum $0.50) for an Instant Payout to a
// provider's debit card, on TOP of the original card-processing fee we already
// paid to collect the funds. So if NoMarkup charges the provider a flat 1% and
// pays Stripe ~1%, our margin on a $100 instant payout is ~$0.00 — and that is
// BEFORE the reversal risk of fronting money that can still claw back. At small
// amounts it is strictly negative: on a $20 payout, 1% = $0.20 collected vs
// Stripe's $0.50 instant-payout minimum → we LOSE $0.30 every time.
//
// To be profitable the platform fee must (a) be a higher percentage than
// Stripe's instant cost and (b) carry a minimum that covers Stripe's $0.50
// floor plus a margin. Defaults below target ~0.5% gross margin plus a $1.00
// minimum, and are env-overridable so finance can tune without a redeploy.
//
// All values are read once per request (cheap) so a config change takes effect
// on the next call. Mirrors the ADVANCE_BASE_RATE_BPS pattern in
// advance_pricing.go.

const (
	// defaultInstantPayoutFeeBps is the platform's instant-payout fee in basis
	// points (150 = 1.50%). Chosen so that fee% (1.50%) comfortably exceeds
	// Stripe's ~1.00% instant cost, leaving ~0.50% gross margin before risk.
	defaultInstantPayoutFeeBps = 150

	// defaultInstantPayoutMinFeeCents is the floor fee in cents ($1.00). Covers
	// Stripe's $0.50 instant-payout minimum plus margin, so small payouts are
	// never sold at a loss. At amounts below ~$67 the 1.50% rate is under $1.00,
	// so this minimum binds.
	defaultInstantPayoutMinFeeCents = 100

	// defaultInstantPayoutMaxPerTxnCents caps a single instant payout ($5,000).
	// Bounds the platform's per-event float/reversal exposure. Larger sums route
	// through the free standard (T+2) payout path instead.
	defaultInstantPayoutMaxPerTxnCents = 500_000

	// defaultInstantPayoutMaxPerDayCents caps total instant payouts per provider
	// per rolling 24h ($10,000). Bounds aggregate daily clawback exposure to one
	// provider and blunts a compromised-account drain.
	defaultInstantPayoutMaxPerDayCents = 1_000_000
)

// instantPayoutFeeBps returns the configured platform fee in basis points.
// Override with INSTANT_PAYOUT_FEE_BPS. Clamped to a sane non-negative range;
// must be > 0 to ever be profitable, so a 0/invalid value falls back to default.
func instantPayoutFeeBps() int64 {
	if v := os.Getenv("INSTANT_PAYOUT_FEE_BPS"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 && n <= 10_000 {
			return n
		}
	}
	return defaultInstantPayoutFeeBps
}

// instantPayoutMinFeeCents returns the configured minimum fee floor in cents.
// Override with INSTANT_PAYOUT_MIN_FEE_CENTS.
func instantPayoutMinFeeCents() int64 {
	if v := os.Getenv("INSTANT_PAYOUT_MIN_FEE_CENTS"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n >= 0 {
			return n
		}
	}
	return defaultInstantPayoutMinFeeCents
}

// instantPayoutMaxPerTxnCents returns the configured per-transaction cap.
// Override with INSTANT_PAYOUT_MAX_PER_TXN_CENTS.
func instantPayoutMaxPerTxnCents() int64 {
	if v := os.Getenv("INSTANT_PAYOUT_MAX_PER_TXN_CENTS"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	return defaultInstantPayoutMaxPerTxnCents
}

// instantPayoutMaxPerDayCents returns the configured per-provider daily cap.
// Override with INSTANT_PAYOUT_MAX_PER_DAY_CENTS.
func instantPayoutMaxPerDayCents() int64 {
	if v := os.Getenv("INSTANT_PAYOUT_MAX_PER_DAY_CENTS"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	return defaultInstantPayoutMaxPerDayCents
}

// computeInstantPayoutFeeCents applies feeBps to amountCents (rounded to the
// nearest cent via integer arithmetic) and raises the result to minFeeCents.
// All-integer to honor the money-in-cents rule (no float drift).
func computeInstantPayoutFeeCents(amountCents, feeBps, minFeeCents int64) int64 {
	// fee = amount * bps / 10000, rounded half-up.
	fee := (amountCents*feeBps + 5_000) / 10_000
	if fee < minFeeCents {
		fee = minFeeCents
	}
	return fee
}
