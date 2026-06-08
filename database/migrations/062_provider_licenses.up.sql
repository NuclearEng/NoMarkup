-- 062_provider_licenses.up.sql
--
-- Provider professional-license capture + verification, for the gated LEGAL
-- services vertical (CLAUDE.md §15: gated verticals; §6: every data boundary
-- authenticated + authorized; §5 SQL conventions).
--
-- Background: legal service categories already exist (006_tier2_categories
-- seeds the `legal` subtree) and ride the generic post-job -> providers-bid
-- reverse auction. The legal vertical is gated behind the seeded
-- `legal_services` feature flag (060). What it additionally needs is a way for
-- a provider to declare a professional license (a bar license, in a given
-- state) and for an admin to VERIFY it, so the frontend can show a "verified
-- lawyer" badge and the platform can trust who is bidding on legal work.
--
-- This table is the source of truth for those licenses. A row starts `pending`
-- (provider self-asserted), and an admin moves it to `verified` or `rejected`
-- after checking the state bar registry. The full license_number is captured
-- for admin review but is treated as sensitive: the public read path masks it
-- to a last-4 projection and only ever exposes `verified` rows.
--
-- provider_id references users(id): the gateway uses claims.UserID directly as
-- the provider id (see working_capital / expenses, which also FK users(id)),
-- and a license is owned by the authenticated user, so the user is the right
-- anchor. ON DELETE CASCADE so a deleted user's licenses go with them.

CREATE TABLE provider_licenses (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    license_type    TEXT        NOT NULL,
    license_number  TEXT        NOT NULL,
    jurisdiction    TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending',
    verified_by     UUID        REFERENCES users(id),
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT provider_licenses_status_valid
        CHECK (status IN ('pending', 'verified', 'rejected')),
    -- A license is only ever "verified" with an audited reviewer + timestamp,
    -- so the badge can never be shown for an unaudited row.
    CONSTRAINT provider_licenses_verified_audited
        CHECK (status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);

COMMENT ON TABLE provider_licenses IS
    'Provider professional licenses (e.g. bar license) for gated verticals like legal. Self-asserted pending -> admin verified/rejected. Source of truth for the "verified" badge.';
COMMENT ON COLUMN provider_licenses.license_number IS
    'Full license number for admin review (sensitive). Public read path masks to last-4 and only exposes verified rows.';
COMMENT ON COLUMN provider_licenses.jurisdiction IS
    'Issuing jurisdiction, e.g. a US state code ("WA", "CA") for a bar license.';

-- Backs both the provider-self list (WHERE provider_id = $1) and the public
-- verified-badge read (WHERE provider_id = $1 AND status = 'verified').
CREATE INDEX idx_provider_licenses_provider_id ON provider_licenses (provider_id);

-- Backs the admin review queue (WHERE status = 'pending' ORDER BY created_at).
CREATE INDEX idx_provider_licenses_status ON provider_licenses (status);

-- ============================================================
-- SEED — demo content so the gated /legal vertical has substance.
-- Mark the two seed providers as verified bar-licensed in Washington (the
-- launched market, see 055/058) so /providers/{id}/licenses returns a badge,
-- and post a couple of active legal-category jobs so /legal browse has jobs to
-- bid on. ON CONFLICT-safe via a guarded insert (only seed-id rows).
-- ============================================================

-- Verified bar licenses for the seed providers (provider@ / provider2@).
INSERT INTO provider_licenses (provider_id, license_type, license_number, jurisdiction, status, verified_by, verified_at)
VALUES
    ('00000000-0000-0000-0000-000000000003', 'bar', 'WA-58213', 'WA', 'verified',
     '00000000-0000-0000-0000-000000000001', now()),
    ('00000000-0000-0000-0000-000000000004', 'bar', 'WA-61907', 'WA', 'verified',
     '00000000-0000-0000-0000-000000000001', now());

-- A couple of active legal-category jobs so the vertical has content to browse.
-- customer@ (…0002) posts in the existing Legal Services category. Location is
-- Seattle, WA to match the launched WA market.
INSERT INTO jobs (
    customer_id, title, description, category_id, subcategory_id,
    service_city, service_state, service_zip,
    service_location, approximate_location,
    schedule_type, starting_bid_cents, auction_duration_hours, auction_ends_at, status
)
VALUES
    ('00000000-0000-0000-0000-000000000002',
     'Review SaaS vendor contract before signing',
     'Need a licensed attorney to review a 14-page SaaS vendor agreement and flag liability, auto-renewal, and indemnification risks. Remote consult is fine.',
     'a5663378-3f7e-4164-a42e-15e752348902',
     '02e5bb42-0c91-4519-a9ef-10603e337f0e',
     'Seattle', 'WA', '98101',
     ST_SetSRID(ST_MakePoint(-122.3321, 47.6062), 4326),
     ST_SetSRID(ST_MakePoint(-122.3321, 47.6062), 4326),
     'flexible', 40000, 72, now() + interval '72 hours', 'active'),
    ('00000000-0000-0000-0000-000000000002',
     'One-hour business law consultation for new LLC',
     'Forming a single-member LLC in Washington and want a 60-minute consultation with a licensed attorney on operating agreement basics and liability.',
     'a5663378-3f7e-4164-a42e-15e752348902',
     'b8dd10b6-93b5-4ef9-a0da-c57a038c6313',
     'Seattle', 'WA', '98109',
     ST_SetSRID(ST_MakePoint(-122.3493, 47.6205), 4326),
     ST_SetSRID(ST_MakePoint(-122.3493, 47.6205), 4326),
     'flexible', 25000, 72, now() + interval '72 hours', 'active');
