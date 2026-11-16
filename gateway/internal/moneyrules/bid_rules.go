// Package moneyrules holds pure money/bid validation shared with security review.
package moneyrules

// ValidateLowerOnly returns an error message if newCents is not a valid lower bid.
// Mirrors iOS BidAmountRules.validateLowerOnly (PRD FR-4.3).
func ValidateLowerOnly(currentCents, newCents int64) string {
	if newCents <= 0 {
		return "bid amount must be greater than zero"
	}
	if newCents >= currentCents {
		return "new bid must be strictly lower than current bid"
	}
	return ""
}

// ValidateOfferAccepted returns an error if offer is not ≤ starting (PRD FR-4.4 posting).
func ValidateOfferAccepted(startingCents, offerCents int64) string {
	if offerCents <= 0 {
		return "offer-accepted must be greater than zero"
	}
	if offerCents > startingCents {
		return "offer-accepted must be at or below starting bid"
	}
	return ""
}
