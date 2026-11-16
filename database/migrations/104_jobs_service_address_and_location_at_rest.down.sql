-- Down for 104.
--
-- The up migration added one nullable column and two IMMUTABLE functions, and
-- rewrote three column comments. It read, copied and wrote no PII, so this is
-- a pure schema-object rollback with nothing to restore.
--
-- WARNING, and it is the same one 031/033 carry: dropping
-- service_location_encrypted DISCARDS the only remaining copy of the exact
-- service point for every row the backfill has already coarsened. The
-- geometry columns hold the 0.01-degree grid cell and cannot be un-rounded.
-- Restore a pre-104 dump if you need the exact points back; do not run this
-- against a database where `make encrypt-pii` has completed unless you accept
-- that loss.
--
-- jobs.service_address itself is NOT decrypted here. Reversing that requires
-- ENCRYPTION_KEY and a Go tool, exactly as 031's down migration notes for
-- provider_profiles. Rolling back leaves the column ciphertext; the read path
-- from a pre-104 binary will hand base64 to its callers. Roll the code back
-- with it.

SET lock_timeout = '5s';

-- pii_coarsen_point depends on pii_coarsen_ordinate, so it goes first.
DROP FUNCTION IF EXISTS pii_coarsen_point(geometry);
DROP FUNCTION IF EXISTS pii_coarsen_ordinate(DOUBLE PRECISION);

ALTER TABLE jobs DROP COLUMN IF EXISTS service_location_encrypted;

-- Restore 001's inline documentation as durable comments. 001 wrote them as
-- `--` SQL comments, which are discarded at parse time and never reached
-- pg_description, so strictly the prior state was NULL; NULL is what we set,
-- rather than re-asserting claims 104 proved false.
COMMENT ON COLUMN jobs.service_address IS NULL;
COMMENT ON COLUMN jobs.service_location IS NULL;
COMMENT ON COLUMN jobs.approximate_location IS NULL;
