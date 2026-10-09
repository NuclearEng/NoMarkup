package domain

// AdvanceServiceFeeBps is a flat origination/service fee charged once on a
// working-capital advance's principal, on top of the prorated APR interest.
// 300 bps (3%) is the industry-standard origination rate for low-risk,
// receivable-backed advances. It is always disclosed to the provider as its
// own line item.
//
// Integer basis points only — fee cents are never derived via float64 (MON-24).
const AdvanceServiceFeeBps int64 = 300

// AdvanceServiceFeeCents returns the flat origination/service fee for a given
// advance principal. Lives in domain so both the charging path (service) and
// the breakdown the gRPC layer surfaces use one source of truth for the rate.
//
// Math: amountCents * 300 / 10000, rounded half-up to the nearest cent
// (matches the prior math.Round(float64(amount)*0.03) behaviour for all
// realistic principals without float64 truncation).
func AdvanceServiceFeeCents(amountCents int64) int64 {
	if amountCents <= 0 {
		return 0
	}
	const scale int64 = 10000
	bps := AdvanceServiceFeeBps
	// Split multiply so amountCents * bps cannot overflow for realistic
	// principals (same pattern as service.roundHalfUpFromBPS).
	whole := (amountCents / scale) * bps
	rem := (amountCents % scale) * bps
	out := whole + rem/scale
	if (rem%scale)*2 >= scale {
		out++
	}
	return out
}
