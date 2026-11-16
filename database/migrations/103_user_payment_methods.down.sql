-- Reverse 103.
--
-- Dropping this table loses only the LOCAL mirror: the PaymentMethods themselves
-- continue to exist at Stripe, still attached to the Customers recorded in
-- users.stripe_customer_id (migration 102), and ListPaymentMethods reads them
-- from Stripe rather than from here. What is lost is the DB-enforced
-- single-default invariant, the local audit trail of which card was on file
-- when, and the fail-closed "does this buyer have an instrument?" check that the
-- settlement sweeper consults before an off-session charge.
--
-- Consequence to understand before running this: with the table gone the sweeper
-- can no longer establish chargeability from local data. It fails CLOSED (no
-- instrument known => no charge attempted), so no money moves incorrectly — but
-- auction settlement stops collecting until the table is restored.

DROP TABLE IF EXISTS user_payment_methods;
