package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Mock Subscription Repository ---

type mockSubRepo struct {
	listTiersFn              func(ctx context.Context) ([]*domain.SubscriptionTier, error)
	getTierFn                func(ctx context.Context, tierID string) (*domain.SubscriptionTier, error)
	createSubscriptionFn     func(ctx context.Context, sub *domain.Subscription) error
	getSubscriptionFn        func(ctx context.Context, userID string) (*domain.Subscription, error)
	getSubByStripeFn         func(ctx context.Context, stripeSubscriptionID string) (*domain.Subscription, error)
	updateSubStatusFn        func(ctx context.Context, id string, status string) error
	updateSubTierFn          func(ctx context.Context, id string, tierID string, priceCents int64, billingInterval string, stripeSubID string) error
	cancelSubscriptionFn     func(ctx context.Context, id string, cancelledAt time.Time, status string) error
	updateSubPeriodFn        func(ctx context.Context, id string, periodStart, periodEnd time.Time) error
	getUsageFn               func(ctx context.Context, userID string) (int32, int32, int32, error)
}

func (m *mockSubRepo) ListTiers(ctx context.Context) ([]*domain.SubscriptionTier, error) {
	return m.listTiersFn(ctx)
}
func (m *mockSubRepo) GetTier(ctx context.Context, tierID string) (*domain.SubscriptionTier, error) {
	return m.getTierFn(ctx, tierID)
}
func (m *mockSubRepo) CreateSubscription(ctx context.Context, sub *domain.Subscription) error {
	return m.createSubscriptionFn(ctx, sub)
}
func (m *mockSubRepo) GetSubscription(ctx context.Context, userID string) (*domain.Subscription, error) {
	return m.getSubscriptionFn(ctx, userID)
}
func (m *mockSubRepo) GetSubscriptionByStripeID(ctx context.Context, stripeSubscriptionID string) (*domain.Subscription, error) {
	return m.getSubByStripeFn(ctx, stripeSubscriptionID)
}
func (m *mockSubRepo) UpdateSubscriptionStatus(ctx context.Context, id string, status string) error {
	return m.updateSubStatusFn(ctx, id, status)
}
func (m *mockSubRepo) UpdateSubscriptionTier(ctx context.Context, id string, tierID string, priceCents int64, billingInterval string, stripeSubID string) error {
	return m.updateSubTierFn(ctx, id, tierID, priceCents, billingInterval, stripeSubID)
}
func (m *mockSubRepo) CancelSubscription(ctx context.Context, id string, cancelledAt time.Time, status string) error {
	return m.cancelSubscriptionFn(ctx, id, cancelledAt, status)
}
func (m *mockSubRepo) UpdateSubscriptionPeriod(ctx context.Context, id string, periodStart, periodEnd time.Time) error {
	return m.updateSubPeriodFn(ctx, id, periodStart, periodEnd)
}
func (m *mockSubRepo) GetUsage(ctx context.Context, userID string) (int32, int32, int32, error) {
	return m.getUsageFn(ctx, userID)
}

// --- helpers ---

func proTier() *domain.SubscriptionTier {
	return &domain.SubscriptionTier{
		ID:                    "tier-pro",
		Name:                  "Pro",
		Slug:                  "pro",
		MonthlyPriceCents:     2999,
		AnnualPriceCents:      29990,
		FeeDiscountPercentage: 0.02,
		MaxActiveBids:         10,
		MaxServiceCategories:  5,
		FeaturedPlacement:     false,
		AnalyticsAccess:       true,
		PrioritySupport:       true,
		VerifiedBadgeBoost:    false,
		PortfolioImageLimit:   20,
		InstantEnabled:        false,
		StripePriceIDMonthly:  "price_monthly_pro",
		StripePriceIDAnnual:   "price_annual_pro",
		IsActive:              true,
	}
}

func businessTier() *domain.SubscriptionTier {
	return &domain.SubscriptionTier{
		ID:                    "tier-business",
		Name:                  "Business",
		Slug:                  "business",
		MonthlyPriceCents:     7999,
		AnnualPriceCents:      79990,
		FeeDiscountPercentage: 0.04,
		MaxActiveBids:         50,
		MaxServiceCategories:  20,
		FeaturedPlacement:     true,
		AnalyticsAccess:       true,
		PrioritySupport:       true,
		VerifiedBadgeBoost:    true,
		PortfolioImageLimit:   100,
		InstantEnabled:        true,
		StripePriceIDMonthly:  "price_monthly_biz",
		StripePriceIDAnnual:   "price_annual_biz",
		IsActive:              true,
	}
}

func newTestSubService(repo *mockSubRepo) *SubscriptionService {
	stripe := &StripeService{devMode: true}
	return NewSubscriptionService(repo, stripe)
}

// --- ListTiers tests ---

func TestSubscriptionService_ListTiers(t *testing.T) {
	t.Parallel()

	repo := &mockSubRepo{
		listTiersFn: func(_ context.Context) ([]*domain.SubscriptionTier, error) {
			return []*domain.SubscriptionTier{proTier(), businessTier()}, nil
		},
	}
	svc := newTestSubService(repo)

	tiers, err := svc.ListTiers(context.Background())

	require.NoError(t, err)
	assert.Len(t, tiers, 2)
	assert.Equal(t, "Pro", tiers[0].Name)
	assert.Equal(t, "Business", tiers[1].Name)
}

func TestSubscriptionService_ListTiers_error(t *testing.T) {
	t.Parallel()

	repo := &mockSubRepo{
		listTiersFn: func(_ context.Context) ([]*domain.SubscriptionTier, error) {
			return nil, errors.New("db unavailable")
		},
	}
	svc := newTestSubService(repo)

	_, err := svc.ListTiers(context.Background())
	require.Error(t, err)
}

// --- CreateSubscription tests ---

func TestSubscriptionService_CreateSubscription(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name            string
		userID          string
		tierID          string
		billingInterval string
		getSubFn        func(ctx context.Context, userID string) (*domain.Subscription, error)
		wantErr         error
		wantPrice       int64
	}{
		{
			name:            "monthly_subscription",
			userID:          "user-1",
			tierID:          "tier-pro",
			billingInterval: "monthly",
			getSubFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
				return nil, domain.ErrSubscriptionNotFound
			},
			wantPrice: 2999,
		},
		{
			name:            "annual_subscription",
			userID:          "user-2",
			tierID:          "tier-pro",
			billingInterval: "annual",
			getSubFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
				return nil, domain.ErrSubscriptionNotFound
			},
			wantPrice: 29990,
		},
		{
			name:            "default_to_monthly",
			userID:          "user-3",
			tierID:          "tier-pro",
			billingInterval: "",
			getSubFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
				return nil, domain.ErrSubscriptionNotFound
			},
			wantPrice: 2999,
		},
		{
			name:            "already_subscribed_returns_error",
			userID:          "user-4",
			tierID:          "tier-pro",
			billingInterval: "monthly",
			getSubFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
				return &domain.Subscription{ID: "existing-sub", Status: "active"}, nil
			},
			wantErr: domain.ErrAlreadySubscribed,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var storedSub *domain.Subscription
			repo := &mockSubRepo{
				getTierFn: func(_ context.Context, tierID string) (*domain.SubscriptionTier, error) {
					if tierID == "tier-pro" {
						return proTier(), nil
					}
					return nil, domain.ErrTierNotFound
				},
				getSubscriptionFn: tt.getSubFn,
				createSubscriptionFn: func(_ context.Context, sub *domain.Subscription) error {
					storedSub = sub
					return nil
				},
			}
			svc := newTestSubService(repo)

			sub, clientSecret, err := svc.CreateSubscription(context.Background(), tt.userID, tt.tierID, tt.billingInterval, "pm_test")

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr))
				return
			}

			require.NoError(t, err)
			require.NotNil(t, sub)
			assert.Equal(t, tt.userID, sub.UserID)
			assert.Equal(t, tt.tierID, sub.TierID)
			assert.Equal(t, tt.wantPrice, sub.CurrentPriceCents)
			assert.Equal(t, "active", sub.Status)
			assert.NotEmpty(t, sub.StripeSubscriptionID)
			_ = clientSecret
			_ = storedSub
		})
	}
}

func TestSubscriptionService_CreateSubscription_tier_not_found(t *testing.T) {
	t.Parallel()

	repo := &mockSubRepo{
		getTierFn: func(_ context.Context, _ string) (*domain.SubscriptionTier, error) {
			return nil, domain.ErrTierNotFound
		},
	}
	svc := newTestSubService(repo)

	_, _, err := svc.CreateSubscription(context.Background(), "user-1", "nonexistent", "monthly", "pm_test")

	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrTierNotFound))
}

// --- ChangeSubscriptionTier tests ---

func TestSubscriptionService_ChangeTier(t *testing.T) {
	t.Parallel()

	now := time.Now()
	periodEnd := now.AddDate(0, 1, 0)

	tests := []struct {
		name            string
		currentTierID   string
		currentInterval string
		newTierID       string
		newInterval     string
		wantErr         error
		wantNewPrice    int64
	}{
		{
			name:            "upgrade_to_business",
			currentTierID:   "tier-pro",
			currentInterval: "monthly",
			newTierID:       "tier-business",
			newInterval:     "monthly",
			wantNewPrice:    7999,
		},
		{
			name:            "change_to_annual",
			currentTierID:   "tier-pro",
			currentInterval: "monthly",
			newTierID:       "tier-pro",
			newInterval:     "annual",
			wantNewPrice:    29990,
		},
		{
			name:            "same_tier_and_interval_returns_error",
			currentTierID:   "tier-pro",
			currentInterval: "monthly",
			newTierID:       "tier-pro",
			newInterval:     "monthly",
			wantErr:         domain.ErrInvalidTierChange,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockSubRepo{
				getSubscriptionFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
					return &domain.Subscription{
						ID:                   "sub-1",
						UserID:               "user-1",
						TierID:               tt.currentTierID,
						BillingInterval:      tt.currentInterval,
						Status:               "active",
						StripeSubscriptionID: "sub_stripe_1",
						CurrentPeriodStart:   &now,
						CurrentPeriodEnd:     &periodEnd,
					}, nil
				},
				getTierFn: func(_ context.Context, tierID string) (*domain.SubscriptionTier, error) {
					switch tierID {
					case "tier-pro":
						return proTier(), nil
					case "tier-business":
						return businessTier(), nil
					default:
						return nil, domain.ErrTierNotFound
					}
				},
				updateSubTierFn: func(_ context.Context, _ string, _ string, _ int64, _ string, _ string) error {
					return nil
				},
			}
			svc := newTestSubService(repo)

			sub, prorationAmount, err := svc.ChangeSubscriptionTier(context.Background(), "user-1", tt.newTierID, tt.newInterval)

			if tt.wantErr != nil {
				require.Error(t, err)
				assert.True(t, errors.Is(err, tt.wantErr))
				return
			}

			require.NoError(t, err)
			require.NotNil(t, sub)
			_ = prorationAmount // dev mode returns 0
		})
	}
}

func TestSubscriptionService_ChangeTier_no_active_subscription(t *testing.T) {
	t.Parallel()

	repo := &mockSubRepo{
		getSubscriptionFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
			return nil, domain.ErrSubscriptionNotFound
		},
	}
	svc := newTestSubService(repo)

	_, _, err := svc.ChangeSubscriptionTier(context.Background(), "user-1", "tier-business", "monthly")

	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrNoActiveSubscription))
}

// --- GetUsage tests ---

func TestSubscriptionService_GetUsage(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name              string
		subscription      *domain.Subscription
		subErr            error
		activeBids        int32
		serviceCategories int32
		portfolioImages   int32
		wantMaxBids       int32
		wantFeePercent    float64
	}{
		{
			name: "with_pro_subscription",
			subscription: &domain.Subscription{
				ID:     "sub-1",
				TierID: "tier-pro",
				Status: "active",
				Tier:   proTier(),
			},
			activeBids:        5,
			serviceCategories: 3,
			portfolioImages:   10,
			wantMaxBids:       10,  // Pro tier limit
			wantFeePercent:    0.08, // 10% base - 2% discount
		},
		{
			name:              "free_tier_defaults",
			subErr:            domain.ErrSubscriptionNotFound,
			activeBids:        2,
			serviceCategories: 1,
			portfolioImages:   3,
			wantMaxBids:       3,   // Free tier default
			wantFeePercent:    0.10, // No discount
		},
		{
			name: "with_business_subscription",
			subscription: &domain.Subscription{
				ID:     "sub-2",
				TierID: "tier-business",
				Status: "active",
				Tier:   businessTier(),
			},
			activeBids:        20,
			serviceCategories: 10,
			portfolioImages:   50,
			wantMaxBids:       50,   // Business tier limit
			wantFeePercent:    0.06, // 10% base - 4% discount
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockSubRepo{
				getSubscriptionFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
					if tt.subErr != nil {
						return nil, tt.subErr
					}
					return tt.subscription, nil
				},
				getUsageFn: func(_ context.Context, _ string) (int32, int32, int32, error) {
					return tt.activeBids, tt.serviceCategories, tt.portfolioImages, nil
				},
			}
			svc := newTestSubService(repo)

			usage, err := svc.GetUsage(context.Background(), "user-1")

			require.NoError(t, err)
			require.NotNil(t, usage)
			assert.Equal(t, tt.activeBids, usage.ActiveBids)
			assert.Equal(t, tt.wantMaxBids, usage.MaxActiveBids)
			assert.InDelta(t, tt.wantFeePercent, usage.CurrentFeePercentage, 0.001)
		})
	}
}

// --- CheckFeatureAccess tests ---

func TestSubscriptionService_CheckFeatureAccess(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		feature      string
		subscription *domain.Subscription
		subErr       error
		wantAccess   bool
		wantTier     string
	}{
		// Free tier tests
		{
			name:       "free_tier_analytics_denied",
			feature:    "analytics",
			subErr:     domain.ErrSubscriptionNotFound,
			wantAccess: false,
			wantTier:   "pro",
		},
		{
			name:       "free_tier_featured_placement_denied",
			feature:    "featured_placement",
			subErr:     domain.ErrSubscriptionNotFound,
			wantAccess: false,
			wantTier:   "business",
		},
		{
			name:       "free_tier_instant_denied",
			feature:    "instant",
			subErr:     domain.ErrSubscriptionNotFound,
			wantAccess: false,
			wantTier:   "business",
		},
		{
			name:       "free_tier_unknown_feature_allowed",
			feature:    "basic_bidding",
			subErr:     domain.ErrSubscriptionNotFound,
			wantAccess: true,
			wantTier:   "",
		},
		// Pro tier tests
		{
			name:    "pro_tier_analytics_allowed",
			feature: "analytics",
			subscription: &domain.Subscription{
				ID:   "sub-1",
				Tier: proTier(),
			},
			wantAccess: true,
			wantTier:   "",
		},
		{
			name:    "pro_tier_featured_placement_denied",
			feature: "featured_placement",
			subscription: &domain.Subscription{
				ID:   "sub-1",
				Tier: proTier(),
			},
			wantAccess: false,
			wantTier:   "business",
		},
		{
			name:    "pro_tier_priority_support_allowed",
			feature: "priority_support",
			subscription: &domain.Subscription{
				ID:   "sub-1",
				Tier: proTier(),
			},
			wantAccess: true,
			wantTier:   "",
		},
		// Business tier tests
		{
			name:    "business_tier_featured_placement_allowed",
			feature: "featured_placement",
			subscription: &domain.Subscription{
				ID:   "sub-2",
				Tier: businessTier(),
			},
			wantAccess: true,
			wantTier:   "",
		},
		{
			name:    "business_tier_instant_allowed",
			feature: "instant",
			subscription: &domain.Subscription{
				ID:   "sub-2",
				Tier: businessTier(),
			},
			wantAccess: true,
			wantTier:   "",
		},
		{
			name:    "business_tier_verified_badge_boost_allowed",
			feature: "verified_badge_boost",
			subscription: &domain.Subscription{
				ID:   "sub-2",
				Tier: businessTier(),
			},
			wantAccess: true,
			wantTier:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			repo := &mockSubRepo{
				getSubscriptionFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
					if tt.subErr != nil {
						return nil, tt.subErr
					}
					return tt.subscription, nil
				},
			}
			svc := newTestSubService(repo)

			hasAccess, requiredTier := svc.CheckFeatureAccess(context.Background(), "user-1", tt.feature)

			assert.Equal(t, tt.wantAccess, hasAccess)
			assert.Equal(t, tt.wantTier, requiredTier)
		})
	}
}

// --- CancelSubscription tests ---

func TestSubscriptionService_CancelSubscription(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name              string
		cancelImmediately bool
		wantStatus        string
	}{
		{
			name:              "immediate_cancel",
			cancelImmediately: true,
			wantStatus:        "cancelled",
		},
		{
			name:              "cancel_at_period_end",
			cancelImmediately: false,
			wantStatus:        "active", // stays active until period end
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			now := time.Now()
			periodEnd := now.AddDate(0, 1, 0)
			currentStatus := "active"

			repo := &mockSubRepo{
				getSubscriptionFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
					return &domain.Subscription{
						ID:                   "sub-1",
						UserID:               "user-1",
						Status:               currentStatus,
						StripeSubscriptionID: "sub_stripe_1",
						CurrentPeriodEnd:     &periodEnd,
					}, nil
				},
				cancelSubscriptionFn: func(_ context.Context, _ string, _ time.Time, status string) error {
					currentStatus = status
					return nil
				},
			}
			svc := newTestSubService(repo)

			sub, err := svc.CancelSubscription(context.Background(), "user-1", "no longer needed", tt.cancelImmediately)

			require.NoError(t, err)
			require.NotNil(t, sub)
			assert.Equal(t, tt.wantStatus, sub.Status)
		})
	}
}

func TestSubscriptionService_CancelSubscription_no_active(t *testing.T) {
	t.Parallel()

	repo := &mockSubRepo{
		getSubscriptionFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
			return nil, domain.ErrSubscriptionNotFound
		},
	}
	svc := newTestSubService(repo)

	_, err := svc.CancelSubscription(context.Background(), "user-1", "", false)

	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrNoActiveSubscription))
}

// --- HandleSubscriptionWebhook tests ---

func TestSubscriptionService_HandleSubscriptionWebhook(t *testing.T) {
	t.Parallel()

	now := time.Now()
	periodEnd := now.AddDate(0, 1, 0)

	tests := []struct {
		name       string
		eventType  string
		subExists  bool
		subStatus  string
		wantStatus string
	}{
		{
			name:       "subscription_deleted",
			eventType:  "customer.subscription.deleted",
			subExists:  true,
			wantStatus: "expired",
		},
		{
			name:       "invoice_payment_failed",
			eventType:  "invoice.payment_failed",
			subExists:  true,
			wantStatus: "past_due",
		},
		{
			name:       "invoice_paid_recovers_past_due",
			eventType:  "invoice.paid",
			subExists:  true,
			subStatus:  "past_due",
			wantStatus: "active",
		},
		{
			name:      "unknown_event_ignored",
			eventType: "unknown.event",
			subExists: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			subStatus := "active"
			if tt.subStatus != "" {
				subStatus = tt.subStatus
			}

			repo := &mockSubRepo{
				getSubByStripeFn: func(_ context.Context, _ string) (*domain.Subscription, error) {
					if !tt.subExists {
						return nil, domain.ErrSubscriptionNotFound
					}
					return &domain.Subscription{
						ID:     "sub-1",
						Status: subStatus,
					}, nil
				},
				updateSubStatusFn: func(_ context.Context, _ string, status string) error {
					subStatus = status
					return nil
				},
				updateSubPeriodFn: func(_ context.Context, _ string, _, _ time.Time) error {
					return nil
				},
			}
			svc := newTestSubService(repo)

			err := svc.HandleSubscriptionWebhook(context.Background(), tt.eventType, "sub_stripe_1", &now, &periodEnd)

			require.NoError(t, err)
			if tt.wantStatus != "" {
				assert.Equal(t, tt.wantStatus, subStatus)
			}
		})
	}
}
