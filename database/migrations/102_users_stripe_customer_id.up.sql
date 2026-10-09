-- Give the PERSON a Stripe Customer.
--
-- Background. No Stripe Customer object was ever created anywhere in this repo.
-- `customer.New` had zero call sites (only `customer.Del`, on the GDPR erasure
-- path). The only stripe_customer_id column in the entire schema lived on
-- `subscriptions`, and SubscriptionService.CreateSubscription never populated it
-- — the INSERT wrote ''. Nothing ever UPDATEd it. So
-- PaymentRepository.GetStripeCustomerID returned ("", nil) — success, empty —
-- for 100% of users, forever.
--
-- Everything downstream inherited that emptiness:
--   * CreateSetupIntent never set params.Customer, so a card the buyer confirmed
--     in Stripe Elements attached to no Customer and was garbage-collected.
--   * ListPaymentMethods listed methods for customer="" and returned [].
--   * Every off-session charge (BNPL installments 2..N, listing promotions,
--     auction settlement) was structurally impossible, which is why
--     ChargeListingWinner was never wired to the auction path.
--
-- WHY ON `users` AND NOT ON `subscriptions`. A Stripe Customer is the billing
-- identity of a PERSON: it owns their saved cards and their default payment
-- method. It is not a property of one product they happen to have bought. A
-- non-subscriber must be able to save a card (to bid, to buy, to be charged on
-- an auction win), and a subscriber who cancels must not lose their cards. One
-- row per person, on the person's row.
--
-- BACKFILL. Deliberately none. Every existing user has NULL here and there is no
-- Stripe Customer to backfill FROM — none has ever existed. Provisioning is lazy
-- and idempotent at the point of first need (service.CustomerProvisioner):
-- Stripe create under a deterministic idempotency key derived from the platform
-- user id, then this column claimed with a conditional UPDATE. A one-shot
-- backfill migration would be strictly worse: it would have to call a third
-- party in a transaction, for users who may never save a card.
--
-- CONCURRENCY. The claim is
--     UPDATE users SET stripe_customer_id = $2
--      WHERE id = $1 AND stripe_customer_id IS NULL
-- which is atomic under Postgres row locking: of N racing writers exactly one
-- sees rows-affected=1. The partial UNIQUE index below closes the other
-- direction — two different users can never end up pointing at the same Stripe
-- Customer (which would let one user see and charge another's cards).

ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;

COMMENT ON COLUMN users.stripe_customer_id IS
    'Stripe Customer id (cus_...) owning this person''s saved payment methods and default payment method. NULL until lazily provisioned on first need. Claimed with a conditional UPDATE (... WHERE stripe_customer_id IS NULL) so concurrent provisioning converges on one value; see service.CustomerProvisioner.';

-- One Stripe Customer belongs to at most one platform user. Partial so the
-- overwhelming majority of rows (NULL, never provisioned) cost nothing and do
-- not collide with each other.
CREATE UNIQUE INDEX idx_users_stripe_customer_id
    ON users (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;
