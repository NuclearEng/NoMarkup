-- 109_bid_bond_idempotency.down.sql
DROP INDEX IF EXISTS idx_bid_bonds_idempotency;
ALTER TABLE bid_bonds
    DROP COLUMN IF EXISTS idempotency_key;
