package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	underwritingv1 "github.com/nomarkup/nomarkup/proto/underwriting/v1"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// Underwriter sizes a provider's working-capital line via the deterministic
// underwriting engine (Rust). Injected optionally; when absent, credit-limit
// computation fails closed (see ComputeCreditLimit).
type Underwriter interface {
	Underwrite(ctx context.Context, f *underwritingv1.ProviderFeatures) (*underwritingv1.UnderwriteResponse, error)
}

// ProviderTrustSource fetches a provider's trust dimensions from the trust
// engine — an underwriting input the provider cannot self-report.
type ProviderTrustSource interface {
	GetProviderTrust(ctx context.Context, providerID string) (overall, feedback, fraud float64, tier string, err error)
}

// SubscriptionWebhookHandler allows the payment service to delegate subscription
// webhook events to the subscription service without creating a circular dependency.
type SubscriptionWebhookHandler interface {
	HandleSubscriptionWebhook(ctx context.Context, eventType, stripeSubscriptionID string, periodStart, periodEnd *time.Time) error
}

// InstallmentPaymentHandler allows the payment service to delegate installment
// payment events to the installment service.
type InstallmentPaymentHandler interface {
	ConfirmInstallmentPaymentSucceeded(ctx context.Context, planID, installmentID, paymentIntentID string) error
}

// MarketplacePaymentHandler is the surface PaymentService uses to delegate
// goods-marketplace webhook events. The concrete implementation is
// *MarketplaceService.HandleListingPaymentIntentSucceeded.
type MarketplacePaymentHandler interface {
	HandleListingPaymentIntentSucceeded(ctx context.Context, paymentIntentID string) error
}

// PaymentService implements payment business logic.
type PaymentService struct {
	repo             domain.PaymentRepository
	stripe           *StripeService
	subHook          SubscriptionWebhookHandler
	installmentHook  InstallmentPaymentHandler
	marketplaceHook  MarketplacePaymentHandler
	webhookValidator WebhookEventValidator
	underwriter      Underwriter
	trust            ProviderTrustSource
}

// NewPaymentService creates a new payment service.
func NewPaymentService(repo domain.PaymentRepository, stripe *StripeService) *PaymentService {
	return &PaymentService{repo: repo, stripe: stripe}
}

// SetSubscriptionWebhookHandler sets the subscription webhook handler for
// delegating subscription-related Stripe events.
func (s *PaymentService) SetSubscriptionWebhookHandler(h SubscriptionWebhookHandler) {
	s.subHook = h
}

// SetInstallmentPaymentHandler sets the handler for installment payment events.
func (s *PaymentService) SetInstallmentPaymentHandler(h InstallmentPaymentHandler) {
	s.installmentHook = h
}

// SetMarketplaceHandler wires the goods-marketplace webhook delegate.
func (s *PaymentService) SetMarketplaceHandler(h MarketplacePaymentHandler) {
	s.marketplaceHook = h
}

// SetUnderwriter wires the deterministic underwriting engine. When set,
// ComputeCreditLimit underwrites through it; when nil, it fails closed.
func (s *PaymentService) SetUnderwriter(u Underwriter) {
	s.underwriter = u
}

// SetTrustSource wires the trust-engine client used to gather underwriting
// inputs.
func (s *PaymentService) SetTrustSource(t ProviderTrustSource) {
	s.trust = t
}

// CalculateFees computes the fee breakdown for a given amount.
func (s *PaymentService) CalculateFees(ctx context.Context, amountCents int64, categoryID *string) (*domain.PaymentBreakdown, error) {
	if amountCents <= 0 {
		return nil, fmt.Errorf("calculate fees: %w", domain.ErrInvalidAmount)
	}

	var feeConfig *domain.FeeConfig
	var err error

	if categoryID != nil && *categoryID != "" {
		feeConfig, err = s.repo.GetFeeConfig(ctx, *categoryID)
		if err != nil {
			// Fall back to default if category-specific not found.
			feeConfig, err = s.repo.GetDefaultFeeConfig(ctx)
			if err != nil {
				return nil, fmt.Errorf("calculate fees: %w", err)
			}
		}
	} else {
		feeConfig, err = s.repo.GetDefaultFeeConfig(ctx)
		if err != nil {
			return nil, fmt.Errorf("calculate fees: %w", err)
		}
	}

	// Calculate platform fee: max(minFee, min(maxFee, amount * feePercentage))
	platformFee := int64(float64(amountCents) * feeConfig.FeePercentage)
	if platformFee < feeConfig.MinFeeCents {
		platformFee = feeConfig.MinFeeCents
	}
	// A cap of 0 cents is meaningless and means "no cap" (see
	// domain.FeeConfig.MaxFeeCents). The repo normalizes 0 -> nil on load; clamp
	// here only on a positive cap so a stray 0 can never zero out the platform fee.
	if feeConfig.MaxFeeCents != nil && *feeConfig.MaxFeeCents > 0 && platformFee > *feeConfig.MaxFeeCents {
		platformFee = *feeConfig.MaxFeeCents
	}

	// Calculate guarantee fee.
	guaranteeFee := int64(float64(amountCents) * feeConfig.GuaranteePercentage)

	// Calculate lead-gen fee: an ADDITIONAL provider-side deduction, clamped the
	// same way as the platform fee. Disabled => zero, leaving payout unchanged.
	var leadGenFee int64
	var leadGenPercentage float64
	if feeConfig.LeadGenEnabled {
		leadGenPercentage = feeConfig.LeadGenPercentage
		leadGenFee = int64(float64(amountCents) * feeConfig.LeadGenPercentage)
		if leadGenFee < feeConfig.LeadGenMinFeeCents {
			leadGenFee = feeConfig.LeadGenMinFeeCents
		}
		if feeConfig.LeadGenMaxFeeCents != nil && *feeConfig.LeadGenMaxFeeCents > 0 && leadGenFee > *feeConfig.LeadGenMaxFeeCents {
			leadGenFee = *feeConfig.LeadGenMaxFeeCents
		}
	}

	// Provider payout = amount - platformFee - guaranteeFee - leadGenFee.
	// The customer still pays exactly amountCents (TotalCents); the lead-gen fee
	// only reduces the provider's payout, exactly like the platform fee.
	providerPayout := amountCents - platformFee - guaranteeFee - leadGenFee

	return &domain.PaymentBreakdown{
		SubtotalCents:       amountCents,
		PlatformFeeCents:    platformFee,
		GuaranteeFeeCents:   guaranteeFee,
		TotalCents:          amountCents,
		ProviderPayoutCents: providerPayout,
		FeePercentage:       feeConfig.FeePercentage,
		GuaranteePercentage: feeConfig.GuaranteePercentage,
		LeadGenFeeCents:     leadGenFee,
		LeadGenPercentage:   leadGenPercentage,
	}, nil
}

// CreatePayment creates a new payment record and a Stripe PaymentIntent.
func (s *PaymentService) CreatePayment(ctx context.Context, input domain.CreatePaymentInput) (*domain.Payment, string, error) {
	if input.AmountCents <= 0 {
		return nil, "", fmt.Errorf("create payment: %w", domain.ErrInvalidAmount)
	}

	// Reconcile against the contract server-side. The client supplies amount and
	// provider_id, but neither may be trusted (§6: all price calculations are
	// server-side). Without this, a customer could charge any amount against a
	// contract — e.g. $10M on a $700 job, or a near-int64-max value that wraps
	// the fee math — and could direct the payout at an arbitrary provider.
	contract, err := s.repo.GetContractForPayment(ctx, input.ContractID)
	if err != nil {
		return nil, "", fmt.Errorf("create payment: %w", err)
	}
	// The payer must be the contract's customer.
	if input.CustomerID != contract.CustomerID {
		return nil, "", fmt.Errorf("create payment: %w", domain.ErrContractNotOwned)
	}
	// The amount may never exceed the contract total. Partial milestone and
	// installment payments are <= the total, so this bound permits them while
	// rejecting overcharge and overflow inputs.
	if input.AmountCents > contract.AmountCents {
		return nil, "", fmt.Errorf("create payment: amount exceeds contract: %w", domain.ErrInvalidAmount)
	}
	// Derive the payee from the contract; never trust the client's provider_id.
	input.ProviderID = contract.ProviderID

	// Calculate fees.
	breakdown, err := s.CalculateFees(ctx, input.AmountCents, input.CategoryID)
	if err != nil {
		return nil, "", err
	}

	// Get provider Stripe account for destination charge.
	providerAccountID, err := s.repo.GetStripeAccountID(ctx, input.ProviderID)
	if err != nil {
		return nil, "", fmt.Errorf("create payment: %w", err)
	}

	paymentID := uuid.New().String()
	idempotencyKey := input.IdempotencyKey
	if idempotencyKey == "" {
		idempotencyKey = uuid.New().String()
	}

	payment := &domain.Payment{
		ID:                  paymentID,
		ContractID:          input.ContractID,
		MilestoneID:         input.MilestoneID,
		RecurringInstanceID: input.RecurringInstanceID,
		CustomerID:          input.CustomerID,
		ProviderID:          input.ProviderID,
		AmountCents:         input.AmountCents,
		// Ledger invariant: the persisted split MUST sum to amount_cents so the
		// payments table self-reconciles (no cents created/destroyed). The
		// payments row has no lead_gen_fee_cents column, so the lead-gen slice —
		// which is platform-retained on the Stripe side (folded into totalFee
		// below) — is folded into the stored platform fee here. The real money
		// movement is unchanged (platform keeps platform+guarantee+leadgen either
		// way); this only ensures platform_fee+guarantee_fee+provider_payout ==
		// amount_cents on the persisted record. When lead-gen is disabled
		// LeadGenFeeCents is 0, so this is a no-op.
		PlatformFeeCents:    breakdown.PlatformFeeCents + breakdown.LeadGenFeeCents,
		GuaranteeFeeCents:   breakdown.GuaranteeFeeCents,
		ProviderPayoutCents: breakdown.ProviderPayoutCents,
		IdempotencyKey:      idempotencyKey,
		Status:              "pending",
		InstallmentNumber:   input.InstallmentNumber,
		TotalInstallments:   input.TotalInstallments,
	}

	// Create payment record in DB.
	if err := s.repo.CreatePayment(ctx, payment); err != nil {
		return nil, "", err
	}

	// Create Stripe PaymentIntent. The Stripe application_fee_amount is the
	// amount the platform retains from the destination charge; the remainder is
	// transferred to the provider. The lead-gen fee is an additional platform-
	// retained amount, so it is added here alongside the platform + guarantee
	// fees. This keeps the lead-gen fee with the platform and reduces the
	// provider transfer by the same amount (mirrors breakdown.ProviderPayoutCents).
	totalFee := breakdown.PlatformFeeCents + breakdown.GuaranteeFeeCents + breakdown.LeadGenFeeCents
	piID, clientSecret, err := s.stripe.CreatePaymentIntent(ctx, input.AmountCents, "usd", providerAccountID, totalFee, idempotencyKey)
	if err != nil {
		// The payments row was inserted above, before this call. Leaving it in
		// 'pending' with a NULL payment intent is not inert: ProcessPayment
		// skips capture when the PI is empty and CASes straight to 'escrow',
		// and CreateTransfer then omits SourceTransaction and pays the
		// provider out of the PLATFORM balance. Mark it failed so a payment
		// nobody charged can never be walked forward.
		if markErr := s.repo.UpdatePaymentStatus(ctx, paymentID, "failed"); markErr != nil {
			slog.Error("failed to mark payment failed after stripe error; row may be left in pending with no payment intent",
				"payment_id", paymentID,
				"stripe_error", err,
				"mark_error", markErr,
			)
		}
		return nil, "", fmt.Errorf("create payment stripe: %w", err)
	}

	// Update stripe fields in the payment record.
	if err := s.repo.UpdateStripeFields(ctx, paymentID, piID, "", ""); err != nil {
		return nil, "", fmt.Errorf("create payment update stripe: %w", err)
	}

	// Re-fetch the payment to get the latest state.
	payment, err = s.repo.GetPayment(ctx, paymentID)
	if err != nil {
		return nil, "", err
	}

	return payment, clientSecret, nil
}

// ProcessPayment confirms/captures a PaymentIntent and updates status.
//
// Concurrency (MON-14): CAS pending→processing so only one caller captures;
// Stripe capture carries a deterministic idempotency key so a retry after a
// crash cannot double-capture.
func (s *PaymentService) ProcessPayment(ctx context.Context, paymentID string, paymentMethodID string) (*domain.Payment, error) {
	payment, err := s.repo.GetPayment(ctx, paymentID)
	if err != nil {
		return nil, err
	}

	if payment.Status != "pending" {
		return nil, fmt.Errorf("process payment: %w", domain.ErrPaymentAlreadyProcessed)
	}

	// CAS claim: pending → processing. A concurrent ProcessPayment loses here.
	if err := s.repo.ClaimPaymentStatus(ctx, paymentID, "pending", "processing"); err != nil {
		return nil, fmt.Errorf("process payment: %w", domain.ErrPaymentAlreadyProcessed)
	}

	// Capture the payment intent with a deterministic key.
	//
	// An empty PI means no money was ever authorized — CreatePayment failed at
	// the Stripe call and left this row behind. Refuse rather than skipping
	// the capture: falling through would CAS the row to 'escrow' and make an
	// uncharged payment releasable, paying the provider from platform funds.
	// Dev mode is the one legitimate no-PI case.
	if payment.StripePaymentIntentID == "" {
		if !s.stripe.IsDevMode() {
			slog.Error("refusing to process payment with no stripe payment intent",
				"payment_id", paymentID,
			)
			_ = s.repo.ClaimPaymentStatus(ctx, paymentID, "processing", "failed")
			return nil, fmt.Errorf("process payment: %w", domain.ErrInvalidStatus)
		}
	} else {
		captureKey := "capture:" + paymentID
		if err := s.stripe.CapturePaymentIntent(ctx, payment.StripePaymentIntentID, captureKey); err != nil {
			// Mark as failed if capture fails (CAS processing→failed).
			_ = s.repo.ClaimPaymentStatus(ctx, paymentID, "processing", "failed")
			return nil, fmt.Errorf("process payment capture: %w", err)
		}
	}

	// CAS processing → escrow on success.
	if err := s.repo.ClaimPaymentStatus(ctx, paymentID, "processing", "escrow"); err != nil {
		// Capture already succeeded; try best-effort status write.
		_ = s.repo.UpdatePaymentStatus(ctx, paymentID, "escrow")
		return nil, fmt.Errorf("process payment escrow claim: %w", err)
	}

	return s.repo.GetPayment(ctx, paymentID)
}

// advanceRepaymentRate is the percentage of provider payout deducted for advance repayment.
const advanceRepaymentRate = 0.20

// ReleaseEscrow creates a Stripe transfer to the provider and updates status.
// If the provider has active advances, a portion of the payout is withheld for repayment.
//
// Concurrency (MON-03): CAS-claim status escrow→released BEFORE the transfer so
// only one concurrent release wins. Transfer uses deterministic key
// "escrow-release:<paymentID>" so a crash/retry never double-pays at Stripe.
// On transfer failure the claim is reverted to escrow.
// ReleaseActor identifies who is asking for an escrow action. The gateway's
// RequirePartyAccess admits EITHER party to a payment, so it cannot tell a
// customer approving completion apart from a provider paying themselves. That
// distinction is made here, where the payment row is already loaded.
//
// System is set only by trusted in-process callers (the auto-release cron)
// that act with no human actor.
type ReleaseActor struct {
	UserID  string
	IsAdmin bool
	System  bool
}

// authorizeRelease reports whether actor may release this payment's escrow.
//
// Releasing escrow moves money to the provider. The provider is therefore the
// one party who must NOT be able to trigger it: a self-release pays them for
// work the customer never confirmed, and there is no compensating check
// downstream (ReleaseEscrow's only other gate is status=='escrow', and
// contract approval never calls this at all).
func authorizeRelease(payment *domain.Payment, actor ReleaseActor) error {
	if actor.System || actor.IsAdmin {
		return nil
	}
	if actor.UserID == "" {
		// A caller-initiated release with no actor cannot be authorized. Fail
		// closed rather than assuming a trusted caller.
		return fmt.Errorf("release escrow: %w", domain.ErrNotAuthorizedActor)
	}
	if actor.UserID == payment.CustomerID {
		return nil
	}
	return fmt.Errorf("release escrow: %w", domain.ErrNotAuthorizedActor)
}

func (s *PaymentService) ReleaseEscrow(ctx context.Context, paymentID string, reason string, actor ReleaseActor) (*domain.Payment, error) {
	payment, err := s.repo.GetPayment(ctx, paymentID)
	if err != nil {
		return nil, err
	}

	if err := authorizeRelease(payment, actor); err != nil {
		slog.Warn("escrow release refused",
			"payment_id", paymentID,
			"actor_user_id", actor.UserID,
			"provider_id", payment.ProviderID,
			"customer_id", payment.CustomerID,
		)
		return nil, err
	}

	// Idempotent re-entry: already released with a transfer recorded.
	if payment.Status == "released" && payment.StripeTransferID != "" {
		return payment, nil
	}

	// Resume incomplete release (claimed released but transfer never stamped).
	resume := payment.Status == "released" && payment.StripeTransferID == ""
	if !resume {
		if payment.Status != "escrow" {
			return nil, fmt.Errorf("release escrow: %w", domain.ErrInvalidStatus)
		}
		// CAS claim: escrow → released. Loser of a concurrent race fails here.
		if err := s.repo.ClaimPaymentStatus(ctx, paymentID, "escrow", "released"); err != nil {
			// Another release may have won — if so, return the released payment.
			if cur, gerr := s.repo.GetPayment(ctx, paymentID); gerr == nil && cur.Status == "released" {
				return cur, nil
			}
			return nil, fmt.Errorf("release escrow: %w", domain.ErrInvalidStatus)
		}
	}

	// Get provider Stripe account.
	providerAccountID, err := s.repo.GetStripeAccountID(ctx, payment.ProviderID)
	if err != nil {
		_ = s.repo.ClaimPaymentStatus(ctx, paymentID, "released", "escrow")
		return nil, fmt.Errorf("release escrow: %w", err)
	}

	// Check for active advances to calculate repayment deductions.
	activeAdvances, err := s.repo.GetActiveAdvancesForProvider(ctx, payment.ProviderID)
	if err != nil {
		slog.Error("release escrow: failed to get active advances, proceeding without repayment",
			"payment_id", paymentID,
			"provider_id", payment.ProviderID,
			"error", err,
		)
		activeAdvances = nil
	}

	// Calculate total repayment: 20% of provider payout, capped at total remaining balance.
	var totalRepayment int64
	if len(activeAdvances) > 0 {
		repaymentPool := int64(float64(payment.ProviderPayoutCents) * advanceRepaymentRate)

		// Deduct from oldest advances first.
		for _, advance := range activeAdvances {
			if repaymentPool <= 0 {
				break
			}

			remaining := (advance.AdvanceAmountCents + advance.FeeCents) - advance.RepaidCents
			if remaining <= 0 {
				continue
			}

			deduction := repaymentPool
			if deduction > remaining {
				deduction = remaining
			}

			if _, err := s.repo.UpdateAdvanceRepayment(ctx, advance.ID, paymentID, deduction); err != nil {
				slog.Error("release escrow: failed to record advance repayment",
					"payment_id", paymentID,
					"advance_id", advance.ID,
					"deduction_cents", deduction,
					"error", err,
				)
				// Continue processing — don't fail the escrow release for a repayment error.
				continue
			}

			slog.Info("advance repayment deducted",
				"payment_id", paymentID,
				"advance_id", advance.ID,
				"deduction_cents", deduction,
				"advance_remaining_after", remaining-deduction,
			)

			totalRepayment += deduction
			repaymentPool -= deduction
		}
	}

	// Transfer reduced amount to provider.
	transferAmount := payment.ProviderPayoutCents - totalRepayment
	if transferAmount < 0 {
		transferAmount = 0
	}

	// Deterministic Stripe idempotency key — concurrent/retried releases
	// return the SAME transfer rather than double-paying.
	transferKey := "escrow-release:" + paymentID
	transferID, err := s.stripe.CreateTransfer(ctx, transferAmount, "usd", providerAccountID, payment.StripePaymentIntentID, transferKey)
	if err != nil {
		// Revert claim so a later retry can re-attempt.
		_ = s.repo.ClaimPaymentStatus(ctx, paymentID, "released", "escrow")
		return nil, fmt.Errorf("release escrow transfer: %w", err)
	}

	if totalRepayment > 0 {
		slog.Info("escrow released with advance repayment",
			"payment_id", paymentID,
			"provider_id", payment.ProviderID,
			"original_payout_cents", payment.ProviderPayoutCents,
			"repayment_cents", totalRepayment,
			"transfer_cents", transferAmount,
		)
	}

	// Stamp transfer ID (status already released via CAS claim).
	if err := s.repo.UpdateStripeFields(ctx, paymentID, "", "", transferID); err != nil {
		return nil, err
	}

	return s.repo.GetPayment(ctx, paymentID)
}

// CreateRefund issues a Stripe refund and updates the payment record.
//
// Concurrency (MON-13): remaining balance is re-checked against the CAS'd
// prior refund total so concurrent refunds cannot over-refund. Stripe key
// includes payment id + target cumulative amount so retries are safe.
func (s *PaymentService) CreateRefund(ctx context.Context, paymentID string, amountCents int64, reason string, actor ReleaseActor) (*domain.Payment, error) {
	payment, err := s.repo.GetPayment(ctx, paymentID)
	if err != nil {
		return nil, err
	}

	if payment.Status != "escrow" && payment.Status != "released" && payment.Status != "completed" &&
		payment.Status != "partially_refunded" {
		return nil, fmt.Errorf("create refund: %w", domain.ErrInvalidStatus)
	}

	// Actor authority. Payouts are separate charge + transfer: once a payment
	// is released or completed, the provider already holds their transfer, so
	// a refund at that point pulls from the PLATFORM balance and the platform
	// eats the difference. That is a dispute-resolution decision, not
	// something either party may trigger unilaterally.
	//
	// While the payment is still in escrow no transfer has happened, so a
	// party-initiated refund is just returning held funds — allowed.
	if !actor.System && !actor.IsAdmin {
		switch payment.Status {
		case "released", "completed", "partially_refunded":
			slog.Warn("post-payout refund refused for non-admin actor",
				"payment_id", paymentID,
				"actor_user_id", actor.UserID,
				"status", payment.Status,
			)
			return nil, fmt.Errorf("create refund: %w", domain.ErrNotAuthorizedActor)
		}
		if actor.UserID == "" {
			return nil, fmt.Errorf("create refund: %w", domain.ErrNotAuthorizedActor)
		}
	}

	// Server-side amount authority: the refund amount is supplied by the caller
	// (gateway forwards a client-controlled amount_cents, and the refund route is
	// reachable by the payment's customer/provider, not just admins). It MUST be
	// bounded here or a party could trigger an arbitrary Stripe refund exceeding
	// what was ever escrowed. A negative amount is also rejected outright.
	if amountCents < 0 {
		return nil, fmt.Errorf("create refund: %w", domain.ErrInvalidAmount)
	}

	// Determine refund amount: 0 means full refund of the remaining (un-refunded)
	// balance, never more than the held amount.
	alreadyRefunded := payment.RefundAmountCents
	remaining := payment.AmountCents - alreadyRefunded
	if remaining <= 0 {
		// Nothing left to refund — the payment is already fully refunded.
		return nil, fmt.Errorf("create refund: %w", domain.ErrInvalidAmount)
	}

	refundAmount := amountCents
	if refundAmount == 0 {
		refundAmount = remaining
	}

	// Cap at the remaining balance: this single refund plus all prior refunds can
	// never exceed payment.AmountCents. This is the escrow invariant that keeps a
	// payment from refunding more than was captured.
	if refundAmount > remaining {
		return nil, fmt.Errorf("create refund: %w", domain.ErrInvalidAmount)
	}

	// The cumulative refunded total persisted on the payment.
	totalRefunded := alreadyRefunded + refundAmount

	// Deterministic Stripe key: payment + target cumulative so concurrent
	// attempts at the same cumulative total dedupe; distinct amounts get
	// distinct keys.
	refundKey := fmt.Sprintf("refund:%s:%d", paymentID, totalRefunded)
	refundID, err := s.stripe.CreateRefund(ctx, payment.StripePaymentIntentID, refundAmount, refundKey)
	if err != nil {
		return nil, fmt.Errorf("create refund stripe: %w", err)
	}

	// Determine status: full refund (cumulative reaches the held amount) or partial.
	refundStatus := "refunded"
	if totalRefunded < payment.AmountCents {
		refundStatus = "partially_refunded"
	}

	now := time.Now()
	// CAS: only apply if refund_amount_cents is still the prior we based this on.
	if err := s.repo.UpdateRefundCAS(ctx, paymentID, alreadyRefunded, totalRefunded, reason, now, refundID, refundStatus); err != nil {
		// Concurrent refund may have already applied the same total (same Stripe key).
		if cur, gerr := s.repo.GetPayment(ctx, paymentID); gerr == nil {
			if cur.RefundAmountCents >= totalRefunded {
				return cur, nil
			}
		}
		return nil, fmt.Errorf("create refund: %w", domain.ErrInvalidAmount)
	}

	return s.repo.GetPayment(ctx, paymentID)
}

// GetPayment retrieves a payment by ID.
func (s *PaymentService) GetPayment(ctx context.Context, paymentID string) (*domain.Payment, error) {
	return s.repo.GetPayment(ctx, paymentID)
}

// ListPayments lists payments for a user with optional filtering.
func (s *PaymentService) ListPayments(ctx context.Context, userID string, statusFilter string, page, pageSize int) ([]*domain.Payment, int, error) {
	return s.repo.ListPayments(ctx, userID, statusFilter, page, pageSize)
}

// GetFeeConfig retrieves the active fee config for a category or default.
//
// When no fee config row exists yet (a fresh platform), this returns the
// platform's standard default config rather than an error, so the admin
// fee-config UI can render and edit sensible starting values instead of seeing
// a 404/500 for a predictable empty-state. Real lookup failures (DB down, etc.)
// are still propagated.
func (s *PaymentService) GetFeeConfig(ctx context.Context, categoryID *string) (*domain.FeeConfig, error) {
	if categoryID != nil && *categoryID != "" {
		fc, err := s.repo.GetFeeConfig(ctx, *categoryID)
		if err == nil {
			return fc, nil
		}
		// Fall through to the default config below only for the missing-row case;
		// surface any other (real) error.
		if !errors.Is(err, domain.ErrFeeConfigNotFound) {
			return nil, err
		}
	}

	fc, err := s.repo.GetDefaultFeeConfig(ctx)
	if err == nil {
		return fc, nil
	}
	if errors.Is(err, domain.ErrFeeConfigNotFound) {
		// No config persisted yet — return the standard defaults so the admin
		// can review and save them.
		return domain.DefaultFeeConfig(), nil
	}
	return nil, err
}

// GetStripeAccountID retrieves the Stripe account ID for a user.
func (s *PaymentService) GetStripeAccountID(ctx context.Context, userID string) (string, error) {
	return s.repo.GetStripeAccountID(ctx, userID)
}

// CreateStripeAccount creates a Stripe Connect account and stores the ID.
func (s *PaymentService) CreateStripeAccount(ctx context.Context, userID, email, businessName string) (string, error) {
	accountID, err := s.stripe.CreateStripeAccount(ctx, email, businessName)
	if err != nil {
		return "", err
	}

	if err := s.repo.SetStripeAccountID(ctx, userID, accountID); err != nil {
		return "", err
	}

	return accountID, nil
}

// GetStripeOnboardingLink generates an onboarding link for the user's Stripe account.
func (s *PaymentService) GetStripeOnboardingLink(ctx context.Context, userID, returnURL, refreshURL string) (string, error) {
	accountID, err := s.repo.GetStripeAccountID(ctx, userID)
	if err != nil {
		return "", err
	}

	return s.stripe.GetOnboardingLink(ctx, accountID, returnURL, refreshURL)
}

// GetStripeAccountStatus retrieves the Stripe account status for a user.
// If no Stripe account exists, returns a default "not started" status instead of an error.
func (s *PaymentService) GetStripeAccountStatus(ctx context.Context, userID string) (*domain.StripeAccountStatus, error) {
	accountID, err := s.repo.GetStripeAccountID(ctx, userID)
	if err != nil {
		// If the user has no Stripe account, return a sensible default.
		slog.Info("no stripe account for user, returning default status",
			"user_id", userID,
			"error", err,
		)
		return &domain.StripeAccountStatus{
			ChargesEnabled:   false,
			PayoutsEnabled:   false,
			DetailsSubmitted: false,
		}, nil
	}

	return s.stripe.GetAccountStatus(ctx, accountID)
}

// GetStripeDashboardLink generates a dashboard link for the user's Stripe account.
func (s *PaymentService) GetStripeDashboardLink(ctx context.Context, userID string) (string, error) {
	accountID, err := s.repo.GetStripeAccountID(ctx, userID)
	if err != nil {
		return "", err
	}

	return s.stripe.GetDashboardLink(ctx, accountID)
}

// CreateSetupIntent creates a SetupIntent for saving customer payment methods.
func (s *PaymentService) CreateSetupIntent(ctx context.Context, customerID string) (string, error) {
	// Look up the user's Stripe customer ID if one exists.
	stripeCustomerID, err := s.repo.GetStripeCustomerID(ctx, customerID)
	if err != nil {
		slog.Warn("failed to look up stripe customer id for setup intent",
			"user_id", customerID,
			"error", err,
		)
	}
	// Pass the Stripe customer ID if available, otherwise pass the platform user ID
	// (the Stripe service stores it as metadata).
	if stripeCustomerID != "" {
		return s.stripe.CreateSetupIntent(ctx, stripeCustomerID)
	}
	return s.stripe.CreateSetupIntent(ctx, customerID)
}

// GetSetupIntentStatus asks Stripe whether a SetupIntent actually confirmed.
// Callers gate privileges on this instead of trusting a client-side "it
// succeeded" POST.
func (s *PaymentService) GetSetupIntentStatus(ctx context.Context, clientSecret, customerID string) (SetupIntentStatus, error) {
	return s.stripe.GetSetupIntentStatus(ctx, clientSecret, customerID)
}

// ChargePromotion collects a listing-promotion fee off-session against the
// card saved by a confirmed SetupIntent.
//
// The SetupIntent is verified here — a caller cannot skip straight to the
// charge — and amountCents is supplied by the gateway from its server-side
// pricebook. idempotencyKey (the promotion_charges row id) makes a retried or
// concurrent confirm collapse onto a single Stripe charge.
func (s *PaymentService) ChargePromotion(ctx context.Context, customerID, clientSecret string, amountCents int64, idempotencyKey, listingID string) (string, string, bool, error) {
	if idempotencyKey == "" {
		return "", "", false, fmt.Errorf("charge promotion: idempotency key required")
	}
	if amountCents <= 0 {
		return "", "", false, fmt.Errorf("charge promotion: amount must be positive")
	}

	si, err := s.stripe.GetSetupIntentStatus(ctx, clientSecret, customerID)
	if err != nil {
		return "", "", false, err
	}
	if !si.Succeeded {
		// Not an error condition — the card was never confirmed. The caller
		// maps this to a 402 so the buyer can retry in Stripe Elements.
		return "", si.Status, false, nil
	}

	stripeCustomerID, lookupErr := s.repo.GetStripeCustomerID(ctx, customerID)
	if lookupErr != nil {
		slog.Warn("charge promotion: stripe customer lookup failed",
			"user_id", customerID,
			"error", lookupErr,
		)
	}
	if stripeCustomerID == "" {
		stripeCustomerID = customerID
	}

	piID, _, err := s.stripe.CreateOffSessionPaymentIntent(
		ctx,
		amountCents,
		"usd",
		stripeCustomerID,
		si.PaymentMethodID,
		"promo_"+idempotencyKey,
		map[string]string{
			"purpose":    "listing_promotion",
			"listing_id": listingID,
			"charge_id":  idempotencyKey,
		},
	)
	if err != nil {
		return "", "", false, err
	}
	return piID, "succeeded", true, nil
}

// ListPaymentMethods lists a customer's payment methods.
// If the customer has no Stripe customer ID configured, returns an empty list.
func (s *PaymentService) ListPaymentMethods(ctx context.Context, customerID string) ([]domain.PaymentMethod, error) {
	if s.stripe.IsDevMode() {
		// DevStore is keyed by platform user id, not stripe customer id.
		return s.stripe.ListPaymentMethods(ctx, customerID)
	}
	// Look up the user's Stripe customer ID. If none exists, return empty.
	stripeCustomerID, err := s.repo.GetStripeCustomerID(ctx, customerID)
	if err != nil || stripeCustomerID == "" {
		slog.Info("no stripe customer id for user, returning empty payment methods",
			"user_id", customerID,
		)
		return []domain.PaymentMethod{}, nil
	}
	return s.stripe.ListPaymentMethods(ctx, stripeCustomerID)
}

// AddDevPaymentMethod appends a card to the in-memory dev store. Callable
// only when the Stripe service is in dev mode — production should use the
// Stripe Elements flow via CreateSetupIntent.
func (s *PaymentService) AddDevPaymentMethod(ctx context.Context, customerID, brand, last4 string, expMonth, expYear int32) (*domain.PaymentMethod, error) {
	if !s.stripe.IsDevMode() {
		return nil, fmt.Errorf("add dev payment method: stripe not in dev mode")
	}
	pm := s.stripe.DevStore().AddPaymentMethod(customerID, brand, last4, expMonth, expYear)
	return &pm, nil
}

// DeletePaymentMethod detaches a payment method owned by customerID.
//
// Ownership (IDOR guard): the payment method MUST belong to customerID. We
// confirm membership by listing the caller's own methods (ListPaymentMethods is
// owner-scoped — dev: keyed by user id; prod: keyed by the user's Stripe
// customer id) and checking the id is present before detaching. A method that
// isn't the caller's returns ErrPaymentNotFound → gRPC NotFound → 404, so a
// non-owner can neither delete nor probe for another user's card id.
func (s *PaymentService) DeletePaymentMethod(ctx context.Context, customerID, paymentMethodID string) error {
	methods, err := s.ListPaymentMethods(ctx, customerID)
	if err != nil {
		return fmt.Errorf("delete payment method: load owner methods: %w", err)
	}
	owned := false
	for _, m := range methods {
		if m.ID == paymentMethodID {
			owned = true
			break
		}
	}
	if !owned {
		return domain.ErrPaymentNotFound
	}
	return s.stripe.DeletePaymentMethod(ctx, paymentMethodID)
}

// AdminListPayments lists payments with optional filters for admin use.
func (s *PaymentService) AdminListPayments(ctx context.Context, userID string, statusFilter string, startTime, endTime *time.Time, page, pageSize int) ([]*domain.Payment, int, int64, int64, error) {
	return s.repo.AdminListPayments(ctx, userID, statusFilter, startTime, endTime, page, pageSize)
}

// AdminGetPaymentDetails retrieves a payment by ID with full details for admin.
func (s *PaymentService) AdminGetPaymentDetails(ctx context.Context, paymentID string) (*domain.Payment, error) {
	return s.repo.AdminGetPaymentDetails(ctx, paymentID)
}

// AdminUpdateFeeConfig updates the fee configuration for a category or the default.
func (s *PaymentService) AdminUpdateFeeConfig(ctx context.Context, categoryID *string, feePercentage, guaranteePercentage float64, minFeeCents int64, maxFeeCents *int64, leadGenEnabled bool, leadGenPercentage float64, leadGenMinFeeCents int64, leadGenMaxFeeCents *int64) (*domain.FeeConfig, error) {
	// A non-empty category override must be a valid UUID. Empty/absent means the
	// default (platform-wide) config. Reject a malformed id as a 400, not a 500
	// from the downstream UUID cast.
	if categoryID != nil && *categoryID != "" {
		if _, err := uuid.Parse(*categoryID); err != nil {
			return nil, fmt.Errorf("admin update fee config: category_id must be a valid uuid: %w", domain.ErrInvalidAmount)
		}
	}
	if feePercentage < 0 || feePercentage > 1 {
		return nil, fmt.Errorf("admin update fee config: fee_percentage must be between 0 and 1: %w", domain.ErrInvalidAmount)
	}
	if guaranteePercentage < 0 || guaranteePercentage > 1 {
		return nil, fmt.Errorf("admin update fee config: guarantee_percentage must be between 0 and 1: %w", domain.ErrInvalidAmount)
	}
	if minFeeCents < 0 {
		return nil, fmt.Errorf("admin update fee config: min_fee_cents must be non-negative: %w", domain.ErrInvalidAmount)
	}
	if maxFeeCents != nil && *maxFeeCents < minFeeCents {
		return nil, fmt.Errorf("admin update fee config: max_fee_cents must be >= min_fee_cents: %w", domain.ErrInvalidAmount)
	}
	if leadGenPercentage < 0 || leadGenPercentage > 1 {
		return nil, fmt.Errorf("admin update fee config: lead_gen_percentage must be between 0 and 1: %w", domain.ErrInvalidAmount)
	}
	if leadGenMinFeeCents < 0 {
		return nil, fmt.Errorf("admin update fee config: lead_gen_min_fee_cents must be non-negative: %w", domain.ErrInvalidAmount)
	}
	if leadGenMaxFeeCents != nil && *leadGenMaxFeeCents < leadGenMinFeeCents {
		return nil, fmt.Errorf("admin update fee config: lead_gen_max_fee_cents must be >= lead_gen_min_fee_cents: %w", domain.ErrInvalidAmount)
	}

	return s.repo.UpdateFeeConfig(ctx, categoryID, feePercentage, guaranteePercentage, minFeeCents, maxFeeCents, leadGenEnabled, leadGenPercentage, leadGenMinFeeCents, leadGenMaxFeeCents)
}

// GetRevenueReport returns aggregated revenue data for a date range.
func (s *PaymentService) GetRevenueReport(ctx context.Context, startTime, endTime *time.Time, groupBy string) (*domain.RevenueReport, error) {
	return s.repo.GetRevenueReport(ctx, startTime, endTime, groupBy)
}
