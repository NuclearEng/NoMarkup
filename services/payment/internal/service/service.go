package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

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
	if feeConfig.MaxFeeCents != nil && platformFee > *feeConfig.MaxFeeCents {
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
		if feeConfig.LeadGenMaxFeeCents != nil && leadGenFee > *feeConfig.LeadGenMaxFeeCents {
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
		PlatformFeeCents:    breakdown.PlatformFeeCents,
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
func (s *PaymentService) ProcessPayment(ctx context.Context, paymentID string, paymentMethodID string) (*domain.Payment, error) {
	payment, err := s.repo.GetPayment(ctx, paymentID)
	if err != nil {
		return nil, err
	}

	if payment.Status != "pending" {
		return nil, fmt.Errorf("process payment: %w", domain.ErrPaymentAlreadyProcessed)
	}

	// Update status to processing.
	if err := s.repo.UpdatePaymentStatus(ctx, paymentID, "processing"); err != nil {
		return nil, err
	}

	// Capture the payment intent.
	if payment.StripePaymentIntentID != "" {
		if err := s.stripe.CapturePaymentIntent(ctx, payment.StripePaymentIntentID); err != nil {
			// Mark as failed if capture fails.
			_ = s.repo.UpdatePaymentStatus(ctx, paymentID, "failed")
			return nil, fmt.Errorf("process payment capture: %w", err)
		}
	}

	// Update status to escrow on success.
	if err := s.repo.UpdatePaymentStatus(ctx, paymentID, "escrow"); err != nil {
		return nil, err
	}

	return s.repo.GetPayment(ctx, paymentID)
}

// advanceRepaymentRate is the percentage of provider payout deducted for advance repayment.
const advanceRepaymentRate = 0.20

// ReleaseEscrow creates a Stripe transfer to the provider and updates status.
// If the provider has active advances, a portion of the payout is withheld for repayment.
func (s *PaymentService) ReleaseEscrow(ctx context.Context, paymentID string, reason string) (*domain.Payment, error) {
	payment, err := s.repo.GetPayment(ctx, paymentID)
	if err != nil {
		return nil, err
	}

	if payment.Status != "escrow" {
		return nil, fmt.Errorf("release escrow: %w", domain.ErrInvalidStatus)
	}

	// Get provider Stripe account.
	providerAccountID, err := s.repo.GetStripeAccountID(ctx, payment.ProviderID)
	if err != nil {
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

	transferID, err := s.stripe.CreateTransfer(ctx, transferAmount, "usd", providerAccountID, payment.StripePaymentIntentID)
	if err != nil {
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

	// Update stripe fields with transfer ID.
	if err := s.repo.UpdateStripeFields(ctx, paymentID, "", "", transferID); err != nil {
		return nil, err
	}

	// Update status to released.
	if err := s.repo.UpdatePaymentStatus(ctx, paymentID, "released"); err != nil {
		return nil, err
	}

	return s.repo.GetPayment(ctx, paymentID)
}

// CreateRefund issues a Stripe refund and updates the payment record.
func (s *PaymentService) CreateRefund(ctx context.Context, paymentID string, amountCents int64, reason string) (*domain.Payment, error) {
	payment, err := s.repo.GetPayment(ctx, paymentID)
	if err != nil {
		return nil, err
	}

	if payment.Status != "escrow" && payment.Status != "released" && payment.Status != "completed" {
		return nil, fmt.Errorf("create refund: %w", domain.ErrInvalidStatus)
	}

	// Determine refund amount: 0 means full refund.
	refundAmount := amountCents
	if refundAmount == 0 {
		refundAmount = payment.AmountCents
	}

	// Create Stripe refund.
	refundID, err := s.stripe.CreateRefund(ctx, payment.StripePaymentIntentID, amountCents)
	if err != nil {
		return nil, fmt.Errorf("create refund stripe: %w", err)
	}

	// Determine status: full refund or partial.
	refundStatus := "refunded"
	if refundAmount < payment.AmountCents {
		refundStatus = "partially_refunded"
	}

	now := time.Now()
	if err := s.repo.UpdateRefund(ctx, paymentID, refundAmount, reason, now, refundID, refundStatus); err != nil {
		return nil, err
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

// DeletePaymentMethod detaches a payment method.
func (s *PaymentService) DeletePaymentMethod(ctx context.Context, paymentMethodID string) error {
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
