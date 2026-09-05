-- Reserve price + Buy It Now + zip_codes lookup table.
--
-- Adds two optional columns to the listings schema (audit gap #10):
--
--   1. reserve_price_cents — hidden minimum the seller will accept. NULL
--      means "no reserve" (the auction's high bid wins outright). When a
--      reserve is set and the high bid is below it, the auction closes
--      without a sale (handled by the close-auction job, out of scope
--      for this migration).
--
--   2. buy_now_price_cents — optional fixed-price closeout. When set, a
--      buyer can skip the auction entirely by paying this price. The
--      handler at gateway/internal/handler/listings_bid.go::BuyItNow
--      transitions the listing to status='sold' and creates a
--      listing_orders row in escrow_status='held'.
--
-- Also lands the `zip_codes` table that Wave 1 punted on. Without it,
-- listings whose seller didn't pass an explicit lat/lng default to (0,0)
-- and silently drop out of every radius search. The seed below covers
-- the demo cities in pitch.md; a full ZCTA import (~40K rows) ships as
-- a separate operations task — see docs/operations/zip-codes-import.md.

ALTER TABLE listings
  ADD COLUMN reserve_price_cents BIGINT,
  ADD COLUMN buy_now_price_cents BIGINT;

COMMENT ON COLUMN listings.reserve_price_cents IS
  'Hidden minimum to actually win. NULL = no reserve.';
COMMENT ON COLUMN listings.buy_now_price_cents IS
  'Optional fixed-price closeout. NULL = auction-only.';

-- Reserve must be positive when set; same for buy-now. The buy-now
-- price must be at least the reserve price when both are present.
ALTER TABLE listings ADD CONSTRAINT listings_reserve_positive
  CHECK (reserve_price_cents IS NULL OR reserve_price_cents > 0);

ALTER TABLE listings ADD CONSTRAINT listings_buy_now_positive
  CHECK (buy_now_price_cents IS NULL OR buy_now_price_cents > 0);

ALTER TABLE listings ADD CONSTRAINT listings_buy_now_above_reserve
  CHECK (
    buy_now_price_cents IS NULL OR
    reserve_price_cents IS NULL OR
    buy_now_price_cents >= reserve_price_cents
  );

-- ────────────────────────────────────────────────────────────────────
-- zip_codes lookup table.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE zip_codes (
  zip      TEXT PRIMARY KEY,
  city     TEXT,
  state    TEXT,
  lat      DOUBLE PRECISION NOT NULL,
  lng      DOUBLE PRECISION NOT NULL,
  location GEOGRAPHY(Point, 4326) NOT NULL
);

CREATE INDEX idx_zip_codes_location ON zip_codes USING GIST (location);

-- Minimal seed for demo cities so radius search works without a full
-- ZCTA import. Production should layer in the full file via a backfill
-- job; the lookup falls back to (0,0) with a warning if a ZIP is
-- absent (see gateway/internal/handler/listings_write.go::CreateListing).
INSERT INTO zip_codes (zip, city, state, lat, lng, location) VALUES
  ('78701','Austin','TX',30.2672,-97.7431,
    ST_SetSRID(ST_MakePoint(-97.7431,30.2672),4326)::geography),
  ('78702','Austin','TX',30.2638,-97.7144,
    ST_SetSRID(ST_MakePoint(-97.7144,30.2638),4326)::geography),
  ('78703','Austin','TX',30.2899,-97.7621,
    ST_SetSRID(ST_MakePoint(-97.7621,30.2899),4326)::geography),
  ('78704','Austin','TX',30.2435,-97.7644,
    ST_SetSRID(ST_MakePoint(-97.7644,30.2435),4326)::geography),
  ('94102','San Francisco','CA',37.7791,-122.4191,
    ST_SetSRID(ST_MakePoint(-122.4191,37.7791),4326)::geography),
  ('94103','San Francisco','CA',37.7726,-122.4099,
    ST_SetSRID(ST_MakePoint(-122.4099,37.7726),4326)::geography),
  ('10001','New York','NY',40.7506,-73.9971,
    ST_SetSRID(ST_MakePoint(-73.9971,40.7506),4326)::geography),
  ('10002','New York','NY',40.7156,-73.9869,
    ST_SetSRID(ST_MakePoint(-73.9869,40.7156),4326)::geography),
  ('60601','Chicago','IL',41.8855,-87.6217,
    ST_SetSRID(ST_MakePoint(-87.6217,41.8855),4326)::geography),
  ('98101','Seattle','WA',47.6101,-122.3344,
    ST_SetSRID(ST_MakePoint(-122.3344,47.6101),4326)::geography),
  ('80201','Denver','CO',39.7405,-104.9870,
    ST_SetSRID(ST_MakePoint(-104.9870,39.7405),4326)::geography),
  ('02108','Boston','MA',42.3580,-71.0636,
    ST_SetSRID(ST_MakePoint(-71.0636,42.3580),4326)::geography),
  ('33101','Miami','FL',25.7752,-80.2086,
    ST_SetSRID(ST_MakePoint(-80.2086,25.7752),4326)::geography),
  ('30303','Atlanta','GA',33.7525,-84.3925,
    ST_SetSRID(ST_MakePoint(-84.3925,33.7525),4326)::geography)
ON CONFLICT (zip) DO NOTHING;
