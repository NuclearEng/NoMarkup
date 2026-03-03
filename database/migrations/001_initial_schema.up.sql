-- NoMarkup: Initial Database Schema
-- PostgreSQL 16 + PostGIS 3.4
-- All monetary values in cents (BIGINT)
-- All timestamps in UTC (TIMESTAMPTZ)
-- All IDs are UUID v7 (time-sortable)
-- Soft deletes via deleted_at column

-- ============================================================
-- EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- trigram similarity for search

-- ============================================================
-- HELPER: updated_at trigger function
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. USERS & AUTH
-- ============================================================

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  email_verified  BOOLEAN NOT NULL DEFAULT false,
  password_hash   TEXT,  -- NULL for OAuth-only users
  phone           TEXT UNIQUE,
  phone_verified  BOOLEAN NOT NULL DEFAULT false,
  display_name    TEXT NOT NULL,
  avatar_url      TEXT,
  roles           TEXT[] NOT NULL DEFAULT '{}',  -- 'customer', 'provider', 'admin', 'support', 'analyst'
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned', 'deactivated')),
  suspension_reason TEXT,
  mfa_enabled     BOOLEAN NOT NULL DEFAULT false,
  mfa_secret      TEXT,  -- encrypted TOTP secret
  mfa_backup_codes TEXT[],  -- encrypted backup codes
  last_login_at   TIMESTAMPTZ,
  last_active_at  TIMESTAMPTZ,
  timezone        TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE TRIGGER set_updated_at_users
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_users_email ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_phone ON users (phone) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_status ON users (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_roles ON users USING GIN (roles) WHERE deleted_at IS NULL;

-- OAuth linked accounts
CREATE TABLE oauth_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_id TEXT NOT NULL,
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);

CREATE INDEX idx_oauth_accounts_user_id ON oauth_accounts (user_id);

-- Refresh tokens
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  device_info TEXT,
  ip_address  INET,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_expires ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;

-- ============================================================
-- 2. PROVIDER PROFILES
-- ============================================================

CREATE TABLE provider_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name     TEXT,
  bio               TEXT,  -- 500 char max enforced at app layer
  service_address   TEXT,
  service_location  geometry(Point, 4326),  -- PostGIS point
  service_radius_km NUMERIC(6,2) NOT NULL DEFAULT 50,
  -- Global terms
  default_payment_timing  TEXT NOT NULL DEFAULT 'completion' CHECK (default_payment_timing IN ('upfront', 'milestone', 'completion', 'payment_plan', 'recurring')),
  default_milestone_json  JSONB,  -- [{description, percentage}]
  cancellation_policy     TEXT,
  warranty_terms          TEXT,
  -- Instant availability
  instant_enabled   BOOLEAN NOT NULL DEFAULT false,
  instant_schedule  JSONB,  -- [{day: 'mon', start: '06:00', end: '22:00'}]
  instant_available BOOLEAN NOT NULL DEFAULT false,  -- real-time toggle
  -- Metrics (denormalized for read performance, computed by trust engine)
  jobs_completed    INTEGER NOT NULL DEFAULT 0,
  avg_response_time_minutes INTEGER,
  on_time_rate      NUMERIC(5,4),  -- 0.0000 to 1.0000
  profile_completeness INTEGER NOT NULL DEFAULT 0,  -- 0-100
  -- Stripe Connect
  stripe_account_id TEXT,  -- Stripe Express account ID
  stripe_onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_provider_profiles
  BEFORE UPDATE ON provider_profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_provider_profiles_user_id ON provider_profiles (user_id);
CREATE INDEX idx_provider_profiles_location ON provider_profiles USING GIST (service_location);
CREATE INDEX idx_provider_profiles_instant ON provider_profiles (instant_enabled, instant_available) WHERE instant_enabled = true;

-- Provider portfolio images
CREATE TABLE provider_portfolio_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  image_url   TEXT NOT NULL,
  caption     TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_portfolio_images_provider ON provider_portfolio_images (provider_id, sort_order);

-- ============================================================
-- 3. SERVICE TAXONOMY
-- ============================================================

-- 3-level hierarchy: Category > Subcategory > Service Type

CREATE TABLE service_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID REFERENCES service_categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  level       INTEGER NOT NULL CHECK (level IN (1, 2, 3)),  -- 1=category, 2=subcategory, 3=service_type
  description TEXT,
  icon        TEXT,  -- icon identifier
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_service_categories
  BEFORE UPDATE ON service_categories
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_service_categories_parent ON service_categories (parent_id) WHERE active = true;
CREATE INDEX idx_service_categories_slug ON service_categories (slug);
CREATE INDEX idx_service_categories_level ON service_categories (level, sort_order) WHERE active = true;

-- Provider ↔ Service Category (many-to-many)
CREATE TABLE provider_service_categories (
  provider_id  UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, category_id)
);

CREATE INDEX idx_psc_category ON provider_service_categories (category_id);

-- ============================================================
-- 4. PROPERTIES (Multi-property support)
-- ============================================================

CREATE TABLE properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname    TEXT,  -- "Lake House", "Rental Unit 3B"
  address     TEXT NOT NULL,
  city        TEXT NOT NULL,
  state       TEXT NOT NULL,
  zip_code    TEXT NOT NULL,
  location    geometry(Point, 4326) NOT NULL,
  notes       TEXT,  -- gate codes, access instructions
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE TRIGGER set_updated_at_properties
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_properties_user ON properties (user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_properties_zip ON properties (zip_code) WHERE deleted_at IS NULL;

-- ============================================================
-- 5. VERIFICATION & DOCUMENTS
-- ============================================================

CREATE TABLE verification_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type     TEXT NOT NULL CHECK (document_type IN (
    'government_id', 'business_license', 'ein', 'insurance', 'trade_license', 'background_check'
  )),
  file_url          TEXT NOT NULL,  -- S3 path (private bucket)
  file_name         TEXT NOT NULL,
  file_size_bytes   INTEGER NOT NULL,
  mime_type         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected', 'expired')),
  rejection_reason  TEXT,
  resubmission_count INTEGER NOT NULL DEFAULT 0,
  expires_at        TIMESTAMPTZ,  -- for insurance, licenses
  expiry_notified   BOOLEAN NOT NULL DEFAULT false,
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_verification_documents
  BEFORE UPDATE ON verification_documents
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_verification_docs_user ON verification_documents (user_id, document_type);
CREATE INDEX idx_verification_docs_status ON verification_documents (status) WHERE status = 'pending';
CREATE INDEX idx_verification_docs_expiry ON verification_documents (expires_at) WHERE status = 'verified' AND expires_at IS NOT NULL;

-- ============================================================
-- 6. JOBS & AUCTIONS
-- ============================================================

CREATE TABLE jobs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID NOT NULL REFERENCES users(id),
  property_id           UUID REFERENCES properties(id),
  -- Job details
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,
  -- Category (links to service_type level, but we store full path)
  category_id           UUID NOT NULL REFERENCES service_categories(id),
  subcategory_id        UUID REFERENCES service_categories(id),
  service_type_id       UUID REFERENCES service_categories(id),
  -- Location
  service_address       TEXT,  -- exact address, revealed post-award
  service_city          TEXT NOT NULL,
  service_state         TEXT NOT NULL,
  service_zip           TEXT NOT NULL,
  service_location      geometry(Point, 4326) NOT NULL,  -- exact point
  approximate_location  geometry(Point, 4326) NOT NULL,  -- zip centroid for pre-award display
  -- Schedule
  schedule_type         TEXT NOT NULL DEFAULT 'flexible' CHECK (schedule_type IN ('specific_date', 'date_range', 'flexible')),
  scheduled_date        DATE,
  schedule_range_start  DATE,
  schedule_range_end    DATE,
  -- Recurrence
  is_recurring          BOOLEAN NOT NULL DEFAULT false,
  recurrence_frequency  TEXT CHECK (recurrence_frequency IN ('weekly', 'biweekly', 'monthly')),
  -- Auction params
  starting_bid_cents    BIGINT,  -- optional ceiling
  offer_accepted_cents  BIGINT,  -- optional "Offer Accepted" price
  auction_duration_hours INTEGER NOT NULL DEFAULT 72,
  auction_ends_at       TIMESTAMPTZ,  -- computed: created_at + duration
  min_provider_rating   NUMERIC(2,1),  -- optional filter
  -- Status
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'active', 'closed', 'closed_zero_bids', 'awarded',
    'contract_pending', 'in_progress', 'completed', 'reviewed',
    'cancelled', 'reposted', 'expired', 'suspended'
  )),
  -- Relationships
  awarded_provider_id   UUID REFERENCES users(id),
  awarded_bid_id        UUID,  -- FK added after bids table
  reposted_from_id      UUID REFERENCES jobs(id),
  repost_count          INTEGER NOT NULL DEFAULT 0,
  -- Counts (denormalized)
  bid_count             INTEGER NOT NULL DEFAULT 0,
  -- Timestamps
  awarded_at            TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ
);

CREATE TRIGGER set_updated_at_jobs
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_jobs_customer ON jobs (customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_status ON jobs (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_category ON jobs (category_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_location ON jobs USING GIST (approximate_location) WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX idx_jobs_auction_ends ON jobs (auction_ends_at) WHERE status = 'active';
CREATE INDEX idx_jobs_property ON jobs (property_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_awarded_provider ON jobs (awarded_provider_id) WHERE awarded_provider_id IS NOT NULL;
CREATE INDEX idx_jobs_reposted_from ON jobs (reposted_from_id) WHERE reposted_from_id IS NOT NULL;
CREATE INDEX idx_jobs_created_at ON jobs (created_at DESC) WHERE status = 'active' AND deleted_at IS NULL;

-- Job photos
CREATE TABLE job_photos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  image_url  TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_photos_job ON job_photos (job_id, sort_order);

-- Job tags (span multiple categories)
CREATE TABLE job_tags (
  job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES service_categories(id),
  PRIMARY KEY (job_id, category_id)
);

-- ============================================================
-- 7. BIDS
-- ============================================================

CREATE TABLE bids (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                UUID NOT NULL REFERENCES jobs(id),
  provider_id           UUID NOT NULL REFERENCES users(id),
  amount_cents          BIGINT NOT NULL CHECK (amount_cents > 0),
  is_offer_accepted     BOOLEAN NOT NULL DEFAULT false,  -- accepted the Offer Accepted price
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'awarded', 'not_selected', 'withdrawn', 'expired')),
  -- History
  original_amount_cents BIGINT NOT NULL,  -- first bid amount (bids can only go lower)
  bid_updates           JSONB DEFAULT '[]',  -- [{amount_cents, updated_at}]
  -- Timestamps
  awarded_at            TIMESTAMPTZ,
  withdrawn_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, provider_id)  -- one bid per provider per job
);

CREATE TRIGGER set_updated_at_bids
  BEFORE UPDATE ON bids
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_bids_job ON bids (job_id, status);
CREATE INDEX idx_bids_provider ON bids (provider_id, status);
CREATE INDEX idx_bids_job_amount ON bids (job_id, amount_cents) WHERE status = 'active';

-- Add FK from jobs.awarded_bid_id
ALTER TABLE jobs ADD CONSTRAINT fk_jobs_awarded_bid FOREIGN KEY (awarded_bid_id) REFERENCES bids(id);

-- ============================================================
-- 8. CONTRACTS
-- ============================================================

CREATE TABLE contracts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number     TEXT NOT NULL UNIQUE,  -- NM-2026-00001
  job_id              UUID NOT NULL REFERENCES jobs(id),
  customer_id         UUID NOT NULL REFERENCES users(id),
  provider_id         UUID NOT NULL REFERENCES users(id),
  bid_id              UUID NOT NULL REFERENCES bids(id),
  -- Terms
  amount_cents        BIGINT NOT NULL,
  payment_timing      TEXT NOT NULL CHECK (payment_timing IN ('upfront', 'milestone', 'completion', 'payment_plan', 'recurring')),
  terms_json          JSONB,  -- full contract terms snapshot
  schedule_json       JSONB,  -- schedule details
  -- Status
  status              TEXT NOT NULL DEFAULT 'pending_acceptance' CHECK (status IN (
    'pending_acceptance', 'active', 'completed', 'cancelled', 'voided',
    'disputed', 'abandoned', 'suspended'
  )),
  customer_accepted   BOOLEAN NOT NULL DEFAULT false,
  provider_accepted   BOOLEAN NOT NULL DEFAULT false,
  acceptance_deadline TIMESTAMPTZ,  -- 72 hours from creation
  -- Timestamps
  accepted_at         TIMESTAMPTZ,  -- both accepted
  started_at          TIMESTAMPTZ,  -- work begins
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancelled_by        UUID REFERENCES users(id),
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_contracts
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_contracts_job ON contracts (job_id);
CREATE INDEX idx_contracts_customer ON contracts (customer_id, status);
CREATE INDEX idx_contracts_provider ON contracts (provider_id, status);
CREATE INDEX idx_contracts_status ON contracts (status);
CREATE INDEX idx_contracts_acceptance_deadline ON contracts (acceptance_deadline) WHERE status = 'pending_acceptance';
CREATE INDEX idx_contracts_number ON contracts (contract_number);

-- Contract number sequence
CREATE SEQUENCE contract_number_seq START WITH 1;

-- Milestones
CREATE TABLE milestones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
  sort_order      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'submitted', 'approved', 'disputed', 'revision_requested'
  )),
  revision_count  INTEGER NOT NULL DEFAULT 0,  -- max 3 per FR-15.4
  revision_notes  TEXT,
  submitted_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_milestones
  BEFORE UPDATE ON milestones
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_milestones_contract ON milestones (contract_id, sort_order);
CREATE INDEX idx_milestones_status ON milestones (status) WHERE status IN ('submitted', 'disputed');

-- Change orders (post first-payment contract modifications)
CREATE TABLE change_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  proposed_by     UUID NOT NULL REFERENCES users(id),
  description     TEXT NOT NULL,
  changes_json    JSONB NOT NULL,  -- {added_milestones, removed_milestones, amended_terms}
  amount_delta_cents BIGINT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected', 'expired')),
  accepted_at     TIMESTAMPTZ,
  rejected_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_change_orders
  BEFORE UPDATE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_change_orders_contract ON change_orders (contract_id);

-- ============================================================
-- 9. RECURRING JOBS
-- ============================================================

CREATE TABLE recurring_configs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id       UUID NOT NULL UNIQUE REFERENCES contracts(id),
  frequency         TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  rate_cents        BIGINT NOT NULL CHECK (rate_cents > 0),
  auto_approve      BOOLEAN NOT NULL DEFAULT false,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  paused_at         TIMESTAMPTZ,
  pause_max_date    TIMESTAMPTZ,  -- auto-cancel after 90 days paused
  next_occurrence   DATE NOT NULL,
  cancelled_at      TIMESTAMPTZ,
  cancelled_by      UUID REFERENCES users(id),
  notice_period_end DATE,  -- 1 occurrence notice per FR-18.5
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_recurring_configs
  BEFORE UPDATE ON recurring_configs
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_recurring_configs_contract ON recurring_configs (contract_id);
CREATE INDEX idx_recurring_configs_next ON recurring_configs (next_occurrence) WHERE status = 'active';

CREATE TABLE recurring_instances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_id    UUID NOT NULL REFERENCES recurring_configs(id) ON DELETE CASCADE,
  contract_id     UUID NOT NULL REFERENCES contracts(id),
  occurrence_date DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'in_progress', 'completed', 'skipped', 'cancelled'
  )),
  amount_cents    BIGINT NOT NULL,
  completed_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  auto_approved   BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_recurring_instances
  BEFORE UPDATE ON recurring_instances
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_recurring_instances_recurring ON recurring_instances (recurring_id, occurrence_date);
CREATE INDEX idx_recurring_instances_contract ON recurring_instances (contract_id);
CREATE INDEX idx_recurring_instances_status ON recurring_instances (status) WHERE status = 'scheduled';

-- ============================================================
-- 10. PAYMENTS
-- ============================================================

CREATE TABLE payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id           UUID NOT NULL REFERENCES contracts(id),
  milestone_id          UUID REFERENCES milestones(id),
  recurring_instance_id UUID REFERENCES recurring_instances(id),
  -- Parties
  customer_id           UUID NOT NULL REFERENCES users(id),
  provider_id           UUID NOT NULL REFERENCES users(id),
  -- Amounts
  amount_cents          BIGINT NOT NULL CHECK (amount_cents > 0),
  platform_fee_cents    BIGINT NOT NULL DEFAULT 0,
  guarantee_fee_cents   BIGINT NOT NULL DEFAULT 0,  -- 2-3% for NoMarkup Guarantee fund
  provider_payout_cents BIGINT NOT NULL,  -- amount - platform_fee - guarantee_fee
  -- Stripe
  stripe_payment_intent_id  TEXT,
  stripe_charge_id          TEXT,
  stripe_transfer_id        TEXT,
  stripe_refund_id          TEXT,
  idempotency_key           TEXT NOT NULL UNIQUE,
  -- Status
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'escrow', 'released', 'completed',
    'failed', 'refunded', 'partially_refunded', 'disputed', 'chargeback'
  )),
  failure_reason        TEXT,
  -- Refund tracking
  refund_amount_cents   BIGINT DEFAULT 0,
  refund_reason         TEXT,
  refunded_at           TIMESTAMPTZ,
  -- Payment plan
  installment_number    INTEGER,
  total_installments    INTEGER,
  -- Retry tracking
  retry_count           INTEGER NOT NULL DEFAULT 0,
  next_retry_at         TIMESTAMPTZ,
  -- Timestamps
  escrow_at             TIMESTAMPTZ,
  released_at           TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_payments
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_payments_contract ON payments (contract_id);
CREATE INDEX idx_payments_customer ON payments (customer_id, status);
CREATE INDEX idx_payments_provider ON payments (provider_id, status);
CREATE INDEX idx_payments_stripe_pi ON payments (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX idx_payments_status ON payments (status) WHERE status IN ('pending', 'processing', 'escrow', 'failed');
CREATE INDEX idx_payments_retry ON payments (next_retry_at) WHERE status = 'failed' AND next_retry_at IS NOT NULL;
CREATE INDEX idx_payments_milestone ON payments (milestone_id) WHERE milestone_id IS NOT NULL;

-- ============================================================
-- 11. REVIEWS
-- ============================================================

CREATE TABLE reviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id         UUID NOT NULL REFERENCES contracts(id),
  job_id              UUID NOT NULL REFERENCES jobs(id),
  reviewer_id         UUID NOT NULL REFERENCES users(id),
  reviewee_id         UUID NOT NULL REFERENCES users(id),
  reviewer_role       TEXT NOT NULL CHECK (reviewer_role IN ('customer', 'provider')),
  -- Ratings
  overall_rating      SMALLINT NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  -- Customer → Provider ratings
  quality_rating      SMALLINT CHECK (quality_rating BETWEEN 1 AND 5),
  timeliness_rating   SMALLINT CHECK (timeliness_rating BETWEEN 1 AND 5),
  communication_rating SMALLINT CHECK (communication_rating BETWEEN 1 AND 5),
  value_rating        SMALLINT CHECK (value_rating BETWEEN 1 AND 5),
  -- Provider → Customer ratings
  payment_promptness_rating SMALLINT CHECK (payment_promptness_rating BETWEEN 1 AND 5),
  scope_accuracy_rating     SMALLINT CHECK (scope_accuracy_rating BETWEEN 1 AND 5),
  access_rating             SMALLINT CHECK (access_rating BETWEEN 1 AND 5),
  -- Text
  review_text         TEXT,  -- 2000 char max
  -- Status
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'flagged', 'removed')),
  published_at        TIMESTAMPTZ,
  flagged_at          TIMESTAMPTZ,
  flag_reason         TEXT,
  flagged_by          UUID REFERENCES users(id),
  -- Both reviews must be in before publishing (or 14-day window)
  review_window_ends  TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, reviewer_id)
);

CREATE TRIGGER set_updated_at_reviews
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_reviews_reviewee ON reviews (reviewee_id, status) WHERE status = 'published';
CREATE INDEX idx_reviews_reviewer ON reviews (reviewer_id);
CREATE INDEX idx_reviews_contract ON reviews (contract_id);
CREATE INDEX idx_reviews_job ON reviews (job_id);
CREATE INDEX idx_reviews_pending ON reviews (review_window_ends) WHERE status = 'pending';
CREATE INDEX idx_reviews_flagged ON reviews (flagged_at) WHERE status = 'flagged';

-- Review responses
CREATE TABLE review_responses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   UUID NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  response_text TEXT NOT NULL,  -- 500 char max
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_review_responses
  BEFORE UPDATE ON review_responses
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================
-- 12. TRUST SCORES
-- ============================================================

CREATE TABLE trust_scores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES users(id),
  role              TEXT NOT NULL CHECK (role IN ('customer', 'provider')),
  -- Overall
  overall_score     NUMERIC(5,2) NOT NULL DEFAULT 50.00 CHECK (overall_score BETWEEN 0 AND 100),
  tier              TEXT NOT NULL DEFAULT 'new' CHECK (tier IN ('under_review', 'new', 'rising', 'trusted', 'top_rated')),
  -- Dimensions (0-100 each)
  feedback_score    NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  volume_score      NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  risk_score        NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  fraud_score       NUMERIC(5,2) NOT NULL DEFAULT 100.00,  -- starts clean
  -- Dimension sub-scores (JSONB for flexibility)
  feedback_details  JSONB,  -- {star_avg, value_avg, on_time_pct, communication_avg}
  volume_details    JSONB,  -- {completed, repeat_rate, response_time_tier, tenure_months}
  risk_details      JSONB,  -- {id_verified, biz_docs_count, insurance_verified, cancel_rate, dispute_rate}
  fraud_details     JSONB,  -- {account_flags, review_flags, txn_flags, behavior_flags}
  -- Metadata
  last_computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  computation_version INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_trust_scores
  BEFORE UPDATE ON trust_scores
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_trust_scores_user ON trust_scores (user_id, role);
CREATE INDEX idx_trust_scores_tier ON trust_scores (tier, overall_score DESC);

-- Trust score history (for auditing and analytics)
CREATE TABLE trust_score_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  role            TEXT NOT NULL,
  overall_score   NUMERIC(5,2) NOT NULL,
  feedback_score  NUMERIC(5,2) NOT NULL,
  volume_score    NUMERIC(5,2) NOT NULL,
  risk_score      NUMERIC(5,2) NOT NULL,
  fraud_score     NUMERIC(5,2) NOT NULL,
  trigger_event   TEXT NOT NULL,  -- 'review', 'verification', 'fraud_signal', 'transaction', 'scheduled'
  trigger_entity_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_trust_history_user ON trust_score_history (user_id, created_at DESC);

-- ============================================================
-- 13. CHAT
-- ============================================================

CREATE TABLE chat_channels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES jobs(id),
  customer_id   UUID NOT NULL REFERENCES users(id),
  provider_id   UUID NOT NULL REFERENCES users(id),
  -- Status
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending_approval', 'active', 'read_only', 'closed')),
  channel_type  TEXT NOT NULL DEFAULT 'bid' CHECK (channel_type IN ('inquiry', 'bid', 'contract')),
  -- Read state
  customer_last_read_at TIMESTAMPTZ,
  provider_last_read_at TIMESTAMPTZ,
  last_message_at       TIMESTAMPTZ,
  message_count         INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, customer_id, provider_id)
);

CREATE TRIGGER set_updated_at_chat_channels
  BEFORE UPDATE ON chat_channels
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_chat_channels_job ON chat_channels (job_id);
CREATE INDEX idx_chat_channels_customer ON chat_channels (customer_id, last_message_at DESC);
CREATE INDEX idx_chat_channels_provider ON chat_channels (provider_id, last_message_at DESC);

CREATE TABLE chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id),
  -- Content
  message_type    TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN (
    'text', 'image', 'file', 'proposed_terms', 'terms_accepted', 'terms_rejected',
    'contact_share', 'system'
  )),
  content         TEXT,
  metadata_json   JSONB,  -- for proposed_terms: {payment_timing, milestones, ...}
  -- Attachments inline
  attachment_url  TEXT,
  attachment_name TEXT,
  attachment_type TEXT,
  attachment_size INTEGER,
  -- Off-platform detection
  flagged_contact_info BOOLEAN NOT NULL DEFAULT false,
  -- Status
  is_deleted      BOOLEAN NOT NULL DEFAULT false,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_channel ON chat_messages (channel_id, created_at);
CREATE INDEX idx_chat_messages_sender ON chat_messages (sender_id);
-- Full-text search on messages
CREATE INDEX idx_chat_messages_content ON chat_messages USING GIN (to_tsvector('english', content)) WHERE content IS NOT NULL;

-- ============================================================
-- 14. DISPUTES
-- ============================================================

CREATE TABLE disputes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID NOT NULL REFERENCES contracts(id),
  opened_by       UUID NOT NULL REFERENCES users(id),
  -- Details
  dispute_type    TEXT NOT NULL CHECK (dispute_type IN (
    'quality', 'incomplete_work', 'no_show', 'abandonment', 'payment',
    'scope_disagreement', 'guarantee_claim', 'other'
  )),
  description     TEXT NOT NULL,
  evidence_urls   TEXT[],  -- photos, documents
  -- Resolution
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'under_review', 'resolved', 'escalated', 'closed'
  )),
  resolution_type TEXT CHECK (resolution_type IN (
    'release_payment', 'partial_refund', 'full_refund', 'contract_terminated',
    'dismissed', 'guarantee_invoked'
  )),
  resolution_notes   TEXT,
  refund_amount_cents BIGINT,
  resolved_by        UUID REFERENCES users(id),
  -- SLA tracking
  first_response_at  TIMESTAMPTZ,
  resolved_at        TIMESTAMPTZ,
  -- Guarantee
  is_guarantee_claim BOOLEAN NOT NULL DEFAULT false,
  guarantee_outcome  TEXT CHECK (guarantee_outcome IN ('replacement_provider', 'refund', 'denied')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_disputes
  BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_disputes_contract ON disputes (contract_id);
CREATE INDEX idx_disputes_status ON disputes (status) WHERE status IN ('open', 'under_review');
CREATE INDEX idx_disputes_guarantee ON disputes (is_guarantee_claim) WHERE is_guarantee_claim = true;

-- ============================================================
-- 15. FRAUD DETECTION
-- ============================================================

-- Raw session/behavior data for ML
CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id),  -- NULL for anonymous
  ip_address      INET NOT NULL,
  user_agent      TEXT,
  device_fingerprint TEXT,  -- browser fingerprint hash
  fingerprint_components JSONB,  -- canvas, webgl, audio, fonts
  geo_lat         NUMERIC(9,6),
  geo_lng         NUMERIC(9,6),
  geo_city        TEXT,
  geo_country     TEXT,
  session_start   TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_end     TIMESTAMPTZ,
  page_views      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_user ON user_sessions (user_id, session_start DESC);
CREATE INDEX idx_user_sessions_ip ON user_sessions (ip_address);
CREATE INDEX idx_user_sessions_fingerprint ON user_sessions (device_fingerprint) WHERE device_fingerprint IS NOT NULL;

-- Fraud signals (output of detection system)
CREATE TABLE fraud_signals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  -- Signal details
  signal_type       TEXT NOT NULL CHECK (signal_type IN (
    'review_manipulation', 'account_fraud', 'bid_manipulation',
    'transaction_fraud', 'bad_actor_behavior'
  )),
  signal_subtype    TEXT NOT NULL,  -- specific signal: 'shared_ip', 'review_ring', 'burst_reviews', etc.
  severity          TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  confidence        NUMERIC(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  -- Evidence
  description       TEXT NOT NULL,
  evidence_json     JSONB,  -- {ip_match: {...}, device_match: {...}, etc.}
  related_user_ids  UUID[],
  related_entity_id UUID,
  related_entity_type TEXT,  -- 'review', 'bid', 'job', 'payment'
  -- Resolution
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'dismissed', 'actioned')),
  action_taken      TEXT,  -- 'warned', 'suspended', 'banned', 'review_removed', 'bid_removed'
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  -- Auto-action
  auto_actioned     BOOLEAN NOT NULL DEFAULT false,
  auto_action       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_fraud_signals
  BEFORE UPDATE ON fraud_signals
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_fraud_signals_user ON fraud_signals (user_id, created_at DESC);
CREATE INDEX idx_fraud_signals_status ON fraud_signals (status, severity) WHERE status = 'pending';
CREATE INDEX idx_fraud_signals_type ON fraud_signals (signal_type, severity);

-- ============================================================
-- 16. NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  -- Content
  notification_type TEXT NOT NULL,  -- 'new_bid', 'bid_awarded', 'new_message', 'payment_received', etc.
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  -- Navigation
  action_url      TEXT,  -- deep link to relevant page
  entity_type     TEXT,  -- 'job', 'bid', 'contract', 'chat', 'payment', 'review'
  entity_id       UUID,
  -- Delivery
  channels        TEXT[] NOT NULL DEFAULT '{in_app}',  -- 'in_app', 'email', 'web_push'
  email_sent      BOOLEAN NOT NULL DEFAULT false,
  push_sent       BOOLEAN NOT NULL DEFAULT false,
  -- State
  read            BOOLEAN NOT NULL DEFAULT false,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications (user_id, read, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications (user_id, created_at DESC) WHERE read = false;
CREATE INDEX idx_notifications_type ON notifications (notification_type, created_at DESC);

-- Notification preferences
CREATE TABLE notification_preferences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- Per-type channel preferences (JSONB for flexibility)
  -- {notification_type: {in_app: true, email: true, push: true}}
  preferences       JSONB NOT NULL DEFAULT '{}',
  email_digest      TEXT NOT NULL DEFAULT 'daily' CHECK (email_digest IN ('immediate', 'daily', 'weekly', 'off')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_notification_preferences
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================
-- 17. SUBSCRIPTIONS & MONETIZATION
-- ============================================================

CREATE TABLE subscription_tiers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,  -- 'free', 'pro_customer', 'pro_provider'
  role            TEXT NOT NULL CHECK (role IN ('customer', 'provider')),
  price_cents     BIGINT NOT NULL,  -- monthly price, 0 for free
  -- Limits
  max_active_jobs INTEGER,  -- NULL = unlimited
  max_bids_per_month INTEGER,  -- NULL = unlimited
  features_json   JSONB NOT NULL DEFAULT '{}',  -- {analytics: true, priority_placement: true, ...}
  -- Trial
  trial_days      INTEGER NOT NULL DEFAULT 0,
  -- Stripe
  stripe_price_id TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_subscription_tiers
  BEFORE UPDATE ON subscription_tiers
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id),
  tier_id               UUID NOT NULL REFERENCES subscription_tiers(id),
  -- Stripe
  stripe_subscription_id TEXT,
  stripe_customer_id    TEXT,
  -- Status
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'trialing', 'active', 'past_due', 'cancelled', 'expired'
  )),
  -- Dates
  trial_ends_at         TIMESTAMPTZ,
  current_period_start  TIMESTAMPTZ NOT NULL,
  current_period_end    TIMESTAMPTZ NOT NULL,
  cancelled_at          TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  -- Usage tracking
  active_jobs_count     INTEGER NOT NULL DEFAULT 0,
  bids_this_month       INTEGER NOT NULL DEFAULT 0,
  bids_month_reset      DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_subscriptions
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_subscriptions_user ON subscriptions (user_id, status);
CREATE INDEX idx_subscriptions_status ON subscriptions (status) WHERE status IN ('active', 'trialing', 'past_due');
CREATE INDEX idx_subscriptions_stripe ON subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Platform fee configuration
CREATE TABLE platform_fee_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id       UUID REFERENCES service_categories(id),  -- NULL = default for all
  fee_percentage    NUMERIC(5,4) NOT NULL,  -- e.g., 0.0500 = 5%
  guarantee_percentage NUMERIC(5,4) NOT NULL DEFAULT 0.0200,  -- 2% for guarantee fund
  min_fee_cents     BIGINT NOT NULL DEFAULT 0,
  max_fee_cents     BIGINT,  -- NULL = no cap
  active            BOOLEAN NOT NULL DEFAULT true,
  effective_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_platform_fee_config
  BEFORE UPDATE ON platform_fee_config
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================
-- 18. MARKET ANALYTICS
-- ============================================================

-- Pre-computed market range data (refreshed by analytics pipeline)
CREATE TABLE market_ranges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id UUID NOT NULL REFERENCES service_categories(id),
  zip_code        TEXT NOT NULL,
  city            TEXT,
  state           TEXT,
  -- Price range (in cents)
  low_cents       BIGINT NOT NULL,   -- 25th percentile
  median_cents    BIGINT NOT NULL,   -- 50th percentile
  high_cents      BIGINT NOT NULL,   -- 75th percentile
  data_points     INTEGER NOT NULL,  -- number of transactions
  -- Source
  source          TEXT NOT NULL DEFAULT 'seeded' CHECK (source IN ('seeded', 'platform', 'blended')),
  confidence      NUMERIC(3,2) NOT NULL DEFAULT 0.50,  -- 0-1, increases with data_points
  -- Seasonality
  season          TEXT CHECK (season IN ('spring', 'summer', 'fall', 'winter')),
  -- Validity
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_market_ranges
  BEFORE UPDATE ON market_ranges
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE UNIQUE INDEX idx_market_ranges_lookup ON market_ranges (service_type_id, zip_code, season) WHERE season IS NOT NULL;
CREATE INDEX idx_market_ranges_zip ON market_ranges (zip_code, service_type_id);

-- Transaction data for analytics pipeline (denormalized for fast aggregation)
CREATE TABLE analytics_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID NOT NULL REFERENCES jobs(id),
  contract_id     UUID NOT NULL REFERENCES contracts(id),
  customer_id     UUID NOT NULL REFERENCES users(id),
  provider_id     UUID NOT NULL REFERENCES users(id),
  service_type_id UUID NOT NULL REFERENCES service_categories(id),
  zip_code        TEXT NOT NULL,
  city            TEXT NOT NULL,
  state           TEXT NOT NULL,
  amount_cents    BIGINT NOT NULL,
  bid_count       INTEGER NOT NULL,
  time_to_first_bid_minutes INTEGER,
  time_to_award_minutes INTEGER,
  is_recurring    BOOLEAN NOT NULL DEFAULT false,
  is_instant      BOOLEAN NOT NULL DEFAULT false,
  completed_on_time BOOLEAN,
  review_rating   SMALLINT,
  completed_at    TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_analytics_txn_service ON analytics_transactions (service_type_id, zip_code, completed_at);
CREATE INDEX idx_analytics_txn_zip ON analytics_transactions (zip_code, completed_at);
CREATE INDEX idx_analytics_txn_completed ON analytics_transactions (completed_at DESC);

-- ============================================================
-- 19. REFERRALS
-- ============================================================

CREATE TABLE referrals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id       UUID NOT NULL REFERENCES users(id),
  referred_id       UUID REFERENCES users(id),  -- NULL until signup
  referral_code     TEXT NOT NULL UNIQUE,
  referral_type     TEXT NOT NULL CHECK (referral_type IN ('customer', 'provider', 'cross')),
  -- Status
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'signed_up', 'first_transaction', 'credited', 'expired', 'blocked'
  )),
  -- Credits
  referrer_credit_cents BIGINT NOT NULL DEFAULT 0,
  referred_credit_cents BIGINT NOT NULL DEFAULT 0,
  credited_at       TIMESTAMPTZ,
  -- Fraud prevention
  referrer_device_fingerprint TEXT,
  referred_device_fingerprint TEXT,
  blocked_reason    TEXT,
  -- Expiry
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_referrals
  BEFORE UPDATE ON referrals
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE INDEX idx_referrals_referrer ON referrals (referrer_id, status);
CREATE INDEX idx_referrals_code ON referrals (referral_code);
CREATE INDEX idx_referrals_referred ON referrals (referred_id) WHERE referred_id IS NOT NULL;

-- ============================================================
-- 20. ADMIN & PLATFORM CONFIG
-- ============================================================

CREATE TABLE platform_config (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed initial config
INSERT INTO platform_config (key, value, description) VALUES
  ('verification_required', 'false', 'Require document verification to bid (MVP toggle)'),
  ('analytics_public', 'false', 'Show analytics dashboard to end users'),
  ('registration_open', 'true', 'Allow new user registrations'),
  ('maintenance_mode', 'false', 'Platform-wide maintenance mode'),
  ('instant_enabled', 'false', 'Enable NoMarkup Instant emergency tier'),
  ('free_tier_max_active_jobs', '1', 'Max active jobs for free tier customers'),
  ('free_tier_max_bids_per_month', '5', 'Max bids per month for free tier providers'),
  ('default_auction_hours', '72', 'Default auction duration in hours'),
  ('review_window_days', '14', 'Days after completion to leave a review'),
  ('completion_auto_release_days', '7', 'Days before auto-releasing payment on completion'),
  ('contract_acceptance_hours', '72', 'Hours before contract auto-voids'),
  ('max_revision_requests', '3', 'Max revision requests before only approve/dispute'),
  ('recurring_max_pause_days', '90', 'Max days a recurring job can be paused');

-- Admin audit log
CREATE TABLE admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,  -- 'user_suspended', 'document_approved', 'dispute_resolved', etc.
  target_type TEXT NOT NULL,  -- 'user', 'job', 'review', 'document', 'dispute', 'config'
  target_id   UUID,
  details     JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_admin ON admin_audit_log (admin_id, created_at DESC);
CREATE INDEX idx_audit_log_target ON admin_audit_log (target_type, target_id);
CREATE INDEX idx_audit_log_action ON admin_audit_log (action, created_at DESC);

-- ============================================================
-- 21. EVENT LOG (Event sourcing for analytics pipeline)
-- ============================================================

CREATE TABLE events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL,  -- 'job.created', 'bid.placed', 'contract.awarded', 'payment.completed', etc.
  actor_id    UUID REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}',
  ip_address  INET,
  session_id  UUID REFERENCES user_sessions(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partitioned by month for performance (large table)
-- In production, use declarative partitioning:
-- CREATE TABLE events (...) PARTITION BY RANGE (created_at);

CREATE INDEX idx_events_type ON events (event_type, created_at DESC);
CREATE INDEX idx_events_entity ON events (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_events_actor ON events (actor_id, created_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_events_created ON events (created_at DESC);

-- ============================================================
-- COMMENTS & NOTES
-- ============================================================

-- Schema version tracking is handled by golang-migrate.
