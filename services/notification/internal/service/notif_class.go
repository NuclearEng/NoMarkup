package service

// Notification-type classification and cooldown policy, shared by the APNs
// payload shaping (interruption-level / sound / priority — IOS-SYS.NT.3 and
// NT.6) and the send-ledger push cooldowns (IOS-SYS.NT.1).

import (
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/services/notification/internal/domain"
)

// Cooldown windows and caps (IOS-SYS.NT.1). Deliberately constants rather
// than env vars: they are product policy, and nothing ops-side needs to tune
// them per deploy today.
const (
	// pushLedgerChannel is the channel value stamped into
	// notification_send_ledger for push dispatches.
	pushLedgerChannel = "push"

	// Promotional pushes: at most 1 per type and 3 across the whole class,
	// per user, per rolling 24h.
	promoPerTypeWindow = 24 * time.Hour
	promoPerTypeMax    = 1
	promoClassWindow   = 24 * time.Hour
	promoClassMax      = 3

	// Transactional pushes (auction / contract / message / payment ...):
	// a generous anti-storm cap only — never meant to bite in normal use.
	transactionalWindow = time.Hour
	transactionalMax    = 20
)

// promotionalSendClass is the single definition of "promotional" consumed by
// BOTH the Go classifier below and the ledger SQL predicate
// (repository.CountSendsMatching), so the two can never disagree.
//
//   - "nps_survey" is the concrete type the NPS scheduler emits
//     (cmd/server/nps.go); "nps" is kept for the audit's generic name.
//   - reengagement_* currently ships email/in-app only (reengagement.go), but
//     is classified promotional so a future push channel inherits the caps.
func promotionalSendClass() domain.SendTypeClass {
	return domain.SendTypeClass{
		ExactTypes: []string{
			"price_drop",
			"seller_new_listing",
			"promotional",
			"marketing",
			"nps",
			"nps_survey",
		},
		Prefixes: []string{
			"welcome_day_",
			"reengagement_",
		},
	}
}

// isPromotionalNotifType reports whether a notification type belongs to the
// promotional/retention class (vs transactional auction/contract/message
// types). Normalization is defensive — emitters already use lower snake_case.
func isPromotionalNotifType(notifType string) bool {
	t := strings.ToLower(strings.TrimSpace(notifType))
	class := promotionalSendClass()
	for _, exact := range class.ExactTypes {
		if t == exact {
			return true
		}
	}
	for _, prefix := range class.Prefixes {
		if strings.HasPrefix(t, prefix) {
			return true
		}
	}
	return false
}
