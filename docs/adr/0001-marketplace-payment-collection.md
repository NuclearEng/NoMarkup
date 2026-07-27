# ADR-0001: How the goods marketplace actually collects money

**Status:** Accepted
**Date:** 2026-07-25
**Supersedes:** the implicit design in `listing_charge.go`, which assumed an
off-session charge was possible.

## Context

A production-readiness review found that the goods marketplace bills nobody.
Not "the auction path is unwired" — nobody, on any path. Three independent
facts, each verified against the tree:

1. **No Stripe Customer is ever created.** `customer.New` appears nowhere in
   the repository; only `customer.Del`, for GDPR erasure.
   `GetStripeCustomerID` reads `subscriptions.stripe_customer_id`, a column
   that `CreateSubscription` inserts as `""` and nothing ever updates. It
   returns `("", nil)` — empty, with no error — for every user.
2. **SetupIntents attach to nothing.** `CreateSetupIntent` never set
   `params.Customer`, and there was no `paymentmethod.Attach`, no
   `SetupFutureUsage`, no default payment method. A card the buyer confirmed
   was associated with no one, so `GET /api/v1/payments/methods` returned `[]`
   for everybody.
3. **The web app never confirms a payment.** `confirmPayment` appears nowhere
   in `web/src`, and the buy-now and offer-accept hooks received a
   `client_secret` and discarded it.

Consequently `ChargeListingWinner` had no callers, auction-won orders sat in
`pending_payment` forever, escrow never reached `held`, and the auto-release
sweeper never saw them. The BNPL collector had to be made fail-closed for the
same reason: with no customer, every charge is rejected, counted as a customer
payment failure, and three passes later defaults the plan of a customer who
did nothing wrong.

## The decision we did NOT make

The tempting fix was to tune around the symptom: pick a payment window, add an
expiry state, mark unfunded orders failed, and call the ticket closed. That
would have been decorating a hole. Every parameter in that design is
downstream of "there is nothing to charge," so tuning them changes nothing
about whether money moves.

## Decision

Build the standard Stripe Connect marketplace architecture the code was
already reaching for.

1. **The Stripe customer id belongs to the USER, not to a subscription.** It
   is a property of the person, not of one product they happened to buy.
   Storing it on `subscriptions` is why it was never populated for anyone who
   had not subscribed — which is most buyers.

2. **Provision lazily and idempotently.** Existing users have no customer, so
   this cannot be a one-shot migration. The failure mode to design against is
   a Customer existing at Stripe that we have no record of: that silently
   splits a user's saved cards across two objects and is painful to unwind.
   Deterministic idempotency key at Stripe plus a uniqueness guarantee in the
   database, not one or the other.

3. **SetupIntent attaches to the customer with `usage=off_session`.** That is
   the whole point — a card that cannot be charged while the buyer is away is
   useless for an auction that closes at 3am.

4. **Charge at auction close, off-session, immediately.** The payment window
   is therefore NOT the normal path. It exists only for failures.

5. **Failure modes are distinct outcomes, never one error.** No card on file,
   declined, insufficient funds, and `authentication_required` require
   different responses. SCA in particular *cannot* be resolved off-session —
   the buyer must return to the app and authenticate — so collapsing it into
   "payment failed" would strand every EU/UK buyer with a compliant bank.

## Consequences for the parameters that were left open

These were flagged as needing ratification. Deciding them only became
meaningful once the above was settled.

**Payment window: 72 hours.** With off-session collection working, the happy
path charges at close and never touches the window. It is a grace period for
failures, so the question is not "how long does a buyer need to pay" but "how
long do we hold a seller's item off the market while a buyer fixes a card."
eBay's 4 days is calibrated for shipped goods; this is local pickup, where the
item is physically held and liquidity matters more. Reminders matter more than
duration: notify on failure, at 24h, and at 48h.

**Expiry: armed, but only after the buyer has actually been told.** Cancelling
someone's won auction is a real harm, and doing it silently is worse than not
doing it. It stays behind `MARKETPLACE_PAYMENT_EXPIRY` and is only turned on
once notifications are wired, because `SetNotifier` was never called in
`main.go` and all five notifier methods were no-ops in production. An expiry
that fires without a warning email is a trap, not a policy.

**Notifications: wired, and treated as part of the money path.** A buyer whose
card fails must be told, or the 72h window is a countdown they cannot see.

## What this does not fix

Bid bonds persist a capturable PaymentMethod on authorize (migration
`114_bid_bond_payment_method`). **Buyer no-show forfeit is wired on
`POST /orders/{id}/report-no-show`**: when the absent party is the buyer, the
gateway charges the authorized bond off-session (`ChargePromotion` against the
SetupIntent secret + amount, idempotency `bid-bond-capture:{bond_id}`) and CAS
`authorized → captured`. Fail-soft if no bond / charge fails (no-show counters
still stand). Seller no-show does not forfeit the buyer bond. Release-on-win/lose
remains a separate residual.
