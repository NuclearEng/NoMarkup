package service

// These tests exercise the metric recorders around HandleWebhook. They never
// bypass signature verification: HandleWebhook always runs its validator, whose
// production implementation is stripe.webhooks.constructEvent(). The fake
// validator declared in webhook_test.go stands in for that call so a test can
// assert on deterministic events without STRIPE_WEBHOOK_SECRET.

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

// sampleCountFor returns the histogram sample count for one label combination,
// read back through the default Prometheus gatherer. Going through the registry
// rather than the unexported collector is deliberate: it proves the metric is
// reachable on /metrics, which is exactly what the old package-main
// declaration was not.
func sampleCountFor(t *testing.T, name string, want map[string]string) uint64 {
	t.Helper()

	families, err := prometheus.DefaultGatherer.Gather()
	require.NoError(t, err)

	for _, family := range families {
		if family.GetName() != name {
			continue
		}
		for _, metric := range family.GetMetric() {
			labels := map[string]string{}
			for _, label := range metric.GetLabel() {
				labels[label.GetName()] = label.GetValue()
			}
			match := true
			for k, v := range want {
				if labels[k] != v {
					match = false
					break
				}
			}
			if match && metric.GetHistogram() != nil {
				return metric.GetHistogram().GetSampleCount()
			}
		}
	}
	return 0
}

// TestHandleWebhookRecordsProcessingMetric is the regression guard for the dead
// ObserveStripeWebhook recorder: it used to live in package main with zero call
// sites, so stripe_webhook_processing_duration_seconds exported nothing and a
// failing event stream was invisible.
//
// Each subtest drives HandleWebhook down a distinct exit path and asserts the
// corresponding outcome label gained an observation.
func TestHandleWebhookRecordsProcessingMetric(t *testing.T) {
	const metric = "stripe_webhook_processing_duration_seconds"

	piJSON, err := json.Marshal(stripe.PaymentIntent{ID: "pi_metrics"})
	require.NoError(t, err)

	succeeded := stripe.Event{
		ID:      "evt_metrics_1",
		Type:    "payment_intent.succeeded",
		Created: time.Now().Add(-3 * time.Second).Unix(),
		Data:    &stripe.EventData{Raw: piJSON},
	}

	for _, tc := range []struct {
		name        string
		eventType   string
		wantOutcome string
		setup       func() *PaymentService
		wantErr     bool
	}{
		{
			name:        "no validator",
			eventType:   "unknown",
			wantOutcome: "not_configured",
			wantErr:     true,
			setup: func() *PaymentService {
				return newTestPaymentService(&mockPaymentRepo{}, nil)
			},
		},
		{
			name:        "signature rejected",
			eventType:   "unknown",
			wantOutcome: "signature_failed",
			wantErr:     true,
			setup: func() *PaymentService {
				svc := newTestPaymentService(&mockPaymentRepo{}, nil)
				svc.SetWebhookValidator(&fakeWebhookValidator{err: errors.New("bad signature")})
				return svc
			},
		},
		{
			name:        "duplicate redelivery",
			eventType:   "payment_intent.succeeded",
			wantOutcome: "duplicate",
			setup: func() *PaymentService {
				repo := &mockPaymentRepo{
					recordStripeEventStartFn: func(context.Context, string, string) (bool, error) {
						return true, nil
					},
				}
				svc := newTestPaymentService(repo, nil)
				svc.SetWebhookValidator(&fakeWebhookValidator{event: succeeded})
				return svc
			},
		},
		{
			name:        "dedup write fails",
			eventType:   "payment_intent.succeeded",
			wantOutcome: "processing_error",
			wantErr:     true,
			setup: func() *PaymentService {
				repo := &mockPaymentRepo{
					recordStripeEventStartFn: func(context.Context, string, string) (bool, error) {
						return false, errors.New("db down")
					},
				}
				svc := newTestPaymentService(repo, nil)
				svc.SetWebhookValidator(&fakeWebhookValidator{event: succeeded})
				return svc
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			labels := map[string]string{"event_type": tc.eventType, "outcome": tc.wantOutcome}
			before := sampleCountFor(t, metric, labels)

			svc := tc.setup()
			err := svc.HandleWebhook(context.Background(), []byte(`{}`), "sig")
			if tc.wantErr {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}

			after := sampleCountFor(t, metric, labels)
			assert.Equal(t, before+1, after,
				"%s{event_type=%s,outcome=%s} did not gain an observation",
				metric, tc.eventType, tc.wantOutcome)
		})
	}
}

// TestHandleWebhookRecordsEventLag proves the backlog signal is wired: an event
// Stripe created well in the past must be recorded, which is what distinguishes
// "we are slow" from "deliveries are queued behind us".
func TestHandleWebhookRecordsEventLag(t *testing.T) {
	const metric = "stripe_webhook_event_lag_seconds"
	const eventType = "account.updated"

	acctJSON, err := json.Marshal(stripe.Account{ID: "acct_lag"})
	require.NoError(t, err)

	repo := &mockPaymentRepo{
		recordStripeEventStartFn: func(context.Context, string, string) (bool, error) {
			return true, nil // dedup short-circuit keeps the test focused on lag
		},
	}
	svc := newTestPaymentService(repo, nil)
	svc.SetWebhookValidator(&fakeWebhookValidator{event: stripe.Event{
		ID:      "evt_lag",
		Type:    eventType,
		Created: time.Now().Add(-90 * time.Minute).Unix(),
		Data:    &stripe.EventData{Raw: acctJSON},
	}})

	labels := map[string]string{"event_type": eventType}
	before := sampleCountFor(t, metric, labels)
	require.NoError(t, svc.HandleWebhook(context.Background(), []byte(`{}`), "sig"))
	after := sampleCountFor(t, metric, labels)

	assert.Equal(t, before+1, after, "%s recorded no observation for a stale event", metric)
}
