-- Sign in with Apple token revocation (App Store Review Guideline 5.1.1(v)).
--
-- The gateway exchanges the single-use authorization code from iOS / the web
-- callback for an Apple refresh token and stores it here ENCRYPTED with the
-- shared ENCRYPTION_KEY secretbox (gateway/internal/crypto, decrypted by
-- services/user/internal/crypto). Plaintext tokens must never be written.
-- On account deletion the user service revokes the token at
-- https://appleid.apple.com/auth/revoke before the oauth_accounts row is
-- deleted by the GDPR cascade.
--
-- apple_token_client_id records which client_id (Services ID for web, bundle
-- ID for native) the token was issued to; revocation must use the same one.
-- Additive, nullable, no default: metadata-only change, no table rewrite.

ALTER TABLE oauth_accounts
    ADD COLUMN IF NOT EXISTS apple_refresh_token_enc TEXT,
    ADD COLUMN IF NOT EXISTS apple_token_client_id   TEXT,
    ADD COLUMN IF NOT EXISTS apple_token_updated_at  TIMESTAMPTZ;
