package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"
)

// HandleWebhook verifies and processes a Stripe webhook event.
func (s *PaymentService) HandleWebhook(ctx context.Context, payload []byte, signature string) error {
	webhookSecret := os.Getenv("STRIPE_WEBHOOK_SECRET")

	var event stripe.Event
	var err error

	if webhookSecret != "" {
		event, err = webhook.ConstructEvent(payload, signature, webhookSecret)
		if err != nil {
			return fmt.Errorf("webhook signature verification failed: %w", err)
		}
	} else {
		// Dev mode: parse event without signature verification.
		slog.Warn("STRIPE_WEBHOOK_SECRET not set, skipping signature verification")
		if err := json.Unmarshal(payload, &event); err != nil {
			return fmt.Errorf("webhook parse failed: %w", err)
		}
	}

	slog.Info("processing webhook event", "type", event.Type, "id", event.ID)

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

	payment, err := s.repo.FindByStripePaymentIntentID(ctx, pi.ID)
	if err != nil {
		slog.Warn("payment not found for payment_intent.succeeded", "pi_id", pi.ID, "error", err)
		return nil // Don't fail the webhook for unknown payments.
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
