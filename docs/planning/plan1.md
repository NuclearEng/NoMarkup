# NoMarkup — Post-Completion High-Impact Steps (plan1.md)

## Context

All 10 phases from PLAN.md are complete (~100K+ lines). The codebase is architecturally complete with real implementations across all 16 vertical slices. However, there is no seed data — you cannot log in or test any flows without manually registering via the API. This plan covers the high-impact steps to make the app testable, observable, and production-deployable.

The user's immediate need: **login credentials** to test the app. Seed data is step 1.

---

## Step 1: Database Seed Data Script

**Why:** No test users, jobs, bids, or contracts exist. Can't log in or test any flow.

**What to create:** `database/seed.sql` — a SQL script that populates the dev database with realistic test data.

**Seed data contents:**
- **3 users** with pre-hashed Argon2id passwords (all password: `Password123!`):
  - `admin@nomarkup.com` — admin role
  - `customer@nomarkup.com` — customer role, with 1 property
  - `provider@nomarkup.com` — provider role, with provider_profile + 3 service categories
- **1 property** for the customer (with PostGIS location)
- **3 jobs** in different statuses: active (open for bids), awarded, completed
- **2 bids** on the active job from the provider
- **1 contract** (from the awarded job) in `in_progress` status with milestones
- **1 completed contract** with a review
- **1 trust score** entry for the provider
- **1 subscription** (free tier) for each user
- **Notification preferences** for each user

**Implementation approach:**
- Write a Go command (`database/cmd/seed/main.go`) that connects to PostgreSQL and inserts seed data
  - Uses the same Argon2id hashing as the user service for password generation
  - Idempotent — uses `ON CONFLICT DO NOTHING` so it can be re-run safely
- Also provide a raw `database/seed.sql` for direct use with `psql`
- Add `make seed` target to Makefile (runs the Go seed command)

**Critical files:**
- `database/cmd/seed/main.go` — Go seed script with Argon2id password hashing
- `database/seed.sql` — Raw SQL alternative
- `Makefile` — Add `seed` target
- `services/user/internal/service/auth.go` — Reference for Argon2id params (memory=65536, iterations=3, parallelism=4)
- `database/migrations/001_initial_schema.up.sql` — Schema reference
- `database/migrations/002_seed_taxonomy.up.sql` — Categories already seeded here

**Verification:**
1. `make dev-infra` — Start postgres, redis, meilisearch, minio
2. `make migrate-up` — Run migrations
3. `make seed` — Insert seed data
4. `curl -X POST localhost:8080/api/v1/auth/login -d '{"email":"customer@nomarkup.com","password":"Password123!"}'` — Should return JWT tokens
5. Use access token to hit protected endpoints (GET /api/v1/users/me, GET /api/v1/jobs)

---

## Step 2: Full Codebase Audit

**Why:** Before adding more features, verify that all existing implementations are real and connected. The CLAUDE.md audit rule requires checking every file for stubs, dead wiring, type mismatches, and security gaps.

**Scope:**
- Verify all gateway handlers actually call gRPC (not stubs)
- Verify all gRPC server methods have real implementations (not `Unimplemented`)
- Verify all repository methods execute real SQL (not `return nil`)
- Check for TODO/FIXME/HACK comments
- Verify frontend API calls match actual backend endpoints (method, path, body shape)
- Check for security gaps (unprotected endpoints, missing validation)
- Verify test coverage exists for critical paths

**Output:** Findings report with file:line references and recommended fixes. Then fix all findings.

**Verification:** All services compile, all tests pass, no stubs remain.

---

## Step 3: Redis Caching for Hot Paths

**Why:** Redis is running but only used for chat pub/sub. Multiple hot paths would benefit from caching.

**What to cache:**
- **Service categories** (tree structure) — rarely changes, read on every job posting form
- **Trust scores** — read frequently, computed infrequently
- **User sessions** — currently only in PostgreSQL
- **Rate limiting** — gateway rate limiter is in-memory (lost on restart), should use Redis
- **Job search results** — short TTL (30s) for popular queries

**Implementation:**
- Add `go-redis/v9` dependency to gateway, user service, job service
- Create shared `pkg/cache/redis.go` with TTL-aware get/set helpers
- Category cache: 1 hour TTL, invalidate on admin update
- Trust score cache: 5 min TTL, invalidate on score recalculation event
- Rate limiter: Migrate from in-memory sliding window to Redis sorted sets

**Critical files:**
- `gateway/internal/middleware/ratelimit.go` — Replace in-memory with Redis
- `gateway/internal/config/config.go` — Already loads REDIS_URL
- `services/user/internal/service/service.go` — Add trust score cache
- `services/job/internal/service/job.go` — Add category cache

**Verification:**
1. Start stack, seed data
2. Hit category endpoint twice — second call should be faster (cache hit logged)
3. Restart gateway — rate limit state should persist (Redis-backed)
4. Run load tests — verify cache hit ratios in logs

---

## Step 4: OpenTelemetry Distributed Tracing

**Why:** No distributed tracing exists. When a request traverses gateway → service → engine → database, there's no way to correlate the call chain or diagnose latency.

**What to add:**
- OTel SDK initialization in all Go services and gateway
- Trace context propagation via gRPC metadata (traceparent header)
- Spans for: HTTP request, gRPC call, database query, Redis operation
- Jaeger or OTLP collector in docker-compose for local visualization
- Rust engines: `tracing-opentelemetry` crate for span export

**Implementation:**
- Add `go.opentelemetry.io/otel` + `go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc` to Go services
- Add `tracing-opentelemetry` + `opentelemetry-otlp` to Rust workspace
- Add Jaeger service to docker-compose.yml
- Create shared OTel init function for Go services
- Instrument gRPC client/server interceptors

**Critical files:**
- `gateway/cmd/server/main.go` — OTel provider init
- `services/*/cmd/server/main.go` — OTel provider init (all 5 services)
- `engines/Cargo.toml` — Add OTel deps
- `engines/*/src/main.rs` — OTel subscriber setup
- `docker-compose.yml` — Add Jaeger service

**Verification:**
1. Start full stack with Jaeger
2. Make API call (e.g., create job)
3. Open Jaeger UI (localhost:16686) — see full trace across gateway → job service → PostgreSQL
4. Verify trace IDs match across service logs

---

## Step 5: Kubernetes Manifests

**Why:** `deploy/k8s/` is empty. Production deployment requires K8s manifests.

**What to create:**
- Namespace definition (`nomarkup`)
- Deployment + Service for each component (11 total: gateway, 5 Go services, 4 Rust engines, web)
- Ingress definition with TLS termination
- ConfigMap for non-secret configuration
- Secret references (ExternalSecret or SealedSecret for Vault integration)
- HPA (Horizontal Pod Autoscaler) for gateway and bidding engine
- PersistentVolumeClaims for PostgreSQL and MinIO
- Network policies for service-to-service communication

**Implementation:**
- Use Kustomize with base + overlays (staging, production)
- Resource limits/requests based on performance budgets from CLAUDE.md
- Liveness/readiness probes using /health endpoints
- Init containers for migration execution

**Critical files:**
- `deploy/k8s/base/` — Base manifests
- `deploy/k8s/overlays/staging/` — Staging overrides
- `deploy/k8s/overlays/production/` — Production overrides
- `deploy/k8s/base/kustomization.yaml` — Resource list

**Verification:**
1. `kubectl apply -k deploy/k8s/overlays/staging --dry-run=client` — Validates all manifests
2. Verify resource limits match performance budgets
3. Verify all services have health check probes

---

## Step 6: Frontend Polish (Delight Layer)

**Why:** The frontend is fully functional (38 routes, 50+ components, 22 hooks — all real). This step adds polish: animations, toast notifications, and better empty states.

**What to add:**
- **Toast notifications** (Sonner) — action feedback for bid placed, job published, payment processed, etc.
- **Page transitions** — subtle fade-in on route change
- **Skeleton animation** — pulse animation on existing skeleton loaders
- **Empty state illustrations** — CTAs on zero-data screens ("No jobs yet? Post your first one")
- **Card hover effects** — subtle lift/shadow on interactive cards
- **Form submission feedback** — loading spinners on submit buttons

**Implementation:**
- Install `sonner` for toast notifications
- Add Sonner `<Toaster>` to root layout
- Add toast calls to mutation hooks (useJobs, useBids, useContracts, usePayments)
- CSS transitions via Tailwind (`transition-all duration-200 ease-out`)
- Enhanced empty states with icon + message + CTA button

**Critical files:**
- `web/src/app/layout.tsx` — Add Toaster provider
- `web/src/hooks/*.ts` — Add toast on mutation success/error
- `web/src/components/ui/skeleton.tsx` — Add pulse animation
- `web/src/components/*/empty states` — Enhance with CTAs

**Verification:**
1. Place a bid → toast appears "Bid placed successfully"
2. Navigate between pages → smooth fade transition
3. View empty jobs list → see CTA to post first job
4. Hover over job card → subtle elevation change
