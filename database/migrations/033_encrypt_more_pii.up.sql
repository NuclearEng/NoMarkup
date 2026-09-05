-- 033: Extend at-rest PII encryption to provider_employees and properties.
--
-- Closes the second-pass audit gap from docs/operations/readiness-final.md.
-- Migration 031 covered users + provider_profiles. This pass adds:
--
--   provider_employees.email                  — encrypted (employee PII; not auth)
--   provider_employees.phone                  — encrypted
--   provider_employees.license_number         — encrypted (issued credential)
--   provider_employees.insurance_policy_number — encrypted
--   properties.address                        — encrypted (street; city/state/zip
--                                                stay plaintext for indexed search
--                                                and geo filtering)
--   properties.notes                          — encrypted (gate codes / access)
--
-- Skipped intentionally:
--   provider_employees.last_name / first_name — display only, no PII gain
--     once email+phone are protected and admin already sees it server-side.
--   properties.city / state / zip_code / location — needed for ILIKE search
--     and PostGIS proximity (cannot index ciphertext).
--   company_employees.ssn_last_four — table is unused by Go code today
--     (no reads/writes anywhere). Will be addressed when the table is wired
--     up; encrypting now would only encrypt empty rows.
--   users.email — auth lookup, must stay plaintext.
--
-- The actual ciphertext lives in the existing TEXT columns (base64 of
-- nonce||secretbox), produced by `database/cmd/encrypt-pii/main.go`. This
-- migration only adds the per-row pii_encrypted_v1 flags + indexes.

ALTER TABLE provider_employees
    ADD COLUMN IF NOT EXISTS pii_encrypted_v1 BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE properties
    ADD COLUMN IF NOT EXISTS pii_encrypted_v1 BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_provider_employees_pii_encrypted_v1
    ON provider_employees (pii_encrypted_v1)
    WHERE pii_encrypted_v1 = FALSE;

CREATE INDEX IF NOT EXISTS idx_properties_pii_encrypted_v1
    ON properties (pii_encrypted_v1)
    WHERE pii_encrypted_v1 = FALSE AND deleted_at IS NULL;

COMMENT ON COLUMN provider_employees.pii_encrypted_v1 IS
    'TRUE when email/phone/license_number/insurance_policy_number are nacl/secretbox ciphertext. Toggled by database/cmd/encrypt-pii.';
COMMENT ON COLUMN properties.pii_encrypted_v1 IS
    'TRUE when address/notes are nacl/secretbox ciphertext. city/state/zip_code stay plaintext for indexed search.';
