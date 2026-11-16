-- Rollback for 036_goods_categories.

-- 1. Listings auto-hide.
DROP TRIGGER IF EXISTS listing_reports_auto_hide ON listing_reports;
DROP FUNCTION IF EXISTS trigger_listing_reports_auto_hide();

DROP INDEX IF EXISTS idx_listings_is_hidden;
ALTER TABLE listings DROP COLUMN IF EXISTS hidden_reason;
ALTER TABLE listings DROP COLUMN IF EXISTS is_hidden;

-- 2. listing_reports.
DROP TRIGGER IF EXISTS listing_reports_set_updated_at ON listing_reports;
DROP INDEX IF EXISTS idx_listing_reports_reporter;
DROP INDEX IF EXISTS idx_listing_reports_status;
DROP INDEX IF EXISTS idx_listing_reports_listing_id;
DROP TABLE IF EXISTS listing_reports;

-- 3. Goods taxonomy.
--
-- Listings reference these categories via FK. listing_orders has a
-- restrictive FK to listings, so we cascade in the right order:
-- marketplace_disputes → listing_orders → listings → categories.
-- Acceptable in a development rollback path; the goods marketplace
-- is the entire reason these categories exist.
DELETE FROM marketplace_disputes
 WHERE listing_order_id IN (
    SELECT lo.id FROM listing_orders lo
      JOIN listings l ON l.id = lo.listing_id
      JOIN service_categories sc ON sc.id = l.category_id
     WHERE sc.is_goods = true OR sc.slug = 'goods'
 );

DELETE FROM listing_orders
 WHERE listing_id IN (
    SELECT l.id FROM listings l
      JOIN service_categories sc ON sc.id = l.category_id
     WHERE sc.is_goods = true OR sc.slug = 'goods'
 );

DELETE FROM listings
 WHERE category_id IN (
    SELECT id FROM service_categories
     WHERE is_goods = true OR slug = 'goods'
 );

DELETE FROM service_categories
 WHERE slug IN (
    'goods-furniture','goods-electronics','goods-tools','goods-sporting',
    'goods-vehicles','goods-home-garden','goods-books-media','goods-clothing',
    'goods-collectibles','goods-other'
 );

DELETE FROM service_categories WHERE slug = 'goods';

-- 4. is_goods column.
DROP INDEX IF EXISTS idx_service_categories_is_goods;
ALTER TABLE service_categories DROP COLUMN IF EXISTS is_goods;
