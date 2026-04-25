package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

// These tests exercise the per-event-type webhook handlers. They use the same
// fakeWebhookValidator pattern as webhook_test.go but route through HandleWebhook
// to also exercise the dedup + signature paths.

// helper: build a Stripe event with the given type + raw JSON data.
func newEvent(t *testing.T, eventID, eventType string, payload any) stripe.Event {
	t.Helper()
	raw, err := json.Marshal(payload)
	require.NoError(t, err)
	return stripe.Event{
		ID:   eventID,
		Type: stripe.EventType(eventType),
		Data: &stripe.EventData{Raw: raw},
	}
}

// --- payment_intent.payment_failed ---

func TestHandleWebhook_PaymentIntentFailed(t *testing.T) {
	t.Parallel()

	t.Run("flips_status_to_failed", func(t *testing.T) {
		t.Parallel()
		// LastPaymentError nesting changed across stripe-go versions; the
		// handler accesses .LastPaymentError.Msg with nil-guards, so passing
		// nil here exercises the same code path with the safer fallback.
		event := newEvent(t, "evt_failed_1", "payment_intent.payment_failed", stripe.PaymentIntent{
			ID: "pi_failed",
		})

		var statusUpdate string
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{ID: "pmt-1", Status: "processing"}, nil
			},
			updatePaymentStatusFn: func(_ context.Context, _, status string) error {
				statusUpdate = status
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.Equal(t, "failed", statusUpdate)
	})

	t.Run("noop_when_payment_unknown", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_failed_2", "payment_intent.payment_failed", stripe.PaymentIntent{ID: "pi_unknown"})

		var updateCalled bool
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return nil, errors.New("not found")
			},
			updatePaymentStatusFn: func(_ context.Context, _, _ string) error {
				updateCalled = true
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err, "unknown payment should not fail the webhook (Stripe should not retry)")
		assert.False(t, updateCalled)
	})
}

// --- charge.dispute.created ---

func TestHandleWebhook_ChargeDisputeCreated(t *testing.T) {
	t.Parallel()

	t.Run("flips_status_to_disputed", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_disp_1", "charge.dispute.created", stripe.Dispute{
			ID:            "dp_1",
			PaymentIntent: &stripe.PaymentIntent{ID: "pi_disputed"},
		})

		var statusUpdate string
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{ID: "pmt-1", Status: "released"}, nil
			},
			updatePaymentStatusFn: func(_ context.Context, _, status string) error {
				statusUpdate = status
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.Equal(t, "disputed", statusUpdate)
	})

	t.Run("noop_when_no_payment_intent_attached", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_disp_2", "charge.dispute.created", stripe.Dispute{
			ID: "dp_orphan",
			// No PaymentIntent — should be skipped without error.
		})

		var findCalled bool
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				findCalled = true
				return nil, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.False(t, findCalled, "dispute without payment_intent must not trigger a lookup")
	})
}

// --- transfer.created ---

func TestHandleWebhook_TransferCreated(t *testing.T) {
	t.Parallel()

	t.Run("releases_payment_in_escrow", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_xfer_1", "transfer.created", stripe.Transfer{
			ID: "tr_1",
			Metadata: map[string]string{
				"payment_intent_id": "pi_xyz",
			},
		})

		var statusUpdate string
		var transferIDStored string
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{ID: "pmt-1", Status: "escrow"}, nil
			},
			updateStripeFieldsFn: func(_ context.Context, _, _, _, transferID string) error {
				transferIDStored = transferID
				return nil
			},
			updatePaymentStatusFn: func(_ context.Context, _, status string) error {
				statusUpdate = status
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.Equal(t, "tr_1", transferIDStored)
		assert.Equal(t, "released", statusUpdate)
	})

	t.Run("noop_when_no_metadata", func(t *testing.T) {
		t.Parallel()
		// Transfer without payment_intent_id metadata is something Stripe sends
		// for non-application transfers; we don't try to map it to a payment.
		event := newEvent(t, "evt_xfer_2", "transfer.created", stripe.Transfer{ID: "tr_orphan"})

		var findCalled bool
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				findCalled = true
				return nil, nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.False(t, findCalled)
	})

	t.Run("does_not_re_release_already_released_payment", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_xfer_3", "transfer.created", stripe.Transfer{
			ID:       "tr_dup",
			Metadata: map[string]string{"payment_intent_id": "pi_dup"},
		})

		var statusUpdated bool
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{ID: "pmt-1", Status: "released"}, nil
			},
			updateStripeFieldsFn: func(_ context.Context, _, _, _, _ string) error { return nil },
			updatePaymentStatusFn: func(_ context.Context, _, _ string) error {
				statusUpdated = true
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.False(t, statusUpdated, "transfer.created on an already-released payment must not re-trigger a status update")
	})
}

// --- charge.refunded ---

func TestHandleWebhook_ChargeRefunded(t *testing.T) {
	t.Parallel()

	t.Run("full_refund_flips_status_to_refunded", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_ref_1", "charge.refunded", stripe.Charge{
			ID:             "ch_1",
			Amount:         50000,
			AmountRefunded: 50000,
			PaymentIntent:  &stripe.PaymentIntent{ID: "pi_full_refund"},
			Refunds: &stripe.RefundList{
				Data: []*stripe.Refund{{ID: "re_1"}},
			},
		})

		var capturedAmount int64
		var capturedStatus string
		var capturedRefundID string
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{ID: "pmt-1", AmountCents: 50000, Status: "released"}, nil
			},
			updateRefundFn: func(_ context.Context, _ string, amt int64, _ string, _ time.Time, refundID, status string) error {
				capturedAmount = amt
				capturedStatus = status
				capturedRefundID = refundID
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.Equal(t, int64(50000), capturedAmount)
		assert.Equal(t, "refunded", capturedStatus)
		assert.Equal(t, "re_1", capturedRefundID)
	})

	t.Run("partial_refund_flips_status_to_partially_refunded", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_ref_2", "charge.refunded", stripe.Charge{
			ID:             "ch_2",
			Amount:         50000,
			AmountRefunded: 20000, // partial
			PaymentIntent:  &stripe.PaymentIntent{ID: "pi_partial_refund"},
		})

		var capturedStatus string
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{ID: "pmt-1", AmountCents: 50000, Status: "released"}, nil
			},
			updateRefundFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _, status string) error {
				capturedStatus = status
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.Equal(t, "partially_refunded", capturedStatus)
	})

	t.Run("noop_when_no_payment_intent_attached", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_ref_3", "charge.refunded", stripe.Charge{
			ID:             "ch_orphan",
			AmountRefunded: 100,
		})

		var refundCalled bool
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			updateRefundFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _, _ string) error {
				refundCalled = true
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.False(t, refundCalled)
	})
}

// --- subscription event delegation (no handler set) ---

func TestHandleWebhook_SubscriptionEvent_NoHandler_NoOp(t *testing.T) {
	t.Parallel()
	// When no subscription handler is wired, the service should log + return nil
	// rather than fail the webhook (Stripe would otherwise retry forever).
	event := newEvent(t, "evt_sub_1", "customer.subscription.updated", map[string]any{
		"id": "sub_x", "subscription": "sub_x",
	})

	repo := &mockPaymentRepo{
		recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
		markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
	}
	svc := newTestPaymentService(repo, nil)
	svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

	// Note: subHook is not set on this svc — handleSubscriptionEvent should noop.
	err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
	require.NoError(t, err)
}

// --- record-stripe-event repo error ---

func TestHandleWebhook_RecordEvent_DBError(t *testing.T) {
	t.Parallel()
	event := newEvent(t, "evt_db_err", "payment_intent.succeeded", stripe.PaymentIntent{ID: "pi_x"})
	repo := &mockPaymentRepo{
		recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) {
			return false, errors.New("db unreachable")
		},
	}
	svc := newTestPaymentService(repo, nil)
	svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

	err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "db unreachable")
}

// --- StripeWebhookValidator constructor + bad signature ---

func TestStripeWebhookValidator_RejectsBadSignature(t *testing.T) {
	t.Parallel()
	v := NewStripeWebhookValidator("whsec_test_secret")
	_, err := v.ConstructEvent([]byte(`{"id":"evt_x"}`), "t=1234567890,v1=invalid")
	require.Error(t, err, "real validator must reject a forged signature")
}
