-- 100_refresh_token_family_lineage.down.sql
--
-- Reverses the refresh-token lineage columns. Dropping these degrades the
-- service back to "replayed token is silently rejected" but does not log
-- anybody out: the rotation gate itself is revoked_at, which is untouched.

DROP INDEX IF EXISTS idx_refresh_tokens_parent_id;
DROP INDEX IF EXISTS idx_refresh_tokens_family_active;

ALTER TABLE refresh_tokens
    DROP COLUMN IF EXISTS rotated_at,
    DROP COLUMN IF EXISTS parent_id,
    DROP COLUMN IF EXISTS family_id;
