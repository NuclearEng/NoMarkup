package domain

import (
	"context"
	"errors"
	"time"
)

// Sentinel errors for the subscription domain.
var (
	ErrSubscriptionNotFound = errors.New("subscription not found")
	ErrTierNotFound         = errors.New("subscription tier not found")
	ErrAlreadySubscribed    = errors.New("user already has an active subscription")
	ErrInvalidTierChange    = errors.New("invalid tier change")
	ErrNoActiveSubscription = errors.New("no active subscription")
)

// SubscriptionTier represents a subscription pricing tier.
type SubscriptionTier struct {
	ID                    string
	Name                  string
	Slug                  string
	MonthlyPriceCents     int64
	AnnualPriceCents      int64
	FeeDiscountPercentage float64
	MaxActiveBids         int32
	MaxServiceCategories  int32
	FeaturedPlacement     bool
	AnalyticsAccess       bool
	PrioritySupport       bool
	VerifiedBadgeBoost    bool
	PortfolioImageLimit   int32
	InstantEnabled        bool
	SortOrder             int32
	IsActive              bool
	StripePriceIDMonthly  string
	StripePriceIDAnnual   string
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

// Subscription represents a user's subscription.
type Subscription struct {
	ID                   string
	UserID               string
	TierID               string
	Tier                 *SubscriptionTier
	Status               string // active, past_due, cancelled, expired, trialing
	BillingInterval      string // monthly, annual
	CurrentPriceCents    int64
	StripeSubscriptionID string
	StripeCustomerID     string
	CurrentPeriodStart   *time.Time
	CurrentPeriodEnd     *time.Time
	TrialEnd             *time.Time
	CancelledAt          *time.Time
	ExpiresAt            *time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// Invoice represents a subscription invoice.
type Invoice struct {
	ID              string
	SubscriptionID  string
	StripeInvoiceID string
	AmountCents     int64
	Status          string // paid, open, void, uncollectible
	PDFURL          string
	PeriodStart     *time.Time
	PeriodEnd       *time.Time
	PaidAt          *time.Time
}

// SubscriptionUsage holds current usage counters for a subscription.
type SubscriptionUsage struct {
	ActiveBids           int32
	MaxActiveBids        int32
	ServiceCategories    int32
	MaxServiceCategories int32
	PortfolioImages      int32
	MaxPortfolioImages   int32
	CurrentFeePercentage float64
}

// SubscriptionRepository defines persistence operations for subscriptions.
type SubscriptionRepository interface {
	ListTiers(ctx context.Context) ([]*SubscriptionTier, error)
	GetTier(ctx context.Context, tierID string) (*SubscriptionTier, error)
	UpdateTier(ctx context.Context, tierID string, updates map[string]interface{}) (*SubscriptionTier, error)
	CreateSubscription(ctx context.Context, sub *Subscription) error
	GetSubscription(ctx context.Context, userID string) (*Subscription, error)
	GetSubscriptionByStripeID(ctx context.Context, stripeSubscriptionID string) (*Subscription, error)
	UpdateSubscriptionStatus(ctx context.Context, id string, status string) error
	UpdateSubscriptionTier(ctx context.Context, id string, tierID string, priceCents int64, billingInterval string, stripeSubID string) error
	CancelSubscription(ctx context.Context, id string, cancelledAt time.Time, status string) error
	UpdateSubscriptionPeriod(ctx context.Context, id string, periodStart, periodEnd time.Time) error
	GetUsage(ctx context.Context, userID string) (activeBids int32, serviceCategories int32, portfolioImages int32, err error)
	AdminListSubscriptions(ctx context.Context, statusFilter string, tierID string, page, pageSize int) ([]*Subscription, int, int64, error)
}
