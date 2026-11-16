-- Reverse the King County, WA pilot: remove the six manually-added cities and
-- restore Seattle-Tacoma as the single active market (the prior launch state).
DELETE FROM markets WHERE slug IN
  ('auburn-wa', 'maple-valley-wa', 'black-diamond-wa', 'enumclaw-wa', 'kent-wa', 'renton-wa');

UPDATE markets SET is_active = true, updated_at = now() WHERE slug = 'seattle';
