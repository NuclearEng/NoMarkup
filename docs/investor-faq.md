# NoMarkup — Investor FAQ

> Anticipated questions, sharp answers. Updated as new ones come in.

---

## Market & Competitive

### Q: Why hasn't Facebook Marketplace done this?

They can't ship it. Marketplace is a tab inside the Facebook app, owned
by a team that competes for engineering resources with feed and
messaging. Live auctions break the static-listing data model that all
of Marketplace's monetization relies on. They tried live commerce
(Facebook Live Shopping, 2022) and shut it down after 18 months.

### Q: Why hasn't Whatnot done this?

Whatnot is collectibles-only and shipping-first. Their auction model is
streamer-led, not listing-led — there's a host who picks items, runs
the bid, and ships. That format doesn't extend to local services or
peer-to-peer goods. They're optimized for a different shape of liquidity.

### Q: Why hasn't eBay done this?

eBay launched eBay Live in 2022 and it's a tiny fraction of GMV.
eBay's core liquidity is fixed-price BIN listings now (~80% of GMV).
Their auction format is global + shipping; ours is hyperlocal + pickup.
We're in a different competitive set.

### Q: Why hasn't Thumbtack added auctions?

Thumbtack's revenue model is per-lead pricing. Auctions destroy that —
the contractor only pays when they win. Their lifetime value/contractor
ratio collapses. Their CAC math falls apart. They are structurally
disincentivized to build this.

### Q: Isn't this just Craigslist with a timer?

Craigslist with a timer would be a solid product. We're building
Craigslist + Thumbtack + StockX, with a shared trust layer, escrow,
and live bid streaming. The timer is the wedge, not the product.

---

## Product & Wedge

### Q: How does an auction work for services?

Reverse-auction. Customer posts "fix my leaky kitchen sink, $300 ceiling".
Three contractors bid the price *down* — $290, $250, $230. Customer can
accept the lowest qualified bid (with a trust score above their threshold)
or wait for more. Bids sealed until the auction closes — contractors
don't see each other's numbers. Identical mechanism to public-sector
RFP, with the urgency of a clock.

### Q: How does an auction work for goods?

Forward-auction. Seller posts a couch with a $200 starting bid and a
24-hour clock. Buyers within 25 miles bid the price up. Highest bid at
close wins, escrow holds the funds, buyer drives over to pick up,
buyer confirms pickup, escrow releases.

### Q: What if the auction closes with no bids?

Listing expires. Seller can re-list with a lower starting price (~85%
of sellers do, based on services data). No fee charged on unsold
listings. We learn the market clearing price the seller is comfortable
with, and that data is private to the seller.

### Q: What about no-shows?

This is the operational hard part of local pickup. Our flow:
1. Buyer wins, escrow holds.
2. Seller has 48 hours to confirm pickup window via in-app chat.
3. Buyer has 72 hours to complete pickup.
4. Both sides confirm pickup in-app (selfie + signed code).
5. Escrow releases on dual confirmation, or admin arbitration on dispute.

Trust score takes hits on no-shows. After 2 no-shows, the user is
shadow-banned from bidding for 30 days. We've seen Whatnot's no-show
rate (~3%) and OfferUp's (~22%). Escrow + trust score moves us toward
the Whatnot end of that range.

### Q: Why no shipping in v1?

Shipping breaks the trust hand-off model. The buyer hands the seller a
phone screen with a confirmation code; the seller hands the buyer the
item. The escrow releases on that physical exchange. With shipping, you
need carrier integrations, claims processes, refund SLAs, and lost-package
reserve capital. None of that is impossible — it's just not v1. Local-only
is the wedge.

---

## Trust & Safety

### Q: How do you prevent fake bids?

Three layers:
1. **Bid bond:** First-time buyers must hold a Stripe pre-auth equal
   to 10% of their bid. Fraudulent bids forfeit the bond.
2. **Trust score gate:** Sellers can require a minimum trust score on
   bidders (e.g., trust > 50 for items above $1K).
3. **Fraud engine (Rust):** Behavioral heuristics — bidding velocity,
   geographic mismatch, fingerprint entropy, multi-account ring
   detection. ML inference is deferred to v2; v1 ships deterministic
   heuristics.

### Q: How do you prevent shill bidding (sellers bidding on themselves)?

Sellers can't bid on their own listings (DB constraint). We detect
multi-account rings through fingerprint clustering, payment-method
overlap, and geographic patterns. A seller with a known shill ring is
permanently banned and any active listings are voided.

### Q: How do you handle disputes?

`marketplace_disputes` table (migration 035). Either side opens a
dispute within 7 days of pickup confirmation. Escrow is frozen.
Customer support (us, in v1) reviews evidence (in-app chat, photos,
code confirmations). 90% of disputes resolve in <48h based on similar
platforms. Stripe handles the payment-side mechanics; we handle the
narrative.

### Q: GDPR / data deletion?

Full erasure pipeline. 30-day grace period (user can cancel deletion).
On execution: PII fields (email, phone, address, name) are nulled or
hashed; userable IDs are tombstoned but preserved for audit; chat
messages get scrubbed of identifying information; auction history is
retained for 7 years for tax/regulatory reasons (anonymized). Run via
`FOR UPDATE`-locked cascade to avoid race conditions during a delete.

---

## Stack & Engineering

### Q: Why Go and Rust both?

Go for everything that needs to be readable, deployable, and fast
enough — gateway, user/job/payment services, chat WebSocket layer.
Rust for the parts where p99 latency drives the product feel — bid
processing (sub-1ms target), trust scoring, fraud heuristics, imaging
(`image` crate), underwriting, and pricing. **Search is Meilisearch + Go;
geo is PostGIS + Go** — not separate Rust engines.

This isn't a religion. It's the standard pattern at marketplaces that
scaled: keep hot numerical paths in a systems language and own CRUD in
Go. We're shipping the architecture we know we'll need at scale rather
than rewriting at Series B.

### Q: Microservices for a pre-seed company. Premature?

Three services on a single VM in dev. Each service is small (300-2000
lines). The boundary discipline is what we want, not the deployment
complexity. Production deploys to a single Kubernetes cluster. We can
collapse boundaries if we need to. We can't add them.

### Q: Why custom auth instead of Auth0/Clerk?

JWT (RS256) + secure session cookies + Argon2id is ~400 lines of Go.
Auth0/Clerk are $500/mo at our planned MAU and they own the user table.
Custom auth means we own the trust score, multi-account detection, and
the 2FA flow we want for sellers. The cost-to-build is paid down.

### Q: Coverage / test claims real?

Yes — with precise numbers, not marketing inflation. `web/` has thousands
of Vitest unit/integration tests; v8 **whole-app floors** in
`vitest.config.mts` are approximately **71% branches / 75% functions /
77% lines / 76% statements** (ratchet up; not a blanket “80% every metric”).
Go services and gateway have extensive unit tests; **integration tests run
against a CI PostGIS service container** (not testcontainers-go). Rust
engines use **proptest** on numerical paths (trust, bidding, fraud,
underwriting). **Criterion benches and k6 load scripts exist but are not
CI-gated.** Playwright E2E in CI is Chromium and backend-tolerant; full
funnel dogfood needs a live stack and `SEED_PASSWORD`.

---

## Business Model

### Q: How do you make money?

Two revenue streams:
1. **Goods take rate:** 5% commission on completed pickups, paid by
   the seller. Stripe Connect handles the split.
2. **Services placement fee:** Customer pays a flat $5 to post a job
   (refunded if no bids match). Provider pays nothing on bid placement;
   only pays on win — 8% of the bid amount.

### Q: Unit economics?

Average goods listing: ~$80 sale, ~$4 take. CAC target at scale: ~$3
per active buyer (organic + referral). LTV at 6 transactions/year:
~$24/buyer/year, contributing to a 8x LTV/CAC at steady state. These
are projections; pilot data will validate.

### Q: TAM?

Combined US TAM:
- Local services (Thumbtack/Angi/Yelp Quote-It): ~$500B annualized
- Local peer-to-peer goods (Marketplace/Craigslist/OfferUp): ~$30B GMV
- Take-rate addressable: ~$25B/year

We need <0.1% of this to be a Series A company. <1% to be a billion-dollar company.

---

## Risks & Bear Case

### Q: What's the bear case?

Three real risks, in order:

1. **Liquidity death spiral.** Marketplaces fail when one side shows up
   and the other doesn't. We mitigate with single-metro launch (**King
   County / Seattle, WA**), seller-side incentives, and aggressive
   in-person seeding for the first 60 days. If we can't get to density
   targets in 90 days, we have a problem.

2. **Auction format doesn't transfer to services.** Maybe homeowners
   won't wait for an auction to close on a leaky pipe. We have a
   "Buy It Now"-style instant-accept path for emergency services
   (matches the lowest acceptable bid threshold). If <30% of services
   listings convert via the auction path, we collapse to instant-accept
   and the wedge shifts to goods-only.

3. **Trust transfer doesn't matter.** Maybe buyers don't care that
   their plumber also sold a tool kit cleanly. We bet the cross-vertical
   trust loop creates retention. If retention curves at month 3 are
   below the single-vertical baseline of OfferUp/Thumbtack, the
   architecture overengineering didn't pay off.

### Q: What kills you in a downturn?

A downturn helps a goods auction marketplace (people sell stuff they
don't need). It hurts a services marketplace (people defer
discretionary work). The two surfaces hedge each other. We're more
resilient than a pure-services or pure-goods competitor.

### Q: What if regulators come for the escrow model?

Money transmission rules vary by state. We're using Stripe Connect
Express, which holds money transmitter licenses in all 50 states. We
never custody funds directly. Use of funds includes regulatory counsel
to confirm this stays clean as we scale.

---

## The Founder

### Q: Why are you the right person to build this?

[Founder bio + relevant experience here]

### Q: How big is the team?

[Current team size + hiring plan]

### Q: Why now, why this?

[Founder origin story]
