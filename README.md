# NoMarkup

A two-sided local marketplace built on one shared auth + payment + trust stack:

- **Services** (`/jobs`, `/bids`, `/contracts`) — **reverse auction.** Customers post jobs, providers compete on price (the price goes **down**). The original product surface.
- **Goods** (`/marketplace`, `/sell`, `/orders`) — **forward auction.** Sellers list physical items, buyers bid (the price goes **up**), with local pickup inside 25 miles, escrowed orders, and Buy-It-Now.

Built as the **Robinhood of local commerce** with prediction-market-inspired UI: live auction arenas, real-time order books, digit-rolling price tickers, and AAA-level motion design. The name is the promise — the buyer/customer pays no markup; the platform's take comes out of the seller payout.

## Quick Start

```bash
# Full stack (gateway + Go services + Rust engines + web + Postgres/Redis/Meili)
./bin/dev up                 # start everything
./bin/dev up web gateway     # or start specific services

# Web only
cd web && npm install && npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The gateway listens on `:8081`, the web app on `:3000`. Copy `.env.example` to `.env.local` first (see **Security & Configuration**).

## Architecture

```
web/           Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui
gateway/       Go API gateway (Chi, JWT auth, rate limiting, validation, edge-cache)
services/      Go microservices (user, job/contract, payment, chat)
engines/       Rust performance-critical services (bidding, fraud, trust, search, imaging, geo)
proto/         Protobuf definitions (shared gRPC contracts, v1)
database/      golang-migrate migrations + seed
ml/            Python ML training (fraud, pricing — not deployed)
deploy/        Docker, Kubernetes, Terraform
```

Clients → Go API gateway (auth, rate limit, validation, routing) → gRPC service mesh. Go owns CRUD, orchestration, Stripe, and WebSocket fan-out; Rust is reserved for sub-millisecond / high-throughput paths (bidding, fraud heuristics, trust scoring, search, image pipeline, geo). Data layer: PostgreSQL 16 + PostGIS, Redis 7, Meilisearch. The public catalog/data layer is edge-cached (the app HTML can't be — a per-request CSP nonce forces dynamic rendering); authed reads stay uncached.

## Key Features

### Services Marketplace (reverse auction)
- **Live Auction Arena** — real-time WebSocket bidding with order book, depth chart, bid-velocity indicators
- **Digit-Rolling Prices** — Robinhood-style animated tickers with green/red flash on change
- **5-Level Urgency Timer** — SVG progress ring with progressive pulse/glow/shake as auctions close; anti-snipe extension on last-second bids
- **Savings Hero & Fair Price Index** — "You're saving $X (Y%)" plus a market-data page of median prices by category/ZIP with percentile bars and a price heat map
- **Instant Match** — "find me someone fast" path with a provider offer queue + 15-minute countdown
- **Competitive Context** — rank badges, win-probability bars, live "👁 N providers viewing"

### Goods Marketplace (forward auction)
- **Ascending auctions** — buyers bid up; min-increment enforced; proxy/auto-bid cascade; anti-snipe time extension; deterministic winner at close
- **Concurrency-safe bidding** — every bid serialized under a `FOR UPDATE` row lock; verified no lost/duplicate/wrong-winner under concurrent load; optional `Idempotency-Key` dedup
- **Bid bonds** — refundable good-faith deposits gate bidding on flagged listings (validated before charge)
- **Offers & counter-offers** — make/accept/reject/counter with chain-aware authorization
- **Buy-It-Now** — instant purchase that closes the auction and opens an escrow order
- **Orders & escrow** — buyer/seller order lifecycle (seller-confirm, pickup-confirm, auto-release), readable via `/orders/{id}` and `/me/orders`
- **Local pickup** — 25-mile radius, Mapbox pickup maps, PostGIS-backed geo
- **Watchlist, Follows & Feed** — watch listings, follow sellers, personalized feed
- **City selector** — best-in-class market picker: use-my-location (→ nearest launched market by haversine), recent picks, nearby markets, and type-to-search; only launched cities surface ("more cities coming soon")

### AI-Powered Job Posting
- **Vision Analysis** — upload a photo; `claude-haiku-4-5-20251001` extracts category, title, description, budget and auto-fills the form
- **Voice Input** — Web Speech API mic on the title field
- **Progressive Enhancement** — both are additive; the form works without them

### Provider Workspace & Financial OS
- **Daily Workspace** — today's jobs + 7-day calendar, GPS check-in/out with duration, before/after completion photos
- **Working Capital Advances** — risk-based APR (3–15% by credit grade) + a flat 3% origination fee, shown as a transparent line-item breakdown; auto-deducted from payouts
- **BNPL** — 3/6-installment plans; provider paid immediately, platform collects installments
- **Instant Payout** — 1% fee, real-time preview
- **Business Suite** — expense tracking, invoice generation, and an institution-grade 1099-NEC tax center with a printable summary
- **Dispute Resolution** — evidence-collected disputes backed by the contract service, party-access enforced, admin queue + resolution

### Per-Job Insurance
- **4 products** — property damage (150 bps), workmanship warranty (200 bps), completion guarantee (100 bps), liability (250 bps), risk-adjusted by category, with a full claims lifecycle

### Platform & Design
- **Geographic rollout control** — markets launch by city / state / country via an admin Markets tool (flips `markets.is_active`); the public catalog is active-gated so coverage expands market-by-market for liquidity density. Washington is the first live market. Catalog (~432 US + MX cities) crawled from craigslist + geocoded; see `docs/operations/provisioning-checklist.md`
- **Trust Scoring** — multi-dimensional provider trust with tier badges
- **Brand Gold + Full Dark Mode** — glass-morphism design system, cinematic `#070b14` theme across 60+ pages
- **Best-in-Class Mobile** — fixed bottom tab bar, `100dvh`, notch-safe, 44px targets, works at 320px
- **Accessibility** — WCAG 2.2 AA: focus rings, `aria-live`, `prefers-reduced-motion`
- **Observability** — structured JSON slog, gRPC interceptors, Rust `tracing`, OpenTelemetry end-to-end

## Fees

NoMarkup's take comes out of the **seller/provider payout** — the buyer/customer pays exactly the agreed price, no markup.

| Fee | Rate | Notes |
|---|---|---|
| Platform commission | **8%** | Seller-side; below eBay (~13%) / Etsy (~11%), far below TaskRabbit/Thumbtack (15–30%) |
| Guarantee (buyer protection) | **2%** | Seller-side; funds the completion/escrow guarantee |
| Lead-gen referral | **10%** | Opt-in, off by default; charged only for qualified leads when enabled |
| Working-capital advance | **3% origination + 3–15% APR** | APR is risk-based by business credit grade |
| Instant payout | **1%** | Optional fast payout |

All fee rates are admin-configurable (with seeded defaults) and shown transparently to the user.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, TypeScript 5 (strict), Tailwind CSS 4, shadcn/ui, Zustand, TanStack Query |
| Backend | Go 1.22+, Chi, pgx (no ORM), gRPC + protobuf |
| Engines | Rust (Tokio, tonic, sqlx) — bidding, fraud, trust, search, imaging, geo |
| Database | PostgreSQL 16 + PostGIS, Redis 7, Meilisearch |
| Payments | Stripe (Connect Express escrow, PaymentIntents, Idempotency-Key) |
| Infrastructure | Docker, Kubernetes, GitHub Actions, Cloudflare (DNS/CDN/edge for `no-markup.com`) |

## Development

```bash
npm run dev            # web dev server (Turbopack)
npm run typecheck      # TypeScript
npm run lint           # ESLint
npm run test           # Vitest unit tests
npm run test:e2e       # Playwright E2E
npm run build          # production build

go test ./...          # Go services/gateway (from each module)
cargo test             # Rust engines (from engines/)
```

## Security & Configuration

Backend services fail closed on missing or invalid configuration. Copy `.env.example` to `.env.local` and set at minimum:

| Variable | Required | Purpose |
|---|---|---|
| `ENVIRONMENT` | ✅ always | `development` / `staging` / `production`. Services refuse to start if unset/invalid. |
| `STRIPE_WEBHOOK_SECRET` | ✅ payment service | Webhook signature verified on every request; no bypass. |
| `JWT_ISSUER`, `JWT_AUDIENCE` | recommended | Checked on every access token. Default `https://auth.nomarkup.com` / `nomarkup-api`. |
| `WS_ALLOWED_ORIGINS` | recommended | WebSocket origin allowlist (CSWSH defense). Defaults to production hosts. |
| `INTERNAL_WS_SECRET` | prod | Shared secret the chat/auction WS backend requires from the gateway dial, so it stops trusting gateway-supplied `user_id`. Set on both gateway and chat. |
| `TRUSTED_PROXIES` | recommended | CIDRs whose `X-Forwarded-For` / `X-Real-IP` the gateway honors. Defaults to loopback + RFC1918. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | maps | Mapbox token for pickup/service maps. Use a **`pk.` (public, URL-restricted)** token — `NEXT_PUBLIC_*` is exposed client-side. |
| `APPLE_CLIENT_ID` | if Apple login | Audience claim on Apple ID tokens verified via Apple JWKS. |

Other security posture:
- RS256 JWT with explicit signing-method pinning + `iss`/`aud` enforcement; argon2id password hashing (m=65536, t=3, p=4)
- Every endpoint authenticated **and** authorized; all mutations scope writes by owner/party; PII projected out of public reads
- WebSocket subscribes (chat & auction) enforce channel-membership / job-participant access — no IDOR
- Parameterized SQL only; idempotency keys on `/payments` and `/subscriptions`; Stripe event dedup prevents replay
- All containers run as non-root; Next.js edge middleware gates `(dashboard)` and protected `/api/*` routes; strict CSP via per-request nonce

## License

Proprietary. All rights reserved.
