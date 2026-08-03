ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_photo_urls_len;
ALTER TABLE properties DROP COLUMN IF EXISTS photo_urls;
