-- 050_platform_bank_account.up.sql
-- The platform's own payout bank account (a Stripe External Account on the
-- PLATFORM Stripe account). Application fees accrue to the platform Stripe
-- balance; this row records where that balance pays out to.
--
-- SECURITY: we NEVER store raw account or routing numbers. Only the Stripe
-- external-account reference and the non-sensitive metadata Stripe returns
-- (last4, bank name, status). Raw numbers are tokenized client-side via
-- Stripe.js and exchanged for a bank_account token before they reach us.

CREATE TABLE platform_bank_account (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_external_account_id  TEXT NOT NULL,                      -- ba_... on the platform account
  bank_name                   TEXT,
  account_holder_name         TEXT,
  account_holder_type         TEXT NOT NULL DEFAULT 'company',    -- individual | company
  last4                       TEXT NOT NULL,                      -- last 4 of account number (Stripe-returned)
  routing_last4               TEXT,                               -- last 4 of routing number, display only
  currency                    TEXT NOT NULL DEFAULT 'usd',
  country                     TEXT NOT NULL DEFAULT 'US',
  status                      TEXT NOT NULL DEFAULT 'new',        -- new | validated | verification_failed | errored
  is_default                  BOOLEAN NOT NULL DEFAULT true,
  set_by_admin_id             UUID REFERENCES users(id),
  deleted_at                  TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one active default account at a time.
CREATE UNIQUE INDEX idx_platform_bank_account_one_default
  ON platform_bank_account (is_default)
  WHERE is_default = true AND deleted_at IS NULL;

CREATE INDEX idx_platform_bank_account_stripe_id
  ON platform_bank_account (stripe_external_account_id);

CREATE TRIGGER set_updated_at_platform_bank_account
  BEFORE UPDATE ON platform_bank_account
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
