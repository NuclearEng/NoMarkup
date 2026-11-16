-- Reverse migration 043. Cascading drops drop dependent indexes/constraints.

DROP TABLE IF EXISTS bid_bonds;
DROP TABLE IF EXISTS tos_acceptances;
DROP TABLE IF EXISTS tos_versions;
DROP TABLE IF EXISTS cookie_consent_log;

ALTER TABLE users DROP COLUMN IF EXISTS dob_verified_at;
ALTER TABLE users DROP COLUMN IF EXISTS dob;
