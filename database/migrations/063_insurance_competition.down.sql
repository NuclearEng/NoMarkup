-- 063_insurance_competition.down.sql
--
-- Reverse 063: drop the competitive insurance marketplace. Drop in FK-dependency
-- order (children before parents). Indexes and triggers drop with their tables.
-- The update_insurance_updated_at() function is shared with migration 022, so it
-- is intentionally NOT dropped here.

DROP TABLE IF EXISTS marketplace_policies;
DROP TABLE IF EXISTS insurance_quotes;
DROP TABLE IF EXISTS insurance_quote_requests;
DROP TABLE IF EXISTS insurer_products;
DROP TABLE IF EXISTS insurers;
