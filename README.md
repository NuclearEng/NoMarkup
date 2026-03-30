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

- **Live Auction Arena** — real-time WebSocket-driven bidding with order book, depth chart, and bid velocity indicators
- **Digit-Rolling Prices** — Robinhood-style animated price tickers with green/red flash on changes
- **5-Level Urgency Timer** — SVG progress ring with progressive pulse/glow/shake as auctions close
- **Savings Hero** — prominent "You're saving $X (Y%)" display with rolling digit animation
- **Competitive Bid Context** — rank badges (gold/silver/bronze), win probability bars, market position
- **Trust Scoring** — multi-dimensional provider trust with tier badges (Top Rated, Trusted, Rising, New)
- **Multi-Tier Celebrations** — canvas confetti from Nice (10%) to Legendary (40%+) savings
- **Brand Gold System** — gold gradient cards, shimmer effects, premium button variants
- **Market Ticker Strip** — infinite-scroll live marketplace activity on landing page
- **Animated Auction Demo** — self-playing reverse auction demonstration with staggered bids
- **Shimmer Skeletons** — premium loading states with 7 content-aware presets
- **Full Dark Mode** — consistent theming across 40+ components
- **Accessibility** — WCAG 2.2 AA, `prefers-reduced-motion` support on all 30+ animations

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

## License

Proprietary. All rights reserved.
