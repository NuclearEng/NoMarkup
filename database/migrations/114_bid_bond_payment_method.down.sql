-- Reverse 114: drop capturable payment-method column on bid_bonds.
ALTER TABLE bid_bonds
    DROP COLUMN IF EXISTS stripe_payment_method_id;
