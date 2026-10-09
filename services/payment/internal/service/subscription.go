package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stripe/stripe-go/v82"
)

// SubscriptionService implements subscription business logic.
type SubscriptionService struct {
	repo             domain.SubscriptionRepository
	stripe           *StripeService
	customers        *CustomerProvisioner
	webhookValidator WebhookEventValidator
}

// NewSubscriptionService creates a new subscription service.
func NewSubscriptionService(repo domain.SubscriptionRepository, stripe *StripeService) *SubscriptionService {
	return &SubscriptionService{repo: repo, stripe: stripe}
}

// SetCustomerProvisioner supplies the Stripe Customer used when a live
// subscription is created. Live creates fail closed when it is missing.
func (s *SubscriptionService) SetCustomerProvisioner(p *CustomerProvisioner) {
	s.customers = p
}

// SetWebhookValidator injects a WebhookEventValidator used to verify the Stripe
// signature on subscription webhook deliveries. This is the ONLY supported way
// to enable signature verification; there is no env-based bypass. Production
// callers must wire a StripeWebhookValidator at startup (see cmd/server/main.go).
func (s *SubscriptionService) SetWebhookValidator(v WebhookEventValidator) {
	s.webhookValidator = v
}

// VerifyWebhookSignature verifies the raw subscription webhook payload against
// its Stripe-Signature header. Security: verification is MANDATORY and fails
// closed — if no validator is configured we refuse the event rather than
// processing an unauthenticated payload. A non-nil error means the caller MUST
// reject the webhook with a 4xx (never process it).
func (s *SubscriptionService) VerifyWebhookSignature(payload []byte, signature string) (stripe.Event, error) {
	if s.webhookValidator == nil {
		slog.Error("subscription webhook validator not configured, refusing event")
		return stripe.Event{}, fmt.Errorf("webhook validator not configured")
	}
	return s.webhookValidator.ConstructEvent(payload, signature)
}

// ListTiers returns all active subscription tiers.
func (s *SubscriptionService) ListTiers(ctx context.Context) ([]*domain.SubscriptionTier, error) {
	return s.repo.ListTiers(ctx)
}

// GetTier returns a subscription tier by ID.
func (s *SubscriptionService) GetTier(ctx context.Context, tierID string) (*domain.SubscriptionTier, error) {
	return s.repo.GetTier(ctx, tierID)
}

// subscriptionCreateStatus is active only when nothing is left to collect.
// A client secret, or a live paid price with no secret yet, stays incomplete
// until invoice.paid. Dev mode with an empty secret stays active so local
// stacks without Stripe keys can exercise plan UX.
func subscriptionCreateStatus(priceCents int64, devMode bool, clientSecret string) string {
	if clientSecret != "" {
		return "incomplete"
	}
	if priceCents > 0 && !devMode {
		return "incomplete"
	}
	return "active"
}

// CreateSubscription creates a new subscription for a user.
func (s *SubscriptionService) CreateSubscription(ctx context.Context, userID, tierID, billingInterval, paymentMethodID string) (*domain.Subscription, string, error) {
	// Verify the tier exists.
	tier, err := s.repo.GetTier(ctx, tierID)
	if err != nil {
		return nil, "", err
	}

	// Entitled rows block a second plan. An unpaid incomplete row is expired
	// and replaced so a lost PaymentIntent confirmation can be retried
	// without granting the tier or leaving two Stripe subscriptions open.
	existing, err := s.repo.GetOpenSubscription(ctx, userID)
	if err == nil && existing != nil {
		if existing.Status != "incomplete" {
			return nil, "", fmt.Errorf("create subscription: %w", domain.ErrAlreadySubscribed)
		}
		if existing.StripeSubscriptionID != "" {
			if cancelErr := s.stripe.CancelStripeSubscription(ctx, existing.StripeSubscriptionID, true); cancelErr != nil {
				return nil, "", fmt.Errorf("replace unpaid subscription: %w", cancelErr)
			}
		}
		if statusErr := s.repo.UpdateSubscriptionStatus(ctx, existing.ID, "expired"); statusErr != nil {
			return nil, "", fmt.Errorf("replace unpaid subscription: %w", statusErr)
		}
	}

	// Determine the price based on billing interval.
	var priceCents int64
	var stripePriceID string
	switch billingInterval {
	case "annual":
		priceCents = tier.AnnualPriceCents
		stripePriceID = tier.StripePriceIDAnnual
	default:
		billingInterval = "monthly"
		priceCents = tier.MonthlyPriceCents
		stripePriceID = tier.StripePriceIDMonthly
	}

	// Live mode must bill a real Stripe Customer. Dev mode keeps the local stub.
	stripeCustomerID := ""
	if s.stripe != nil && !s.stripe.devMode {
		if s.customers == nil {
			return nil, "", fmt.Errorf("create subscription: stripe customer provisioner not configured")
		}
		id, custErr := s.customers.EnsureCustomer(ctx, userID)
		if custErr != nil {
			return nil, "", fmt.Errorf("create subscription: stripe customer: %w", custErr)
		}
		if id == "" {
			return nil, "", fmt.Errorf("create subscription: stripe customer missing")
		}
		stripeCustomerID = id
	}

	// Create the Stripe subscription.
	stripeSubID, clientSecret, err := s.stripe.CreateStripeSubscription(ctx, userID, stripeCustomerID, stripePriceID, paymentMethodID)
	if err != nil {
		return nil, "", fmt.Errorf("create subscription stripe: %w", err)
	}

	now := time.Now()
	periodEnd := now.AddDate(0, 1, 0)
	if billingInterval == "annual" {
		periodEnd = now.AddDate(1, 0, 0)
	}

	sub := &domain.Subscription{
		ID:                   uuid.New().String(),
		UserID:               userID,
		TierID:               tierID,
		Tier:                 tier,
		Status:               subscriptionCreateStatus(priceCents, s.stripe.devMode, clientSecret),
		BillingInterval:      billingInterval,
		CurrentPriceCents:    priceCents,
		StripeSubscriptionID: stripeSubID,
		CurrentPeriodStart:   &now,
		CurrentPeriodEnd:     &periodEnd,
	}

	if err := s.repo.CreateSubscription(ctx, sub); err != nil {
		return nil, "", err
	}

	return sub, clientSecret, nil
}

// GetSubscription returns the user's active subscription.
func (s *SubscriptionService) GetSubscription(ctx context.Context, userID string) (*domain.Subscription, error) {
	return s.repo.GetSubscription(ctx, userID)
}

// CancelSubscription cancels a user's subscription.
func (s *SubscriptionService) CancelSubscription(ctx context.Context, userID, reason string, cancelImmediately bool) (*domain.Subscription, error) {
	sub, err := s.repo.GetSubscription(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("cancel subscription: %w", domain.ErrNoActiveSubscription)
	}

	// Cancel in Stripe.
	if err := s.stripe.CancelStripeSubscription(ctx, sub.StripeSubscriptionID, cancelImmediately); err != nil {
		return nil, fmt.Errorf("cancel subscription stripe: %w", err)
	}

	now := time.Now()
	status := "cancelled"
	if !cancelImmediately {
		// Cancel at end of period: keep active until period end.
		status = "active"
	}

	if err := s.repo.CancelSubscription(ctx, sub.ID, now, status); err != nil {
		return nil, err
	}

	return s.repo.GetSubscription(ctx, userID)
}

// ChangeSubscriptionTier changes the user's subscription to a new tier.
// The bool is false when the new plan is not stored yet because the
// proration invoice is unpaid. The string is that invoice's client secret.
func (s *SubscriptionService) ChangeSubscriptionTier(ctx context.Context, userID, newTierID, billingInterval string) (*domain.Subscription, int64, string, bool, error) {
	sub, err := s.repo.GetSubscription(ctx, userID)
	if err != nil {
		return nil, 0, "", false, fmt.Errorf("change tier: %w", domain.ErrNoActiveSubscription)
	}

	newTier, err := s.repo.GetTier(ctx, newTierID)
	if err != nil {
		return nil, 0, "", false, err
	}

	if sub.TierID == newTierID && sub.BillingInterval == billingInterval {
		return nil, 0, "", false, fmt.Errorf("change tier: %w", domain.ErrInvalidTierChange)
	}

	// Determine new price and Stripe price ID.
	var newPriceCents int64
	var stripePriceID string
	switch billingInterval {
	case "annual":
		newPriceCents = newTier.AnnualPriceCents
		stripePriceID = newTier.StripePriceIDAnnual
	default:
		billingInterval = "monthly"
		newPriceCents = newTier.MonthlyPriceCents
		stripePriceID = newTier.StripePriceIDMonthly
	}

	// Update the Stripe subscription. An unpaid proration invoice must not
	// change the local tier: plan caps read that column.
	update, err := s.stripe.UpdateStripeSubscription(ctx, sub.StripeSubscriptionID, stripePriceID)
	if err != nil {
		return nil, 0, "", false, fmt.Errorf("change tier stripe: %w", err)
	}
	if !update.Applied {
		return sub, update.ProrationCents, update.ClientSecret, false, nil
	}

	if err := s.repo.UpdateSubscriptionTier(ctx, sub.ID, newTierID, newPriceCents, billingInterval, update.SubscriptionID); err != nil {
		return nil, 0, "", false, err
	}

	updatedSub, err := s.repo.GetSubscription(ctx, userID)
	if err != nil {
		return nil, 0, "", false, err
	}

	return updatedSub, update.ProrationCents, "", true, nil
}

// GetUsage returns the user's current usage against subscription limits.
func (s *SubscriptionService) GetUsage(ctx context.Context, userID string) (*domain.SubscriptionUsage, error) {
	// Get the user's subscription (or use free tier defaults).
	sub, err := s.repo.GetSubscription(ctx, userID)

	var maxActiveBids int32 = 3
	var maxServiceCategories int32 = 1
	var maxPortfolioImages int32 = 5
	var feeDiscount float64

	if err == nil && sub != nil && sub.Tier != nil {
		maxActiveBids = sub.Tier.MaxActiveBids
		maxServiceCategories = sub.Tier.MaxServiceCategories
		maxPortfolioImages = sub.Tier.PortfolioImageLimit
		feeDiscount = sub.Tier.FeeDiscountPercentage
	}

	activeBids, serviceCategories, portfolioImages, err := s.repo.GetUsage(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Calculate effective fee: base platform fee minus subscription discount.
	baseFee := 0.10 // 10% default platform fee
	effectiveFee := baseFee - feeDiscount
	if effectiveFee < 0 {
		effectiveFee = 0
	}

	return &domain.SubscriptionUsage{
		ActiveBids:           activeBids,
		MaxActiveBids:        maxActiveBids,
		ServiceCategories:    serviceCategories,
		MaxServiceCategories: maxServiceCategories,
		PortfolioImages:      portfolioImages,
		MaxPortfolioImages:   maxPortfolioImages,
		CurrentFeePercentage: effectiveFee,
	}, nil
}

// CheckFeatureAccess checks if a user has access to a specific feature.
// Returns (hasAccess, requiredTier) where requiredTier is the tier slug needed to unlock the feature.
func (s *SubscriptionService) CheckFeatureAccess(ctx context.Context, userID, feature string) (bool, string) {
	sub, err := s.repo.GetSubscription(ctx, userID)
	if err != nil || sub == nil || sub.Tier == nil {
		// Free tier: check free tier features.
		switch feature {
		case "analytics":
			return false, "pro"
		case "featured_placement":
			return false, "business"
		case "instant":
			return false, "business"
		case "priority_support":
			return false, "pro"
		default:
			return true, ""
		}
	}

	tier := sub.Tier
	switch feature {
	case "analytics":
		if !tier.AnalyticsAccess {
			return false, "pro"
		}
		return true, ""
	case "featured_placement":
		if !tier.FeaturedPlacement {
			return false, "business"
		}
		return true, ""
	case "instant":
		if !tier.InstantEnabled {
			return false, "business"
		}
		return true, ""
	case "priority_support":
		if !tier.PrioritySupport {
			return false, "pro"
		}
		return true, ""
	case "verified_badge_boost":
		if !tier.VerifiedBadgeBoost {
			return false, "business"
		}
		return true, ""
	default:
		return true, ""
	}
}

// ListInvoices retrieves invoices from Stripe for a user's subscription.
//
// Admin-granted and seed subscriptions often have an empty StripeSubscriptionID
// (no Stripe object was ever created). Calling Stripe with an empty subscription
// param returns parameter_invalid_empty → Internal → HTTP 500. Treat that as
// "no billable invoices yet" and return an empty list instead.
func (s *SubscriptionService) ListInvoices(ctx context.Context, userID string) ([]*domain.Invoice, error) {
	sub, err := s.repo.GetSubscription(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list invoices: %w", domain.ErrNoActiveSubscription)
	}
	if sub == nil || strings.TrimSpace(sub.StripeSubscriptionID) == "" {
		return []*domain.Invoice{}, nil
	}

	return s.stripe.ListStripeInvoices(ctx, sub.StripeSubscriptionID)
}

// AdminListSubscriptions returns a paginated list of subscriptions with optional filters.
func (s *SubscriptionService) AdminListSubscriptions(ctx context.Context, statusFilter, tierID string, page, pageSize int) ([]*domain.Subscription, int, int64, error) {
	return s.repo.AdminListSubscriptions(ctx, statusFilter, tierID, page, pageSize)
}

// AdminUpdateTier updates a subscription tier's properties.
func (s *SubscriptionService) AdminUpdateTier(ctx context.Context, tierID string, updates map[string]interface{}) (*domain.SubscriptionTier, error) {
	// Verify the tier exists.
	_, err := s.repo.GetTier(ctx, tierID)
	if err != nil {
		return nil, err
	}
	return s.repo.UpdateTier(ctx, tierID, updates)
}

// AdminGrantSubscription grants a subscription to a user without requiring payment.
func (s *SubscriptionService) AdminGrantSubscription(ctx context.Context, userID, tierID string, durationDays int32, reason string) (*domain.Subscription, error) {
	// Verify the tier exists.
	tier, err := s.repo.GetTier(ctx, tierID)
	if err != nil {
		return nil, err
	}

	// Check for existing active subscription.
	existing, err := s.repo.GetSubscription(ctx, userID)
	if err == nil && existing != nil {
		return nil, fmt.Errorf("admin grant subscription: %w", domain.ErrAlreadySubscribed)
	}

	now := time.Now()
	periodEnd := now.AddDate(0, 0, int(durationDays))

	sub := &domain.Subscription{
		ID:                 uuid.New().String(),
		UserID:             userID,
		TierID:             tierID,
		Tier:               tier,
		Status:             "active",
		BillingInterval:    "monthly",
		CurrentPriceCents:  0, // Granted for free by admin.
		CurrentPeriodStart: &now,
		CurrentPeriodEnd:   &periodEnd,
	}

	if err := s.repo.CreateSubscription(ctx, sub); err != nil {
		return nil, err
	}

	return sub, nil
}

// HandleSubscriptionWebhook processes Stripe subscription events.
// billingReason is the invoice billing_reason. stripePriceID, when set, is
// the price Stripe has already applied. Callers verify the signature with
// stripe.webhooks.constructEvent() before this runs.
func (s *SubscriptionService) HandleSubscriptionWebhook(ctx context.Context, eventType, stripeSubscriptionID string, periodStart, periodEnd *time.Time, billingReason, stripePriceID string) error {
	switch eventType {
	case "customer.subscription.updated":
		sub, err := s.repo.GetSubscriptionByStripeID(ctx, stripeSubscriptionID)
		if err != nil {
			return nil // Don't fail for unknown subscriptions.
		}
		if periodStart != nil && periodEnd != nil {
			if err := s.repo.UpdateSubscriptionPeriod(ctx, sub.ID, *periodStart, *periodEnd); err != nil {
				return fmt.Errorf("update period: %w", err)
			}
		}
		// Price sync runs only after stripe.webhooks.constructEvent() succeeded.
		return s.applyObservedStripePrice(ctx, stripeSubscriptionID, stripePriceID)

	case "customer.subscription.deleted":
		sub, err := s.repo.GetSubscriptionByStripeID(ctx, stripeSubscriptionID)
		if err != nil {
			return nil
		}
		return s.repo.UpdateSubscriptionStatus(ctx, sub.ID, "expired")

	case "invoice.payment_failed":
		sub, err := s.repo.GetSubscriptionByStripeID(ctx, stripeSubscriptionID)
		if err != nil {
			return nil
		}
		// incomplete is not an entitlement. Promoting it to past_due would
		// grant plan caps for a charge that never succeeded.
		if sub.Status == "incomplete" {
			return nil
		}
		// A failed proration invoice for a plan change must not mark the
		// already-paid period past_due. pending_if_incomplete leaves the
		// current subscription in place.
		if billingReason == "subscription_update" {
			return nil
		}
		if sub.Status != "active" && sub.Status != "trialing" {
			return nil
		}
		return s.repo.UpdateSubscriptionStatus(ctx, sub.ID, "past_due")

	case "invoice.paid":
		sub, err := s.repo.GetSubscriptionByStripeID(ctx, stripeSubscriptionID)
		if err != nil {
			return nil
		}
		// incomplete: first invoice just confirmed. past_due: a retry succeeded.
		// active stays active. Entitlements read only active/trialing/past_due.
		if sub.Status == "past_due" || sub.Status == "incomplete" {
			if err := s.repo.UpdateSubscriptionStatus(ctx, sub.ID, "active"); err != nil {
				return err
			}
		}
		return s.applyObservedStripePrice(ctx, stripeSubscriptionID, stripePriceID)

	default:
		return nil
	}
}

// applyObservedStripePrice stores the tier Stripe has already put on a paid
// invoice or an applied subscription update. An unknown price is ignored.
// Callers run this only after stripe.webhooks.constructEvent() succeeds.
func (s *SubscriptionService) applyObservedStripePrice(ctx context.Context, stripeSubscriptionID, priceID string) error {
	if !strings.HasPrefix(priceID, "price_") {
		return nil
	}
	tier, interval, err := s.repo.GetTierByStripePriceID(ctx, priceID)
	if err != nil {
		if errors.Is(err, domain.ErrTierNotFound) {
			return nil
		}
		return err
	}
	sub, err := s.repo.GetSubscriptionByStripeID(ctx, stripeSubscriptionID)
	if err != nil {
		return nil
	}
	priceCents := tier.MonthlyPriceCents
	if interval == "annual" {
		priceCents = tier.AnnualPriceCents
	}
	if sub.TierID == tier.ID && sub.BillingInterval == interval && sub.CurrentPriceCents == priceCents {
		return nil
	}
	return s.repo.UpdateSubscriptionTier(ctx, sub.ID, tier.ID, priceCents, interval, stripeSubscriptionID)
}
