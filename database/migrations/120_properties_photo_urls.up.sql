-- 120: Property photos (1–5 public CDN URLs) for create/edit surfaces.
-- Uploads reuse the existing imaging pipeline (job_photo / listing contexts).
-- Max 5 enforced by CHECK; empty array is the default (no photos).

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'properties_photo_urls_len'
  ) THEN
    ALTER TABLE properties
      ADD CONSTRAINT properties_photo_urls_len
      CHECK (cardinality(photo_urls) <= 5);
  END IF;
END $$;

COMMENT ON COLUMN properties.photo_urls IS
  'Public CDN image URLs (0–5) for property exterior/access photos. Upload via POST /api/v1/images/*; 10MB per file.';
