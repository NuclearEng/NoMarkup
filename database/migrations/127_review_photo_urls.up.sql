-- 127: Review photos (0–5 public CDN URLs) for leave-review surfaces.
-- Uploads reuse the existing imaging pipeline (review_photo context).
-- Max 5 enforced by CHECK; empty array is the default (no photos).

ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reviews_photo_urls_len'
  ) THEN
    ALTER TABLE reviews
      ADD CONSTRAINT reviews_photo_urls_len
      CHECK (cardinality(photo_urls) <= 5);
  END IF;
END $$;

COMMENT ON COLUMN reviews.photo_urls IS
  'Public CDN image URLs (0–5) for review photos. Upload via POST /api/v1/images/* (context review_photo); 10MB per file.';
