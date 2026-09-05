-- 114_bid_bond_payment_method.up.sql
--
-- Persist the Stripe PaymentMethod attached when a bid bond SetupIntent
-- succeeds (ConfirmBidBond). Without this column the handler verified the
-- card was set up but discarded payment_method_id — so authorized bonds
-- deterred no-shows only by ceremony, with nothing capturable later.
-- Capture-on-no-show still depends on a future cron; this is the capturable
-- artifact that cron will need.
--
-- Nullable: legacy authorized rows predate this column (soft-replay OK with
-- NULL). New pending→authorized transitions always set a non-empty value
-- (real pm_* from Stripe, or pm_dev_<bond_id> in the development nil-client
-- short-circuit).

ALTER TABLE bid_bonds
    ADD COLUMN stripe_payment_method_id TEXT;

COMMENT ON COLUMN bid_bonds.stripe_payment_method_id IS
    'Stripe PaymentMethod id attached when ConfirmBidBond authorizes the bond (from GetSetupIntentStatus). NULL = legacy pre-114 authorized row or still-pending. Required non-empty on every new pending→authorized transition so a future no-show capture has something to charge.';
