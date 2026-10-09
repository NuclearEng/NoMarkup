-- 057_backfill_listing_bid_count (up)
--
-- One-time data backfill. A just-fixed bug left `listings.bid_count`
-- historically inflated/drifted: it counted auto-bid cascade rows AND
-- double-counted against the migration-034 atomic-delta trigger.
--
-- The application code now writes
--   bid_count = COUNT(DISTINCT bidder_id WHERE retracted_at IS NULL),
-- but EXISTING rows keep their wrong values until the next bid/retract
-- recomputes each listing. This migration recomputes every listing once
-- to the correct definition.
--
-- Idempotent: re-running recomputes the same authoritative value from
-- listing_bids, so it is safe to apply more than once.
--
-- Locking note: this is a single UPDATE over the whole table. Fine for
-- dev. On a very large production table it briefly row-locks every
-- updated row; if that becomes a concern, batch by id range instead.
-- One operation per §5.

UPDATE listings
   SET bid_count = COALESCE((
        SELECT COUNT(DISTINCT bidder_id)
          FROM listing_bids
         WHERE listing_bids.listing_id = listings.id
           AND retracted_at IS NULL
   ), 0);
