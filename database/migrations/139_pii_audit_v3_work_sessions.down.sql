-- Down for 139: restore migration 107's pii_plaintext_audit verbatim. Rolling
-- back stops the view reporting plaintext work-session coordinates, so an
-- empty audit would again certify a database holding them. Development only,
-- and only together with 138.

SET lock_timeout = '5s';

-- CREATE OR REPLACE suffices: the output columns are the same, only the two
-- 139 branches are removed.
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
       AND NOT pii_looks_like_secretbox(license_number);

COMMENT ON VIEW pii_plaintext_audit IS
    'Every at-rest PII value that is DEFINITELY still plaintext. TEXT columns fail pii_looks_like_secretbox (migration 098); the DATE columns from migration 106 (users.dob, provider_employees.date_of_birth) qualify by being non-NULL at all, since the backfill clears them as it encrypts. Empty on a fully backfilled database. Run `make encrypt-pii` to drain it, then check pii_exact_geometry_audit too — this view says nothing about geometry. Exposes table/column/row id only, never the value. pii_encrypted_v1 is NULL for tables that have no such flag (jobs, provider_licenses) and is advisory everywhere else. Extended by migration 107.';
