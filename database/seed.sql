-- NoMarkup: Seed Data (SQL equivalent of database/cmd/seed/main.go)
-- All dev accounts use password: Password123!
-- Pre-computed Argon2id hash for Password123! (argon2id v=19, m=65536, t=3, p=4):
-- NOTE: This is a static seed hash. The Go seeder generates a fresh random salt each run.

-- ============================================================
-- Fixed UUIDs for deterministic, idempotent seed data
-- ============================================================

-- Users
-- admin:      00000000-0000-0000-0000-000000000001
-- customer:   00000000-0000-0000-0000-000000000002
-- provider:   00000000-0000-0000-0000-000000000003
-- provider2:  00000000-0000-0000-0000-000000000004

-- Property:            00000000-0000-0000-0000-000000000010
-- Provider profiles:   00000000-0000-0000-0000-000000000020, 00000000-0000-0000-0000-000000000021
-- Jobs:                00000000-0000-0000-0000-000000000100..0102
-- Bids:                00000000-0000-0000-0000-000000000200..0203
-- Contracts:           00000000-0000-0000-0000-000000000300..0301
-- Milestones:          00000000-0000-0000-0000-000000000400..0401
-- Review:              00000000-0000-0000-0000-000000000500
-- Trust score:         00000000-0000-0000-0000-000000000600
-- Subscription tiers:  00000000-0000-0000-0000-000000000700..0702
-- Subscriptions:       00000000-0000-0000-0000-000000000800..0802

BEGIN;

-- ── 1. Users ──────────────────────────────────────────────────
-- Password hash for "Password123!" with a fixed salt (for seed idempotency).
-- Argon2id: m=65536, t=3, p=4, salt=c2VlZF9zYWx0XzEyMzQ1Ng (seed_salt_123456)
DO $$
DECLARE
    pw_hash TEXT := '$argon2id$v=19$m=65536,t=3,p=4$c2VlZF9zYWx0XzEyMzQ1Ng$AuRHOv7Cy3UOLsuC7G9m26cHjTRxRMbzCsddl/0SyeU';
BEGIN
    INSERT INTO users (id, email, email_verified, password_hash, display_name, roles, status, timezone)
    VALUES
        ('00000000-0000-0000-0000-000000000001', 'admin@nomarkup.com',     true, pw_hash, 'Admin User',     '{admin}',    'active', 'America/Los_Angeles'),
        ('00000000-0000-0000-0000-000000000002', 'customer@nomarkup.com',  true, pw_hash, 'Jane Customer',  '{customer}', 'active', 'America/New_York'),
        ('00000000-0000-0000-0000-000000000003', 'provider@nomarkup.com',  true, pw_hash, 'Mike Provider',  '{provider}', 'active', 'America/Chicago'),
        ('00000000-0000-0000-0000-000000000004', 'provider2@nomarkup.com', true, pw_hash, 'Sarah Provider', '{provider}', 'active', 'America/Denver')
    ON CONFLICT (id) DO NOTHING;
END $$;

-- ── 2. Property ───────────────────────────────────────────────

INSERT INTO properties (id, user_id, nickname, address, city, state, zip_code, location, is_primary)
VALUES (
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000002',
    'Home', '123 Main St', 'Austin', 'TX', '78701',
    ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326), true
)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Provider Profiles ─────────────────────────────────────

INSERT INTO provider_profiles (id, user_id, business_name, bio,
    service_address, service_location, service_radius_km,
    default_payment_timing, jobs_completed, profile_completeness)
VALUES (
    '00000000-0000-0000-0000-000000000020',
    '00000000-0000-0000-0000-000000000003',
    'Mike''s Home Services',
    'Licensed and insured home service provider with 10+ years of experience in HVAC, plumbing, and electrical work.',
    '456 Service Rd, Austin, TX 78702',
    ST_SetSRID(ST_MakePoint(-97.7200, 30.2700), 4326),
    80, 'completion', 15, 85
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO provider_profiles (id, user_id, business_name, bio,
    service_address, service_location, service_radius_km,
    default_payment_timing, jobs_completed, profile_completeness)
VALUES (
    '00000000-0000-0000-0000-000000000021',
    '00000000-0000-0000-0000-000000000004',
    'Sarah''s Repairs',
    'Certified HVAC and plumbing technician with 5 years of experience.',
    '789 Trade Ave, Austin, TX 78703',
    ST_SetSRID(ST_MakePoint(-97.7600, 30.2800), 4326),
    50, 'completion', 8, 70
)
ON CONFLICT (id) DO NOTHING;

-- ── 4. Provider Service Categories ───────────────────────────

INSERT INTO provider_service_categories (provider_id, category_id)
SELECT '00000000-0000-0000-0000-000000000020', id
FROM service_categories WHERE slug IN ('hvac', 'plumbing', 'electrical') AND level = 1
ON CONFLICT DO NOTHING;

INSERT INTO provider_service_categories (provider_id, category_id)
SELECT '00000000-0000-0000-0000-000000000021', id
FROM service_categories WHERE slug IN ('hvac', 'plumbing') AND level = 1
ON CONFLICT DO NOTHING;

-- ── 5. Jobs ──────────────────────────────────────────────────

-- Active job (open for bids)
INSERT INTO jobs (id, customer_id, property_id, title, description,
    category_id, subcategory_id, service_type_id,
    service_city, service_state, service_zip,
    service_location, approximate_location,
    schedule_type, starting_bid_cents, auction_duration_hours, auction_ends_at,
    status, bid_count)
VALUES (
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000010',
    'AC Unit Not Cooling Properly',
    'My central AC unit is blowing warm air. It''s a 3-ton unit installed in 2018. The filter was replaced last month. Need a professional to diagnose and repair.',
    (SELECT id FROM service_categories WHERE slug = 'hvac' AND level = 1),
    (SELECT id FROM service_categories WHERE parent_id = (SELECT id FROM service_categories WHERE slug = 'hvac' AND level = 1) AND level = 2 LIMIT 1),
    (SELECT sc3.id FROM service_categories sc3
     JOIN service_categories sc2 ON sc3.parent_id = sc2.id
     WHERE sc2.parent_id = (SELECT id FROM service_categories WHERE slug = 'hvac' AND level = 1)
       AND sc3.level = 3 LIMIT 1),
    'Austin', 'TX', '78701',
    ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
    ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
    'flexible', 50000, 72, now() + interval '72 hours',
    'active', 2
)
ON CONFLICT (id) DO UPDATE SET
    status = 'active',
    auction_ends_at = now() + interval '72 hours',
    bid_count = 2,
    awarded_provider_id = NULL,
    awarded_bid_id = NULL,
    awarded_at = NULL,
    updated_at = now();

-- Awarded job (in progress)
INSERT INTO jobs (id, customer_id, property_id, title, description,
    category_id,
    service_city, service_state, service_zip,
    service_location, approximate_location,
    schedule_type, starting_bid_cents, auction_duration_hours,
    status, bid_count, awarded_provider_id, awarded_at)
VALUES (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000010',
    'Kitchen Sink Leaking',
    'The kitchen sink has a slow leak under the cabinet. Water pools on the floor overnight. Need repair ASAP.',
    (SELECT id FROM service_categories WHERE slug = 'plumbing' AND level = 1),
    'Austin', 'TX', '78701',
    ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
    ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
    'specific_date', 30000, 72,
    'in_progress', 1,
    '00000000-0000-0000-0000-000000000003',
    now() - interval '3 days'
)
ON CONFLICT (id) DO UPDATE SET
    status = 'in_progress',
    bid_count = 1,
    awarded_provider_id = '00000000-0000-0000-0000-000000000003',
    awarded_at = now() - interval '3 days',
    updated_at = now();

-- Completed job
INSERT INTO jobs (id, customer_id, property_id, title, description,
    category_id,
    service_city, service_state, service_zip,
    service_location, approximate_location,
    schedule_type, starting_bid_cents, auction_duration_hours,
    status, bid_count, awarded_provider_id, completed_at)
VALUES (
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000010',
    'Install Ceiling Fan in Living Room',
    'Need a ceiling fan installed in the living room. Wiring already exists from an old light fixture. Fan is purchased and ready.',
    (SELECT id FROM service_categories WHERE slug = 'electrical' AND level = 1),
    'Austin', 'TX', '78701',
    ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
    ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
    'flexible', 25000, 72,
    'completed', 1,
    '00000000-0000-0000-0000-000000000003',
    now() - interval '7 days'
)
ON CONFLICT (id) DO UPDATE SET
    status = 'completed',
    bid_count = 1,
    awarded_provider_id = '00000000-0000-0000-0000-000000000003',
    completed_at = now() - interval '7 days',
    updated_at = now();

-- ── 6. Bids ──────────────────────────────────────────────────

-- Bids on the active job
INSERT INTO bids (id, job_id, provider_id, amount_cents, original_amount_cents, status)
VALUES ('00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000003', 35000, 40000, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bids (id, job_id, provider_id, amount_cents, original_amount_cents, status)
VALUES ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000004', 42000, 45000, 'active')
ON CONFLICT (id) DO NOTHING;

-- Awarded bid on the awarded job
INSERT INTO bids (id, job_id, provider_id, amount_cents, original_amount_cents, status, awarded_at)
VALUES ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000003', 22000, 25000, 'awarded', now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;

-- Awarded bid on the completed job
INSERT INTO bids (id, job_id, provider_id, amount_cents, original_amount_cents, status, awarded_at)
VALUES ('00000000-0000-0000-0000-000000000203', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000003', 18000, 20000, 'awarded', now() - interval '10 days')
ON CONFLICT (id) DO NOTHING;

-- Back-fill awarded_bid_id on the awarded job
UPDATE jobs SET awarded_bid_id = '00000000-0000-0000-0000-000000000202'
WHERE id = '00000000-0000-0000-0000-000000000101' AND awarded_bid_id IS NULL;

-- ── 7. Contracts ─────────────────────────────────────────────

-- Active contract (from awarded job)
INSERT INTO contracts (id, contract_number, job_id, customer_id, provider_id, bid_id,
    amount_cents, payment_timing, status, customer_accepted, provider_accepted,
    accepted_at, started_at)
VALUES (
    '00000000-0000-0000-0000-000000000300', 'NM-2026-00001',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000202',
    22000, 'milestone', 'active', true, true,
    now() - interval '3 days', now() - interval '3 days'
)
ON CONFLICT (id) DO NOTHING;

-- Completed contract (from completed job)
INSERT INTO contracts (id, contract_number, job_id, customer_id, provider_id, bid_id,
    amount_cents, payment_timing, status, customer_accepted, provider_accepted,
    accepted_at, started_at, completed_at)
VALUES (
    '00000000-0000-0000-0000-000000000301', 'NM-2026-00002',
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000203',
    18000, 'completion', 'completed', true, true,
    now() - interval '10 days', now() - interval '10 days', now() - interval '7 days'
)
ON CONFLICT (id) DO NOTHING;

-- ── 8. Milestones ────────────────────────────────────────────

INSERT INTO milestones (id, contract_id, description, amount_cents, sort_order, status)
VALUES
    ('00000000-0000-0000-0000-000000000400', '00000000-0000-0000-0000-000000000300', 'Diagnose leak source and provide repair estimate', 7000, 1, 'approved'),
    ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000300', 'Complete repair and test for leaks', 15000, 2, 'in_progress')
ON CONFLICT (id) DO NOTHING;

-- ── 9. Review ────────────────────────────────────────────────

INSERT INTO reviews (id, contract_id, job_id, reviewer_id, reviewee_id, reviewer_role,
    overall_rating, quality_rating, timeliness_rating, communication_rating, value_rating,
    review_text, status, published_at, review_window_ends)
VALUES (
    '00000000-0000-0000-0000-000000000500',
    '00000000-0000-0000-0000-000000000301',
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    'customer',
    5, 5, 4, 5, 5,
    'Mike did an excellent job installing the ceiling fan. He was professional, arrived on time, and cleaned up after the work. The fan works perfectly. Highly recommend!',
    'published',
    now() - interval '6 days',
    now() + interval '14 days'
)
ON CONFLICT (id) DO NOTHING;

-- ── 10. Trust Score ──────────────────────────────────────────

INSERT INTO trust_scores (id, user_id, role, overall_score, tier,
    feedback_score, volume_score, risk_score, fraud_score)
VALUES (
    '00000000-0000-0000-0000-000000000600',
    '00000000-0000-0000-0000-000000000003',
    'provider', 78.50, 'trusted',
    85.00, 60.00, 80.00, 95.00
)
ON CONFLICT (id) DO NOTHING;

-- ── 11. Subscription Tiers ──────────────────────────────────

INSERT INTO subscription_tiers (id, name, role, price_cents, max_active_jobs, max_bids_per_month, features_json, active)
VALUES
    ('00000000-0000-0000-0000-000000000700', 'free',          'customer', 0,    1,    NULL, '{"analytics": false, "priority_placement": false}', true),
    ('00000000-0000-0000-0000-000000000701', 'pro_customer',  'customer', 1999, NULL, NULL, '{"analytics": true, "priority_placement": true, "unlimited_jobs": true}', true),
    ('00000000-0000-0000-0000-000000000702', 'pro_provider',  'provider', 2999, NULL, NULL, '{"analytics": true, "priority_placement": true, "unlimited_bids": true, "badge": true}', true)
ON CONFLICT (id) DO NOTHING;

-- ── 12. Subscriptions ────────────────────────────────────────

INSERT INTO subscriptions (id, user_id, tier_id, status, current_period_start, current_period_end)
VALUES
    ('00000000-0000-0000-0000-000000000800', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000700', 'active', now(), now() + interval '30 days'),
    ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000700', 'active', now(), now() + interval '30 days'),
    ('00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000702', 'active', now(), now() + interval '30 days')
ON CONFLICT (id) DO NOTHING;

-- ── 13. Notification Preferences ─────────────────────────────

INSERT INTO notification_preferences (user_id, preferences, email_digest)
VALUES
    ('00000000-0000-0000-0000-000000000001', '{"new_bid": {"in_app": true, "email": true, "push": true}, "contract_update": {"in_app": true, "email": true, "push": false}}', 'daily'),
    ('00000000-0000-0000-0000-000000000002', '{"new_bid": {"in_app": true, "email": true, "push": true}, "contract_update": {"in_app": true, "email": true, "push": true}, "payment": {"in_app": true, "email": true, "push": true}}', 'immediate'),
    ('00000000-0000-0000-0000-000000000003', '{"bid_awarded": {"in_app": true, "email": true, "push": true}, "new_job": {"in_app": true, "email": false, "push": true}}', 'daily')
ON CONFLICT (user_id) DO NOTHING;

-- ── 14. Market Range ─────────────────────────────────────────

INSERT INTO market_ranges (service_type_id, zip_code, city, state,
    low_cents, median_cents, high_cents, data_points,
    source, confidence, valid_until)
VALUES (
    (SELECT sc3.id FROM service_categories sc3
     JOIN service_categories sc2 ON sc3.parent_id = sc2.id
     WHERE sc2.parent_id = (SELECT id FROM service_categories WHERE slug = 'hvac' AND level = 1)
       AND sc3.level = 3 LIMIT 1),
    '78701', 'Austin', 'TX',
    15000, 30000, 50000, 42,
    'seeded', 0.65, now() + interval '90 days'
)
ON CONFLICT DO NOTHING;

COMMIT;

-- Dev Accounts (all passwords: Password123!)
-- Admin:     admin@nomarkup.com      roles: [admin]
-- Customer:  customer@nomarkup.com   roles: [customer]
-- Provider:  provider@nomarkup.com   roles: [provider]
-- Provider2: provider2@nomarkup.com  roles: [provider]
