-- Migration 105 — properties.location is the coordinate of a customer's home,
-- sitting beside an address column that 033 encrypted. Close the pair.
--
-- Builds on:
--   033 — encrypted properties.address and properties.notes, and recorded in
--         its header that `location` was skipped because it was "needed for
--         ILIKE search and PostGIS proximity (cannot index ciphertext)"
--   104 — pii_coarsen_point / pii_coarsen_ordinate, and the rationale for
--         coarsen-at-rest + encrypt-the-exact-point-alongside
--
-- ── 033's stated reason for skipping this column is not true ─────────────
-- It was reasonable to assume, and it was never checked. properties.location
-- is used by NO proximity query anywhere in the tree:
--
--   * It has no spatial index. properties carries only idx_properties_user,
--     idx_properties_zip, idx_properties_user_fk and the pii flag index —
--     there is no GiST index on this column in 001 or in 064, which is the
--     migration that added the geography-cast GiST indexes for the three
--     columns that DO get searched (jobs.approximate_location,
--     listings.location, provider_profiles.service_location).
--
--   * No ST_DWithin, ST_Distance or ST_DistanceSphere anywhere in Go, Rust or
--     SQL references it.
--
--   * The ILIKE search 033 mentions runs against city / state / zip_code,
--     which are separate plaintext columns and stay that way.
--
-- Every read is a plain projection of the ordinates back to the owning user:
--   services/user/internal/repository/postgres.go:1915 (CreateProperty
--   RETURNING), :1948 (ListProperties), :2063 (getPropertyByID) — all
--   `ST_X(location) AS longitude, ST_Y(location) AS latitude` — plus one
--   server-side read in services/job/internal/repository/postgres.go:39,
--   which lifts the linked property's coordinates to seed a new job's service
--   point.
--
-- So the functional constraint that justified leaving a home coordinate in
-- clear does not exist. The column is a plaintext copy of the street address
-- 033 encrypted, reachable by reverse geocoding, and nothing indexes it.
--
-- ── What this migration does ─────────────────────────────────────────────
-- The same shape as 104, for the same reasons:
--
--   * location_encrypted holds the EXACT point as ciphertext, so the change
--     is reversible by anyone holding ENCRYPTION_KEY. Coarsening alone would
--     destroy precision that no down migration could restore.
--
--   * The location geometry is coarsened to the 0.01-degree grid by the Go
--     backfill, AFTER the encrypted copy is committed in the same
--     transaction. It stays populated because the column is NOT NULL and
--     because GDPR erasure (services/user/internal/repository/gdpr.go:294)
--     relies on being able to write ST_MakePoint(0,0) into it.
--
--   * Read paths prefer the encrypted column and fall back to the geometry,
--     so a property created before 105 keeps returning its exact pin and the
--     job-creation lookup keeps getting an exact centre.
--
-- Precision cost where the encrypted column is absent: the owner's own map pin
-- and the derived job centre move by at most half a grid diagonal, ~0.79 km.
-- No filter, sort or match score reads this column, so nothing else can shift.
--
-- No PII is read, copied or written here. Pure schema; reverses cleanly.

SET lock_timeout = '5s';

ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS location_encrypted TEXT;

COMMENT ON COLUMN properties.location_encrypted IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305 of the EXACT property point, formatted "<lat>,<lng>" with 7 decimal places. Written by services/user/internal/repository CreateProperty; read (preferentially, with fallback to the coarsened location geometry) by CreateProperty RETURNING, ListProperties, getPropertyByID and by services/job CreateJob when deriving a job service point from a linked property. Backfilled by database/cmd/encrypt-pii. NULL means the row predates migration 105 — see pii_exact_geometry_audit (migration 107). Detection is per VALUE; do NOT branch on properties.pii_encrypted_v1, which is advisory (migration 098).';

COMMENT ON COLUMN properties.location IS
    'COARSENED at rest to the 0.01-degree grid (pii_coarsen_point, migration 104) for rows processed after migration 105; the exact point lives encrypted in location_encrypted. This column has NO spatial index and is referenced by no ST_DWithin / ST_Distance / ST_DistanceSphere anywhere in the tree — migration 033 skipped encrypting it on the assumption that proximity search needed it, and that assumption was wrong. It stays a populated NOT NULL geometry because GDPR erasure writes ST_MakePoint(0,0) into it.';

-- 033 described its own skip list in a header nobody reads from a psql
-- prompt. Record the outcome where \d+ will show it.
COMMENT ON COLUMN properties.address IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305 — a CUSTOMER HOME street address. Encrypted on write / decrypted on read by services/user/internal/repository. city/state/zip_code remain plaintext deliberately: they back indexed search (idx_properties_zip) and are the coarse location the product already shows.';

COMMENT ON COLUMN properties.notes IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305. Free text that in practice holds gate codes and access instructions, which is why it is treated as secret rather than as a label.';
