# NoMarkup — Pitch

> Live auctions for services and goods. Local pickup only.
>
> Where transactions are watched, not posted.

---

## 1. The Problem

The local-commerce stack hasn't changed in 25 years.

- **Craigslist** still ships a 1996 list of links.
- **Facebook Marketplace** moved it to a Pinterest grid.
- **Thumbtack/Angi** charge contractors $30-$80 per lead with no commitment.
- **OfferUp** is Facebook Marketplace with worse search.

Every one of them uses the same format: a seller posts, buyers contact, a
DM negotiation begins. No urgency. No price discovery. No public proof
that anyone else cares about the listing. Sellers ghost. Buyers
lowball. Prices float on vibes.

For services, it's worse. Three contractors quote three numbers. None
explain how. The homeowner is the price-discovery mechanism, and the
mechanism is "look gullible enough to pay 3x."

## 2. The Insight

**The marketplace itself can host price discovery.**

Live. Public. On a clock.

When the auction is the platform, every listing has:
- A countdown (urgency)
- A watcher count (social proof)
- A bid trail (price legitimacy)
- Snipe extensions (fairness)

This is the same loop Whatnot, StockX, and eBay Live have proven.
Nobody has done it for the Craigslist + Thumbtack stack.

## 3. The Wedge

NoMarkup's homepage is a **sports scoreboard**, not a listings grid.

```
┌─────────────────────────────────────────────────────────┐
│ THE LIVE MARKETPLACE                                     │
│ Auctions are watched, not posted.                        │
├─────────────────────────────────────────────────────────┤
│ LIVE NOW: 7 auctions closing in the next hour           │
│ [CLOSING <1H: 7]  [WATCHING: 184]  [LIVE BIDS: 42]      │
├─────────────────────────────────────────────────────────┤
│ ▶ CLOSING NOW (under 10 min) — red ribbon, urgency glow │
│ ▶ CLOSING SOON (under 1 hour) — gold ribbon             │
│ ▶ LATER TODAY                                            │
└─────────────────────────────────────────────────────────┘
```

Each card: ticking clock, current bid, watcher count, snipe-extension
badge. The thing reads like ESPN GameDay, not a category catalog.

That's the wedge. The product *feels* different on first scroll. You
don't browse NoMarkup. You catch it.

## 4. The Product

### Two surfaces, one identity

| Surface  | Auction       | Who posts     | Who wins             | Closeout                        |
|----------|---------------|---------------|----------------------|---------------------------------|
| Services | Reverse       | Customer      | Lowest qualified bid | Customer accepts within 24h     |
| Goods    | Forward       | Seller        | Highest bid at close | Auto-award, escrow holds funds  |

One user. One trust score. One Stripe Connect Express account. Local
pickup only, 25-mile radius (PostGIS-enforced at the service layer). No
shipping in v1 — the trust transfer hinges on physical hand-off.

### Trust that compounds

A provider who delivers on services builds a score. That same score
applies when they sell a tool on the goods surface. A buyer who closes
out cleanly on goods auctions is a trusted customer when posting a
plumbing job. Cross-vertical trust is the moat that single-vertical
competitors can't build.

### Live theater

- Real-time bid streaming via WebSocket
- Spectator counts via Redis sorted-sets (decays after 30s of inactivity)
- Snipe-extension: bids in the final 60s push the deadline +30s
- Push notifications when something you watch hits its final 10 min

## 5. The Stack

This is shipped, not roadmap.

**Frontend:** Next.js 15 + Tailwind 4 + shadcn/ui + TanStack Query + Zustand. ~3,800 unit tests. WCAG 2.2 AA enforced.

**Backend:** Go API gateway + microservices over gRPC. Rust engines for
bidding (sub-1ms p99), fraud (heuristic v1, ML deferred to v2), trust
scoring, and image processing. Postgres 16 + PostGIS for geo. Redis 7.
Meilisearch for sub-50ms search.

**Security:** libsodium PII encryption at rest. HashiCorp Vault wrapper
in production. CSP per-request nonces with strict-dynamic. Stripe webhook
signature verification + idempotency keys enforced by hooks. GDPR
erasure pipeline with 30-day grace and FOR UPDATE-locked cascade.

**Observability:** OpenTelemetry distributed tracing. Prometheus
metrics. Sentry for both surfaces. slog structured JSON everywhere.

## 6. Why Now

Three things have to be true at once. They are.

1. **Live auctions are the format that's working.** Whatnot raised at
   $5B in 2024 on live collectibles. StockX proved live price discovery
   beats static listings on goods. eBay Live is one of eBay's only
   growth segments. Every adjacent format is contracting.

2. **Local commerce is structurally underserved.** Thumbtack and Angi
   both took venture funding 15+ years ago and stalled at 1-2% of US
   home-services TAM. Craigslist hasn't shipped a feature in a decade.
   Facebook Marketplace is throttled by FB's adjacency to the trust
   layer (you don't trust your aunt's friend).

3. **AI tooling collapses team size for full-stack platforms.** A
   4-language production marketplace (Next.js + Go + Rust + Postgres)
   is now buildable by a team of two with the help of Claude. Five
   years ago this was a Series A staffing problem.

## 7. Traction

This is a pre-seed company. Traction is the build.

- 16 vertical slices of the platform shipped to a feature-complete state
- Two marketplaces (services reverse, goods forward) sharing identity, payments, trust, and chat
- Production-grade security audit complete (CSP, GDPR, PII encryption, rate limits, idempotency)
- 3,800+ unit tests, all passing
- Pilot city: Austin. Beta-launching with seed providers and listings.

## 8. The Ask

Pre-seed: $1.5-2M.

**Use of funds:**
- Austin pilot operations (CAC, ground-game, regulatory counsel)
- Two demand-side hires (growth + community)
- Multi-state escrow legal review for the goods surface
- 12-18 months of runway through Series A milestone (10K MAU, $100K GMV/mo)

## 9. The Team

[Founder bio and team go here]

## 10. The Vision

NoMarkup isn't a Craigslist replacement. Craigslist is the current
sediment of unmet local-commerce demand.

The thesis is bigger: **every category that currently transacts on
Marketplace, Craigslist, Thumbtack, OfferUp, Angi, Nextdoor, Patch,
Yelp Quote-It, and Facebook groups will eventually transact on a
live-auction layer.**

We are building that layer.

---

**Demo:** [staging URL]
**Repo:** github.com/NuclearEng/NoMarkup
**Founder:** [contact]
