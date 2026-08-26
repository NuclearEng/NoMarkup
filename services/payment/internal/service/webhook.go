package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/nomarkup/nomarkup/services/payment/internal/observability"
	"github.com/stripe/stripe-go/v82"
	// stripe.webhooks.constructEvent() — mandatory signature verification,
	// wrapped by StripeWebhookValidator below.
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
// Idempotency (MON-12): Stripe retries webhook deliveries for up to 3 days on
// any non-2xx response, and occasionally redelivers successful events. We
// record every event.id in stripe_events BEFORE processing. alreadyProcessed
// is true ONLY when processed_at is set (fully handled). A row with
// processed_at NULL means a prior attempt failed — we reprocess so Stripe
// retries are not swallowed. MarkStripeEventProcessed stamps processed_at
// only after the handler succeeds.
//
// Observability: every exit path records stripe_webhook_processing_duration_seconds
// with the event type and an outcome label, so signature rejections, duplicate
// redeliveries and handler failures are each separately visible. The event's
// Stripe-side creation time also feeds stripe_webhook_event_lag_seconds, which
// is the only signal that shows a delivery backlog building. Nothing is
// recorded against a caller-supplied event type until
// stripe.webhooks.constructEvent() has verified the payload.
func (s *PaymentService) HandleWebhook(ctx context.Context, payload []byte, signature string) error {
	start := time.Now()

	if s.webhookValidator == nil {
		// Fail closed: without a validator we cannot verify signatures, so we
		// must refuse all events. The service startup path is responsible for
		// wiring this in; reaching here indicates a misconfiguration.
		slog.ErrorContext(ctx, "webhook validator not configured, refusing event")
		observability.ObserveStripeWebhook("", observability.OutcomeNotConfigured, time.Since(start))
		return fmt.Errorf("webhook validator not configured")
	}

	// Mandatory signature verification — stripe.webhooks.constructEvent().
	event, err := s.webhookValidator.ConstructEvent(payload, signature)
	if err != nil {
		// A missing/malformed/mismatched signature is client-side bad input, not
		// a server fault. Wrap a distinguishable sentinel so the gRPC/gateway
		// layer can return 400 rather than a misleading 500 (CLAUDE.md §15).
		// The event type is deliberately left unknown here: the payload is
		// untrusted until the signature verifies, so labelling the metric from
		// the body would let an attacker mint arbitrary Prometheus labels.
		observability.ObserveStripeWebhook("", observability.OutcomeSignatureFailed, time.Since(start))
		return fmt.Errorf("%w: %v", domain.ErrWebhookSignature, err)
	}

	eventType := string(event.Type)
	observability.ObserveStripeWebhookLag(eventType, event.Created)

	// Dedup: record the event.id before processing. If it already exists,
	// a prior delivery was already handled — return nil so Stripe gets 200 OK
	// and doesn't retry.
	alreadyProcessed, err := s.repo.RecordStripeEventStart(ctx, event.ID, eventType)
	if err != nil {
		observability.ObserveStripeWebhook(eventType, observability.OutcomeProcessingError, time.Since(start))
		return fmt.Errorf("record stripe event: %w", err)
	}
	if alreadyProcessed {
		slog.InfoContext(ctx, "stripe event already processed, skipping", "event_id", event.ID, "type", event.Type)
		observability.ObserveStripeWebhook(eventType, observability.OutcomeDuplicate, time.Since(start))
		return nil
	}

	slog.InfoContext(ctx, "processing webhook event", "type", event.Type, "id", event.ID)

	if err := s.dispatchWebhookEvent(ctx, event); err != nil {
		// Don't mark processed_at on failure — Stripe will retry. The dedup
		// row still exists (missing processed_at marks it as in-flight/failed,
		// which a background job could revisit for alerting).
		observability.ObserveStripeWebhook(eventType, observability.OutcomeProcessingError, time.Since(start))
		return err
	}

	if err := s.repo.MarkStripeEventProcessed(ctx, event.ID); err != nil {
		// Event succeeded functionally but we failed to stamp processed_at.
		// Log and continue — returning an error would cause Stripe to retry a
		// successful operation. The dedup row still blocks duplicate work.
		slog.ErrorContext(ctx, "failed to mark stripe event processed", "event_id", event.ID, "error", err)
	}

	observability.ObserveStripeWebhook(eventType, observability.OutcomeSuccess, time.Since(start))
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

	// Payment-method setup. This is the authoritative signal that a buyer's card
	// is saved and chargeable.
	case "setup_intent.succeeded":
		return s.handleSetupIntentSucceeded(ctx, event)
	case "setup_intent.setup_failed":
		return s.handleSetupIntentFailed(ctx, event)
	case "payment_method.detached":
		return s.handlePaymentMethodDetached(ctx, event)

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

	// FR-16.7 + FR-18.8: charge failure on a recurring-instance payment
	// increments payment_retry_count and only pauses at threshold (>= 3).
	// Never cancels the contract. Fail-soft so a job-mesh / SQL blip does not
	// make Stripe retry a payment status update that already committed.
	// Day-3/day-7 auto-charge is gateway ProcessDueRecurringPaymentRetries.
	s.recordRecurringChargeFailure(ctx, payment)

	return nil
}

// recordRecurringChargeFailure implements FR-16.7 (3-strike + next_retry_at)
// and FR-18.8 (pause at threshold) for the webhook path. No-op when the
// payment is not tied to a recurring instance. Never returns an error to the
// caller — strike/pause failure is residual, not a webhook fault. Never
// cancels the contract.
func (s *PaymentService) recordRecurringChargeFailure(ctx context.Context, payment *domain.Payment) {
	if payment == nil {
		return
	}
	instanceID := ""
	if payment.RecurringInstanceID != nil {
		instanceID = *payment.RecurringInstanceID
	}
	if instanceID == "" {
		return
	}

	if s.recurringFailHook == nil {
		slog.WarnContext(ctx, "FR-16.7 residual: recurring payment failed but strike/pause hook unwired (contract not cancelled)",
			"payment_id", payment.ID,
			"contract_id", payment.ContractID,
			"recurring_instance_id", instanceID,
			"customer_id", payment.CustomerID,
		)
		return
	}

	if err := s.recurringFailHook.PauseOnPaymentFailed(
		ctx,
		payment.ContractID,
		payment.CustomerID,
		instanceID,
		payment.ID,
	); err != nil {
		// Fail-soft: status already failed; do not cancel contract; do not
		// fail the webhook (would cause Stripe retry storms).
		slog.WarnContext(ctx, "FR-16.7/FR-18.8: strike/pause after payment_failed failed (contract not cancelled; payment stays failed)",
			"payment_id", payment.ID,
			"contract_id", payment.ContractID,
			"recurring_instance_id", instanceID,
			"customer_id", payment.CustomerID,
			"error", err,
		)
		return
	}

	slog.InfoContext(ctx, "FR-16.7/FR-18.8: recurring charge failure recorded after payment_intent.payment_failed (contract not cancelled)",
		"payment_id", payment.ID,
		"contract_id", payment.ContractID,
		"recurring_instance_id", instanceID,
		"customer_id", payment.CustomerID,
	)
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
	refundStatus := refundStatusForTotal(refundAmount, payment.AmountCents)
	var raw json.RawMessage
	if event.Data != nil {
		raw = event.Data.Raw
	}
	refundID := stripeRefundIDFromCharge(charge, raw)

	// In-flight CreateRefund owns the row. Never call UpdateRefund / Confirm
	// which could replace pending: or shrink the claimed total.
	if strings.HasPrefix(payment.StripeRefundID, "pending:") {
		if refundAmount >= payment.RefundAmountCents && strings.HasPrefix(refundID, "re_") {
			if err := s.repo.StampRefundID(ctx, payment.ID, payment.StripeRefundID, refundID); err != nil {
				if errors.Is(err, domain.ErrInvalidAmount) {
					slog.InfoContext(ctx, "charge.refunded pending claim already resolved",
						"payment_id", payment.ID,
						"pending_key", payment.StripeRefundID,
					)
					return nil
				}
				return fmt.Errorf("stamp refund id from webhook: %w", err)
			}
			slog.InfoContext(ctx, "charge.refunded stamped stripe refund id onto pending claim",
				"payment_id", payment.ID,
				"refund_id", refundID,
			)
			return nil
		}
		slog.InfoContext(ctx, "charge.refunded ignored in-flight CreateRefund claim",
			"payment_id", payment.ID,
			"pending_key", payment.StripeRefundID,
			"webhook_amount", refundAmount,
			"claimed_amount", payment.RefundAmountCents,
		)
		return nil
	}

	now := time.Now()
	if err := s.repo.ConfirmRefundFromWebhook(ctx, payment.ID, refundAmount, "stripe webhook refund", now, refundID, refundStatus); err != nil {
		return fmt.Errorf("confirm refund from webhook: %w", err)
	}
	slog.Info("payment refunded via webhook", "payment_id", payment.ID, "amount", refundAmount)

	return nil
}

// stripeRefundIDFromCharge returns the newest real Stripe refund id (re_ prefix)
// on the charge. The SDK list is newest-first; we skip empty / non-re_ entries
// rather than blindly taking Data[0]. Raw JSON is a fallback when the typed
// list was not populated the same way as the event payload.
func stripeRefundIDFromCharge(charge stripe.Charge, raw json.RawMessage) string {
	if id := firstStripeRefundID(charge.Refunds); id != "" {
		return id
	}
	if len(raw) == 0 {
		return ""
	}
	var payload struct {
		Refunds struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		} `json:"refunds"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return ""
	}
	for _, r := range payload.Refunds.Data {
		if strings.HasPrefix(r.ID, "re_") {
			return r.ID
		}
	}
	return ""
}

func firstStripeRefundID(list *stripe.RefundList) string {
	if list == nil {
		return ""
	}
	for _, r := range list.Data {
		if r != nil && strings.HasPrefix(r.ID, "re_") {
			return r.ID
		}
	}
	return ""
}

// handleSetupIntentSucceeded persists a payment method the buyer just saved and
// makes it their default.
//
// WHY THIS IS THE AUTHORITATIVE SIGNAL. A card is only chargeable off-session
// once Stripe says the SetupIntent succeeded. The browser saying so is not
// evidence (the existing GetSetupIntentStatus comment makes the same point), and
// the browser may never say anything at all: the buyer can complete a 3DS
// challenge in a bank app and close the tab, in which case this event is the
// ONLY notification the platform ever receives. Persisting solely on the
// synchronous path would silently lose exactly those cards.
//
// Signature verification and dedup are inherited, not reimplemented: this
// handler is only reachable from dispatchWebhookEvent, which HandleWebhook calls
// after stripe.webhooks.constructEvent() has verified the payload against
// STRIPE_WEBHOOK_SECRET and after RecordStripeEventStart has established that
// this event.id has not already been fully processed.
//
// Idempotency on top of that: Stripe redelivers successful events, and the
// synchronous path writes the same method. Both converge because the DB upsert
// keys on the pm_ id (unique) and the default-update carries a deterministic
// Stripe idempotency key.
//
// Fail-safe vs fail-retry: a payload we cannot act on (no method, no customer, a
// customer we do not recognise) is logged and ACKed, because returning an error
// makes Stripe retry it for three days and no retry will make an unknown
// customer known. A genuine persistence failure DOES return an error, so Stripe
// retries and the card is not lost.
func (s *PaymentService) handleSetupIntentSucceeded(ctx context.Context, event stripe.Event) error {
	var si stripe.SetupIntent
	if err := json.Unmarshal(event.Data.Raw, &si); err != nil {
		return fmt.Errorf("parse setup_intent.succeeded: %w", err)
	}

	if s.customers == nil {
		slog.ErrorContext(ctx, "setup_intent.succeeded received but customer provisioner is not configured; card not persisted",
			"setup_intent_id", si.ID)
		return nil
	}

	if si.PaymentMethod == nil || si.PaymentMethod.ID == "" {
		slog.WarnContext(ctx, "setup_intent.succeeded has no payment method, acking", "setup_intent_id", si.ID)
		return nil
	}
	if si.Customer == nil || si.Customer.ID == "" {
		// A customerless SetupIntent cannot have attached anything. This is the
		// pre-fix shape; CreateSetupIntent now refuses to produce one.
		slog.WarnContext(ctx, "setup_intent.succeeded has no customer; the payment method is attached to nothing, acking",
			"setup_intent_id", si.ID, "payment_method_id", si.PaymentMethod.ID)
		return nil
	}

	// Resolve the platform user. Prefer our own index on the Stripe customer id
	// (unique per migration 102) over the metadata tag: metadata is set by us at
	// creation, but the DB is the record of who owns the customer, and it is the
	// mapping every other money path uses.
	userID, err := s.customers.dir.FindUserByStripeCustomerID(ctx, si.Customer.ID)
	if err != nil {
		if tagged := si.Metadata["platform_customer_id"]; tagged != "" {
			slog.WarnContext(ctx, "setup_intent.succeeded for a stripe customer not in our records; falling back to metadata tag",
				"setup_intent_id", si.ID, "stripe_customer_id", si.Customer.ID, "tagged_user_id", tagged)
			userID = tagged
		} else {
			// Not our customer and no tag. Could be another environment sharing
			// the Stripe account. Ack — retrying cannot help.
			slog.WarnContext(ctx, "setup_intent.succeeded for an unknown stripe customer, acking",
				"setup_intent_id", si.ID, "stripe_customer_id", si.Customer.ID, "error", err)
			return nil
		}
	}

	if err := s.customers.RecordConfirmedPaymentMethod(ctx, userID, si.Customer.ID, si.PaymentMethod.ID); err != nil {
		// Real failure: return an error so Stripe retries. Losing this event
		// means the buyer believes their card is saved and no charge will ever
		// find it.
		return fmt.Errorf("persist payment method from setup_intent.succeeded: %w", err)
	}

	slog.InfoContext(ctx, "payment method saved from setup intent",
		"setup_intent_id", si.ID,
		"user_id", userID,
		"stripe_customer_id", si.Customer.ID,
		"payment_method_id", si.PaymentMethod.ID,
	)
	return nil
}

// handleSetupIntentFailed records a card the buyer tried and failed to save.
//
// Nothing to persist — no method was attached — but this is the only signal that
// distinguishes "the buyer never tried to add a card" from "the buyer tried and
// their bank refused", which are very different explanations for an order that
// later cannot be collected. Always ACKs: a failed setup is not a platform fault
// and no retry changes it.
func (s *PaymentService) handleSetupIntentFailed(ctx context.Context, event stripe.Event) error {
	var si stripe.SetupIntent
	if err := json.Unmarshal(event.Data.Raw, &si); err != nil {
		return fmt.Errorf("parse setup_intent.setup_failed: %w", err)
	}
	reason := "unknown"
	if si.LastSetupError != nil && si.LastSetupError.Msg != "" {
		reason = si.LastSetupError.Msg
	}
	customerID := ""
	if si.Customer != nil {
		customerID = si.Customer.ID
	}
	slog.WarnContext(ctx, "setup intent failed; buyer has no saved card from this attempt",
		"setup_intent_id", si.ID,
		"stripe_customer_id", customerID,
		"platform_user_id", si.Metadata["platform_customer_id"],
		"reason", reason,
	)
	return nil
}

// handlePaymentMethodDetached soft-deletes a card removed at Stripe.
//
// Keeps the fail-closed chargeability check honest: without this, a card the
// user detached in a Stripe-hosted surface (or that Stripe removed itself) would
// stay marked as the local default, and every subsequent off-session charge
// would fail as resource_missing. Acks unknown methods — a detach we have no
// record of is already in the desired end state.
func (s *PaymentService) handlePaymentMethodDetached(ctx context.Context, event stripe.Event) error {
	var pm stripe.PaymentMethod
	if err := json.Unmarshal(event.Data.Raw, &pm); err != nil {
		return fmt.Errorf("parse payment_method.detached: %w", err)
	}
	if s.customers == nil || pm.ID == "" {
		return nil
	}

	// The detached event no longer carries the customer, so resolve the owner
	// from our own record of the method.
	userID, err := s.customers.dir.FindUserByPaymentMethodID(ctx, pm.ID)
	if err != nil {
		slog.InfoContext(ctx, "payment_method.detached for a method we do not track, acking",
			"payment_method_id", pm.ID)
		return nil
	}
	if err := s.customers.dir.SoftDeleteUserPaymentMethod(ctx, userID, pm.ID); err != nil {
		return fmt.Errorf("soft delete detached payment method: %w", err)
	}
	slog.InfoContext(ctx, "payment method detached at stripe, marked deleted locally",
		"user_id", userID, "payment_method_id", pm.ID)
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
