-- 062_provider_licenses.down.sql
--
-- Reverse of 062_provider_licenses.up.sql (reversible in dev, §5/§15).
-- Remove the seed legal jobs and seed licenses first, then drop the table.
-- Dropping the table removes its indexes and the license rows; the seed jobs
-- live in `jobs` so they are deleted explicitly by their seed customer +
-- legal category + WA city to avoid touching anything else.

DELETE FROM jobs
 WHERE customer_id   = '00000000-0000-0000-0000-000000000002'
   AND category_id   = 'a5663378-3f7e-4164-a42e-15e752348902'
   AND service_state = 'WA'
   AND title IN (
        'Review SaaS vendor contract before signing',
        'One-hour business law consultation for new LLC'
   );

DROP TABLE IF EXISTS provider_licenses;
