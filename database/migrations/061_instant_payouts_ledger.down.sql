-- 061_instant_payouts_ledger.down.sql
--
-- Reverse 061: drop the instant payout ledger. Indexes drop with the table.

DROP TABLE IF EXISTS instant_payouts;
