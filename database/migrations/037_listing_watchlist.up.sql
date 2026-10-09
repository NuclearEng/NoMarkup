-- Goods marketplace v1.1 — retention loop.
--
-- Two new surfaces:
--
--   1. listing_watchlist  — buyers can favorite a listing without bidding.
--      The auction notification scheduler fans closing-soon and outbid
--      events out to every watcher, not just current/previous bidders.
--      Indexed on (user_id, created_at) for "my watchlist" listings, and
--      on listing_id for the scheduler's reverse-fan-out.
--
--   2. saved_searches     — buyers can persist a SearchListingsParams
--      payload as a named query and choose an alert cadence (instant,
--      daily, weekly, off). The alert cron walks rows where
--      last_run_at < now() - <cadence> and emails the user fresh hits.
--
-- Both tables are scoped by user_id with ON DELETE CASCADE so the GDPR
-- erasure pipeline (migration 032) keeps them in sync.

CREATE TABLE listing_watchlist (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, listing_id)
);

CREATE INDEX idx_listing_watchlist_user
    ON listing_watchlist (user_id, created_at DESC);
CREATE INDEX idx_listing_watchlist_listing
    ON listing_watchlist (listing_id);

CREATE TABLE saved_searches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    -- The SearchListingsParams JSON shape (see web/src/types/index.ts).
    -- Stored as JSONB so the alert cron can rebuild query strings without
    -- a column-shape migration when the params shape evolves.
    query_json      JSONB NOT NULL,
    alert_frequency TEXT NOT NULL DEFAULT 'daily'
        CHECK (alert_frequency IN ('instant', 'daily', 'weekly', 'off')),
    last_run_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_searches_user ON saved_searches (user_id);
CREATE INDEX idx_saved_searches_alert
    ON saved_searches (alert_frequency, last_run_at NULLS FIRST)
    WHERE alert_frequency <> 'off';
