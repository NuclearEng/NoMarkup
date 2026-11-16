-- ARC-10: optional sticky % rollout foundation on binary feature flags.
--
-- enabled remains the master kill switch. When enabled=true:
--   rollout_percent = 100 → all subjects (current behaviour)
--   rollout_percent = 0   → none (same effect as disabled for gated routes)
--   1..99                 → sticky cohort via SHA256(subject|key) % 100
--
-- Money / regulated keys MUST stay binary (0 or 100). Gateway enforces that
-- at read (fail-closed on partial) and admin write (reject 1-99). Public
-- GET /api/v1/flags stays a flat bool map (CDN-cacheable; no per-user %).
-- This is NOT a full experiment platform (no multi-arm, no analysis warehouse).

ALTER TABLE feature_flags
    ADD COLUMN rollout_percent SMALLINT NOT NULL DEFAULT 100
    CONSTRAINT feature_flags_rollout_percent_range
        CHECK (rollout_percent >= 0 AND rollout_percent <= 100);

COMMENT ON COLUMN feature_flags.rollout_percent IS
    'Sticky percent (0-100) allowed when enabled=true. Money/regulated flags must be 0 or 100 only.';
