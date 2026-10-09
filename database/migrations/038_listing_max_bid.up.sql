-- 038_listing_max_bid.up.sql
--
-- Proxy / auto-bidding (eBay-style) for the goods marketplace.
--
-- Adds a confidential `max_bid_cents` ceiling to each listing_bid. The visible
-- `amount_cents` is the price paid right now; `max_bid_cents` is the buyer's
-- private maximum, used by the auction engine to auto-raise on their behalf
-- against competing bidders' max ceilings. NULL = bid is exactly amount_cents
-- (no autobid headroom — equivalent to legacy behavior).
--
-- The cascade is implemented in the gateway placeBidTx loop
-- (gateway/internal/handler/listings_bid.go); this migration just provides
-- the column + a partial index over the active competing maxes.

ALTER TABLE listing_bids
    ADD COLUMN max_bid_cents BIGINT;

COMMENT ON COLUMN listing_bids.max_bid_cents IS
    'Buyer''s confidential ceiling for proxy bidding. NULL = bid is exactly amount_cents (no autobid).';

-- Index used by the auto-bid cascade to find the highest standing
-- competing max on a listing. Partial: only active rows with a max set
-- contribute to autobid logic.
CREATE INDEX idx_listing_bids_active_max
    ON listing_bids (listing_id, max_bid_cents DESC)
 WHERE status = 'active' AND max_bid_cents IS NOT NULL;
