-- 056_listing_bid_idempotency.down.sql
--
-- Reverse 056_listing_bid_idempotency.up.sql. Dropping the column also
-- drops the dependent partial UNIQUE index.

ALTER TABLE listing_bids
    DROP COLUMN idempotency_key;
