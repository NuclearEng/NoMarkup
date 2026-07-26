-- Migration 107 — bring the audit surface up to the inventory 104-106 created,
-- and write down the one exposure that is NOT being fixed.
--
-- Builds on:
--   098 — pii_looks_like_secretbox() and the pii_plaintext_audit view
--   104 — jobs.service_address / service_location_encrypted / pii_coarsen_point
--   105 — properties.location_encrypted
--   106 — users.dob_encrypted, provider_employees.date_of_birth_encrypted,
--         provider_licenses.license_number
--
-- Two jobs here.
--
-- ── 1. The audit view must cover what it claims to ───────────────────────
-- 098 built pii_plaintext_audit so that "is any PII still in clear" has one
-- truthful answer. Migrations 104-106 added seven columns to the inventory;
-- if the view does not list them, then draining it to zero would certify a
-- database that still holds a customer's home address, and the view would
-- become exactly the kind of question-retiring artefact 099 was written to
-- destroy.
--
-- The view is DROPped and recreated rather than CREATE OR REPLACEd because its
-- column TYPES change: `jobs` and `provider_licenses` have no pii_encrypted_v1
-- flag, so that column becomes nullable, and CREATE OR REPLACE VIEW cannot
-- alter a column's type or nullability.
--
-- Two kinds of "definitely plaintext" now appear in it:
--
--   * TEXT columns that hold ciphertext when done — tested with
--     pii_looks_like_secretbox(), a shape test whose FALSE is decisive
--     (098's asymmetry: failing the shape test proves the value is not our
--     ciphertext; passing it proves nothing).
--
--   * DATE columns being drained into a sibling *_encrypted TEXT column
--     (106) — here the test is simply IS NOT NULL, because the backfill NULLs
--     the DATE in the same transaction that writes the ciphertext. A non-NULL
--     DATE is a plaintext date of birth, with no shape test required.
--
-- ── 2. Geometry needs its own audit ──────────────────────────────────────
-- A coarsened point is not ciphertext and pii_looks_like_secretbox can say
-- nothing about it. But 104's grid gives a decisive test of its own: a point
-- already snapped to the grid is its own image under pii_coarsen_point, so
--
--     ST_Equals(g, pii_coarsen_point(g))
--
-- is TRUE for every processed row and FALSE for every row still holding an
-- exact point. False positives are possible in principle — an exact point
-- could land on a grid intersection by luck, at odds of roughly one in ten
-- thousand per row for coordinates quantised to the metre — and they are
-- harmless: such a row is indistinguishable from a coarsened one, which is
-- the property we wanted. False NEGATIVES, the direction that matters, cannot
-- occur: a row reported as exact is always genuinely un-coarsened.
--
-- Like pii_plaintext_audit, this view exposes table, column and row id only.
-- Emitting the coordinate itself would make the privacy audit the largest
-- plaintext-location sink in the database.
--
-- ── 3. The limitation we are NOT fixing ──────────────────────────────────
-- provider_profiles.service_location stays an exact, plaintext, spatially
-- indexed point. This is a deliberate, documented decision, not an oversight,
-- and the reasoning is recorded on the column itself below so that the next
-- audit finds an argument rather than a silence.
--
-- This migration mutates no row and no PII value. Views and comments only.

SET lock_timeout = '5s';

-- ── 1. pii_plaintext_audit, second edition ───────────────────────────────

DROP VIEW IF EXISTS pii_plaintext_audit;

CREATE VIEW pii_plaintext_audit AS
    -- ── 031 / 033 inventory (unchanged from migration 098) ──────────────
    SELECT 'users'::TEXT AS table_name, 'phone'::TEXT AS column_name, id,
           pii_encrypted_v1::BOOLEAN AS pii_encrypted_v1
      FROM users
     WHERE deleted_at IS NULL AND phone IS NOT NULL AND phone <> ''
       AND NOT pii_looks_like_secretbox(phone)
UNION ALL
    SELECT 'users', 'mfa_secret', id, pii_encrypted_v1
      FROM users
     WHERE deleted_at IS NULL AND mfa_secret IS NOT NULL AND mfa_secret <> ''
       AND NOT pii_looks_like_secretbox(mfa_secret)
UNION ALL
    SELECT 'provider_profiles', 'service_address', id, pii_encrypted_v1
      FROM provider_profiles
     WHERE service_address IS NOT NULL AND service_address <> ''
       AND NOT pii_looks_like_secretbox(service_address)
UNION ALL
    SELECT 'provider_profiles', 'ein_tin', id, pii_encrypted_v1
      FROM provider_profiles
     WHERE ein_tin IS NOT NULL AND ein_tin <> ''
       AND NOT pii_looks_like_secretbox(ein_tin)
UNION ALL
    SELECT 'provider_profiles', 'insurance_policy_number', id, pii_encrypted_v1
      FROM provider_profiles
     WHERE insurance_policy_number IS NOT NULL AND insurance_policy_number <> ''
       AND NOT pii_looks_like_secretbox(insurance_policy_number)
UNION ALL
    SELECT 'provider_employees', 'email', id, pii_encrypted_v1
      FROM provider_employees
     WHERE email IS NOT NULL AND email <> ''
       AND NOT pii_looks_like_secretbox(email)
UNION ALL
    SELECT 'provider_employees', 'phone', id, pii_encrypted_v1
      FROM provider_employees
     WHERE phone IS NOT NULL AND phone <> ''
       AND NOT pii_looks_like_secretbox(phone)
UNION ALL
    SELECT 'provider_employees', 'license_number', id, pii_encrypted_v1
      FROM provider_employees
     WHERE license_number IS NOT NULL AND license_number <> ''
       AND NOT pii_looks_like_secretbox(license_number)
UNION ALL
    SELECT 'provider_employees', 'insurance_policy_number', id, pii_encrypted_v1
      FROM provider_employees
     WHERE insurance_policy_number IS NOT NULL AND insurance_policy_number <> ''
       AND NOT pii_looks_like_secretbox(insurance_policy_number)
UNION ALL
    SELECT 'properties', 'address', id, pii_encrypted_v1
      FROM properties
     WHERE deleted_at IS NULL AND address IS NOT NULL AND address <> ''
       AND NOT pii_looks_like_secretbox(address)
UNION ALL
    SELECT 'properties', 'notes', id, pii_encrypted_v1
      FROM properties
     WHERE deleted_at IS NULL AND notes IS NOT NULL AND notes <> ''
       AND NOT pii_looks_like_secretbox(notes)

    -- ── 104: the customer home address ─────────────────────────────────
    -- `jobs` has no pii_encrypted_v1 flag and deliberately never will (098
    -- documents why a row flag over per-column encryption drifts), so the
    -- flag column is NULL here. That is the honest value: not "false".
UNION ALL
    SELECT 'jobs', 'service_address', id, NULL::BOOLEAN
      FROM jobs
     WHERE deleted_at IS NULL AND service_address IS NOT NULL AND service_address <> ''
       AND NOT pii_looks_like_secretbox(service_address)

    -- ── 106: DATE columns being drained into sibling TEXT columns ──────
    -- The backfill NULLs the DATE in the same transaction that writes the
    -- ciphertext, so a surviving non-NULL DATE *is* the plaintext. No shape
    -- test applies or is needed.
UNION ALL
    SELECT 'users', 'dob', id, pii_encrypted_v1
      FROM users
     WHERE deleted_at IS NULL AND dob IS NOT NULL
UNION ALL
    SELECT 'provider_employees', 'date_of_birth', id, pii_encrypted_v1
      FROM provider_employees
     WHERE date_of_birth IS NOT NULL

    -- ── 106: encrypted in place, NOT NULL, no flag column ──────────────
UNION ALL
    SELECT 'provider_licenses', 'license_number', id, NULL::BOOLEAN
      FROM provider_licenses
     WHERE license_number IS NOT NULL AND license_number <> ''
       AND NOT pii_looks_like_secretbox(license_number);

COMMENT ON VIEW pii_plaintext_audit IS
    'Every at-rest PII value that is DEFINITELY still plaintext. TEXT columns fail pii_looks_like_secretbox (migration 098); the DATE columns from migration 106 (users.dob, provider_employees.date_of_birth) qualify by being non-NULL at all, since the backfill clears them as it encrypts. Empty on a fully backfilled database. Run `make encrypt-pii` to drain it, then check pii_exact_geometry_audit too — this view says nothing about geometry. Exposes table/column/row id only, never the value. pii_encrypted_v1 is NULL for tables that have no such flag (jobs, provider_licenses) and is advisory everywhere else. Extended by migration 107.';

-- ── 2. pii_exact_geometry_audit ──────────────────────────────────────────

CREATE OR REPLACE VIEW pii_exact_geometry_audit AS
    SELECT 'jobs'::TEXT AS table_name, 'service_location'::TEXT AS column_name,
           id, (service_location_encrypted IS NOT NULL) AS has_encrypted_exact
      FROM jobs
     WHERE deleted_at IS NULL AND service_location IS NOT NULL
       AND NOT ST_Equals(service_location, pii_coarsen_point(service_location))
UNION ALL
    SELECT 'jobs', 'approximate_location', id,
           (service_location_encrypted IS NOT NULL)
      FROM jobs
     WHERE deleted_at IS NULL AND approximate_location IS NOT NULL
       AND NOT ST_Equals(approximate_location, pii_coarsen_point(approximate_location))
UNION ALL
    SELECT 'properties', 'location', id,
           (location_encrypted IS NOT NULL)
      FROM properties
     WHERE deleted_at IS NULL AND location IS NOT NULL
       AND NOT ST_Equals(location, pii_coarsen_point(location));

COMMENT ON VIEW pii_exact_geometry_audit IS
    'Every PII point geometry still holding an EXACT (un-coarsened) coordinate, i.e. one that reverse-geocodes to a street address. A row qualifies when the stored point differs from its own image under pii_coarsen_point (migration 104). has_encrypted_exact reports whether the exact point has already been preserved in the sibling *_encrypted column, which is what makes the coarsening safe to apply — `make encrypt-pii` always writes the ciphertext and coarsens the geometry in ONE transaction, so a row should never be seen exact-and-unencrypted after a successful run. Empty on a fully backfilled database. Exposes table/column/row id only, never a coordinate. provider_profiles.service_location is DELIBERATELY absent — see the comment on that column. Added by migration 107.';

-- ── 3. The documented limitation ─────────────────────────────────────────

COMMENT ON COLUMN provider_profiles.service_location IS
    'NOT ENCRYPTED AND NOT COARSENED — a known, accepted limitation, recorded here rather than left silent. This is the one PII point geometry the database must be able to compute over: it is the ST_DWithin target of provider matching (services/job/internal/repository/matching.go) and the ST_DistanceSphere target of provider search, where it also backs the distance ORDER BY, and it carries two GiST indexes (idx_provider_profiles_location @ 001, idx_provider_profiles_location_geog @ 064). Ciphertext cannot be indexed or measured, so the only available at-rest control would be precision reduction — and unlike jobs/properties, coarsening here is NOT free: it perturbs the 30%-weighted proximity term of the composite match score and the distance sort, changing live ranking, while a ~1 km grid cell still identifies the right neighbourhood. Paying a behavioural cost for a partial control was judged the wrong trade. Mitigating factors: this is a business service base rather than a residence, providers publish a service area by design, and the anonymous profile response already deletes the field outright (gateway/internal/handler/provider.go:401-402). The paired service_address IS encrypted (031), so the address is not readable directly — only inferable by reverse geocoding this point. REVISIT IF: provider_profiles ever stores a home address for sole traders, or a geo index over encrypted/blinded points becomes practical.';

COMMENT ON COLUMN listings.location IS
    'NOT ENCRYPTED AND NOT COARSENED — deliberate, and different in kind from the columns migrations 104-105 cover. This is a seller''s chosen PICKUP point for a goods listing, published on purpose: local pickup inside 25 miles is the product (services/job/internal/repository/listing_repo.go caps the radius at 25 mi), the point is served at full precision on the unauthenticated browse and detail routes, it backs idx_listings_location_geog, and buyers need it to decide whether an item is reachable. It is seller-supplied and defaults to the ZIP centroid when no pin is given (gateway/internal/handler/listings_write.go). Sellers who do not wish to publish their home should pin a neutral meeting point — that guidance belongs in the listing UI, not in a column comment, and is tracked as product work rather than a security fix.';
