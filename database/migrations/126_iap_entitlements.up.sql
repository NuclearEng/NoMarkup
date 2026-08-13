-- F6 StoreKit verify: persist a verified App Store transaction as an
-- entitlement. Written only after JWS x5c chain + signature verify.
-- PRIMARY KEY (user_id, product_id) makes renewals upsert; UNIQUE
-- transaction_id prevents the same Apple txn from being claimed twice.

CREATE TABLE iap_entitlements (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id     TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    environment    TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, product_id),
    CONSTRAINT iap_entitlements_product_id_check CHECK (product_id <> ''),
    CONSTRAINT iap_entitlements_transaction_id_check CHECK (transaction_id <> '')
);

CREATE UNIQUE INDEX idx_iap_entitlements_transaction_id
    ON iap_entitlements (transaction_id);

COMMENT ON TABLE iap_entitlements IS
    'F6 StoreKit: one verified App Store entitlement per (user, product). transaction_id is globally unique.';
