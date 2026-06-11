-- 062_provider_licenses.down.sql
--
-- Reverse of 062_provider_licenses.up.sql (reversible in dev, §5/§15).
-- Remove the seed legal jobs and seed licenses first, then drop the table.
-- Dropping the table removes its indexes and the license rows; the seed jobs
-- live in `jobs` so they are deleted explicitly by their seed customer +
-- legal category + WA city to avoid touching anything else.
--
-- 2026-06-10 (with the in-place repair of the up, see its header): the legal
-- category is matched by slug instead of the previous hardcoded UUID, which
-- only exists in the original dev database — 006 generates fresh category
-- UUIDs per database. Same rows matched on dev; also correct on fresh DBs.

DELETE FROM jobs
 WHERE customer_id   = '00000000-0000-0000-0000-000000000002'
   AND category_id   IN (SELECT id FROM service_categories WHERE slug = 'legal' AND level = 1)
   AND service_state = 'WA'
   AND title IN (
        'Review SaaS vendor contract before signing',
        'One-hour business law consultation for new LLC'
   );

DROP TABLE IF EXISTS provider_licenses;
