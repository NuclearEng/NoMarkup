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
service mesh: **User / Job / Payment / Chat / Notification** (Go); **Bidding / Fraud / Trust /
Imaging / Underwriting / Pricing** (Rust). Data layer: **PostgreSQL 16 + PostGIS · Redis 7 ·
Meilisearch**. Crypto: **golang.org/x/crypto** nacl/secretbox + argon2id (no custom PostGIS C
extensions; no libvips in current builds).

Rust is reserved for sub-ms / high-throughput / numerical paths (bidding, fraud heuristics v1,
trust scoring, imaging via the `image` crate, underwriting, pricing). Go owns CRUD, orchestration,
Stripe, WebSocket fan-out, **Meilisearch** coordination, and **PostGIS** geo. Search and geo are
**not** separate Rust engines.

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
- HTTP (where needed): axum · DB: sqlx (compile-time checked) · Image: **`image` crate only** (no libvips FFI yet)
- Workspace members only: `bidding`, `fraud`, `trust`, `imaging`, `underwriting`, `pricing`
- **ML Inference**: `ort` (ONNX) — RESERVED for v2 fraud models, **not in current builds**. Fraud v1
  is deterministic heuristics; ONNX is roadmap (PLAN §6.1). Do not assume ML inference is in prod paths.
- Testing: cargo test + proptest · Benchmarking: **criterion locally / in `engines/target/criterion` — not gated in CI**

### Crypto / native
- **PII:** XSalsa20-Poly1305 via Go `golang.org/x/crypto/nacl/secretbox` (libsodium-compatible wire format)
- **Passwords:** argon2id (Go/user service)
- **No** custom PostGIS C extensions; stock PostGIS 3.4 only
- **No** libvips / Rust geo crate in the current tree

### Database
- **PostgreSQL 16 + PostGIS 3.4** (primary) · **Redis 7** (cache/sessions/pubsub) ·
  **Meilisearch 1.x** (search) · S3-compatible storage (MinIO local, AWS S3 prod)
- Migrations: forward-only in production, reversible in development (currently through **`097_*`**)

### Infrastructure
- Docker + Compose (local) · Kubernetes **manifests** (prod path) · GitHub Actions CI/CD
- **Cloudflare** is the **intended** registrar + DNS + CDN/edge for production zone **`no-markup.com`**
  (hyphenated — the non-hyphen `nomarkup.com` is **not** owned). Origin targets public **DATA**
  caching, not HTML (see §14). **In-repo edge inventory** (auth cache-bypass expression, what is
  not Terraform-managed): `docs/operations/cloudflare-edge.md` + `docs/operations/cdn-cache-auth-bypass.md`.
  Live CF rules / Account ID / Zone ID: Founder + Vault/`.env.local`, not committed (OPS-24 Partial).
- **Deploy is not production-ready** until `DEPLOY_PROVISIONED=true`, secrets, cluster, and real
  migrate-on-deploy exist (`docs/operations/provisioning-checklist.md`). `deploy/terraform/` is a
  skeleton until IaC is filled in.
- Prometheus + Grafana configs live under `deploy/monitoring/`; OTel/Sentry env vars are wired in
  code. Secrets: Vault (prod target), `.env.local` (dev).

---

## 3. Project Structure

Monorepo: `web/` (Next.js) · `gateway/` (Go) · `services/` (Go: user, job, payment, chat, notification) ·
`engines/` (Rust: bidding, fraud, trust, imaging, underwriting, pricing) · `proto/` (shared gRPC defs, `v1`) · `ml/`
(Python training, not deployed) · `deploy/` (docker, k8s, terraform skeleton). Go services share a uniform
`cmd/` + `internal/{domain,repository,service,grpc}/` layout; SQL migrations live under `database/migrations/`.

→ **Full annotated tree: `docs/architecture.md`.**

---

## 4. Design System & UI Standards

Platform-native quality — the web app must feel as polished as a native iOS/Android app. Apply
**Apple HIG** (clarity, deference, depth, feedback; 44×44px touch targets; 3-4 font sizes/page) and
**Material Design 3** (adaptive breakpoints, semantic color tokens with mandatory light+dark,
elevation tokens, meaningful motion only, ≤5 top-level destinations). **Web type is not
system-only:** showcase stack Instrument Serif / Syne / Outfit / JetBrains Mono (see
`docs/brand/showcase-ssot.md` + `docs/design-system.md`). iOS may approximate with system
serif/mono; colors and voice still follow showcase.

**WCAG 2.2 AA is the product goal** (not a fully axe-certified CI gate yet — jsx-a11y + partial stub axe).
Apply across all four principles:
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

**Rust**: 2024 edition, clippy pedantic+nursery, `#![deny(unsafe_code)]` (workspace lint; no FFI
modules in tree today). thiserror (lib) / anyhow (app); every public fn returns `Result`, **never panic
in prod**; `?` + `.context()`. Zero-copy/pre-alloc in hot paths; `Arc` not `Rc`. Criterion benches
exist for hot paths — run locally / nightly; **not enforced in CI**. Tokio — never block the runtime
(`spawn_blocking` for CPU).

**SQL**: snake_case plural tables; UUID `id` (**gen_random_uuid() = v4 in every table today**; v7 is
the stated preference but no generator exists in the DB — do not claim v7 ordering guarantees); `{singular}_id` FKs; UTC `created_at`/`updated_at`;
soft-delete via `deleted_at` (not boolean); **money is BIGINT cents** (never DECIMAL/FLOAT); PostGIS
`geometry(Point,4326)`; index every FK + WHERE/ORDER BY column (`idx_{table}_{cols}`) — 26 cold audit/taxonomy FKs are
deliberately exempt, listed in migration `083`'s header; note a partial index only covers an FK
check when its predicate is exactly `col IS NOT NULL`; one operation
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
- Roles: `customer`, `provider`, `admin`. Gateway middleware enforces role/ownership on protected routes.
- Session timeouts: 60 min customer, 120 min provider, 30 min admin. WebSocket heartbeat resets timer.
- Password hashing: argon2id (memory=65536, iterations=3, parallelism=4).

### Input Validation
- Validate at every boundary: client (Zod), gateway (Go validator), service layer (business rules).
- Never trust client input. Re-validate server-side even if client validates.
- Parameterized queries only. String interpolation in SQL is blocked by Claude Code hooks where configured.

### Data Protection
- **PII at rest:** selected fields encrypted with **XSalsa20-Poly1305** (`nacl/secretbox`). Every
  field below has BOTH a runtime write path and a runtime read path — a backfill without a writer
  is not coverage. **Email remains plaintext** for auth lookup. Not AES-256-GCM whole-row.
  **Detection is per VALUE, by authentication** (`crypto.Cipher.DecryptStringOrPassthrough`): the
  `pii_encrypted_v1` columns are a ROW flag over PER-COLUMN encryption and are **advisory only** —
  never branch on them (migration `098`).
  **Encrypted inventory** (`031`/`033`, extended by `104`-`107`): `users.phone`, `users.mfa_secret`,
  `users.dob_encrypted`; `provider_profiles.service_address` / `.ein_tin` /
  `.insurance_policy_number`; `provider_employees.email` / `.phone` / `.license_number` /
  `.insurance_policy_number` / `.date_of_birth_encrypted`; `provider_licenses.license_number`;
  `properties.address` / `.notes` / `.location_encrypted`; `jobs.service_address` /
  `.service_location_encrypted`.
  **Geometry is coarsened, not encrypted** — a point beside an encrypted address is the same secret
  in another encoding, but it cannot be encrypted because GiST cannot index ciphertext. So
  `jobs.service_location`, `jobs.approximate_location` and `properties.location` are snapped at rest
  to a 0.01° grid (`pii_coarsen_point`, ~1.1 km) with the exact point kept encrypted alongside;
  readers that need precision decrypt it. **`jobs.approximate_location` was previously written from
  the exact coordinate and is served on the unauthenticated, edge-cached `/jobs/map`** — never write
  an un-coarsened point there.
  **Documented limitation — do not claim it is fixed:** `provider_profiles.service_location` stays
  exact and plaintext. It is the `ST_DWithin`/`ST_DistanceSphere` target of provider matching and
  search and carries two GiST indexes, so the only available control is precision reduction, which
  would perturb live match ranking for a partial gain. `listings.location` is published by design
  (25 mi local pickup). `company_employees.*` is dormant and plaintext (`099`).
  **Audit:** `pii_plaintext_audit` and `pii_exact_geometry_audit` must both be EMPTY on a fully
  backfilled database; `make encrypt-pii` drains them and is idempotent per value.
  **Key handling:** `ENCRYPTION_KEY` is mandatory outside development — the ephemeral-key fallback
  is gated on "is this development?", not "is this production?", because staging runs multiple
  replicas and a per-pod key silently corrupts PII.
- **TLS:** public edge **TLS 1.3** (ingress/CDN). **gRPC mesh is currently insecure credentials
  (plaintext) on the private network**; target is mTLS — do not claim "TLS 1.3 for all connections."
- CORS: explicit origin allowlist, no wildcards in prod.
- **CSP:** script-src uses a per-request **nonce** + `strict-dynamic` (no `'unsafe-eval'` in prod).
  **`style-src` allows `'unsafe-inline'`** (Next.js / tooling injects styles). Do not claim
  "no unsafe-inline" without the style exception.
- Rate limiting: per-IP tiers. Stricter on auth endpoints (5 attempts/15 min target).
- File uploads: validate MIME server-side (don't trust Content-Type). **10MB for every context,
  documents included** — there is no separate 25MB doc path (`MAX_FILE_SIZE_BYTES`). Enforced in
  three places: `http.MaxBytesReader` on the gateway multipart route (`ParseMultipartForm`'s
  argument is a memory budget, NOT a cap), `content_length` bound into the presigned S3 PUT
  signature (the declared size is client-supplied and cannot be trusted), and decoder width/height/
  allocation limits in the imaging engine.

### Payment Security
- All price calculations server-side. Client displays only.
- Stripe webhook signature verification mandatory.
- Idempotency keys on payment mutations (required on critical paths; remaining gaps tracked in
  `docs/planning/adversarial-action-tracker.md`).
- PCI DSS: never touch raw card numbers — Stripe Elements/PaymentIntent only.
- Escrow: funds held in Stripe Connect Express. Release and refund carry an **actor**: the provider
  may never release their own escrow, and a refund after payout is admin-only (it draws on the
  platform balance). Note contract completion still does not itself trigger release (services /
  goods paths as implemented).

### Feature flags
- Admin-togglable keys; `RequireFlag` → **503 when the flag row exists and `enabled=false`**.
- **Fails closed in production** (SEC-01, shipped): missing flag row, DB error, and nil DB all →
  503 when `ENVIRONMENT=production`. Non-production keeps fail-open for missing/error only.
- **ARC-10 Partial — sticky % (not a full experiment platform):** optional
  `feature_flags.rollout_percent` (0–100, default 100). When `enabled=true` and percent &lt; 100,
  cohort is sticky via `SHA256(userID|key) % 100` (device id fallback). Public `GET /api/v1/flags`
  stays a flat bool map (CDN). Exposure metrics: `feature_flag_checks_total`,
  `experiment_exposures_total`. **Money/regulated keys are binary-only** (allow only at 100%;
  partial fails closed; admin write rejects 1–99). Handler-level `WithExperiment` is
  control/treatment only — no multi-arm stats warehouse.
- **Caveat:** only 6 route groups call `RequireFlag`. Of the 13 flags in the DB, 7 have no backend
  enforcement at all and gate UI only — toggling those off does not close the API.

### Secrets Management
- No secrets in code. Ever. Claude Code hooks detect many patterns. Dev: `.env.local` (gitignored).
  Prod: Vault / K8s secrets (provisioning incomplete until `DEPLOY_PROVISIONED`).
- Required env vars validated at service startup.

---

## 7. Testing Standards

- **Web coverage floors** (Vitest v8, whole-app include — see `web/vitest.config.mts`): branches **76**,
  functions **80**, lines **80**, statements **80** — these are the values the config actually
  enforces. Ratchet up; do not claim blanket "80% all stacks" (Go/Rust are not gated).
- **Go / Rust coverage:** strong unit + proptest culture; **not** CI-gated at 80% today.
- **Frontend** (Vitest + RTL + Playwright): test behavior not implementation; `user-event` preferred;
  data-fetching components should cover loading/success/error/empty. **E2E in CI:** Chromium,
  backend-tolerant smoke; full funnel dogfood needs a live stack + `SEED_PASSWORD` (see `E2E.md`).
  axe is partial (stubs / not a full real-route AA gate).
- **Go**: table-driven parallel; **CI uses a PostGIS service container** (GitHub Actions), not
  testcontainers-go. Integration packages under `tests/integration/` + service tests; httptest + bufconn.
- **Rust**: proptest for numerical code (trust bounds, bid invariants, fraud no-panics, underwriting).
  Criterion benches exist for p99 budgets (**local / not CI-enforced**). k6 under `tests/load/`:
  optional CI smoke (`k6-smoke` when `K6_BASE_URL` set) only — full load profiles not CI-gated (PERF-10 Partial).

→ **Vitest config + full per-stack detail: `docs/conventions.md`.**

---

## 8. Performance Budgets

**Frontend** (and see §14 for the hard user-felt gates): LCP <2.5s · CLS <0.1 · TTI <3.5s · initial
JS <200KB gz · per-route <50KB gz · hero image <200KB (WebP/AVIF).

**Backend**: API p50 <50ms / p95 <200ms / p99 <500ms · bid p99 <1ms · trust p99 <5ms · fraud p99
<50ms · search p99 <50ms · image p99 <200ms · WS delivery <100ms · DB query p95 <20ms.

**Infra (design budgets — unproven; not measured SLAs):** uptime **target** 99.9% · error rate **target** <0.1% · 100K WS conns/node · 10K HTTP req/Go instance. No prod uptime series or k6/staging load reports prove concurrent capacity or availability yet (OPS-26).

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
- **Main branch**: always deployable. Never push directly.
- **Pre-commit:** **Claude Code hooks** enforce many project rules in agent sessions. There is **no
  Husky** git pre-commit package installed unless added later — do not claim Husky is the gate.
- **CI**: lint → type check → unit → (selected) integration → build. Deploy is fail-closed until
  `DEPLOY_PROVISIONED`. **No force-push to main/master** (policy / hooks where configured).

---

## 11. Logging & Observability

Structured JSON logs everywhere — no `fmt.Println`, no `console.log`. Every entry: timestamp, level,
service, request_id, message, fields. Every HTTP/gRPC call logged with method/path/status/duration_ms/
request_id. OpenTelemetry spans across all services (trace ID via `traceparent`); every external call
(DB via otelpgx, Redis, Stripe, Meilisearch) gets its own span, and the gateway emits an inbound
HTTP root span so the user-facing request appears in the trace. **No S3 spans** — no AWS SDK exists
in any Go module. `request_id` seeds the request context, flows outward as gRPC metadata, and is
stamped onto every `slog.*Context` record by a handler decorator; plain `slog.Info` calls without a
ctx still do not carry it. Prometheus counters/histograms on requests, outbound gRPC calls,
bid/trust durations, active WS connections, and Stripe event processing (including
`stripe_webhook_event_lag_seconds`, which is the backlog signal — processing duration stays flat
while lag climbs).
**Scrape auth:** `/metrics` 401s every non-loopback request in production unless
`METRICS_BEARER_TOKEN` is set on the gateway AND mirrored to Prometheus. Without it every alert
built on `http_requests_total` silently never fires, including both P0 payment alerts.

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
- Use `<img>` tags (use Next.js `<Image>`). **Documented exceptions** (raw
  `<img>` is intentional — third-party dynamic URLs / non-allowlisted hosts that
  `next/image` cannot optimize without config churn):
  - **Mapbox Static Images API** previews (e.g. job detail location strip) —
    signed query URL with access token; not a stable remotePatterns host shape
  - **MFA setup QR** on security settings — `api.qrserver.com` encode of the
    otpauth URI (dev/setup convenience; not product photo CDN)
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

**North star (targets, not achieved metrics):** NoMarkup should feel *instantly responsive*, on par
with or faster than mcmaster.com. Lab LCP on key routes is still **multi-second** in measured
baselines; there is **no field RUM** (web-vitals) gate yet. Speed remains a first-class acceptance
criterion for new work — do not claim the North Star is shipped.

**Hard user-felt gates** (targets):
| Metric | Target |
|--------|--------|
| LCP (first load, P75 field) | < 1.5s; stretch < 300ms only if HTML were edge-cached (**it is not**) |
| INP / interaction | < 100ms |
| Navigation (cached/CDN hit) | < 100ms perceived |
| CLS | < 0.05 (target perfect 0) |
| TTFB (edge hit on **DATA**) | < 100ms |

**Two validated learnings — do NOT re-chase:**
1. **The app HTML cannot be edge-cached.** Root layout reads a per-request CSP **script** nonce via
   `await headers()`, forcing dynamic rendering. ISR/`revalidate` on app pages does not make HTML
   public-cacheable while the nonce stands. **Cache the DATA layer instead** — gateway public catalog
   reads use `writeCachedJSON` (`gateway/internal/handler/response.go`): `public, s-maxage +
   stale-while-revalidate + stale-if-error` + strong `ETag`/`304`. Authed reads stay uncached. This
   DATA-layer CDN cache **is real and shipped**.
2. **On interactive pages, RSC wins LCP/SEO, not bundle size.** Shared First Load is ~187 kB measured (the
   React floor); heavy deps like mapbox are already lazy. Don't promise a JS cut from RSC on an
   interactive surface.

**Service worker:** `web/public/sw.js` is a **kill-switch** (unregisters + purges caches). Do not
claim production PWA offline caching until a real SW ships behind a prod flag.

**Default pattern for new pages (recommended; marketplace pilots shipped):** `page.tsx` is an
`async` Server Component that server-fetches public data, normalizes nullables, `notFound()` on miss,
sets `next: { revalidate: N }` for the fetch cache only, exports `metadata`. Interactive UI lives in
a small `*Client.tsx` island seeded via TanStack Query `initialData`. Push `'use client'` to the leaf.
**Reality:** many routes (including `/` and `/jobs` browse) are still full client pages — convert on
touch; do not claim the whole app is RSC-first.

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
  invariants, secretbox PII fields at rest. **Fail closed** on money engines/authz; feature flags
  currently fail open on missing rows (financial fail-closed is the target — SEC-01).
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
