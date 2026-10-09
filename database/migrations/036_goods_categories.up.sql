-- Goods marketplace v1 — taxonomy, reports, and dispute extension.
--
-- Migration 034 added the listings/listing_bids/listing_orders schema. This
-- migration finishes the public surface:
--
--   1. service_categories.is_goods flag — lets the /marketplace UI filter
--      to goods-only categories without re-shaping the existing taxonomy.
--   2. A "Goods" root category (level=1) plus 10 level=2 subcategories.
--   3. listing_reports table — buyer/anyone can flag a listing as
--      stolen/counterfeit/prohibited. ≥3 active reports auto-hides the
--      listing and the admin /admin/goods-reports surface lets staff
--      review and act.
--
-- Goods-side disputes live in `marketplace_disputes` (added by the
-- parallel migration 035_marketplace_escrow). The existing service
-- `disputes` table is left untouched — keeping the two surfaces in
-- separate tables avoids a schema collision while the parallel agents
-- ship.
--
-- All operations are additive and backward-compatible with the existing
-- service-marketplace flow. Down migration in 036_goods_categories.down.sql.

-- ============================================================
-- 1. service_categories.is_goods
-- ============================================================

ALTER TABLE service_categories
    ADD COLUMN IF NOT EXISTS is_goods BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_service_categories_is_goods
    ON service_categories (is_goods, level, sort_order)
    WHERE active = true;

-- ============================================================
-- 2. Goods taxonomy seed
-- ============================================================

-- Top-level "Goods" branch. sort_order=99 so it appears after the existing
-- service categories (which top out at ~50). slug is unique by table CHECK.
INSERT INTO service_categories (name, slug, level, sort_order, description, is_goods)
VALUES ('Goods', 'goods', 1, 99,
        'Peer-to-peer goods marketplace — local pickup, forward auction, 25mi radius.',
        true)
ON CONFLICT (slug) DO UPDATE SET is_goods = true;

-- Level-2 subcategories under "Goods".
WITH goods_root AS (
    SELECT id FROM service_categories WHERE slug = 'goods' AND level = 1
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order, is_goods)
SELECT goods_root.id, name, slug, 2, sort_order, true
  FROM goods_root,
       (VALUES
           ('Furniture',                'goods-furniture',     1),
           ('Electronics',              'goods-electronics',   2),
           ('Tools & Hardware',         'goods-tools',         3),
           ('Sporting Goods',           'goods-sporting',      4),
           ('Vehicles & Parts',         'goods-vehicles',      5),
           ('Home & Garden',            'goods-home-garden',   6),
           ('Books & Media',            'goods-books-media',   7),
           ('Clothing & Accessories',   'goods-clothing',      8),
           ('Collectibles',             'goods-collectibles',  9),
           ('Other Goods',              'goods-other',        10)
       ) AS sub(name, slug, sort_order)
ON CONFLICT (slug) DO UPDATE SET is_goods = true, active = true;

-- ============================================================
-- 3. listing_reports
-- ============================================================
--
-- Buyer/anyone can flag a listing as a policy violation. Listings with ≥3
-- active reports are auto-hidden via the `is_hidden` flag below; admin
-- review can then suspend the listing or dismiss the reports.

CREATE TABLE IF NOT EXISTS listing_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id      UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    -- Reporter is optional — "report this listing" works for anonymous
    -- visitors too (rate-limited at the gateway). If logged in, we record
    -- the user_id for fraud-trail.
    reporter_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    reason          TEXT NOT NULL CHECK (reason IN (
        'stolen', 'counterfeit', 'prohibited', 'misleading', 'spam', 'other'
    )),
    description     TEXT NOT NULL DEFAULT '',
    -- Lifecycle.
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'reviewed', 'actioned', 'dismissed'
    )),
    reviewed_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    resolution      TEXT, -- free-form admin note
    -- Anti-abuse.
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_reports_listing_id
    ON listing_reports (listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_reports_status
    ON listing_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_reports_reporter
    ON listing_reports (reporter_id);

DROP TRIGGER IF EXISTS listing_reports_set_updated_at ON listing_reports;
CREATE TRIGGER listing_reports_set_updated_at
    BEFORE UPDATE ON listing_reports
    FOR EACH ROW EXECUTE FUNCTION trigger_listings_set_updated_at();

-- Auto-hide flag on listings. Maintained by the trigger below.
ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_listings_is_hidden
    ON listings (is_hidden) WHERE is_hidden = true;

-- Auto-hide trigger: every time a report is inserted/updated, recompute
-- the count of `open` reports. ≥3 → set is_hidden=true.
CREATE OR REPLACE FUNCTION trigger_listing_reports_auto_hide()
RETURNS TRIGGER AS $$
DECLARE
    target_listing UUID;
    open_count     INTEGER;
BEGIN
    target_listing := COALESCE(NEW.listing_id, OLD.listing_id);

    SELECT COUNT(*) INTO open_count
      FROM listing_reports
     WHERE listing_id = target_listing
       AND status = 'open';

    IF open_count >= 3 THEN
        UPDATE listings
           SET is_hidden = true,
               hidden_reason = 'auto: ≥3 open reports',
               updated_at = now()
         WHERE id = target_listing
           AND is_hidden = false;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listing_reports_auto_hide ON listing_reports;
CREATE TRIGGER listing_reports_auto_hide
    AFTER INSERT OR UPDATE OF status ON listing_reports
    FOR EACH ROW
    EXECUTE FUNCTION trigger_listing_reports_auto_hide();

-- (Goods disputes live in `marketplace_disputes` — see migration 035.)
