-- Active marketplace listings for local / device testing.
--
-- Problem this solves: auction settle workers leave the catalog with only
-- sold/cancelled/expired rows, so GET /api/v1/listings returns [].
--
-- Safe for re-run:
--   1) Revives ONLY status='expired' listings that have no listing_orders
--      (does not touch sold history).
--   2) Upserts 12 fixed-UUID "device-test" active listings (a010–a01b block).
--
-- Usage (local Postgres from repo root):
--   PGPASSWORD=password psql -h localhost -p 5433 -U nomarkup -d nomarkup \
--     -f database/seeds/active_marketplace_listings.sql
--
-- Also available via the Go seeder (does not flip sold rows):
--   make seed          — base marketplace seed (ON CONFLICT sets many fixed
--                        seed IDs back to active — AVOID if those IDs are sold)
--   make seed-demo     — SEED_DEMO_MARKETPLACE=1 (same caution for 9xxx sold rows)
-- Prefer this SQL when the DB already has sold seed history you want to keep.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Revive expired listings that never produced an order.
--    auction_ends_at: +7 days; clear bid state so they look open again.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE listings l
SET
  status = 'active',
  auction_ends_at = now() + interval '7 days',
  original_auction_ends_at = now() + interval '7 days',
  auction_duration_hours = 168,
  snipe_extension_count = 0,
  current_bid_cents = NULL,
  current_bidder_id = NULL,
  bid_count = 0,
  is_hidden = false,
  hidden_reason = NULL,
  updated_at = now()
WHERE l.status = 'expired'
  AND NOT EXISTS (
    SELECT 1 FROM listing_orders o WHERE o.listing_id = l.id
  )
  -- Skip obvious manual/dev junk so device catalogs stay demo-quality.
  AND l.title NOT IN ('Bond test item', 'Bond test 2', 'asdfadsfasdfadfasdf')
  AND l.title !~* '^(test|asdf|bond test)';

-- Drop stale bids on revived rows (bid_count already zeroed above).
-- Scope: active, no order, zeroed counters — avoids touching live auctions
-- that still have real bids.
DELETE FROM listing_bids b
WHERE b.listing_id IN (
  SELECT l.id
  FROM listings l
  WHERE l.status = 'active'
    AND l.bid_count = 0
    AND l.current_bid_cents IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM listing_orders o WHERE o.listing_id = l.id
    )
);

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Insert / refresh 12 dedicated device-test listings (fixed UUIDs).
--    Sellers: provider, customer, provider2 (seed accounts).
--    Location: Austin, TX (matches marketplace seed; list API has no geo by default).
-- ───────────────────────────────────────────────────────────────────────────

-- Category lookup (migration 036 goods taxonomy).
WITH cats AS (
  SELECT slug, id FROM service_categories
  WHERE slug IN (
    'goods-furniture', 'goods-electronics', 'goods-tools', 'goods-sporting',
    'goods-vehicles', 'goods-home-garden', 'goods-books-media',
    'goods-collectibles', 'goods-apparel', 'goods-other'
  )
),
sellers AS (
  SELECT * FROM (VALUES
    ('provider'::text,  '00000000-0000-0000-0000-000000000003'::uuid),
    ('customer',        '00000000-0000-0000-0000-000000000002'::uuid),
    ('provider2',       '00000000-0000-0000-0000-000000000004'::uuid)
  ) AS s(key, id)
),
new_listings AS (
  SELECT * FROM (VALUES
    -- id, seller_key, cat_slug, title, description, start_cents, duration_h, condition, photo
    ('00000000-0000-4000-a000-00000000a010'::uuid, 'provider',  'goods-furniture',
     'Mid-century walnut sideboard',
     'Solid walnut sideboard, local pickup only. Device-test listing — do not purchase in production.',
     22000::bigint, 48, 'very_good', 'https://picsum.photos/id/106/800/600'),
    ('00000000-0000-4000-a000-00000000a011'::uuid, 'provider2', 'goods-electronics',
     'Nintendo Switch OLED + 3 games',
     'Dock, Joy-Cons, HDMI cable included. Light wear on kickstand.',
     24000, 48, 'good', 'https://picsum.photos/id/160/800/600'),
    ('00000000-0000-4000-a000-00000000a012'::uuid, 'provider',  'goods-tools',
     'Makita 18V LXT drill/driver kit',
     'Two batteries + charger in hard case. Works great.',
     9500, 24, 'good', 'https://picsum.photos/id/201/800/600'),
    ('00000000-0000-4000-a000-00000000a013'::uuid, 'customer',  'goods-sporting',
     'Canyon Ultimate CF SL road bike, 56cm',
     'Carbon frame, Ultegra groupset. New chain and cassette last month.',
     145000, 168, 'very_good', 'https://picsum.photos/id/111/800/600'),
    ('00000000-0000-4000-a000-00000000a014'::uuid, 'provider2', 'goods-vehicles',
     'Thule Force XT L roof cargo box',
     'Fits most crossbars. Exterior scratches only; seals clean.',
     35000, 48, 'good', 'https://picsum.photos/id/133/800/600'),
    ('00000000-0000-4000-a000-00000000a015'::uuid, 'provider',  'goods-home-garden',
     'Big Green Egg large kamado grill',
     'Includes nest, plate setter, and cover. Buyer brings a truck.',
     65000, 48, 'very_good', 'https://picsum.photos/id/292/800/600'),
    ('00000000-0000-4000-a000-00000000a016'::uuid, 'customer',  'goods-books-media',
     'Criterion Collection Blu-ray lot (24 titles)',
     'Mixed drama/comedy. Cases and discs excellent.',
     12000, 48, 'like_new', 'https://picsum.photos/id/24/800/600'),
    ('00000000-0000-4000-a000-00000000a017'::uuid, 'provider2', 'goods-collectibles',
     'LEGO Creator Expert Modular Building set (sealed)',
     'Factory sealed. Receipt available. Local pickup only.',
     18000, 168, 'new', 'https://picsum.photos/id/119/800/600'),
    ('00000000-0000-4000-a000-00000000a018'::uuid, 'provider',  'goods-apparel',
     'Patagonia Nano Puff jacket, men''s M',
     'Color: black. Worn one season. No tears or stains.',
     8000, 24, 'very_good', 'https://picsum.photos/id/64/800/600'),
    ('00000000-0000-4000-a000-00000000a019'::uuid, 'customer',  'goods-electronics',
     'Apple AirPods Pro (2nd gen) USB-C',
     'With MagSafe case and original tips. Battery health excellent.',
     14000, 48, 'like_new', 'https://picsum.photos/id/250/800/600'),
    ('00000000-0000-4000-a000-00000000a01a'::uuid, 'provider2', 'goods-furniture',
     'IKEA KALLAX 4×4 shelf with doors',
     'White. Disassembled for easy pickup. Hardware bag included.',
     6000, 24, 'good', 'https://picsum.photos/id/107/800/600'),
    ('00000000-0000-4000-a000-00000000a01b'::uuid, 'provider',  'goods-other',
     'Yeti Tundra 45 cooler',
     'Tan. Used for a few tailgates. No cracks; latches solid.',
     16000, 48, 'good', 'https://picsum.photos/id/225/800/600')
  ) AS v(id, seller_key, cat_slug, title, description, start_cents, duration_h, condition, photo)
)
INSERT INTO listings (
  id, seller_id, title, description, category_id,
  location, pickup_address, pickup_zip_code,
  starting_price_cents, auction_duration_hours,
  auction_ends_at, original_auction_ends_at,
  status, condition, bid_count, is_hidden
)
SELECT
  n.id,
  s.id,
  n.title,
  n.description,
  c.id,
  ST_SetSRID(ST_MakePoint(-97.7431, 30.2672), 4326),
  '123 Main St, Austin, TX',
  '78701',
  n.start_cents,
  CASE
    WHEN n.duration_h IN (24, 48, 168) THEN n.duration_h
    WHEN n.duration_h <= 24 THEN 24
    WHEN n.duration_h <= 48 THEN 48
    ELSE 168
  END,
  now() + make_interval(hours =>
    CASE
      WHEN n.duration_h IN (24, 48, 168) THEN n.duration_h
      WHEN n.duration_h <= 24 THEN 24
      WHEN n.duration_h <= 48 THEN 48
      ELSE 168
    END
  ),
  now() + make_interval(hours =>
    CASE
      WHEN n.duration_h IN (24, 48, 168) THEN n.duration_h
      WHEN n.duration_h <= 24 THEN 24
      WHEN n.duration_h <= 48 THEN 48
      ELSE 168
    END
  ),
  'active',
  n.condition,
  0,
  false
FROM new_listings n
JOIN sellers s ON s.key = n.seller_key
JOIN cats c ON c.slug = n.cat_slug
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  category_id = EXCLUDED.category_id,
  seller_id = EXCLUDED.seller_id,
  starting_price_cents = EXCLUDED.starting_price_cents,
  auction_duration_hours = EXCLUDED.auction_duration_hours,
  auction_ends_at = EXCLUDED.auction_ends_at,
  original_auction_ends_at = EXCLUDED.original_auction_ends_at,
  status = 'active',
  condition = EXCLUDED.condition,
  current_bid_cents = NULL,
  current_bidder_id = NULL,
  bid_count = 0,
  is_hidden = false,
  hidden_reason = NULL,
  updated_at = now();

-- Clear any bids on the device-test UUID block so re-runs stay clean.
DELETE FROM listing_bids
WHERE listing_id >= '00000000-0000-4000-a000-00000000a010'::uuid
  AND listing_id <= '00000000-0000-4000-a000-00000000a01b'::uuid;

-- Photos for the device-test listings (one primary photo each).
INSERT INTO listing_photos (listing_id, url, sort_order)
SELECT v.listing_id, v.url, 0
FROM (VALUES
  ('00000000-0000-4000-a000-00000000a010'::uuid, 'https://picsum.photos/id/106/800/600'),
  ('00000000-0000-4000-a000-00000000a011'::uuid, 'https://picsum.photos/id/160/800/600'),
  ('00000000-0000-4000-a000-00000000a012'::uuid, 'https://picsum.photos/id/201/800/600'),
  ('00000000-0000-4000-a000-00000000a013'::uuid, 'https://picsum.photos/id/111/800/600'),
  ('00000000-0000-4000-a000-00000000a014'::uuid, 'https://picsum.photos/id/133/800/600'),
  ('00000000-0000-4000-a000-00000000a015'::uuid, 'https://picsum.photos/id/292/800/600'),
  ('00000000-0000-4000-a000-00000000a016'::uuid, 'https://picsum.photos/id/24/800/600'),
  ('00000000-0000-4000-a000-00000000a017'::uuid, 'https://picsum.photos/id/119/800/600'),
  ('00000000-0000-4000-a000-00000000a018'::uuid, 'https://picsum.photos/id/64/800/600'),
  ('00000000-0000-4000-a000-00000000a019'::uuid, 'https://picsum.photos/id/250/800/600'),
  ('00000000-0000-4000-a000-00000000a01a'::uuid, 'https://picsum.photos/id/107/800/600'),
  ('00000000-0000-4000-a000-00000000a01b'::uuid, 'https://picsum.photos/id/225/800/600')
) AS v(listing_id, url)
WHERE NOT EXISTS (
  SELECT 1 FROM listing_photos p
  WHERE p.listing_id = v.listing_id AND p.sort_order = 0
);

COMMIT;

-- Summary
SELECT status, count(*) FROM listings GROUP BY status ORDER BY 1;
SELECT id, title, status, starting_price_cents, auction_ends_at
FROM listings
WHERE status = 'active'
ORDER BY auction_ends_at
LIMIT 25;
