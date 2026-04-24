package service

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/account"
	"github.com/stripe/stripe-go/v82/accountlink"
	"github.com/stripe/stripe-go/v82/invoice"
	"github.com/stripe/stripe-go/v82/loginlink"
	"github.com/stripe/stripe-go/v82/paymentintent"
	"github.com/stripe/stripe-go/v82/paymentmethod"
	"github.com/stripe/stripe-go/v82/refund"
	"github.com/stripe/stripe-go/v82/setupintent"
	stripesub "github.com/stripe/stripe-go/v82/subscription"
	"github.com/stripe/stripe-go/v82/transfer"
)

// StripeService wraps Stripe SDK operations.
type StripeService struct {
	devMode bool
	dev     *DevStore
}

// NewStripeService creates a new StripeService.
// Dev mode activates when STRIPE_SECRET_KEY is absent, a placeholder value
// ("sk_test_..." from the committed .env template), or anything too short to
// be a real Stripe key. Real test/live keys start with sk_test_/sk_live_ and
// are ~30+ chars, so the length heuristic is safe.
func NewStripeService() *StripeService {
	key := os.Getenv("STRIPE_SECRET_KEY")
	devMode := isPlaceholderStripeKey(key)
	if devMode {
		slog.Warn("Stripe service running in dev mode (STRIPE_SECRET_KEY missing or placeholder); payment/subscription flows use an in-memory store")
	}
	return &StripeService{devMode: devMode, dev: newDevStore()}
}

// IsDevMode lets the service layer branch on Stripe availability.
func (s *StripeService) IsDevMode() bool { return s.devMode }

// DevStore exposes the backing store for service-layer dev paths. Lazily
// initializes if a caller (e.g. tests) constructed StripeService directly
// without NewStripeService.
func (s *StripeService) DevStore() *DevStore {
	if s.dev == nil {
		s.dev = newDevStore()
	}
	return s.dev
}

func isPlaceholderStripeKey(key string) bool {
	if key == "" {
		return true
	}
	// Real keys are sk_test_<24+ chars> or sk_live_<24+ chars>. The
	// committed .env template uses "sk_test_..." which satisfies the prefix
	// but not the length, so this rejects it.
	if !strings.HasPrefix(key, "sk_test_") && !strings.HasPrefix(key, "sk_live_") {
		return true
	}
	if len(key) < 24 {
		return true
	}
	if strings.Contains(key, "...") {
		return true
	}
	return false
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
		slog.Info("dev mode: CreateSetupIntent issued dev client_secret", "customerID", customerID)
		return s.DevStore().NewSetupIntent(customerID), nil
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
		return s.DevStore().ListPaymentMethods(customerStripeID), nil
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
		s.DevStore().DeletePaymentMethod(paymentMethodID)
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

// CreatePlatformTransfer transfers funds from the platform's Stripe balance to a
// provider's Connect account. Unlike CreateTransfer, no SourceTransaction is set
// because the funds come from the platform balance (e.g. for advance disbursements).
func (s *StripeService) CreatePlatformTransfer(ctx context.Context, amountCents int64, currency string, destinationAccountID string) (string, error) {
	if s.devMode {
		return s.DevStore().RecordAdvance(destinationAccountID, amountCents), nil
	}

	params := &stripe.TransferParams{
		Amount:      stripe.Int64(amountCents),
		Currency:    stripe.String(currency),
		Destination: stripe.String(destinationAccountID),
	}

	t, err := transfer.New(params)
	if err != nil {
		return "", fmt.Errorf("create platform transfer: %w", err)
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

// --- BNPL Stripe methods ---

// CreateOffSessionPaymentIntent creates a PaymentIntent with confirm=true and off_session=true.
// This is used for charging saved payment methods for scheduled installments.
func (s *StripeService) CreateOffSessionPaymentIntent(ctx context.Context, amountCents int64, currency string, customerStripeID string, paymentMethodID string, metadata map[string]string) (string, string, error) {
	if s.devMode {
		slog.Info("dev mode: stub CreateOffSessionPaymentIntent", "amountCents", amountCents, "customerStripeID", customerStripeID)
		key := "pi_dev_offsession_" + customerStripeID
		if metadata != nil {
			if ik, ok := metadata["idempotency_key"]; ok {
				key = "pi_dev_offsession_" + ik
			}
		}
		return key, "pi_dev_secret_offsession_" + customerStripeID, nil
	}

	params := &stripe.PaymentIntentParams{
		Amount:        stripe.Int64(amountCents),
		Currency:      stripe.String(currency),
		Customer:      stripe.String(customerStripeID),
		PaymentMethod: stripe.String(paymentMethodID),
		OffSession:    stripe.Bool(true),
		Confirm:       stripe.Bool(true),
	}
	for k, v := range metadata {
		params.AddMetadata(k, v)
	}

	pi, err := paymentintent.New(params)
	if err != nil {
		return "", "", fmt.Errorf("create off-session payment intent: %w", err)
	}
	return pi.ID, pi.ClientSecret, nil
}

// --- Insurance Stripe methods ---

// CreateInsurancePaymentIntent creates a PaymentIntent for an insurance premium.
// Unlike regular payments, insurance premiums are pure platform revenue — no destination charge.
func (s *StripeService) CreateInsurancePaymentIntent(ctx context.Context, amountCents int64, currency string, idempotencyKey string, policyID string) (string, string, error) {
	if s.devMode {
		slog.Info("dev mode: stub CreateInsurancePaymentIntent", "amountCents", amountCents, "policyID", policyID)
		return "pi_ins_dev_" + idempotencyKey, "pi_ins_dev_secret_" + idempotencyKey, nil
	}

	params := &stripe.PaymentIntentParams{
		Amount:   stripe.Int64(amountCents),
		Currency: stripe.String(currency),
	}
	params.AddMetadata("type", "insurance_premium")
	params.AddMetadata("policy_id", policyID)
	params.IdempotencyKey = stripe.String(idempotencyKey)

	pi, err := paymentintent.New(params)
	if err != nil {
		return "", "", fmt.Errorf("create insurance payment intent: %w", err)
	}
	return pi.ID, pi.ClientSecret, nil
}

// --- Subscription Stripe methods ---

// CreateStripeSubscription creates a Stripe subscription for a customer.
// Returns the Stripe subscription ID and client secret (for SCA confirmation if needed).
func (s *StripeService) CreateStripeSubscription(ctx context.Context, customerID, stripePriceID, paymentMethodID string) (string, string, error) {
	if s.devMode {
		sub := s.DevStore().UpsertSubscription(customerID, stripePriceID, paymentMethodID)
		return sub.ID, "", nil
	}

	params := &stripe.SubscriptionParams{
		Items: []*stripe.SubscriptionItemsParams{
			{
				Price: stripe.String(stripePriceID),
			},
		},
		PaymentBehavior:      stripe.String("default_incomplete"),
		DefaultPaymentMethod: stripe.String(paymentMethodID),
	}
	params.AddExpand("latest_invoice.payment_intent")
	params.AddMetadata("platform_customer_id", customerID)

	sub, err := stripesub.New(params)
	if err != nil {
		return "", "", fmt.Errorf("create stripe subscription: %w", err)
	}

	var clientSecret string
	if sub.LatestInvoice != nil && sub.LatestInvoice.ConfirmationSecret != nil {
		clientSecret = sub.LatestInvoice.ConfirmationSecret.ClientSecret
	}

	return sub.ID, clientSecret, nil
}

// CancelStripeSubscription cancels a Stripe subscription.
func (s *StripeService) CancelStripeSubscription(ctx context.Context, stripeSubscriptionID string, cancelImmediately bool) error {
	if s.devMode {
		s.DevStore().CancelSubscription(stripeSubscriptionID)
		return nil
	}

	if cancelImmediately {
		_, err := stripesub.Cancel(stripeSubscriptionID, nil)
		if err != nil {
			return fmt.Errorf("cancel stripe subscription: %w", err)
		}
	} else {
		params := &stripe.SubscriptionParams{
			CancelAtPeriodEnd: stripe.Bool(true),
		}
		_, err := stripesub.Update(stripeSubscriptionID, params)
		if err != nil {
			return fmt.Errorf("cancel stripe subscription at period end: %w", err)
		}
	}

	return nil
}

// UpdateStripeSubscription updates a Stripe subscription to a new price.
// Returns the updated subscription ID and the proration amount in cents.
func (s *StripeService) UpdateStripeSubscription(ctx context.Context, stripeSubscriptionID, newStripePriceID string) (string, int64, error) {
	if s.devMode {
		// The subscription row may live in the DB from a prior session
		// (DevStore resets on restart). Tolerate a miss — the DB update is
		// the source of truth in dev mode.
		s.DevStore().UpdateSubscriptionPrice(stripeSubscriptionID, newStripePriceID)
		return stripeSubscriptionID, 0, nil
	}

	// Get current subscription to find the item ID.
	sub, err := stripesub.Get(stripeSubscriptionID, nil)
	if err != nil {
		return "", 0, fmt.Errorf("get stripe subscription for update: %w", err)
	}

	if len(sub.Items.Data) == 0 {
		return "", 0, fmt.Errorf("update stripe subscription: no items found")
	}

	itemID := sub.Items.Data[0].ID

	params := &stripe.SubscriptionParams{
		Items: []*stripe.SubscriptionItemsParams{
			{
				ID:    stripe.String(itemID),
				Price: stripe.String(newStripePriceID),
			},
		},
		ProrationBehavior: stripe.String("create_prorations"),
	}

	updated, err := stripesub.Update(stripeSubscriptionID, params)
	if err != nil {
		return "", 0, fmt.Errorf("update stripe subscription: %w", err)
	}

	return updated.ID, 0, nil
}

// ListStripeInvoices lists invoices for a Stripe subscription.
func (s *StripeService) ListStripeInvoices(ctx context.Context, stripeSubscriptionID string) ([]*domain.Invoice, error) {
	if s.devMode {
		slog.Info("dev mode: stub ListStripeInvoices", "subscriptionID", stripeSubscriptionID)
		return []*domain.Invoice{}, nil
	}

	params := &stripe.InvoiceListParams{
		Subscription: stripe.String(stripeSubscriptionID),
	}
	params.Filters.AddFilter("limit", "", "50")

	var invoices []*domain.Invoice
	i := invoice.List(params)
	for i.Next() {
		inv := i.Invoice()

		di := &domain.Invoice{
			ID:              inv.ID,
			SubscriptionID:  stripeSubscriptionID,
			StripeInvoiceID: inv.ID,
			AmountCents:     inv.AmountDue,
			Status:          string(inv.Status),
			PDFURL:          inv.InvoicePDF,
		}

		if inv.PeriodStart > 0 {
			t := time.Unix(inv.PeriodStart, 0)
			di.PeriodStart = &t
		}
		if inv.PeriodEnd > 0 {
			t := time.Unix(inv.PeriodEnd, 0)
			di.PeriodEnd = &t
		}
		if inv.StatusTransitions != nil && inv.StatusTransitions.PaidAt > 0 {
			t := time.Unix(inv.StatusTransitions.PaidAt, 0)
			di.PaidAt = &t
		}

		invoices = append(invoices, di)
	}
	if err := i.Err(); err != nil {
		return nil, fmt.Errorf("list stripe invoices: %w", err)
	}

	return invoices, nil
}
