ALTER TABLE oauth_accounts
    DROP COLUMN IF EXISTS apple_refresh_token,
    DROP COLUMN IF EXISTS apple_client_id;
