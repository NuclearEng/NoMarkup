ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_photo_urls_len;
ALTER TABLE reviews DROP COLUMN IF EXISTS photo_urls;
