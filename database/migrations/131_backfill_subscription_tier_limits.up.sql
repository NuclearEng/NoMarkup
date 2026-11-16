-- Seed INSERT historically set price_cents + features_json but left the 019
-- limit columns at defaults (monthly_price_cents=0, max_active_bids=3, all
-- feature bools false). Plan limits UI then showed every slug as
-- "Included free for launch" with identical 3/1/5/Off rows.
-- Backfill from price_cents and apply Pro / Business-class limits on the
-- seed slugs. Idempotent: only fills empty monthly_price_cents and only
-- upgrades seed slugs that still have the free-tier default bid cap.

UPDATE subscription_tiers
SET monthly_price_cents = price_cents
WHERE monthly_price_cents = 0
  AND price_cents > 0;

UPDATE subscription_tiers
SET
  max_active_bids = 10,
  max_service_categories = 5,
  analytics_access = TRUE,
  priority_support = TRUE,
  portfolio_image_limit = 20
WHERE slug = 'pro_customer'
  AND max_active_bids = 3;

UPDATE subscription_tiers
SET
  max_active_bids = 50,
  max_service_categories = 20,
  featured_placement = TRUE,
  analytics_access = TRUE,
  priority_support = TRUE,
  verified_badge_boost = TRUE,
  portfolio_image_limit = 100,
  instant_enabled = TRUE
WHERE slug = 'pro_provider'
  AND max_active_bids = 3;
