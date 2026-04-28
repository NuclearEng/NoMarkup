-- Goods marketplace v1.2 — followable seller (Whatnot's signature retention
-- mechanic) + welcome-email scheduling columns.
--
-- The follow surface is symmetrical to listing_watchlist (migration 037):
-- a UNIQUE (follower_id, seller_id) row per relationship, ON DELETE CASCADE
-- on both endpoints so the GDPR erasure pipeline (migration 032) keeps
-- referential integrity. CHECK (follower_id != seller_id) blocks self-follow
-- at the DB layer; the gateway also rejects it before the insert.
--
-- The notification scheduler in services/notification fans new-listing
-- events out to followers via the `notify:seller_new_listing:{seller_id}`
-- Redis channel — read patterns mirror the watchlist closing-soon loop.
--
-- Three users.welcome_email_* columns track delivery for the day-1 / day-3 /
-- day-7 onboarding sequence. A NULL means "not yet sent"; the welcome
-- scheduler picks up unsent rows on each tick.

CREATE TABLE seller_follows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (follower_id, seller_id),
    CHECK (follower_id != seller_id)
);

CREATE INDEX idx_seller_follows_follower
    ON seller_follows (follower_id, created_at DESC);
CREATE INDEX idx_seller_follows_seller
    ON seller_follows (seller_id);

ALTER TABLE users ADD COLUMN welcome_email_sent_at  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN welcome_day3_sent_at   TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN welcome_day7_sent_at   TIMESTAMPTZ;
