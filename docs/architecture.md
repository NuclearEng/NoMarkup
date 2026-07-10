# NoMarkup — Architecture & Project Structure

> Reference detail offloaded from `CLAUDE.md` to keep the always-loaded rules file lean.
> CLAUDE.md §1 and §3 point here. The **rules** still live in CLAUDE.md; this is the map.
>
> **Truth note (2026-07-09):** engine inventory, crypto, search/geo ownership, and mesh TLS
> match the repo as shipped. See `docs/planning/adversarial-action-tracker.md` DOC/ARC items.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                               │
│  Next.js 15 Web App  ·  iOS (future)  ·  Android (future)  │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTPS/WSS (edge TLS 1.3)     │
┌──────────────▼──────────────────────────────▼───────────────┐
│                    API GATEWAY (Go)                          │
│  Auth · Rate Limiting · Request Validation · Routing        │
│  Public catalog Cache-Control/ETag · Feature flags          │
│  Framework: net/http + Chi router                           │
└──────┬─────────┬──────────┬──────────┬─────────┬───────────┘
       │ gRPC*   │ gRPC*    │ gRPC*    │ gRPC*   │ gRPC*
       │         │          │          │         │
┌──────▼───┐ ┌───▼────┐ ┌──▼─────┐ ┌──▼────┐ ┌──▼──────────┐
│ User Svc │ │Job Svc │ │Bid Eng │ │Pay Svc│ │ Chat Svc    │
│   (Go)   │ │  (Go)  │ │ (Rust) │ │ (Go)  │ │(Go+WebSocket│
└──────────┘ └────────┘ └────────┘ └───────┘ └─────────────┘
       │          │          │          │           │
       │          │     (+ fraud/trust/imaging/     │
       │          │      underwriting/pricing Rust) │
       │          │                                 │
┌──────▼──────────▼──────────▼──────────▼───────────▼────────┐
│                     DATA LAYER                              │
│  PostgreSQL 16 + PostGIS  ·  Redis 7  ·  Meilisearch       │
│  S3-compatible object storage (MinIO dev / AWS S3 prod)    │
└────────────────────────────────────────────────────────────┘

* Mesh gRPC uses insecure credentials (plaintext) on the private network today.
  Target: mTLS. Public clients always hit HTTPS at the edge.
```

## Service Boundaries

| Service | Language | Responsibility | Why This Language / Notes |
|---------|----------|---------------|---------------------------|
| API Gateway | Go | HTTP routing, auth, rate limiting, validation, public JSON edge cache headers | Excellent stdlib net/http, high concurrency |
| User Service | Go | Registration, profiles, identity, roles, PII encrypt/decrypt | CRUD-heavy |
| Job Service | Go | Jobs, listings lifecycle, categories, Meilisearch indexing coordination | Business logic, orchestration |
| Bidding Engine | **Rust** | Services reverse-auction bid processing, timing, ranking hot path | Sub-ms latency under concurrency. **Goods listing bids** primarily go through gateway SQL (`FOR UPDATE`), not this engine. |
| Payment Service | Go | Stripe Connect, escrow, BNPL, advances, insurance claims | Stripe SDK + webhooks; dials **underwriting** for credit limits |
| Chat Service | Go | WebSocket connections, message persistence, presence | goroutine-per-connection |
| Notification Service | Go | In-app + channel fan-out (email/push/SMS when configured) | Async delivery |
| Fraud Detection | **Rust** | Velocity, geo-mismatch, fingerprint entropy, multi-account heuristics | Deterministic v1; ML/ONNX deferred |
| Trust Scoring | **Rust** | Composite score computation | High-throughput numerical |
| Imaging | **Rust** | Resize, optimize, format conversion via **`image` crate** | **Not libvips** in current builds |
| Underwriting | **Rust** | Working-capital **limit** decision (factor bands, holdback); pure function | Dialed from payment service, not gateway |
| Pricing | **Rust** | Fair-price / pricing numerics | Dialed from job service paths as wired |
| Search | **Meilisearch + Go** | Full-text search, autocomplete, similar | **No `engines/search` crate** |
| Geo | **PostGIS + Go** | Proximity, markets, service areas | **No `engines/geo` crate**; no custom PostGIS C extensions |
| Crypto | **Go** `nacl/secretbox` | Selected PII at rest (XSalsa20-Poly1305); argon2id passwords | Email plaintext by design for auth lookup |

## Project Structure

```
NoMarkup/
├── CLAUDE.md                          # Always-loaded rules (single source of truth)
├── PRD.md                             # Product requirements
├── docker-compose.yml                 # Local dev environment
├── .github/workflows/                 # CI/CD pipelines (deploy fail-closed until provisioned)
├── proto/                             # Protobuf definitions (shared, v1)
├── web/                               # Next.js frontend
│   ├── src/app/                       # App Router (RSC pilots on marketplace; many pages still client)
│   ├── src/components/ hooks/ lib/ stores/ types/
│   ├── public/                        # includes sw.js kill-switch (not production cache SW)
│   └── tests/{unit,integration,e2e}/
├── gateway/                           # Go API Gateway
│   ├── cmd/server/main.go
│   └── internal/{middleware,handler,router,config,crypto}/
├── services/                          # Go: user, job, payment, chat, notification
│   └── <svc>/cmd/server/ · internal/{domain,repository,service,grpc}/
├── engines/                           # Rust workspace members ONLY:
│   ├── bidding/ fraud/ trust/ imaging/ underwriting/ pricing/
│   └── Cargo.toml                     # members list is authoritative
├── database/                          # golang-migrate (001…073) + seed
├── ml/                                # Python training (NOT deployed)
├── tests/                             # integration (Go) + load (k6 — not CI)
└── deploy/
    ├── docker/ k8s/ monitoring/
    └── terraform/                     # skeleton until IaC is filled in
```

Per-service Go layout is uniform: `cmd/` for entry points, `internal/` for private code
(`domain`, `repository`, `service`, `grpc`). SQL migrations are centralized under
`database/migrations/` (not per-service `migrations/` dirs). Rust engines: `src/` with
`main.rs` + domain modules; criterion `benches/` exist locally, **not CI-gated**.

See also `docs/marketplace.md` (Goods architecture + trust model), `docs/route-map.md`,
and `docs/performance.md` (DATA-layer cache + RSC pattern).
