-- Migration 140 — durable storage for calendar feed tokens.
--
-- POST /api/v1/me/calendar-feed mints an opaque 32-byte secret that a calendar
-- app (Apple Calendar, Google, Outlook) then polls as
-- GET /api/v1/me/calendar.ics?feed=<secret> for 90 days
-- (gateway/internal/handler/calendar_export.go). Until now SHA-256(secret)
-- lived only in Redis under nomarkup:calfeed:{hash} with a 90-day TTL.
--
-- Production Redis runs maxmemory-policy volatile-lru: ANY key with a TTL is an
-- eviction candidate under memory pressure. An evicted feed key makes every
-- poll 401, and calendar clients do not tell the user — the subscribed
-- calendar just silently stops updating. A credential the user configured once
-- in a third-party app must not be evictable, so it moves here.
--
-- ── Shape ────────────────────────────────────────────────────────────────
--   * token_hash is lowercase hex SHA-256 of the secret — the same value the
--     Redis key carried. The raw secret is never stored (it is 256 bits of
--     CSPRNG output, so an unsalted fast hash is the right tool, as for any
--     high-entropy bearer token; there is nothing to brute-force).
--   * expires_at carries the 90-day semantics. Reads require
--     expires_at > now(), so an expired row is dead even before it is pruned.
--   * Expired rows are pruned opportunistically when a feed is minted (the
--     notification_send_ledger pattern — no dedicated sweeper), bounded per
--     call; idx_calendar_feed_tokens_expires_at backs that prune.
--   * GDPR erasure DELETEs a user's rows (services/user/internal/repository/
--     gdpr.go) — a feed token is a bearer credential like refresh_tokens.
--     users rows are anonymised, never hard-deleted, so the FK cascade is a
--     belt-and-braces backstop only.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
    token_hash  TEXT        PRIMARY KEY
                            CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_calendar_feed_tokens_user_id
    ON calendar_feed_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_calendar_feed_tokens_expires_at
    ON calendar_feed_tokens (expires_at);

COMMENT ON TABLE calendar_feed_tokens IS
    'Opaque ICS subscription credentials: SHA-256(secret) -> user_id, valid until expires_at (90 days from mint). The raw secret is never stored. Authority for GET /api/v1/me/calendar.ics?feed= (gateway/internal/handler/calendar_export.go). Moved out of evictable Redis (nomarkup:calfeed:*) by migration 140. Expired rows pruned on mint; erased with the user (GDPR).';

COMMENT ON COLUMN calendar_feed_tokens.token_hash IS
    'Lowercase hex SHA-256 of the 64-hex-char feed secret. Never the secret itself.';
