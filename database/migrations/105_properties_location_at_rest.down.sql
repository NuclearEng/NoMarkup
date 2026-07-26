-- Down for 105.
--
-- Pure schema-object rollback: the up migration added one nullable column and
-- four comments, and touched no PII value.
--
-- WARNING: dropping location_encrypted discards the only surviving copy of the
-- exact property point for every row `make encrypt-pii` has already coarsened.
-- A 0.01-degree grid cell cannot be un-rounded. Restore a pre-105 dump if you
-- need the exact coordinates back.

SET lock_timeout = '5s';

ALTER TABLE properties DROP COLUMN IF EXISTS location_encrypted;

-- properties.location, .address and .notes carried no COMMENT before 105 (033
-- documented them with `--` SQL comments, which never reach pg_description),
-- so NULL is the exact prior state.
COMMENT ON COLUMN properties.location IS NULL;
COMMENT ON COLUMN properties.address IS NULL;
COMMENT ON COLUMN properties.notes IS NULL;
