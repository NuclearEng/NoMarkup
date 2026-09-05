-- Rollback for 054_markets_geocode: null out the backfilled coordinates.
UPDATE markets
   SET lat = NULL, lng = NULL, location = NULL, updated_at = now()
 WHERE source = 'craigslist';
