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
services/      Go microservices (user, job/contract, payment, chat, notification)
engines/       Rust (bidding, fraud, trust, imaging, underwriting, pricing)
proto/         Protobuf definitions (shared gRPC contracts, v1)
database/      golang-migrate migrations + seed (through 073)
ml/            Python ML training (fraud, pricing — not deployed)
deploy/        Docker, Kubernetes manifests; terraform/ is a skeleton (not provisioned)
```

Clients → Go API gateway (auth, rate limit, validation, routing) → gRPC service mesh over a **private network (plaintext gRPC today; mTLS is the target)**. Go owns CRUD, orchestration, Stripe, WebSocket fan-out, Meilisearch coordination, and PostGIS geo queries. Rust is reserved for sub-millisecond / high-throughput / numerical paths (bidding, fraud heuristics, trust scoring, imaging via the `image` crate, working-capital underwriting, fair-price/pricing). **Search** is Meilisearch + Go indexers; **geo** is PostGIS + Go. Data layer: PostgreSQL 16 + PostGIS, Redis 7, Meilisearch. The public **DATA** layer is CDN-cacheable (`writeCachedJSON`); app HTML cannot be edge-cached while the per-request CSP script nonce stands.

## Key Features

### Services Marketplace (reverse auction)
- **Live Auction Arena** — real-time WebSocket bidding with order book, depth chart, bid-velocity indicators
- **Digit-Rolling Prices** — Robinhood-style animated tickers with green/red flash on change
- **5-Level Urgency Timer** — SVG progress ring with progressive pulse/glow/shake as auctions close; anti-snipe extension on last-second bids
- **Savings Hero & Fair Price Index** — "You're saving $X (Y%)" plus a market-data page of median prices by category/ZIP with percentile bars and a price heat map
- **Instant Match** — "find me someone fast" path with a provider offer queue + 15-minute countdown
- **Competitive Context** — rank badges, rank-based win-probability bars (UI heuristic from bid rank, not a trained model), live "👁 N providers viewing"

### Goods Marketplace (forward auction)
- **Ascending auctions** — buyers bid up; min-increment enforced; proxy/auto-bid cascade; anti-snipe time extension; deterministic winner at close
- **Concurrency-safe bidding** — every bid serialized under a `FOR UPDATE` row lock; verified no lost/duplicate/wrong-winner under concurrent load; optional `Idempotency-Key` dedup
- **Bid bonds** — refundable good-faith deposits gate bidding on flagged listings (validated before charge)
- **Offers & counter-offers** — make/accept/reject/counter with chain-aware authorization
- **Buy-It-Now** — instant purchase that closes the auction and opens an escrow order
- **Orders & escrow** — buyer/seller order lifecycle (seller-confirm, pickup-confirm, auto-release), readable via `/orders/{id}` and `/me/orders`
- **Local pickup** — 25-mile radius, Mapbox pickup maps, PostGIS-backed geo
- **Watchlist, Follows, Saved Searches & Feed** — watch listings (live heart state), follow sellers (hydrated follow state + follower counts), save searches, personalized feed
- **Wishlist & price alerts** — save what you're hunting for (keyword + a max price + optional category); when a matching listing goes live at or under your ceiling, you get a "bid now" notification linking straight to it
- **Reviews** — **services (contracts)** use double-blind publish (neither side's review surfaces until both submit, or the window closes). Dimensions are overall + role-specific ratings (quality/timeliness/communication/value or payment/scope/access) — **not** an 8-dimension goods-order review product. Goods order reviews are not a separate double-blind surface yet.
- **City selector** — market picker: use-my-location (→ nearest launched market by haversine), recent picks, nearby markets, and type-to-search; only launched cities surface ("more cities coming soon")

### AI-Powered Job Posting
- **Vision Analysis** — upload a photo; `claude-haiku-4-5-20251001` extracts category, title, description, budget and auto-fills the form
- **Voice Input** — Web Speech API mic on the title field
- **Progressive Enhancement** — both are additive; the form works without them

### Provider Workspace & Financial OS
- **Daily Workspace** — today's jobs + 7-day calendar, GPS check-in/out with duration (client-supplied lat/lng stored; **no server geo-fence** against the job site yet), before/after completion photos
- **Working Capital Advances** — **two layers, intentionally separate:**
  - **Limit (underwriting):** deterministic Rust engine (`engines/underwriting`, gRPC) sizes available credit from escrow-settled signals (windowed released earnings, repayment, dispute rate, trust). Pure function, factor bands **1.06–1.18** for the limit decision, hard-capped at `min(35% of trailing-year, $25k)`, fails closed when the engine is unwired, proptest-guarded.
  - **Booking fee:** when an advance is requested, fee = **3% origination + risk-based APR interest** (credit grade), disclosed as line items — not the underwriting factor rate billed as the customer fee.
- **BNPL** — 3/6-installment plans; provider paid immediately, platform collects installments (gated by `customer_bnpl`)
- **Instant Payout** — ledger-backed + idempotent, with eligibility (cleared funds only), verified-provider gate, and per-txn/daily caps; configurable fee (default 1.5%, $1 min). Gated by `instant_payout`.
- **Repayment** — providers pay down advances directly (ownership-scoped, idempotent) in addition to auto-offset from payouts
- **Business Suite** — expense tracking, invoice generation, and a 1099-NEC tax center (decrypted PII where encrypted) with a printable summary
- **Change Orders** — on an active contract the provider proposes a scope/price adjustment; the customer approves or rejects; on approval the contract amount + milestone reconcile atomically
- **Dispute Resolution** — evidence-collected disputes backed by the contract service, party-access enforced, admin queue + resolution; completion-guarantee + insurance-claim payouts are capped at coverage server-side

### Insurance
- **Per-job products** — property damage, workmanship warranty, completion guarantee, liability — risk-adjusted by category, with a claims lifecycle (`per_job_insurance`, seeded **on**)
- **Competitive marketplace (preview)** — multi-carrier quote fan-out + bind flow exists in code but is **seeded flag-off** (`insurance_competition=false`). Not a live product surface until an admin enables the flag.

### Professional Services (Legal)
- **Lawyers compete (preview)** — legal-services categories, bar-license capture, Verified Bar Member badge, and `/legal` landing exist but are **seeded flag-off** (`legal_services=false`).

### Platform & Design
- **Feature flags** — admin-togglable from `/admin/flags` (BNPL, instant payout, insurance, advances, lead-gen, insurance-competition, legal, etc.). **Production (`ENVIRONMENT=production`):** `RequireFlag` **fail-closed** — missing flag rows, DB errors, or nil DB → 503 (SEC-01). **Development/staging:** missing flag / DB error fail-open so un-seeded stacks work; explicit `enabled=false` still 503. UI money keys fail-closed when the flag map omits them.
- **Geographic rollout control** — markets launch by city / state / country via an admin Markets tool (flips `markets.is_active`); the public catalog is active-gated. King County, WA is the launch market. Catalog (~432 US + MX cities) geocoded; see `docs/operations/provisioning-checklist.md`
- **Trust Scoring** — multi-dimensional provider trust with tier badges (Rust trust engine)
- **Notifications** — in-app notifications for the events that matter (new message, new bid, bid awarded, offer received/countered, dispute filed/resolved, payout, wishlist match), with deep links; per-type and per-channel preferences; external senders fail soft when unconfigured
- **Privacy & Safety** — GDPR/CCPA self-service: data export (owner-scoped) and account deletion (30-day grace, then PII anonymized while FKs are preserved). Report a user or message → admin moderation queue; block enforced at the messaging boundary
- **Brand Gold + Full Dark Mode** — glass-morphism design system, dark theme across the app surface
- **Mobile web** — fixed bottom tab bar, `100dvh`, notch-safe, 44px targets, works at 320px (PWA install UI exists; **service worker is currently a kill-switch / unregisters**, not a production cache SW)
- **Accessibility** — **goal WCAG 2.2 AA** (focus rings, `aria-live`, `prefers-reduced-motion`, jsx-a11y). Not fully axe-gated on real routes in CI
- **Observability** — structured JSON slog, gRPC interceptors, Rust `tracing`, OpenTelemetry instrumentation (production collectors/backends still need provisioning — see launch checklist)

## Fees

NoMarkup's take comes out of the **seller/provider payout** — the buyer/customer pays exactly the agreed price, no markup.

| Fee | Rate | Notes |
|---|---|---|
| Platform commission | **8%** | Seller-side; below eBay (~13%) / Etsy (~11%), far below TaskRabbit/Thumbtack (15–30%) |
| Guarantee (buyer protection) | **2%** | Seller-side; funds the completion/escrow guarantee |
| Lead-gen referral | **10%** | Opt-in, off by default; charged only for qualified leads when enabled |
| Working-capital advance | **3% origination + risk-based APR** | Booking path fee. Underwriting factor 1.06–1.18 is for **limit sizing**, not the line item charged on request |
| Instant payout | **1.5% ($1 min)** | Optional fast payout; configurable, priced to clear Stripe's instant-payout cost |

All fee rates are admin-configurable (with seeded defaults) and shown transparently to the user.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, TypeScript 5 (strict), Tailwind CSS 4, shadcn/ui, Zustand, TanStack Query |
| Backend | Go 1.22+, Chi, pgx (no ORM), gRPC + protobuf |
| Engines | Rust (Tokio, tonic, sqlx) — bidding, fraud, trust, imaging, underwriting, pricing |
| Search / Geo | Meilisearch + Go indexers · PostGIS + Go (not separate Rust engines) |
| Database | PostgreSQL 16 + PostGIS, Redis 7, Meilisearch |
| Payments | Stripe (Connect Express escrow, PaymentIntents, Idempotency-Key) |
| Infrastructure | Docker, K8s manifests, GitHub Actions; Cloudflare zone **`no-markup.com`** (not provisioned for full prod until `DEPLOY_PROVISIONED`) |

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
- RS256 JWT with method pinning + `iss`/`aud` enforcement; argon2id password hashing (m=65536, t=3, p=4)
- **Sessions:** 15-min access tokens; **single-use refresh tokens** (atomic rotation); **role-based idle timeouts** (customer 60m / provider 120m / admin 30m, sliding); password-reset tokens are single-use (hash-bound)
- Endpoint authz + ownership scoping on sensitive reads/writes; PII projected out of public reads (license numbers masked)
- **PII at rest:** selected fields (phone, MFA secret, service address, EIN/TIN, insurance policy number, etc.) use **XSalsa20-Poly1305** via `nacl/secretbox` (libsodium-compatible). **Email stays plaintext** for auth lookup. Not whole-database AES-256-GCM.
- **TLS:** **edge/public HTTPS TLS 1.3** (ingress/Cloudflare). **Service mesh gRPC is currently plaintext** inside the private network; mTLS is the target, not shipped.
- **CSP:** per-request **script** nonce (`strict-dynamic`); **`style-src` includes `'unsafe-inline'`** (Next/tooling injects styles). Not a fully nonce-only CSP.
- WebSocket: channel/job-participant authz on subscribe, origin allowlist, spectator anonymization + delay, socket lifetime bounded to token `exp`
- Money paths use locks / WHERE-guards / idempotency keys on many Stripe operations (see adversarial tracker for remaining gaps before live money)
- Tiered per-IP rate limiting, request-body caps, parameterized SQL only
- **Resilient engines:** Rust engines run behind `CatchPanicLayer`; numerical paths are proptest-guarded
- Feature flags: **production fail-closed** (missing/error → 503); non-prod fail-open for missing only; explicit `enabled=false` always 503
- Next.js edge middleware soft-gates dashboard routes (session indicators); gateway JWT remains authoritative
- **Deploy:** not production-ready until `DEPLOY_PROVISIONED=true`, secrets, cluster, and migrations (through **073**) are real — see `docs/operations/provisioning-checklist.md` and `docs/launch-checklist.md`

## License

Proprietary. All rights reserved.
