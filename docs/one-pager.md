# NoMarkup — One Pager

**Live auctions for services and goods. Local pickup only.**

---

## The Problem

Every two-sided marketplace — Craigslist, Facebook Marketplace, OfferUp,
Thumbtack, Angi — uses the same broken format: a static listing grid.
Users post, then wait. Sellers ghost. Buyers haggle in DMs. Prices are
opaque. Nothing tells you *when* to act.

Service marketplaces have an additional defect: contractors give 3
quotes, all wildly different, all based on what the homeowner "looks like
they can pay." The customer is the price-discovery mechanism.

## The Insight

The marketplace itself can host the price discovery. Live, public, on a
clock. Auctions create urgency that static listings can't. Watchers
create social proof that 5-star ratings can't.

Whatnot, StockX, eBay Live — every modern auction platform is growing.
Nobody has done this for the local Craigslist/Thumbtack space.

## The Wedge

**NoMarkup is where transactions are watched, not posted.**

The homepage is a sports scoreboard, not a Pinterest grid. Live
countdowns. Watcher counts. Snipe extensions. Real-time price discovery.

You don't browse listings on NoMarkup. You catch auctions.

## The Product

| Surface  | Direction         | What                                          |
|----------|-------------------|-----------------------------------------------|
| Services | Reverse-auction   | Homeowner posts a job, providers bid down     |
| Goods    | Forward-auction   | Seller posts an item, buyers bid up           |

One identity. One trust score. One Stripe escrow. Local pickup only,
25-mile radius. No shipping. No drama.

## The Stack

- Next.js 15 web app, native iOS+Android on the roadmap
- Go API gateway + microservices (gRPC over Tonic/Protobuf)
- Rust engines: bidding, fraud, trust, image processing
- PostgreSQL 16 + PostGIS, Redis 7, Meilisearch
- Stripe Connect Express for escrow
- libsodium PII encryption, HashiCorp Vault, GDPR erasure pipeline
- 3,800+ unit tests, security audit complete, CSP nonce-locked

## Why Now

- **Whatnot** hit a $5B valuation on live-auction collectibles in 2024
- **StockX** proved live price discovery beats static listings for goods
- **Thumbtack/Angi** are stuck at 1-2% TAM penetration on services
- Every auction-format marketplace is growing. Every static-listing
  marketplace is shrinking or flat.
- AI tooling makes a 4-vertical platform shippable by a small team for
  the first time.

## The Ask

Pre-seed round. Use of funds: Austin pilot launch, two demand-side
hires, regulatory counsel for the goods escrow path in 50 states.

**Demo:** [live URL] · **Founder:** [contact] · **Repo:** github.com/NuclearEng/NoMarkup
