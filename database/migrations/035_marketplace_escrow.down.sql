DROP TRIGGER IF EXISTS seller_tax_forms_set_updated_at ON seller_tax_forms;
DROP TRIGGER IF EXISTS marketplace_disputes_set_updated_at ON marketplace_disputes;
DROP TABLE IF EXISTS marketplace_disputes;
DROP TABLE IF EXISTS seller_tax_forms;
DROP INDEX IF EXISTS idx_listing_orders_auto_release;
ALTER TABLE listing_orders
    DROP COLUMN IF EXISTS auto_release_at,
    DROP COLUMN IF EXISTS idempotency_key,
    DROP COLUMN IF EXISTS seller_payout_cents,
    DROP COLUMN IF EXISTS tax_cents;
ALTER TABLE listing_orders DROP CONSTRAINT IF EXISTS listing_orders_escrow_status_check;
ALTER TABLE listing_orders ADD CONSTRAINT listing_orders_escrow_status_check
    CHECK (escrow_status IN ('held','pickup_confirmed','released','disputed','refunded'));
