-- Launch market #1: Washington State (the beachhead).
-- Rollout is controlled by markets.is_active. This sets the INITIAL launched set
-- so production starts live in WA; every subsequent city/state/country launch is
-- done at runtime via the admin Markets tool (PATCH /api/v1/admin/markets), not a
-- migration. Idempotent. Down reverts WA to not-launched.
UPDATE markets SET is_active = true, updated_at = now()
 WHERE country = 'US' AND region_code = 'WA';
