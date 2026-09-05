-- 048_onboarding_growth.down.sql
--
-- Drops the NPS + credit ledger tables introduced by the up migration.
-- Leaves the additive columns on `referrals` in place — rolling back the
-- ALTER ... SET DEFAULT to its prior value is unsafe without knowing what
-- that value was, and the legacy code path doesn't read `credit_cents`.

DROP TABLE IF EXISTS nps_surveys;
DROP TABLE IF EXISTS referral_credits;

-- The credit_cents / credited_at columns are kept (they're harmless and
-- some prod data may already reference them).
