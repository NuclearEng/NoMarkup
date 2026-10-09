-- FR-2.9 Checkr scaffold: provider-level background check rows + feature flag.
--
-- Ships DISABLED. Gateway routes POST/GET /api/v1/providers/me/background-check
-- are gated by RequireFlag("background_checks") which fails closed in production.
-- When the flag is on but CHECKR_API_KEY is unset, the write path returns 503
-- (fail-closed — never invent a PASS). With the key set, the gateway calls the
-- real Checkr HTTP API (create candidate + invitation/report).
--
-- Column notes:
--   checkr_id    Checkr candidate id (primary external handle) and/or report id
--                once a report exists (stored as candidate id; report id lives in
--                report_url when Checkr returns an invitation/report link).
--   status       Vendor-shaped values only: not_started | pending | clear |
--                consider | suspended | canceled | dispute | complete.
--                Never "passed" / fake PASS — Clear/Consider come from Checkr.
--   report_url   Invitation URL or Checkr dashboard/report link when available.

CREATE TABLE provider_background_checks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending'
        CONSTRAINT provider_background_checks_status_check
        CHECK (status IN (
            'not_started',
            'pending',
            'clear',
            'consider',
            'suspended',
            'canceled',
            'dispute',
            'complete'
        )),
    checkr_id   TEXT,
    report_url  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_updated_at_provider_background_checks
    BEFORE UPDATE ON provider_background_checks
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Latest-check lookup + list history for a provider.
CREATE INDEX idx_provider_background_checks_user_created
    ON provider_background_checks (user_id, created_at DESC);

COMMENT ON TABLE provider_background_checks IS
    'FR-2.9 Checkr scaffold: one row per background-check request for a provider user.';

-- Feature flag: ships DISABLED. Plain (non-money) flag — sticky % allowed.
-- ON CONFLICT DO NOTHING so re-run / admin choice is never clobbered.
INSERT INTO feature_flags (key, enabled, description) VALUES
    (
        'background_checks',
        false,
        'Provider Checkr background checks (gateway /providers/me/background-check; fail-closed without CHECKR_API_KEY)'
    )
ON CONFLICT (key) DO NOTHING;
