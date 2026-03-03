package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// SubscriptionWebhookHandler allows the payment service to delegate subscription
// webhook events to the subscription service without creating a circular dependency.
type SubscriptionWebhookHandler interface {
	HandleSubscriptionWebhook(ctx context.Context, eventType, stripeSubscriptionID string, periodStart, periodEnd *time.Time) error
}

// PaymentService implements payment business logic.
type PaymentService struct {
	repo    domain.PaymentRepository
	stripe  *StripeService
	subHook SubscriptionWebhookHandler
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

	// Provider payout = amount - platformFee - guaranteeFee.
	providerPayout := amountCents - platformFee - guaranteeFee

	return &domain.PaymentBreakdown{
		SubtotalCents:       amountCents,
		PlatformFeeCents:    platformFee,
		GuaranteeFeeCents:   guaranteeFee,
		TotalCents:          amountCents,
		ProviderPayoutCents: providerPayout,
		FeePercentage:       feeConfig.FeePercentage,
		GuaranteePercentage: feeConfig.GuaranteePercentage,
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

	// Create Stripe PaymentIntent.
	totalFee := breakdown.PlatformFeeCents + breakdown.GuaranteeFeeCents
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

// ReleaseEscrow creates a Stripe transfer to the provider and updates status.
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

	// Create transfer to provider.
	transferID, err := s.stripe.CreateTransfer(ctx, payment.ProviderPayoutCents, "usd", providerAccountID, payment.StripePaymentIntentID)
	if err != nil {
		return nil, fmt.Errorf("release escrow transfer: %w", err)
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
func (s *PaymentService) GetFeeConfig(ctx context.Context, categoryID *string) (*domain.FeeConfig, error) {
	if categoryID != nil && *categoryID != "" {
		fc, err := s.repo.GetFeeConfig(ctx, *categoryID)
		if err == nil {
			return fc, nil
		}
	}
	return s.repo.GetDefaultFeeConfig(ctx)
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
func (s *PaymentService) GetStripeAccountStatus(ctx context.Context, userID string) (*domain.StripeAccountStatus, error) {
	accountID, err := s.repo.GetStripeAccountID(ctx, userID)
	if err != nil {
		return nil, err
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
	return s.stripe.CreateSetupIntent(ctx, customerID)
}

// ListPaymentMethods lists a customer's payment methods.
func (s *PaymentService) ListPaymentMethods(ctx context.Context, customerStripeID string) ([]domain.PaymentMethod, error) {
	return s.stripe.ListPaymentMethods(ctx, customerStripeID)
}

// DeletePaymentMethod detaches a payment method.
func (s *PaymentService) DeletePaymentMethod(ctx context.Context, paymentMethodID string) error {
	return s.stripe.DeletePaymentMethod(ctx, paymentMethodID)
}
