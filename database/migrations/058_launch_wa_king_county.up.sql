-- Launch the King County, WA pilot: activate only Auburn, Maple Valley,
-- Black Diamond, Enumclaw, Kent, and Renton. Deactivate every other market so
-- the public catalog + city selector surface only these six.
-- (The existing crawled "auburn" row is Auburn, AL — we add Auburn, WA distinctly.)

UPDATE markets SET is_active = false, updated_at = now() WHERE is_active = true;

INSERT INTO markets (slug, name, region, region_code, country, source, is_active, lat, lng, location)
VALUES
  ('auburn-wa',        'Auburn',        'King County, WA', 'WA', 'US', 'manual', true, 47.3073, -122.2285, ST_SetSRID(ST_MakePoint(-122.2285, 47.3073), 4326)),
  ('maple-valley-wa',  'Maple Valley',  'King County, WA', 'WA', 'US', 'manual', true, 47.3665, -122.0397, ST_SetSRID(ST_MakePoint(-122.0397, 47.3665), 4326)),
  ('black-diamond-wa', 'Black Diamond', 'King County, WA', 'WA', 'US', 'manual', true, 47.3087, -122.0007, ST_SetSRID(ST_MakePoint(-122.0007, 47.3087), 4326)),
  ('enumclaw-wa',      'Enumclaw',      'King County, WA', 'WA', 'US', 'manual', true, 47.2043, -121.9915, ST_SetSRID(ST_MakePoint(-121.9915, 47.2043), 4326)),
  ('kent-wa',          'Kent',          'King County, WA', 'WA', 'US', 'manual', true, 47.3809, -122.2348, ST_SetSRID(ST_MakePoint(-122.2348, 47.3809), 4326)),
  ('renton-wa',        'Renton',        'King County, WA', 'WA', 'US', 'manual', true, 47.4829, -122.2171, ST_SetSRID(ST_MakePoint(-122.2171, 47.4829), 4326))
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
