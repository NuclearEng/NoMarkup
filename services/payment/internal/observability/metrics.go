package observability

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// This file only records metrics. Signature verification is NOT performed here
// and must never be: it happens once, mandatorily, in
// internal/service/webhook.go, which calls stripe.webhooks.constructEvent()
// (Go: webhook.ConstructEvent) before an event is dispatched. The recorders
// below are handed an already-verified event type, or the
// OutcomeSignatureFailed label when that verification rejected the payload.

// stripeWebhookProcessingDuration measures end-to-end Stripe webhook
// processing time per event type and outcome. Required by CLAUDE.md §11.
//
// It lives here rather than in package main (where it was previously declared,
// and consequently unobservable — no external package could call the recorder)
// so the actual handler in internal/service can record it.
//
// Cardinality: event_type is Stripe's fixed event enum and outcome is the small
// closed set of Outcome* constants below.
var stripeWebhookProcessingDuration = promauto.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "stripe_webhook_processing_duration_seconds",
		Help:    "End-to-end Stripe webhook processing duration in seconds.",
		Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
	},
	[]string{"event_type", "outcome"},
)

// stripeWebhookEventLag measures how long an event sat between Stripe creating
// it and this service processing it. This is the backlog signal: processing
// duration stays flat while lag climbs when deliveries queue up or retries pile
// in, which is exactly the condition that is otherwise invisible.
var stripeWebhookEventLag = promauto.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "stripe_webhook_event_lag_seconds",
		Help:    "Delay between Stripe event creation and local processing, in seconds.",
		Buckets: []float64{.5, 1, 2.5, 5, 10, 30, 60, 300, 1800, 7200, 86400},
	},
	[]string{"event_type"},
)

// Processing outcomes. Keep this list closed — every value becomes a
// Prometheus label.
const (
	// OutcomeSuccess — event verified, dispatched and marked processed.
	OutcomeSuccess = "success"
	// OutcomeSignatureFailed — signature verification rejected the payload.
	OutcomeSignatureFailed = "signature_failed"
	// OutcomeDuplicate — Stripe redelivered an event already fully processed.
	OutcomeDuplicate = "duplicate"
	// OutcomeProcessingError — the handler failed; Stripe will retry.
	OutcomeProcessingError = "processing_error"
	// OutcomeNotConfigured — no validator wired; the service refuses the event.
	OutcomeNotConfigured = "not_configured"
)

// ObserveStripeWebhook records a processing observation for one Stripe event.
func ObserveStripeWebhook(eventType, outcome string, duration time.Duration) {
	if eventType == "" {
		eventType = "unknown"
	}
	stripeWebhookProcessingDuration.WithLabelValues(eventType, outcome).Observe(duration.Seconds())
}

// ObserveStripeWebhookLag records how far behind Stripe's event clock we are.
// createdUnix is stripe.Event.Created; a zero or future value is ignored so a
// clock skew cannot poison the histogram.
func ObserveStripeWebhookLag(eventType string, createdUnix int64) {
	if createdUnix <= 0 {
		return
	}
	lag := time.Since(time.Unix(createdUnix, 0)).Seconds()
	if lag < 0 {
		return
	}
	if eventType == "" {
		eventType = "unknown"
	}
	stripeWebhookEventLag.WithLabelValues(eventType).Observe(lag)
}
