package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// SubscriptionService implements subscription business logic.
type SubscriptionService struct {
	repo   domain.SubscriptionRepository
	stripe *StripeService
}

// NewSubscriptionService creates a new subscription service.
func NewSubscriptionService(repo domain.SubscriptionRepository, stripe *StripeService) *SubscriptionService {
	return &SubscriptionService{repo: repo, stripe: stripe}
}

// ListTiers returns all active subscription tiers.
func (s *SubscriptionService) ListTiers(ctx context.Context) ([]*domain.SubscriptionTier, error) {
	return s.repo.ListTiers(ctx)
}

// GetTier returns a subscription tier by ID.
func (s *SubscriptionService) GetTier(ctx context.Context, tierID string) (*domain.SubscriptionTier, error) {
	return s.repo.GetTier(ctx, tierID)
}

// CreateSubscription creates a new subscription for a user.
func (s *SubscriptionService) CreateSubscription(ctx context.Context, userID, tierID, billingInterval, paymentMethodID string) (*domain.Subscription, string, error) {
	// Verify the tier exists.
	tier, err := s.repo.GetTier(ctx, tierID)
	if err != nil {
		return nil, "", err
	}

	// Check for existing active subscription.
	existing, err := s.repo.GetSubscription(ctx, userID)
	if err == nil && existing != nil {
		return nil, "", fmt.Errorf("create subscription: %w", domain.ErrAlreadySubscribed)
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

	// Create the Stripe subscription.
	stripeSubID, clientSecret, err := s.stripe.CreateStripeSubscription(ctx, userID, stripePriceID, paymentMethodID)
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
		Status:               "active",
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
func (s *SubscriptionService) ChangeSubscriptionTier(ctx context.Context, userID, newTierID, billingInterval string) (*domain.Subscription, int64, error) {
	sub, err := s.repo.GetSubscription(ctx, userID)
	if err != nil {
		return nil, 0, fmt.Errorf("change tier: %w", domain.ErrNoActiveSubscription)
	}

	newTier, err := s.repo.GetTier(ctx, newTierID)
	if err != nil {
		return nil, 0, err
	}

	if sub.TierID == newTierID && sub.BillingInterval == billingInterval {
		return nil, 0, fmt.Errorf("change tier: %w", domain.ErrInvalidTierChange)
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

	// Update the Stripe subscription.
	newStripeSubID, prorationAmount, err := s.stripe.UpdateStripeSubscription(ctx, sub.StripeSubscriptionID, stripePriceID)
	if err != nil {
		return nil, 0, fmt.Errorf("change tier stripe: %w", err)
	}

	if err := s.repo.UpdateSubscriptionTier(ctx, sub.ID, newTierID, newPriceCents, billingInterval, newStripeSubID); err != nil {
		return nil, 0, err
	}

	updatedSub, err := s.repo.GetSubscription(ctx, userID)
	if err != nil {
		return nil, 0, err
	}

	return updatedSub, prorationAmount, nil
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
func (s *SubscriptionService) ListInvoices(ctx context.Context, userID string) ([]*domain.Invoice, error) {
	sub, err := s.repo.GetSubscription(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("list invoices: %w", domain.ErrNoActiveSubscription)
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

// HandleSubscriptionWebhook processes Stripe subscription webhook events.
func (s *SubscriptionService) HandleSubscriptionWebhook(ctx context.Context, eventType, stripeSubscriptionID string, periodStart, periodEnd *time.Time) error {
	switch eventType {
	case "customer.subscription.updated":
		sub, err := s.repo.GetSubscriptionByStripeID(ctx, stripeSubscriptionID)
		if err != nil {
			return nil // Don't fail for unknown subscriptions.
		}
		if periodStart != nil && periodEnd != nil {
			if err := s.repo.UpdateSubscriptionPeriod(ctx, sub.ID, *periodStart, *periodEnd); err != nil {
				return fmt.Errorf("webhook update period: %w", err)
			}
		}
		return nil

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
		return s.repo.UpdateSubscriptionStatus(ctx, sub.ID, "past_due")

	case "invoice.paid":
		sub, err := s.repo.GetSubscriptionByStripeID(ctx, stripeSubscriptionID)
		if err != nil {
			return nil
		}
		if sub.Status == "past_due" {
			return s.repo.UpdateSubscriptionStatus(ctx, sub.ID, "active")
		}
		return nil

	default:
		return nil
	}
}
