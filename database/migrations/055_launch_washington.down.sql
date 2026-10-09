-- Rollback 055: un-launch Washington.
UPDATE markets SET is_active = false, updated_at = now()
 WHERE country = 'US' AND region_code = 'WA';
