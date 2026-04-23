package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

// fakeWebhookValidator lets tests inject a deterministic stripe.Event without
// going anywhere near STRIPE_WEBHOOK_SECRET or the real HMAC verifier.
type fakeWebhookValidator struct {
	event stripe.Event
	err   error
}

func (f *fakeWebhookValidator) ConstructEvent(_ []byte, _ string) (stripe.Event, error) {
	return f.event, f.err
}

// TestHandleWebhook_no_validator_fails_closed ensures that if no validator has
// been configured, the handler refuses to process the event rather than
// silently parsing unsigned payloads. This is the regression guard for the
// "env-based signature bypass" security finding.
func TestHandleWebhook_no_validator_fails_closed(t *testing.T) {
	t.Parallel()

	svc := newTestPaymentService(&mockPaymentRepo{}, nil)
	// Deliberately do NOT call SetWebhookValidator.

	err := svc.HandleWebhook(context.Background(), []byte(`{"id":"evt_forged","type":"payment_intent.succeeded"}`), "sig")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "webhook validator not configured")
}

// TestHandleWebhook_signature_failure_rejected ensures signature verification
// errors propagate out and the event is not dispatched to any handler.
func TestHandleWebhook_signature_failure_rejected(t *testing.T) {
	t.Parallel()

	dispatched := false
	repo := &mockPaymentRepo{
		recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) {
			dispatched = true
			return false, nil
		},
	}
	svc := newTestPaymentService(repo, nil)
	svc.SetWebhookValidator(&fakeWebhookValidator{err: errors.New("bad signature")})

	err := svc.HandleWebhook(context.Background(), []byte(`{}`), "bogus")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "webhook signature verification failed")
	assert.False(t, dispatched, "forged event must not be recorded or dispatched")
}

// TestHandleWebhook_dedup_skips_duplicate_event verifies that a second
// delivery of the same Stripe event.id is not re-dispatched to handlers,
// which would otherwise double-apply side effects like escrow release.
func TestHandleWebhook_dedup_skips_duplicate_event(t *testing.T) {
	t.Parallel()

	// Build a minimal payment_intent.succeeded event; the handler would
	// normally look up the payment and flip status to escrow, so if we're
	// correctly deduping, the repo.FindByStripePaymentIntentID should never
	// be called on the second delivery.
	piJSON, err := json.Marshal(stripe.PaymentIntent{ID: "pi_1"})
	require.NoError(t, err)

	event := stripe.Event{
		ID:   "evt_abc",
		Type: "payment_intent.succeeded",
	}
	event.Data = &stripe.EventData{Raw: piJSON}

	var findCalled int
	repo := &mockPaymentRepo{
		recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) {
			// Report "already processed" — simulates a duplicate delivery.
			return true, nil
		},
		findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
			findCalled++
			return nil, nil
		},
	}
	svc := newTestPaymentService(repo, nil)
	svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

	err = svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
	require.NoError(t, err)
	assert.Zero(t, findCalled, "duplicate event must not re-trigger handler logic")
}

// TestHandleWebhook_first_delivery_marks_processed verifies the happy path:
// event is recorded, handler runs, and processed_at is stamped.
func TestHandleWebhook_first_delivery_marks_processed(t *testing.T) {
	t.Parallel()

	piJSON, err := json.Marshal(stripe.PaymentIntent{ID: "pi_1"})
	require.NoError(t, err)

	event := stripe.Event{
		ID:   "evt_xyz",
		Type: "payment_intent.succeeded",
	}
	event.Data = &stripe.EventData{Raw: piJSON}

	var markedID string
	var recorded bool
	repo := &mockPaymentRepo{
		recordStripeEventStartFn: func(_ context.Context, id, _ string) (bool, error) {
			recorded = true
			assert.Equal(t, "evt_xyz", id)
			return false, nil // not a duplicate
		},
		markStripeEventProcessedFn: func(_ context.Context, id string) error {
			markedID = id
			return nil
		},
		findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
			// Return an "unknown payment" — handler treats it as a no-op and
			// returns nil, which is fine for the dedup-path test.
			return nil, errors.New("not found")
		},
	}
	svc := newTestPaymentService(repo, nil)
	svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

	err = svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
	require.NoError(t, err)
	assert.True(t, recorded, "event should be recorded before dispatch")
	assert.Equal(t, "evt_xyz", markedID, "event should be marked processed after dispatch")
}
