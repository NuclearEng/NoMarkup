-- 062_provider_licenses.up.sql
--
-- POLICY DEVIATION NOTE (2026-06-10): this migration was edited IN PLACE
-- after being merged, deviating from "never edit a deployed migration"
-- (CLAUDE.md §5). Accepted because: (1) production has never applied any
-- migration (deploy.yml is a gated placeholder — "deployed" today means
-- merged/shared), (2) golang-migrate does not checksum applied files, and
-- (3) the original version made every fresh database bootstrap fail dirty
-- at version 62: its fixture INSERTs referenced seed-tool users
-- (…0001–…0004) and dev-DB-only service_categories UUIDs that do not exist
-- on a fresh chain. The fixture INSERTs below are now existence-guarded:
-- identical effect on the dev DB, clean no-op on fresh DBs. The fixtures
-- are also ported to database/cmd/seed (which is where dev environments
-- get them from now on). See docs/operations/migration-notes.md.
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
-- bid on.
--
-- Every INSERT is existence-guarded: the referenced users are created by the
-- seed tool (database/cmd/seed), not by migrations, and the category UUIDs
-- are the dev DB's instances of the 006 legal subtree (006 generates fresh
-- UUIDs per database). On a fresh database none of these rows exist, so the
-- inserts are a clean no-op and the chain proceeds; the seed tool now carries
-- these fixtures for dev environments (with NOT EXISTS guards on the same
-- natural keys, so migration + seeder compose without double-inserting).
-- ============================================================

-- Verified bar licenses for the seed providers (provider@ / provider2@),
-- verified by the seed admin. Only inserted when those users exist, and not
-- already licensed for the same (provider, type, jurisdiction).
INSERT INTO provider_licenses (provider_id, license_type, license_number, jurisdiction, status, verified_by, verified_at)
SELECT v.provider_id, v.license_type, v.license_number, v.jurisdiction, 'verified', v.verified_by, now()
FROM (VALUES
    ('00000000-0000-0000-0000-000000000003'::uuid, 'bar', 'WA-58213', 'WA',
     '00000000-0000-0000-0000-000000000001'::uuid),
    ('00000000-0000-0000-0000-000000000004'::uuid, 'bar', 'WA-61907', 'WA',
     '00000000-0000-0000-0000-000000000001'::uuid)
) AS v(provider_id, license_type, license_number, jurisdiction, verified_by)
WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = v.provider_id)
  AND EXISTS (SELECT 1 FROM users a WHERE a.id = v.verified_by)
  AND NOT EXISTS (
        SELECT 1 FROM provider_licenses pl
        WHERE pl.provider_id = v.provider_id
          AND pl.license_type = v.license_type
          AND pl.jurisdiction = v.jurisdiction
  );

-- A couple of active legal-category jobs so the vertical has content to browse.
-- customer@ (…0002) posts in the existing Legal Services category. Location is
-- Seattle, WA to match the launched WA market. Guarded on the customer user,
-- the category/subcategory rows, and (customer_id, title) dedupe.
INSERT INTO jobs (
    customer_id, title, description, category_id, subcategory_id,
    service_city, service_state, service_zip,
    service_location, approximate_location,
    schedule_type, starting_bid_cents, auction_duration_hours, auction_ends_at, status
)
SELECT v.customer_id, v.title, v.description, v.category_id, v.subcategory_id,
       v.service_city, 'WA', v.service_zip,
       ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326),
       ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326),
       'flexible', v.starting_bid_cents, 72, now() + interval '72 hours', 'active'
FROM (VALUES
    ('00000000-0000-0000-0000-000000000002'::uuid,
     'Review SaaS vendor contract before signing',
     'Need a licensed attorney to review a 14-page SaaS vendor agreement and flag liability, auto-renewal, and indemnification risks. Remote consult is fine.',
     'a5663378-3f7e-4164-a42e-15e752348902'::uuid,
     '02e5bb42-0c91-4519-a9ef-10603e337f0e'::uuid,
     'Seattle', '98101', -122.3321::float8, 47.6062::float8, 40000::bigint),
    ('00000000-0000-0000-0000-000000000002'::uuid,
     'One-hour business law consultation for new LLC',
     'Forming a single-member LLC in Washington and want a 60-minute consultation with a licensed attorney on operating agreement basics and liability.',
     'a5663378-3f7e-4164-a42e-15e752348902'::uuid,
     'b8dd10b6-93b5-4ef9-a0da-c57a038c6313'::uuid,
     'Seattle', '98109', -122.3493::float8, 47.6205::float8, 25000::bigint)
) AS v(customer_id, title, description, category_id, subcategory_id,
       service_city, service_zip, lng, lat, starting_bid_cents)
WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = v.customer_id)
  AND EXISTS (SELECT 1 FROM service_categories c WHERE c.id = v.category_id)
  AND EXISTS (SELECT 1 FROM service_categories s WHERE s.id = v.subcategory_id)
  AND NOT EXISTS (
        SELECT 1 FROM jobs j
        WHERE j.customer_id = v.customer_id AND j.title = v.title
  );
