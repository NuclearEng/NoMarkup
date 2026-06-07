package domain

import "math"

// AdvanceServiceFeeRate is a flat origination/service fee charged once on a
// working-capital advance's principal, on top of the prorated APR interest.
// 3% is the industry-standard origination rate for low-risk, receivable-backed
// advances. It is always disclosed to the provider as its own line item.
const AdvanceServiceFeeRate = 0.03

// AdvanceServiceFeeCents returns the flat origination/service fee for a given
// advance principal. Lives in domain so both the charging path (service) and
// the breakdown the gRPC layer surfaces use one source of truth for the rate.
func AdvanceServiceFeeCents(amountCents int64) int64 {
	return int64(math.Round(float64(amountCents) * AdvanceServiceFeeRate))
}
