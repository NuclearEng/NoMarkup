package service

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

// TestClassifyChargeError_DistinctOutcomes is the regression guard for the
// collapse this file exists to prevent.
//
// Every row is a real Stripe failure shape. The assertion is not merely that
// each maps to *an* outcome, but that the four consequential ones map to FOUR
// DIFFERENT outcomes with different downstream policy (who is at fault, whether
// to retry, what the buyer is told). A change that merges any two of these rows
// is a bug even if every test still "passes" at the error level.
func TestClassifyChargeError_DistinctOutcomes(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		err         error
		wantOutcome ChargeOutcome
		wantSentinel error
		wantBuyerFault bool
		wantRetryable  bool
	}{
		{
			name:           "nil_is_success",
			err:            nil,
			wantOutcome:    ChargeOutcomeSucceeded,
			wantBuyerFault: false,
			wantRetryable:  false,
		},
		{
			name:           "no_instrument_raised_locally",
			err:            fmt.Errorf("resolve buyer instrument: %w", ErrNoPaymentInstrument),
			wantOutcome:    ChargeOutcomeNoPaymentMethod,
			wantSentinel:   ErrNoPaymentInstrument,
			wantBuyerFault: false, // platform never collected a card
			wantRetryable:  false,
		},
		{
			name: "sca_as_top_level_code",
			err: &stripe.Error{
				Code: stripe.ErrorCodeAuthenticationRequired,
				Msg:  "The payment requires authentication",
			},
			wantOutcome:    ChargeOutcomeAuthenticationRequired,
			wantSentinel:   ErrAuthenticationRequired,
			wantBuyerFault: true,
			wantRetryable:  false, // off-session retry can NEVER satisfy 3DS
		},
		{
			name: "sca_as_decline_code_under_card_declined",
			err: &stripe.Error{
				Code:        stripe.ErrorCodeCardDeclined,
				DeclineCode: stripe.DeclineCodeAuthenticationRequired,
				Msg:         "Your card was declined. This transaction requires authentication.",
			},
			// The most damaging possible misfile: this shape must NOT become a
			// plain decline, or "tap approve in your bank app" turns into "your
			// card is bad".
			wantOutcome:    ChargeOutcomeAuthenticationRequired,
			wantSentinel:   ErrAuthenticationRequired,
			wantBuyerFault: true,
			wantRetryable:  false,
		},
		{
			name: "insufficient_funds",
			err: &stripe.Error{
				Code:        stripe.ErrorCodeCardDeclined,
				DeclineCode: stripe.DeclineCodeInsufficientFunds,
				Msg:         "Your card has insufficient funds.",
			},
			wantOutcome:    ChargeOutcomeInsufficientFunds,
			wantSentinel:   ErrInsufficientFunds,
			wantBuyerFault: true,
			wantRetryable:  true, // the same card may work later
		},
		{
			name: "generic_decline",
			err: &stripe.Error{
				Code:        stripe.ErrorCodeCardDeclined,
				DeclineCode: stripe.DeclineCodeGenericDecline,
				Msg:         "Your card was declined.",
			},
			wantOutcome:    ChargeOutcomeCardDeclined,
			wantSentinel:   ErrCardDeclined,
			wantBuyerFault: true,
			wantRetryable:  true,
		},
		{
			name: "stolen_card_is_a_decline",
			err: &stripe.Error{
				Code:        stripe.ErrorCodeCardDeclined,
				DeclineCode: stripe.DeclineCodeStolenCard,
				Msg:         "Your card was declined.",
			},
			wantOutcome:    ChargeOutcomeCardDeclined,
			wantSentinel:   ErrCardDeclined,
			wantBuyerFault: true,
			wantRetryable:  true,
		},
		{
			name: "expired_card_without_decline_code",
			err: &stripe.Error{
				Code: stripe.ErrorCodeExpiredCard,
				Msg:  "Your card has expired.",
			},
			wantOutcome:    ChargeOutcomeCardDeclined,
			wantSentinel:   ErrCardDeclined,
			wantBuyerFault: true,
			wantRetryable:  true,
		},
		{
			name: "missing_payment_method_is_a_platform_gap_not_a_decline",
			err: &stripe.Error{
				Code: stripe.ErrorCodeResourceMissing,
				Msg:  "No such PaymentMethod: pm_gone",
			},
			wantOutcome:    ChargeOutcomeNoPaymentMethod,
			wantSentinel:   ErrNoPaymentInstrument,
			wantBuyerFault: false,
			wantRetryable:  false,
		},
		{
			name: "stripe_api_error_is_infrastructure_not_a_payment_failure",
			err: &stripe.Error{
				Type: stripe.ErrorTypeAPI,
				Msg:  "An unexpected error occurred",
			},
			wantOutcome:    ChargeOutcomeError,
			wantBuyerFault: false, // must never count against the buyer
			wantRetryable:  true,
		},
		{
			name:           "transport_error_is_infrastructure",
			err:            errors.New("context deadline exceeded"),
			wantOutcome:    ChargeOutcomeError,
			wantBuyerFault: false,
			wantRetryable:  true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, wrapped := classifyChargeError(tc.err)
			assert.Equal(t, tc.wantOutcome, got)

			if tc.wantSentinel != nil {
				require.Error(t, wrapped)
				assert.ErrorIs(t, wrapped, tc.wantSentinel,
					"callers branch on this sentinel with errors.Is")
			}
			assert.Equal(t, tc.wantBuyerFault, got.AttributableToBuyer(),
				"whether this consumes the buyer's payment deadline")
			assert.Equal(t, tc.wantRetryable, got.Retryable(),
				"whether an identical off-session retry could succeed")
			assert.NotEmpty(t, got.BuyerMessage())
		})
	}
}

// TestChargeOutcomes_AreMutuallyDistinct proves the four consequential failure
// modes really are four values, not aliases, and that each yields distinct
// buyer-facing guidance.
func TestChargeOutcomes_AreMutuallyDistinct(t *testing.T) {
	t.Parallel()

	outcomes := []ChargeOutcome{
		ChargeOutcomeNoPaymentMethod,
		ChargeOutcomeAuthenticationRequired,
		ChargeOutcomeInsufficientFunds,
		ChargeOutcomeCardDeclined,
	}

	seenValue := map[ChargeOutcome]bool{}
	seenMessage := map[string]ChargeOutcome{}
	for _, o := range outcomes {
		require.False(t, seenValue[o], "outcome %q duplicated", o)
		seenValue[o] = true

		msg := o.BuyerMessage()
		if prior, dup := seenMessage[msg]; dup {
			t.Fatalf("outcomes %q and %q give the buyer identical guidance; they need different actions", prior, o)
		}
		seenMessage[msg] = o
	}
}

// TestClassifyChargeStatus_FailsClosedOnAnythingButSucceeded: a PaymentIntent
// that did not literally succeed must never be treated as payment. Getting this
// wrong moves an order to escrow 'held' on money that was never captured, and
// the seller is then paid out of the platform's own balance.
func TestClassifyChargeStatus_FailsClosedOnAnythingButSucceeded(t *testing.T) {
	t.Parallel()

	tests := []struct {
		status string
		want   ChargeOutcome
	}{
		{string(stripe.PaymentIntentStatusSucceeded), ChargeOutcomeSucceeded},
		{string(stripe.PaymentIntentStatusRequiresAction), ChargeOutcomeAuthenticationRequired},
		{string(stripe.PaymentIntentStatusRequiresConfirmation), ChargeOutcomeAuthenticationRequired},
		{string(stripe.PaymentIntentStatusRequiresPaymentMethod), ChargeOutcomeCardDeclined},
		{string(stripe.PaymentIntentStatusProcessing), ChargeOutcomeError},
		{string(stripe.PaymentIntentStatusCanceled), ChargeOutcomeError},
		{string(stripe.PaymentIntentStatusRequiresCapture), ChargeOutcomeError},
		{"some_status_stripe_adds_in_2029", ChargeOutcomeError},
		{"", ChargeOutcomeError},
	}

	for _, tc := range tests {
		t.Run(tc.status, func(t *testing.T) {
			t.Parallel()
			got := classifyChargeStatus(tc.status)
			assert.Equal(t, tc.want, got)
			if tc.status != string(stripe.PaymentIntentStatusSucceeded) {
				assert.NotEqual(t, ChargeOutcomeSucceeded, got,
					"only a literal 'succeeded' may fund escrow")
			}
		})
	}
}

// TestConfirmOffSessionPaymentIntent_RequiresAnExplicitInstrument: confirming
// with no payment method must fail closed rather than let Stripe pick.
func TestConfirmOffSessionPaymentIntent_RequiresAnExplicitInstrument(t *testing.T) {
	t.Parallel()
	ss := &StripeService{devMode: true}

	_, err := ss.ConfirmOffSessionPaymentIntent(context.Background(), "pi_1", "", "idem-1")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNoPaymentInstrument)

	_, err = ss.ConfirmOffSessionPaymentIntent(context.Background(), "pi_1", "pm_1", "")
	require.Error(t, err, "a mutating charge without a deterministic idempotency key is refused")
}

// TestConfirmOffSessionPaymentIntent_IdempotencyKeyReplaysOriginalOutcome
// documents why the production key must be ATTEMPT-scoped rather than
// order-scoped: Stripe replays the original result for a reused key, so an
// order-scoped key would replay a decline forever and a buyer who fixed their
// card could never pay.
func TestConfirmOffSessionPaymentIntent_IdempotencyKeyReplaysOriginalOutcome(t *testing.T) {
	t.Parallel()
	ss := &StripeService{devMode: true}
	store := ss.DevStore()
	store.RecordPaymentIntent("pi_1", "cus_1", 1000)

	declined := &stripe.Error{Code: stripe.ErrorCodeCardDeclined, DeclineCode: stripe.DeclineCodeInsufficientFunds}
	store.SetDeclineRule("pm_1", declined)

	_, err := ss.ConfirmOffSessionPaymentIntent(context.Background(), "pi_1", "pm_1", "attempt-1")
	require.Error(t, err)

	// The buyer tops up: the rule is cleared.
	store.SetDeclineRule("pm_1", nil)

	// Same key -> Stripe replays the DECLINE.
	_, err = ss.ConfirmOffSessionPaymentIntent(context.Background(), "pi_1", "pm_1", "attempt-1")
	require.Error(t, err, "a replayed key returns the cached failure, which is exactly why attempt-scoping is required")

	// New attempt key -> a real retry, which now succeeds.
	status, err := ss.ConfirmOffSessionPaymentIntent(context.Background(), "pi_1", "pm_1", "attempt-2")
	require.NoError(t, err)
	assert.Equal(t, "succeeded", status)
}
