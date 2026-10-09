-- Listing condition grading + bid retraction window.
--
-- Adds two surface-level features that close audit gaps in the goods
-- marketplace surface:
--
--   1. `condition` — StockX-style enum on listings. Buyers won't bid on a
--      $400 lawnmower without knowing whether it's "like new" or "for
--      parts." Optional (NULL = "seller didn't say"); when set, must be
--      one of six grades.
--
--   2. `retracted_at` on listing_bids — eBay-style 60-second grace
--      period. The leading bidder can withdraw a fresh bid without
--      penalty (typo, fat-finger). The retraction handler at
--      gateway/internal/handler/listings_bid.go::RetractBid enforces:
--
--        - only the current high bid (status='active') can be retracted
--        - bid must be < 60 seconds old (now() - created_at < 60s)
--        - retracted bids are flipped to status='retracted', not deleted
--        - the next-highest non-retracted bid is promoted to active and
--          becomes the new current_bid_cents on the listing
--
--      Demoted (status='outbid') and awarded (status='awarded') bids are
--      NOT retractable — they're frozen by the auction state machine.
--
-- The down migration drops the columns + indexes + constraint additions.
-- The pre-existing listing_bids.status CHECK (anonymous) is recreated
-- under a stable name so the down migration can safely rebuild the
-- original five-value enum.

-- ────────────────────────────────────────────────────────────────────
-- 1. listings.condition
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE listings ADD COLUMN condition TEXT;

ALTER TABLE listings ADD CONSTRAINT listings_condition_check
  CHECK (condition IS NULL OR condition IN
    ('new','like_new','very_good','good','acceptable','for_parts'));

COMMENT ON COLUMN listings.condition IS
  'StockX-style grade. NULL = seller didn''t say. Allowed values: new, like_new, very_good, good, acceptable, for_parts.';

CREATE INDEX idx_listings_condition ON listings(condition) WHERE condition IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────
-- 2. listing_bids.retracted_at + status='retracted'
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE listing_bids ADD COLUMN retracted_at TIMESTAMPTZ;

COMMENT ON COLUMN listing_bids.retracted_at IS
  'Set when the bidder withdraws within 60s. Retracted bids are not reinstated by reorg, and do not count toward bid_count.';

CREATE INDEX idx_listing_bids_retracted ON listing_bids(retracted_at) WHERE retracted_at IS NOT NULL;

-- The existing status CHECK was anonymous; replace it with a named
-- constraint that includes 'retracted'. Postgres autogenerates names
-- like listing_bids_status_check for unnamed CHECKs, but those aren't
-- portable across database snapshots, so the safe path is to look up
-- and drop any pre-existing CHECK on `status` before re-adding.
ALTER TABLE listing_bids DROP CONSTRAINT IF EXISTS listing_bids_status_check;

-- Best-effort cleanup of the auto-generated default name.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'listing_bids'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%status%IN%'
   LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE listing_bids DROP CONSTRAINT %I', cname);
  END IF;
END$$;

ALTER TABLE listing_bids ADD CONSTRAINT listing_bids_status_check
  CHECK (status IN ('active','outbid','winning','awarded','withdrawn','retracted'));
