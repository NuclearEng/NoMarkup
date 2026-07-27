# NoMarkup Marketplace (Goods)

> Status: **MVP** — schema (migration 034+), **gateway SQL forward-auction
> path** for goods bids (`PlaceListingBid` / `FOR UPDATE` on `listings` — not
> the Rust bidding engine), public marketplace UI (`/marketplace`, `/sell`,
> `/orders`), payment escrow + pickup flow, admin moderation, and seed data.
> This document is the integration map.

## Product Summary

NoMarkup ships two marketplaces from the same auth + payment surface:

| Surface  | Direction      | What's listed | Closeout         |
|----------|----------------|---------------|------------------|
| Services | Reverse-auction | Customer posts a job, providers compete on price (descending) | Customer awards lowest bid |
| Goods    | Forward-auction | Seller posts a listing, buyers compete on price (ascending)   | Highest bid at close wins |

The goods surface is constrained to **local pickup, 25-mile radius**. No
shipping integration in v1 — the trust transfer hinges on physical
hand-off + escrow release at pickup confirmation. The radius cap is
enforced at the service layer (the `listings.location` PostGIS column is
matched against the buyer's profile radius via `ST_DWithin` in the
search path).

Auction durations are 24 / 48 / 168 hours (1 day, 2 days, 1 week). The
trigger function in migration 034 keeps `bid_count` and `current_bid_cents`
correct under contention (additive deltas + `GREATEST(...)` for the high
bid; same atomic-update pattern as services jobs from migration 030).

## Architecture — Where Goods Diverges From Services

The two flows reuse most of the platform. The listed deltas below are
the only places where goods has a separate code path.

```
                                     ┌──────────────────────┐
                                     │   Web (Next.js 15)    │
                                     ├──────────────────────┤
   /marketplace  /sell  /orders       │ Goods surface         │
   /jobs        /bids   /contracts    │ Services surface      │
                                     └──────────┬────────────┘
                                                │ HTTPS
                                     ┌──────────▼────────────┐
                                     │   API Gateway (Go)    │
                                     ├──────────────────────┤
   POST /api/v1/listings              │ pgx-direct (no gRPC)  │
   POST /api/v1/listings/{id}/bids   │ pgx-direct            │
   POST /api/v1/listings/{id}/report │ pgx-direct (public)   │
   GET  /api/v1/admin/listings       │ pgx-direct + admin    │
   GET  /api/v1/admin/disputes/goods │ pgx-direct + admin    │
                                     └──────────┬────────────┘
                                                │
                          ┌─────────────────────┼─────────────────────┐
                          ▼                                           ▼
                  ┌──────────────────────────┐               ┌─────────────────┐
                  │ PostgreSQL + PostGIS      │               │ Payment Service │
                  │ (goods bid primary path)  │               │  (Go + Stripe)  │
                  ├──────────────────────────┤               ├─────────────────┤
                  │ listings  (FOR UPDATE)    │               │ Holds escrow at │
                  │ listing_bids              │               │ pickup; releases│
                  │ listing_photos            │               │ on confirmation │
                  │ listing_orders            │               │ or refunds on   │
                  │ listing_reports           │               │ dispute.        │
                  └──────────────────────────┘               └─────────────────┘

  Note: The Rust bidding engine (`engines/bidding`) owns **services** reverse-
  auction bids only. Goods forward-auction place/retract/buy-it-now run in the
  gateway against Postgres (`listings_bid.go`). Do not document goods bids as
  engine-routed. See architecture.md “Dual bidding paths”.
```

### Schema (migration 034 + 035)

| Table | Purpose | Notes |
|-------|---------|-------|
| `listings` | Auction record, one per goods listing | `current_bid_cents` ascends; `auction_ends_at` is the close. `is_hidden` (036) auto-flips when ≥3 open reports exist. |
| `listing_bids` | Every bid placed (ascending) | Trigger maintains `listings.bid_count` and `listings.current_bid_cents` atomically. |
| `listing_photos` | Photos attached to a listing | `sort_order` determines hero photo. |
| `listing_orders` | Post-award escrow record | One per listing (UNIQUE constraint). `escrow_status ∈ {held, pickup_confirmed, released, disputed, refunded}`. |
| `listing_reports` (036) | Buyer/anyone-flagged policy violations | Reasons: `stolen`, `counterfeit`, `prohibited`, `misleading`, `spam`, `other`. |
| `disputes` (extended in 035) | Service AND goods disputes | `subject_kind` discriminator, `listing_order_id` soft-FK column, `contract_id` is now nullable, exclusive `disputes_subject_xor` CHECK. |

### Taxonomy

A new top-level "Goods" category lives in `service_categories` with the
flag `is_goods=true`. Subcategories (level=2): Furniture, Electronics,
Tools & Hardware, Sporting Goods, Vehicles & Parts, Home & Garden,
Books & Media, Clothing & Accessories, Collectibles, Other Goods.

The `/marketplace` UI filters categories by `is_goods=true`; the legacy
`/jobs` flow filters by `is_goods=false` so the two surfaces never see
each other's categories.

## Trust Transfer — Why Pickup-Only in V1

Forward auctions for physical goods inherit the trust problem from
auction sites that solved it with a combination of feedback scores +
seller-side hold periods + buyer-side dispute rates. Rather than rebuild
that infrastructure in v1, we lean on **physical proximity** to make
fraud expensive:

1. **Local pickup only.** A 25-mile cap means the buyer either drives
   there or the seller meets them. Either way both parties have a face
   to associate with the transaction.
2. **Escrow holds at pickup.** Stripe holds the buyer's funds until
   the buyer hits "confirm pickup" in the app (or the auto-release
   timer fires after 48h with no dispute). Sellers can't ship-and-
   ghost.
3. **Existing trust score reuse.** The trust score the user already
   has from the services side is the same score we display on listings.
   A high-trust customer makes a high-trust buyer. A new account with no
   services history still bids, but their bid carries a "new account"
   badge that sellers can use to weight their own decision.
4. **Auto-hide on 3+ reports.** The
   `trigger_listing_reports_auto_hide` function in migration 036 takes
   the listing offline the moment three open reports stack up. Admin
   reviews via `/admin/goods-reports`.

This is intentionally **not** an eBay/Mercari clone. We're betting on
local-only being a feature, not a limitation.

## Roadmap (v2+)

| Item | Why deferred from v1 |
|------|----------------------|
| Shipping integration (USPS/UPS) | Drops the local-only trust premise. Worth its own RFC. |
| "Buy it now" fixed-price listings | Forward auction is the differentiator; fixed-price is table stakes. Add when search + filtering is mature. |
| Watchlist + price alerts | Hooks into notification service; deferred until /marketplace search has been instrumented for query patterns. |
| Bulk listings (estate sales, lot of N) | Schema needs to grow `listing_groups`; out of scope for MVP. |
| Cross-marketplace badges | Provider verifications (insurance, license) showing on goods listings. Easy once `provider_profiles` is joined; punted to keep MVP scope. |
| ML-based price suggestion | Needs corpus of completed auctions first. Likely 3–6 months post-launch. |
| Mediated dispute resolution (DRP) | Today disputes are admin-resolved; v2 introduces an automated DRP wizard for the bottom 80% of cases. |

## Operational Hooks

- **Seed data.** `make seed` populates 13 listings (8 active + 3 with
  bids + 2 closing-soon + 1 sold + 1 disputed) using fixed UUIDs in the
  `00000000-0000-0000-0000-0000000010xx` block. Idempotent.
- **Admin surface.** `/admin/listings` (search/suspend/reactivate/cancel)
  + `/admin/goods-reports` (review queue) + `/admin/disputes` (now
  unioned across services + goods via `subject_kind`).
- **Public report API.** `POST /api/v1/listings/{id}/report` — anonymous
  visitors can flag listings; logged-in users get duplicate suppression.
  IP recorded for the fraud trail.
- **GDPR cascade.** Listings, bids, orders, and reports are part of the
  user-erasure cascade — see `docs/operations/gdpr-delete.md`.
- **Performance budgets.** Listing search p95 < 200ms (Meilisearch +
  PostGIS bbox), bid placement p99 < 1ms (Rust bid engine), pickup
  confirmation → escrow release < 500ms (Stripe `transfer.create`).
