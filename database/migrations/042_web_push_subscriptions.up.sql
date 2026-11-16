-- Web Push subscriptions — buyers (and sellers) who opted into browser
-- push notifications for outbid / closing-soon events. Audit Section J
-- flagged push delivery as FCM-only; this table is the persistence layer
-- for the W3C Web Push API path so notifications survive without a native
-- app. Coexists with device_tokens (FCM/APNs) — services/notification
-- iterates both lists when fanning out a notification.
--
-- Schema notes:
--   - endpoint is the push service URL returned by the browser. UNIQUE on
--     (user_id, endpoint) makes re-subscription idempotent: the SDK gives
--     the same endpoint back when permission is already granted.
--   - p256dh_key + auth_key are the W3C VAPID keys returned alongside
--     endpoint. They are NOT secret — they're the public half used to
--     encrypt payloads to that subscription. Storing them base64url-
--     encoded as TEXT.
--   - user_agent is captured for observability (which browsers/devices
--     are subscribed) — not used for routing.
--   - last_seen_at gets bumped on every successful delivery so we can
--     prune stale rows that never returned 410 Gone.

CREATE TABLE push_subscriptions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint     TEXT NOT NULL,
    p256dh_key   TEXT NOT NULL,
    auth_key     TEXT NOT NULL,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, endpoint)
);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user_id);
