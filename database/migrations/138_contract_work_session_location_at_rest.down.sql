-- Reverse migration 138. Dropping the encrypted columns discards every
-- coordinate written by a gateway at or after 138 (those rows hold NULL in the
-- plaintext columns), so in a database that has served traffic, decrypt them
-- back into check_*_lat/lng first. Development only — production is
-- forward-only (CLAUDE.md §5).

SET lock_timeout = '5s';

ALTER TABLE contract_work_sessions
    DROP COLUMN IF EXISTS check_out_location_encrypted,
    DROP COLUMN IF EXISTS check_in_location_encrypted;

COMMENT ON COLUMN contract_work_sessions.check_in_lat IS NULL;
COMMENT ON COLUMN contract_work_sessions.check_in_lng IS NULL;
COMMENT ON COLUMN contract_work_sessions.check_out_lat IS NULL;
COMMENT ON COLUMN contract_work_sessions.check_out_lng IS NULL;

COMMENT ON TABLE contract_work_sessions IS
    'F1 proof of work: provider on-site check-in/out. Authority for escrow release (not Redis).';
