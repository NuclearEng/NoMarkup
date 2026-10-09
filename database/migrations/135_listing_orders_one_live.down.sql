-- Dev-only rollback. Adding listing_orders_listing_id_key fails if two rows
-- share a listing_id (expected once a payment_failed order and a later live
-- order coexist).

DROP INDEX IF EXISTS listing_orders_one_live_per_listing;

ALTER TABLE listing_orders
    ADD CONSTRAINT listing_orders_listing_id_key UNIQUE (listing_id);
