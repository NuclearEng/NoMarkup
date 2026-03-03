package service

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/account"
	"github.com/stripe/stripe-go/v82/accountlink"
	"github.com/stripe/stripe-go/v82/loginlink"
	"github.com/stripe/stripe-go/v82/paymentintent"
	"github.com/stripe/stripe-go/v82/paymentmethod"
	"github.com/stripe/stripe-go/v82/refund"
	"github.com/stripe/stripe-go/v82/setupintent"
	"github.com/stripe/stripe-go/v82/transfer"
)

// StripeService wraps Stripe SDK operations.
type StripeService struct {
	devMode bool
}

// NewStripeService creates a new StripeService.
// It checks if STRIPE_SECRET_KEY is set; if not, it operates in dev mode with stubs.
func NewStripeService() *StripeService {
	devMode := os.Getenv("STRIPE_SECRET_KEY") == ""
	if devMode {
		slog.Warn("STRIPE_SECRET_KEY not set, running Stripe service in dev mode with stubs")
	}
	return &StripeService{devMode: devMode}
}

// CreateStripeAccount creates a Stripe Connect Express account.
func (s *StripeService) CreateStripeAccount(ctx context.Context, email, businessName string) (string, error) {
	if s.devMode {
		slog.Info("dev mode: stub CreateStripeAccount", "email", email)
		return "acct_dev_" + email, nil
	}

	params := &stripe.AccountParams{
		Type:         stripe.String(string(stripe.AccountTypeExpress)),
		Email:        stripe.String(email),
		BusinessType: stripe.String(string(stripe.AccountBusinessTypeIndividual)),
		Capabilities: &stripe.AccountCapabilitiesParams{
			CardPayments: &stripe.AccountCapabilitiesCardPaymentsParams{
				Requested: stripe.Bool(true),
			},
			Transfers: &stripe.AccountCapabilitiesTransfersParams{
				Requested: stripe.Bool(true),
			},
		},
	}
	if businessName != "" {
		params.BusinessProfile = &stripe.AccountBusinessProfileParams{
			Name: stripe.String(businessName),
		}
	}

	acct, err := account.New(params)
	if err != nil {
		return "", fmt.Errorf("create stripe account: %w", err)
	}
	return acct.ID, nil
}

// GetOnboardingLink generates an AccountLink for Stripe Connect onboarding.
func (s *StripeService) GetOnboardingLink(ctx context.Context, accountID, returnURL, refreshURL string) (string, error) {
	if s.devMode {
		slog.Info("dev mode: stub GetOnboardingLink", "accountID", accountID)
		return "https://stripe.com/dev-onboarding?account=" + accountID, nil
	}

	params := &stripe.AccountLinkParams{
		Account:    stripe.String(accountID),
		Type:       stripe.String(string(stripe.AccountLinkTypeAccountOnboarding)),
		ReturnURL:  stripe.String(returnURL),
		RefreshURL: stripe.String(refreshURL),
	}

	link, err := accountlink.New(params)
	if err != nil {
		return "", fmt.Errorf("get onboarding link: %w", err)
	}
	return link.URL, nil
}

// GetAccountStatus retrieves the status of a Stripe Connect account.
func (s *StripeService) GetAccountStatus(ctx context.Context, accountID string) (*domain.StripeAccountStatus, error) {
	if s.devMode {
		slog.Info("dev mode: stub GetAccountStatus", "accountID", accountID)
		return &domain.StripeAccountStatus{
			AccountID:        accountID,
			ChargesEnabled:   true,
			PayoutsEnabled:   true,
			DetailsSubmitted: true,
		}, nil
	}

	acct, err := account.GetByID(accountID, nil)
	if err != nil {
		return nil, fmt.Errorf("get account status: %w", err)
	}

	var requirements []string
	if acct.Requirements != nil {
		requirements = append(requirements, acct.Requirements.CurrentlyDue...)
	}

	return &domain.StripeAccountStatus{
		AccountID:        acct.ID,
		ChargesEnabled:   acct.ChargesEnabled,
		PayoutsEnabled:   acct.PayoutsEnabled,
		DetailsSubmitted: acct.DetailsSubmitted,
		Requirements:     requirements,
	}, nil
}

// GetDashboardLink generates a LoginLink for the Stripe Express dashboard.
func (s *StripeService) GetDashboardLink(ctx context.Context, accountID string) (string, error) {
	if s.devMode {
		slog.Info("dev mode: stub GetDashboardLink", "accountID", accountID)
		return "https://dashboard.stripe.com/dev?account=" + accountID, nil
	}

	params := &stripe.LoginLinkParams{
		Account: stripe.String(accountID),
	}

	link, err := loginlink.New(params)
	if err != nil {
		return "", fmt.Errorf("get dashboard link: %w", err)
	}
	return link.URL, nil
}

// CreateSetupIntent creates a SetupIntent for saving customer payment methods.
func (s *StripeService) CreateSetupIntent(ctx context.Context, customerID string) (string, error) {
	if s.devMode {
		slog.Info("dev mode: stub CreateSetupIntent", "customerID", customerID)
		return "seti_dev_secret_" + customerID, nil
	}

	params := &stripe.SetupIntentParams{
		PaymentMethodTypes: stripe.StringSlice([]string{"card"}),
	}
	// If the customer has a Stripe customer ID, attach it.
	if customerID != "" {
		params.AddMetadata("platform_customer_id", customerID)
	}

	si, err := setupintent.New(params)
	if err != nil {
		return "", fmt.Errorf("create setup intent: %w", err)
	}
	return si.ClientSecret, nil
}

// ListPaymentMethods lists a customer's payment methods.
func (s *StripeService) ListPaymentMethods(ctx context.Context, customerStripeID string) ([]domain.PaymentMethod, error) {
	if s.devMode {
		slog.Info("dev mode: stub ListPaymentMethods", "customerStripeID", customerStripeID)
		return []domain.PaymentMethod{}, nil
	}

	params := &stripe.PaymentMethodListParams{
		Customer: stripe.String(customerStripeID),
		Type:     stripe.String(string(stripe.PaymentMethodTypeCard)),
	}

	var methods []domain.PaymentMethod
	i := paymentmethod.List(params)
	for i.Next() {
		pm := i.PaymentMethod()
		m := domain.PaymentMethod{
			ID:   pm.ID,
			Type: string(pm.Type),
		}
		if pm.Card != nil {
			m.LastFour = pm.Card.Last4
			m.Brand = string(pm.Card.Brand)
			m.ExpMonth = int32(pm.Card.ExpMonth)
			m.ExpYear = int32(pm.Card.ExpYear)
		}
		methods = append(methods, m)
	}
	if err := i.Err(); err != nil {
		return nil, fmt.Errorf("list payment methods: %w", err)
	}
	return methods, nil
}

// DeletePaymentMethod detaches a payment method.
func (s *StripeService) DeletePaymentMethod(ctx context.Context, paymentMethodID string) error {
	if s.devMode {
		slog.Info("dev mode: stub DeletePaymentMethod", "paymentMethodID", paymentMethodID)
		return nil
	}

	_, err := paymentmethod.Detach(paymentMethodID, nil)
	if err != nil {
		return fmt.Errorf("delete payment method: %w", err)
	}
	return nil
}

// CreatePaymentIntent creates a PaymentIntent with a destination charge to a Connect account.
// Uses capture_method="manual" for escrow functionality.
func (s *StripeService) CreatePaymentIntent(ctx context.Context, amountCents int64, currency string, providerAccountID string, platformFeeCents int64, idempotencyKey string) (string, string, error) {
	if s.devMode {
		slog.Info("dev mode: stub CreatePaymentIntent", "amountCents", amountCents)
		return "pi_dev_" + idempotencyKey, "pi_dev_secret_" + idempotencyKey, nil
	}

	params := &stripe.PaymentIntentParams{
		Amount:        stripe.Int64(amountCents),
		Currency:      stripe.String(currency),
		CaptureMethod: stripe.String(string(stripe.PaymentIntentCaptureMethodManual)),
		TransferData: &stripe.PaymentIntentTransferDataParams{
			Destination: stripe.String(providerAccountID),
		},
		ApplicationFeeAmount: stripe.Int64(platformFeeCents),
	}
	params.IdempotencyKey = stripe.String(idempotencyKey)

	pi, err := paymentintent.New(params)
	if err != nil {
		return "", "", fmt.Errorf("create payment intent: %w", err)
	}
	return pi.ID, pi.ClientSecret, nil
}

// CapturePaymentIntent captures a held PaymentIntent (moves to escrow).
func (s *StripeService) CapturePaymentIntent(ctx context.Context, paymentIntentID string) error {
	if s.devMode {
		slog.Info("dev mode: stub CapturePaymentIntent", "paymentIntentID", paymentIntentID)
		return nil
	}

	_, err := paymentintent.Capture(paymentIntentID, nil)
	if err != nil {
		return fmt.Errorf("capture payment intent: %w", err)
	}
	return nil
}

// CreateTransfer transfers funds to a provider's Connect account.
func (s *StripeService) CreateTransfer(ctx context.Context, amountCents int64, currency string, destinationAccountID string, paymentIntentID string) (string, error) {
	if s.devMode {
		slog.Info("dev mode: stub CreateTransfer", "amountCents", amountCents)
		return "tr_dev_" + paymentIntentID, nil
	}

	params := &stripe.TransferParams{
		Amount:            stripe.Int64(amountCents),
		Currency:          stripe.String(currency),
		Destination:       stripe.String(destinationAccountID),
		SourceTransaction: stripe.String(paymentIntentID),
	}

	t, err := transfer.New(params)
	if err != nil {
		return "", fmt.Errorf("create transfer: %w", err)
	}
	return t.ID, nil
}

// CreateRefund issues a refund for a PaymentIntent.
func (s *StripeService) CreateRefund(ctx context.Context, paymentIntentID string, amountCents int64) (string, error) {
	if s.devMode {
		slog.Info("dev mode: stub CreateRefund", "paymentIntentID", paymentIntentID)
		return "re_dev_" + paymentIntentID, nil
	}

	params := &stripe.RefundParams{
		PaymentIntent: stripe.String(paymentIntentID),
	}
	if amountCents > 0 {
		params.Amount = stripe.Int64(amountCents)
	}

	r, err := refund.New(params)
	if err != nil {
		return "", fmt.Errorf("create refund: %w", err)
	}
	return r.ID, nil
}
