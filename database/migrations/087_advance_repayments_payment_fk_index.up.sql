-- Migration 087 — cover the unindexed FK advance_repayments.payment_id.
--
-- Money path. The table's only non-PK index leads on advance_id, and 076's unique index leads on advance_id too, so nothing serves payment_id. Reconciling 'what did this payment pay down' — the exact query the 075 double-credit incident needs — was a full scan.
--
-- Part of the unindexed-foreign-key batch 083-097. See 083's header for the
-- measurement, the full skip list, and why each of these is its own file.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_advance_repayments_payment_fk ON advance_repayments (payment_id);
