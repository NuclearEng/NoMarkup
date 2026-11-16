-- 132: GDPR-scoped server-side API hop log (Account / Settings → Request log).
-- Device-local request logs die on reinstall; this table is the durable copy.
--
-- NEVER store bodies, Authorization, cookies, query strings, or IP.
-- Path is query/hash-stripped at the gateway (max 200). user_id is NULL for
-- unauthenticated hops; owner-only GET /api/v1/me/activity filters on it.
-- ON DELETE CASCADE erases a subject's rows with the user (GDPR erasure).

CREATE TABLE user_request_activity (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    request_id  TEXT NOT NULL,
    method      TEXT NOT NULL,
    path        TEXT NOT NULL,
    status      INT NOT NULL,
    duration_ms INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_request_activity_request_id_len
        CHECK (char_length(request_id) > 0 AND char_length(request_id) <= 64),
    CONSTRAINT user_request_activity_method_len
        CHECK (char_length(method) > 0 AND char_length(method) <= 16),
    CONSTRAINT user_request_activity_path_len
        CHECK (char_length(path) > 0 AND char_length(path) <= 200),
    CONSTRAINT user_request_activity_path_no_query
        CHECK (path NOT LIKE '%?%' AND path NOT LIKE '%#%'),
    CONSTRAINT user_request_activity_status_range
        CHECK (status >= 100 AND status <= 599),
    CONSTRAINT user_request_activity_duration_nonneg
        CHECK (duration_ms >= 0)
);

CREATE INDEX idx_user_request_activity_user_created
    ON user_request_activity (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

CREATE INDEX idx_user_request_activity_request_id
    ON user_request_activity (request_id);

CREATE INDEX idx_user_request_activity_created
    ON user_request_activity (created_at DESC);

COMMENT ON TABLE user_request_activity IS
    'GDPR-scoped API hop log. No bodies, Authorization, cookies, query strings, or IP.';
