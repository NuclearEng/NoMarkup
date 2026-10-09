package service

import (
	"errors"
	"fmt"

	"github.com/stripe/stripe-go/v82"
)

// Off-session charge outcomes.
//
// WHY THIS FILE EXISTS. An off-session charge has four failure modes that look
// identical if you only check `err != nil`, and that demand four DIFFERENT
// responses from the platform. Collapsing them is not a cosmetic problem — each
// wrong collapse produces a specific, real harm:
//
//	no instrument on file   The platform never successfully collected a card.
//	                        Nobody has defaulted on anything. Counting this as a
//	                        decline blames the buyer for a platform gap, and
//	                        (before this change) three of them in a row defaulted
//	                        a BNPL plan belonging to a customer who did nothing
//	                        wrong. Response: alert the operator, ask the buyer to
//	                        add a card, do NOT burn a retry.
//
//	authentication_required The issuer demands 3DS/SCA. The card is good and the
//	                        buyer is good; the charge simply cannot complete
//	                        without the buyer present. Response: bring the buyer
//	                        BACK to the app to authenticate. Treating this as a
//	                        decline cancels an order that would have paid, and
//	                        re-retrying it off-session can never succeed — every
//	                        attempt fails the same way until the buyer returns.
//
//	insufficient_funds      A real decline, but a transient one: the same card
//	                        may work next week. Response: tell the buyer
//	                        specifically (they can fix it), retry later.
//
//	card_declined (other)   A real decline, often permanent (stolen, expired,
//	                        do_not_honor). Response: tell the buyer to use a
//	                        different card.
//
// Anything else — network error, 500 from Stripe, rate limit — is
// ChargeOutcomeError: NOT a payment failure at all, and must never be recorded
// against the buyer or counted toward a retry budget. It is retried as infra.
type ChargeOutcome string

const (
	// ChargeOutcomeSucceeded means Stripe captured the funds.
	ChargeOutcomeSucceeded ChargeOutcome = "succeeded"
	// ChargeOutcomeNoPaymentMethod means no charge was ATTEMPTED: the platform
	// has no chargeable instrument for this buyer. Platform-side gap.
	ChargeOutcomeNoPaymentMethod ChargeOutcome = "no_payment_method"
	// ChargeOutcomeAuthenticationRequired means SCA/3DS is required and the
	// buyer must return to the app. Not a decline.
	ChargeOutcomeAuthenticationRequired ChargeOutcome = "authentication_required"
	// ChargeOutcomeInsufficientFunds is a decline for lack of funds — retryable.
	ChargeOutcomeInsufficientFunds ChargeOutcome = "insufficient_funds"
	// ChargeOutcomeCardDeclined is any other issuer decline.
	ChargeOutcomeCardDeclined ChargeOutcome = "card_declined"
	// ChargeOutcomeError is an infrastructure/unknown failure. Not attributable
	// to the buyer.
	ChargeOutcomeError ChargeOutcome = "error"
)

// Sentinel errors so callers can branch with errors.Is rather than string
// matching on Stripe messages.
var (
	// ErrCardDeclined is a genuine issuer decline.
	ErrCardDeclined = errors.New("card declined")
	// ErrInsufficientFunds is a decline specifically for lack of funds.
	ErrInsufficientFunds = errors.New("card declined for insufficient funds")
	// ErrAuthenticationRequired means the charge needs the buyer to complete
	// SCA/3DS. The buyer must return to the app; retrying off-session cannot
	// succeed.
	ErrAuthenticationRequired = errors.New("payment requires customer authentication")
)

// BuyerMessage returns text safe to show the BUYER for this outcome.
//
// CLAUDE.md §9/§15: customers get actionable self-serve guidance, platform
// misconfiguration alerts the admin instead. Note that ChargeOutcomeError and
// ChargeOutcomeNoPaymentMethod are deliberately vague to the buyer — the first
// is not their problem and the second is a platform gap they can still act on
// ("add a card") without being told the platform lost their card.
func (o ChargeOutcome) BuyerMessage() string {
	switch o {
	case ChargeOutcomeSucceeded:
		return "Payment received."
	case ChargeOutcomeNoPaymentMethod:
		return "We don't have a payment method on file for you. Add a card to complete this order."
	case ChargeOutcomeAuthenticationRequired:
		return "Your bank needs you to confirm this payment. Open the order to finish verifying it."
	case ChargeOutcomeInsufficientFunds:
		return "Your card was declined for insufficient funds. Add funds or use a different card to complete this order."
	case ChargeOutcomeCardDeclined:
		return "Your card was declined. Use a different payment method to complete this order."
	default:
		return "We couldn't process your payment yet. We'll try again shortly — no action is needed from you."
	}
}

// AttributableToBuyer reports whether the outcome represents something the BUYER
// must act on.
//
// Used to decide whether a failed attempt counts against the buyer's payment
// deadline. ChargeOutcomeError (Stripe down) and ChargeOutcomeNoPaymentMethod
// (platform never collected a card) are NOT the buyer's fault and must not
// consume their clock — the same fail-closed reasoning as
// chargeOnePendingOrder, which declines to stamp a deadline on a platform-side
// failure.
func (o ChargeOutcome) AttributableToBuyer() bool {
	switch o {
	case ChargeOutcomeInsufficientFunds, ChargeOutcomeCardDeclined, ChargeOutcomeAuthenticationRequired:
		return true
	default:
		return false
	}
}

// Retryable reports whether an identical off-session retry could plausibly
// succeed later.
//
// authentication_required is explicitly NOT retryable off-session: the issuer
// wants the cardholder, and no number of merchant-initiated retries produces
// one. Retrying it burns attempts and misreports the order as failing when it is
// really waiting on the buyer.
func (o ChargeOutcome) Retryable() bool {
	switch o {
	case ChargeOutcomeInsufficientFunds, ChargeOutcomeCardDeclined, ChargeOutcomeError:
		return true
	default:
		return false
	}
}

// classifyChargeError maps an error from an off-session Stripe charge onto a
// ChargeOutcome plus a wrapped sentinel error.
//
// A nil error yields (ChargeOutcomeSucceeded, nil).
//
// Classification order matters. authentication_required is checked FIRST and
// against both fields, because Stripe reports SCA two different ways depending
// on the path: as a top-level ErrorCode on a confirm, and as a DeclineCode
// nested under a card_declined error on some issuer flows. Missing the second
// form would silently misfile every SCA case as a plain decline — the single
// most damaging collapse in this function, since it converts "buyer needs to tap
// approve" into "buyer's card is bad".
func classifyChargeError(err error) (ChargeOutcome, error) {
	if err == nil {
		return ChargeOutcomeSucceeded, nil
	}

	// The platform never had an instrument — raised locally, before Stripe.
	if errors.Is(err, ErrNoPaymentInstrument) {
		return ChargeOutcomeNoPaymentMethod, err
	}

	var stripeErr *stripe.Error
	if !errors.As(err, &stripeErr) {
		// Not a Stripe API error at all (context deadline, transport failure).
		// Never attributable to the buyer.
		return ChargeOutcomeError, err
	}

	// SCA, in either of the two shapes Stripe reports it.
	if stripeErr.Code == stripe.ErrorCodeAuthenticationRequired ||
		stripeErr.DeclineCode == stripe.DeclineCodeAuthenticationRequired {
		return ChargeOutcomeAuthenticationRequired, fmt.Errorf("%w: %v", ErrAuthenticationRequired, stripeErr.Msg)
	}

	// A missing/detached/unusable payment method is a platform-side gap, not a
	// buyer default: we asked Stripe to charge something that is not there.
	switch stripeErr.Code {
	case stripe.ErrorCodePaymentMethodUnexpectedState,
		stripe.ErrorCodeResourceMissing:
		return ChargeOutcomeNoPaymentMethod, fmt.Errorf("%w: %v", ErrNoPaymentInstrument, stripeErr.Msg)
	}

	if stripeErr.Code == stripe.ErrorCodeCardDeclined {
		if stripeErr.DeclineCode == stripe.DeclineCodeInsufficientFunds {
			return ChargeOutcomeInsufficientFunds, fmt.Errorf("%w: %v", ErrInsufficientFunds, stripeErr.Msg)
		}
		return ChargeOutcomeCardDeclined, fmt.Errorf("%w (%s): %v", ErrCardDeclined, stripeErr.DeclineCode, stripeErr.Msg)
	}

	// Some issuer declines arrive with a decline code but a different top-level
	// code (e.g. ErrorCodeExpiredCard). Treat any decline code as a decline.
	if stripeErr.DeclineCode != "" {
		if stripeErr.DeclineCode == stripe.DeclineCodeInsufficientFunds {
			return ChargeOutcomeInsufficientFunds, fmt.Errorf("%w: %v", ErrInsufficientFunds, stripeErr.Msg)
		}
		return ChargeOutcomeCardDeclined, fmt.Errorf("%w (%s): %v", ErrCardDeclined, stripeErr.DeclineCode, stripeErr.Msg)
	}

	// Card-type errors Stripe raises without a decline code.
	switch stripeErr.Code {
	case stripe.ErrorCodeExpiredCard, stripe.ErrorCodeIncorrectCVC, stripe.ErrorCodeIncorrectNumber,
		stripe.ErrorCodeInvalidCVC, stripe.ErrorCodeInvalidExpiryMonth, stripe.ErrorCodeInvalidExpiryYear,
		stripe.ErrorCodeInvalidNumber, stripe.ErrorCodeProcessingError:
		return ChargeOutcomeCardDeclined, fmt.Errorf("%w (%s): %v", ErrCardDeclined, stripeErr.Code, stripeErr.Msg)
	}

	// Rate limits, API errors, auth errors: infrastructure. Fail closed by
	// reporting an error, but never blame the buyer.
	return ChargeOutcomeError, err
}

// classifyChargeStatus maps a SUCCESSFUL Stripe call's resulting PaymentIntent
// status onto an outcome.
//
// A confirm can return without error and still not have taken any money:
// "requires_action" is the non-error form of SCA (Stripe returns an error for
// off-session confirms, but the on-session/mixed paths and a re-read of the PI
// return the status instead). Treating a non-succeeded status as success would
// move an order to escrow 'held' on funds that were never captured — the single
// worst outcome available here, since the seller is then paid out of the
// platform's own balance. Everything that is not literally "succeeded" therefore
// fails closed.
func classifyChargeStatus(status string) ChargeOutcome {
	switch status {
	case string(stripe.PaymentIntentStatusSucceeded):
		return ChargeOutcomeSucceeded
	case string(stripe.PaymentIntentStatusRequiresAction),
		string(stripe.PaymentIntentStatusRequiresConfirmation):
		return ChargeOutcomeAuthenticationRequired
	case string(stripe.PaymentIntentStatusRequiresPaymentMethod):
		return ChargeOutcomeCardDeclined
	default:
		// processing, canceled, requires_capture, or anything Stripe adds later.
		return ChargeOutcomeError
	}
}
