package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"
)

// WebhookEventValidator verifies a raw Stripe webhook payload and returns the
// parsed stripe.Event. Abstracting this behind an interface keeps signature
// verification mandatory in production while allowing tests to inject a
// deterministic fake without touching env vars.
//
// The production implementation is StripeWebhookValidator, which wraps
// github.com/stripe/stripe-go/v82/webhook.ConstructEvent. Tests should inject
// a fake validator rather than disabling signature verification.
type WebhookEventValidator interface {
	ConstructEvent(payload []byte, signature string) (stripe.Event, error)
}

// StripeWebhookValidator is the production validator that verifies signatures
// against STRIPE_WEBHOOK_SECRET using the Stripe SDK.
type StripeWebhookValidator struct {
	secret string
}

// NewStripeWebhookValidator constructs a validator with the given webhook
// secret. The secret must be non-empty; callers are expected to fail closed at
// service startup if the secret is missing (see cmd/server/main.go).
func NewStripeWebhookValidator(secret string) *StripeWebhookValidator {
	return &StripeWebhookValidator{secret: secret}
}

// ConstructEvent verifies the Stripe signature header against the raw payload
// and returns the decoded event. A non-nil error means the signature was
// missing, malformed, or didn't match — the caller MUST reject the webhook.
// There is deliberately no env-based bypass here.
func (v *StripeWebhookValidator) ConstructEvent(payload []byte, signature string) (stripe.Event, error) {
	return webhook.ConstructEvent(payload, signature, v.secret)
}

// SetWebhookValidator injects a WebhookEventValidator into the PaymentService.
// This is the ONLY supported way to configure signature verification. There is
// no env-based bypass, and HandleWebhook will return an error if no validator
// has been set.
func (s *PaymentService) SetWebhookValidator(v WebhookEventValidator) {
	s.webhookValidator = v
}

// HandleWebhook verifies and processes a Stripe webhook event.
//
// Security: signature verification is MANDATORY. If no validator has been
// configured, the service refuses to process the event. Production callers
// must call SetWebhookValidator with a StripeWebhookValidator (set up at
// startup with STRIPE_WEBHOOK_SECRET). Tests may inject a fake validator.
//
// Idempotency: Stripe retries webhook deliveries for up to 3 days on any
// non-2xx response, and occasionally redelivers successful events. To prevent
// double-apply of side effects (e.g. re-releasing escrow on duplicate
// payment_intent.succeeded), we record every event.id in the stripe_events
// table BEFORE processing. If the event was already recorded, we return nil
// without reprocessing and the gateway returns 200 to Stripe.
func (s *PaymentService) HandleWebhook(ctx context.Context, payload []byte, signature string) error {
	if s.webhookValidator == nil {
		// Fail closed: without a validator we cannot verify signatures, so we
		// must refuse all events. The service startup path is responsible for
		// wiring this in; reaching here indicates a misconfiguration.
		slog.Error("webhook validator not configured, refusing event")
		return fmt.Errorf("webhook validator not configured")
	}

	event, err := s.webhookValidator.ConstructEvent(payload, signature)
	if err != nil {
		return fmt.Errorf("webhook signature verification failed: %w", err)
	}

	// Dedup: record the event.id before processing. If it already exists,
	// a prior delivery was already handled — return nil so Stripe gets 200 OK
	// and doesn't retry.
	alreadyProcessed, err := s.repo.RecordStripeEventStart(ctx, event.ID, string(event.Type))
	if err != nil {
		return fmt.Errorf("record stripe event: %w", err)
	}
	if alreadyProcessed {
		slog.Info("stripe event already processed, skipping", "event_id", event.ID, "type", event.Type)
		return nil
	}

	slog.Info("processing webhook event", "type", event.Type, "id", event.ID)

	if err := s.dispatchWebhookEvent(ctx, event); err != nil {
		// Don't mark processed_at on failure — Stripe will retry. The dedup
		// row still exists (missing processed_at marks it as in-flight/failed,
		// which a background job could revisit for alerting).
		return err
	}

	if err := s.repo.MarkStripeEventProcessed(ctx, event.ID); err != nil {
		// Event succeeded functionally but we failed to stamp processed_at.
		// Log and continue — returning an error would cause Stripe to retry a
		// successful operation. The dedup row still blocks duplicate work.
		slog.Error("failed to mark stripe event processed", "event_id", event.ID, "error", err)
	}

	return nil
}

// dispatchWebhookEvent routes a verified Stripe event to the appropriate
// handler. Separated from HandleWebhook so the signature/dedup machinery stays
// readable.
func (s *PaymentService) dispatchWebhookEvent(ctx context.Context, event stripe.Event) error {
	switch event.Type {
	// Payment events
	case "payment_intent.succeeded":
		return s.handlePaymentIntentSucceeded(ctx, event)
	case "payment_intent.payment_failed":
		return s.handlePaymentIntentFailed(ctx, event)
	case "charge.dispute.created":
		return s.handleChargeDisputeCreated(ctx, event)
	case "transfer.created":
		return s.handleTransferCreated(ctx, event)
	case "charge.refunded":
		return s.handleChargeRefunded(ctx, event)
	case "account.updated":
		slog.Info("stripe connect account updated", "event_id", event.ID)
		return nil

	// Subscription events — delegate to SubscriptionService
	case "customer.subscription.updated",
		"customer.subscription.deleted",
		"invoice.payment_failed",
		"invoice.paid":
		return s.handleSubscriptionEvent(ctx, event)

	default:
		slog.Info("unhandled webhook event type", "type", event.Type)
		return nil
	}
}

func (s *PaymentService) handlePaymentIntentSucceeded(ctx context.Context, event stripe.Event) error {
	var pi stripe.PaymentIntent
	if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
		return fmt.Errorf("parse payment_intent.succeeded: %w", err)
	}

	// Check if this payment is for a BNPL installment plan.
	if pi.Metadata != nil {
		planID := pi.Metadata["installment_plan_id"]
		installmentID := pi.Metadata["scheduled_installment_id"]
		if planID != "" && installmentID != "" && s.installmentHook != nil {
			slog.Info("payment_intent.succeeded for BNPL installment",
				"pi_id", pi.ID,
				"plan_id", planID,
				"installment_id", installmentID,
			)
			if err := s.installmentHook.ConfirmInstallmentPaymentSucceeded(ctx, planID, installmentID, pi.ID); err != nil {
				return fmt.Errorf("handle installment payment succeeded: %w", err)
			}
			return nil
		}
	}

	payment, err := s.repo.FindByStripePaymentIntentID(ctx, pi.ID)
	if err != nil {
		slog.Warn("payment not found for payment_intent.succeeded", "pi_id", pi.ID, "error", err)
		return nil // Don't fail for unknown payments.
	}

	if payment.Status == "processing" || payment.Status == "pending" {
		if err := s.repo.UpdatePaymentStatus(ctx, payment.ID, "escrow"); err != nil {
			return fmt.Errorf("update status to escrow: %w", err)
		}
		slog.Info("payment moved to escrow", "payment_id", payment.ID)
	}

	return nil
}

func (s *PaymentService) handlePaymentIntentFailed(ctx context.Context, event stripe.Event) error {
	var pi stripe.PaymentIntent
	if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
		return fmt.Errorf("parse payment_intent.payment_failed: %w", err)
	}

	payment, err := s.repo.FindByStripePaymentIntentID(ctx, pi.ID)
	if err != nil {
		slog.Warn("payment not found for payment_intent.payment_failed", "pi_id", pi.ID, "error", err)
		return nil
	}

	if err := s.repo.UpdatePaymentStatus(ctx, payment.ID, "failed"); err != nil {
		return fmt.Errorf("update status to failed: %w", err)
	}

	// Extract failure reason from the last payment error.
	failureReason := "payment failed"
	if pi.LastPaymentError != nil && pi.LastPaymentError.Msg != "" {
		failureReason = pi.LastPaymentError.Msg
	}
	slog.Info("payment failed", "payment_id", payment.ID, "reason", failureReason)

	return nil
}

func (s *PaymentService) handleChargeDisputeCreated(ctx context.Context, event stripe.Event) error {
	var dispute stripe.Dispute
	if err := json.Unmarshal(event.Data.Raw, &dispute); err != nil {
		return fmt.Errorf("parse charge.dispute.created: %w", err)
	}

	if dispute.PaymentIntent == nil {
		slog.Warn("dispute has no payment_intent", "dispute_id", dispute.ID)
		return nil
	}

	payment, err := s.repo.FindByStripePaymentIntentID(ctx, dispute.PaymentIntent.ID)
	if err != nil {
		slog.Warn("payment not found for dispute", "pi_id", dispute.PaymentIntent.ID, "error", err)
		return nil
	}

	if err := s.repo.UpdatePaymentStatus(ctx, payment.ID, "disputed"); err != nil {
		return fmt.Errorf("update status to disputed: %w", err)
	}
	slog.Info("payment disputed", "payment_id", payment.ID, "dispute_id", dispute.ID)

	return nil
}

func (s *PaymentService) handleTransferCreated(ctx context.Context, event stripe.Event) error {
	var t stripe.Transfer
	if err := json.Unmarshal(event.Data.Raw, &t); err != nil {
		return fmt.Errorf("parse transfer.created: %w", err)
	}

	// Look up the payment by metadata if available, otherwise by the PaymentIntent
	// attached to the transfer's source transaction.
	piID := ""
	if t.Metadata != nil {
		piID = t.Metadata["payment_intent_id"]
	}

	if piID == "" {
		slog.Info("transfer has no payment_intent_id metadata, skipping", "transfer_id", t.ID)
		return nil
	}

	payment, err := s.repo.FindByStripePaymentIntentID(ctx, piID)
	if err != nil {
		slog.Warn("payment not found for transfer.created", "transfer_id", t.ID, "pi_id", piID, "error", err)
		return nil
	}

	// Record the transfer ID on the payment and move to released status.
	if err := s.repo.UpdateStripeFields(ctx, payment.ID, "", "", t.ID); err != nil {
		return fmt.Errorf("update transfer id: %w", err)
	}

	if payment.Status == "escrow" || payment.Status == "processing" {
		if err := s.repo.UpdatePaymentStatus(ctx, payment.ID, "released"); err != nil {
			return fmt.Errorf("update status to released: %w", err)
		}
		slog.Info("payment released via transfer", "payment_id", payment.ID, "transfer_id", t.ID)
	}

	return nil
}

func (s *PaymentService) handleChargeRefunded(ctx context.Context, event stripe.Event) error {
	var charge stripe.Charge
	if err := json.Unmarshal(event.Data.Raw, &charge); err != nil {
		return fmt.Errorf("parse charge.refunded: %w", err)
	}

	if charge.PaymentIntent == nil {
		slog.Warn("refunded charge has no payment_intent", "charge_id", charge.ID)
		return nil
	}

	payment, err := s.repo.FindByStripePaymentIntentID(ctx, charge.PaymentIntent.ID)
	if err != nil {
		slog.Warn("payment not found for charge.refunded", "pi_id", charge.PaymentIntent.ID, "error", err)
		return nil
	}

	refundAmount := charge.AmountRefunded
	refundStatus := "refunded"
	if refundAmount < charge.Amount {
		refundStatus = "partially_refunded"
	}

	refundID := ""
	if charge.Refunds != nil && len(charge.Refunds.Data) > 0 {
		refundID = charge.Refunds.Data[0].ID
	}

	now := time.Now()
	if err := s.repo.UpdateRefund(ctx, payment.ID, refundAmount, "stripe webhook refund", now, refundID, refundStatus); err != nil {
		return fmt.Errorf("update refund from webhook: %w", err)
	}
	slog.Info("payment refunded via webhook", "payment_id", payment.ID, "amount", refundAmount)

	return nil
}

// webhookSubscriptionData is a minimal struct for extracting subscription and
// period data from Stripe webhook event payloads across different event types.
type webhookSubscriptionData struct {
	ID           string `json:"id"`
	Subscription string `json:"subscription"`
	PeriodStart  int64  `json:"period_start"`
	PeriodEnd    int64  `json:"period_end"`
}

// handleSubscriptionEvent delegates subscription-related webhook events to the
// subscription service. It extracts the subscription ID and period from the event
// using minimal JSON parsing to avoid SDK type compatibility issues.
func (s *PaymentService) handleSubscriptionEvent(ctx context.Context, event stripe.Event) error {
	if s.subHook == nil {
		slog.Warn("subscription webhook handler not configured, skipping", "event_type", event.Type)
		return nil
	}

	var data webhookSubscriptionData
	if err := json.Unmarshal(event.Data.Raw, &data); err != nil {
		return fmt.Errorf("parse %s: %w", event.Type, err)
	}

	// For subscription events (customer.subscription.*), the top-level ID is the
	// subscription ID. For invoice events, the subscription field holds it.
	subID := data.Subscription
	if subID == "" {
		subID = data.ID
	}

	if subID == "" {
		slog.Warn("subscription event has no subscription ID", "event_type", event.Type)
		return nil
	}

	var periodStart, periodEnd *time.Time
	if data.PeriodStart > 0 {
		t := time.Unix(data.PeriodStart, 0)
		periodStart = &t
	}
	if data.PeriodEnd > 0 {
		t := time.Unix(data.PeriodEnd, 0)
		periodEnd = &t
	}

	return s.subHook.HandleSubscriptionWebhook(ctx, string(event.Type), subID, periodStart, periodEnd)
}
