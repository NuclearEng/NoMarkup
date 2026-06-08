# NoMarkup — Development Rules

> Two-sided marketplace platform built on the same auth + payment stack:
>
> - **Services** (`/jobs`, `/bids`, `/contracts`) — reverse-auction. Customers post
>   jobs, providers compete on price (descending). The original product surface.
> - **Goods** (`/marketplace`, `/sell`, `/orders`) — forward-auction. Sellers list
>   physical items, buyers bid (ascending), local pickup only inside 25mi. MVP shipping
>   in this branch. See `docs/marketplace.md` for the architecture map and trust model.
>
> This file is the single source of truth for all architecture, conventions, and quality
> standards. **Reference detail lives in `docs/` and is linked per-section — read those files
> on demand.** This file holds the rules; the linked docs hold the worked examples and maps.

---

## 1. Architecture Overview

Clients (Next.js 15 web) → **Go API Gateway** (auth, rate limit, validation, routing) → gRPC to
service mesh: **User / Job / Payment / Chat** (Go), **Bidding / Fraud / Trust / Search / Imaging /
Geo** (Rust, performance-critical). Data layer: **PostgreSQL 16 + PostGIS · Redis 7 ·
Meilisearch**. Native extensions (C): libvips, libsodium, argon2, custom PostGIS.

Rust is reserved for sub-ms / high-throughput / numerical paths (bidding, fraud heuristics v1,
trust scoring, image pipeline). Go owns CRUD, orchestration, Stripe, and WebSocket fan-out.

→ **Full system diagram + per-service language rationale: `docs/architecture.md`.**

---

## 2. Tech Stack — Locked Decisions

### Frontend (Web)
- **Framework**: Next.js 15 (App Router) + TypeScript 5.x strict mode
- **Styling**: Tailwind CSS 4.x — no CSS modules, no styled-components, no inline styles
- **Components**: shadcn/ui as base — customize, never fork
- **State**: Zustand (client) + TanStack Query (server)
- **Forms**: React Hook Form + Zod
- **Maps**: Mapbox GL JS · **Real-time**: native WebSocket (no Socket.io)
- **Testing**: Vitest + React Testing Library + Playwright (E2E) · **Bundle**: Turbopack

### Backend (Go Services)
- **Go 1.22+** · Router: Chi · DB: pgx (no ORM) · Migrations: golang-migrate
- Cache: go-redis · gRPC: google.golang.org/grpc + protobuf · Auth: custom JWT (RS256) + secure cookies
- Validation: go-playground/validator · Logging: slog · Testing: stdlib + testify · Payments: stripe-go

### Backend (Rust Services)
- **Rust latest stable, 2024 edition** · Runtime: Tokio · gRPC: tonic + prost · Serde
- HTTP (where needed): axum · DB: sqlx (compile-time checked) · Image: image crate + libvips FFI · Geo: geo crate
- **ML Inference**: `ort` (ONNX) — RESERVED for v2 fraud models, **not in current builds**. Fraud v1
  is deterministic heuristics; ONNX is roadmap (PLAN §6.1). Do not assume ML inference is in prod paths.
- Testing: cargo test + proptest · Benchmarking: criterion

### Native (C/C++)
- Image: libvips (Rust FFI) · Crypto: libsodium (Go/Rust FFI) · Password: argon2id (rust-argon2) ·
  Custom PostGIS C extensions only when built-ins are insufficient

### Database
- **PostgreSQL 16 + PostGIS 3.4** (primary) · **Redis 7** (cache/sessions/pubsub, Cluster in prod) ·
  **Meilisearch 1.x** (search) · S3-compatible storage (MinIO local, AWS S3 prod)
- Migrations: forward-only in production, reversible in development

### Infrastructure
- Docker + Compose (local) · Kubernetes (prod) · GitHub Actions CI/CD · Cloudflare CDN (public assets)
- **Cloudflare** is registrar + DNS + CDN/edge for the production zone **`no-markup.com`** (hyphenated —
  the non-hyphen `nomarkup.com` is **not** owned). One account holds DNS, edge, and registrar, which is
  why the edge-caching strategy targets the public DATA layer, not HTML (see §14). Account ID / Zone ID:
  in Vault/`.env.local`, not committed here.
- Prometheus + Grafana · Sentry · OpenTelemetry · Secrets: HashiCorp Vault (prod), `.env.local` (dev)

---

## 3. Project Structure

Monorepo: `web/` (Next.js) · `gateway/` (Go) · `services/` (Go: user, job, payment, chat) ·
`engines/` (Rust: bidding, fraud, trust, imaging) · `proto/` (shared gRPC defs, `v1`) · `ml/`
(Python training, not deployed) · `deploy/` (docker, k8s, terraform). Go services share a uniform
`cmd/` + `internal/{domain,repository,service,grpc}/` + `migrations/` layout.

→ **Full annotated tree: `docs/architecture.md`.**

---

## 4. Design System & UI Standards

Platform-native quality — the web app must feel as polished as a native iOS/Android app. Apply
**Apple HIG** (clarity, deference, depth, feedback; system font stack; 44×44px touch targets; 3-4
font sizes/page) and **Material Design 3** (adaptive breakpoints, semantic color tokens with
mandatory light+dark, elevation tokens, meaningful motion only, ≤5 top-level destinations).

**WCAG 2.2 AA is mandatory** across all four principles:
- **Perceivable**: alt text or `role="presentation"`; contrast 4.5:1 (3:1 large); never color alone.
- **Operable**: full keyboard nav; visible focus (≥2px, 3:1); skip-nav first; no traps; 44×44px targets; timed interactions controllable.
- **Understandable**: inline field errors via `aria-describedby`; `<html lang>`; consistent nav; `autocomplete`.
- **Robust**: valid HTML, no duplicate IDs; ARIA only when native semantics insufficient; `aria-live` for dynamic content; test with VoiceOver/NVDA.

**Token & component rules:** semantic Tailwind tokens only — **never raw hex in components**; strict
type scale (xs…4xl, no others); one component per file; shadcn/ui base customized via Tailwind (never
CSS override); every interactive component accepts `className`; Skeleton over spinners; every
data-fetching component handles loading/error/empty; mobile-first, works at 320px.

→ **Full HIG/Material detail + the canonical `tailwind.config.ts` token block: `docs/design-system.md`.**

---

## 5. Code Conventions

**TypeScript**: strict mode + `noUncheckedIndexedAccess`. No `any`/`as any`/`@ts-ignore`/`@ts-nocheck`
(hooks block these). Const-object enums + type extraction (no TS `enum`). Components PascalCase,
hooks `useX`, utils camelCase, constants SCREAMING_SNAKE, non-component files kebab-case. Grouped
ordered imports (React → 3rd-party → `@/` aliases → relative → types).

**Go**: stdlib conventions; `cmd/`+`internal/`; no global state, constructor injection. Packages
lowercase single-word; verb-based interfaces; `ErrXxx` sentinels; `ctx` first param. **Always** handle
errors, wrap with `%w`. pgx directly, **parameterized queries only** (no `fmt.Sprintf` SQL). slog
structured. Table-driven parallel tests.

**Rust**: 2024 edition, clippy pedantic+nursery, `#![deny(unsafe_code)]` except isolated FFI modules.
thiserror (lib) / anyhow (app); every public fn returns `Result`, **never panic in prod**; `?` +
`.context()`. Zero-copy/pre-alloc in hot paths; `Arc` not `Rc`; criterion before/after, no regression.
Tokio — never block the runtime (`spawn_blocking` for CPU). All `unsafe` FFI isolated in `ffi.rs` with
SAFETY comments.

**SQL**: snake_case plural tables; UUID v7 `id`; `{singular}_id` FKs; UTC `created_at`/`updated_at`;
soft-delete via `deleted_at` (not boolean); **money is BIGINT cents** (never DECIMAL/FLOAT); PostGIS
`geometry(Point,4326)`; index every FK + WHERE/ORDER BY column (`idx_{table}_{cols}`); one operation
per migration, every migration has a down; never edit a deployed migration.

**Protobuf**: gRPC v3 under `/proto/{service}/v1/`; package `nomarkup.{service}.v1`; `{Service}Service`;
PascalCase RPC verbs; per-RPC request/response (no reuse); `google.protobuf.Timestamp`; string UUIDs;
int64 cents.

→ **Worked examples for every language + the testing config blocks: `docs/conventions.md`.**

---

## 6. Security Rules

These are non-negotiable. The hooks enforce many automatically.

### Authentication & Authorization
- JWT (RS256). Short-lived access tokens (15 min). Refresh tokens in HTTP-only secure cookies.
- Roles: `customer`, `provider`, `admin`. Every endpoint checks role.
- Every API route handler wrapped in `withAuth()` (or annotated `// @public` if intentionally open).
- Session timeouts: 60 min customer, 120 min provider, 30 min admin. WebSocket heartbeat resets timer.
- Password hashing: argon2id (memory=65536, iterations=3, parallelism=4).

### Input Validation
- Validate at every boundary: client (Zod), gateway (Go validator), service layer (business rules).
- Never trust client input. Re-validate server-side even if client validates.
- Use Zod schemas shared between frontend and API routes.
- Parameterized queries only. String interpolation in SQL is blocked by hooks.

### Data Protection
- PII encrypted at rest (AES-256-GCM via libsodium). TLS 1.3 for all connections, no exceptions.
- CORS: explicit origin allowlist, no wildcards in prod. CSP strict: no `unsafe-inline`, no `unsafe-eval`.
- Rate limiting: per-IP and per-user. Stricter on auth endpoints (5 attempts/15 min).
- File uploads: validate MIME server-side (don't trust Content-Type). Max 10MB images, 25MB docs. Virus scan before storage.

### Payment Security
- All price calculations server-side. Client displays only.
- Stripe webhook signature verification mandatory (hooks enforce).
- Idempotency keys on all payment mutations (hooks enforce).
- PCI DSS: never touch raw card numbers — Stripe Elements/PaymentIntent only.
- Escrow: funds held in Stripe Connect Express. Released only on job-completion confirmation.

### Secrets Management
- No secrets in code. Ever. Hooks detect and block. Dev: `.env.local` (gitignored). Prod: Vault.
- Required env vars validated at startup with Zod. App fails to start if missing.

---

## 7. Testing Standards

- **Coverage: 80% minimum** (frontend lines/branches/functions/statements; Go lines; Rust).
- **Frontend** (Vitest + RTL + Playwright): test behavior not implementation; mock at the network
  boundary (MSW); `user-event` not `fireEvent`; every data-fetching component tested in
  loading/success/error/empty. E2E covers register → post job → bid → pay → chat. axe-core a11y.
- **Go**: table-driven parallel; testcontainers-go for real Postgres (never mock the DB in repo
  tests); httptest + bufconn; `//go:build integration` for integration tests.
- **Rust**: proptest for all numerical code (trust 0..=100, no lost bids, fraud no-panics); criterion
  benches enforce p99 budgets (bid <1ms, trust <5ms, fraud <50ms, resize <200ms).

→ **Vitest config + full per-stack detail: `docs/conventions.md`.**

---

## 8. Performance Budgets

**Frontend** (and see §14 for the hard user-felt gates): LCP <2.5s · CLS <0.1 · TTI <3.5s · initial
JS <200KB gz · per-route <50KB gz · hero image <200KB (WebP/AVIF).

**Backend**: API p50 <50ms / p95 <200ms / p99 <500ms · bid p99 <1ms · trust p99 <5ms · fraud p99
<50ms · search p99 <50ms · image p99 <200ms · WS delivery <100ms · DB query p95 <20ms.

**Infra**: uptime 99.9% · error rate <0.1% · 100K WS conns/node · 10K HTTP req/Go instance.

---

## 9. Error Handling

- **Frontend**: global error boundary at root + per-feature boundaries. Typed API errors, never show
  raw errors. Display hierarchy: inline field errors → toast/snackbar → component error state (with
  retry) → full-page. Never empty catch / `console.log` errors / generic "Something went wrong";
  always specific message + retry where applicable.
- **Go**: errors are values, wrap with context at every level; sentinel errors for expected conditions.
  Map domain errors → HTTP in the gateway (NotFound 404, Validation 400, Unauthorized 401, Forbidden
  403, Conflict 409, else 500 with full server-side log + generic client message). Never expose internals.
- **Rust**: thiserror typed errors; never `unwrap()`/`expect()` in prod paths; `.context()` from
  anyhow; panics are bugs — catch at service boundary with `catch_unwind`.

---

## 10. Git & Workflow Rules

- **Branches**: `feat/{ticket}-{desc}`, `fix/{ticket}-{desc}`, `chore/{desc}`
- **Commits**: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`)
- **PR size**: < 400 lines changed. Larger → stacked PRs.
- **Main branch**: always deployable. Never push directly. Pre-commit: lint + format + type check (Husky).
- **CI**: lint → type check → unit → integration → build → deploy preview. **No force-push to main/master** (hooks block).

---

## 11. Logging & Observability

Structured JSON logs everywhere — no `fmt.Println`, no `console.log`. Every entry: timestamp, level,
service, request_id, message, fields. Every HTTP/gRPC call logged with method/path/status/duration_ms/
request_id. OpenTelemetry spans across all services (trace ID via `traceparent`); every external call
(DB, Redis, Stripe, S3) gets its own span. Prometheus counters/histograms on requests, bid/trust
durations, active WS connections, Stripe webhook processing.

→ **Full metric list: `docs/conventions.md`.**

---

## 12. Environment Variables

The canonical list lives in **`.env.example`** (copy to `.env.local` for dev). Required at startup
(app fails fast if missing): `DATABASE_URL`, `REDIS_URL`, `MEILISEARCH_URL`/`_API_KEY`, JWT key paths
+ `SESSION_SECRET`, the `STRIPE_*` set, `S3_*`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `SENTRY_DSN`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, and the per-service `*_PORT` vars (gateway 8080, services 50051-50058,
web 3000). Validate with a Zod schema at startup.

---

## 13. Do NOT

- Use `any` type in TypeScript (hook blocks this)
- Use `@ts-ignore` or `@ts-nocheck` (hook blocks this)
- Use `console.log` in production code (hook blocks this, use structured logger)
- Use `dangerouslySetInnerHTML` without DOMPurify (hook blocks this)
- Use string interpolation in SQL (hook blocks this)
- Hardcode secrets (hook blocks this)
- Use CSS-in-JS, CSS modules, or inline styles (use Tailwind)
- Use `<img>` tags (use Next.js `<Image>`)
- Use `<a>` for internal links (use Next.js `<Link>`)
- Use TypeScript `enum` (use const object + type extraction)
- Use any database ORM (use pgx for Go, sqlx for Rust — raw SQL with type safety)
- Use `Float` or `Decimal` for money (use integer cents)
- Use `setTimeout`/`setInterval` for polling (use WebSocket or Server-Sent Events)
- Skip error handling. Every error path must be handled explicitly.
- Write tests without assertions (hook blocks this)
- Deploy without passing CI pipeline
- Commit to main directly
- Use `React.FC` (use plain function declarations with typed props)

---

## 14. Performance Playbook — McMaster-Carr-class speed (project rule)

**North star:** NoMarkup must feel *instantly responsive*, on par with or faster than mcmaster.com.
Speed is a feature and a first-class acceptance criterion.

**Hard user-felt gates** (the primary gates — what "McMaster-fast" means):
| Metric | Target |
|--------|--------|
| LCP (first load, P75 field) | < 1.5s; **stretch < 300ms** on edge-cached HTML |
| INP / interaction | < 100ms |
| Navigation (cached/CDN hit) | < 100ms perceived |
| CLS | < 0.05 (target perfect 0) |
| TTFB (edge hit) | < 100ms |

**Two validated learnings — do NOT re-chase:**
1. **The app HTML cannot be edge-cached.** `layout.tsx` reads a per-request CSP nonce via
   `await headers()` (lets us drop `'unsafe-inline'`, §6), forcing every page dynamic. ISR/`revalidate`
   on app pages is a no-op while the nonce stands. **Cache the DATA layer instead** — the Go gateway's
   public catalog reads use `writeCachedJSON` (`gateway/internal/handler/response.go`): `public,
   s-maxage + stale-while-revalidate + stale-if-error` + strong `ETag`/`304`. Authed reads stay uncached.
2. **On interactive pages, RSC wins LCP/SEO, not bundle size.** Shared First Load is ~183 kB (the
   React floor); dependency-carving is exhausted (mapbox/recharts already lazy). Don't promise a JS cut
   from RSC on an interactive surface.

**Default pattern for new pages (proven, shipped on marketplace):** `page.tsx` is an `async` Server
Component that server-fetches its public data, normalizes nullables, `notFound()` on miss, sets `next:
{ revalidate: N }`, exports `metadata`. Interactive UI lives in a small `*Client.tsx` island seeded via
TanStack Query `initialData` (real first paint, no skeleton). Push `'use client'` to the leaf.

**Preservation + proof (non-negotiable):** preserve all existing Go/Rust/Next.js — remove or
re-architect only with a **measured** before/after win. Measure or it didn't happen. Missing a budget
without a written accepted reason is a regression.

→ **Full JS budget table, baseline narrative, and the 6 principles: `docs/performance.md`.**

---

## 15. Security & Future-Proofing (project rule)

Security and longevity are first-class acceptance criteria, **equal to performance**. Fast but
insecure or a dead end is not done.

### Secure by default (standing posture — detailed rules in §6)
- Every endpoint authenticated AND authorized (`withAuth` / `RequireAdmin` / ownership checks). Every
  input validated server-side. Parameterized SQL only. No secrets in code.
- Money/PII paths get extra scrutiny: idempotency keys, Stripe webhook signature verification, escrow
  invariants, AES-256-GCM at rest. **Fail closed**, never open.
- Treat the security audit as a **release gate**: run `/security-review` (or `/cso`) before shipping
  anything touching auth, payments, or a data boundary. A 500 is never an acceptable answer to a
  predictable condition — map it to the right 4xx with an intuitive message.
- Surface errors to the right audience: customers get actionable self-serve guidance; platform-config
  failures alert the **admin**, not the end user.

### Future-proofing
- **Versioned contracts.** gRPC/REST under `v1`; evolve additively, never break a deployed contract.
  Accept slug-or-id flexible inputs where it reduces coupling.
- **Migrations forward-only in prod, reversible in dev; never edit a shipped migration.**
- **Avoid lock-in where it's cheap.** Keep business logic out of framework glue so Go/Rust services
  outlive any one frontend or library choice.
- **Supply-chain hygiene.** Pin deps, SHA-pin CI actions, keep deps minimal, scrutinize trendy libs.
- **Observability is not optional.** Structured logs + OTel traces + Prometheus metrics on every new
  service/hot path, so regressions are visible.
- **Graceful degradation + feature flags.** Features fail soft (payments/AI/maps down → clear notice,
  never a crash) and ship behind flags when risky.
- **Document the non-obvious.** Record meaningful architecture decisions (ADR-style).

---

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill tool as your
FIRST action. Do NOT answer directly, do NOT use other tools first. The skill has specialized
workflows that produce better results than ad-hoc answers.

- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
