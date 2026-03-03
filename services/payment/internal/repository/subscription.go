package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/nomarkup/nomarkup/services/payment/internal/domain"
)

// --- SubscriptionRepository methods on PostgresRepository ---

func (r *PostgresRepository) ListTiers(ctx context.Context) ([]*domain.SubscriptionTier, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, name, slug,
		       monthly_price_cents, annual_price_cents,
		       fee_discount_percentage,
		       max_active_bids, max_service_categories,
		       featured_placement, analytics_access, priority_support,
		       verified_badge_boost, portfolio_image_limit, instant_enabled,
		       sort_order, is_active,
		       COALESCE(stripe_price_id_monthly, ''), COALESCE(stripe_price_id_annual, ''),
		       created_at, updated_at
		FROM subscription_tiers
		WHERE is_active = true
		ORDER BY sort_order ASC`)
	if err != nil {
		return nil, fmt.Errorf("list tiers: %w", err)
	}
	defer rows.Close()

	var tiers []*domain.SubscriptionTier
	for rows.Next() {
		t := &domain.SubscriptionTier{}
		err := rows.Scan(
			&t.ID, &t.Name, &t.Slug,
			&t.MonthlyPriceCents, &t.AnnualPriceCents,
			&t.FeeDiscountPercentage,
			&t.MaxActiveBids, &t.MaxServiceCategories,
			&t.FeaturedPlacement, &t.AnalyticsAccess, &t.PrioritySupport,
			&t.VerifiedBadgeBoost, &t.PortfolioImageLimit, &t.InstantEnabled,
			&t.SortOrder, &t.IsActive,
			&t.StripePriceIDMonthly, &t.StripePriceIDAnnual,
			&t.CreatedAt, &t.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("list tiers scan: %w", err)
		}
		tiers = append(tiers, t)
	}

	return tiers, nil
}

func (r *PostgresRepository) GetTier(ctx context.Context, tierID string) (*domain.SubscriptionTier, error) {
	t := &domain.SubscriptionTier{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, name, slug,
		       monthly_price_cents, annual_price_cents,
		       fee_discount_percentage,
		       max_active_bids, max_service_categories,
		       featured_placement, analytics_access, priority_support,
		       verified_badge_boost, portfolio_image_limit, instant_enabled,
		       sort_order, is_active,
		       COALESCE(stripe_price_id_monthly, ''), COALESCE(stripe_price_id_annual, ''),
		       created_at, updated_at
		FROM subscription_tiers
		WHERE id = $1`, tierID).Scan(
		&t.ID, &t.Name, &t.Slug,
		&t.MonthlyPriceCents, &t.AnnualPriceCents,
		&t.FeeDiscountPercentage,
		&t.MaxActiveBids, &t.MaxServiceCategories,
		&t.FeaturedPlacement, &t.AnalyticsAccess, &t.PrioritySupport,
		&t.VerifiedBadgeBoost, &t.PortfolioImageLimit, &t.InstantEnabled,
		&t.SortOrder, &t.IsActive,
		&t.StripePriceIDMonthly, &t.StripePriceIDAnnual,
		&t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get tier: %w", domain.ErrTierNotFound)
		}
		return nil, fmt.Errorf("get tier: %w", err)
	}
	return t, nil
}

func (r *PostgresRepository) CreateSubscription(ctx context.Context, sub *domain.Subscription) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO subscriptions (
			id, user_id, tier_id, status, billing_interval,
			current_price_cents, stripe_subscription_id, stripe_customer_id,
			current_period_start, current_period_end, trial_end
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8,
			$9, $10, $11
		)`,
		sub.ID, sub.UserID, sub.TierID, sub.Status, sub.BillingInterval,
		sub.CurrentPriceCents, sub.StripeSubscriptionID, sub.StripeCustomerID,
		sub.CurrentPeriodStart, sub.CurrentPeriodEnd, sub.TrialEnd,
	)
	if err != nil {
		return fmt.Errorf("create subscription: %w", err)
	}
	return nil
}

func (r *PostgresRepository) GetSubscription(ctx context.Context, userID string) (*domain.Subscription, error) {
	sub := &domain.Subscription{}
	tier := &domain.SubscriptionTier{}

	err := r.pool.QueryRow(ctx, `
		SELECT s.id, s.user_id, s.tier_id, s.status, s.billing_interval,
		       s.current_price_cents,
		       COALESCE(s.stripe_subscription_id, ''), COALESCE(s.stripe_customer_id, ''),
		       s.current_period_start, s.current_period_end, s.trial_end,
		       s.cancelled_at, s.expires_at,
		       s.created_at, s.updated_at,
		       t.id, t.name, t.slug,
		       t.monthly_price_cents, t.annual_price_cents,
		       t.fee_discount_percentage,
		       t.max_active_bids, t.max_service_categories,
		       t.featured_placement, t.analytics_access, t.priority_support,
		       t.verified_badge_boost, t.portfolio_image_limit, t.instant_enabled,
		       t.sort_order, t.is_active,
		       COALESCE(t.stripe_price_id_monthly, ''), COALESCE(t.stripe_price_id_annual, ''),
		       t.created_at, t.updated_at
		FROM subscriptions s
		JOIN subscription_tiers t ON t.id = s.tier_id
		WHERE s.user_id = $1 AND s.status IN ('active', 'trialing', 'past_due')
		ORDER BY s.created_at DESC
		LIMIT 1`, userID).Scan(
		&sub.ID, &sub.UserID, &sub.TierID, &sub.Status, &sub.BillingInterval,
		&sub.CurrentPriceCents,
		&sub.StripeSubscriptionID, &sub.StripeCustomerID,
		&sub.CurrentPeriodStart, &sub.CurrentPeriodEnd, &sub.TrialEnd,
		&sub.CancelledAt, &sub.ExpiresAt,
		&sub.CreatedAt, &sub.UpdatedAt,
		&tier.ID, &tier.Name, &tier.Slug,
		&tier.MonthlyPriceCents, &tier.AnnualPriceCents,
		&tier.FeeDiscountPercentage,
		&tier.MaxActiveBids, &tier.MaxServiceCategories,
		&tier.FeaturedPlacement, &tier.AnalyticsAccess, &tier.PrioritySupport,
		&tier.VerifiedBadgeBoost, &tier.PortfolioImageLimit, &tier.InstantEnabled,
		&tier.SortOrder, &tier.IsActive,
		&tier.StripePriceIDMonthly, &tier.StripePriceIDAnnual,
		&tier.CreatedAt, &tier.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get subscription: %w", domain.ErrSubscriptionNotFound)
		}
		return nil, fmt.Errorf("get subscription: %w", err)
	}

	sub.Tier = tier
	return sub, nil
}

func (r *PostgresRepository) GetSubscriptionByStripeID(ctx context.Context, stripeSubscriptionID string) (*domain.Subscription, error) {
	sub := &domain.Subscription{}
	err := r.pool.QueryRow(ctx, `
		SELECT id, user_id, tier_id, status, billing_interval,
		       current_price_cents,
		       COALESCE(stripe_subscription_id, ''), COALESCE(stripe_customer_id, ''),
		       current_period_start, current_period_end, trial_end,
		       cancelled_at, expires_at,
		       created_at, updated_at
		FROM subscriptions
		WHERE stripe_subscription_id = $1`, stripeSubscriptionID).Scan(
		&sub.ID, &sub.UserID, &sub.TierID, &sub.Status, &sub.BillingInterval,
		&sub.CurrentPriceCents,
		&sub.StripeSubscriptionID, &sub.StripeCustomerID,
		&sub.CurrentPeriodStart, &sub.CurrentPeriodEnd, &sub.TrialEnd,
		&sub.CancelledAt, &sub.ExpiresAt,
		&sub.CreatedAt, &sub.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("get subscription by stripe id: %w", domain.ErrSubscriptionNotFound)
		}
		return nil, fmt.Errorf("get subscription by stripe id: %w", err)
	}
	return sub, nil
}

func (r *PostgresRepository) UpdateSubscriptionStatus(ctx context.Context, id string, status string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE subscriptions SET status = $2, updated_at = now() WHERE id = $1`,
		id, status)
	if err != nil {
		return fmt.Errorf("update subscription status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update subscription status: %w", domain.ErrSubscriptionNotFound)
	}
	return nil
}

func (r *PostgresRepository) UpdateSubscriptionTier(ctx context.Context, id string, tierID string, priceCents int64, billingInterval string, stripeSubID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE subscriptions SET
			tier_id = $2,
			current_price_cents = $3,
			billing_interval = $4,
			stripe_subscription_id = $5,
			updated_at = now()
		WHERE id = $1`,
		id, tierID, priceCents, billingInterval, stripeSubID)
	if err != nil {
		return fmt.Errorf("update subscription tier: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update subscription tier: %w", domain.ErrSubscriptionNotFound)
	}
	return nil
}

func (r *PostgresRepository) CancelSubscription(ctx context.Context, id string, cancelledAt time.Time, status string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE subscriptions SET
			status = $2,
			cancelled_at = $3,
			updated_at = now()
		WHERE id = $1`,
		id, status, cancelledAt)
	if err != nil {
		return fmt.Errorf("cancel subscription: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("cancel subscription: %w", domain.ErrSubscriptionNotFound)
	}
	return nil
}

func (r *PostgresRepository) UpdateSubscriptionPeriod(ctx context.Context, id string, periodStart, periodEnd time.Time) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE subscriptions SET
			current_period_start = $2,
			current_period_end = $3,
			updated_at = now()
		WHERE id = $1`,
		id, periodStart, periodEnd)
	if err != nil {
		return fmt.Errorf("update subscription period: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update subscription period: %w", domain.ErrSubscriptionNotFound)
	}
	return nil
}

func (r *PostgresRepository) GetUsage(ctx context.Context, userID string) (activeBids int32, serviceCategories int32, portfolioImages int32, err error) {
	// Count active bids.
	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM bids
		WHERE provider_id = $1 AND status IN ('active', 'pending')`, userID).Scan(&activeBids)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("get usage active bids: %w", err)
	}

	// Count service categories.
	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(DISTINCT category_id) FROM provider_categories
		WHERE provider_id = $1`, userID).Scan(&serviceCategories)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("get usage service categories: %w", err)
	}

	// Count portfolio images.
	err = r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM portfolio_images
		WHERE provider_id = $1`, userID).Scan(&portfolioImages)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("get usage portfolio images: %w", err)
	}

	return activeBids, serviceCategories, portfolioImages, nil
}
