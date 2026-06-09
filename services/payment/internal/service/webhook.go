package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
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
		// A missing/malformed/mismatched signature is client-side bad input, not
		// a server fault. Wrap a distinguishable sentinel so the gRPC/gateway
		// layer can return 400 rather than a misleading 500 (CLAUDE.md §15).
		return fmt.Errorf("%w: %v", domain.ErrWebhookSignature, err)
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
	case "charge.dispute.closed":
		return s.handleChargeDisputeClosed(ctx, event)
	case "transfer.created":
		return s.handleTransferCreated(ctx, event)
	case "charge.refunded":
		return s.handleChargeRefunded(ctx, event)
	case "account.updated":
		return s.handleAccountUpdated(ctx, event)

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

	// Check if this payment is for the goods marketplace flow.
	if pi.Metadata != nil {
		if pi.Metadata["marketplace_flow"] == "goods-v1" && s.marketplaceHook != nil {
			slog.Info("payment_intent.succeeded for marketplace listing",
				"pi_id", pi.ID,
				"order_id", pi.Metadata["listing_order_id"],
			)
			if err := s.marketplaceHook.HandleListingPaymentIntentSucceeded(ctx, pi.ID); err != nil {
				// A missing order (the PI isn't a tracked listing order) or an
				// unexpected escrow state (already past pending_payment) are not
				// server faults Stripe should retry on — a 500 here triggers a
				// retry storm for up to 3 days. Log and ack (return nil), the
				// same fail-safe posture every other handler uses on a miss.
				// Genuine infra errors (DB down, etc.) still propagate as a
				// retryable error.
				if errors.Is(err, ErrListingOrderNotFound) || errors.Is(err, ErrInvalidEscrowState) {
					slog.Warn("listing payment_intent.succeeded not actionable, acking",
						"pi_id", pi.ID,
						"order_id", pi.Metadata["listing_order_id"],
						"error", err,
					)
					return nil
				}
				return fmt.Errorf("handle listing payment succeeded: %w", err)
			}
			return nil
		}
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

// handleChargeDisputeClosed resolves a chargeback dispute that Stripe has
// closed. This is the terminal counterpart to charge.dispute.created: created
// freezes the payment in 'disputed' (escrow held); closed un-freezes it based
// on the outcome. Without this handler a disputed payment stays 'disputed'
// forever and its escrow is un-releasable without manual DB surgery.
//
// Outcome branching (dispute.Status):
//   - won / warning_closed / prevented: the merchant keeps the funds. The
//     bank did not pull money. We return the payment to 'escrow' — the normal
//     release path (transfer.created -> 'released') can then resume. We do NOT
//     jump straight to 'released' here: releasing is the job of the transfer
//     flow, which also records the stripe_transfer_id; this handler only
//     un-freezes the escrow state machine.
//   - lost: the chargeback pulled the funds back to the cardholder. This is
//     terminal — money left the platform, the seller is not paid. We mark the
//     payment 'chargeback' (the canonical terminal status in the DB CHECK
//     constraint and gRPC mapping). Escrow is never released to the seller.
//
// Idempotency: we only act when the payment is currently 'disputed'. A
// re-delivered close (Stripe redelivers successful events) finds the payment
// already in 'escrow' or 'chargeback' and is a no-op, so we never double-move
// the state machine.
//
// Fail-safe: an unknown/unexpected dispute status, a missing payment_intent,
// or a record-not-found are all logged and acked (return nil -> 200) so Stripe
// does not retry-storm for 3 days on a non-retryable condition. Genuine infra
// errors (DB write failure) still propagate so Stripe retries.
func (s *PaymentService) handleChargeDisputeClosed(ctx context.Context, event stripe.Event) error {
	var dispute stripe.Dispute
	if err := json.Unmarshal(event.Data.Raw, &dispute); err != nil {
		return fmt.Errorf("parse charge.dispute.closed: %w", err)
	}

	if dispute.PaymentIntent == nil {
		slog.Warn("closed dispute has no payment_intent, acking", "dispute_id", dispute.ID)
		return nil
	}

	payment, err := s.repo.FindByStripePaymentIntentID(ctx, dispute.PaymentIntent.ID)
	if err != nil {
		// Unknown payment: ack so Stripe doesn't retry. (fail-safe)
		slog.Warn("payment not found for closed dispute, acking",
			"pi_id", dispute.PaymentIntent.ID, "dispute_id", dispute.ID, "error", err)
		return nil
	}

	// Idempotency guard: only act on a payment we previously froze as
	// 'disputed'. A redelivery (already escrow/chargeback) or a payment that
	// was never frozen is a no-op.
	if payment.Status != "disputed" {
		slog.Info("dispute.closed for payment not in disputed state, no-op",
			"payment_id", payment.ID, "dispute_id", dispute.ID,
			"current_status", payment.Status, "dispute_status", string(dispute.Status))
		return nil
	}

	switch dispute.Status {
	case stripe.DisputeStatusWon, stripe.DisputeStatusWarningClosed, stripe.DisputeStatusPrevented:
		// Merchant kept the funds. Return to escrow so the normal release path
		// (transfer.created) can resume.
		if err := s.repo.UpdatePaymentStatus(ctx, payment.ID, "escrow"); err != nil {
			return fmt.Errorf("update status to escrow after dispute won: %w", err)
		}
		slog.Info("dispute closed in merchant's favor, escrow recoverable",
			"payment_id", payment.ID, "dispute_id", dispute.ID, "dispute_status", string(dispute.Status))
		return nil

	case stripe.DisputeStatusLost:
		// Chargeback took the money. Terminal; escrow not released to seller.
		if err := s.repo.UpdatePaymentStatus(ctx, payment.ID, "chargeback"); err != nil {
			return fmt.Errorf("update status to chargeback after dispute lost: %w", err)
		}
		slog.Info("dispute lost, payment charged back",
			"payment_id", payment.ID, "dispute_id", dispute.ID)
		return nil

	default:
		// Unknown/non-terminal status on a close event (shouldn't happen, but
		// fail-safe): leave the payment frozen in 'disputed' rather than guess
		// which way money went. Ack so Stripe doesn't retry; this is visible in
		// logs for an operator to inspect. Do NOT move money state on a guess.
		slog.Warn("dispute.closed with unexpected status, leaving payment disputed",
			"payment_id", payment.ID, "dispute_id", dispute.ID, "dispute_status", string(dispute.Status))
		return nil
	}
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

// handleAccountUpdated persists Stripe Connect onboarding completion so the
// local DB stays in sync with Stripe. Stripe sends account.updated whenever
// requirements/capabilities/details change; we treat onboarding as "complete"
// when the account has details_submitted=true AND charges_enabled=true AND
// payouts_enabled=true (the three signals that the account can actually
// receive money). Otherwise we set it to false so a regression in any of
// these (e.g. Stripe re-requesting documents) is reflected in the DB.
func (s *PaymentService) handleAccountUpdated(ctx context.Context, event stripe.Event) error {
	var acct stripe.Account
	if err := json.Unmarshal(event.Data.Raw, &acct); err != nil {
		return fmt.Errorf("parse account.updated: %w", err)
	}

	if acct.ID == "" {
		slog.Warn("account.updated event missing account id", "event_id", event.ID)
		return nil
	}

	complete := acct.DetailsSubmitted && acct.ChargesEnabled && acct.PayoutsEnabled
	if err := s.repo.SetStripeOnboardingComplete(ctx, acct.ID, complete); err != nil {
		return fmt.Errorf("update onboarding flag: %w", err)
	}

	slog.Info("stripe connect account updated",
		"event_id", event.ID,
		"account_id", acct.ID,
		"details_submitted", acct.DetailsSubmitted,
		"charges_enabled", acct.ChargesEnabled,
		"payouts_enabled", acct.PayoutsEnabled,
		"onboarding_complete", complete,
	)
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
