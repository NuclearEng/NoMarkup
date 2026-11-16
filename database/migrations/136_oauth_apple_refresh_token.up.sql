-- Sign in with Apple refresh tokens, kept so account deletion can call
-- POST https://appleid.apple.com/auth/revoke. The refresh token is
-- nacl/secretbox ciphertext (same wire format as other PII). apple_client_id
-- is the client_id sent to Apple's token endpoint (bundle id or Services ID).
-- It is not a secret. APPLE_CLIENT_SECRET stays in the environment.

ALTER TABLE oauth_accounts
    ADD COLUMN apple_refresh_token TEXT,
    ADD COLUMN apple_client_id TEXT;

COMMENT ON COLUMN oauth_accounts.apple_refresh_token IS
    'XSalsa20-Poly1305 ciphertext of the Apple refresh token. Used only for auth/revoke on account deletion.';
