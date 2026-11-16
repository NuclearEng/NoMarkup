-- payment_failed frees the listing for a new pending_payment order.
-- refunded, released, held, disputed, pickup_confirmed, partially_refunded,
-- and pending_payment stay unique (those listings are not relisted by this
-- index). Do not treat refunded or released as relistable.
--
-- Replaces listing_orders_listing_id_key (UNIQUE (listing_id) from 034) so a
-- terminal payment_failed row no longer occupies the listing.

ALTER TABLE listing_orders DROP CONSTRAINT IF EXISTS listing_orders_listing_id_key;

CREATE UNIQUE INDEX listing_orders_one_live_per_listing
    ON listing_orders (listing_id)
    WHERE escrow_status <> 'payment_failed';
