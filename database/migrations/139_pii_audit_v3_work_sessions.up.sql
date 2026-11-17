-- Migration 139 — pii_plaintext_audit, third edition: cover the work-session
-- coordinates migration 138 moved into encrypted columns.
--
-- Builds on 098 (pii_looks_like_secretbox, the view), 107 (second edition)
-- and 138 (contract_work_sessions.check_{in,out}_location_encrypted).
--
-- The four DOUBLE PRECISION ordinates are drained the way 106 drains its DATE
-- columns: database/cmd/encrypt-pii encrypts the pair into its *_encrypted
-- sibling and NULLs the pair in the SAME UPDATE, and from 138 the gateway never
-- writes them. So a surviving non-NULL ordinate IS the plaintext — no shape
-- test applies or is needed. Either ordinate of a pair being present lists the
-- row, so a half-written pair cannot hide.
--
-- CREATE OR REPLACE is enough here (107 had to DROP because it changed a
-- column's type): the output columns are unchanged, only rows are added. The
-- body below is 107's verbatim plus the final two branches.
--
-- Views and comments only; no row and no PII value is read or written.

SET lock_timeout = '5s';

CREATE OR REPLACE VIEW pii_plaintext_audit AS
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
       AND NOT pii_looks_like_secretbox(license_number)

    -- ── 138: work-session coordinates drained into encrypted siblings ──
    -- contract_work_sessions has no pii_encrypted_v1 flag, so NULL::BOOLEAN.
UNION ALL
    SELECT 'contract_work_sessions', 'check_in_lat_lng', id, NULL::BOOLEAN
      FROM contract_work_sessions
     WHERE check_in_lat IS NOT NULL OR check_in_lng IS NOT NULL
UNION ALL
    SELECT 'contract_work_sessions', 'check_out_lat_lng', id, NULL::BOOLEAN
      FROM contract_work_sessions
     WHERE check_out_lat IS NOT NULL OR check_out_lng IS NOT NULL;

COMMENT ON VIEW pii_plaintext_audit IS
    'Every at-rest PII value that is DEFINITELY still plaintext. TEXT columns fail pii_looks_like_secretbox (migration 098); the DATE columns from migration 106 (users.dob, provider_employees.date_of_birth) and the work-session ordinates from migration 138 (contract_work_sessions.check_in_lat/lng, check_out_lat/lng — reported per pair as check_in_lat_lng / check_out_lat_lng) qualify by being non-NULL at all, since the backfill clears them as it encrypts. Empty on a fully backfilled database. Run `make encrypt-pii` to drain it, then check pii_exact_geometry_audit too — this view says nothing about geometry. Exposes table/column/row id only, never the value. pii_encrypted_v1 is NULL for tables that have no such flag (jobs, provider_licenses, contract_work_sessions) and is advisory everywhere else. Extended by migrations 107 and 139.';
