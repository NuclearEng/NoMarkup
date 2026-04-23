# NoMarkup

Reverse-auction service marketplace. Customers post jobs, providers compete on price — the price goes **down**, not up.

Built as the **Robinhood of services** with prediction-market-inspired UI: live auction arenas, real-time order books, digit-rolling price tickers, and AAA-level motion design.

## Quick Start

```bash
# Install dependencies
cd web && npm install

# Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

```
web/           Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui
gateway/       Go API Gateway (Chi router, JWT auth, rate limiting)
services/      Go microservices (user, job, payment, chat)
engines/       Rust performance-critical services (bidding, fraud, trust, imaging)
proto/         Protobuf definitions (shared gRPC contracts)
ml/            Python ML training (fraud, pricing models)
deploy/        Docker, Kubernetes, Terraform
```

## Key Features

### Marketplace Core
- **Live Auction Arena** — real-time WebSocket-driven bidding with order book, depth chart, and bid velocity indicators
- **Digit-Rolling Prices** — Robinhood-style animated price tickers with green/red flash on changes
- **5-Level Urgency Timer** — SVG progress ring with progressive pulse/glow/shake as auctions close
- **Savings Hero** — prominent "You're saving $X (Y%)" display with rolling digit animation
- **Fair Price Index** — animated market-data page showing real median prices by category and ZIP, with percentile range bars and price heat map
- **Competitive Bid Context** — rank badges (gold/silver/bronze), win probability bars, market position
- **Instant Match** — "Find me someone fast" path alongside open auctions; provider offer queue with 15-minute countdown, accept/decline flow
- **Viewer Count** — live "👁 N providers viewing" badge per auction, Redis sorted-set backed, 30s polling
- **Savings Badge** — "Saves you $X vs. market avg" green pill on every auction with bid history context

### AI-Powered Job Posting
- **Vision Analysis** — tap "Analyze a Photo" to capture or upload a photo; `claude-haiku-4-5-20251001` extracts category, title, description, and budget range and auto-fills the form
- **Voice Input** — browser-native Web Speech API mic button on the title field; speak your problem, form fills itself
- **Progressive Enhancement** — form works without either feature; both are additive layers

### Provider Workspace
- **Daily Workspace** (`/provider/workspace`) — today's jobs + 7-day calendar, job cards with inline check-in/out and completion photos
- **GPS Check-In/Out** — geolocation-verified job start/end with duration calculation ("Worked 3h 20m")
- **Completion Photos** — before/after upload slots; "Mark Complete" requires at least one after-photo
- **Dispute Resolution** — 5-step evidence collection form (contract, reason, description, photos, review); "File a Dispute" on every contract detail page

### Provider Financial OS
- **Working Capital Advances** — credit utilization bars, fee preview, repayment progress tracking; auto-deduction from payouts
- **BNPL (Buy Now Pay Later)** — 3 or 6 installment plans for customers; provider paid immediately, platform collects installments
- **Instant Payout** — 1% fee, funds arrive within minutes; real-time fee preview before confirming
- **Tax Projection Card** — YTD earnings → estimated annual tax at 25% → quarterly payment breakdown
- **Credit Score Card** — letter grade (A–D) from risk score, utilization meter, link to advance history
- **Business Suite** — expense tracking, invoice generation, 1099-NEC tax center

### Local Intelligence
- **Seasonal Demand Banners** — rule-based alerts by category + month (HVAC in summer, landscaping in spring, etc.), dismissible
- **Permit Intelligence** — info banner on job detail pages for categories that typically require permits (electrical, plumbing, HVAC, roofing, etc.)
- **Fair Price Widget** — market low–high range bar on job cards, color-coded green/amber/red vs. current bids

### Per-Job Insurance
- **4 Insurance Products** — property damage (150 bps), workmanship warranty (200 bps), completion guarantee (100 bps), liability (250 bps)
- **Risk-Adjusted Pricing** — category multipliers (1.5x roofing/electrical, 0.8x cleaning) computed at quote time
- **Claims Lifecycle** — file, review, approve with payout or deny; admin claims queue

### Platform & Design
- **Trust Scoring** — multi-dimensional provider trust with tier badges (Top Rated, Trusted, Rising, New)
- **Multi-Tier Celebrations** — canvas confetti from Nice (10%) to Legendary (40%+) savings
- **Brand Gold System** — glass morphism throughout: `glass`, `glass-highlight`, `glass-elevated`, `glass-tinted-gold`, `glass-cta-gold`
- **Full Dark Mode** — cinematic `#070b14` dark theme across all 60+ pages
- **Best-in-Class Mobile** — fixed bottom tab bar (MD3 pattern), `viewport-fit=cover` for notched iPhones, `100dvh` dynamic viewport, 44px touch targets
- **Accessibility** — WCAG 2.2 AA: focus rings, `aria-live` regions, `prefers-reduced-motion` on all animations
- **Best-in-Class Onboarding** — role picker, email verification, 7-step provider wizard, Stripe Connect integration
- **Observability** — structured JSON slog, gRPC interceptors on all Go services, `tracing::info!` on all Rust engines, OpenTelemetry distributed tracing end-to-end

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, TypeScript 5, Tailwind CSS 4, shadcn/ui, Zustand, TanStack Query |
| Backend | Go 1.22+, Chi, pgx, gRPC |
| Engines | Rust (Tokio, tonic, sqlx) |
| Database | PostgreSQL 16 + PostGIS, Redis 7, Meilisearch |
| Infrastructure | Docker, Kubernetes, GitHub Actions |

## Development

```bash
npm run dev            # Start dev server (Turbopack)
npm run typecheck      # TypeScript type checking
npm run lint           # ESLint
npm run test           # Vitest unit tests
npm run test:e2e       # Playwright E2E tests
npm run build          # Production build
```

## Security & Configuration

Backend services fail closed on missing or invalid configuration. Copy `.env.example` to `.env.local` and set at minimum:

| Variable | Required | Purpose |
|---|---|---|
| `ENVIRONMENT` | ✅ always | One of `development` / `staging` / `production`. Services refuse to start if unset or invalid. |
| `STRIPE_WEBHOOK_SECRET` | ✅ payment service | Mandatory everywhere. Stripe webhook signature is verified on every request; there is no env-based bypass. |
| `JWT_ISSUER`, `JWT_AUDIENCE` | recommended | Checked on every access token. Default: `https://auth.nomarkup.com` / `nomarkup-api`. |
| `WS_ALLOWED_ORIGINS` | recommended | Comma-separated hostnames for WebSocket origin allowlist (CSWSH defense). Defaults to production hosts. |
| `TRUSTED_PROXIES` | recommended | Comma-separated CIDRs of reverse proxies whose `X-Forwarded-For` / `X-Real-IP` headers the gateway will honor. Defaults to loopback + RFC1918. |
| `APPLE_CLIENT_ID` | if Apple login | Audience claim checked on Apple ID tokens verified via Apple JWKS. |

Other security posture:
- RS256 JWT with explicit signing-method pinning + `iss` / `aud` enforcement
- argon2id password hashing (m=65536, t=3, p=4)
- All authenticated mutation endpoints scope writes by owner
- Idempotency keys required on `/payments` and `/subscriptions` writes
- Stripe event dedup table prevents replay on retry
- All service containers run as non-root
- Next.js edge middleware gates `(dashboard)` routes and protected `/api/*` paths

## License

Proprietary. All rights reserved.
