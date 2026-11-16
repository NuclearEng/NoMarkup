-- Reverse migration 066 — drop the seller-payout transfer marker.

DROP INDEX IF EXISTS idx_listing_orders_unpaid_released;

ALTER TABLE listing_orders DROP COLUMN IF EXISTS stripe_transfer_id;
