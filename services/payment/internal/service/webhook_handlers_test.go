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

// fakeRecurringFailHook records PauseOnPaymentFailed invocations for FR-18.8 tests.
type fakeRecurringFailHook struct {
	calls []struct {
		contractID, customerID, instanceID, paymentID string
	}
	err error
}

func (f *fakeRecurringFailHook) PauseOnPaymentFailed(
	_ context.Context,
	contractID, customerID, recurringInstanceID, paymentID string,
) error {
	f.calls = append(f.calls, struct {
		contractID, customerID, instanceID, paymentID string
	}{contractID, customerID, recurringInstanceID, paymentID})
	return f.err
}

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

	// FR-16.7 + FR-18.8: recurring_instance_id payments record a strike (hook
	// owns increment + pause-at-threshold). Webhook only asserts the hook runs.
	t.Run("records_strike_when_instance_linked", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_failed_recurring_1", "payment_intent.payment_failed", stripe.PaymentIntent{
			ID: "pi_recurring_fail",
		})
		instanceID := "inst-42"
		hook := &fakeRecurringFailHook{}
		repo := &mockPaymentRepo{
			recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{
					ID:                  "pmt-rec-1",
					ContractID:          "ctr-1",
					CustomerID:          "cust-1",
					RecurringInstanceID: &instanceID,
					Status:              "processing",
				}, nil
			},
			updatePaymentStatusFn: func(_ context.Context, _, status string) error {
				assert.Equal(t, "failed", status)
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})
		svc.SetRecurringPaymentFailureHandler(hook)

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		require.Len(t, hook.calls, 1)
		assert.Equal(t, "ctr-1", hook.calls[0].contractID)
		assert.Equal(t, "cust-1", hook.calls[0].customerID)
		assert.Equal(t, "inst-42", hook.calls[0].instanceID)
		assert.Equal(t, "pmt-rec-1", hook.calls[0].paymentID)
	})

	t.Run("skips_pause_when_no_recurring_instance", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_failed_nonrec_1", "payment_intent.payment_failed", stripe.PaymentIntent{
			ID: "pi_plain_fail",
		})
		hook := &fakeRecurringFailHook{}
		repo := &mockPaymentRepo{
			recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{
					ID:         "pmt-plain",
					ContractID: "ctr-2",
					CustomerID: "cust-2",
					Status:     "processing",
				}, nil
			},
			updatePaymentStatusFn: func(_ context.Context, _, _ string) error { return nil },
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})
		svc.SetRecurringPaymentFailureHandler(hook)

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.Empty(t, hook.calls, "non-recurring payments must not trigger FR-16.7 strike")
	})

	t.Run("strike_error_is_fail_soft_webhook_still_acks", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_failed_recurring_soft", "payment_intent.payment_failed", stripe.PaymentIntent{
			ID: "pi_recurring_soft",
		})
		instanceID := "inst-soft"
		hook := &fakeRecurringFailHook{err: errors.New("job mesh down")}
		var statusUpdate string
		repo := &mockPaymentRepo{
			recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{
					ID:                  "pmt-soft",
					ContractID:          "ctr-soft",
					CustomerID:          "cust-soft",
					RecurringInstanceID: &instanceID,
					Status:              "processing",
				}, nil
			},
			updatePaymentStatusFn: func(_ context.Context, _, status string) error {
				statusUpdate = status
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})
		svc.SetRecurringPaymentFailureHandler(hook)

		// Fail-soft: pause error must NOT fail the webhook (Stripe would retry).
		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.Equal(t, "failed", statusUpdate)
		require.Len(t, hook.calls, 1)
	})

	t.Run("no_hook_still_marks_failed", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_failed_no_hook", "payment_intent.payment_failed", stripe.PaymentIntent{
			ID: "pi_no_hook",
		})
		instanceID := "inst-no-hook"
		var statusUpdate string
		repo := &mockPaymentRepo{
			recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{
					ID:                  "pmt-no-hook",
					ContractID:          "ctr-nh",
					CustomerID:          "cust-nh",
					RecurringInstanceID: &instanceID,
					Status:              "processing",
				}, nil
			},
			updatePaymentStatusFn: func(_ context.Context, _, status string) error {
				statusUpdate = status
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})
		// deliberately no SetRecurringPaymentFailureHandler

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.Equal(t, "failed", statusUpdate)
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

// --- charge.dispute.closed ---

func TestHandleWebhook_ChargeDisputeClosed(t *testing.T) {
	t.Parallel()

	t.Run("won_returns_payment_to_escrow_recoverable", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_dispclose_won", "charge.dispute.closed", stripe.Dispute{
			ID:            "dp_won",
			Status:        stripe.DisputeStatusWon,
			PaymentIntent: &stripe.PaymentIntent{ID: "pi_won"},
		})

		var statusUpdate string
		repo := &mockPaymentRepo{
			recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{ID: "pmt-1", Status: "disputed"}, nil
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
		// Back to escrow so the normal transfer.created -> released path can run.
		assert.Equal(t, "escrow", statusUpdate, "won dispute must un-freeze escrow so it is releasable")
	})

	t.Run("warning_closed_and_prevented_also_recover_escrow", func(t *testing.T) {
		t.Parallel()
		for _, ds := range []stripe.DisputeStatus{stripe.DisputeStatusWarningClosed, stripe.DisputeStatusPrevented} {
			ds := ds
			event := newEvent(t, "evt_dispclose_"+string(ds), "charge.dispute.closed", stripe.Dispute{
				ID:            "dp_" + string(ds),
				Status:        ds,
				PaymentIntent: &stripe.PaymentIntent{ID: "pi_" + string(ds)},
			})
			var statusUpdate string
			repo := &mockPaymentRepo{
				recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
				markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
				findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
					return &domain.Payment{ID: "pmt-1", Status: "disputed"}, nil
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
			assert.Equal(t, "escrow", statusUpdate, "early-warning close (%s) means no funds pulled, escrow recoverable", ds)
		}
	})

	t.Run("lost_marks_payment_charged_back_terminal", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_dispclose_lost", "charge.dispute.closed", stripe.Dispute{
			ID:            "dp_lost",
			Status:        stripe.DisputeStatusLost,
			PaymentIntent: &stripe.PaymentIntent{ID: "pi_lost"},
		})

		var statusUpdate string
		repo := &mockPaymentRepo{
			recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{ID: "pmt-1", Status: "disputed"}, nil
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
		assert.Equal(t, "chargeback", statusUpdate, "lost dispute is terminal: money left the platform")
	})

	t.Run("idempotent_no_op_when_not_disputed", func(t *testing.T) {
		t.Parallel()
		// A redelivered close finds the payment already moved out of 'disputed'.
		// We must not re-touch the state machine (no double-move of money state).
		for _, current := range []string{"escrow", "chargeback", "released", "completed"} {
			current := current
			event := newEvent(t, "evt_dispclose_dup_"+current, "charge.dispute.closed", stripe.Dispute{
				ID:            "dp_dup",
				Status:        stripe.DisputeStatusWon,
				PaymentIntent: &stripe.PaymentIntent{ID: "pi_dup"},
			})
			var updateCalled bool
			repo := &mockPaymentRepo{
				recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
				markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
				findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
					return &domain.Payment{ID: "pmt-1", Status: current}, nil
				},
				updatePaymentStatusFn: func(_ context.Context, _, _ string) error {
					updateCalled = true
					return nil
				},
			}
			svc := newTestPaymentService(repo, nil)
			svc.SetWebhookValidator(&fakeWebhookValidator{event: event})
			err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
			require.NoError(t, err)
			assert.False(t, updateCalled, "dispute.closed on a payment already in %q must be a no-op", current)
		}
	})

	t.Run("unknown_status_leaves_disputed_and_acks", func(t *testing.T) {
		t.Parallel()
		// A close event with a non-terminal/unknown status must not guess which
		// way money went — leave it frozen, ack so Stripe doesn't retry-storm.
		event := newEvent(t, "evt_dispclose_unknown", "charge.dispute.closed", stripe.Dispute{
			ID:            "dp_unknown",
			Status:        stripe.DisputeStatusUnderReview, // not won/lost/closed
			PaymentIntent: &stripe.PaymentIntent{ID: "pi_unknown"},
		})
		var updateCalled bool
		repo := &mockPaymentRepo{
			recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{ID: "pmt-1", Status: "disputed"}, nil
			},
			updatePaymentStatusFn: func(_ context.Context, _, _ string) error {
				updateCalled = true
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})
		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.False(t, updateCalled, "unknown dispute status must not move money state")
	})

	t.Run("noop_when_no_payment_intent_attached", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_dispclose_orphan", "charge.dispute.closed", stripe.Dispute{
			ID:     "dp_orphan",
			Status: stripe.DisputeStatusWon,
		})
		var findCalled bool
		repo := &mockPaymentRepo{
			recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
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

	t.Run("fail_safe_when_payment_not_found", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_dispclose_miss", "charge.dispute.closed", stripe.Dispute{
			ID:            "dp_miss",
			Status:        stripe.DisputeStatusLost,
			PaymentIntent: &stripe.PaymentIntent{ID: "pi_miss"},
		})
		var updateCalled bool
		repo := &mockPaymentRepo{
			recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
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
		require.NoError(t, err, "record-not-found must be acked, not retried")
		assert.False(t, updateCalled)
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
		var updateRefundCalled bool
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{ID: "pmt-1", AmountCents: 50000, Status: "released"}, nil
			},
			confirmRefundFromWebhookFn: func(_ context.Context, _ string, amt int64, _ string, _ time.Time, refundID, status string) error {
				capturedAmount = amt
				capturedStatus = status
				capturedRefundID = refundID
				return nil
			},
			updateRefundFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _, _ string) error {
				updateRefundCalled = true
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
		assert.False(t, updateRefundCalled, "charge.refunded must not call unconditional UpdateRefund")
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
			confirmRefundFromWebhookFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _, status string) error {
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

	t.Run("skips_empty_refund_id_and_uses_first_re_prefix", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_ref_id_scan", "charge.refunded", stripe.Charge{
			ID:             "ch_scan",
			Amount:         50000,
			AmountRefunded: 50000,
			PaymentIntent:  &stripe.PaymentIntent{ID: "pi_scan"},
			Refunds: &stripe.RefundList{
				Data: []*stripe.Refund{{ID: ""}, {ID: "re_real"}},
			},
		})

		var capturedRefundID string
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{ID: "pmt-1", AmountCents: 50000, Status: "released"}, nil
			},
			confirmRefundFromWebhookFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, refundID, _ string) error {
				capturedRefundID = refundID
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.Equal(t, "re_real", capturedRefundID)
	})

	t.Run("monotonic_increase_confirms_higher_total", func(t *testing.T) {
		t.Parallel()
		event := newEvent(t, "evt_ref_mono", "charge.refunded", stripe.Charge{
			ID:             "ch_mono",
			Amount:         50000,
			AmountRefunded: 35000,
			PaymentIntent:  &stripe.PaymentIntent{ID: "pi_mono"},
			Refunds: &stripe.RefundList{
				Data: []*stripe.Refund{{ID: "re_second"}},
			},
		})

		var capturedAmount int64
		var capturedRefundID string
		var capturedStatus string
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return &domain.Payment{
					ID:                "pmt-1",
					AmountCents:       50000,
					RefundAmountCents: 20000,
					StripeRefundID:    "re_first",
					Status:            "partially_refunded",
				}, nil
			},
			confirmRefundFromWebhookFn: func(_ context.Context, _ string, amt int64, _ string, _ time.Time, refundID, status string) error {
				capturedAmount = amt
				capturedRefundID = refundID
				capturedStatus = status
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.Equal(t, int64(35000), capturedAmount)
		assert.Equal(t, "re_second", capturedRefundID)
		assert.Equal(t, "partially_refunded", capturedStatus)
	})

	t.Run("pending_claim_keeps_pending_id", func(t *testing.T) {
		t.Parallel()
		pendingKey := "pending:escrow:0:50000:-"
		payment := &domain.Payment{
			ID:                "pmt-1",
			AmountCents:       50000,
			RefundAmountCents: 50000,
			StripeRefundID:    pendingKey,
			Status:            "refunded",
		}
		event := newEvent(t, "evt_ref_pending", "charge.refunded", stripe.Charge{
			ID:             "ch_pending",
			Amount:         50000,
			AmountRefunded: 20000, // smaller than the in-flight claim
			PaymentIntent:  &stripe.PaymentIntent{ID: "pi_pending"},
			Refunds: &stripe.RefundList{
				Data: []*stripe.Refund{{ID: "re_dashboard"}},
			},
		})

		var confirmCalled, updateCalled, stampCalled bool
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return payment, nil
			},
			confirmRefundFromWebhookFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _, _ string) error {
				confirmCalled = true
				return nil
			},
			updateRefundFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _, _ string) error {
				updateCalled = true
				return nil
			},
			stampRefundIDFn: func(_ context.Context, _, _, _ string) error {
				stampCalled = true
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.Equal(t, pendingKey, payment.StripeRefundID, "in-flight CreateRefund claim must keep pending id")
		assert.Equal(t, int64(50000), payment.RefundAmountCents, "claimed cents must not shrink")
		assert.False(t, confirmCalled, "must not confirm over a pending: claim")
		assert.False(t, updateCalled, "must not call unconditional UpdateRefund")
		assert.False(t, stampCalled, "must not stamp when webhook amount is below the claim")
	})

	t.Run("pending_claim_may_stamp_re_id_without_changing_cents", func(t *testing.T) {
		t.Parallel()
		pendingKey := "pending:escrow:0:50000:-"
		payment := &domain.Payment{
			ID:                "pmt-1",
			AmountCents:       50000,
			RefundAmountCents: 50000,
			StripeRefundID:    pendingKey,
			Status:            "refunded",
		}
		event := newEvent(t, "evt_ref_pending_stamp", "charge.refunded", stripe.Charge{
			ID:             "ch_pending_stamp",
			Amount:         50000,
			AmountRefunded: 50000,
			PaymentIntent:  &stripe.PaymentIntent{ID: "pi_pending_stamp"},
			Refunds: &stripe.RefundList{
				Data: []*stripe.Refund{{ID: "re_live"}},
			},
		})

		var stampedPending, stampedRefundID string
		var confirmCalled, updateCalled bool
		repo := &mockPaymentRepo{
			recordStripeEventStartFn: func(_ context.Context, _, _ string) (bool, error) { return false, nil },
			markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			findByStripePIFn: func(_ context.Context, _ string) (*domain.Payment, error) {
				return payment, nil
			},
			stampRefundIDFn: func(_ context.Context, _, pending, refundID string) error {
				stampedPending = pending
				stampedRefundID = refundID
				return nil
			},
			confirmRefundFromWebhookFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _, _ string) error {
				confirmCalled = true
				return nil
			},
			updateRefundFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _, _ string) error {
				updateCalled = true
				return nil
			},
		}
		svc := newTestPaymentService(repo, nil)
		svc.SetWebhookValidator(&fakeWebhookValidator{event: event})

		err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
		require.NoError(t, err)
		assert.Equal(t, pendingKey, stampedPending)
		assert.Equal(t, "re_live", stampedRefundID)
		assert.Equal(t, int64(50000), payment.RefundAmountCents, "stamp must not change claimed cents")
		assert.False(t, confirmCalled)
		assert.False(t, updateCalled)
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
			confirmRefundFromWebhookFn: func(_ context.Context, _ string, _ int64, _ string, _ time.Time, _, _ string) error {
				refundCalled = true
				return nil
			},
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

// --- marketplace payment_intent.succeeded fail-safe ---

// fakeMarketplaceHook lets a test control what HandleListingPaymentIntentSucceeded returns.
type fakeMarketplaceHook struct {
	err    error
	called bool
}

func (f *fakeMarketplaceHook) HandleListingPaymentIntentSucceeded(_ context.Context, _ string) error {
	f.called = true
	return f.err
}

func TestHandleWebhook_MarketplacePI_FailsSafeOnMiss(t *testing.T) {
	t.Parallel()

	marketplacePI := func(id string) stripe.Event {
		return newEvent(t, "evt_"+id, "payment_intent.succeeded", stripe.PaymentIntent{
			ID:       id,
			Metadata: map[string]string{"marketplace_flow": "goods-v1", "listing_order_id": "ord_1"},
		})
	}

	cases := []struct {
		name      string
		hookErr   error
		wantError bool
	}{
		// A missing order or an unexpected escrow state must be acked (nil) so
		// Stripe doesn't retry-storm for 3 days on a non-retryable condition.
		{"not_found_is_acked", ErrListingOrderNotFound, false},
		{"invalid_state_is_acked", ErrInvalidEscrowState, false},
		// A genuine infra error must still surface so Stripe retries.
		{"infra_error_is_retried", errors.New("db connection lost"), true},
		// Success acks.
		{"success_is_acked", nil, false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			repo := &mockPaymentRepo{
				recordStripeEventStartFn:   func(_ context.Context, _, _ string) (bool, error) { return false, nil },
				markStripeEventProcessedFn: func(_ context.Context, _ string) error { return nil },
			}
			svc := newTestPaymentService(repo, nil)
			hook := &fakeMarketplaceHook{err: tc.hookErr}
			svc.SetMarketplaceHandler(hook)
			svc.SetWebhookValidator(&fakeWebhookValidator{event: marketplacePI("pi_mkt")})

			err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
			assert.True(t, hook.called, "marketplace hook should be invoked for goods-v1 PI")
			if tc.wantError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
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
