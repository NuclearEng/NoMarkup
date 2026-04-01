-- Migration 019: Align subscription_tiers and subscriptions tables with service code.
-- The original schema had a simplified subscription_tiers table. The Go service
-- code expects richer columns (slug, per-interval pricing, feature flags, etc.).

-- ============================================================
-- Fix subscription_tiers to match service expectations
-- ============================================================

-- Add missing columns (slug, pricing, feature flags)
ALTER TABLE subscription_tiers
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS monthly_price_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS annual_price_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_discount_percentage NUMERIC(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_active_bids INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_service_categories INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS featured_placement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS analytics_access BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority_support BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_badge_boost BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portfolio_image_limit INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS instant_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS stripe_price_id_monthly TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id_annual TEXT;

-- Populate slug from name for existing rows (lowercase, replace spaces with hyphens)
UPDATE subscription_tiers SET slug = LOWER(REPLACE(name, ' ', '-')) WHERE slug IS NULL;
ALTER TABLE subscription_tiers ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_tiers_slug ON subscription_tiers (slug);

-- Migrate price_cents to monthly_price_cents for any existing rows
UPDATE subscription_tiers SET monthly_price_cents = price_cents WHERE monthly_price_cents = 0 AND price_cents > 0;

-- Migrate active -> is_active
UPDATE subscription_tiers SET is_active = active;

-- Migrate stripe_price_id -> stripe_price_id_monthly
UPDATE subscription_tiers SET stripe_price_id_monthly = stripe_price_id WHERE stripe_price_id IS NOT NULL AND stripe_price_id_monthly IS NULL;

-- ============================================================
-- Fix subscriptions table to match service expectations
-- ============================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_interval IN ('monthly', 'annual')),
  ADD COLUMN IF NOT EXISTS current_price_cents BIGINT NOT NULL DEFAULT 0;

-- Rename trial_ends_at -> trial_end for consistency with code
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'subscriptions' AND column_name = 'trial_ends_at') THEN
    ALTER TABLE subscriptions RENAME COLUMN trial_ends_at TO trial_end;
  END IF;
END $$;

-- ============================================================
-- Seed default subscription tiers if table is empty
-- ============================================================

INSERT INTO subscription_tiers (name, slug, monthly_price_cents, annual_price_cents,
  fee_discount_percentage, max_active_bids, max_service_categories,
  featured_placement, analytics_access, priority_support,
  verified_badge_boost, portfolio_image_limit, instant_enabled,
  sort_order, is_active, role, price_cents)
SELECT 'Free', 'free', 0, 0,
  0, 3, 1,
  false, false, false,
  false, 5, false,
  0, true, 'provider', 0
WHERE NOT EXISTS (SELECT 1 FROM subscription_tiers WHERE slug = 'free')
ON CONFLICT DO NOTHING;

INSERT INTO subscription_tiers (name, slug, monthly_price_cents, annual_price_cents,
  fee_discount_percentage, max_active_bids, max_service_categories,
  featured_placement, analytics_access, priority_support,
  verified_badge_boost, portfolio_image_limit, instant_enabled,
  sort_order, is_active, role, price_cents)
SELECT 'Pro', 'pro', 2999, 28790,
  0.02, 10, 5,
  false, true, true,
  false, 20, false,
  1, true, 'provider', 2999
WHERE NOT EXISTS (SELECT 1 FROM subscription_tiers WHERE slug = 'pro')
ON CONFLICT DO NOTHING;

INSERT INTO subscription_tiers (name, slug, monthly_price_cents, annual_price_cents,
  fee_discount_percentage, max_active_bids, max_service_categories,
  featured_placement, analytics_access, priority_support,
  verified_badge_boost, portfolio_image_limit, instant_enabled,
  sort_order, is_active, role, price_cents)
SELECT 'Business', 'business', 7999, 76790,
  0.04, 50, 20,
  true, true, true,
  true, 100, true,
  2, true, 'provider', 7999
WHERE NOT EXISTS (SELECT 1 FROM subscription_tiers WHERE slug = 'business')
ON CONFLICT DO NOTHING;
