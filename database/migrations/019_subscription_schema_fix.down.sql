-- Rollback migration 019: Remove added subscription columns.

-- Revert subscriptions changes
ALTER TABLE subscriptions DROP COLUMN IF EXISTS billing_interval;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS current_price_cents;

-- Revert trial_end -> trial_ends_at
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'subscriptions' AND column_name = 'trial_end') THEN
    ALTER TABLE subscriptions RENAME COLUMN trial_end TO trial_ends_at;
  END IF;
END $$;

-- Revert subscription_tiers changes
DROP INDEX IF EXISTS idx_subscription_tiers_slug;
ALTER TABLE subscription_tiers
  DROP COLUMN IF EXISTS slug,
  DROP COLUMN IF EXISTS monthly_price_cents,
  DROP COLUMN IF EXISTS annual_price_cents,
  DROP COLUMN IF EXISTS fee_discount_percentage,
  DROP COLUMN IF EXISTS max_active_bids,
  DROP COLUMN IF EXISTS max_service_categories,
  DROP COLUMN IF EXISTS featured_placement,
  DROP COLUMN IF EXISTS analytics_access,
  DROP COLUMN IF EXISTS priority_support,
  DROP COLUMN IF EXISTS verified_badge_boost,
  DROP COLUMN IF EXISTS portfolio_image_limit,
  DROP COLUMN IF EXISTS instant_enabled,
  DROP COLUMN IF EXISTS sort_order,
  DROP COLUMN IF EXISTS is_active,
  DROP COLUMN IF EXISTS stripe_price_id_monthly,
  DROP COLUMN IF EXISTS stripe_price_id_annual;

-- Remove seeded tiers
DELETE FROM subscription_tiers WHERE slug IN ('free', 'pro', 'business');
