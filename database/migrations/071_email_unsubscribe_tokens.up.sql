-- 071: Create email_unsubscribe_tokens.
--
-- The notification service's DisableEmailByToken (services/notification/internal/
-- repository/postgres.go) and the public POST /api/v1/notifications/unsubscribe
-- handler both query email_unsubscribe_tokens, but no migration ever created it.
-- Every unsubscribe link therefore failed with a raw "relation does not exist"
-- error — which is NOT pgx.ErrNoRows, so the intended 404 "invalid token" path
-- was never reached and the endpoint returned 500 for every token. The public,
-- unauthenticated unsubscribe surface (every CAN-SPAM-required email link) was
-- completely broken.
--
-- One row per issued unsubscribe link: a high-entropy token mapped to the user,
-- single-use via used_at. The lookup is `WHERE token = $1 AND used_at IS NULL`,
-- so the UNIQUE(token) index serves it directly.
CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FK index for cascade deletes and per-user token lookups.
CREATE INDEX IF NOT EXISTS idx_email_unsubscribe_tokens_user_id
    ON email_unsubscribe_tokens (user_id);
