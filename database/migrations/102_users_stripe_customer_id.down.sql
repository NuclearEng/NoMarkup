-- Reverse 102.
--
-- NOTE FOR OPERATORS: dropping this column does NOT delete the Stripe Customer
-- objects it referenced. After a down-migration those Customers still exist at
-- Stripe, still hold the users' cards, and the platform no longer has any record
-- of which user each belongs to. Re-applying 102 leaves every user NULL and
-- lazy provisioning will mint a SECOND Customer per person (the deterministic
-- idempotency key only replays within Stripe's 24h key window), splitting their
-- saved cards across two objects.
--
-- Take an export before running this in any environment with real Customers:
--     SELECT id, stripe_customer_id FROM users WHERE stripe_customer_id IS NOT NULL;
-- CLAUDE.md §15 makes migrations forward-only in production; this down exists
-- for development reversibility, which is the only place it should be used.

DROP INDEX IF EXISTS idx_users_stripe_customer_id;

ALTER TABLE users DROP COLUMN IF EXISTS stripe_customer_id;
