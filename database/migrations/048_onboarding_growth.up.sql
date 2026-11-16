-- 048_onboarding_growth.up.sql
--
-- Onboarding & growth surface: extends the existing referrals table from
-- migration 001 with a simpler status flow + flat credit_cents fields the
-- new gateway handler uses, adds a referral_credits ledger table for the
-- per-user credit balance the web client renders, and stands up the
-- nps_surveys table for post-transaction surveys.
--
-- Note: the existing referrals table already has `status`, but its CHECK
-- constraint enumerates a different state machine (pending/signed_up/...).
-- We do NOT drop or rewrite that — we keep it for legacy rows. The new
-- columns (`credit_cents`, `credited_at`) are additive and safe to add
-- IF NOT EXISTS to remain idempotent across re-runs.

-- credit_cents is the flat $-amount granted to BOTH parties (referrer and
-- referred). The original schema had separate referrer_credit_cents /
-- referred_credit_cents BIGINT columns; we keep those (still BACKED by the
-- existing schema) and add this single field for the new flat-rate flow.
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS credit_cents BIGINT NOT NULL DEFAULT 1000;  -- $10 default

-- credited_at already exists on the legacy schema; this is a no-op there.
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ;

-- The legacy expires_at is NOT NULL — for new rows created via the simple
-- flat-credit flow we want to default it to now()+90 days so existing
-- INSERTs that don't supply expires_at don't fail.
ALTER TABLE referrals
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 days');

-- ────────────────────────────────────────────────────────────────────────
-- referral_credits — per-user credit ledger
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_credits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  -- positive = credit granted, negative = consumed
  amount_cents  BIGINT NOT NULL,
  reference_id  UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source IN ('referral_redeemed','referral_signup','admin_grant','consumed'))
);
CREATE INDEX IF NOT EXISTS idx_referral_credits_user
  ON referral_credits (user_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────
-- nps_surveys — post-transaction NPS prompts
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nps_surveys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  context_type  TEXT NOT NULL,                      -- 'listing_order' | 'contract'
  context_id    UUID NOT NULL,
  score         INT,                                -- 0..10
  comment       TEXT,
  prompted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ,
  CHECK (score IS NULL OR score BETWEEN 0 AND 10),
  CHECK (context_type IN ('listing_order','contract')),
  UNIQUE (user_id, context_type, context_id)
);
CREATE INDEX IF NOT EXISTS idx_nps_surveys_pending
  ON nps_surveys (prompted_at) WHERE responded_at IS NULL;
