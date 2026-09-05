-- Wave 5 — Best-Offer / counter-offer chain + price-drop baseline.
--
-- Two new surfaces:
--
--   1. listing_offers — buyer makes a sub-asking offer; seller can accept,
--      reject, withdraw, or counter. counter creates a NEW row whose
--      parent_offer_id points back at the original (which flips to
--      'countered'). expires_at defaults to 24h after creation.
--      The accept transition is wired into the gateway's offers handler:
--      it flips listings.status='sold' and mints a listing_orders row in
--      escrow_status='held' (mirrors the buy-now closeout path).
--
--   2. listing_watchlist gets two columns the price-drop scheduler needs:
--      baseline_price_cents (snapshot of current_bid_cents at watch time
--      — populated lazily by the scheduler the first time it sees the row)
--      + last_drop_alert_cents (avoids repeated alerts for the same drop).
--
-- ON DELETE CASCADE on every user_id/listing_id keeps the GDPR-erasure
-- pipeline (migration 032) coherent — deleting a user removes their offers.

CREATE TABLE listing_offers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id      UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    buyer_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
    -- pending   = awaiting seller action
    -- accepted  = seller accepted; listing flipped to 'sold' in same tx
    -- rejected  = seller declined
    -- countered = seller proposed a different amount (see parent_offer_id)
    -- withdrawn = buyer pulled the offer before seller acted
    -- expired   = passed expires_at without seller action
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','rejected','countered','withdrawn','expired')),
    parent_offer_id UUID REFERENCES listing_offers(id) ON DELETE SET NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    message         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_listing_offers_listing
    ON listing_offers (listing_id, status, created_at DESC);
CREATE INDEX idx_listing_offers_buyer
    ON listing_offers (buyer_id, status);
-- Partial index keeps the expiration sweep cheap — only pending rows.
CREATE INDEX idx_listing_offers_expires
    ON listing_offers (expires_at)
    WHERE status = 'pending';

DROP TRIGGER IF EXISTS listing_offers_set_updated_at ON listing_offers;
CREATE TRIGGER listing_offers_set_updated_at
    BEFORE UPDATE ON listing_offers
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Watchlist baseline so the price-drop scheduler can detect drops.
-- Both columns are nullable; the scheduler stamps baseline_price_cents
-- the first time it observes a row, and last_drop_alert_cents the first
-- time it sends a drop alert (then again whenever the price falls below
-- the previous alert).
ALTER TABLE listing_watchlist
    ADD COLUMN baseline_price_cents  BIGINT;
ALTER TABLE listing_watchlist
    ADD COLUMN last_drop_alert_cents BIGINT;
