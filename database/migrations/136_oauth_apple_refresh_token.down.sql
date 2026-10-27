-- Dev-only rollback. Dropping these columns discards stored Apple refresh
-- tokens, so accounts deleted afterwards cannot be revoked at Apple.
ALTER TABLE oauth_accounts
    DROP COLUMN IF EXISTS apple_token_updated_at,
    DROP COLUMN IF EXISTS apple_token_client_id,
    DROP COLUMN IF EXISTS apple_refresh_token_enc;
