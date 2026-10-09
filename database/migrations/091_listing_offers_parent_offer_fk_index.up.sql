-- Migration 091 — cover the unindexed FK listing_offers.parent_offer_id.
--
-- Self-referencing counter-offer chain. Walking an offer thread was O(table) per hop, and deleting any offer scanned the whole table to find its children.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listing_offers_parent_offer_fk ON listing_offers (parent_offer_id);
