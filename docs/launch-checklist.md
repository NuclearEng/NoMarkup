# NoMarkup Launch Readiness Checklist

From code-complete to real users on production. Every item must be checked off or explicitly deferred with a reason before launch.

**Launch market:** Seattle, WA
**Target:** 10,000 concurrent users at launch (NFR-6)
**Uptime SLA:** 99.9% (NFR-7)

---

## 1. Infrastructure Provisioning

### Kubernetes Cluster
- [ ] Provision managed Kubernetes cluster (EKS or GKE — Open Question #1 in PRD)
- [ ] Minimum 3 nodes in the node pool (matches production overlay: gateway x3, all services x2)
- [ ] Configure `nomarkup` namespace (per `deploy/k8s/base/namespace.yaml`)
- [ ] Install nginx ingress controller (ingress spec uses `ingressClassName: nginx`)
- [ ] Apply network policies (`deploy/k8s/base/network-policy.yaml` — default-deny-ingress, gateway-only external access)
- [ ] Verify HPA is functional: gateway scales 3-10 pods, bidding engine scales 2-8 pods (per `deploy/k8s/overlays/production/hpa.yaml`)
- [ ] Configure PersistentVolumeClaims for stateful services (per `deploy/k8s/base/pvc.yaml`)

### DNS & TLS
- [ ] Register/verify `nomarkup.com` domain
- [ ] Point `nomarkup.com` and `www.nomarkup.com` to ingress load balancer IP
- [ ] Provision TLS certificate and create `nomarkup-tls` K8s secret (referenced in `deploy/k8s/base/ingress.yaml`)
- [ ] Verify SSL redirect annotation is active (`nginx.ingress.kubernetes.io/ssl-redirect: "true"`)
- [ ] Configure Cloudflare CDN for static assets (public profile photos, job photos, portfolio images)
- [ ] Set up `api.nomarkup.com` subdomain for health checks (referenced in `deploy.yml` smoke tests)

### Managed Data Stores
- [ ] Provision managed PostgreSQL 16 with PostGIS 3.4 extension enabled (docker-compose uses `postgis/postgis:16-3.4`)
- [ ] Configure PgBouncer in front of PostgreSQL (transaction pooling mode, 100 default pool size, 500 max client connections — matches docker-compose config)
- [ ] Provision managed Redis 7 cluster (appendonly persistence enabled)
- [ ] Deploy Meilisearch 1.x (managed or self-hosted with persistent storage)
- [ ] Provision S3 bucket for public assets (`nomarkup-prod`) with CDN
- [ ] Provision separate S3 bucket for private documents (identity docs, insurance, licenses — no CDN, no public read, per NFR-13/SEC-8)
- [ ] Verify S3 endpoint does not point to MinIO in production (dev uses `S3_ENDPOINT=http://localhost:9000`)

### Container Registry
- [ ] Set up container registry (GHCR is default per CI — `vars.DOCKER_REGISTRY || 'ghcr.io'`)
- [ ] Configure CI to authenticate and push images on main branch merge
- [ ] Verify all 11 Dockerfiles build successfully: web, gateway, user, job, payment, chat, notification, bidding, fraud, trust, imaging

---

## 2. Secrets & Configuration

### Cryptographic Keys
- [ ] Generate production JWT RS256 keypair (4096-bit): `openssl genrsa -out private.pem 4096 && openssl rsa -in private.pem -pubout -out public.pem`
- [ ] Store keypair in K8s secret or Vault — not on disk (dev uses `JWT_PRIVATE_KEY_PATH=./keys/private.pem`)
- [ ] Generate production `SESSION_SECRET` with `openssl rand -base64 32`

### Stripe (Live Mode)
- [ ] Activate Stripe production account (exit test mode)
- [ ] Create live `STRIPE_SECRET_KEY` (sk_live_...)
- [ ] Create live `STRIPE_PUBLISHABLE_KEY` (pk_live_...)
- [ ] Configure Stripe Connect platform settings for Express accounts (per FR-9.1 — providers are Connected Express accounts)
- [ ] Obtain `STRIPE_CONNECT_CLIENT_ID` for production
- [ ] Register production webhook endpoint (`https://nomarkup.com/api/webhooks/stripe`) and obtain `STRIPE_WEBHOOK_SECRET` (whsec_...)
- [ ] Subscribe to required webhook events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- [ ] Sign Stripe Connect platform agreement

### Email (SendGrid)
- [ ] Create SendGrid production account
- [ ] Verify sending domain (`nomarkup.com`) with SPF, DKIM, and DMARC records
- [ ] Obtain production `SENDGRID_API_KEY`
- [ ] Configure `SENDGRID_FROM_EMAIL=noreply@nomarkup.com`
- [ ] Create/import email templates for: verification, bid awarded, payment received, dispute opened, subscription expiring, digest (per FR-17.2 notification types)
- [ ] Set `SENDGRID_VERIFICATION_TEMPLATE_ID` for production

### OAuth Providers
- [ ] Configure Google OAuth: production `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` with redirect URI `https://nomarkup.com/api/auth/google/callback`
- [ ] Configure Apple Sign-In: production `APPLE_CLIENT_ID` and `APPLE_CLIENT_SECRET` (if implementing for web — Open Question #12)
- [ ] Set `OAUTH_REDIRECT_BASE=https://nomarkup.com`
- [ ] Set `FRONTEND_URL=https://nomarkup.com`

### Maps
- [ ] Create Mapbox production token with appropriate scopes
- [ ] Set `NEXT_PUBLIC_MAPBOX_TOKEN` for production
- [ ] Verify token URL restrictions are set to `nomarkup.com`

### Monitoring
- [ ] Create Sentry production projects: one for web frontend, one for backend services
- [ ] Set `SENTRY_DSN` (backend) and `NEXT_PUBLIC_SENTRY_DSN` (frontend)
- [ ] Set `SENTRY_ORG` and `SENTRY_PROJECT`
- [ ] Configure `OTEL_EXPORTER_OTLP_ENDPOINT` to point to production OTel collector

### Secret Management
- [ ] Set up HashiCorp Vault or cloud KMS for production secret management
- [ ] Migrate all secrets from K8s literals to Vault-backed secrets
- [ ] Verify no secrets are hardcoded in `deploy/k8s/overlays/production/kustomization.yaml` configMapGenerator
- [ ] Audit `.env.example` — confirm every variable has a production value set or a documented reason for omission

### Environment Validation
- [ ] Set `ENVIRONMENT=production` in production config (already in production kustomization)
- [ ] Set `LOG_LEVEL=info` (already in production kustomization)
- [ ] Set `NEXT_PUBLIC_API_URL=https://nomarkup.com` (not localhost:8080)
- [ ] Set `NEXT_PUBLIC_ENABLE_LIVE_AUCTION=true` (feature flag — live_auction is seeded as enabled)

---

## 3. Database

### Migrations
- [ ] Run all 18 migrations (001 through 018) on production database in order
- [ ] Verify `001_initial_schema.up.sql` creates all core tables: users, jobs, bids, contracts, payments, reviews, chat_messages, etc.
- [ ] Verify `002_seed_taxonomy.up.sql` seeds service categories
- [ ] Verify tier categories are seeded: `005_tier1_categories`, `006_tier2_categories`, `009_tier3_categories`
- [ ] Verify `013_feature_flags.up.sql` seeds default feature flags (live_auction=true, others=false)
- [ ] Verify `018_query_optimization.up.sql` creates all performance indexes
- [ ] Confirm `trigger_set_updated_at()` function exists (referenced by multiple migrations)

### Feature Flags (Production Defaults)
- [ ] `live_auction` = true (core feature)
- [ ] `fair_price_index` = false (post-launch)
- [ ] `spectator_mode` = false (post-launch)
- [ ] `nomarkup_guarantee` = false (post-launch)
- [ ] `smart_matching` = false (post-launch)
- [ ] `provider_business_os` = false (post-launch)

### Data Seeding
- [ ] Seed Seattle-area service categories: General Handyman, Cleaning, Landscaping, Plumbing, Electrical (PRD Phase 1.5 priority categories)
- [ ] Seed market pricing data for Seattle metro ZIP codes (FR-11.5 — market range bar needs data from day one)
- [ ] Verify `fair_price_index` table has initial data for priority categories (migration 014)

### Backup & Recovery
- [ ] Configure automated daily backups with 30-day retention (NFR-10)
- [ ] Enable point-in-time recovery (PITR) on managed PostgreSQL
- [ ] Test restore from backup to a separate instance
- [ ] Test migration rollback procedure: run `.down.sql` for latest migration, verify clean state
- [ ] Create read replica for analytics queries (NFR-12)
- [ ] Document emergency recovery runbook with RTO/RPO targets

---

## 4. CI/CD Pipeline

### Current Pipeline Verification
- [ ] Verify `ci.yml` passes on main: web lint + typecheck, web tests (80% coverage thresholds), Playwright E2E, gateway tests, all 5 service tests (user/job/payment/chat/notification), Rust engine tests (fmt + clippy + test), full Docker build
- [ ] Verify `security-scan.yml` passes: govulncheck on all 6 Go modules, cargo-audit on engines, npm audit (production deps, high severity)
- [ ] Verify all 11 Docker images build in CI without error

### Deploy Pipeline (Must Complete)
- [ ] **Replace placeholder `deploy.yml`** — current workflow only echoes instructions, does not actually deploy
- [ ] Implement actual Docker build + push to registry step
- [ ] Implement actual database migration step
- [ ] Implement actual `kubectl apply` with kustomize overlay for production
- [ ] Implement actual image tag update across all 11 deployments
- [ ] Implement rollout status verification with timeout
- [ ] Implement smoke test (health check endpoints)
- [ ] Add deployment notifications to Slack/Discord
- [ ] Test staging deployment end-to-end before production

### Rollback
- [ ] Test `kubectl rollout undo deployment/<name> -n nomarkup` for each service
- [ ] Document rollback procedure for database migrations (cannot be automated — requires manual `.down.sql`)
- [ ] Verify rollback does not corrupt data (especially for migrations 010-011 auction constraints)

---

## 5. Monitoring & Alerting

### Prometheus + Grafana
- [ ] Deploy Prometheus to monitoring namespace in K8s
- [ ] Deploy Grafana with persistent storage
- [ ] Verify Prometheus scrapes all services via `/metrics` endpoint
- [ ] Import/create Grafana dashboards for:
  - HTTP request rate, latency, error rate (per gateway handler)
  - gRPC request rate, latency, error rate (per service)
  - Bid processing latency (p50/p95/p99 — budget: < 1ms p99)
  - Trust score computation latency (budget: < 5ms p99)
  - Fraud scoring latency (budget: < 50ms p99)
  - Active WebSocket connections (chat + auction)
  - Stripe webhook processing duration
  - PostgreSQL connection pool utilization (PgBouncer)
  - Redis memory and connection count
  - Meilisearch query latency

### Alerting Rules
- [ ] Error rate > 0.1% of requests for any service (sustained 5 min)
- [ ] API p99 latency > 500ms (sustained 5 min)
- [ ] Payment processing failures > 0 (immediate alert)
- [ ] Database connection pool exhaustion (> 90% utilization)
- [ ] Pod restart count > 3 in 10 minutes (crash loop)
- [ ] Disk usage > 80% on any PVC
- [ ] Certificate expiry < 14 days
- [ ] Configure notification channels: PagerDuty for critical, Slack for warnings

### Distributed Tracing
- [ ] Deploy OpenTelemetry Collector to K8s
- [ ] Verify traces flow from gateway through Go services through Rust engines
- [ ] Verify trace ID propagation via `traceparent` header across all service calls
- [ ] Deploy Jaeger or Grafana Tempo for trace visualization

### Error Tracking
- [ ] Verify Sentry receives errors from Next.js frontend (client + server components)
- [ ] Verify Sentry receives errors from all Go services (gateway + 5 microservices)
- [ ] Verify Sentry receives errors from all Rust engines (4 engines)
- [ ] Configure Sentry alert rules: new issue → Slack, spike in errors → PagerDuty

### Uptime Monitoring
- [ ] Set up external uptime monitor (Pingdom, UptimeRobot, or Better Uptime) for:
  - `https://nomarkup.com` (web)
  - `https://nomarkup.com/api/health` (gateway)
  - `https://api.nomarkup.com/health` (gateway direct)
- [ ] Create public status page (statuspage.io or Instatus) at `status.nomarkup.com`

---

## 6. Security

### Endpoint Security
- [ ] Verify CORS production allowlist in `gateway/internal/middleware/cors.go` — only `https://nomarkup.com` and `https://www.nomarkup.com` (no wildcards, per SEC-13)
- [ ] Verify CSP headers in production ingress — no `unsafe-inline`, no `unsafe-eval` (ingress already sets X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy)
- [ ] Verify rate limiting configuration in `gateway/internal/middleware/ratelimit.go` — stricter on auth endpoints (5 attempts/15 min per CLAUDE.md, SEC-10)
- [ ] Verify CSRF protection on all state-changing requests (SEC-11)
- [ ] Verify all endpoints require authentication except those annotated `// @public` (per CLAUDE.md security rules)
- [ ] Verify admin endpoints require `admin` role (via `gateway/internal/middleware/admin.go`)
- [ ] Verify support endpoints require `support` role (via `gateway/internal/middleware/support.go`)
- [ ] Verify ownership middleware prevents cross-user data access (via `gateway/internal/middleware/ownership.go`)
- [ ] Verify idempotency middleware is active on payment mutations (via `gateway/internal/middleware/idempotency.go`)

### Authentication
- [ ] Verify JWT RS256 token validation with production keypair
- [ ] Verify access token expiry is 15 minutes
- [ ] Verify refresh tokens are HTTP-only secure cookies
- [ ] Verify session timeouts: 60 min customer, 120 min provider, 30 min admin (SEC-4)
- [ ] Verify concurrent session limit: 3 devices per account (SEC-4)
- [ ] Verify MFA is required for admin accounts (SEC-2)
- [ ] Verify password hashing uses argon2id (memory=65536, iterations=3, parallelism=4)

### Payment Security
- [ ] Verify Stripe webhook signature enforcement in `gateway/internal/handler/webhook.go` using production `STRIPE_WEBHOOK_SECRET`
- [ ] Verify all price calculations happen server-side (client displays only)
- [ ] Verify idempotency keys on all payment mutations
- [ ] Verify raw card numbers are never stored — Stripe Elements/PaymentIntent only (SEC-9)
- [ ] Verify escrow flow: funds held in Stripe Connect, released only on job completion confirmation

### Data Protection
- [ ] Verify PII encrypted at rest (AES-256-GCM via libsodium, per SEC-5)
- [ ] Verify document storage bucket has no public access, access requires auth + audit logging (SEC-8)
- [ ] Verify file upload MIME type validation is server-side (not trusting Content-Type header)
- [ ] Verify file size limits enforced: 10MB images, 25MB documents
- [ ] Verify proxy body size matches: ingress annotation sets `proxy-body-size: "25m"`

### Vulnerability Scans
- [ ] Run `govulncheck ./...` on all 6 Go modules with zero findings
- [ ] Run `cargo audit` on engines workspace with zero findings
- [ ] Run `npm audit --omit=dev --audit-level=high` on web with zero findings
- [ ] Schedule penetration test (or confirm vendor and date)

---

## 7. Application Verification

### User Registration & Auth
- [ ] Complete registration flow: email/password, Google OAuth, Apple Sign-In
- [ ] Verify email verification via SendGrid template
- [ ] Verify login, logout, token refresh
- [ ] Verify password reset flow
- [ ] Verify role assignment: customer, provider, admin
- [ ] Verify MFA setup and login with TOTP

### Job Posting & Auction (Core Flow)
- [ ] Post a job as customer: title, description, category (from seeded taxonomy), budget range, location (Seattle ZIP), photos
- [ ] Verify auction window opens and countdown works
- [ ] Place bids from multiple provider accounts
- [ ] Verify live auction WebSocket updates (`gateway/internal/handler/auction_ws.go`)
- [ ] Award bid to provider
- [ ] Verify contract creation (FR-14)
- [ ] Complete job: provider marks milestones, customer approves
- [ ] Verify escrow release on completion
- [ ] Submit two-way reviews

### Payments (Live Stripe)
- [ ] Process a real payment with a live card (small amount, refund after)
- [ ] Verify provider Stripe Connect Express onboarding flow
- [ ] Verify escrow hold and release
- [ ] Verify payment failure handling and retry logic
- [ ] Verify refund processing
- [ ] Verify subscription creation for Pro tier (customer and provider)
- [ ] Verify subscription upgrade/downgrade/cancel (FR-12.3)
- [ ] Verify transaction fee deduction from provider payout (FR-12.5-12.6)
- [ ] Verify webhook processing for all subscribed events

### Chat
- [ ] Send messages between customer and provider via WebSocket
- [ ] Verify message persistence (messages survive page reload)
- [ ] Verify offline message delivery (messages queued, delivered on reconnect)
- [ ] Verify off-platform communication detection (SEC-17 — phone numbers, emails blocked)

### Notifications
- [ ] Verify in-app notification bell with unread count (FR-17.1)
- [ ] Verify email delivery for: bid awarded, payment received, dispute opened
- [ ] Verify web push notification opt-in and delivery
- [ ] Verify CAN-SPAM unsubscribe link in all emails (FR-17.6)
- [ ] Verify notification preferences page works (FR-17.3)

### Search & Discovery
- [ ] Verify Meilisearch indexes jobs and providers
- [ ] Verify search returns results with < 50ms latency
- [ ] Verify geo-filtered search by Seattle ZIP codes
- [ ] Verify category filtering works across all seeded categories

### Image Processing
- [ ] Upload profile photo — verify resize and optimization via imaging service
- [ ] Upload job photos — verify processing pipeline
- [ ] Upload identity document — verify stored in private bucket, not publicly accessible

### Admin Panel
- [ ] Verify admin login requires MFA
- [ ] Verify user management: search, view, edit, suspend, ban (FR-13.1)
- [ ] Verify job management: view all, filter, force-close (FR-13.1)
- [ ] Verify fraud review queue: flagged signals, drill-into-user, approve/dismiss (FR-13.1)
- [ ] Verify dispute resolution queue (FR-13.1)
- [ ] Verify verification queue: approve/reject documents with reason (FR-13.1)
- [ ] Verify subscription/fee configuration panel (FR-13.4)
- [ ] Verify feature flag toggles work (per `013_feature_flags` migration)
- [ ] Verify audit log captures all admin actions (FR-13.6)

### Performance
- [ ] Verify LCP < 2.5s on key pages (landing, job browse, job detail)
- [ ] Verify API p95 < 200ms for reads, < 500ms for writes (NFR-3)
- [ ] Verify WebSocket message delivery < 500ms (NFR-4)
- [ ] Verify bidding engine processes bids in < 1ms p99
- [ ] Load test: simulate 100 concurrent users across registration, job posting, bidding, chat
- [ ] Load test: simulate 1,000 concurrent WebSocket connections (chat + auction)

---

## 8. Legal & Business

### Business Formation
- [ ] Register business entity (LLC or Corp)
- [ ] Obtain business license for Washington State
- [ ] Set up business bank account
- [ ] Obtain EIN

### Legal Documents
- [ ] Terms of Service finalized and published at `nomarkup.com/terms`
- [ ] Privacy Policy finalized and published at `nomarkup.com/privacy` (must cover CCPA, SEC-18)
- [ ] Cookie consent banner implemented (if using non-essential cookies)
- [ ] Data retention policy documented (SEC-21 — chat transcripts, transaction records, fraud logs)
- [ ] CCPA compliance: data export and deletion request flow functional
- [ ] PCI DSS SAQ-A or SAQ-A-EP completed and documented (SEC-20)

### Stripe Platform
- [ ] Stripe Connect platform agreement signed
- [ ] Stripe Express account terms reviewed with legal
- [ ] Payment dispute/chargeback handling process documented
- [ ] Refund policy documented and published

### Insurance
- [ ] General liability insurance
- [ ] Errors and omissions (E&O) insurance
- [ ] Cyber liability insurance

### Monetization Decisions (PRD Open Questions #5-8)
- [ ] **Decide:** Subscription pricing for Pro tier (customer and provider)
- [ ] **Decide:** Transaction fee percentage (5-10% range per FR-12.5)
- [ ] **Decide:** Primary monetization model for launch (subscription, transaction fee, or hybrid)
- [ ] **Decide:** Free tier limits (active jobs for customers, bids per month for providers)
- [ ] Configure decided values in admin panel (FR-13.4)

---

## 9. Pre-Launch: Supply-Side Bootstrapping (PRD Phase 1.5)

This is the single most critical pre-launch activity. A marketplace with zero providers has zero value.

### Provider Recruitment
- [ ] Onboard minimum **25 verified providers** across at least **5 service categories** (PRD Phase 1.5)
- [ ] Priority categories for Seattle: General Handyman, Cleaning, Landscaping, Plumbing, Electrical
- [ ] Achieve minimum **3 providers per category** before inviting customers for that category (PRD Phase 2 liquidity target)
- [ ] Categories with < 3 providers are hidden from customer browse until supply is sufficient

### Sourcing Channels
- [ ] Contact Seattle-area trade associations
- [ ] Post in Seattle contractor Facebook groups
- [ ] Outreach via Nextdoor recommendations
- [ ] Direct outreach to independent contractors
- [ ] Partner with local trade schools

### Incentives
- [ ] Configure Pro tier free for 6 months for first 50 providers (launch incentive per PRD)
- [ ] Create provider onboarding materials (how to set up profile, how bidding works, payout schedule)

### Market Data
- [ ] Seed analytics engine with market pricing data for Seattle metro (per FR-11.5)
- [ ] Ensure market range bar has data for all 5 priority categories from day one
- [ ] Source data from BLS, manufacturer MSRPs, or licensed datasets (Open Question #10 — avoid scraping competitors)

---

## 10. Pre-Launch: Internal Alpha (PRD Phase 1)

### Team Testing
- [ ] Deploy to staging environment with production-like data
- [ ] Internal team tests all flows end-to-end: registration, job posting, bidding, chat, payment, reviews
- [ ] Set verification toggle OFF (demo mode, FR-13.2)
- [ ] Set analytics toggle to internal-only (Shift+~ per PRD Phase 1)
- [ ] Seed staging with realistic test data: fake jobs, providers, reviews
- [ ] Verify analytics pipeline processes seeded data correctly

### Operations Readiness
- [ ] Create admin account for operations team
- [ ] Set up support email: `support@nomarkup.com`
- [ ] Set up support ticketing system (Zendesk, Intercom, or similar)
- [ ] Train at least 1 support agent on the platform (PRD Phase 2 requirement)
- [ ] Document dispute resolution workflow for support staff
- [ ] Document verification review workflow for admin team
- [ ] Document escalation procedures

---

## 11. Launch Day

### Deployment
- [ ] Tag release (`v1.0.0`) to trigger deploy pipeline
- [ ] Verify all 11 container images build and push to registry
- [ ] Run migrations on production database (verify migration version matches expected: 018)
- [ ] Apply production kustomize overlay: `kubectl apply -k deploy/k8s/overlays/production`
- [ ] Verify all pods are running: `kubectl get pods -n nomarkup`
- [ ] Verify all deployments hit target replica count (gateway: 3, everything else: 2)

### Smoke Tests
- [ ] `curl -f https://nomarkup.com` returns 200 (web)
- [ ] `curl -f https://nomarkup.com/api/health` returns 200 (gateway)
- [ ] Open web app in browser, verify pages render
- [ ] Log in as admin, verify dashboard loads
- [ ] Log in as test provider, verify profile page loads
- [ ] Post a test job, verify it appears in browse

### Monitoring Verification
- [ ] Verify all health checks passing in K8s
- [ ] Verify Grafana dashboards showing live data
- [ ] Verify Sentry is receiving events (trigger a test error)
- [ ] Verify external uptime monitor reports UP
- [ ] Verify Prometheus scraping all services

### First Real Transaction
- [ ] Create a real customer account
- [ ] Post a real job in a seeded category
- [ ] Have a real provider bid on the job
- [ ] Award bid, create contract
- [ ] Process real payment through Stripe (live mode)
- [ ] Verify payment lands in provider's Connect account
- [ ] Verify platform fee deducted correctly

### Go Live
- [ ] Enable external monitoring and status page
- [ ] Monitor error rates for first hour — target: < 0.1%
- [ ] Monitor payment processing — target: zero failures
- [ ] Monitor WebSocket stability — target: no unexpected disconnects
- [ ] Announce launch via planned channels

---

## 12. Post-Launch: First 48 Hours

### Active Monitoring
- [ ] Engineer on-call for first 48 hours with PagerDuty alerts enabled
- [ ] Monitor Sentry every 2 hours for new error types
- [ ] Monitor Grafana dashboards for latency anomalies
- [ ] Monitor PostgreSQL connection pool utilization
- [ ] Monitor Redis memory usage
- [ ] Monitor disk usage on PVCs

### Verification
- [ ] Verify first real user registrations complete successfully
- [ ] Verify first real transactions process and settle correctly
- [ ] Verify provider payouts arrive in Connect accounts
- [ ] Verify email notifications delivering (check SendGrid delivery logs)
- [ ] Verify search returns results for real user queries
- [ ] Verify automated database backup ran successfully (check backup logs)

### Support
- [ ] Review all support tickets — resolve within SLA
- [ ] Monitor fraud detection system output — tune thresholds if needed
- [ ] Monitor verification queue — process pending documents within 24 hours
- [ ] Document any issues encountered and fixes applied

### Metrics Baseline
- [ ] Record baseline for North Star KPIs (PRD Section 17):
  - Liquidity: % of jobs receiving >= 1 bid within 24 hours (target: > 80%)
  - Time to first bid (target: < 4 hours)
  - Bids per job (target: 3-7)
  - Zero-bid rate (target: < 10%)
- [ ] Verify business metrics dashboard shows real-time data (NFR-21)

---

## 13. Known Gaps to Address Before Launch

These items are identified from the current codebase state and must be resolved:

### Deploy Pipeline
- [ ] **CRITICAL:** `deploy.yml` is a placeholder that only prints instructions — must be replaced with actual CI/CD steps before any deployment (see Section 4)

### Open PRD Questions That Block Launch
- [ ] **#1:** Cloud provider decision (AWS vs GCP) — blocks all infrastructure provisioning
- [ ] **#5-8:** Monetization decisions (subscription pricing, transaction fee %, primary model, free tier limits) — blocks subscription launch
- [ ] **#10:** Market pricing data source — blocks analytics accuracy at launch
- [ ] **#11:** SMS/OTP provider decision (Twilio vs AWS SNS) — blocks phone verification if required

### Notification Service
- [ ] Verify SMS delivery channel if phone verification is required (depends on Open Question #11)
- [ ] Verify push notification delivery via web push (FR-17.1)
- [ ] Verify email digest batching logic (FR-17.4)

---

## Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Engineering Lead | | | |
| Product Owner | | | |
| Security | | | |
| Operations | | | |
| Legal | | | |
