# NoMarkup Test Fixtures & Seed Scenarios

> Deterministic test data for PostgreSQL 16 + PostGIS 3.4.
> All IDs follow `00000000-0000-0000-0000-00000000XXXX` pattern.
> Money stored as BIGINT cents. Timestamps as TIMESTAMPTZ (UTC).
> Run after migrations `001_initial_schema.up.sql` and `002_seed_taxonomy.up.sql`.

---

## Table of Contents

1. [User Fixtures](#1-user-fixtures)
2. [Property Fixtures](#2-property-fixtures)
3. [Service Category References](#3-service-category-references)
4. [Job Fixtures](#4-job-fixtures)
5. [Bid Fixtures](#5-bid-fixtures)
6. [Contract Fixtures](#6-contract-fixtures)
7. [Milestone Fixtures](#7-milestone-fixtures)
8. [Payment Fixtures](#8-payment-fixtures)
9. [Review Fixtures](#9-review-fixtures)
10. [Trust Score Fixtures](#10-trust-score-fixtures)
11. [Chat Channel & Message Fixtures](#11-chat-channel--message-fixtures)
12. [Notification Fixtures](#12-notification-fixtures)
13. [Fraud Signal Fixtures](#13-fraud-signal-fixtures)
14. [Dispute Fixtures](#14-dispute-fixtures)
15. [Subscription Fixtures](#15-subscription-fixtures)
16. [Named Scenario Scripts](#16-named-scenario-scripts)
17. [Appendix: Helper Constants for Test Code](#17-appendix-helper-constants-for-test-code)

---

## Conventions

- **Password hash**: All test users use `password123` hashed with argon2id.
  The canonical hash below was generated with memory=65536, iterations=3, parallelism=4.
  **NEVER use this in production.**
- **UUIDs**: Deterministic, zero-padded. Users `...001`-`...012`, provider profiles `...021`-`...026`,
  properties `...031`-`...035`, jobs `...101`-`...118`, bids `...201`-`...225`,
  contracts `...301`-`...310`, milestones `...311`-`...320`, payments `...401`-`...415`,
  reviews `...501`-`...510`, trust scores `...601`-`...612`,
  chat channels `...701`-`...706`, notifications `...801`-`...815`,
  fraud signals `...901`-`...906`, disputes `...951`-`...953`,
  subscription tiers `...971`-`...974`, subscriptions `...961`-`...970`.
- **PostGIS**: All coordinates use SRID 4326 (WGS 84). Locations are in the Seattle, WA metro area
  (real neighborhoods, fictional street addresses).
- **Timestamps**: Use `now()` and interval arithmetic for relative dates so fixtures
  remain valid regardless of when they are loaded.
- **Category IDs**: Referenced by slug via subselects since taxonomy IDs are generated
  at seed time by `002_seed_taxonomy.up.sql`.
- **Monetary values**: All in cents (integer). `$150.00` = `15000`.
- **Phone numbers**: Use 555-xxxx format per fixture spec (`+1206555XXXX`).
- **Emails**: Use `@example.com` domain (RFC 2606 reserved).

```sql
-- ============================================================
-- KNOWN TEST PASSWORD HASH
-- ============================================================
-- Password: password123
-- Algorithm: argon2id (memory=65536, iterations=3, parallelism=4)
-- This is a VALID argon2id hash for test environments only.
-- NEVER use this in production.

DO $$ BEGIN
  PERFORM set_config('test.password_hash',
    '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw', false);
END $$;
```

---

## 1. User Fixtures

### Persona Summary

| ID | Persona | Email | Role(s) | Status | Trust Score | Notes |
|----|---------|-------|---------|--------|-------------|-------|
| `...001` | `alice_customer` | alice@example.com | customer | active | 85 | Active customer, 5 completed jobs, verified |
| `...002` | `bob_provider` | bob@example.com | provider | active | 92 | Elite plumber, 50+ completed jobs, Stripe connected |
| `...003` | `carol_provider` | carol@example.com | provider | active | 75 | New electrician, 3 completed jobs |
| `...004` | `dave_customer` | dave@example.com | customer | active | 60 | Has disputed a job |
| `...005` | `eve_provider` | eve@example.com | provider | suspended | 30 | Suspended for fraud |
| `...006` | `frank_customer` | frank@example.com | customer | active | -- | Just registered, email not verified |
| `...007` | `grace_admin` | grace@example.com | admin | active | -- | Platform administrator |
| `...008` | `henry_provider` | henry@example.com | provider | active | 88 | Painter, subscription active |
| `...009` | `irene_customer` | irene@example.com | customer | active | 70 | Active jobs in multiple categories |
| `...010` | `jake_provider` | jake@example.com | provider | active | -- | Completed registration, identity pending |
| `...011` | `support_agent` | support@example.com | support | active | -- | Dispute resolution agent |
| `...012` | `kate_provider` | kate@example.com | provider | active | 80 | HVAC specialist, dual-role (also customer) |

```sql
-- Fixture: users
INSERT INTO users (id, email, email_verified, password_hash, phone, phone_verified,
                   display_name, avatar_url, roles, status, suspension_reason,
                   mfa_enabled, mfa_secret, last_login_at, last_active_at, timezone)
VALUES
  -- alice_customer: verified customer with 5 completed jobs
  ('00000000-0000-0000-0000-000000000001',
   'alice@example.com', true,
   '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw',
   '+12065550001', true,
   'Alice Johnson', 'https://cdn.test.com/avatars/alice.jpg',
   '{customer}', 'active', NULL,
   false, NULL,
   now() - interval '1 hour', now() - interval '5 minutes',
   'America/Los_Angeles'),

  -- bob_provider: elite plumber, 50+ completed jobs, Stripe connected, top_rated
  ('00000000-0000-0000-0000-000000000002',
   'bob@example.com', true,
   '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw',
   '+12065550002', true,
   'Bob''s Plumbing', 'https://cdn.test.com/avatars/bob.jpg',
   '{provider}', 'active', NULL,
   true, 'encrypted-totp-secret-bob',
   now() - interval '2 hours', now() - interval '30 minutes',
   'America/Los_Angeles'),

  -- carol_provider: electrician, 3 completed jobs, verified
  ('00000000-0000-0000-0000-000000000003',
   'carol@example.com', true,
   '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw',
   '+12065550003', true,
   'Carol''s Electric', 'https://cdn.test.com/avatars/carol.jpg',
   '{provider}', 'active', NULL,
   false, NULL,
   now() - interval '6 hours', now() - interval '1 hour',
   'America/Los_Angeles'),

  -- dave_customer: verified customer who has disputed a job
  ('00000000-0000-0000-0000-000000000004',
   'dave@example.com', true,
   '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw',
   '+12065550004', true,
   'Dave Martinez', 'https://cdn.test.com/avatars/dave.jpg',
   '{customer}', 'active', NULL,
   false, NULL,
   now() - interval '3 hours', now() - interval '45 minutes',
   'America/Los_Angeles'),

  -- eve_provider: suspended provider (fraud)
  ('00000000-0000-0000-0000-000000000005',
   'eve@example.com', true,
   '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw',
   '+12065550005', true,
   'Eve''s Home Services', 'https://cdn.test.com/avatars/eve.jpg',
   '{provider}', 'suspended', 'Multiple fraud signals detected: bid manipulation, fake reviews, and multiple accounts from same IP',
   false, NULL,
   now() - interval '14 days', now() - interval '14 days',
   'America/Los_Angeles'),

  -- frank_customer: just registered, email NOT verified
  ('00000000-0000-0000-0000-000000000006',
   'frank@example.com', false,
   '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw',
   '+12065550006', false,
   'Frank Thompson', NULL,
   '{customer}', 'active', NULL,
   false, NULL,
   now() - interval '20 minutes', now() - interval '20 minutes',
   'America/Los_Angeles'),

  -- grace_admin: platform administrator
  ('00000000-0000-0000-0000-000000000007',
   'grace@example.com', true,
   '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw',
   '+12065550007', true,
   'Grace Chen', NULL,
   '{admin}', 'active', NULL,
   true, 'encrypted-totp-secret-grace',
   now() - interval '30 minutes', now() - interval '10 minutes',
   'America/Los_Angeles'),

  -- henry_provider: painter, subscription active (Professional tier)
  ('00000000-0000-0000-0000-000000000008',
   'henry@example.com', true,
   '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw',
   '+12065550008', true,
   'Henry''s Painting', 'https://cdn.test.com/avatars/henry.jpg',
   '{provider}', 'active', NULL,
   false, NULL,
   now() - interval '4 hours', now() - interval '1 hour',
   'America/Los_Angeles'),

  -- irene_customer: active jobs in multiple categories
  ('00000000-0000-0000-0000-000000000009',
   'irene@example.com', true,
   '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw',
   '+12065550009', true,
   'Irene Park', 'https://cdn.test.com/avatars/irene.jpg',
   '{customer}', 'active', NULL,
   false, NULL,
   now() - interval '1 hour', now() - interval '15 minutes',
   'America/Los_Angeles'),

  -- jake_provider: completed registration, identity verification pending
  ('00000000-0000-0000-0000-000000000010',
   'jake@example.com', true,
   '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw',
   '+12065550010', true,
   'Jake''s Roofing', NULL,
   '{provider}', 'active', NULL,
   false, NULL,
   now() - interval '3 days', now() - interval '1 day',
   'America/Los_Angeles'),

  -- support_agent: dispute resolution
  ('00000000-0000-0000-0000-000000000011',
   'support@example.com', true,
   '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw',
   '+12065550011', true,
   'Support Agent', NULL,
   '{support}', 'active', NULL,
   false, NULL,
   now() - interval '1 hour', now() - interval '15 minutes',
   'America/Los_Angeles'),

  -- kate_provider: HVAC specialist, dual-role (also customer)
  ('00000000-0000-0000-0000-000000000012',
   'kate@example.com', true,
   '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw',
   '+12065550012', true,
   'Kate''s HVAC Solutions', 'https://cdn.test.com/avatars/kate.jpg',
   '{customer,provider}', 'active', NULL,
   false, NULL,
   now() - interval '5 hours', now() - interval '2 hours',
   'America/Los_Angeles');
```

### Provider Profiles

| ID | User | Business Name | Stripe | Jobs Completed | On-time Rate | Service Radius |
|----|------|---------------|--------|---------------|-------------|----------------|
| `...021` | bob | Bob's Plumbing LLC | connected | 52 | 96% | 40km |
| `...022` | carol | Carol's Electric | connected | 3 | 90% | 25km |
| `...023` | eve | Eve's Home Services | connected | 8 | 55% | 30km |
| `...024` | henry | Henry's Painting Co. | connected | 28 | 94% | 35km |
| `...025` | jake | Jake's Roofing | NOT connected | 0 | -- | 50km |
| `...026` | kate | Kate's HVAC Solutions | connected | 15 | 93% | 30km |

```sql
-- Fixture: provider_profiles
INSERT INTO provider_profiles (id, user_id, business_name, bio, service_address,
                               service_location, service_radius_km,
                               default_payment_timing, default_milestone_json,
                               cancellation_policy, warranty_terms,
                               instant_enabled, instant_available,
                               jobs_completed, avg_response_time_minutes,
                               on_time_rate, profile_completeness,
                               stripe_account_id, stripe_onboarding_complete)
VALUES
  -- Bob's Plumbing: fully set up, top rated, instant-enabled
  ('00000000-0000-0000-0000-000000000021',
   '00000000-0000-0000-0000-000000000002',
   'Bob''s Plumbing LLC', 'Licensed master plumber with 15 years of experience in the Seattle metro area. Specializing in residential plumbing, fixture installation, water heater replacement, and emergency drain clearing. Bonded and insured.',
   '456 Plumber Way, Seattle, WA 98103',
   ST_SetSRID(ST_MakePoint(-122.3421, 47.6562), 4326),
   40.00,
   'milestone',
   '[{"description": "Materials & initial work", "percentage": 50}, {"description": "Completion & cleanup", "percentage": 50}]',
   'Free cancellation up to 24 hours before scheduled date. 50% charge within 24 hours.',
   '1-year warranty on all plumbing work. Parts warranty per manufacturer.',
   true, true,
   52, 28, 0.9600, 95,
   'acct_test_bob_stripe', true),

  -- Carol's Electric: newer provider, verified
  ('00000000-0000-0000-0000-000000000022',
   '00000000-0000-0000-0000-000000000003',
   'Carol''s Electric', 'Licensed electrician specializing in residential wiring, panel upgrades, and lighting installations. Serving the Eastside since 2024.',
   '789 Spark Ave, Kirkland, WA 98033',
   ST_SetSRID(ST_MakePoint(-122.2087, 47.6815), 4326),
   25.00,
   'completion',
   NULL,
   'Free cancellation 48 hours before. No refunds day-of.',
   '90-day warranty on labor.',
   false, false,
   3, 65, 0.9000, 72,
   'acct_test_carol_stripe', true),

  -- Eve's Home Services: suspended provider (profile still exists)
  ('00000000-0000-0000-0000-000000000023',
   '00000000-0000-0000-0000-000000000005',
   'Eve''s Home Services', 'General contractor and home repair services.',
   '321 Shady Ln, Bellevue, WA 98004',
   ST_SetSRID(ST_MakePoint(-122.2015, 47.6101), 4326),
   30.00,
   'upfront',
   NULL,
   NULL, NULL,
   false, false,
   8, 180, 0.5500, 40,
   'acct_test_eve_stripe', true),

  -- Henry's Painting: active pro subscriber
  ('00000000-0000-0000-0000-000000000024',
   '00000000-0000-0000-0000-000000000008',
   'Henry''s Painting Co.', 'Professional interior and exterior painting, deck staining, and cabinet refinishing. 10 years of experience, meticulous attention to detail. Lead-safe certified.',
   '222 Brush St, Redmond, WA 98052',
   ST_SetSRID(ST_MakePoint(-122.1215, 47.6740), 4326),
   35.00,
   'milestone',
   '[{"description": "Prep work & primer", "percentage": 30}, {"description": "Paint application", "percentage": 50}, {"description": "Touch-ups & cleanup", "percentage": 20}]',
   'Free cancellation 48 hours before. 25% charge within 48 hours.',
   '2-year warranty on interior paint. 1-year on exterior.',
   false, false,
   28, 35, 0.9400, 90,
   'acct_test_henry_stripe', true),

  -- Jake's Roofing: unverified, no Stripe (pending verification)
  ('00000000-0000-0000-0000-000000000025',
   '00000000-0000-0000-0000-000000000010',
   'Jake''s Roofing', 'Roofing contractor.',
   '999 Roof Rd, Tacoma, WA 98402',
   ST_SetSRID(ST_MakePoint(-122.4443, 47.2529), 4326),
   50.00,
   'milestone',
   NULL,
   NULL, NULL,
   false, false,
   0, NULL, NULL, 20,
   NULL, false),

  -- Kate's HVAC: dual-role provider, solid track record
  ('00000000-0000-0000-0000-000000000026',
   '00000000-0000-0000-0000-000000000012',
   'Kate''s HVAC Solutions', 'EPA-certified HVAC technician specializing in heat pump installation, AC repair, and ductwork. Serving Seattle and the Eastside.',
   '600 Cool Breeze Way, Renton, WA 98057',
   ST_SetSRID(ST_MakePoint(-122.2171, 47.4799), 4326),
   30.00,
   'milestone',
   '[{"description": "Equipment & materials", "percentage": 60}, {"description": "Installation & testing", "percentage": 40}]',
   'Free cancellation 48 hours before scheduled date.',
   '1-year labor warranty. Equipment warranty per manufacturer.',
   true, false,
   15, 42, 0.9300, 85,
   'acct_test_kate_stripe', true);
```

### Provider Service Categories

```sql
-- Fixture: provider_service_categories
INSERT INTO provider_service_categories (provider_id, category_id) VALUES
  -- Bob: Plumbing (all subcategories)
  ('00000000-0000-0000-0000-000000000021', (SELECT id FROM service_categories WHERE slug = 'plumbing')),
  ('00000000-0000-0000-0000-000000000021', (SELECT id FROM service_categories WHERE slug = 'plumbing-fixtures')),
  ('00000000-0000-0000-0000-000000000021', (SELECT id FROM service_categories WHERE slug = 'plumbing-faucet-install')),
  ('00000000-0000-0000-0000-000000000021', (SELECT id FROM service_categories WHERE slug = 'plumbing-toilet-install')),
  ('00000000-0000-0000-0000-000000000021', (SELECT id FROM service_categories WHERE slug = 'plumbing-pipes')),
  ('00000000-0000-0000-0000-000000000021', (SELECT id FROM service_categories WHERE slug = 'plumbing-leak-repair')),
  ('00000000-0000-0000-0000-000000000021', (SELECT id FROM service_categories WHERE slug = 'plumbing-drains')),
  ('00000000-0000-0000-0000-000000000021', (SELECT id FROM service_categories WHERE slug = 'plumbing-drain-clearing')),
  ('00000000-0000-0000-0000-000000000021', (SELECT id FROM service_categories WHERE slug = 'plumbing-water-heaters')),
  -- Carol: Electrical
  ('00000000-0000-0000-0000-000000000022', (SELECT id FROM service_categories WHERE slug = 'electrical')),
  ('00000000-0000-0000-0000-000000000022', (SELECT id FROM service_categories WHERE slug = 'electrical-panels')),
  ('00000000-0000-0000-0000-000000000022', (SELECT id FROM service_categories WHERE slug = 'electrical-panel-upgrade')),
  ('00000000-0000-0000-0000-000000000022', (SELECT id FROM service_categories WHERE slug = 'electrical-lighting')),
  ('00000000-0000-0000-0000-000000000022', (SELECT id FROM service_categories WHERE slug = 'electrical-light-install')),
  ('00000000-0000-0000-0000-000000000022', (SELECT id FROM service_categories WHERE slug = 'electrical-outlets')),
  -- Eve: General Handyman + Roofing (broad, shallow)
  ('00000000-0000-0000-0000-000000000023', (SELECT id FROM service_categories WHERE slug = 'handyman')),
  ('00000000-0000-0000-0000-000000000023', (SELECT id FROM service_categories WHERE slug = 'handyman-repairs')),
  ('00000000-0000-0000-0000-000000000023', (SELECT id FROM service_categories WHERE slug = 'roofing')),
  ('00000000-0000-0000-0000-000000000023', (SELECT id FROM service_categories WHERE slug = 'roofing-repair')),
  -- Henry: Painting (all subcategories)
  ('00000000-0000-0000-0000-000000000024', (SELECT id FROM service_categories WHERE slug = 'painting')),
  ('00000000-0000-0000-0000-000000000024', (SELECT id FROM service_categories WHERE slug = 'painting-interior')),
  ('00000000-0000-0000-0000-000000000024', (SELECT id FROM service_categories WHERE slug = 'painting-exterior')),
  ('00000000-0000-0000-0000-000000000024', (SELECT id FROM service_categories WHERE slug = 'painting-staining')),
  -- Jake: Roofing
  ('00000000-0000-0000-0000-000000000025', (SELECT id FROM service_categories WHERE slug = 'roofing')),
  ('00000000-0000-0000-0000-000000000025', (SELECT id FROM service_categories WHERE slug = 'roofing-repair')),
  ('00000000-0000-0000-0000-000000000025', (SELECT id FROM service_categories WHERE slug = 'roofing-replacement')),
  ('00000000-0000-0000-0000-000000000025', (SELECT id FROM service_categories WHERE slug = 'roofing-full-replace')),
  -- Kate: HVAC (all subcategories)
  ('00000000-0000-0000-0000-000000000026', (SELECT id FROM service_categories WHERE slug = 'hvac')),
  ('00000000-0000-0000-0000-000000000026', (SELECT id FROM service_categories WHERE slug = 'hvac-cooling')),
  ('00000000-0000-0000-0000-000000000026', (SELECT id FROM service_categories WHERE slug = 'hvac-ac-install')),
  ('00000000-0000-0000-0000-000000000026', (SELECT id FROM service_categories WHERE slug = 'hvac-ac-repair')),
  ('00000000-0000-0000-0000-000000000026', (SELECT id FROM service_categories WHERE slug = 'hvac-heating')),
  ('00000000-0000-0000-0000-000000000026', (SELECT id FROM service_categories WHERE slug = 'hvac-furnace-install'));
```

### Verification Documents

```sql
-- Fixture: verification_documents
INSERT INTO verification_documents (id, user_id, document_type, file_url, file_name,
                                     file_size_bytes, mime_type, status,
                                     rejection_reason, resubmission_count,
                                     expires_at, reviewed_by, reviewed_at)
VALUES
  -- Bob: all docs verified
  ('00000000-0000-0000-0000-000000000041',
   '00000000-0000-0000-0000-000000000002',
   'government_id', 's3://nomarkup-dev/verification/bob-gov-id.jpg', 'drivers-license.jpg',
   245000, 'image/jpeg', 'verified',
   NULL, 0,
   NULL, '00000000-0000-0000-0000-000000000007', now() - interval '90 days'),

  ('00000000-0000-0000-0000-000000000042',
   '00000000-0000-0000-0000-000000000002',
   'business_license', 's3://nomarkup-dev/verification/bob-biz-license.pdf', 'plumbing-license.pdf',
   512000, 'application/pdf', 'verified',
   NULL, 0,
   now() + interval '365 days', '00000000-0000-0000-0000-000000000007', now() - interval '85 days'),

  ('00000000-0000-0000-0000-000000000043',
   '00000000-0000-0000-0000-000000000002',
   'insurance', 's3://nomarkup-dev/verification/bob-insurance.pdf', 'liability-insurance.pdf',
   380000, 'application/pdf', 'verified',
   NULL, 0,
   now() + interval '180 days', '00000000-0000-0000-0000-000000000007', now() - interval '60 days'),

  -- Carol: gov ID verified, business license pending
  ('00000000-0000-0000-0000-000000000044',
   '00000000-0000-0000-0000-000000000003',
   'government_id', 's3://nomarkup-dev/verification/carol-gov-id.jpg', 'state-id.jpg',
   198000, 'image/jpeg', 'verified',
   NULL, 0,
   NULL, '00000000-0000-0000-0000-000000000007', now() - interval '30 days'),

  -- Jake: gov ID pending (identity verification pending)
  ('00000000-0000-0000-0000-000000000045',
   '00000000-0000-0000-0000-000000000010',
   'government_id', 's3://nomarkup-dev/verification/jake-gov-id.jpg', 'passport.jpg',
   310000, 'image/jpeg', 'pending',
   NULL, 0,
   NULL, NULL, NULL),

  -- Eve: gov ID verified before suspension
  ('00000000-0000-0000-0000-000000000046',
   '00000000-0000-0000-0000-000000000005',
   'government_id', 's3://nomarkup-dev/verification/eve-gov-id.jpg', 'drivers-license.jpg',
   220000, 'image/jpeg', 'verified',
   NULL, 0,
   NULL, '00000000-0000-0000-0000-000000000007', now() - interval '120 days');
```

---

## 2. Property Fixtures

| ID | Owner | Nickname | City | Zip | Coordinates | Primary |
|----|-------|----------|------|-----|-------------|---------|
| `...031` | Alice | Home | Seattle, WA | 98122 | -122.3321, 47.6062 | yes |
| `...032` | Alice | Rental Property | Bellevue, WA | 98004 | -122.2015, 47.6101 | no |
| `...033` | Dave | Home | Redmond, WA | 98052 | -122.1215, 47.6740 | yes |
| `...034` | Irene | Home | Kirkland, WA | 98033 | -122.2087, 47.6815 | yes |
| `...035` | Irene | Lake House | Issaquah, WA | 98027 | -122.0355, 47.5301 | no |

```sql
-- Fixture: properties
INSERT INTO properties (id, user_id, nickname, address, city, state, zip_code,
                        location, notes, is_primary)
VALUES
  -- Alice's primary home (Capitol Hill, Seattle)
  ('00000000-0000-0000-0000-000000000031',
   '00000000-0000-0000-0000-000000000001',
   'Home', '123 Pine St', 'Seattle', 'WA', '98122',
   ST_SetSRID(ST_MakePoint(-122.3321, 47.6062), 4326),
   'Gate code: 4521. Ring doorbell.',
   true),

  -- Alice's rental property (Downtown Bellevue)
  ('00000000-0000-0000-0000-000000000032',
   '00000000-0000-0000-0000-000000000001',
   'Rental Property', '456 Bellevue Way NE', 'Bellevue', 'WA', '98004',
   ST_SetSRID(ST_MakePoint(-122.2015, 47.6101), 4326),
   'Tenant: call ahead. Key in lockbox 7733.',
   false),

  -- Dave's home (Redmond)
  ('00000000-0000-0000-0000-000000000033',
   '00000000-0000-0000-0000-000000000004',
   'Home', '789 Overlake Dr', 'Redmond', 'WA', '98052',
   ST_SetSRID(ST_MakePoint(-122.1215, 47.6740), 4326),
   'Driveway on the left side. Dog in backyard (friendly).',
   true),

  -- Irene's primary home (Kirkland)
  ('00000000-0000-0000-0000-000000000034',
   '00000000-0000-0000-0000-000000000009',
   'Home', '321 Market St', 'Kirkland', 'WA', '98033',
   ST_SetSRID(ST_MakePoint(-122.2087, 47.6815), 4326),
   'Side gate is usually unlocked. Ring bell twice.',
   true),

  -- Irene's lake house (Issaquah)
  ('00000000-0000-0000-0000-000000000035',
   '00000000-0000-0000-0000-000000000009',
   'Lake House', '555 Lakeview Rd', 'Issaquah', 'WA', '98027',
   ST_SetSRID(ST_MakePoint(-122.0355, 47.5301), 4326),
   'Gravel driveway. Lockbox code: 9182. No cell coverage inside house.',
   false);
```

---

## 3. Service Category References

The seed taxonomy is loaded by `002_seed_taxonomy.up.sql`. Fixtures reference categories
by slug using subselects. The 16 top-level categories and key subcategories used:

| # | Category | Slug | Level | Subcategories Used in Fixtures |
|---|----------|------|-------|-------------------------------|
| 1 | HVAC | `hvac` | 1 | `hvac-cooling`, `hvac-heating`, `hvac-ac-install`, `hvac-furnace-install` |
| 2 | Plumbing | `plumbing` | 1 | `plumbing-fixtures`, `plumbing-faucet-install`, `plumbing-drains`, `plumbing-drain-clearing` |
| 3 | Electrical | `electrical` | 1 | `electrical-panels`, `electrical-panel-upgrade`, `electrical-lighting`, `electrical-light-install` |
| 4 | Roofing | `roofing` | 1 | `roofing-repair`, `roofing-leak-repair`, `roofing-replacement`, `roofing-full-replace` |
| 5 | Painting | `painting` | 1 | `painting-interior`, `painting-exterior`, `painting-staining` |
| 6 | Landscaping | `landscaping` | 1 | `landscaping-lawn`, `landscaping-tree` |
| 7 | Cleaning | `cleaning` | 1 | `cleaning-residential`, `cleaning-deep` |
| 8 | Flooring | `flooring` | 1 | `flooring-hardwood`, `flooring-tile` |
| 9 | Pest Control | `pest-control` | 1 | `pest-insects` |
| 10 | Appliance Repair | `appliance-repair` | 1 | `appliance-kitchen` |
| 11 | Fencing | `fencing` | 1 | `fencing-wood` |
| 12 | Concrete & Masonry | `concrete-masonry` | 1 | `concrete-driveways` |
| 13 | Windows & Doors | `windows-doors` | 1 | `wd-window-install` |
| 14 | Garage | `garage` | 1 | `garage-doors` |
| 15 | General Handyman | `handyman` | 1 | `handyman-repairs`, `handyman-assembly` |
| 16 | Security | `security` | 1 | `security-cameras` |

No INSERT statements needed; these are loaded by the taxonomy seed migration.

---

## 4. Job Fixtures

Every job status is covered: `draft`, `active`, `closed`, `closed_zero_bids`, `awarded`, `contract_pending`, `in_progress`, `completed`, `reviewed`, `cancelled`, `reposted`, `expired`, `suspended`.

| ID | Alias | Customer | Property | Category Slug | Status | Starting Bid | Bids | Notes |
|----|-------|----------|----------|---------------|--------|-------------|------|-------|
| `...101` | `leaky_faucet` | Alice | Home | plumbing-faucet-install | active | $300 | 3 bids | Active auction, 3 bids |
| `...102` | `kitchen_remodel` | Alice | Home | plumbing-pipes | active | $15,000 | 4 bids | Large job, high budget |
| `...103` | `lawn_mowing` | Alice | Rental | landscaping-lawn | awarded | $100 | 1 bid | Won by Bob (cross-category) |
| `...104` | `electrical_panel` | Dave | Home | electrical-panel-upgrade | in_progress | $1,500 | 2 bids | Carol working, milestone-based |
| `...105` | `bathroom_paint` | Irene | Home | painting-interior | completed | $500 | 2 bids | Henry completed, reviewed |
| `...106` | `roof_repair` | Dave | Home | roofing-leak-repair | in_progress | $5,000 | 2 bids | Disputed with Eve |
| `...107` | `deck_staining` | Irene | Lake House | painting-staining | cancelled | $800 | 1 bid | Cancelled by Irene |
| `...108` | `drain_clearing` | Alice | Home | plumbing-drain-clearing | draft | $200 | 0 | Draft, not published |
| `...109` | `ac_install` | Irene | Home | hvac-ac-install | closed_zero_bids | $4,000 | 0 | No bids received, auction ended |
| `...110` | `fence_build` | Dave | Home | fencing-wood | awarded | $3,000 | 0 | Awarded, contract_pending |
| `...111` | `house_cleaning` | Alice | Rental | cleaning-residential | reviewed | $250 | 1 bid | Completed + both reviews in |
| `...112` | `garage_door` | Irene | Home | garage-doors | expired | $1,200 | 0 | Expired, never reposted |
| `...113` | `window_install` | Alice | Home | wd-window-install | reposted | $2,500 | 0 | Reposted from expired auction |
| `...114` | `suspended_job` | Alice | Home | handyman-repairs | suspended | $400 | 0 | Admin suspended |
| `...115` | `recurring_lawn` | Irene | Home | landscaping-lawn | completed | $100 | 1 bid | Recurring weekly lawn care |
| `...116` | `light_fixture` | Alice | Home | electrical-light-install | in_progress | $1,200 | 1 bid | Active contract, milestone 1 done |
| `...117` | `hvac_repair` | Dave | Home | hvac-ac-repair | active | $800 | 2 bids | Active auction, Offer Accepted set |
| `...118` | `deep_clean` | Irene | Lake House | cleaning-deep | closed | $600 | 3 bids | Closed auction, ready to award |

```sql
-- Fixture: jobs
INSERT INTO jobs (id, customer_id, property_id, title, description,
                  category_id, subcategory_id, service_type_id,
                  service_address, service_city, service_state, service_zip,
                  service_location, approximate_location,
                  schedule_type, scheduled_date, schedule_range_start, schedule_range_end,
                  is_recurring, recurrence_frequency,
                  starting_bid_cents, offer_accepted_cents, auction_duration_hours, auction_ends_at,
                  min_provider_rating, status,
                  awarded_provider_id, awarded_bid_id,
                  reposted_from_id, repost_count,
                  bid_count, awarded_at, closed_at, completed_at, cancelled_at)
VALUES
  -- 101: leaky_faucet - active auction with 3 bids (Alice, Home, plumbing)
  ('00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000031',
   'Leaky Kitchen Faucet Repair',
   'Kitchen faucet dripping constantly from the base. Moen single-handle pull-down sprayer, approximately 5 years old. Need diagnosis and repair or replacement. Under-sink shutoff valves work fine.',
   (SELECT id FROM service_categories WHERE slug = 'plumbing'),
   (SELECT id FROM service_categories WHERE slug = 'plumbing-fixtures'),
   (SELECT id FROM service_categories WHERE slug = 'plumbing-faucet-install'),
   '123 Pine St', 'Seattle', 'WA', '98122',
   ST_SetSRID(ST_MakePoint(-122.3321, 47.6062), 4326),
   ST_SetSRID(ST_MakePoint(-122.3300, 47.6050), 4326),
   'flexible', NULL, NULL, NULL,
   false, NULL,
   30000, NULL, 72, now() + interval '36 hours',
   NULL, 'active',
   NULL, NULL,
   NULL, 0,
   3, NULL, NULL, NULL, NULL),

  -- 102: kitchen_remodel - active, large budget, 4 bids (Alice, Home, plumbing)
  ('00000000-0000-0000-0000-000000000102',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000031',
   'Full Kitchen Plumbing Re-pipe',
   'Complete re-pipe of kitchen supply lines and drain. House built in 1965 with original galvanized steel pipes. Need to replace with PEX supply and PVC drain. Includes moving dishwasher supply line 4 feet to accommodate new layout. Approximately 45 linear feet of supply line and 20 feet of drain.',
   (SELECT id FROM service_categories WHERE slug = 'plumbing'),
   (SELECT id FROM service_categories WHERE slug = 'plumbing-pipes'),
   (SELECT id FROM service_categories WHERE slug = 'plumbing-pipe-replacement'),
   '123 Pine St', 'Seattle', 'WA', '98122',
   ST_SetSRID(ST_MakePoint(-122.3321, 47.6062), 4326),
   ST_SetSRID(ST_MakePoint(-122.3300, 47.6050), 4326),
   'date_range', NULL, (CURRENT_DATE + interval '30 days')::date, (CURRENT_DATE + interval '60 days')::date,
   false, NULL,
   1500000, 1200000, 168, now() + interval '120 hours',
   4.0, 'active',
   NULL, NULL,
   NULL, 0,
   4, NULL, NULL, NULL, NULL),

  -- 103: lawn_mowing - awarded to Bob (cross-category), Alice, Rental
  ('00000000-0000-0000-0000-000000000103',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000032',
   'Weekly Lawn Mowing - Rental Property',
   'Need weekly lawn mowing for rental property. Small yard, approximately 2,000 sq ft. Includes edging along sidewalk and driveway. Grass clippings can be left (mulch mow).',
   (SELECT id FROM service_categories WHERE slug = 'landscaping'),
   (SELECT id FROM service_categories WHERE slug = 'landscaping-lawn'),
   NULL,
   '456 Bellevue Way NE', 'Bellevue', 'WA', '98004',
   ST_SetSRID(ST_MakePoint(-122.2015, 47.6101), 4326),
   ST_SetSRID(ST_MakePoint(-122.2000, 47.6100), 4326),
   'flexible', NULL, NULL, NULL,
   false, NULL,
   10000, NULL, 72, now() - interval '5 days',
   NULL, 'awarded',
   '00000000-0000-0000-0000-000000000002', NULL,
   NULL, 0,
   1, now() - interval '3 days', now() - interval '5 days', NULL, NULL),

  -- 104: electrical_panel - in_progress, Carol working, Dave's home
  ('00000000-0000-0000-0000-000000000104',
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000033',
   'Electrical Panel Upgrade to 200A',
   'Upgrade main electrical panel from 100A to 200A. Current panel is Federal Pacific (known fire hazard). Need licensed electrician for permit pull, panel swap, and inspection. Panel is on exterior wall, easy access.',
   (SELECT id FROM service_categories WHERE slug = 'electrical'),
   (SELECT id FROM service_categories WHERE slug = 'electrical-panels'),
   (SELECT id FROM service_categories WHERE slug = 'electrical-panel-upgrade'),
   '789 Overlake Dr', 'Redmond', 'WA', '98052',
   ST_SetSRID(ST_MakePoint(-122.1215, 47.6740), 4326),
   ST_SetSRID(ST_MakePoint(-122.1200, 47.6730), 4326),
   'date_range', NULL, (CURRENT_DATE - interval '10 days')::date, (CURRENT_DATE + interval '5 days')::date,
   false, NULL,
   150000, NULL, 72, now() - interval '20 days',
   NULL, 'in_progress',
   '00000000-0000-0000-0000-000000000003', NULL,
   NULL, 0,
   2, now() - interval '15 days', now() - interval '20 days', NULL, NULL),

  -- 105: bathroom_paint - completed by Henry, Irene's home
  ('00000000-0000-0000-0000-000000000105',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000034',
   'Master Bathroom Repaint',
   'Repaint master bathroom walls and ceiling. Currently light blue, want to change to warm white (Benjamin Moore White Dove OC-17). Room is approximately 8x10 with 9ft ceilings. Some minor drywall patching needed near shower.',
   (SELECT id FROM service_categories WHERE slug = 'painting'),
   (SELECT id FROM service_categories WHERE slug = 'painting-interior'),
   NULL,
   '321 Market St', 'Kirkland', 'WA', '98033',
   ST_SetSRID(ST_MakePoint(-122.2087, 47.6815), 4326),
   ST_SetSRID(ST_MakePoint(-122.2100, 47.6800), 4326),
   'flexible', NULL, NULL, NULL,
   false, NULL,
   50000, NULL, 72, now() - interval '30 days',
   NULL, 'completed',
   '00000000-0000-0000-0000-000000000008', NULL,
   NULL, 0,
   2, now() - interval '25 days', now() - interval '30 days', now() - interval '15 days', NULL),

  -- 106: roof_repair - in_progress, disputed with Eve, Dave's home
  ('00000000-0000-0000-0000-000000000106',
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000033',
   'Roof Leak Repair - Chimney Flashing',
   'Roof leaking around chimney during heavy rain. Need flashing repair or replacement. Single-story ranch, easy roof access. Asphalt shingle roof approximately 10 years old, otherwise in good condition.',
   (SELECT id FROM service_categories WHERE slug = 'roofing'),
   (SELECT id FROM service_categories WHERE slug = 'roofing-repair'),
   (SELECT id FROM service_categories WHERE slug = 'roofing-leak-repair'),
   '789 Overlake Dr', 'Redmond', 'WA', '98052',
   ST_SetSRID(ST_MakePoint(-122.1215, 47.6740), 4326),
   ST_SetSRID(ST_MakePoint(-122.1200, 47.6730), 4326),
   'specific_date', (CURRENT_DATE - interval '14 days')::date, NULL, NULL,
   false, NULL,
   500000, NULL, 72, now() - interval '30 days',
   NULL, 'in_progress',
   '00000000-0000-0000-0000-000000000005', NULL,
   NULL, 0,
   2, now() - interval '25 days', now() - interval '30 days', NULL, NULL),

  -- 107: deck_staining - cancelled by Irene, Lake House
  ('00000000-0000-0000-0000-000000000107',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000035',
   'Deck Staining - Cedar Deck',
   'Stain and seal 400 sq ft cedar deck at lake house. Deck is 3 years old, never been stained. Prefer a semi-transparent natural cedar tone. Power washing needed first.',
   (SELECT id FROM service_categories WHERE slug = 'painting'),
   (SELECT id FROM service_categories WHERE slug = 'painting-staining'),
   NULL,
   '555 Lakeview Rd', 'Issaquah', 'WA', '98027',
   ST_SetSRID(ST_MakePoint(-122.0355, 47.5301), 4326),
   ST_SetSRID(ST_MakePoint(-122.0350, 47.5300), 4326),
   'date_range', NULL, (CURRENT_DATE - interval '10 days')::date, (CURRENT_DATE + interval '20 days')::date,
   false, NULL,
   80000, NULL, 72, now() - interval '8 days',
   NULL, 'cancelled',
   NULL, NULL,
   NULL, 0,
   1, NULL, NULL, NULL, now() - interval '7 days'),

  -- 108: drain_clearing - draft, Alice, Home
  ('00000000-0000-0000-0000-000000000108',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000031',
   'Slow Drain in Basement Bathroom',
   'Basement bathroom sink draining very slowly. Tried Drano and a plunger, no improvement. Might be a deeper clog in the branch line.',
   (SELECT id FROM service_categories WHERE slug = 'plumbing'),
   (SELECT id FROM service_categories WHERE slug = 'plumbing-drains'),
   (SELECT id FROM service_categories WHERE slug = 'plumbing-drain-clearing'),
   '123 Pine St', 'Seattle', 'WA', '98122',
   ST_SetSRID(ST_MakePoint(-122.3321, 47.6062), 4326),
   ST_SetSRID(ST_MakePoint(-122.3300, 47.6050), 4326),
   'flexible', NULL, NULL, NULL,
   false, NULL,
   20000, NULL, 72, NULL,
   NULL, 'draft',
   NULL, NULL,
   NULL, 0,
   0, NULL, NULL, NULL, NULL),

  -- 109: ac_install - closed_zero_bids, Irene, Home
  ('00000000-0000-0000-0000-000000000109',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000034',
   'Central AC Installation',
   'Need central AC installed. House has existing ductwork from furnace. Approximately 2,200 sq ft, two-story. Looking for 16+ SEER unit.',
   (SELECT id FROM service_categories WHERE slug = 'hvac'),
   (SELECT id FROM service_categories WHERE slug = 'hvac-cooling'),
   (SELECT id FROM service_categories WHERE slug = 'hvac-ac-install'),
   '321 Market St', 'Kirkland', 'WA', '98033',
   ST_SetSRID(ST_MakePoint(-122.2087, 47.6815), 4326),
   ST_SetSRID(ST_MakePoint(-122.2100, 47.6800), 4326),
   'date_range', NULL, (CURRENT_DATE - interval '5 days')::date, (CURRENT_DATE + interval '25 days')::date,
   false, NULL,
   400000, NULL, 72, now() - interval '10 days',
   4.0, 'closed_zero_bids',
   NULL, NULL,
   NULL, 0,
   0, NULL, now() - interval '10 days', NULL, NULL),

  -- 110: fence_build - awarded, contract_pending (Dave, Home)
  ('00000000-0000-0000-0000-000000000110',
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000033',
   'Backyard Wood Fence - 80 Linear Feet',
   'Need 6-foot cedar privacy fence installed along back property line. Approximately 80 linear feet with one 4-foot wide gate. Existing chain link fence needs removal first. Flat terrain, no significant grading issues.',
   (SELECT id FROM service_categories WHERE slug = 'fencing'),
   (SELECT id FROM service_categories WHERE slug = 'fencing-wood'),
   NULL,
   '789 Overlake Dr', 'Redmond', 'WA', '98052',
   ST_SetSRID(ST_MakePoint(-122.1215, 47.6740), 4326),
   ST_SetSRID(ST_MakePoint(-122.1200, 47.6730), 4326),
   'date_range', NULL, (CURRENT_DATE + interval '14 days')::date, (CURRENT_DATE + interval '30 days')::date,
   false, NULL,
   300000, NULL, 72, now() - interval '3 days',
   NULL, 'contract_pending',
   '00000000-0000-0000-0000-000000000008', NULL,
   NULL, 0,
   3, now() - interval '1 day', now() - interval '3 days', NULL, NULL),

  -- 111: house_cleaning - reviewed (Alice, Rental)
  ('00000000-0000-0000-0000-000000000111',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000032',
   'Move-Out Deep Cleaning',
   'Deep clean of 2BR/2BA rental unit after tenant move-out. Includes kitchen appliance cleaning, bathroom tile scrubbing, carpet vacuuming, and window cleaning. Unit is approximately 1,100 sq ft.',
   (SELECT id FROM service_categories WHERE slug = 'cleaning'),
   (SELECT id FROM service_categories WHERE slug = 'cleaning-residential'),
   NULL,
   '456 Bellevue Way NE', 'Bellevue', 'WA', '98004',
   ST_SetSRID(ST_MakePoint(-122.2015, 47.6101), 4326),
   ST_SetSRID(ST_MakePoint(-122.2000, 47.6100), 4326),
   'specific_date', (CURRENT_DATE - interval '25 days')::date, NULL, NULL,
   false, NULL,
   25000, NULL, 72, now() - interval '35 days',
   NULL, 'reviewed',
   '00000000-0000-0000-0000-000000000002', NULL,
   NULL, 0,
   1, now() - interval '30 days', now() - interval '35 days', now() - interval '24 days', NULL),

  -- 112: garage_door - expired (Irene, Home)
  ('00000000-0000-0000-0000-000000000112',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000034',
   'Garage Door Opener Replacement',
   'Replace garage door opener. Current Chamberlain is 15 years old and motor is failing. Want a belt-drive with smart home integration (MyQ compatible). Standard 16x7 door.',
   (SELECT id FROM service_categories WHERE slug = 'garage'),
   (SELECT id FROM service_categories WHERE slug = 'garage-doors'),
   NULL,
   '321 Market St', 'Kirkland', 'WA', '98033',
   ST_SetSRID(ST_MakePoint(-122.2087, 47.6815), 4326),
   ST_SetSRID(ST_MakePoint(-122.2100, 47.6800), 4326),
   'flexible', NULL, NULL, NULL,
   false, NULL,
   120000, NULL, 72, now() - interval '20 days',
   NULL, 'expired',
   NULL, NULL,
   NULL, 0,
   0, NULL, NULL, NULL, NULL),

  -- 113: window_install - reposted from expired job 112 concept (Alice, Home)
  ('00000000-0000-0000-0000-000000000113',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000031',
   'Living Room Window Replacement (2 windows)',
   'Replace two large living room windows. Current windows are single-pane aluminum from 1972. Want double-pane vinyl with Low-E coating. Each window approximately 4ft x 5ft. Interior trim replacement included.',
   (SELECT id FROM service_categories WHERE slug = 'windows-doors'),
   (SELECT id FROM service_categories WHERE slug = 'wd-window-install'),
   NULL,
   '123 Pine St', 'Seattle', 'WA', '98122',
   ST_SetSRID(ST_MakePoint(-122.3321, 47.6062), 4326),
   ST_SetSRID(ST_MakePoint(-122.3300, 47.6050), 4326),
   'date_range', NULL, (CURRENT_DATE + interval '20 days')::date, (CURRENT_DATE + interval '40 days')::date,
   false, NULL,
   250000, NULL, 72, now() + interval '48 hours',
   NULL, 'reposted',
   NULL, 1,
   0, NULL, NULL, NULL, NULL),

  -- 114: suspended_job - admin suspended (Alice, Home)
  ('00000000-0000-0000-0000-000000000114',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000031',
   'Miscellaneous Handyman Work - 4 Hours',
   'Need handyman for miscellaneous tasks: hang 3 shelves, fix squeaky door hinge, replace bathroom exhaust fan, caulk around bathtub. Estimating about 4 hours of work.',
   (SELECT id FROM service_categories WHERE slug = 'handyman'),
   (SELECT id FROM service_categories WHERE slug = 'handyman-repairs'),
   NULL,
   '123 Pine St', 'Seattle', 'WA', '98122',
   ST_SetSRID(ST_MakePoint(-122.3321, 47.6062), 4326),
   ST_SetSRID(ST_MakePoint(-122.3300, 47.6050), 4326),
   'flexible', NULL, NULL, NULL,
   false, NULL,
   40000, NULL, 72, now() - interval '12 days',
   NULL, 'suspended',
   NULL, NULL,
   NULL, 0,
   0, NULL, NULL, NULL, NULL),

  -- 115: recurring_lawn - completed recurring job (Irene, Home)
  ('00000000-0000-0000-0000-000000000115',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000034',
   'Weekly Lawn Care Service',
   'Weekly lawn mowing, edging, and leaf blowing for front and back yard. Approximately 4,000 sq ft total. Includes trimming around flower beds.',
   (SELECT id FROM service_categories WHERE slug = 'landscaping'),
   (SELECT id FROM service_categories WHERE slug = 'landscaping-lawn'),
   NULL,
   '321 Market St', 'Kirkland', 'WA', '98033',
   ST_SetSRID(ST_MakePoint(-122.2087, 47.6815), 4326),
   ST_SetSRID(ST_MakePoint(-122.2100, 47.6800), 4326),
   'flexible', NULL, NULL, NULL,
   true, 'weekly',
   10000, NULL, 72, now() - interval '50 days',
   NULL, 'completed',
   '00000000-0000-0000-0000-000000000002', NULL,
   NULL, 0,
   1, now() - interval '45 days', now() - interval '50 days', now() - interval '5 days', NULL),

  -- 116: light_fixture - in_progress with contract and milestones (Alice, Home)
  ('00000000-0000-0000-0000-000000000116',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000031',
   'Living Room Light Fixture Upgrade',
   'Replace outdated ceiling light fixtures in living room and dining room. Total of 4 fixtures. Dimmable switches preferred. All wiring is already in place.',
   (SELECT id FROM service_categories WHERE slug = 'electrical'),
   (SELECT id FROM service_categories WHERE slug = 'electrical-lighting'),
   (SELECT id FROM service_categories WHERE slug = 'electrical-light-install'),
   '123 Pine St', 'Seattle', 'WA', '98122',
   ST_SetSRID(ST_MakePoint(-122.3321, 47.6062), 4326),
   ST_SetSRID(ST_MakePoint(-122.3300, 47.6050), 4326),
   'specific_date', (CURRENT_DATE - interval '3 days')::date, NULL, NULL,
   false, NULL,
   120000, NULL, 72, now() - interval '14 days',
   NULL, 'in_progress',
   '00000000-0000-0000-0000-000000000003', NULL,
   NULL, 0,
   1, now() - interval '10 days', now() - interval '14 days', NULL, NULL),

  -- 117: hvac_repair - active auction with Offer Accepted price (Dave, Home)
  ('00000000-0000-0000-0000-000000000117',
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000033',
   'AC Not Cooling - Repair Needed',
   'Central AC unit running but not cooling. Thermostat set to 72 but house temp is 82. Unit is a 5-year-old Carrier 3-ton. Noticed ice on the outdoor unit. Need diagnosis and repair.',
   (SELECT id FROM service_categories WHERE slug = 'hvac'),
   (SELECT id FROM service_categories WHERE slug = 'hvac-cooling'),
   (SELECT id FROM service_categories WHERE slug = 'hvac-ac-repair'),
   '789 Overlake Dr', 'Redmond', 'WA', '98052',
   ST_SetSRID(ST_MakePoint(-122.1215, 47.6740), 4326),
   ST_SetSRID(ST_MakePoint(-122.1200, 47.6730), 4326),
   'specific_date', (CURRENT_DATE + interval '2 days')::date, NULL, NULL,
   false, NULL,
   80000, 60000, 48, now() + interval '24 hours',
   NULL, 'active',
   NULL, NULL,
   NULL, 0,
   2, NULL, NULL, NULL, NULL),

  -- 118: deep_clean - closed auction, ready to award (Irene, Lake House)
  ('00000000-0000-0000-0000-000000000118',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000035',
   'Spring Deep Clean - Lake House',
   'Full deep clean of lake house to prepare for summer season. 3BR/2BA, approximately 1,800 sq ft. Includes window washing (interior and exterior), carpet shampooing, and deck sweeping. House has been closed since October.',
   (SELECT id FROM service_categories WHERE slug = 'cleaning'),
   (SELECT id FROM service_categories WHERE slug = 'cleaning-deep'),
   NULL,
   '555 Lakeview Rd', 'Issaquah', 'WA', '98027',
   ST_SetSRID(ST_MakePoint(-122.0355, 47.5301), 4326),
   ST_SetSRID(ST_MakePoint(-122.0350, 47.5300), 4326),
   'date_range', NULL, (CURRENT_DATE + interval '7 days')::date, (CURRENT_DATE + interval '21 days')::date,
   false, NULL,
   60000, NULL, 72, now() - interval '1 hour',
   NULL, 'closed',
   NULL, NULL,
   NULL, 0,
   3, NULL, now() - interval '1 hour', NULL, NULL);

-- Back-fill awarded_bid_id foreign keys (must happen after bids are inserted)
-- See "Post-Insert FK Updates" at the end of section 5.
```

### Job Photos

```sql
-- Fixture: job_photos
INSERT INTO job_photos (id, job_id, image_url, sort_order)
VALUES
  ('00000000-0000-0000-0000-000000000151',
   '00000000-0000-0000-0000-000000000101',
   'https://cdn.test.com/jobs/101-faucet-drip.jpg', 1),
  ('00000000-0000-0000-0000-000000000152',
   '00000000-0000-0000-0000-000000000101',
   'https://cdn.test.com/jobs/101-under-sink.jpg', 2),
  ('00000000-0000-0000-0000-000000000153',
   '00000000-0000-0000-0000-000000000104',
   'https://cdn.test.com/jobs/104-old-panel.jpg', 1),
  ('00000000-0000-0000-0000-000000000154',
   '00000000-0000-0000-0000-000000000106',
   'https://cdn.test.com/jobs/106-chimney-leak.jpg', 1),
  ('00000000-0000-0000-0000-000000000155',
   '00000000-0000-0000-0000-000000000106',
   'https://cdn.test.com/jobs/106-flashing-detail.jpg', 2),
  ('00000000-0000-0000-0000-000000000156',
   '00000000-0000-0000-0000-000000000117',
   'https://cdn.test.com/jobs/117-frozen-ac-unit.jpg', 1);
```

---

## 5. Bid Fixtures

All bids are sealed (providers cannot see other bids). Bids can only be lowered, never raised.

| ID | Job | Provider | Amount | Orig Amount | Status | Notes |
|----|-----|----------|--------|-------------|--------|-------|
| `...201` | 101 (leaky_faucet) | Bob | $250 | $280 | active | Lowered once, current lowest |
| `...202` | 101 (leaky_faucet) | Carol | $275 | $275 | active | Mid-range bid |
| `...203` | 101 (leaky_faucet) | Kate | $290 | $290 | active | Highest active bid |
| `...204` | 102 (kitchen_remodel) | Bob | $12,000 | $13,500 | active | Lowered once |
| `...205` | 102 (kitchen_remodel) | Kate | $11,500 | $12,000 | active | Current lowest |
| `...206` | 102 (kitchen_remodel) | Henry | $13,000 | $13,000 | active | Cross-category bid |
| `...207` | 102 (kitchen_remodel) | Jake | $14,500 | $14,500 | withdrawn | Provider withdrew |
| `...208` | 103 (lawn_mowing) | Bob | $85 | $85 | awarded | Won the auction |
| `...209` | 104 (electrical_panel) | Carol | $1,200 | $1,350 | awarded | Won, contract active |
| `...210` | 104 (electrical_panel) | Eve | $1,100 | $1,100 | not_selected | Lower but Eve selected over |
| `...211` | 105 (bathroom_paint) | Henry | $380 | $420 | awarded | Completed job |
| `...212` | 105 (bathroom_paint) | Kate | $450 | $450 | not_selected | Lost |
| `...213` | 106 (roof_repair) | Eve | $3,800 | $4,200 | awarded | Under dispute |
| `...214` | 106 (roof_repair) | Jake | $4,000 | $4,000 | not_selected | Lost |
| `...215` | 107 (deck_staining) | Henry | $650 | $650 | expired | Auction cancelled |
| `...216` | 111 (house_cleaning) | Bob | $200 | $200 | awarded | Completed + reviewed |
| `...217` | 115 (recurring_lawn) | Bob | $75 | $75 | awarded | Recurring contract |
| `...218` | 116 (light_fixture) | Carol | $950 | $1,000 | awarded | Active contract |
| `...219` | 117 (hvac_repair) | Kate | $550 | $600 | active | Lowered, Offer Accepted available |
| `...220` | 117 (hvac_repair) | Bob | $700 | $700 | active | Higher bid |
| `...221` | 118 (deep_clean) | Bob | $450 | $500 | active | Lowered once |
| `...222` | 118 (deep_clean) | Henry | $480 | $480 | active | Mid-range |
| `...223` | 118 (deep_clean) | Kate | $520 | $520 | active | Highest |
| `...224` | 110 (fence_build) | Henry | $2,600 | $2,800 | awarded | Won, contract pending |
| `...225` | 110 (fence_build) | Jake | $2,900 | $2,900 | not_selected | Lost |

```sql
-- Fixture: bids
INSERT INTO bids (id, job_id, provider_id, amount_cents, is_offer_accepted,
                  status, original_amount_cents, bid_updates,
                  awarded_at, withdrawn_at)
VALUES
  -- Bids on job 101 (leaky_faucet) - 3 active bids
  ('00000000-0000-0000-0000-000000000201',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000002',
   25000, false, 'active', 28000,
   '[{"amount_cents": 28000, "updated_at": "' || (now() - interval '20 hours')::text || '"}, {"amount_cents": 25000, "updated_at": "' || (now() - interval '6 hours')::text || '"}]',
   NULL, NULL),

  ('00000000-0000-0000-0000-000000000202',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000003',
   27500, false, 'active', 27500,
   '[]',
   NULL, NULL),

  ('00000000-0000-0000-0000-000000000203',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000012',
   29000, false, 'active', 29000,
   '[]',
   NULL, NULL),

  -- Bids on job 102 (kitchen_remodel) - 3 active + 1 withdrawn
  ('00000000-0000-0000-0000-000000000204',
   '00000000-0000-0000-0000-000000000102',
   '00000000-0000-0000-0000-000000000002',
   1200000, false, 'active', 1350000,
   '[{"amount_cents": 1350000, "updated_at": "' || (now() - interval '4 days')::text || '"}, {"amount_cents": 1200000, "updated_at": "' || (now() - interval '2 days')::text || '"}]',
   NULL, NULL),

  ('00000000-0000-0000-0000-000000000205',
   '00000000-0000-0000-0000-000000000102',
   '00000000-0000-0000-0000-000000000012',
   1150000, false, 'active', 1200000,
   '[{"amount_cents": 1200000, "updated_at": "' || (now() - interval '3 days')::text || '"}, {"amount_cents": 1150000, "updated_at": "' || (now() - interval '1 day')::text || '"}]',
   NULL, NULL),

  ('00000000-0000-0000-0000-000000000206',
   '00000000-0000-0000-0000-000000000102',
   '00000000-0000-0000-0000-000000000008',
   1300000, false, 'active', 1300000,
   '[]',
   NULL, NULL),

  ('00000000-0000-0000-0000-000000000207',
   '00000000-0000-0000-0000-000000000102',
   '00000000-0000-0000-0000-000000000010',
   1450000, false, 'withdrawn', 1450000,
   '[]',
   NULL, now() - interval '1 day'),

  -- Bid on job 103 (lawn_mowing) - 1 awarded
  ('00000000-0000-0000-0000-000000000208',
   '00000000-0000-0000-0000-000000000103',
   '00000000-0000-0000-0000-000000000002',
   8500, false, 'awarded', 8500,
   '[]',
   now() - interval '3 days', NULL),

  -- Bids on job 104 (electrical_panel) - 1 awarded, 1 not_selected
  ('00000000-0000-0000-0000-000000000209',
   '00000000-0000-0000-0000-000000000104',
   '00000000-0000-0000-0000-000000000003',
   120000, false, 'awarded', 135000,
   '[{"amount_cents": 135000, "updated_at": "' || (now() - interval '22 days')::text || '"}, {"amount_cents": 120000, "updated_at": "' || (now() - interval '20 days')::text || '"}]',
   now() - interval '15 days', NULL),

  ('00000000-0000-0000-0000-000000000210',
   '00000000-0000-0000-0000-000000000104',
   '00000000-0000-0000-0000-000000000005',
   110000, false, 'not_selected', 110000,
   '[]',
   NULL, NULL),

  -- Bids on job 105 (bathroom_paint) - 1 awarded, 1 not_selected
  ('00000000-0000-0000-0000-000000000211',
   '00000000-0000-0000-0000-000000000105',
   '00000000-0000-0000-0000-000000000008',
   38000, false, 'awarded', 42000,
   '[{"amount_cents": 42000, "updated_at": "' || (now() - interval '28 days')::text || '"}, {"amount_cents": 38000, "updated_at": "' || (now() - interval '26 days')::text || '"}]',
   now() - interval '25 days', NULL),

  ('00000000-0000-0000-0000-000000000212',
   '00000000-0000-0000-0000-000000000105',
   '00000000-0000-0000-0000-000000000012',
   45000, false, 'not_selected', 45000,
   '[]',
   NULL, NULL),

  -- Bids on job 106 (roof_repair) - 1 awarded (Eve, disputed), 1 not_selected
  ('00000000-0000-0000-0000-000000000213',
   '00000000-0000-0000-0000-000000000106',
   '00000000-0000-0000-0000-000000000005',
   380000, false, 'awarded', 420000,
   '[{"amount_cents": 420000, "updated_at": "' || (now() - interval '32 days')::text || '"}, {"amount_cents": 380000, "updated_at": "' || (now() - interval '30 days')::text || '"}]',
   now() - interval '25 days', NULL),

  ('00000000-0000-0000-0000-000000000214',
   '00000000-0000-0000-0000-000000000106',
   '00000000-0000-0000-0000-000000000010',
   400000, false, 'not_selected', 400000,
   '[]',
   NULL, NULL),

  -- Bid on job 107 (deck_staining) - 1 expired (job cancelled)
  ('00000000-0000-0000-0000-000000000215',
   '00000000-0000-0000-0000-000000000107',
   '00000000-0000-0000-0000-000000000008',
   65000, false, 'expired', 65000,
   '[]',
   NULL, NULL),

  -- Bid on job 111 (house_cleaning) - 1 awarded, completed + reviewed
  ('00000000-0000-0000-0000-000000000216',
   '00000000-0000-0000-0000-000000000111',
   '00000000-0000-0000-0000-000000000002',
   20000, false, 'awarded', 20000,
   '[]',
   now() - interval '30 days', NULL),

  -- Bid on job 115 (recurring_lawn) - 1 awarded, recurring
  ('00000000-0000-0000-0000-000000000217',
   '00000000-0000-0000-0000-000000000115',
   '00000000-0000-0000-0000-000000000002',
   7500, false, 'awarded', 7500,
   '[]',
   now() - interval '45 days', NULL),

  -- Bid on job 116 (light_fixture) - 1 awarded, active contract
  ('00000000-0000-0000-0000-000000000218',
   '00000000-0000-0000-0000-000000000116',
   '00000000-0000-0000-0000-000000000003',
   95000, false, 'awarded', 100000,
   '[{"amount_cents": 100000, "updated_at": "' || (now() - interval '15 days')::text || '"}, {"amount_cents": 95000, "updated_at": "' || (now() - interval '13 days')::text || '"}]',
   now() - interval '10 days', NULL),

  -- Bids on job 117 (hvac_repair) - 2 active
  ('00000000-0000-0000-0000-000000000219',
   '00000000-0000-0000-0000-000000000117',
   '00000000-0000-0000-0000-000000000012',
   55000, false, 'active', 60000,
   '[{"amount_cents": 60000, "updated_at": "' || (now() - interval '18 hours')::text || '"}, {"amount_cents": 55000, "updated_at": "' || (now() - interval '6 hours')::text || '"}]',
   NULL, NULL),

  ('00000000-0000-0000-0000-000000000220',
   '00000000-0000-0000-0000-000000000117',
   '00000000-0000-0000-0000-000000000002',
   70000, false, 'active', 70000,
   '[]',
   NULL, NULL),

  -- Bids on job 118 (deep_clean) - 3 active
  ('00000000-0000-0000-0000-000000000221',
   '00000000-0000-0000-0000-000000000118',
   '00000000-0000-0000-0000-000000000002',
   45000, false, 'active', 50000,
   '[{"amount_cents": 50000, "updated_at": "' || (now() - interval '3 days')::text || '"}, {"amount_cents": 45000, "updated_at": "' || (now() - interval '1 day')::text || '"}]',
   NULL, NULL),

  ('00000000-0000-0000-0000-000000000222',
   '00000000-0000-0000-0000-000000000118',
   '00000000-0000-0000-0000-000000000008',
   48000, false, 'active', 48000,
   '[]',
   NULL, NULL),

  ('00000000-0000-0000-0000-000000000223',
   '00000000-0000-0000-0000-000000000118',
   '00000000-0000-0000-0000-000000000012',
   52000, false, 'active', 52000,
   '[]',
   NULL, NULL),

  -- Bids on job 110 (fence_build) - 1 awarded (Henry), 1 not_selected
  ('00000000-0000-0000-0000-000000000224',
   '00000000-0000-0000-0000-000000000110',
   '00000000-0000-0000-0000-000000000008',
   260000, false, 'awarded', 280000,
   '[{"amount_cents": 280000, "updated_at": "' || (now() - interval '5 days')::text || '"}, {"amount_cents": 260000, "updated_at": "' || (now() - interval '3 days')::text || '"}]',
   now() - interval '1 day', NULL),

  ('00000000-0000-0000-0000-000000000225',
   '00000000-0000-0000-0000-000000000110',
   '00000000-0000-0000-0000-000000000010',
   290000, false, 'not_selected', 290000,
   '[]',
   NULL, NULL);

-- Post-Insert FK Updates: link awarded_bid_id on jobs
UPDATE jobs SET awarded_bid_id = '00000000-0000-0000-0000-000000000208' WHERE id = '00000000-0000-0000-0000-000000000103';
UPDATE jobs SET awarded_bid_id = '00000000-0000-0000-0000-000000000209' WHERE id = '00000000-0000-0000-0000-000000000104';
UPDATE jobs SET awarded_bid_id = '00000000-0000-0000-0000-000000000211' WHERE id = '00000000-0000-0000-0000-000000000105';
UPDATE jobs SET awarded_bid_id = '00000000-0000-0000-0000-000000000213' WHERE id = '00000000-0000-0000-0000-000000000106';
UPDATE jobs SET awarded_bid_id = '00000000-0000-0000-0000-000000000216' WHERE id = '00000000-0000-0000-0000-000000000111';
UPDATE jobs SET awarded_bid_id = '00000000-0000-0000-0000-000000000217' WHERE id = '00000000-0000-0000-0000-000000000115';
UPDATE jobs SET awarded_bid_id = '00000000-0000-0000-0000-000000000218' WHERE id = '00000000-0000-0000-0000-000000000116';
UPDATE jobs SET awarded_bid_id = '00000000-0000-0000-0000-000000000224' WHERE id = '00000000-0000-0000-0000-000000000110';
```

---

## 6. Contract Fixtures

| ID | Job | Customer | Provider | Bid | Status | Payment Timing | Amount |
|----|-----|----------|----------|-----|--------|---------------|--------|
| `...301` | 103 (lawn_mowing) | Alice | Bob | 208 | pending_acceptance | completion | $85 |
| `...302` | 104 (electrical_panel) | Dave | Carol | 209 | active | milestone | $1,200 |
| `...303` | 105 (bathroom_paint) | Irene | Henry | 211 | completed | milestone | $380 |
| `...304` | 106 (roof_repair) | Dave | Eve | 213 | disputed | upfront | $3,800 |
| `...305` | 111 (house_cleaning) | Alice | Bob | 216 | completed | completion | $200 |
| `...306` | 115 (recurring_lawn) | Irene | Bob | 217 | completed | recurring | $75 |
| `...307` | 116 (light_fixture) | Alice | Carol | 218 | active | milestone | $950 |
| `...308` | 110 (fence_build) | Dave | Henry | 224 | pending_acceptance | milestone | $2,600 |

```sql
-- Fixture: contracts
INSERT INTO contracts (id, contract_number, job_id, customer_id, provider_id, bid_id,
                       amount_cents, payment_timing, terms_json, schedule_json,
                       status, customer_accepted, provider_accepted,
                       acceptance_deadline, accepted_at, started_at,
                       completed_at, cancelled_at, cancelled_by, cancellation_reason)
VALUES
  -- 301: lawn_mowing - pending_acceptance (just awarded)
  ('00000000-0000-0000-0000-000000000301',
   'NM-2026-00001',
   '00000000-0000-0000-0000-000000000103',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000208',
   8500, 'completion',
   '{"cancellation_policy": "Free cancellation 24 hours before", "warranty": "Satisfaction guarantee"}',
   '{"type": "flexible"}',
   'pending_acceptance', true, false,
   now() + interval '48 hours',
   NULL, NULL,
   NULL, NULL, NULL, NULL),

  -- 302: electrical_panel - active, milestone-based, Carol working for Dave
  ('00000000-0000-0000-0000-000000000302',
   'NM-2026-00002',
   '00000000-0000-0000-0000-000000000104',
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000209',
   120000, 'milestone',
   '{"cancellation_policy": "Free cancellation 48 hours before", "warranty": "1-year warranty on labor. Manufacturer warranty on panel."}',
   '{"type": "date_range", "start": "' || (CURRENT_DATE - interval '10 days')::text || '", "end": "' || (CURRENT_DATE + interval '5 days')::text || '"}',
   'active', true, true,
   now() - interval '12 days',
   now() - interval '13 days', now() - interval '10 days',
   NULL, NULL, NULL, NULL),

  -- 303: bathroom_paint - completed, Henry for Irene
  ('00000000-0000-0000-0000-000000000303',
   'NM-2026-00003',
   '00000000-0000-0000-0000-000000000105',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000008',
   '00000000-0000-0000-0000-000000000211',
   38000, 'milestone',
   '{"cancellation_policy": "Free cancellation 48 hours before. 25% charge within 48 hours.", "warranty": "2-year warranty on interior paint."}',
   '{"type": "flexible"}',
   'completed', true, true,
   now() - interval '23 days',
   now() - interval '24 days', now() - interval '22 days',
   now() - interval '15 days', NULL, NULL, NULL),

  -- 304: roof_repair - disputed, Eve for Dave
  ('00000000-0000-0000-0000-000000000304',
   'NM-2026-00004',
   '00000000-0000-0000-0000-000000000106',
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000213',
   380000, 'upfront',
   '{"cancellation_policy": "None specified"}',
   '{"type": "specific_date", "date": "' || (CURRENT_DATE - interval '14 days')::text || '"}',
   'disputed', true, true,
   now() - interval '22 days',
   now() - interval '23 days', now() - interval '18 days',
   NULL, NULL, NULL, NULL),

  -- 305: house_cleaning - completed, Bob for Alice
  ('00000000-0000-0000-0000-000000000305',
   'NM-2026-00005',
   '00000000-0000-0000-0000-000000000111',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000216',
   20000, 'completion',
   '{"cancellation_policy": "Free cancellation 24 hours before", "warranty": "Satisfaction guarantee - re-clean if not satisfied"}',
   '{"type": "specific_date", "date": "' || (CURRENT_DATE - interval '25 days')::text || '"}',
   'completed', true, true,
   now() - interval '28 days',
   now() - interval '29 days', now() - interval '26 days',
   now() - interval '24 days', NULL, NULL, NULL),

  -- 306: recurring_lawn - completed, Bob for Irene (recurring)
  ('00000000-0000-0000-0000-000000000306',
   'NM-2026-00006',
   '00000000-0000-0000-0000-000000000115',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000217',
   7500, 'recurring',
   '{"cancellation_policy": "1 occurrence notice period", "terms": "Weekly lawn care service"}',
   '{"type": "recurring", "frequency": "weekly"}',
   'completed', true, true,
   now() - interval '43 days',
   now() - interval '44 days', now() - interval '42 days',
   now() - interval '5 days', NULL, NULL, NULL),

  -- 307: light_fixture - active, Carol for Alice (milestone-based)
  ('00000000-0000-0000-0000-000000000307',
   'NM-2026-00007',
   '00000000-0000-0000-0000-000000000116',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000218',
   95000, 'milestone',
   '{"cancellation_policy": "Free cancellation 48 hours before", "warranty": "1-year warranty on parts and labor"}',
   '{"type": "specific_date", "date": "' || (CURRENT_DATE - interval '3 days')::text || '"}',
   'active', true, true,
   now() - interval '8 days',
   now() - interval '9 days', now() - interval '7 days',
   NULL, NULL, NULL, NULL),

  -- 308: fence_build - pending_acceptance, Henry for Dave
  ('00000000-0000-0000-0000-000000000308',
   'NM-2026-00008',
   '00000000-0000-0000-0000-000000000110',
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000008',
   '00000000-0000-0000-0000-000000000224',
   260000, 'milestone',
   '{"cancellation_policy": "Free cancellation 48 hours before. 25% charge within 48 hours.", "warranty": "5-year warranty on structural integrity."}',
   '{"type": "date_range", "start": "' || (CURRENT_DATE + interval '14 days')::text || '", "end": "' || (CURRENT_DATE + interval '30 days')::text || '"}',
   'pending_acceptance', true, false,
   now() + interval '48 hours',
   NULL, NULL,
   NULL, NULL, NULL, NULL);
```

---

## 7. Milestone Fixtures

Milestones for milestone-based contracts (302, 303, 307, 308).

| ID | Contract | Description | Amount | Sort | Status |
|----|----------|-------------|--------|------|--------|
| `...311` | 302 (electrical_panel) | Permit & materials | $600 | 1 | approved |
| `...312` | 302 (electrical_panel) | Panel swap & inspection | $600 | 2 | in_progress |
| `...313` | 303 (bathroom_paint) | Prep & primer | $114 | 1 | approved |
| `...314` | 303 (bathroom_paint) | Paint application | $190 | 2 | approved |
| `...315` | 303 (bathroom_paint) | Touch-ups & cleanup | $76 | 3 | approved |
| `...316` | 307 (light_fixture) | Living room fixtures (2) | $475 | 1 | approved |
| `...317` | 307 (light_fixture) | Dining room fixtures (2) | $475 | 2 | in_progress |
| `...318` | 308 (fence_build) | Old fence removal & post holes | $780 | 1 | pending |
| `...319` | 308 (fence_build) | Fence panel installation | $1,300 | 2 | pending |
| `...320` | 308 (fence_build) | Gate & finishing | $520 | 3 | pending |

```sql
-- Fixture: milestones
INSERT INTO milestones (id, contract_id, description, amount_cents, sort_order,
                        status, revision_count, revision_notes, submitted_at, approved_at)
VALUES
  -- Contract 302 milestones (electrical panel - active)
  ('00000000-0000-0000-0000-000000000311',
   '00000000-0000-0000-0000-000000000302',
   'Permit application, materials procurement, and site prep',
   60000, 1,
   'approved', 0, NULL,
   now() - interval '8 days', now() - interval '7 days'),

  ('00000000-0000-0000-0000-000000000312',
   '00000000-0000-0000-0000-000000000302',
   'Panel swap, wiring, and city inspection',
   60000, 2,
   'in_progress', 0, NULL,
   NULL, NULL),

  -- Contract 303 milestones (bathroom paint - completed)
  ('00000000-0000-0000-0000-000000000313',
   '00000000-0000-0000-0000-000000000303',
   'Surface prep, taping, and primer coat',
   11400, 1,
   'approved', 0, NULL,
   now() - interval '20 days', now() - interval '19 days'),

  ('00000000-0000-0000-0000-000000000314',
   '00000000-0000-0000-0000-000000000303',
   'Two coats of paint application',
   19000, 2,
   'approved', 1, 'Minor touch-up needed on ceiling corner - addressed same day',
   now() - interval '17 days', now() - interval '16 days'),

  ('00000000-0000-0000-0000-000000000315',
   '00000000-0000-0000-0000-000000000303',
   'Final touch-ups, tape removal, and cleanup',
   7600, 3,
   'approved', 0, NULL,
   now() - interval '15 days', now() - interval '15 days'),

  -- Contract 307 milestones (light fixture - active)
  ('00000000-0000-0000-0000-000000000316',
   '00000000-0000-0000-0000-000000000307',
   'Install living room light fixtures (2 fixtures) with dimmers',
   47500, 1,
   'approved', 0, NULL,
   now() - interval '5 days', now() - interval '4 days'),

  ('00000000-0000-0000-0000-000000000317',
   '00000000-0000-0000-0000-000000000307',
   'Install dining room light fixtures (2 fixtures) with dimmers',
   47500, 2,
   'in_progress', 0, NULL,
   NULL, NULL),

  -- Contract 308 milestones (fence build - pending_acceptance)
  ('00000000-0000-0000-0000-000000000318',
   '00000000-0000-0000-0000-000000000308',
   'Old chain link fence removal and post hole digging',
   78000, 1,
   'pending', 0, NULL,
   NULL, NULL),

  ('00000000-0000-0000-0000-000000000319',
   '00000000-0000-0000-0000-000000000308',
   'Cedar fence panel installation (80 linear feet)',
   130000, 2,
   'pending', 0, NULL,
   NULL, NULL),

  ('00000000-0000-0000-0000-000000000320',
   '00000000-0000-0000-0000-000000000308',
   'Gate installation, post caps, and final finishing',
   52000, 3,
   'pending', 0, NULL,
   NULL, NULL);
```

---

## 8. Payment Fixtures

| ID | Contract | Milestone | Customer | Provider | Amount | Fee | Guarantee | Payout | Status |
|----|----------|-----------|----------|----------|--------|-----|-----------|--------|--------|
| `...401` | 302 | 311 | Dave | Carol | $600 | $30 | $12 | $558 | completed |
| `...402` | 302 | 312 | Dave | Carol | $600 | $30 | $12 | $558 | escrow |
| `...403` | 303 | 313 | Irene | Henry | $114 | $5.70 | $2.28 | $106.02 | completed |
| `...404` | 303 | 314 | Irene | Henry | $190 | $9.50 | $3.80 | $176.70 | completed |
| `...405` | 303 | 315 | Irene | Henry | $76 | $3.80 | $1.52 | $70.68 | completed |
| `...406` | 304 | NULL | Dave | Eve | $3,800 | $190 | $76 | $3,534 | disputed |
| `...407` | 305 | NULL | Alice | Bob | $200 | $10 | $4 | $186 | completed |
| `...408` | 306 | NULL (inst1) | Irene | Bob | $75 | $3.75 | $1.50 | $69.75 | completed |
| `...409` | 306 | NULL (inst2) | Irene | Bob | $75 | $3.75 | $1.50 | $69.75 | completed |
| `...410` | 306 | NULL (inst3) | Irene | Bob | $75 | $3.75 | $1.50 | $69.75 | pending |
| `...411` | 307 | 316 | Alice | Carol | $475 | $23.75 | $9.50 | $441.75 | completed |
| `...412` | 307 | 317 | Alice | Carol | $475 | $23.75 | $9.50 | $441.75 | escrow |
| `...413` | 305 | NULL | Alice | Bob | $200 | $10 | $4 | $186 | failed |
| `...414` | 305 | NULL | Alice | Bob | $200 | $10 | $4 | $186 | refunded |

```sql
-- Recurring config and instances for contract 306 (needed before payments reference them)
-- Fixture: recurring_configs
INSERT INTO recurring_configs (id, contract_id, frequency, rate_cents, auto_approve,
                               status, next_occurrence)
VALUES
  ('00000000-0000-0000-0000-000000000321',
   '00000000-0000-0000-0000-000000000306',
   'weekly', 7500, false,
   'active', (CURRENT_DATE + interval '5 days')::date);

-- Fixture: recurring_instances
INSERT INTO recurring_instances (id, recurring_id, contract_id, occurrence_date,
                                 status, amount_cents, completed_at, approved_at, auto_approved)
VALUES
  ('00000000-0000-0000-0000-000000000331',
   '00000000-0000-0000-0000-000000000321',
   '00000000-0000-0000-0000-000000000306',
   (CURRENT_DATE - interval '19 days')::date,
   'completed', 7500,
   now() - interval '18 days', now() - interval '17 days', false),

  ('00000000-0000-0000-0000-000000000332',
   '00000000-0000-0000-0000-000000000321',
   '00000000-0000-0000-0000-000000000306',
   (CURRENT_DATE - interval '12 days')::date,
   'completed', 7500,
   now() - interval '11 days', now() - interval '10 days', false),

  ('00000000-0000-0000-0000-000000000333',
   '00000000-0000-0000-0000-000000000321',
   '00000000-0000-0000-0000-000000000306',
   (CURRENT_DATE - interval '5 days')::date,
   'scheduled', 7500,
   NULL, NULL, false);

-- Fixture: payments
INSERT INTO payments (id, contract_id, milestone_id, recurring_instance_id,
                      customer_id, provider_id,
                      amount_cents, platform_fee_cents, guarantee_fee_cents, provider_payout_cents,
                      stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id, stripe_refund_id,
                      idempotency_key, status,
                      failure_reason, refund_amount_cents, refund_reason, refunded_at,
                      retry_count, next_retry_at,
                      escrow_at, released_at, completed_at)
VALUES
  -- 401: Contract 302, milestone 311 (electrical panel permit) - completed
  ('00000000-0000-0000-0000-000000000401',
   '00000000-0000-0000-0000-000000000302',
   '00000000-0000-0000-0000-000000000311',
   NULL,
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000003',
   60000, 3000, 1200, 55800,
   'pi_test_401', 'ch_test_401', 'tr_test_401', NULL,
   'idem_pay_401', 'completed',
   NULL, 0, NULL, NULL,
   0, NULL,
   now() - interval '9 days', now() - interval '7 days', now() - interval '7 days'),

  -- 402: Contract 302, milestone 312 (panel swap) - in escrow
  ('00000000-0000-0000-0000-000000000402',
   '00000000-0000-0000-0000-000000000302',
   '00000000-0000-0000-0000-000000000312',
   NULL,
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000003',
   60000, 3000, 1200, 55800,
   'pi_test_402', 'ch_test_402', NULL, NULL,
   'idem_pay_402', 'escrow',
   NULL, 0, NULL, NULL,
   0, NULL,
   now() - interval '2 days', NULL, NULL),

  -- 403-405: Contract 303, all 3 milestones (bathroom paint) - all completed
  ('00000000-0000-0000-0000-000000000403',
   '00000000-0000-0000-0000-000000000303',
   '00000000-0000-0000-0000-000000000313',
   NULL,
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000008',
   11400, 570, 228, 10602,
   'pi_test_403', 'ch_test_403', 'tr_test_403', NULL,
   'idem_pay_403', 'completed',
   NULL, 0, NULL, NULL,
   0, NULL,
   now() - interval '20 days', now() - interval '19 days', now() - interval '19 days'),

  ('00000000-0000-0000-0000-000000000404',
   '00000000-0000-0000-0000-000000000303',
   '00000000-0000-0000-0000-000000000314',
   NULL,
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000008',
   19000, 950, 380, 17670,
   'pi_test_404', 'ch_test_404', 'tr_test_404', NULL,
   'idem_pay_404', 'completed',
   NULL, 0, NULL, NULL,
   0, NULL,
   now() - interval '17 days', now() - interval '16 days', now() - interval '16 days'),

  ('00000000-0000-0000-0000-000000000405',
   '00000000-0000-0000-0000-000000000303',
   '00000000-0000-0000-0000-000000000315',
   NULL,
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000008',
   7600, 380, 152, 7068,
   'pi_test_405', 'ch_test_405', 'tr_test_405', NULL,
   'idem_pay_405', 'completed',
   NULL, 0, NULL, NULL,
   0, NULL,
   now() - interval '15 days', now() - interval '15 days', now() - interval '15 days'),

  -- 406: Contract 304 (roof repair) - disputed/frozen
  ('00000000-0000-0000-0000-000000000406',
   '00000000-0000-0000-0000-000000000304',
   NULL, NULL,
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000005',
   380000, 19000, 7600, 353400,
   'pi_test_406', 'ch_test_406', NULL, NULL,
   'idem_pay_406', 'disputed',
   NULL, 0, NULL, NULL,
   0, NULL,
   now() - interval '18 days', NULL, NULL),

  -- 407: Contract 305 (house cleaning) - completed
  ('00000000-0000-0000-0000-000000000407',
   '00000000-0000-0000-0000-000000000305',
   NULL, NULL,
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002',
   20000, 1000, 400, 18600,
   'pi_test_407', 'ch_test_407', 'tr_test_407', NULL,
   'idem_pay_407', 'completed',
   NULL, 0, NULL, NULL,
   0, NULL,
   now() - interval '25 days', now() - interval '24 days', now() - interval '24 days'),

  -- 408-410: Contract 306 (recurring lawn) - 2 completed, 1 pending
  ('00000000-0000-0000-0000-000000000408',
   '00000000-0000-0000-0000-000000000306',
   NULL,
   '00000000-0000-0000-0000-000000000331',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000002',
   7500, 375, 150, 6975,
   'pi_test_408', 'ch_test_408', 'tr_test_408', NULL,
   'idem_pay_408', 'completed',
   NULL, 0, NULL, NULL,
   0, NULL,
   now() - interval '18 days', now() - interval '17 days', now() - interval '17 days'),

  ('00000000-0000-0000-0000-000000000409',
   '00000000-0000-0000-0000-000000000306',
   NULL,
   '00000000-0000-0000-0000-000000000332',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000002',
   7500, 375, 150, 6975,
   'pi_test_409', 'ch_test_409', 'tr_test_409', NULL,
   'idem_pay_409', 'completed',
   NULL, 0, NULL, NULL,
   0, NULL,
   now() - interval '11 days', now() - interval '10 days', now() - interval '10 days'),

  ('00000000-0000-0000-0000-000000000410',
   '00000000-0000-0000-0000-000000000306',
   NULL,
   '00000000-0000-0000-0000-000000000333',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000002',
   7500, 375, 150, 6975,
   NULL, NULL, NULL, NULL,
   'idem_pay_410', 'pending',
   NULL, 0, NULL, NULL,
   0, NULL,
   NULL, NULL, NULL),

  -- 411: Contract 307, milestone 316 (light fixture, living room) - completed
  ('00000000-0000-0000-0000-000000000411',
   '00000000-0000-0000-0000-000000000307',
   '00000000-0000-0000-0000-000000000316',
   NULL,
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000003',
   47500, 2375, 950, 44175,
   'pi_test_411', 'ch_test_411', 'tr_test_411', NULL,
   'idem_pay_411', 'completed',
   NULL, 0, NULL, NULL,
   0, NULL,
   now() - interval '6 days', now() - interval '4 days', now() - interval '4 days'),

  -- 412: Contract 307, milestone 317 (light fixture, dining room) - in escrow
  ('00000000-0000-0000-0000-000000000412',
   '00000000-0000-0000-0000-000000000307',
   '00000000-0000-0000-0000-000000000317',
   NULL,
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000003',
   47500, 2375, 950, 44175,
   'pi_test_412', 'ch_test_412', NULL, NULL,
   'idem_pay_412', 'escrow',
   NULL, 0, NULL, NULL,
   0, NULL,
   now() - interval '2 days', NULL, NULL),

  -- 413: Failed payment (card declined) for house cleaning retry
  ('00000000-0000-0000-0000-000000000413',
   '00000000-0000-0000-0000-000000000305',
   NULL, NULL,
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002',
   20000, 1000, 400, 18600,
   'pi_test_413_failed', NULL, NULL, NULL,
   'idem_pay_413', 'failed',
   'card_declined: Your card was declined. Please try a different payment method.',
   0, NULL, NULL,
   2, now() + interval '24 hours',
   NULL, NULL, NULL),

  -- 414: Refunded payment (partial refund scenario)
  ('00000000-0000-0000-0000-000000000414',
   '00000000-0000-0000-0000-000000000305',
   NULL, NULL,
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002',
   20000, 1000, 400, 18600,
   'pi_test_414', 'ch_test_414', 'tr_test_414', 'rf_test_414',
   'idem_pay_414', 'refunded',
   NULL, 20000, 'Customer requested refund - service not as described', now() - interval '20 days',
   0, NULL,
   now() - interval '26 days', now() - interval '25 days', now() - interval '25 days');
```

---

## 9. Review Fixtures

| ID | Contract | Job | Reviewer | Reviewee | Role | Overall | Sub-ratings | Status | Notes |
|----|----------|-----|----------|----------|------|---------|-------------|--------|-------|
| `...501` | 303 | 105 | Irene (cust) | Henry (prov) | customer | 5 | Q:5 T:5 C:5 V:5 | published | Glowing review |
| `...502` | 303 | 105 | Henry (prov) | Irene (cust) | provider | 5 | PP:5 SA:5 A:5 | published | Glowing review |
| `...503` | 305 | 111 | Alice (cust) | Bob (prov) | customer | 4 | Q:4 T:4 C:5 V:3 | published | Good but pricey |
| `...504` | 305 | 111 | Bob (prov) | Alice (cust) | provider | 5 | PP:5 SA:5 A:5 | published | Great customer |
| `...505` | 304 | 106 | Dave (cust) | Eve (prov) | customer | 1 | Q:1 T:1 C:2 V:1 | published | Negative review |
| `...506` | 306 | 115 | Irene (cust) | Bob (prov) | customer | 3 | Q:3 T:3 C:3 V:3 | published | Mediocre |
| `...507` | 307 | 116 | Alice (cust) | Carol (prov) | customer | 5 | Q:5 T:5 C:5 V:5 | pending | Waiting for both reviews |

```sql
-- Fixture: reviews
INSERT INTO reviews (id, contract_id, job_id, reviewer_id, reviewee_id, reviewer_role,
                     overall_rating, quality_rating, timeliness_rating,
                     communication_rating, value_rating,
                     payment_promptness_rating, scope_accuracy_rating, access_rating,
                     review_text, status, published_at, review_window_ends)
VALUES
  -- 501: Irene reviews Henry on bathroom paint - glowing 5-star
  ('00000000-0000-0000-0000-000000000501',
   '00000000-0000-0000-0000-000000000303',
   '00000000-0000-0000-0000-000000000105',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000008',
   'customer',
   5, 5, 5, 5, 5,
   NULL, NULL, NULL,
   'Henry did an absolutely outstanding job on our master bathroom. The prep work was meticulous - he patched the drywall near the shower perfectly and the texture match is seamless. Two coats of Benjamin Moore White Dove and it looks brand new. He was punctual, communicative, and cleaned up everything when done. Highly recommend!',
   'published', now() - interval '14 days',
   now() - interval '1 day'),

  -- 502: Henry reviews Irene on bathroom paint - provider perspective
  ('00000000-0000-0000-0000-000000000502',
   '00000000-0000-0000-0000-000000000303',
   '00000000-0000-0000-0000-000000000105',
   '00000000-0000-0000-0000-000000000008',
   '00000000-0000-0000-0000-000000000009',
   'provider',
   5, NULL, NULL, NULL, NULL,
   5, 5, 5,
   'Excellent customer. Clear about what she wanted, easy access to the bathroom, and approved milestones promptly. Would gladly work with again.',
   'published', now() - interval '14 days',
   now() - interval '1 day'),

  -- 503: Alice reviews Bob on house cleaning - good but notes value
  ('00000000-0000-0000-0000-000000000503',
   '00000000-0000-0000-0000-000000000305',
   '00000000-0000-0000-0000-000000000111',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002',
   'customer',
   4, 4, 4, 5, 3,
   NULL, NULL, NULL,
   'Bob''s team did a solid job on the move-out clean. Kitchen appliances were spotless and bathrooms looked great. The carpet vacuuming could have been more thorough in the corners. Communication was excellent throughout. Price felt a bit high for the unit size but quality was good overall.',
   'published', now() - interval '22 days',
   now() - interval '10 days'),

  -- 504: Bob reviews Alice on house cleaning
  ('00000000-0000-0000-0000-000000000504',
   '00000000-0000-0000-0000-000000000305',
   '00000000-0000-0000-0000-000000000111',
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000001',
   'provider',
   5, NULL, NULL, NULL, NULL,
   5, 5, 5,
   'Great customer. Paid promptly, provided clear access instructions with lockbox code, and the scope was exactly as described. Easy to work with.',
   'published', now() - interval '22 days',
   now() - interval '10 days'),

  -- 505: Dave reviews Eve on roof repair - negative (disputed job)
  ('00000000-0000-0000-0000-000000000505',
   '00000000-0000-0000-0000-000000000304',
   '00000000-0000-0000-0000-000000000106',
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000005',
   'customer',
   1, 1, 1, 2, 1,
   NULL, NULL, NULL,
   'Terrible experience. Eve claimed to have fixed the chimney flashing but the roof still leaks in the exact same spot after the first rain. When I contacted her about it, she said the underlying problem was different from what she quoted and wanted to charge more. The original scope clearly covered the leak repair. Had to open a dispute. Would not recommend.',
   'published', now() - interval '10 days',
   now() - interval '4 days'),

  -- 506: Irene reviews Bob on recurring lawn - mediocre
  ('00000000-0000-0000-0000-000000000506',
   '00000000-0000-0000-0000-000000000306',
   '00000000-0000-0000-0000-000000000115',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000002',
   'customer',
   3, 3, 3, 3, 3,
   NULL, NULL, NULL,
   'Service was adequate but not exceptional. Lawn was mowed consistently but the edging was uneven in places. A few times the crew came later than the scheduled window. Not bad, just average. Might look for a dedicated landscaper next season.',
   'published', now() - interval '4 days',
   now() + interval '9 days'),

  -- 507: Alice reviews Carol on light fixture - pending (waiting for both)
  ('00000000-0000-0000-0000-000000000507',
   '00000000-0000-0000-0000-000000000307',
   '00000000-0000-0000-0000-000000000116',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000003',
   'customer',
   5, 5, 5, 5, 5,
   NULL, NULL, NULL,
   'Carol has been fantastic on the light fixture upgrade. The living room fixtures look amazing and the dimmer switches work perfectly. Still in progress on the dining room but already very impressed.',
   'pending', NULL,
   now() + interval '14 days');
```

### Review Responses

```sql
-- Fixture: review_responses
INSERT INTO review_responses (id, review_id, user_id, response_text)
VALUES
  -- Eve responds to Dave's negative review
  ('00000000-0000-0000-0000-000000000511',
   '00000000-0000-0000-0000-000000000505',
   '00000000-0000-0000-0000-000000000005',
   'The initial repair addressed the visible flashing issue. During the work, I discovered additional structural damage underneath that was not visible during the estimate. I offered to fix the underlying issue at a fair additional cost. The dispute is under review.');
```

---

## 10. Trust Score Fixtures

| ID | User | Role | Overall | Tier | Feedback | Volume | Risk | Fraud |
|----|------|------|---------|------|----------|--------|------|-------|
| `...601` | Alice | customer | 85.00 | trusted | 92.00 | 70.00 | 88.00 | 100.00 |
| `...602` | Bob | provider | 92.00 | top_rated | 95.00 | 90.00 | 92.00 | 100.00 |
| `...603` | Carol | provider | 75.00 | rising | 80.00 | 35.00 | 82.00 | 100.00 |
| `...604` | Dave | customer | 60.00 | rising | 55.00 | 40.00 | 70.00 | 95.00 |
| `...605` | Eve | provider | 30.00 | under_review | 25.00 | 30.00 | 15.00 | 8.00 |
| `...606` | Frank | customer | 50.00 | new | 50.00 | 0.00 | 0.00 | 100.00 |
| `...607` | Henry | provider | 88.00 | trusted | 90.00 | 75.00 | 88.00 | 100.00 |
| `...608` | Irene | customer | 70.00 | trusted | 72.00 | 55.00 | 80.00 | 100.00 |
| `...609` | Jake | provider | 50.00 | new | 50.00 | 0.00 | 20.00 | 100.00 |
| `...610` | Kate | provider | 80.00 | trusted | 82.00 | 60.00 | 85.00 | 100.00 |

```sql
-- Fixture: trust_scores
INSERT INTO trust_scores (id, user_id, role, overall_score, tier,
                          feedback_score, volume_score, risk_score, fraud_score,
                          feedback_details, volume_details, risk_details, fraud_details,
                          last_computed_at, computation_version)
VALUES
  -- Alice: trusted customer, 5 completed jobs
  ('00000000-0000-0000-0000-000000000601',
   '00000000-0000-0000-0000-000000000001',
   'customer', 85.00, 'trusted',
   92.00, 70.00, 88.00, 100.00,
   '{"star_avg": 4.8, "payment_promptness_avg": 5.0}',
   '{"completed": 5, "repeat_rate": 0.40, "tenure_months": 10}',
   '{"id_verified": true, "cancel_rate": 0.0, "dispute_rate": 0.0}',
   '{"account_flags": 0, "review_flags": 0, "txn_flags": 0, "behavior_flags": 0}',
   now() - interval '1 hour', 1),

  -- Bob: top_rated provider, 52 completed jobs
  ('00000000-0000-0000-0000-000000000602',
   '00000000-0000-0000-0000-000000000002',
   'provider', 92.00, 'top_rated',
   95.00, 90.00, 92.00, 100.00,
   '{"star_avg": 4.9, "value_avg": 4.5, "on_time_pct": 0.96, "communication_avg": 4.8}',
   '{"completed": 52, "repeat_rate": 0.35, "response_time_tier": "fast", "tenure_months": 24}',
   '{"id_verified": true, "biz_docs_count": 3, "insurance_verified": true, "cancel_rate": 0.02, "dispute_rate": 0.01}',
   '{"account_flags": 0, "review_flags": 0, "txn_flags": 0, "behavior_flags": 0}',
   now() - interval '30 minutes', 1),

  -- Carol: rising provider, 3 completed jobs
  ('00000000-0000-0000-0000-000000000603',
   '00000000-0000-0000-0000-000000000003',
   'provider', 75.00, 'rising',
   80.00, 35.00, 82.00, 100.00,
   '{"star_avg": 4.5, "value_avg": 4.3, "on_time_pct": 0.90, "communication_avg": 4.5}',
   '{"completed": 3, "repeat_rate": 0.0, "response_time_tier": "average", "tenure_months": 6}',
   '{"id_verified": true, "biz_docs_count": 1, "insurance_verified": false, "cancel_rate": 0.0, "dispute_rate": 0.0}',
   '{"account_flags": 0, "review_flags": 0, "txn_flags": 0, "behavior_flags": 0}',
   now() - interval '2 hours', 1),

  -- Dave: rising customer, has disputed a job
  ('00000000-0000-0000-0000-000000000604',
   '00000000-0000-0000-0000-000000000004',
   'customer', 60.00, 'rising',
   55.00, 40.00, 70.00, 95.00,
   '{"star_avg": 3.5, "payment_promptness_avg": 4.0}',
   '{"completed": 3, "repeat_rate": 0.0, "tenure_months": 8}',
   '{"id_verified": true, "cancel_rate": 0.0, "dispute_rate": 0.25}',
   '{"account_flags": 0, "review_flags": 0, "txn_flags": 0, "behavior_flags": 1}',
   now() - interval '3 hours', 1),

  -- Eve: under_review (suspended for fraud)
  ('00000000-0000-0000-0000-000000000605',
   '00000000-0000-0000-0000-000000000005',
   'provider', 30.00, 'under_review',
   25.00, 30.00, 15.00, 8.00,
   '{"star_avg": 2.5, "value_avg": 2.0, "on_time_pct": 0.55, "communication_avg": 3.0}',
   '{"completed": 8, "repeat_rate": 0.0, "response_time_tier": "slow", "tenure_months": 12}',
   '{"id_verified": true, "biz_docs_count": 0, "insurance_verified": false, "cancel_rate": 0.15, "dispute_rate": 0.35}',
   '{"account_flags": 4, "review_flags": 3, "txn_flags": 1, "behavior_flags": 3}',
   now() - interval '14 days', 1),

  -- Frank: new customer (just registered, no activity)
  ('00000000-0000-0000-0000-000000000606',
   '00000000-0000-0000-0000-000000000006',
   'customer', 50.00, 'new',
   50.00, 0.00, 0.00, 100.00,
   '{}',
   '{"completed": 0, "repeat_rate": 0.0, "tenure_months": 0}',
   '{"id_verified": false, "cancel_rate": 0.0, "dispute_rate": 0.0}',
   '{"account_flags": 0, "review_flags": 0, "txn_flags": 0, "behavior_flags": 0}',
   now() - interval '20 minutes', 1),

  -- Henry: trusted provider, 28 completed jobs, pro subscriber
  ('00000000-0000-0000-0000-000000000607',
   '00000000-0000-0000-0000-000000000008',
   'provider', 88.00, 'trusted',
   90.00, 75.00, 88.00, 100.00,
   '{"star_avg": 4.7, "value_avg": 4.6, "on_time_pct": 0.94, "communication_avg": 4.8}',
   '{"completed": 28, "repeat_rate": 0.25, "response_time_tier": "fast", "tenure_months": 16}',
   '{"id_verified": true, "biz_docs_count": 2, "insurance_verified": true, "cancel_rate": 0.03, "dispute_rate": 0.0}',
   '{"account_flags": 0, "review_flags": 0, "txn_flags": 0, "behavior_flags": 0}',
   now() - interval '1 hour', 1),

  -- Irene: trusted customer, multiple active jobs
  ('00000000-0000-0000-0000-000000000608',
   '00000000-0000-0000-0000-000000000009',
   'customer', 70.00, 'trusted',
   72.00, 55.00, 80.00, 100.00,
   '{"star_avg": 4.0, "payment_promptness_avg": 4.5}',
   '{"completed": 4, "repeat_rate": 0.25, "tenure_months": 7}',
   '{"id_verified": true, "cancel_rate": 0.10, "dispute_rate": 0.0}',
   '{"account_flags": 0, "review_flags": 0, "txn_flags": 0, "behavior_flags": 0}',
   now() - interval '2 hours', 1),

  -- Jake: new provider, pending verification
  ('00000000-0000-0000-0000-000000000609',
   '00000000-0000-0000-0000-000000000010',
   'provider', 50.00, 'new',
   50.00, 0.00, 20.00, 100.00,
   '{}',
   '{"completed": 0, "repeat_rate": 0.0, "response_time_tier": "unknown", "tenure_months": 1}',
   '{"id_verified": false, "biz_docs_count": 0, "insurance_verified": false, "cancel_rate": 0.0, "dispute_rate": 0.0}',
   '{"account_flags": 0, "review_flags": 0, "txn_flags": 0, "behavior_flags": 0}',
   now() - interval '3 days', 1),

  -- Kate: trusted provider, dual-role, HVAC specialist
  ('00000000-0000-0000-0000-000000000610',
   '00000000-0000-0000-0000-000000000012',
   'provider', 80.00, 'trusted',
   82.00, 60.00, 85.00, 100.00,
   '{"star_avg": 4.6, "value_avg": 4.5, "on_time_pct": 0.93, "communication_avg": 4.7}',
   '{"completed": 15, "repeat_rate": 0.20, "response_time_tier": "average", "tenure_months": 14}',
   '{"id_verified": true, "biz_docs_count": 2, "insurance_verified": true, "cancel_rate": 0.02, "dispute_rate": 0.0}',
   '{"account_flags": 0, "review_flags": 0, "txn_flags": 0, "behavior_flags": 0}',
   now() - interval '4 hours', 1);
```

### Trust Score History

```sql
-- Fixture: trust_score_history (selected entries showing score changes)
INSERT INTO trust_score_history (id, user_id, role, overall_score,
                                  feedback_score, volume_score, risk_score, fraud_score,
                                  trigger_event, trigger_entity_id)
VALUES
  -- Eve's score declined after fraud signals
  ('00000000-0000-0000-0000-000000000611',
   '00000000-0000-0000-0000-000000000005',
   'provider', 65.00, 55.00, 30.00, 50.00, 80.00,
   'fraud_signal', '00000000-0000-0000-0000-000000000901'),

  ('00000000-0000-0000-0000-000000000612',
   '00000000-0000-0000-0000-000000000005',
   'provider', 30.00, 25.00, 30.00, 15.00, 8.00,
   'fraud_signal', '00000000-0000-0000-0000-000000000902');
```

---

## 11. Chat Channel & Message Fixtures

| ID | Job | Customer | Provider | Type | Status | Messages |
|----|-----|----------|----------|------|--------|----------|
| `...701` | 101 (leaky_faucet) | Alice | Bob | bid | active | 4 messages |
| `...702` | 116 (light_fixture) | Alice | Carol | contract | active | 3 messages |
| `...703` | 106 (roof_repair) | Dave | Eve | contract | active | 5 messages (dispute) |
| `...704` | 104 (electrical_panel) | Dave | Carol | contract | active | 3 messages |
| `...705` | 117 (hvac_repair) | Dave | Kate | bid | active | 2 messages |

```sql
-- Fixture: chat_channels
INSERT INTO chat_channels (id, job_id, customer_id, provider_id,
                           status, channel_type,
                           customer_last_read_at, provider_last_read_at,
                           last_message_at, message_count)
VALUES
  -- 701: Alice <-> Bob on leaky faucet (bidding)
  ('00000000-0000-0000-0000-000000000701',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000002',
   'active', 'bid',
   now() - interval '2 hours', now() - interval '1 hour',
   now() - interval '1 hour', 4),

  -- 702: Alice <-> Carol on light fixture (contract)
  ('00000000-0000-0000-0000-000000000702',
   '00000000-0000-0000-0000-000000000116',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000003',
   'active', 'contract',
   now() - interval '6 hours', now() - interval '4 hours',
   now() - interval '4 hours', 3),

  -- 703: Dave <-> Eve on roof repair (dispute evidence)
  ('00000000-0000-0000-0000-000000000703',
   '00000000-0000-0000-0000-000000000106',
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000005',
   'active', 'contract',
   now() - interval '1 day', now() - interval '3 days',
   now() - interval '1 day', 5),

  -- 704: Dave <-> Carol on electrical panel (contract)
  ('00000000-0000-0000-0000-000000000704',
   '00000000-0000-0000-0000-000000000104',
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000003',
   'active', 'contract',
   now() - interval '12 hours', now() - interval '8 hours',
   now() - interval '8 hours', 3),

  -- 705: Dave <-> Kate on hvac repair (bidding)
  ('00000000-0000-0000-0000-000000000705',
   '00000000-0000-0000-0000-000000000117',
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000012',
   'active', 'bid',
   now() - interval '4 hours', now() - interval '3 hours',
   now() - interval '3 hours', 2);

-- Fixture: chat_messages
INSERT INTO chat_messages (id, channel_id, sender_id, message_type, content,
                           attachment_url, attachment_name, attachment_type, attachment_size,
                           flagged_contact_info, created_at)
VALUES
  -- Channel 701: Alice <-> Bob, bidding on leaky faucet
  ('00000000-0000-0000-0000-000000000711',
   '00000000-0000-0000-0000-000000000701',
   '00000000-0000-0000-0000-000000000001',
   'text', 'Hi Bob, thanks for bidding on the faucet repair. Quick question - do you have experience with Moen pull-down sprayers specifically?',
   NULL, NULL, NULL, NULL, false,
   now() - interval '20 hours'),

  ('00000000-0000-0000-0000-000000000712',
   '00000000-0000-0000-0000-000000000701',
   '00000000-0000-0000-0000-000000000002',
   'text', 'Absolutely! I''ve replaced dozens of Moen sprayers. They usually leak at the base due to worn O-rings. 90% of the time it''s a simple cartridge swap rather than a full replacement. I carry most Moen parts in my truck.',
   NULL, NULL, NULL, NULL, false,
   now() - interval '18 hours'),

  ('00000000-0000-0000-0000-000000000713',
   '00000000-0000-0000-0000-000000000701',
   '00000000-0000-0000-0000-000000000001',
   'text', 'That''s great to hear. Here''s a photo of the leak under the sink.',
   NULL, NULL, NULL, NULL, false,
   now() - interval '4 hours'),

  ('00000000-0000-0000-0000-000000000714',
   '00000000-0000-0000-0000-000000000701',
   '00000000-0000-0000-0000-000000000001',
   'image', NULL,
   'https://cdn.test.com/chat/701-undersink-photo.jpg', 'undersink-photo.jpg', 'image/jpeg', 1850000,
   false,
   now() - interval '4 hours'),

  -- Channel 702: Alice <-> Carol, contract for light fixtures
  ('00000000-0000-0000-0000-000000000721',
   '00000000-0000-0000-0000-000000000702',
   '00000000-0000-0000-0000-000000000003',
   'text', 'Living room fixtures are all installed and tested. Everything working great with the dimmers! I''ve submitted the first milestone for your review.',
   NULL, NULL, NULL, NULL, false,
   now() - interval '5 days'),

  ('00000000-0000-0000-0000-000000000722',
   '00000000-0000-0000-0000-000000000702',
   '00000000-0000-0000-0000-000000000001',
   'text', 'They look amazing, thank you! Just approved the first milestone. When can you start on the dining room?',
   NULL, NULL, NULL, NULL, false,
   now() - interval '4 days'),

  ('00000000-0000-0000-0000-000000000723',
   '00000000-0000-0000-0000-000000000702',
   '00000000-0000-0000-0000-000000000003',
   'text', 'I can start the dining room fixtures this Thursday morning if that works for you. Should take about 3 hours.',
   NULL, NULL, NULL, NULL, false,
   now() - interval '4 hours'),

  -- Channel 703: Dave <-> Eve, disputed roof repair
  ('00000000-0000-0000-0000-000000000731',
   '00000000-0000-0000-0000-000000000703',
   '00000000-0000-0000-0000-000000000005',
   'text', 'I''ve completed the chimney flashing repair. New step flashing installed and all joints sealed with roofing cement.',
   NULL, NULL, NULL, NULL, false,
   now() - interval '10 days'),

  ('00000000-0000-0000-0000-000000000732',
   '00000000-0000-0000-0000-000000000703',
   '00000000-0000-0000-0000-000000000004',
   'text', 'Eve, it rained last night and the roof is still leaking in the exact same spot. The ceiling has a new water stain. This was not fixed.',
   NULL, NULL, NULL, NULL, false,
   now() - interval '8 days'),

  ('00000000-0000-0000-0000-000000000733',
   '00000000-0000-0000-0000-000000000703',
   '00000000-0000-0000-0000-000000000005',
   'text', 'That might be from a different source. The flashing was definitely the issue I addressed. There may be additional problems with the chimney crown or cricket. That would be separate work.',
   NULL, NULL, NULL, NULL, false,
   now() - interval '7 days'),

  ('00000000-0000-0000-0000-000000000734',
   '00000000-0000-0000-0000-000000000703',
   '00000000-0000-0000-0000-000000000004',
   'text', 'The scope of work says "fix roof leak around chimney." It''s still leaking. I''m not paying $3,800 for work that didn''t solve the problem. I''m opening a dispute.',
   NULL, NULL, NULL, NULL, false,
   now() - interval '5 days'),

  ('00000000-0000-0000-0000-000000000735',
   '00000000-0000-0000-0000-000000000703',
   '00000000-0000-0000-0000-000000000004',
   'system', 'Dave Martinez opened a dispute: Incomplete work - roof still leaking after repair.',
   NULL, NULL, NULL, NULL, false,
   now() - interval '3 days'),

  -- Channel 704: Dave <-> Carol, electrical panel contract
  ('00000000-0000-0000-0000-000000000741',
   '00000000-0000-0000-0000-000000000704',
   '00000000-0000-0000-0000-000000000003',
   'text', 'Permit is approved and I''ve got the 200A Square D panel in stock. Ready to start the panel swap this week. The city inspection is scheduled for next Wednesday.',
   NULL, NULL, NULL, NULL, false,
   now() - interval '5 days'),

  ('00000000-0000-0000-0000-000000000742',
   '00000000-0000-0000-0000-000000000704',
   '00000000-0000-0000-0000-000000000004',
   'text', 'Sounds good! I''ll make sure the main breaker is accessible. Do I need to be home during the swap?',
   NULL, NULL, NULL, NULL, false,
   now() - interval '4 days'),

  ('00000000-0000-0000-0000-000000000743',
   '00000000-0000-0000-0000-000000000704',
   '00000000-0000-0000-0000-000000000003',
   'text', 'You don''t need to be home, but power will be off for about 4-5 hours during the swap. I''ll text you before I cut power and when it''s back on.',
   NULL, NULL, NULL, NULL, false,
   now() - interval '8 hours'),

  -- Channel 705: Dave <-> Kate, bidding on hvac repair
  ('00000000-0000-0000-0000-000000000751',
   '00000000-0000-0000-0000-000000000705',
   '00000000-0000-0000-0000-000000000004',
   'text', 'Hi Kate, the AC unit is icing up on the outdoor coils. Any idea what the most common cause is for a 5-year-old Carrier?',
   NULL, NULL, NULL, NULL, false,
   now() - interval '6 hours'),

  ('00000000-0000-0000-0000-000000000752',
   '00000000-0000-0000-0000-000000000705',
   '00000000-0000-0000-0000-000000000012',
   'text', 'With a 5-year-old Carrier unit and icing, it''s usually low refrigerant (from a slow leak) or a dirty evaporator coil. Both are straightforward fixes. My bid includes full diagnosis, refrigerant top-off if needed, and coil cleaning. If it turns out to be a compressor issue, I''d provide a separate quote.',
   NULL, NULL, NULL, NULL, false,
   now() - interval '3 hours');
```

---

## 12. Notification Fixtures

```sql
-- Fixture: notifications
INSERT INTO notifications (id, user_id, notification_type, title, body,
                           action_url, entity_type, entity_id,
                           channels, email_sent, push_sent, read, read_at, created_at)
VALUES
  -- Alice: new bid on leaky faucet (from Bob)
  ('00000000-0000-0000-0000-000000000801',
   '00000000-0000-0000-0000-000000000001',
   'new_bid', 'New bid on your faucet repair job',
   'Bob''s Plumbing bid $250 on "Leaky Kitchen Faucet Repair".',
   '/dashboard/jobs/00000000-0000-0000-0000-000000000101/bids',
   'bid', '00000000-0000-0000-0000-000000000201',
   '{in_app,email}', true, false, true, now() - interval '18 hours',
   now() - interval '20 hours'),

  -- Alice: bid lowered notification
  ('00000000-0000-0000-0000-000000000802',
   '00000000-0000-0000-0000-000000000001',
   'bid_updated', 'Bid lowered on your faucet repair job',
   'Bob''s Plumbing lowered their bid to $250 on "Leaky Kitchen Faucet Repair".',
   '/dashboard/jobs/00000000-0000-0000-0000-000000000101/bids',
   'bid', '00000000-0000-0000-0000-000000000201',
   '{in_app}', false, false, false, NULL,
   now() - interval '6 hours'),

  -- Alice: milestone submitted for approval (light fixtures)
  ('00000000-0000-0000-0000-000000000803',
   '00000000-0000-0000-0000-000000000001',
   'milestone_submitted', 'Milestone completed - review needed',
   'Carol''s Electric submitted milestone "Install living room light fixtures" for your approval.',
   '/dashboard/contracts/00000000-0000-0000-0000-000000000307',
   'contract', '00000000-0000-0000-0000-000000000307',
   '{in_app,email}', true, false, true, now() - interval '4 days',
   now() - interval '5 days'),

  -- Carol: bid awarded notification (light fixtures)
  ('00000000-0000-0000-0000-000000000804',
   '00000000-0000-0000-0000-000000000003',
   'bid_awarded', 'Your bid was accepted!',
   'Alice Johnson accepted your bid for "Living Room Light Fixture Upgrade".',
   '/dashboard/contracts/00000000-0000-0000-0000-000000000307',
   'contract', '00000000-0000-0000-0000-000000000307',
   '{in_app,email,web_push}', true, true, true, now() - interval '9 days',
   now() - interval '10 days'),

  -- Carol: payment received (light fixture milestone 1)
  ('00000000-0000-0000-0000-000000000805',
   '00000000-0000-0000-0000-000000000003',
   'payment_received', 'Payment received - $441.75',
   'You received $441.75 for milestone "Install living room light fixtures".',
   '/dashboard/payments',
   'payment', '00000000-0000-0000-0000-000000000411',
   '{in_app,email}', true, false, true, now() - interval '3 days',
   now() - interval '4 days'),

  -- Dave: dispute opened confirmation (roof repair)
  ('00000000-0000-0000-0000-000000000806',
   '00000000-0000-0000-0000-000000000004',
   'dispute_opened', 'Dispute submitted',
   'Your dispute for "Roof Leak Repair - Chimney Flashing" has been submitted and is under review.',
   '/dashboard/disputes/00000000-0000-0000-0000-000000000951',
   'contract', '00000000-0000-0000-0000-000000000304',
   '{in_app,email}', true, false, true, now() - interval '3 days',
   now() - interval '3 days'),

  -- Eve: dispute notification (roof repair)
  ('00000000-0000-0000-0000-000000000807',
   '00000000-0000-0000-0000-000000000005',
   'dispute_opened', 'A dispute has been opened against you',
   'Dave Martinez opened a dispute on "Roof Leak Repair - Chimney Flashing": Incomplete work.',
   '/dashboard/disputes/00000000-0000-0000-0000-000000000951',
   'contract', '00000000-0000-0000-0000-000000000304',
   '{in_app,email,web_push}', true, true, false, NULL,
   now() - interval '3 days'),

  -- Irene: review received from Henry
  ('00000000-0000-0000-0000-000000000808',
   '00000000-0000-0000-0000-000000000009',
   'review_received', 'New review received',
   'Henry''s Painting left you a 5-star review on "Master Bathroom Repaint".',
   '/dashboard/reviews',
   'review', '00000000-0000-0000-0000-000000000502',
   '{in_app}', false, false, true, now() - interval '13 days',
   now() - interval '14 days'),

  -- Frank: welcome notification
  ('00000000-0000-0000-0000-000000000809',
   '00000000-0000-0000-0000-000000000006',
   'welcome', 'Welcome to NoMarkup!',
   'Post your first job and get competitive bids from verified providers in your area.',
   '/dashboard/jobs/new',
   NULL, NULL,
   '{in_app,email}', true, false, false, NULL,
   now() - interval '20 minutes'),

  -- Grace (admin): fraud alert for Eve
  ('00000000-0000-0000-0000-000000000810',
   '00000000-0000-0000-0000-000000000007',
   'fraud_alert', 'High-severity fraud signal detected',
   'Eve''s Home Services (eve@example.com) has 4 pending fraud signals including bid manipulation and multiple accounts.',
   '/admin/fraud/00000000-0000-0000-0000-000000000005',
   'user', '00000000-0000-0000-0000-000000000005',
   '{in_app,email}', true, false, true, now() - interval '13 days',
   now() - interval '14 days'),

  -- Support: dispute assigned
  ('00000000-0000-0000-0000-000000000811',
   '00000000-0000-0000-0000-000000000011',
   'dispute_assigned', 'New dispute assigned to you',
   'Dispute for "Roof Leak Repair - Chimney Flashing" needs review. Customer reports work incomplete.',
   '/admin/disputes/00000000-0000-0000-0000-000000000951',
   'contract', '00000000-0000-0000-0000-000000000304',
   '{in_app,email}', true, false, false, NULL,
   now() - interval '2 days'),

  -- Bob: new message notification (from Alice in chat)
  ('00000000-0000-0000-0000-000000000812',
   '00000000-0000-0000-0000-000000000002',
   'message_received', 'New message from Alice Johnson',
   'Alice Johnson sent you a message about "Leaky Kitchen Faucet Repair".',
   '/dashboard/chat/00000000-0000-0000-0000-000000000701',
   'chat', '00000000-0000-0000-0000-000000000701',
   '{in_app}', false, false, true, now() - interval '3 hours',
   now() - interval '4 hours'),

  -- Dave: contract started (electrical panel)
  ('00000000-0000-0000-0000-000000000813',
   '00000000-0000-0000-0000-000000000004',
   'contract_started', 'Work has started on your electrical panel',
   'Carol''s Electric has started work on "Electrical Panel Upgrade to 200A".',
   '/dashboard/contracts/00000000-0000-0000-0000-000000000302',
   'contract', '00000000-0000-0000-0000-000000000302',
   '{in_app,email}', true, false, true, now() - interval '9 days',
   now() - interval '10 days'),

  -- Irene: job cancelled confirmation (deck staining)
  ('00000000-0000-0000-0000-000000000814',
   '00000000-0000-0000-0000-000000000009',
   'job_cancelled', 'Job cancelled',
   'Your job "Deck Staining - Cedar Deck" has been cancelled.',
   '/dashboard/jobs/00000000-0000-0000-0000-000000000107',
   'job', '00000000-0000-0000-0000-000000000107',
   '{in_app}', false, false, true, now() - interval '7 days',
   now() - interval '7 days'),

  -- Grace: system announcement
  ('00000000-0000-0000-0000-000000000815',
   '00000000-0000-0000-0000-000000000007',
   'system_announcement', 'Platform update: New dispute SLA policy',
   'Dispute first-response SLA has been updated to 24 hours. See admin dashboard for details.',
   '/admin/settings',
   NULL, NULL,
   '{in_app}', false, false, false, NULL,
   now() - interval '1 day');
```

---

## 13. Fraud Signal Fixtures

Signals for Eve (`eve_provider`, the suspended user):

| ID | User | Signal Type | Subtype | Severity | Confidence | Status |
|----|------|-------------|---------|----------|------------|--------|
| `...901` | Eve | bid_manipulation | suspicious_bid_pattern | high | 0.92 | confirmed |
| `...902` | Eve | review_manipulation | review_ring | medium | 0.78 | confirmed |
| `...903` | Eve | account_fraud | shared_ip | low | 0.55 | actioned |
| `...904` | Eve | account_fraud | multiple_accounts | high | 0.88 | confirmed |
| `...905` | Eve | bad_actor_behavior | scope_bait_and_switch | medium | 0.72 | pending |
| `...906` | Eve | review_manipulation | burst_reviews | medium | 0.65 | dismissed |

```sql
-- Fixture: fraud_signals
INSERT INTO fraud_signals (id, user_id, signal_type, signal_subtype, severity, confidence,
                           description, evidence_json, related_user_ids,
                           related_entity_id, related_entity_type,
                           status, action_taken, reviewed_by, reviewed_at,
                           auto_actioned, auto_action)
VALUES
  -- 901: Bid manipulation (high severity) - confirmed
  ('00000000-0000-0000-0000-000000000901',
   '00000000-0000-0000-0000-000000000005',
   'bid_manipulation', 'suspicious_bid_pattern', 'high', 0.92,
   'Provider placed 15 bids in 5 minutes across unrelated categories with identical pricing multiplier patterns. Bid amounts consistently 85% of starting bid across all categories, suggesting automated tooling.',
   '{"bid_count_window": 15, "window_minutes": 5, "categories": ["plumbing", "electrical", "hvac", "roofing", "painting"], "price_variance": 0.01, "pattern": "identical_multiplier_0.85", "device_fingerprint": "fp_abc123"}',
   NULL, NULL, NULL,
   'confirmed', 'suspended',
   '00000000-0000-0000-0000-000000000007',
   now() - interval '14 days',
   false, NULL),

  -- 902: Review ring (medium severity) - confirmed
  ('00000000-0000-0000-0000-000000000902',
   '00000000-0000-0000-0000-000000000005',
   'review_manipulation', 'review_ring', 'medium', 0.78,
   'Provider received 5 five-star reviews from accounts sharing 3 device fingerprints. Two reviewer accounts were created within 24 hours of leaving reviews. All reviews contain similar phrasing patterns.',
   '{"shared_fingerprints": 3, "new_accounts_as_reviewers": 2, "avg_review_time_after_signup_hours": 4.2, "all_five_star": true, "phrase_similarity_score": 0.85, "suspicious_reviewer_ids": ["f1a2b3c4-...", "d5e6f7a8-..."]}',
   NULL, NULL, 'review',
   'confirmed', 'review_removed',
   '00000000-0000-0000-0000-000000000007',
   now() - interval '14 days',
   false, NULL),

  -- 903: Shared IP (low severity) - auto-actioned warning
  ('00000000-0000-0000-0000-000000000903',
   '00000000-0000-0000-0000-000000000005',
   'account_fraud', 'shared_ip', 'low', 0.55,
   'Provider account shares IP address 203.0.113.42 with 2 other provider accounts in overlapping service areas. All accounts registered within a 3-day window.',
   '{"shared_ip": "203.0.113.42", "matching_accounts": 2, "same_service_area": true, "ip_type": "residential", "registration_window_days": 3}',
   NULL, NULL, NULL,
   'actioned', 'warned',
   NULL, NULL,
   true, 'warned'),

  -- 904: Multiple accounts (high severity) - confirmed
  ('00000000-0000-0000-0000-000000000904',
   '00000000-0000-0000-0000-000000000005',
   'account_fraud', 'multiple_accounts', 'high', 0.88,
   'Device fingerprint analysis confirms 3 provider accounts operated from the same browser environment. Canvas, WebGL, and audio fingerprints match with 99.2% confidence. Accounts bid on the same jobs to create appearance of competition.',
   '{"matching_fingerprint_hash": "fp_abc123", "account_count": 3, "fingerprint_confidence": 0.992, "shared_jobs_bid_on": 8, "canvas_match": true, "webgl_match": true, "audio_match": true}',
   NULL, NULL, NULL,
   'confirmed', 'suspended',
   '00000000-0000-0000-0000-000000000007',
   now() - interval '14 days',
   false, NULL),

  -- 905: Scope bait-and-switch behavior (medium severity) - pending review
  ('00000000-0000-0000-0000-000000000905',
   '00000000-0000-0000-0000-000000000005',
   'bad_actor_behavior', 'scope_bait_and_switch', 'medium', 0.72,
   'Pattern detected: Provider consistently bids low, then requests additional payment after work begins claiming unforeseen issues. 4 of 8 completed jobs had change order requests averaging 40% above original bid.',
   '{"jobs_with_upsell": 4, "total_jobs": 8, "avg_upsell_percentage": 0.40, "dispute_count": 3, "customer_complaints": 2}',
   NULL,
   '00000000-0000-0000-0000-000000000106', 'job',
   'pending', NULL,
   NULL, NULL,
   false, NULL),

  -- 906: Burst reviews (medium severity) - dismissed (false positive)
  ('00000000-0000-0000-0000-000000000906',
   '00000000-0000-0000-0000-000000000005',
   'review_manipulation', 'burst_reviews', 'medium', 0.65,
   'Received 3 reviews within 2 hours. Flagged as potential coordinated review burst.',
   '{"review_count_window": 3, "window_hours": 2, "all_positive": true}',
   NULL, NULL, 'review',
   'dismissed', NULL,
   '00000000-0000-0000-0000-000000000007',
   now() - interval '20 days',
   false, NULL);
```

---

## 14. Dispute Fixtures

| ID | Contract | Job | Opened By | Type | Status | Notes |
|----|----------|-----|-----------|------|--------|-------|
| `...951` | 304 (roof_repair) | 106 | Dave | incomplete_work | open | Active dispute, Eve's roof repair |
| `...952` | 305 (house_cleaning) | 111 | Alice | quality | resolved | Resolved in Alice's favor |
| `...953` | 303 (bathroom_paint) | 105 | Irene | scope_disagreement | closed | Dismissed, Irene withdrew |

```sql
-- Fixture: disputes
INSERT INTO disputes (id, contract_id, opened_by,
                      dispute_type, description, evidence_urls,
                      status, resolution_type, resolution_notes, refund_amount_cents,
                      resolved_by, first_response_at, resolved_at,
                      is_guarantee_claim, guarantee_outcome)
VALUES
  -- 951: Active dispute - Dave vs Eve on roof repair (open)
  ('00000000-0000-0000-0000-000000000951',
   '00000000-0000-0000-0000-000000000304',
   '00000000-0000-0000-0000-000000000004',
   'incomplete_work',
   'Provider claimed to fix chimney flashing leak but roof still leaks in the exact same location after the first rain. Provider now says the underlying problem is different and wants additional payment. Original scope explicitly states "fix roof leak around chimney." Paid full amount of $3,800 upfront. Requesting full refund.',
   '{"https://cdn.test.com/evidence/dispute-951-ceiling-stain.jpg", "https://cdn.test.com/evidence/dispute-951-chimney-exterior.jpg", "https://cdn.test.com/evidence/dispute-951-video-leak.mp4"}',
   'open', NULL, NULL, NULL,
   NULL, NULL, NULL,
   false, NULL),

  -- 952: Resolved dispute - Alice on house cleaning (resolved, partial refund)
  ('00000000-0000-0000-0000-000000000952',
   '00000000-0000-0000-0000-000000000305',
   '00000000-0000-0000-0000-000000000001',
   'quality',
   'Cleaning service did not meet the expected standard. Kitchen appliances were cleaned but carpet corners were missed and windows had streaks. Photos attached showing missed areas.',
   '{"https://cdn.test.com/evidence/dispute-952-carpet-corner.jpg", "https://cdn.test.com/evidence/dispute-952-window-streaks.jpg"}',
   'resolved', 'partial_refund',
   'After review of evidence and chat history, a 25% partial refund was deemed appropriate. Provider acknowledged the carpet corners were missed. Customer satisfied with resolution.',
   5000,
   '00000000-0000-0000-0000-000000000011',
   now() - interval '21 days', now() - interval '19 days',
   false, NULL),

  -- 953: Closed/dismissed dispute - Irene on bathroom paint (Irene withdrew)
  ('00000000-0000-0000-0000-000000000953',
   '00000000-0000-0000-0000-000000000303',
   '00000000-0000-0000-0000-000000000009',
   'scope_disagreement',
   'Paint color appears slightly different from the Benjamin Moore White Dove OC-17 I specified.',
   '{}',
   'closed', 'dismissed',
   'Customer withdrew dispute after provider demonstrated the correct paint was used. Color difference was due to bathroom lighting. Customer satisfied after viewing color in daylight.',
   0,
   '00000000-0000-0000-0000-000000000011',
   now() - interval '14 days', now() - interval '13 days',
   false, NULL);
```

---

## 15. Subscription Fixtures

### Subscription Tiers

```sql
-- Fixture: subscription_tiers
INSERT INTO subscription_tiers (id, name, role, price_cents,
                                 max_active_jobs, max_bids_per_month,
                                 features_json, trial_days,
                                 stripe_price_id, active)
VALUES
  -- Free customer tier
  ('00000000-0000-0000-0000-000000000971',
   'free_customer', 'customer', 0,
   1, NULL,
   '{"analytics": false, "priority_support": false, "instant_matching": false}',
   0, NULL, true),

  -- Pro customer tier ($19.99/month)
  ('00000000-0000-0000-0000-000000000972',
   'pro_customer', 'customer', 1999,
   NULL, NULL,
   '{"analytics": true, "priority_support": true, "instant_matching": true, "multi_property": true}',
   14, 'price_test_pro_customer', true),

  -- Free provider tier
  ('00000000-0000-0000-0000-000000000973',
   'free_provider', 'provider', 0,
   NULL, 5,
   '{"analytics": false, "priority_placement": false, "badge": false}',
   0, NULL, true),

  -- Pro provider tier ($49.99/month)
  ('00000000-0000-0000-0000-000000000974',
   'pro_provider', 'provider', 4999,
   NULL, NULL,
   '{"analytics": true, "priority_placement": true, "badge": true, "instant_eligible": true}',
   14, 'price_test_pro_provider', true);
```

### User Subscriptions

| ID | User | Tier | Status | Notes |
|----|------|------|--------|-------|
| `...961` | Alice | pro_customer | active | Active Pro, paying monthly |
| `...962` | Bob | pro_provider | active | Active Pro, paying monthly |
| `...963` | Carol | free_provider | active | Free tier |
| `...964` | Dave | free_customer | active | Free tier |
| `...965` | Henry | pro_provider | active | Active Pro, paying monthly |
| `...966` | Irene | pro_customer | active | Active Pro |
| `...967` | Jake | free_provider | active | Free tier |
| `...968` | Kate | pro_provider | expired | Expired subscription |
| `...969` | Eve | free_provider | cancelled | Cancelled (suspended user) |
| `...970` | Frank | free_customer | active | Free tier |

```sql
-- Fixture: subscriptions
INSERT INTO subscriptions (id, user_id, tier_id,
                           stripe_subscription_id, stripe_customer_id,
                           status, trial_ends_at,
                           current_period_start, current_period_end,
                           cancelled_at, expires_at,
                           active_jobs_count, bids_this_month, bids_month_reset)
VALUES
  -- Alice: Pro Customer (active, paid)
  ('00000000-0000-0000-0000-000000000961',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000972',
   'sub_test_alice', 'cus_test_alice',
   'active', NULL,
   now() - interval '15 days', now() + interval '15 days',
   NULL, NULL,
   4, 0, CURRENT_DATE),

  -- Bob: Pro Provider (active, paid)
  ('00000000-0000-0000-0000-000000000962',
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000974',
   'sub_test_bob', 'cus_test_bob',
   'active', NULL,
   now() - interval '10 days', now() + interval '20 days',
   NULL, NULL,
   0, 12, CURRENT_DATE),

  -- Carol: Free Provider
  ('00000000-0000-0000-0000-000000000963',
   '00000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000973',
   NULL, NULL,
   'active', NULL,
   now() - interval '60 days', now() + interval '300 days',
   NULL, NULL,
   0, 3, CURRENT_DATE),

  -- Dave: Free Customer
  ('00000000-0000-0000-0000-000000000964',
   '00000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000971',
   NULL, NULL,
   'active', NULL,
   now() - interval '30 days', now() + interval '330 days',
   NULL, NULL,
   1, 0, CURRENT_DATE),

  -- Henry: Pro Provider (active, paid)
  ('00000000-0000-0000-0000-000000000965',
   '00000000-0000-0000-0000-000000000008',
   '00000000-0000-0000-0000-000000000974',
   'sub_test_henry', 'cus_test_henry',
   'active', NULL,
   now() - interval '5 days', now() + interval '25 days',
   NULL, NULL,
   0, 8, CURRENT_DATE),

  -- Irene: Pro Customer (active)
  ('00000000-0000-0000-0000-000000000966',
   '00000000-0000-0000-0000-000000000009',
   '00000000-0000-0000-0000-000000000972',
   'sub_test_irene', 'cus_test_irene',
   'active', NULL,
   now() - interval '20 days', now() + interval '10 days',
   NULL, NULL,
   3, 0, CURRENT_DATE),

  -- Jake: Free Provider
  ('00000000-0000-0000-0000-000000000967',
   '00000000-0000-0000-0000-000000000010',
   '00000000-0000-0000-0000-000000000973',
   NULL, NULL,
   'active', NULL,
   now() - interval '3 days', now() + interval '357 days',
   NULL, NULL,
   0, 1, CURRENT_DATE),

  -- Kate: Pro Provider (expired)
  ('00000000-0000-0000-0000-000000000968',
   '00000000-0000-0000-0000-000000000012',
   '00000000-0000-0000-0000-000000000974',
   'sub_test_kate', 'cus_test_kate',
   'expired', NULL,
   now() - interval '45 days', now() - interval '15 days',
   NULL, now() - interval '15 days',
   0, 0, CURRENT_DATE),

  -- Eve: Free Provider (cancelled due to suspension)
  ('00000000-0000-0000-0000-000000000969',
   '00000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000973',
   NULL, NULL,
   'cancelled', NULL,
   now() - interval '90 days', now() - interval '14 days',
   now() - interval '14 days', NULL,
   0, 0, CURRENT_DATE),

  -- Frank: Free Customer (just registered)
  ('00000000-0000-0000-0000-000000000970',
   '00000000-0000-0000-0000-000000000006',
   '00000000-0000-0000-0000-000000000971',
   NULL, NULL,
   'active', NULL,
   now() - interval '20 minutes', now() + interval '365 days',
   NULL, NULL,
   0, 0, CURRENT_DATE);
```

---

## 16. Named Scenario Scripts

Each scenario below is a self-contained description of what data to load and in what order.
The SQL for each entity is defined in the sections above; scenarios compose those entities
into coherent end-to-end test setups.

### Scenario 1: Happy Path -- Job to Completion

**Use case**: Testing the complete lifecycle from posting through reviews.

**Steps**:
1. Alice posts job 105 (bathroom paint) -- status: `active`
2. Henry bids $420 (bid 211) -- status: `active`
3. Kate bids $450 (bid 212) -- status: `active`
4. Bidding closes -- job status: `closed`
5. Alice awards Henry (bid 211 `awarded`, bid 212 `not_selected`) -- job status: `awarded`
6. Contract 303 created, both accept -- status: `active`
7. Henry starts milestone 313 (prep) -- milestone status: `in_progress`
8. Henry submits milestone 313 -- milestone status: `submitted`, then `approved`
9. Payment 403 moves through `pending` -> `escrow` -> `released` -> `completed`
10. Henry completes milestone 314, then 315 -- same payment flow
11. Contract 303 status: `completed`, job 105 status: `completed`
12. Irene reviews Henry (review 501, 5 stars) -- status: `pending`
13. Henry reviews Irene (review 502, 5 stars) -- both become `published`
14. Trust scores updated for both users

**Fixtures needed**: Users (Alice/Irene, Henry, Kate, Grace), properties (034), job 105, bids 211-212, contract 303, milestones 313-315, payments 403-405, reviews 501-502, trust scores 607-608.

```sql
-- Scenario: happy_path
-- Load in this order:
-- 1. Users: irene, henry, kate, grace
-- 2. Properties: 034 (Irene's home)
-- 3. Subscription tiers + subscriptions for irene, henry
-- 4. Provider profiles: henry (024), kate (026)
-- 5. Job 105 (bathroom_paint)
-- 6. Bids 211, 212
-- 7. Update job 105 awarded_bid_id
-- 8. Contract 303
-- 9. Milestones 313, 314, 315
-- 10. Payments 403, 404, 405
-- 11. Reviews 501, 502
-- 12. Trust scores 607, 608
```

---

### Scenario 2: Dispute Flow

**Use case**: Testing dispute creation, evidence submission, admin review, and resolution.

**Steps**:
1. Dave posts job 106 (roof repair) -- status: `active`
2. Eve bids $4,200 (bid 213), Jake bids $4,000 (bid 214)
3. Dave awards Eve (lower bid but selects Eve) -- job status: `awarded`
4. Contract 304 created (upfront payment) -- status: `active`
5. Payment 406 collected -- status: `escrow`
6. Eve starts work -- contract status: `active`
7. Eve claims work complete, Dave inspects
8. Roof still leaks. Chat messages 731-735 document the dispute
9. Dave opens dispute 951 -- status: `open`, contract status: `disputed`, payment status: `disputed`
10. Admin (Grace) reviews evidence
11. **Resolution**: Full refund to Dave, Eve suspended
12. Eve's fraud signals (901-906) contributed to suspension
13. Eve's trust score drops to 30 (under_review)

**Fixtures needed**: Users (Dave, Eve, Jake, Grace, Support), properties (033), job 106, bids 213-214, contract 304, payment 406, chat channel 703 + messages, dispute 951, fraud signals 901-906, notifications 806-807-811, trust scores 604-605.

---

### Scenario 3: Bid Expiration & Repost

**Use case**: Testing auction expiration, zero-bid handling, and job reposting.

**Steps**:
1. Irene posts job 109 (AC install) -- status: `active`
2. Auction runs for 72 hours with no bids
3. Auction expires -- job status: `closed_zero_bids`
4. Irene gets notification: "No bids received"
5. Irene reposts as job 113 (window install, different job for variety) -- status: `reposted`
6. Bids come in on the reposted job
7. Irene also has job 112 that expired and was NOT reposted

**Fixtures needed**: Users (Irene), properties (034, 035), jobs 109, 112, 113, trust score 608.

---

### Scenario 4: Payment Failure & Recovery

**Use case**: Testing payment failure, retry logic, and recovery.

**Steps**:
1. Alice awards job 111 (house cleaning) to Bob -- contract 305
2. Bob completes the cleaning
3. First payment attempt (payment 413) fails -- status: `failed`, failure_reason: card_declined
4. Alice updates payment method
5. Retry succeeds (payment 407) -- status: `completed`
6. Escrow released, Bob paid out
7. Also includes refund scenario (payment 414) for edge case coverage

**Fixtures needed**: Users (Alice, Bob), properties (032), job 111, bid 216, contract 305, payments 407, 413 (failed), 414 (refunded).

---

### Scenario 5: Real-time Bidding

**Use case**: Testing sealed-bid auction mechanics with multiple concurrent bidders.

**Steps**:
1. Alice posts job 101 (leaky faucet) -- status: `active`, 72h auction
2. Bob views job and bids $280 (bid 201, original)
3. Carol views job and bids $275 (bid 202)
4. Kate views job and bids $290 (bid 203)
5. Bob lowers bid to $250 (bid 201 updated)
6. Chat channel 701 opens between Alice and Bob for questions
7. Auction countdown: 36 hours remaining
8. All bids sealed -- providers cannot see each other's amounts
9. **When auction closes**: Provider with lowest bid ($250, Bob) wins

**Fixtures needed**: Users (Alice, Bob, Carol, Kate), properties (031), job 101, bids 201-203, chat channel 701 + messages, notifications 801-802.

---

### Scenario 6: Full Kitchen Sink (Everything)

Loads all fixtures from all sections. This is for full integration tests, E2E tests, and manual QA.

```sql
-- Scenario: everything
-- State: All test data from all sections loaded
-- Dependencies: Migrations 001 and 002 only

BEGIN;

-- Run cleanup in reverse dependency order:
DELETE FROM trust_score_history WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM trust_scores WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM review_responses WHERE review_id IN (SELECT id FROM reviews WHERE reviewer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com'));
DELETE FROM reviews WHERE reviewer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM fraud_signals WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM chat_messages WHERE sender_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM chat_channels WHERE customer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM disputes WHERE contract_id IN (SELECT id FROM contracts WHERE customer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com'));
DELETE FROM payments WHERE customer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM recurring_instances WHERE contract_id IN (SELECT id FROM contracts WHERE customer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com'));
DELETE FROM recurring_configs WHERE contract_id IN (SELECT id FROM contracts WHERE customer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com'));
DELETE FROM milestones WHERE contract_id IN (SELECT id FROM contracts WHERE customer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com'));
DELETE FROM contracts WHERE customer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
UPDATE jobs SET awarded_bid_id = NULL WHERE customer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM bids WHERE provider_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM job_tags WHERE job_id IN (SELECT id FROM jobs WHERE customer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com'));
DELETE FROM job_photos WHERE job_id IN (SELECT id FROM jobs WHERE customer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com'));
DELETE FROM jobs WHERE customer_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM properties WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM subscription_tiers WHERE id LIKE '00000000-0000-0000-0000-00000000097%';
DELETE FROM verification_documents WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM provider_service_categories WHERE provider_id IN (SELECT id FROM provider_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com'));
DELETE FROM provider_portfolio_images WHERE provider_id IN (SELECT id FROM provider_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com'));
DELETE FROM provider_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM notification_preferences WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM admin_audit_log WHERE admin_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM oauth_accounts WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@example.com');
DELETE FROM users WHERE email LIKE '%@example.com';

-- Insert in dependency order:
-- 1.  Users (section 1)
-- 2.  Provider profiles (section 1)
-- 3.  Provider service categories (section 1)
-- 4.  Verification documents (section 1)
-- 5.  Properties (section 2)
-- 6.  Subscription tiers (section 15)
-- 7.  Subscriptions (section 15)
-- 8.  Jobs (section 4)
-- 9.  Job photos (section 4)
-- 10. Bids (section 5)
-- 11. Post-insert FK updates: jobs.awarded_bid_id (section 5)
-- 12. Contracts (section 6)
-- 13. Milestones (section 7)
-- 14. Recurring configs + instances (section 8)
-- 15. Payments (section 8)
-- 16. Reviews + review responses (section 9)
-- 17. Trust scores + history (section 10)
-- 18. Chat channels + messages (section 11)
-- 19. Notifications (section 12)
-- 20. Fraud signals (section 13)
-- 21. Disputes (section 14)

COMMIT;
```

---

## 17. Appendix: Helper Constants for Test Code

### Go (testcontainers-go)

```go
// LoadFixture loads a named fixture SQL file into a test database container.
func LoadFixture(ctx context.Context, db *pgxpool.Pool, fixtureName string) error {
    path := filepath.Join("testdata", fixtureName+".sql")
    sql, err := os.ReadFile(path)
    if err != nil {
        return fmt.Errorf("read fixture %s: %w", fixtureName, err)
    }
    _, err = db.Exec(ctx, string(sql))
    if err != nil {
        return fmt.Errorf("exec fixture %s: %w", fixtureName, err)
    }
    return nil
}

// Deterministic test UUIDs
const (
    UserAliceID   = "00000000-0000-0000-0000-000000000001"
    UserBobID     = "00000000-0000-0000-0000-000000000002"
    UserCarolID   = "00000000-0000-0000-0000-000000000003"
    UserDaveID    = "00000000-0000-0000-0000-000000000004"
    UserEveID     = "00000000-0000-0000-0000-000000000005"
    UserFrankID   = "00000000-0000-0000-0000-000000000006"
    UserGraceID   = "00000000-0000-0000-0000-000000000007"
    UserHenryID   = "00000000-0000-0000-0000-000000000008"
    UserIreneID   = "00000000-0000-0000-0000-000000000009"
    UserJakeID    = "00000000-0000-0000-0000-000000000010"
    UserSupportID = "00000000-0000-0000-0000-000000000011"
    UserKateID    = "00000000-0000-0000-0000-000000000012"

    TestPassword = "password123"
)
```

### Rust (sqlx)

```rust
/// Deterministic test UUIDs
pub mod test_ids {
    use uuid::Uuid;

    pub const ALICE: Uuid   = uuid::uuid!("00000000-0000-0000-0000-000000000001");
    pub const BOB: Uuid     = uuid::uuid!("00000000-0000-0000-0000-000000000002");
    pub const CAROL: Uuid   = uuid::uuid!("00000000-0000-0000-0000-000000000003");
    pub const DAVE: Uuid    = uuid::uuid!("00000000-0000-0000-0000-000000000004");
    pub const EVE: Uuid     = uuid::uuid!("00000000-0000-0000-0000-000000000005");
    pub const FRANK: Uuid   = uuid::uuid!("00000000-0000-0000-0000-000000000006");
    pub const GRACE: Uuid   = uuid::uuid!("00000000-0000-0000-0000-000000000007");
    pub const HENRY: Uuid   = uuid::uuid!("00000000-0000-0000-0000-000000000008");
    pub const IRENE: Uuid   = uuid::uuid!("00000000-0000-0000-0000-000000000009");
    pub const JAKE: Uuid    = uuid::uuid!("00000000-0000-0000-0000-000000000010");
    pub const SUPPORT: Uuid = uuid::uuid!("00000000-0000-0000-0000-000000000011");
    pub const KATE: Uuid    = uuid::uuid!("00000000-0000-0000-0000-000000000012");

    // Jobs
    pub const JOB_LEAKY_FAUCET: Uuid      = uuid::uuid!("00000000-0000-0000-0000-000000000101");
    pub const JOB_KITCHEN_REMODEL: Uuid    = uuid::uuid!("00000000-0000-0000-0000-000000000102");
    pub const JOB_LAWN_MOWING: Uuid        = uuid::uuid!("00000000-0000-0000-0000-000000000103");
    pub const JOB_ELECTRICAL_PANEL: Uuid   = uuid::uuid!("00000000-0000-0000-0000-000000000104");
    pub const JOB_BATHROOM_PAINT: Uuid     = uuid::uuid!("00000000-0000-0000-0000-000000000105");
    pub const JOB_ROOF_REPAIR: Uuid        = uuid::uuid!("00000000-0000-0000-0000-000000000106");
    pub const JOB_DECK_STAINING: Uuid      = uuid::uuid!("00000000-0000-0000-0000-000000000107");
    pub const JOB_DRAIN_CLEARING: Uuid     = uuid::uuid!("00000000-0000-0000-0000-000000000108");
    pub const JOB_AC_INSTALL: Uuid         = uuid::uuid!("00000000-0000-0000-0000-000000000109");
    pub const JOB_FENCE_BUILD: Uuid        = uuid::uuid!("00000000-0000-0000-0000-000000000110");
    pub const JOB_HOUSE_CLEANING: Uuid     = uuid::uuid!("00000000-0000-0000-0000-000000000111");
    pub const JOB_GARAGE_DOOR: Uuid        = uuid::uuid!("00000000-0000-0000-0000-000000000112");
    pub const JOB_WINDOW_INSTALL: Uuid     = uuid::uuid!("00000000-0000-0000-0000-000000000113");
    pub const JOB_SUSPENDED: Uuid          = uuid::uuid!("00000000-0000-0000-0000-000000000114");
    pub const JOB_RECURRING_LAWN: Uuid     = uuid::uuid!("00000000-0000-0000-0000-000000000115");
    pub const JOB_LIGHT_FIXTURE: Uuid      = uuid::uuid!("00000000-0000-0000-0000-000000000116");
    pub const JOB_HVAC_REPAIR: Uuid        = uuid::uuid!("00000000-0000-0000-0000-000000000117");
    pub const JOB_DEEP_CLEAN: Uuid         = uuid::uuid!("00000000-0000-0000-0000-000000000118");
}
```

### TypeScript (Vitest / Playwright)

```typescript
// test/fixtures/ids.ts
export const TEST_IDS = {
  users: {
    alice:   '00000000-0000-0000-0000-000000000001',
    bob:     '00000000-0000-0000-0000-000000000002',
    carol:   '00000000-0000-0000-0000-000000000003',
    dave:    '00000000-0000-0000-0000-000000000004',
    eve:     '00000000-0000-0000-0000-000000000005',
    frank:   '00000000-0000-0000-0000-000000000006',
    grace:   '00000000-0000-0000-0000-000000000007',
    henry:   '00000000-0000-0000-0000-000000000008',
    irene:   '00000000-0000-0000-0000-000000000009',
    jake:    '00000000-0000-0000-0000-000000000010',
    support: '00000000-0000-0000-0000-000000000011',
    kate:    '00000000-0000-0000-0000-000000000012',
  },
  jobs: {
    leakyFaucet:     '00000000-0000-0000-0000-000000000101',
    kitchenRemodel:  '00000000-0000-0000-0000-000000000102',
    lawnMowing:      '00000000-0000-0000-0000-000000000103',
    electricalPanel: '00000000-0000-0000-0000-000000000104',
    bathroomPaint:   '00000000-0000-0000-0000-000000000105',
    roofRepair:      '00000000-0000-0000-0000-000000000106',
    deckStaining:    '00000000-0000-0000-0000-000000000107',
    drainClearing:   '00000000-0000-0000-0000-000000000108',
    acInstall:       '00000000-0000-0000-0000-000000000109',
    fenceBuild:      '00000000-0000-0000-0000-000000000110',
    houseCleaning:   '00000000-0000-0000-0000-000000000111',
    garageDoor:      '00000000-0000-0000-0000-000000000112',
    windowInstall:   '00000000-0000-0000-0000-000000000113',
    suspended:       '00000000-0000-0000-0000-000000000114',
    recurringLawn:   '00000000-0000-0000-0000-000000000115',
    lightFixture:    '00000000-0000-0000-0000-000000000116',
    hvacRepair:      '00000000-0000-0000-0000-000000000117',
    deepClean:       '00000000-0000-0000-0000-000000000118',
  },
  contracts: {
    lawnPending:     '00000000-0000-0000-0000-000000000301',
    panelActive:     '00000000-0000-0000-0000-000000000302',
    paintCompleted:  '00000000-0000-0000-0000-000000000303',
    roofDisputed:    '00000000-0000-0000-0000-000000000304',
    cleanCompleted:  '00000000-0000-0000-0000-000000000305',
    lawnRecurring:   '00000000-0000-0000-0000-000000000306',
    lightActive:     '00000000-0000-0000-0000-000000000307',
    fencePending:    '00000000-0000-0000-0000-000000000308',
  },
  disputes: {
    roofRepair:      '00000000-0000-0000-0000-000000000951',
    cleaningQuality: '00000000-0000-0000-0000-000000000952',
    paintDismissed:  '00000000-0000-0000-0000-000000000953',
  },
  testPassword: 'password123',
} as const;
```
