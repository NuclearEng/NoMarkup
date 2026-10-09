-- Reverse migration 041.

ALTER TABLE users DROP COLUMN IF EXISTS welcome_day7_sent_at;
ALTER TABLE users DROP COLUMN IF EXISTS welcome_day3_sent_at;
ALTER TABLE users DROP COLUMN IF EXISTS welcome_email_sent_at;

DROP INDEX IF EXISTS idx_seller_follows_seller;
DROP INDEX IF EXISTS idx_seller_follows_follower;
DROP TABLE IF EXISTS seller_follows;
