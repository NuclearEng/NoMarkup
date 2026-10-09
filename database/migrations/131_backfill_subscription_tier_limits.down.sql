UPDATE subscription_tiers
SET
  max_active_bids = 3,
  max_service_categories = 1,
  featured_placement = FALSE,
  analytics_access = FALSE,
  priority_support = FALSE,
  verified_badge_boost = FALSE,
  portfolio_image_limit = 5,
  instant_enabled = FALSE
WHERE slug IN ('pro_customer', 'pro_provider');

UPDATE subscription_tiers
SET monthly_price_cents = 0
WHERE slug IN ('pro_customer', 'pro_provider');
