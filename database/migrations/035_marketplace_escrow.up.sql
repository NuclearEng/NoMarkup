-- Marketplace escrow lifecycle hardening (PR #marketplace-escrow).
--
-- Builds on migration 034 which created listing_orders. Adds:
--   1. `pending_payment` to the escrow_status CHECK enum so the goods state
--      machine can model `pending_payment -> held -> pickup_confirmed -> released`.
--   2. `tax_cents` on listing_orders for sales-tax tracking (v1 = static state
--      lookup table; see services/payment/internal/service/sales_tax.go).
--   3. `seller_payout_cents` so we have an explicit source of truth for what
--      we transferred to the seller post-fees-and-tax (mirrors
--      payments.provider_payout_cents).
--   4. `seller_tax_forms` — 1099-K shadow of the existing `tax_forms`
--      (services-side 1099-NEC) so 1099-K reporting for goods sellers can be
--      computed independently. Same shape as tax_forms; gross_payments_cents
--      is the federal 1099-K threshold metric.
--   5. `marketplace_disputes` — lightweight goods-side dispute table so we
--      don't have to overload the existing `disputes` table (tied to contracts).

-- 1. Allow the new pending_payment state.
ALTER TABLE listing_orders DROP CONSTRAINT IF EXISTS listing_orders_escrow_status_check;
ALTER TABLE listing_orders ADD CONSTRAINT listing_orders_escrow_status_check
    CHECK (escrow_status IN ('pending_payment','held','pickup_confirmed','released','disputed','refunded','partially_refunded'));

-- 2. Tax + seller-payout columns.
ALTER TABLE listing_orders
    ADD COLUMN IF NOT EXISTS tax_cents BIGINT NOT NULL DEFAULT 0
        CHECK (tax_cents >= 0),
    ADD COLUMN IF NOT EXISTS seller_payout_cents BIGINT NOT NULL DEFAULT 0
        CHECK (seller_payout_cents >= 0),
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS auto_release_at TIMESTAMPTZ;

-- 3. Helpful index for the auto-release cron (escrow_status='held' AND
-- created_at < now() - 14d AND dispute_id IS NULL).
CREATE INDEX IF NOT EXISTS idx_listing_orders_auto_release
    ON listing_orders (escrow_status, created_at)
    WHERE escrow_status = 'held' AND dispute_id IS NULL;

-- 4. seller_tax_forms — 1099-K shadow for goods sellers. Mirrors tax_forms.
CREATE TABLE IF NOT EXISTS seller_tax_forms (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tax_year                    INTEGER NOT NULL,
    form_type                   TEXT NOT NULL DEFAULT '1099-K'
                                CHECK (form_type IN ('1099-K')),
    seller_legal_name           TEXT NOT NULL,
    seller_tax_id_last4         TEXT,
    seller_address              TEXT NOT NULL,
    -- 1099-K reports gross payments by month; we store annual + count here
    -- and the per-month detail can be aggregated from listing_orders.
    gross_payments_cents        BIGINT NOT NULL DEFAULT 0,
    transaction_count           INTEGER NOT NULL DEFAULT 0,
    federal_tax_withheld_cents  BIGINT NOT NULL DEFAULT 0,
    state_tax_withheld_cents    BIGINT NOT NULL DEFAULT 0,
    platform_ein                TEXT NOT NULL,
    platform_name               TEXT NOT NULL,
    pdf_url                     TEXT,
    status                      TEXT NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft','generated','delivered','corrected','filed')),
    delivered_at                TIMESTAMPTZ,
    filed_at                    TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (seller_id, tax_year, form_type)
);

CREATE INDEX IF NOT EXISTS idx_seller_tax_forms_seller_year ON seller_tax_forms (seller_id, tax_year);

-- 5. marketplace_disputes — goods-side disputes. The disputes table is
-- service-contract-shaped (contract_id NOT NULL), so we keep goods disputes
-- in a parallel table. Resolution outcomes include refund_partial which
-- splits the escrow amount between buyer (refund) and seller (transfer).
CREATE TABLE IF NOT EXISTS marketplace_disputes (
    id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_order_id             UUID NOT NULL REFERENCES listing_orders(id) ON DELETE RESTRICT,
    opened_by                    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason                       TEXT NOT NULL CHECK (reason IN (
                                     'item_not_as_described',
                                     'item_damaged',
                                     'no_show',
                                     'item_not_received',
                                     'other'
                                 )),
    description                  TEXT NOT NULL,
    status                       TEXT NOT NULL DEFAULT 'open'
                                 CHECK (status IN ('open','under_review','resolved','closed')),
    -- Resolution: refund_full / refund_partial / release_to_seller / no_action
    resolution                   TEXT
                                 CHECK (resolution IN (
                                     'refund_full',
                                     'refund_partial',
                                     'release_to_seller',
                                     'no_action'
                                 )),
    refund_to_buyer_cents        BIGINT NOT NULL DEFAULT 0 CHECK (refund_to_buyer_cents >= 0),
    transfer_to_seller_cents     BIGINT NOT NULL DEFAULT 0 CHECK (transfer_to_seller_cents >= 0),
    resolution_notes             TEXT,
    resolved_by                  UUID REFERENCES users(id),
    resolved_at                  TIMESTAMPTZ,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_disputes_order_id ON marketplace_disputes (listing_order_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_disputes_status   ON marketplace_disputes (status);

-- updated_at trigger reuses the existing trigger_listings_set_updated_at fn
-- defined in migration 034.
DROP TRIGGER IF EXISTS marketplace_disputes_set_updated_at ON marketplace_disputes;
CREATE TRIGGER marketplace_disputes_set_updated_at
    BEFORE UPDATE ON marketplace_disputes
    FOR EACH ROW EXECUTE FUNCTION trigger_listings_set_updated_at();

DROP TRIGGER IF EXISTS seller_tax_forms_set_updated_at ON seller_tax_forms;
CREATE TRIGGER seller_tax_forms_set_updated_at
    BEFORE UPDATE ON seller_tax_forms
    FOR EACH ROW EXECUTE FUNCTION trigger_listings_set_updated_at();
