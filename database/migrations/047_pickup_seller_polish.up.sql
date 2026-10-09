-- Migration 047 — Pickup handoff polish + power-seller tools (Wave 5 Agent R).
--
-- Adds the missing safety scaffolding around in-person goods pickups
-- (selfie + signed code + handoff photo + mutual confirmation + no-show
-- tracking) plus the data layer for the power-seller surface:
-- daily metrics roll-up, listing promotion (paid placement boost), and
-- the no-show shadow-ban counters.
--
-- Builds on:
--   034 — listing_orders / listings creation
--   035 — escrow_status state machine + marketplace_disputes
--   043 — bid_bonds (pre-auth flow)
--
-- ──────────────────────────────────────────────────────────────────────
-- 1. Pickup handoff hardening on listing_orders
-- ──────────────────────────────────────────────────────────────────────

-- Hash of the 6-digit pickup code shown on the seller's app. We hash so
-- a leak of the DB does not let an attacker game the code (it's only
-- 6 digits — entropy ≈ 20 bits — but the hash plus rate-limited verify
-- raises the bar for offline attacks). Stored as TEXT so callers can
-- pick a hash algo (we use SHA-256 in the gateway).
ALTER TABLE listing_orders ADD COLUMN IF NOT EXISTS pickup_code_hash TEXT;

-- Buyer-selected pickup window. Both sides agree on a window via chat,
-- the seller pins it on the order, and the no-show timer references
-- pickup_window_end + a 30-minute grace.
ALTER TABLE listing_orders ADD COLUMN IF NOT EXISTS pickup_window_start TIMESTAMPTZ;
ALTER TABLE listing_orders ADD COLUMN IF NOT EXISTS pickup_window_end   TIMESTAMPTZ;

-- Buyer's selfie + photo of the item at handoff. Mirrors the contract
-- check-in/out flow but adapted for goods. Both URLs are S3 keys
-- produced by the existing image upload pipeline.
ALTER TABLE listing_orders ADD COLUMN IF NOT EXISTS handoff_photo_url TEXT;
ALTER TABLE listing_orders ADD COLUMN IF NOT EXISTS selfie_url        TEXT;

-- Mutual handshake — both sides must confirm before escrow releases.
-- pickup_confirmed_at (already in 034) is set by the buyer on code
-- match; seller_confirmed_at is set by the seller via NewSellerConfirm.
-- Escrow flips to 'released' only when BOTH are non-null.
ALTER TABLE listing_orders ADD COLUMN IF NOT EXISTS seller_confirmed_at TIMESTAMPTZ;

-- ──────────────────────────────────────────────────────────────────────
-- 2. Promoted listings (paid placement boost)
-- ──────────────────────────────────────────────────────────────────────

-- is_promoted is the truthy flag the scoreboard reads; promoted_until is
-- the expiry stamp. The composite predicate index keeps the marketplace
-- list-and-sort path fast: "WHERE is_promoted=true AND promoted_until>now()".
ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_promoted    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS promoted_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_listings_promoted
    ON listings (promoted_until DESC)
    WHERE is_promoted = true;

-- ──────────────────────────────────────────────────────────────────────
-- 3. No-show tracking (silent shadow-ban after 2 confirmed no-shows)
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS no_show_count          INT         NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS no_show_cooldown_until TIMESTAMPTZ;

-- ──────────────────────────────────────────────────────────────────────
-- 4. Seller daily metrics roll-up
-- ──────────────────────────────────────────────────────────────────────
-- Populated hourly by services/payment cron. Live analytics queries can
-- still hit listings + listing_orders directly when the table is empty
-- (see seller_analytics.go); this table is the fast path once we have
-- enough sellers to make on-the-fly rollups expensive.

CREATE TABLE IF NOT EXISTS seller_metrics_daily (
    user_id          UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    metric_date      DATE    NOT NULL,
    listings_active  INT     NOT NULL DEFAULT 0,
    listings_sold    INT     NOT NULL DEFAULT 0,
    gross_cents      BIGINT  NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_seller_metrics_daily_date
    ON seller_metrics_daily (metric_date DESC);

-- ──────────────────────────────────────────────────────────────────────
-- 5. Promotion charges (Stripe PI ledger for paid promotions)
-- ──────────────────────────────────────────────────────────────────────
-- Each row is one purchase of a 24h / 72h / 168h boost. The webhook
-- handler flips status='succeeded' and the listings.is_promoted flag
-- on charge.success. status='pending' rows older than 24h get reaped
-- by a cron (mirrors bid_bonds reaping).

CREATE TABLE IF NOT EXISTS promotion_charges (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID    NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    listing_id      UUID    NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    stripe_pi_id    TEXT    NOT NULL UNIQUE,
    amount_cents    BIGINT  NOT NULL CHECK (amount_cents > 0),
    duration_hours  INT     NOT NULL CHECK (duration_hours IN (24, 72, 168)),
    status          TEXT    NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotion_charges_user
    ON promotion_charges (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotion_charges_listing
    ON promotion_charges (listing_id);
