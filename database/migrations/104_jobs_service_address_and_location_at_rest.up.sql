-- Migration 104 — jobs.service_address and jobs.service_location are CUSTOMER
-- HOME data. Bring both under the at-rest PII regime.
--
-- Builds on:
--   031 — pii_encrypted_v1 + the first encrypted column set (users, provider_profiles)
--   033 — provider_employees + properties
--   098 — the per-VALUE discriminator (pii_looks_like_secretbox) and the
--         pii_plaintext_audit view; the rule that migrations declare and the
--         Go tool converts
--
-- ── The gap this closes ──────────────────────────────────────────────────
-- 001_initial_schema.up.sql:260 defines
--
--     service_address       TEXT,  -- exact address, revealed post-award
--     service_location      geometry(Point, 4326) NOT NULL,  -- exact point
--     approximate_location  geometry(Point, 4326) NOT NULL,  -- zip centroid
--
-- Neither 031 nor 033 covers this table. `jobs` has no pii_encrypted_v1
-- column, database/cmd/encrypt-pii does not process it, and the
-- pii_plaintext_audit view does not report it. The street address of the place
-- a customer LIVES has therefore been sitting in plaintext since 001, while
-- CLAUDE.md §6 listed "provider service address" as the encrypted one — the
-- provider's business address is covered and the customer's home is not.
--
-- Two things are wrong here, and the second is the one that makes the first
-- worth fixing:
--
--  1. service_address is plaintext.
--
--  2. service_location is an EXACT geometry(Point,4326). Encrypting the
--     address while leaving the point in clear is decorative: anyone with
--     database read access reverse-geocodes the point and recovers the street
--     address they were not supposed to have. The two columns are the same
--     secret in two encodings.
--
-- And a third defect found while tracing the write path, which is worse than
-- either because it is reachable without database access at all:
--
--  3. approximate_location is NOT approximate. The single INSERT
--     (services/job/internal/repository/postgres.go:134-135) writes
--     ST_SetSRID(ST_MakePoint($12, $13), 4326) into BOTH columns from the
--     SAME parameter pair. The "zip centroid for pre-award display" is
--     byte-identical to the exact point, and it is the column that
--     GetJobsOnMap projects (postgres.go:685) to GET /api/v1/jobs/map — a
--     route registered with NO auth (gateway/internal/router/router.go:232)
--     and served through writeCachedJSON, i.e. edge-cached. Exact customer
--     home coordinates are published to anonymous callers today.
--
-- ── The design, and why it is this one ───────────────────────────────────
-- The geometry columns are FUNCTIONAL. They cannot simply be encrypted: a
-- GiST index cannot be built over ciphertext and ST_DWithin cannot read it.
-- So the question is what the queries actually require, and the answer was
-- obtained by reading every one of them:
--
--   * jobs.approximate_location is the ONLY geo column on this table with a
--     spatial index (idx_jobs_location @ 001:310, idx_jobs_location_geog @
--     064:13) and the ONLY ST_DWithin target (SearchJobs @ postgres.go:519,
--     GetJobsOnMap @ :662). Both filters are kilometre-scale — the radius is
--     supplied as RadiusKm * 1000.
--
--   * jobs.service_location has NO index and is read by exactly one query:
--     GetJobLocation (matching.go:130), which returns lat/lng to seed the
--     provider-matching radius. That radius is defaultMatchRadius = 50 km
--     (services/job/internal/service/matching.go:12). The value never leaves
--     the server.
--
-- Nothing needs metre precision. So:
--
--   * The geometry columns are COARSENED at rest to a 0.01-degree grid
--     (pii_coarsen_point below) — roughly 1.1 km of latitude, and 0.85-1.0 km
--     of longitude across the continental US. A grid cell that size covers a
--     neighbourhood, not a house, so the reverse-geocode path is closed.
--     Worst-case displacement is half the cell diagonal, ~0.79 km, against a
--     50 km match radius (1.6%) and kilometre-scale browse radii.
--
--   * The EXACT point is preserved, encrypted, in service_location_encrypted
--     (added here). This is what makes the change reversible: precision that
--     is merely coarsened away is gone forever and no down migration can
--     restore it, whereas an encrypted copy can be restored by anyone holding
--     ENCRYPTION_KEY. GetJobLocation reads the encrypted column first and
--     falls back to the geometry, so matching keeps its exact centre.
--
-- ── Measured, not assumed ────────────────────────────────────────────────
-- The above is the argument; this is the evidence. 2000 synthetic jobs and
-- 500 providers were scattered over ~1 degree around Austin at full double
-- precision, the VERBATIM production predicates were run against the exact
-- geometry, pii_coarsen_point() was applied, and the predicates were re-run
-- and the result sets diffed row by row.
--
-- Displacement introduced by the grid, jobs.approximate_location:
--     max 722 m   mean 400 m   p95 633 m
-- against the predicted half-cell-diagonal bound of ~790 m.
--
-- Membership churn in ST_DWithin, 300 centres per radius. "Churn" is the
-- symmetric difference over the before-set; dropped and added are reported
-- separately because their near-equality is the point — the coarsening jitters
-- the boundary, it does not bias the filter inward or outward:
--
--     radius   before    dropped   added   churn
--       1 km      468         47      43   19.2%
--       2 km      998         87      96   18.3%
--       3 km     1877        114     120   12.5%
--       5 km     4484        222     199    9.4%
--      10 km    16602        394     386    4.7%
--      25 km    88315        784     741    1.7%
--      50 km   265113       1035     930    0.7%
--
-- Churn scales as displacement/radius, so it is negligible at every radius
-- this product actually uses (the marketplace caps at 25 mi / 40 km, provider
-- matching is fixed at 50 km) and reaches ~20% only at a 1-2 km map browse,
-- where the affected rows are pins at the very edge of a viewport the user is
-- panning anyway. That cost is accepted and recorded here rather than hidden.
--
-- Provider matching (the thing most likely to break silently) was checked
-- separately and is UNCHANGED — zero disagreeing job/provider pairs — because
-- GetJobLocation decrypts service_location_encrypted and hands the matcher the
-- exact centre, while provider_profiles.service_location is not touched at all.
--
-- That result is also the justification for keeping an encrypted exact point
-- instead of coarsening and being done with it. Forcing the matcher onto the
-- coarse centre (the legacy-row fallback path) moved the 50 km candidate set
-- for 1413 of 2000 jobs and reordered 289 of 1000 sampled top-5 ranking slots.
-- Coarsen-only would have been simpler and would have quietly degraded
-- matching for every job on the platform.
--
-- ── Why this migration mutates nothing ───────────────────────────────────
-- Same reason as 031 and 098: the wire format is XSalsa20-Poly1305
-- (nacl/secretbox) and PostgreSQL ships no libsodium. The conversion — encrypt
-- service_address, encrypt the exact point into service_location_encrypted,
-- THEN coarsen the geometry — must happen in one transaction per row in Go,
-- and lives in database/cmd/encrypt-pii. Coarsening here in SQL would destroy
-- the exact point before anything had a chance to encrypt it.
--
-- This migration therefore adds one nullable column and two functions. It
-- reads no PII, writes no PII, and reverses cleanly.

SET lock_timeout = '5s';

-- ── 1. The encrypted exact point ─────────────────────────────────────────

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS service_location_encrypted TEXT;

COMMENT ON COLUMN jobs.service_location_encrypted IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305 of the EXACT service point, formatted "<lat>,<lng>" with 7 decimal places. Written by services/job/internal/repository CreateJob; read by GetJobLocation, which prefers it over the (coarsened) service_location geometry. Backfilled by database/cmd/encrypt-pii. NULL means the row predates migration 104 and its exact point is still in the geometry column — see the pii_exact_geometry_audit view. Detection is per VALUE; there is no pii_encrypted_v1 flag on this table and none should be added.';

-- ── 2. The canonical coarsening ──────────────────────────────────────────
-- Defined in SQL so the backfill (database/cmd/encrypt-pii), any operational
-- query, and the audit view in migration 107 all agree with the Go
-- implementation (services/job/internal/domain.CoarsenPoint) bit for bit.
--
-- This function has to agree with Go BIT FOR BIT, because
-- pii_exact_geometry_audit (migration 107) decides whether a row has been
-- coarsened by testing ST_Equals(g, pii_coarsen_point(g)). A single ULP of
-- disagreement between the writer and the auditor makes every row the
-- services write report as "still exact" forever, and the audit becomes noise.
--
-- Two plausible spellings are both WRONG, and were measured to be wrong
-- against 20,162 vectors (uniform random plus every exact .005 half-grid
-- boundary in [-0.4, 0.4], generated by the Go implementation and compared
-- here):
--
--   round(v)              on DOUBLE PRECISION delegates to rint(), which is
--                         banker's rounding — halves go to the nearest EVEN.
--                         Go's math.Round is half-away-from-zero.
--
--   round(v::numeric/0.01)*0.01  looks like the fix and is worse: NUMERIC is
--                         exact DECIMAL arithmetic, so it sees 0.145/0.01 as
--                         exactly 14.5 and rounds up, while Go's binary
--                         float64 division yields 14.499999999999998 and
--                         rounds DOWN. It also returns a clean 0.35 where the
--                         float64 multiply yields 0.35000000000000003.
--                         Measured: 4871 / 20162 values disagreed.
--
-- The correct approach is not to reach for a "more accurate" arithmetic but to
-- reproduce Go's IEEE-754 double arithmetic exactly:
--
--   sign(x) * floor(abs(x) + 0.5)   is half-away-from-zero on doubles, and is
--                                   exact here because |x| <= 18000, far below
--                                   2^52, so adding 0.5 loses nothing.
--   idx * 0.01                      is then the same single double multiply Go
--                                   performs, producing the same residue
--                                   (0.35000000000000003, not 0.35).
--
-- Measured: 0 / 20162 disagreements. Do not "clean up" the trailing float
-- noise on either side — the noise is what makes the two implementations
-- identical, and normalising it in one place silently breaks the audit.

CREATE OR REPLACE FUNCTION pii_coarsen_ordinate(v DOUBLE PRECISION)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
    SELECT (sign(v / 0.01) * floor(abs(v / 0.01) + 0.5)) * 0.01;
$$;

COMMENT ON FUNCTION pii_coarsen_ordinate(DOUBLE PRECISION) IS
    'Snaps one coordinate ordinate to the 0.01-degree privacy grid, half-away-from-zero, computed entirely in DOUBLE PRECISION so it reproduces Go''s math.Round(v/0.01)*0.01 bit for bit (verified over 20162 vectors including every exact .005 boundary). Do NOT rewrite it via NUMERIC: exact decimal arithmetic disagrees with binary float64 on half-grid values and on the trailing residue, which would make pii_exact_geometry_audit report coarsened rows as exact. Mirrors services/job/internal/domain.coarsenOrdinate. See migration 104.';

CREATE OR REPLACE FUNCTION pii_coarsen_point(g geometry)
RETURNS geometry
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN g IS NULL THEN NULL
        ELSE ST_SetSRID(
                 ST_MakePoint(
                     pii_coarsen_ordinate(ST_X(g)),
                     pii_coarsen_ordinate(ST_Y(g))
                 ),
                 4326)
    END;
$$;

COMMENT ON FUNCTION pii_coarsen_point(geometry) IS
    'The canonical at-rest coarsening for PII point geometry: snap to a 0.01-degree grid (~1.1 km lat, ~0.85-1.0 km lng in the continental US), SRID 4326. A cell covers a neighbourhood, not an address, which is what closes the reverse-geocode path. Mirrors services/job/internal/domain.CoarsenPoint. Applied by database/cmd/encrypt-pii AFTER the exact point has been encrypted into the matching *_encrypted column — never before. See migration 104.';

-- ── 3. Correct the schema comments ───────────────────────────────────────
-- 001 documented an intent the code never implemented. These record what is
-- true after 104 + the Go half, per column.

COMMENT ON COLUMN jobs.service_address IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305. This is a CUSTOMER HOME address. Encrypted on write by services/job/internal/repository CreateJob, decrypted on read by scanJobRow / scanJobWithCategories and by gateway/internal/handler/calendar_export.go; backfilled/re-keyed by database/cmd/encrypt-pii. No index, constraint or predicate references this column, so encryption costs no query. Detection is per VALUE (crypto.Cipher.DecryptStringOrPassthrough) — this table deliberately has no pii_encrypted_v1 flag, because a row flag over per-column encryption is the drift bug migration 098 exists to document.';

COMMENT ON COLUMN jobs.service_location IS
    'COARSENED at rest to the 0.01-degree grid (pii_coarsen_point) for rows written after migration 104. The exact point lives encrypted in service_location_encrypted. Unindexed; its only reader is GetJobLocation (services/job/internal/repository/matching.go), which seeds a 50 km provider-match radius and prefers the encrypted column. Rows still holding an exact point are listed by pii_exact_geometry_audit (migration 107).';

COMMENT ON COLUMN jobs.approximate_location IS
    'COARSENED at rest to the 0.01-degree grid (pii_coarsen_point). This is the ONLY spatially indexed column on jobs (idx_jobs_location, idx_jobs_location_geog) and the only ST_DWithin target (SearchJobs, GetJobsOnMap); both filters are kilometre-scale so the grid is immaterial to them. It is ALSO the column projected to GET /api/v1/jobs/map, which is unauthenticated and edge-cached — before migration 104 the write path copied the exact point here verbatim, publishing exact customer home coordinates to anonymous callers. It must never again be written from an un-coarsened point.';
