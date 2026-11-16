-- User & message abuse reports — closes the user-safety gap where only
-- listings could be flagged (migration 036's listing_reports), leaving no
-- path to report an abusive USER or a specific harassing MESSAGE.
--
-- Mirrors the shape of listing_reports (036) so the admin moderation surface
-- and the resolve lifecycle generalize:
--
--   * reporter_id      — the authed user filing the report (NOT NULL here;
--                        unlike listing_reports we never accept anonymous
--                        user-on-user reports — the reporter is always known
--                        for the abuse trail and to enforce no-self-report).
--   * reported_user_id — the target being flagged.
--   * channel_id /     — optional chat context: when a report originates from
--     message_id          a conversation we capture where, so a moderator can
--                         see the offending thread/message. Both nullable so a
--                         report from a profile page (no chat) is still valid.
--   * reason           — bounded enum, abuse-flavored (vs listing_reports'
--                        stolen/counterfeit set).
--   * status lifecycle — open → reviewed → actioned → dismissed, identical to
--                        listing_reports so the admin ResolveReport pattern and
--                        the admin queue UI carry over.
--
-- Anti-abuse: a partial UNIQUE index dedups an OPEN report from the same
-- reporter against the same target (collapsing on the message when present,
-- otherwise on the user) so one user can't spam-flag the same target while a
-- report is still open. Once resolved, a fresh report is allowed.

CREATE TABLE IF NOT EXISTS user_reports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Optional chat context.
    channel_id          UUID,
    message_id          UUID,
    reason              TEXT NOT NULL CHECK (reason IN (
        'harassment', 'spam', 'scam', 'inappropriate', 'other'
    )),
    description         TEXT NOT NULL DEFAULT '',
    -- Lifecycle (matches listing_reports).
    status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'reviewed', 'actioned', 'dismissed'
    )),
    reviewed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at         TIMESTAMPTZ,
    resolution          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A reporter cannot report themselves (also rejected at the gateway).
    CHECK (reporter_id != reported_user_id)
);

-- FK indexes (every FK + WHERE/ORDER BY column).
CREATE INDEX IF NOT EXISTS idx_user_reports_reported_user
    ON user_reports (reported_user_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_reporter
    ON user_reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_status
    ON user_reports (status, created_at DESC);

-- Dedup OPEN reports. Two partial uniques: one when a message is named
-- (collapse on that message), one when it isn't (collapse on the target user).
-- COALESCE keeps the two indexes from overlapping on the same row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_reports_open_message
    ON user_reports (reporter_id, message_id)
    WHERE status = 'open' AND message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_reports_open_user
    ON user_reports (reporter_id, reported_user_id)
    WHERE status = 'open' AND message_id IS NULL;

-- updated_at maintenance — reuse the shared trigger fn used by listings/
-- listing_reports (defined in earlier migrations). Falls back gracefully if
-- absent.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'trigger_listings_set_updated_at'
    ) THEN
        DROP TRIGGER IF EXISTS user_reports_set_updated_at ON user_reports;
        CREATE TRIGGER user_reports_set_updated_at
            BEFORE UPDATE ON user_reports
            FOR EACH ROW EXECUTE FUNCTION trigger_listings_set_updated_at();
    END IF;
END $$;
