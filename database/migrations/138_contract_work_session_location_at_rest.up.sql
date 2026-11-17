-- Migration 138 — the check-in / check-out coordinates on contract_work_sessions
-- are personal data stored in clear. Give them encrypted homes.
--
-- Builds on:
--   123 — contract_work_sessions (F1 proof of work). The durable record of a
--         provider's on-site check-in / check-out, and the authority for the
--         escrow-release gate (gateway/internal/handler/workspace_evidence.go).
--   104 / 105 — the "exact point encrypted as '<lat>,<lng>' text" shape used
--         for jobs.service_location_encrypted and properties.location_encrypted.
--
-- ── Why these coordinates are PII ────────────────────────────────────────
-- The gateway geo-fences check-in / check-out to within 500 m of the job's
-- service location (workspace.go enforceGeofence). So every accepted
-- check_in_lat / check_in_lng pair is, by construction, a point inside a few
-- hundred metres of a CUSTOMER HOME — the same secret migration 104 encrypted
-- in jobs.service_address and jobs.service_location_encrypted, in another
-- encoding. It is also a timestamped location trace of a named provider.
-- CLAUDE.md §6: "a point beside an encrypted address is the same secret in
-- another encoding". These columns are not indexed and are read by no query in
-- the tree (the work-session and work-evidence endpoints return timestamps and
-- durations only), so nothing prevents encrypting them.
--
-- ── What this migration does ─────────────────────────────────────────────
--   * check_in_location_encrypted / check_out_location_encrypted hold the
--     point as base64(nonce||secretbox) of "<lat>,<lng>" (7 decimal places),
--     exactly the wire format of jobs.service_location_encrypted.
--   * From this release the gateway writes ONLY the encrypted columns and
--     writes NULL into the four DOUBLE PRECISION columns.
--   * Existing rows are drained by database/cmd/encrypt-pii (`make
--     encrypt-pii`), which encrypts each plaintext pair into its sibling and
--     NULLs the pair in the same UPDATE — the DATE-pair shape of migration 106,
--     so a surviving non-NULL ordinate always means "not yet processed".
--     Migration 139 adds those columns to pii_plaintext_audit.
--
-- The plaintext columns are NOT dropped: an old gateway pod still serving
-- during a rolling deploy writes them, and dropping them would fail its
-- INSERT/UPDATE and lose the check-in. A later migration can drop them once
-- pii_plaintext_audit has stayed empty for a release.
--
-- No PII is read, copied or written here. Pure schema; reverses cleanly.

SET lock_timeout = '5s';

ALTER TABLE contract_work_sessions
    ADD COLUMN IF NOT EXISTS check_in_location_encrypted  TEXT,
    ADD COLUMN IF NOT EXISTS check_out_location_encrypted TEXT;

COMMENT ON COLUMN contract_work_sessions.check_in_location_encrypted IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305 of the provider''s check-in point, formatted "<lat>,<lng>" with 7 decimal places (the jobs.service_location_encrypted wire format). Geo-fenced to the job site, so it locates a customer home. Written by gateway/internal/handler/workspace.go persistCheckIn; read by the GDPR data export; nulled by GDPR erasure (services/user/internal/repository/gdpr.go). Backfilled from check_in_lat/check_in_lng by database/cmd/encrypt-pii (migration 138).';

COMMENT ON COLUMN contract_work_sessions.check_out_location_encrypted IS
    'PII at rest: base64(nonce||secretbox) XSalsa20-Poly1305 of the provider''s check-out point, formatted "<lat>,<lng>" with 7 decimal places. Written by gateway/internal/handler/workspace.go persistCheckOut. Backfilled from check_out_lat/check_out_lng by database/cmd/encrypt-pii (migration 138).';

COMMENT ON COLUMN contract_work_sessions.check_in_lat IS
    'LEGACY PLAINTEXT — no longer written as of migration 138 (the gateway writes check_in_location_encrypted and NULL here). A non-NULL value is a row not yet drained by database/cmd/encrypt-pii and is listed by pii_plaintext_audit (migration 139).';
COMMENT ON COLUMN contract_work_sessions.check_in_lng IS
    'LEGACY PLAINTEXT — see check_in_lat.';
COMMENT ON COLUMN contract_work_sessions.check_out_lat IS
    'LEGACY PLAINTEXT — no longer written as of migration 138 (the gateway writes check_out_location_encrypted and NULL here). A non-NULL value is a row not yet drained by database/cmd/encrypt-pii.';
COMMENT ON COLUMN contract_work_sessions.check_out_lng IS
    'LEGACY PLAINTEXT — see check_out_lat.';

COMMENT ON TABLE contract_work_sessions IS
    'F1 proof of work: provider on-site check-in/out. Authority for escrow release and for GET /contracts/{id}/work-session (Redis holds no copy as of migration 138). Retained for the life of the contract row (contracts are never hard-deleted — ledger retention, docs/operations/gdpr-delete.md); GDPR erasure keeps the timestamps and durations and nulls the coordinates.';
