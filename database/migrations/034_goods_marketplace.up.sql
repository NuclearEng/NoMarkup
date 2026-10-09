-- Goods marketplace v1 — peer-to-peer FORWARD auctions for physical goods.
--
-- Direction is the inverse of the existing service auctions in `jobs`/`bids`:
-- here the highest bidder at close wins (bids ascend). Local pickup only
-- in v1, no shipping integration. 25-mile radius cap is enforced at the
-- service layer.
--
-- Tables added:
--   listings         — the auction itself (one per goods listing)
--   listing_bids     — every bid placed (ascending price)
--   listing_photos   — photos attached to a listing
--   listing_orders   — post-award escrow record (the "contract" analog)
--
-- Triggers maintain `listings.bid_count` and `listings.current_bid_cents`
-- using the same atomic-delta pattern as migration 030 (jobs.bid_count).
-- Recomputing-from-subquery triggers under READ COMMITTED produced lost
-- updates in the services flow; we use additive deltas plus an explicit
-- "highest-wins" UPDATE that is safe under contention because it both
-- locks the listing row (FOR UPDATE in app code) and verifies the bid
-- amount against current_bid_cents inside the INSERT path.

-- ============================================================
-- listings
-- ============================================================

CREATE TABLE listings (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title                     TEXT NOT NULL,
    description               TEXT NOT NULL DEFAULT '',
    -- Reuse the existing service_categories tree for goods taxonomy in v1.
    category_id               UUID NOT NULL REFERENCES service_categories(id),
    -- Pickup location.
    location                  geometry(Point, 4326) NOT NULL,
    pickup_address            TEXT NOT NULL DEFAULT '',
    pickup_zip_code           TEXT NOT NULL DEFAULT '',
    -- Pricing — forward auction: starting_price is the floor, current_bid_cents
    -- ascends. NULL current_bid means no bids yet.
    starting_price_cents      BIGINT NOT NULL CHECK (starting_price_cents >= 0),
    current_bid_cents         BIGINT,
    current_bidder_id         UUID REFERENCES users(id),
    bid_count                 INTEGER NOT NULL DEFAULT 0,
    -- Auction timing.
    auction_duration_hours    INTEGER NOT NULL CHECK (auction_duration_hours IN (24, 48, 168)),
    auction_ends_at           TIMESTAMPTZ NOT NULL,
    original_auction_ends_at  TIMESTAMPTZ NOT NULL,
    snipe_extension_count     INTEGER NOT NULL DEFAULT 0,
    -- Lifecycle.
    status                    TEXT NOT NULL DEFAULT 'active'
                              CHECK (status IN ('draft','active','sold','cancelled','expired')),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_listings_status            ON listings (status);
CREATE INDEX idx_listings_auction_ends_at   ON listings (auction_ends_at);
CREATE INDEX idx_listings_location          ON listings USING GIST (location);
CREATE INDEX idx_listings_seller_status     ON listings (seller_id, status);
CREATE INDEX idx_listings_category_status   ON listings (category_id, status);

-- ============================================================
-- listing_bids
-- ============================================================

CREATE TABLE listing_bids (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id    UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    bidder_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_cents  BIGINT NOT NULL CHECK (amount_cents > 0),
    -- 'active' = the running high bid right now
    -- 'outbid' = was the high bid, no longer is
    -- 'winning'= the running high bid AFTER auction close (same as awarded for the closing tx)
    -- 'awarded'= confirmed winner; the order has been created
    -- 'withdrawn' is intentionally not in v1 — bids are binding
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','outbid','winning','awarded','withdrawn')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    withdrawn_at  TIMESTAMPTZ,
    -- Anti-abuse trail (matches engines/fraud expectations).
    ip_address    INET,
    fingerprint   TEXT
);

CREATE INDEX idx_listing_bids_listing_id        ON listing_bids (listing_id);
CREATE INDEX idx_listing_bids_listing_amount    ON listing_bids (listing_id, amount_cents DESC);
CREATE INDEX idx_listing_bids_bidder_id         ON listing_bids (bidder_id);
CREATE INDEX idx_listing_bids_listing_status    ON listing_bids (listing_id, status);

-- ============================================================
-- listing_photos
-- ============================================================

CREATE TABLE listing_photos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_listing_photos_listing_id ON listing_photos (listing_id, sort_order);

-- ============================================================
-- listing_orders — the post-award escrow record.
-- ============================================================

CREATE TABLE listing_orders (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id            UUID NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
    seller_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    buyer_id              UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount_cents          BIGINT NOT NULL CHECK (amount_cents > 0),
    fee_cents             BIGINT NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
    escrow_status         TEXT NOT NULL DEFAULT 'held'
                          CHECK (escrow_status IN ('held','pickup_confirmed','released','disputed','refunded')),
    payment_intent_id     TEXT,
    pickup_confirmed_at   TIMESTAMPTZ,
    released_at           TIMESTAMPTZ,
    dispute_id            UUID,  -- soft FK to disputes(id); enforced by app layer
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (listing_id)  -- one order per listing
);

CREATE INDEX idx_listing_orders_escrow_status ON listing_orders (escrow_status);
CREATE INDEX idx_listing_orders_seller_id     ON listing_orders (seller_id);
CREATE INDEX idx_listing_orders_buyer_id      ON listing_orders (buyer_id);

-- ============================================================
-- Triggers: keep listings.bid_count and listings.current_bid_cents
-- in sync with listing_bids using atomic deltas + max-wins update.
-- ============================================================

CREATE OR REPLACE FUNCTION trigger_update_listing_counters()
RETURNS TRIGGER AS $$
DECLARE
    target_listing_id UUID;
    became_active     BOOLEAN := false;
    became_inactive   BOOLEAN := false;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status NOT IN ('withdrawn','outbid') THEN
            -- bid_count: atomic +1
            UPDATE listings
               SET bid_count = bid_count + 1
             WHERE id = NEW.listing_id;
        END IF;

        -- current_bid_cents: forward auction — we want MAX(amount_cents).
        -- Under READ COMMITTED, `GREATEST(current_bid_cents, NEW.amount)`
        -- with target row locked re-evaluates the row's latest committed
        -- value on each retry, so this is correct under contention.
        UPDATE listings
           SET current_bid_cents = GREATEST(COALESCE(current_bid_cents, 0), NEW.amount_cents),
               current_bidder_id = CASE
                   WHEN current_bid_cents IS NULL OR NEW.amount_cents > current_bid_cents
                       THEN NEW.bidder_id
                   ELSE current_bidder_id
               END,
               updated_at = now()
         WHERE id = NEW.listing_id;
        RETURN NULL;

    ELSIF TG_OP = 'UPDATE' THEN
        became_active   := OLD.status IN ('withdrawn')
                       AND NEW.status NOT IN ('withdrawn');
        became_inactive := OLD.status NOT IN ('withdrawn')
                       AND NEW.status IN ('withdrawn');

        IF became_active THEN
            UPDATE listings SET bid_count = bid_count + 1 WHERE id = NEW.listing_id;
        ELSIF became_inactive THEN
            UPDATE listings SET bid_count = GREATEST(bid_count - 1, 0) WHERE id = NEW.listing_id;
            -- Recompute current_bid in case the withdrawn bid was the high bid.
            UPDATE listings l
               SET current_bid_cents = sub.max_amount,
                   current_bidder_id = sub.bidder_id
              FROM (
                  SELECT lb.listing_id, MAX(lb.amount_cents) AS max_amount,
                         (SELECT bidder_id FROM listing_bids
                           WHERE listing_id = NEW.listing_id
                             AND status NOT IN ('withdrawn')
                           ORDER BY amount_cents DESC, created_at ASC LIMIT 1) AS bidder_id
                    FROM listing_bids lb
                   WHERE lb.listing_id = NEW.listing_id
                     AND lb.status NOT IN ('withdrawn')
                   GROUP BY lb.listing_id
              ) sub
             WHERE l.id = sub.listing_id;
        END IF;
        RETURN NULL;

    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.status NOT IN ('withdrawn','outbid') THEN
            UPDATE listings SET bid_count = GREATEST(bid_count - 1, 0) WHERE id = OLD.listing_id;
        END IF;
        RETURN NULL;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listing_bids_update_counters ON listing_bids;
CREATE TRIGGER listing_bids_update_counters
    AFTER INSERT OR UPDATE OF status OR DELETE
    ON listing_bids
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_listing_counters();

-- updated_at trigger for listings + listing_orders.
CREATE OR REPLACE FUNCTION trigger_listings_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listings_set_updated_at ON listings;
CREATE TRIGGER listings_set_updated_at
    BEFORE UPDATE ON listings
    FOR EACH ROW EXECUTE FUNCTION trigger_listings_set_updated_at();

DROP TRIGGER IF EXISTS listing_orders_set_updated_at ON listing_orders;
CREATE TRIGGER listing_orders_set_updated_at
    BEFORE UPDATE ON listing_orders
    FOR EACH ROW EXECUTE FUNCTION trigger_listings_set_updated_at();
