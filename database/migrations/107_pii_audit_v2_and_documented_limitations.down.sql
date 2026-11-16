-- Down for 107. Restores migration 098's pii_plaintext_audit verbatim and
-- drops the geometry audit and the two limitation comments.
--
-- No PII value was read, copied or written by the up migration, so this is a
-- pure schema-object rollback. Note that rolling back RE-INTRODUCES the defect
-- 107 fixed: the restored view stops reporting jobs.service_address,
-- users.dob, provider_employees.date_of_birth and
-- provider_licenses.license_number, so an empty audit would once again certify
-- a database holding plaintext customer home addresses. Roll back only in
-- development, and only together with 104-106.

SET lock_timeout = '5s';

DROP VIEW IF EXISTS pii_exact_geometry_audit;
DROP VIEW IF EXISTS pii_plaintext_audit;

-- Verbatim reconstruction of the view as migration 098 created it.
CREATE VIEW pii_plaintext_audit AS
    SELECT 'users'::TEXT AS table_name, 'phone'::TEXT AS column_name, id, pii_encrypted_v1
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
       AND NOT pii_looks_like_secretbox(notes);

COMMENT ON VIEW pii_plaintext_audit IS
    'Every at-rest PII value that is DEFINITELY still plaintext (it fails pii_looks_like_secretbox). Empty on a fully backfilled database. Run `make encrypt-pii` to drain it. Exposes table/column/row id only — never the value. See migration 098.';

-- Neither column carried a COMMENT before 107.
COMMENT ON COLUMN provider_profiles.service_location IS NULL;
COMMENT ON COLUMN listings.location IS NULL;
