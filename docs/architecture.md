# NoMarkup — Architecture & Project Structure

> Reference detail offloaded from `CLAUDE.md` to keep the always-loaded rules file lean.
> CLAUDE.md §1 and §3 point here. The **rules** still live in CLAUDE.md; this is the map.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                               │
│  Next.js 15 Web App  ·  iOS (future)  ·  Android (future)  │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTPS/WSS                    │
┌──────────────▼──────────────────────────────▼───────────────┐
│                    API GATEWAY (Go)                          │
│  Auth · Rate Limiting · Request Validation · Routing        │
│  Framework: net/http + Chi router                           │
└──────┬─────────┬──────────┬──────────┬─────────┬───────────┘
       │ gRPC    │ gRPC     │ gRPC     │ gRPC    │ gRPC
┌──────▼───┐ ┌───▼────┐ ┌──▼─────┐ ┌──▼────┐ ┌──▼──────────┐
│ User Svc │ │Job Svc │ │Bid Eng │ │Pay Svc│ │ Chat Svc    │
│   (Go)   │ │  (Go)  │ │ (Rust) │ │ (Go)  │ │(Go+WebSocket│
└──────────┘ └────────┘ └────────┘ └───────┘ └─────────────┘
       │          │          │          │           │
┌──────▼──────────▼──────────▼──────────▼───────────▼────────┐
│                     DATA LAYER                              │
│  PostgreSQL 16 + PostGIS  ·  Redis 7  ·  Meilisearch       │
└─────────────────────────────────────────────────────────────┘
       │
┌──────▼─────────────────────────────────────────────────────┐
│              PERFORMANCE-CRITICAL SERVICES (Rust)           │
│  Bidding Engine · Fraud Detection · Trust Scoring           │
│  Search Ranking · Image Pipeline · Geo Computation          │
└─────────────────────────────────────────────────────────────┘
       │
┌──────▼─────────────────────────────────────────────────────┐
│              NATIVE EXTENSIONS (C/C++)                       │
│  libvips (image processing) · Custom PostGIS functions      │
│  argon2 (password hashing) · libsodium (encryption)         │
└─────────────────────────────────────────────────────────────┘
```

## Service Boundaries

| Service | Language | Responsibility | Why This Language |
|---------|----------|---------------|-------------------|
| API Gateway | Go | HTTP routing, auth, rate limiting, request validation | Excellent stdlib net/http, low latency, high concurrency |
| User Service | Go | Registration, profiles, identity verification, roles | CRUD-heavy, benefits from Go simplicity |
| Job Service | Go | Job posting, lifecycle, categories, search coordination | Business logic, orchestration |
| Bidding Engine | **Rust** | Real-time bid processing, auction timing, sealed-bid logic | Sub-millisecond latency, zero-cost abstractions, memory safety under concurrent load |
| Payment Service | Go | Stripe Connect integration, escrow, disbursement, refunds | Stripe SDK availability, webhook handling |
| Chat Service | Go | WebSocket connections, message persistence, presence | goroutine-per-connection scales to millions |
| Fraud Detection | **Rust** | Browser fingerprinting analysis, behavioral scoring, ring detection | Heuristic v1 (velocity, geo-mismatch, fingerprint entropy, multi-account); ML inference deferred — see PLAN §6.1 |
| Trust Scoring | **Rust** | Composite score computation, real-time recalculation | High-throughput numerical computation |
| Underwriting | **Rust** | Working-capital credit-limit sizing + risk-banded advance pricing (deterministic scorecard) | Pure numerical, sub-ms, must be reproducible/auditable + tamper-evident |
| Pricing (Fair Price Index) | **Rust** | Robust cleared-price estimation with hierarchical shrinkage + confidence | Pure numerical, sub-ms, robust stats over settled-transaction corpus |
| Search & Ranking | **Rust** (Meilisearch) | Full-text search, geo-filtered results, relevance ranking | Meilisearch is Rust-native, sub-50ms queries |
| Image Pipeline | **Rust** + **C** (libvips) | Resize, optimize, watermark, format conversion | libvips via FFI, 8x faster than ImageMagick |
| Geo Computation | **Rust** + **C** (PostGIS) | Service area calculation, proximity matching, route estimation | PostGIS C extensions + Rust geo crate for app-layer |
| Crypto Operations | **C** (libsodium) | Encryption at rest, token signing, key derivation | libsodium via Go/Rust FFI, audited C implementation |

## Project Structure

```
NoMarkup/
├── CLAUDE.md                          # Always-loaded rules (single source of truth)
├── PRD.md                             # Product requirements
├── docker-compose.yml                 # Local dev environment
├── .github/workflows/                 # CI/CD pipelines
├── proto/                             # Protobuf definitions (shared)
│   ├── user/v1/user.proto · job/v1/job.proto · bid/v1/bid.proto
│   ├── payment/v1/payment.proto · chat/v1/chat.proto
├── web/                               # Next.js frontend
│   ├── src/
│   │   ├── app/                       # App Router pages
│   │   │   ├── (auth)/ (dashboard)/ (public)/ api/
│   │   │   ├── layout.tsx · global-error.tsx
│   │   │   ├── components/            # ui/ forms/ layout/ jobs/ bids/ chat/
│   │   │   │                          #   maps/ payments/ providers/
│   │   │   ├── hooks/                 # Custom React hooks
│   │   │   ├── lib/                   # api.ts auth.ts constants.ts utils.ts validations.ts
│   │   │   ├── stores/ styles/ types/
│   │   ├── public/ tests/{unit,integration,e2e}/
│   │   ├── next.config.ts tailwind.config.ts tsconfig.json vitest.config.ts package.json
├── gateway/                           # Go API Gateway
│   ├── cmd/server/main.go
│   ├── internal/{middleware,handler,router,config}/
├── services/                          # Go microservices (user, job, payment, chat)
│   └── <svc>/cmd/server/main.go · internal/{domain,repository,service,grpc}/ · migrations/
│       (chat also has internal/ws/ for the WebSocket handler)
├── engines/                           # Rust performance-critical services
│   ├── bidding/    src/{main,engine,grpc,models}.rs · tests/ benches/
│   ├── fraud/      src/{main,engine,behavioral,models,grpc}.rs  # heuristic v1; ONNX deferred
│   ├── trust/      src/{main,scorer,dimensions,grpc}.rs
│   ├── imaging/    src/{main,pipeline,optimize,grpc}.rs
│   ├── underwriting/ src/{main,model,grpc}.rs  # pure-fn working-capital underwriting (no DB)
│   └── pricing/    src/{main,model,grpc}.rs    # pure-fn Fair Price Index (no DB)
├── ml/                                # Python ML training (NOT deployed as a service)
│   └── fraud/ pricing/ requirements.txt
└── deploy/
    ├── docker/ k8s/ terraform/
```

Per-service Go layout is uniform: `cmd/` for entry points, `internal/` for private code
(`domain` types/interfaces, `repository` Postgres queries, `service` business logic, `grpc`
server impl), `migrations/`. Rust engines: `src/` with `main.rs` + domain modules, `tests/`,
`benches/` (criterion).

## Production domain & edge strategy

- **Domain: `no-markup.com`** (hyphenated). The non-hyphen `nomarkup.com` is **NOT** owned — never
  assume it. One Cloudflare account is registrar + DNS + CDN/edge for the zone.
- Because a single account holds DNS, edge, and registrar, the edge-caching strategy targets the
  public **DATA** layer (the gateway's `writeCachedJSON` catalog reads), **not** the HTML — the app
  HTML can't be edge-cached (a per-request CSP nonce forces dynamic rendering; see `docs/performance.md`
  and CLAUDE.md §14). Authed/user-specific reads stay uncached.
- Cloudflare Account ID / Zone ID live in Vault (`.env.local` for dev) — not committed.

See also `docs/marketplace.md` (Goods architecture + trust model) and `docs/route-map.md`.
