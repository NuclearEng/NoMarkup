# Marketplace Escrow Operations Guide

This document describes the post-award escrow lifecycle for the goods
marketplace (peer-to-peer physical-goods auctions). It is the runbook
oncall reaches for when a release goes wrong, a dispute hits the queue,
or the auto-release cron misbehaves.

For the services-side (jobs/contracts) escrow model, see the contract
service's `AutoReleaseCompletedContracts` flow — the patterns are similar
but the windows differ.

## State Machine

```
                          ┌──────────────────┐
                          │ pending_payment  │  ◄── created by marketplace svc when auction closes
                          └────────┬─────────┘
                                   │ ChargeListingWinner
                                   │   (creates Stripe PaymentIntent)
                                   ▼
                          ┌──────────────────┐
                          │ pending_payment  │  ◄── PI created, awaiting capture
                          └────────┬─────────┘
                                   │ webhook payment_intent.succeeded
                                   ▼
                          ┌──────────────────┐
                          │      held        │  ◄── funds in platform Stripe acct
                          └─┬──────┬──────┬──┘
        ConfirmPickup       │      │      │       FileListingDispute
        (buyer or admin)    │      │      │       (buyer only)
                            ▼      │      ▼
              ┌─────────────────┐  │  ┌──────────┐
              │ pickup_confirmed│  │  │ disputed │
              └────────┬────────┘  │  └────┬─────┘
                       │           │       │
       (transfer fires │           │       │ ResolveListingDispute (admin)
        async via      │           │       │   ├─ refund_full     ─► refunded
        worker)        │           │       │   ├─ refund_partial  ─► partially_refunded
                       ▼           │       │   ├─ release_to_seller ─► released
                  ┌──────────┐     │       │   └─ no_action       (stays disputed)
                  │ released │ ◄───┘       │
                  └──────────┘             │
                       ▲                   │
                       │ (after 14d, no    │
                       │  dispute, no      │
                       │  pickup confirm)  │
                       │                   │
              AutoReleaseListingOrders     │
                  cron (every 4h)          │
                                           ▼
                                    Admin queue
                                    (resolve via
                                     /admin/disputes)
```

## Cents-Precise Money Rules

For an order with `amount_cents=A`, `fee_cents=F`, `tax_cents=T`:

| Stage | Buyer charged | Seller paid | Platform retains |
|---|---|---|---|
| Charge | `A + F + T` | 0 | `F + T` (held) |
| Released (full) | `A + F + T` | `A − F` | `F + T` |
| Refund full | `0` net (refund `A+F+T`) | `0` | `0` |
| Refund partial (`R` to buyer) | `A + F + T − R` net | `(A − F) − max(0, R − T − F)` | unchanged |
| Release to seller (dispute) | `A + F + T` | `A − F` | `F + T` |

Tax is collected by the platform and remitted to states; it is not paid
out to the seller. Platform fee is permanent platform revenue (does not
flow to the seller).

## Auto-Release Semantics

The marketplace cron runs every 4 hours (`runMarketplaceAutoReleaseCron`
in `services/payment/cmd/server/marketplace_cron.go`). It selects orders
matching:

```sql
SELECT *
  FROM listing_orders
 WHERE escrow_status = 'held'
   AND dispute_id IS NULL
   AND created_at < now() - INTERVAL '14 days'
```

For each match it transitions to `released`, fires a Stripe transfer to
the seller (with idempotency key `listing-release:<order_id>`), and
sends notifications to both parties.

Why 14 days (vs 7 for services):
- Pickup logistics often span a weekend.
- Buyers commonly don't proactively confirm pickup unless the platform
  prompts them.
- Sellers want the cushion against last-minute disputes.

## Dispute Timeline

| Window | Allowed action | Status guard |
|---|---|---|
| `held` (any time before auto-release) | Buyer files dispute | `escrow_status='held' AND dispute_id IS NULL` |
| `pickup_confirmed` + 24h | Buyer files dispute | `pickup_confirmed_at >= now() - 24h` |
| `pickup_confirmed` + >24h | No dispute possible | dispute window closed |
| `released` (auto-release) | No dispute possible (post-payout) | requires admin reversal via Stripe |

Once a dispute is filed:
1. Order's `escrow_status` flips to `disputed`; `dispute_id` populated.
2. Auto-release cron skips the order (filtered by `dispute_id IS NULL`).
3. Seller is notified via `NotifyDisputeFiled`.
4. Admin queue picks it up at `/admin/disputes` (existing UI).

Resolution outcomes (via `ResolveListingDispute`):
- **`refund_full`**: full charged total (amount + fee + tax) refunded to
  buyer. Seller gets nothing. Order → `refunded`.
- **`refund_partial`**: admin specifies cents-to-buyer. Seller portion is
  computed as `(amount − fee) − max(0, refund − tax − fee)`. Two Stripe
  ops fire: one refund + one transfer. Order → `partially_refunded`.
- **`release_to_seller`**: no refund; seller transfer = `amount − fee`.
  Used when admin sides with seller (e.g. buyer no-show). Order →
  `released`.
- **`no_action`**: dispute marked resolved; order stays in `disputed`.
  Used when admin needs more info / a parallel investigation.

## Idempotency Contract

Every Stripe-mutating call uses a deterministic idempotency key:

| Operation | Key |
|---|---|
| Charge winner (PaymentIntent) | `listing-charge:<order_id>` |
| Release transfer | `listing-release:<order_id>` |
| Dispute refund | `listing-refund:<order_id>:<dispute_id>` |
| Dispute transfer | `listing-dispute-transfer:<order_id>:<dispute_id>` |

Stripe deduplicates on the key for 24 hours per their docs. Our retries
are safe within that window. Beyond 24h, the state machine itself
prevents double-spend (status guard rejects re-entry from a non-eligible
status).

## Webhook Wiring

Stripe `payment_intent.succeeded` events route through
`PaymentService.handlePaymentIntentSucceeded`. When the PI metadata
contains `marketplace_flow=goods-v1`, the event is delegated to
`MarketplaceService.HandleListingPaymentIntentSucceeded`, which
transitions the order from `pending_payment` to `held`.

If the marketplace handler is not configured (production
misconfiguration), the event is treated as a non-marketplace flow and
falls through to the standard payment path — which will look up the
payment row by PI id, not find one, and log a warning. This is a
fail-safe that lets ops detect the misconfig without rejecting webhook
events back to Stripe.

## 1099-K Reporting

Each successful seller transfer (auto-release, confirm-pickup, or
dispute resolution) accumulates into `seller_tax_forms` for the
seller's current tax year. The shape mirrors `tax_forms` (for
services-side 1099-NEC) but tracks `gross_payments_cents` and
`transaction_count` instead of `total_compensation_cents`. The annual
PDF generation flow is the same (extend `tax.go` to handle form_type =
'1099-K').

## Sales Tax (v1 Static Lookup)

State-level rates are hard-coded in `services/payment/internal/service/sales_tax.go`
from the [Tax Foundation 2024 dataset](https://taxfoundation.org/data/all/state/2024-sales-taxes/).
Update annually each January. Local/county taxes are NOT collected in
v1. See the file's package comment for the upgrade path to Avalara/TaxJar.

Zip-to-state mapping uses 3-digit USPS prefixes; coverage is ~99% of
standard US zips. Unknown zips compute `tax = 0` and are flagged in
logs.

## Operational Playbooks

### A buyer claims they never got pickup-confirm working but auto-release fired
1. Check the order's `pickup_confirmed_at` and `released_at` timestamps.
2. If `released_at` is set but `pickup_confirmed_at` is NULL, this is an
   auto-release. The 14-day window had elapsed. Refer the buyer to
   `/admin/disputes` for after-the-fact reversal — the admin can issue
   a manual refund via Stripe and recover from the seller via the
   `claw_back` flow (out of scope for this doc).
3. If both are set, the buyer DID confirm pickup at that time (or admin
   override fired). Pull the audit log.

### Cron stopped releasing orders
1. Check payment-service logs for `marketplace auto-release: cron tick failed`.
2. Verify DB connectivity (`SELECT 1 FROM listing_orders LIMIT 1`).
3. Manually trigger via gRPC:
   ```
   grpcurl -plaintext -d '{"batch_limit": 50}' \
     payment-service:50054 \
     nomarkup.payment.v1.PaymentService/AutoReleaseListingOrders
   ```
4. If a single bad order is poisoning the batch, query for it and mark
   it as `disputed` manually — the cron skips disputed orders.

### Stripe transfer fails on a release
1. Look for `release to seller transfer` in logs.
2. Check seller's Stripe Connect account status — if `payouts_enabled=false`
   the transfer fails. Re-onboard the seller and the cron will retry on
   the next tick (status stays at `held` until success).
3. The state machine guarantees no funds escape until transfer succeeds:
   the `escrow_status` only flips to `released` after `CreateMarketplaceTransfer`
   returns a transfer ID.

## Code Pointers

| What | Where |
|---|---|
| State machine + business logic | `services/payment/internal/service/listing_charge.go` |
| Stripe wrappers | `services/payment/internal/service/stripe.go` (`CreateMarketplace*`) |
| Postgres repository | `services/payment/internal/repository/marketplace.go` |
| Sales tax lookup | `services/payment/internal/service/sales_tax.go` |
| Auto-release cron | `services/payment/cmd/server/marketplace_cron.go` |
| Webhook delegation | `services/payment/internal/service/webhook.go` (`handlePaymentIntentSucceeded`) |
| Gateway endpoints | `gateway/internal/handler/listing_orders.go` |
| Schema | `database/migrations/034_goods_marketplace.up.sql` + `035_marketplace_escrow.up.sql` |
| Proto RPCs | `proto/payment/v1/payment.proto` (Marketplace section) |

## Tests

Run the full marketplace test suite:

```
cd services/payment
go test ./internal/service/ -run "Marketplace|StateTax|ComputeTax|StateFromZip|AutoRelease|ChargeListing|FullLifecycle" -v
```

Coverage:
- State transitions: `held -> released`, `held -> disputed`,
  `disputed -> partially_refunded`, `disputed -> refunded`,
  `disputed -> released`.
- Auto-release: only orders past 14d AND no open dispute released.
- Tax computation: known zip → known rate → known total (CA, TX, OR, NY).
- Idempotency: ChargeListingWinner returns existing PI on re-entry.
- Full lifecycle: charge → webhook → confirm → transfer → 1099-K accumulated.
