-- 100_refresh_token_family_lineage.up.sql
--
-- Refresh-token REUSE DETECTION (SEC).
--
-- Before this migration a replayed (already-rotated) refresh token was simply
-- rejected. That silently discards the single most reliable compromise signal
-- an auth system gets: if an attacker steals a refresh token and spends it
-- before the victim's next refresh, the attacker holds a valid rolling session
-- and the victim's replay is a quiet 401 that just looks like "logged out".
--
-- Detecting that requires knowing which tokens descend from the same login, so
-- that the whole lineage can be killed at once. This migration adds that
-- lineage.
--
--   family_id  Constant across an entire rotation chain. A fresh
--              login/register/OAuth mints a NEW family; every rotation inherits
--              its parent's. Revoking a family therefore revokes exactly one
--              device's session lineage and nothing else.
--
--              DEFAULT gen_random_uuid() is deliberate and load-bearing for the
--              rolling deploy: a pre-100 binary still issuing the old INSERT
--              column list keeps working and just starts a singleton family
--              (degraded lineage, never a failed insert and never a logged-out
--              user). The default is VOLATILE, so the ADD COLUMN rewrites the
--              table and gives every PRE-EXISTING token its own distinct
--              family — which is precisely the correct backfill: sessions
--              minted before this deploy have no known lineage, so each is
--              treated as its own family and keeps working.
--
--   parent_id  The token this one was rotated from. Forensics/audit only; the
--              revoke path uses family_id. ON DELETE SET NULL so pruning old
--              tokens never cascades into live descendants.
--
--   rotated_at Set ONLY by the rotation path. This is what makes the signal
--              precise rather than noisy: revoked_at is ALSO set by logout,
--              password change and admin revoke, and replaying one of those is
--              not evidence of theft. `rotated_at IS NOT NULL` means "this
--              token was consumed and has a successor" — presenting it again
--              is, outside a short grace window, unambiguous reuse.
--
-- refresh_tokens is bounded by a 7-day TTL, so the rewrite is cheap.

ALTER TABLE refresh_tokens
    ADD COLUMN family_id  UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN parent_id  UUID REFERENCES refresh_tokens (id) ON DELETE SET NULL,
    ADD COLUMN rotated_at TIMESTAMPTZ;

-- Family revocation targets only the still-live descendants; the partial index
-- matches the `WHERE family_id = $1 AND revoked_at IS NULL` revoke statement.
CREATE INDEX idx_refresh_tokens_family_active
    ON refresh_tokens (family_id)
    WHERE revoked_at IS NULL;

-- Index every FK (CLAUDE.md §5). Without this, ON DELETE SET NULL forces a
-- seq scan of refresh_tokens on every parent-row delete.
CREATE INDEX idx_refresh_tokens_parent_id
    ON refresh_tokens (parent_id);

COMMENT ON COLUMN refresh_tokens.family_id IS
    'Session lineage id, constant across a rotation chain. Reuse of an already-rotated token revokes the entire family.';
COMMENT ON COLUMN refresh_tokens.parent_id IS
    'Token this one was rotated from. Forensics only; revocation keys off family_id.';
COMMENT ON COLUMN refresh_tokens.rotated_at IS
    'Set only when the token was consumed by rotation. Distinguishes theft-replay from a benign logout/password-change replay.';
