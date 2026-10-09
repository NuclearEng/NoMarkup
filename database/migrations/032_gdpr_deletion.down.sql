-- Rollback for 032_gdpr_deletion.up.sql.
DROP INDEX IF EXISTS idx_users_deletion_pending;

ALTER TABLE users
    DROP COLUMN IF EXISTS deletion_requested_at,
    DROP COLUMN IF EXISTS deletion_reason,
    DROP COLUMN IF EXISTS deletion_finalized_at;
