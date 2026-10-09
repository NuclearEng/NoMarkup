package main

import (
	"errors"
	"strings"
)

// Decision-ID OFFSESSION-LEGAL.
//
// Off-session goods charging and unpaid-win expiry stay off unless an operator
// sets BOTH the relevant flag AND MARKETPLACE_OFFSESSION_TOS_VERSION (a
// non-empty terms id or date proving bid-authorization language shipped).
// Default both flags off. Do not invent ToS text. Do not flip the flags here.

var errOffsessionTOSRequired = errors.New(
	"MARKETPLACE_OFFSESSION_TOS_VERSION is required when MARKETPLACE_OFFSESSION_CHARGE or MARKETPLACE_PAYMENT_EXPIRY is true (OFFSESSION-LEGAL)",
)

// marketplaceLegalGates is the fail-closed pairing of the two legal-gated
// marketplace flags with the ToS version that authorizes them.
type marketplaceLegalGates struct {
	OffSessionCharge bool
	ExpireUnfunded   bool
	TOSVersion       string
	// ForcedOff is true when a requested flag was denied because the ToS
	// version is empty. Production never returns this — it fatals instead.
	ForcedOff bool
}

// resolveMarketplaceLegalGates applies OFFSESSION-LEGAL.
//
//   - Neither flag requested → both stay false (ToS optional).
//   - Either flag requested and tosVersion non-empty (after trim) → honor the
//     requested flags.
//   - Either flag requested and tosVersion empty:
//     production → error (caller must refuse to start)
//     any other environment → force both flags false, ForcedOff=true
func resolveMarketplaceLegalGates(environment string, chargeRequested, expiryRequested bool, tosVersion string) (marketplaceLegalGates, error) {
	tos := strings.TrimSpace(tosVersion)
	g := marketplaceLegalGates{TOSVersion: tos}

	if !chargeRequested && !expiryRequested {
		return g, nil
	}
	if tos != "" {
		g.OffSessionCharge = chargeRequested
		g.ExpireUnfunded = expiryRequested
		return g, nil
	}
	if environment == "production" {
		return marketplaceLegalGates{}, errOffsessionTOSRequired
	}
	g.ForcedOff = true
	return g, nil
}
