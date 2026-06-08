-- Extend the WA pilot with two more Pierce County cities, active.
INSERT INTO markets (slug, name, region, region_code, country, source, is_active, lat, lng, location)
VALUES
  ('lake-tapps-wa',  'Lake Tapps',  'Pierce County, WA', 'WA', 'US', 'manual', true, 47.2287, -122.1665, ST_SetSRID(ST_MakePoint(-122.1665, 47.2287), 4326)),
  ('bonney-lake-wa', 'Bonney Lake', 'Pierce County, WA', 'WA', 'US', 'manual', true, 47.1771, -122.1866, ST_SetSRID(ST_MakePoint(-122.1866, 47.1771), 4326))
ON CONFLICT (slug) DO UPDATE SET
  is_active   = true,
  name        = EXCLUDED.name,
  region      = EXCLUDED.region,
  region_code = EXCLUDED.region_code,
  country     = EXCLUDED.country,
  lat         = EXCLUDED.lat,
  lng         = EXCLUDED.lng,
  location    = EXCLUDED.location,
  updated_at  = now();
