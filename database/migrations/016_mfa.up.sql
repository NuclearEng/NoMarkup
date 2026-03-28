-- MFA partial index for quick lookup of MFA-enabled users.
-- The mfa_enabled, mfa_secret, and mfa_backup_codes columns already exist
-- in the users table (added in 001_initial_schema).

CREATE INDEX IF NOT EXISTS idx_users_mfa_enabled ON users (id) WHERE mfa_enabled = true;
