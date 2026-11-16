-- Wave 5: Communication polish — closes audit Section F (anonymous email/phone
-- relay missing, no block/report, no quick-reply templates).
--
-- Three additive tables, all owned by Wave 5 / Agent P:
--
--   1. chat_aliases       — Per-user, per-context proxy alias. Maps an
--                            alias-{nanoid}@relay.nomarkup.com email plus
--                            (optionally) a Twilio proxy phone to the real
--                            user. The notification service rewrites the
--                            From: header on outbound mail when the
--                            recipient hasn't replied yet so the seller's
--                            real address never leaks. expires_at is
--                            nullable; when set, the inbound forwarder
--                            refuses to deliver after expiry.
--
--   2. user_blocks        — Buyer/seller mutual blocks. A row blocks all
--                            future chat messages from blocked_id to
--                            blocker_id and prevents blocked_id from
--                            bidding on any of blocker_id's listings.
--                            CHECK rejects self-blocks at the DB layer; the
--                            gateway also rejects them before insert.
--
--   3. message_templates  — Per-user quick-reply snippets. use_count is
--                            bumped each time the template fires, sorting
--                            "What's your best price?" above the cold
--                            ones. NOT seeded here — the empty-state UI
--                            falls back to a built-in default list when
--                            the user has no rows yet.
--
-- Pattern matches migrations 037 (watchlist), 041 (follows), 042 (push):
-- UUID v4 PKs, ON DELETE CASCADE on user FKs so the GDPR erasure pipeline
-- (migration 032) keeps referential integrity.

CREATE TABLE chat_aliases (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    context_type        TEXT NOT NULL CHECK (context_type IN ('listing','job')),
    context_id          UUID NOT NULL,
    email_alias         TEXT UNIQUE NOT NULL,
    twilio_proxy_phone  TEXT UNIQUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ,
    UNIQUE (user_id, context_type, context_id)
);

CREATE INDEX idx_chat_aliases_email_alias ON chat_aliases (email_alias);
CREATE INDEX idx_chat_aliases_context     ON chat_aliases (context_type, context_id);

CREATE TABLE user_blocks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)
);
CREATE INDEX idx_user_blocks_blocker ON user_blocks (blocker_id);
CREATE INDEX idx_user_blocks_blocked ON user_blocks (blocked_id);

CREATE TABLE message_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
    use_count   INT  NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_message_templates_user ON message_templates (user_id, use_count DESC);
