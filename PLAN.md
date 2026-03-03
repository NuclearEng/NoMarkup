# NoMarkup — Post-Scaffold Implementation Plan

> All 16 vertical slices are architecturally complete (~96K lines).
> This plan covers stabilization, gap-filling, and launch readiness.

---

## Phase 1: Testing & Confidence (Priority: Critical)

Zero tests exist today. Goal: 80% coverage on business logic, integration tests on all gRPC boundaries, E2E on critical user flows.

### 1.1 Frontend Unit Tests (Vitest + React Testing Library)
- [ ] Test all Zod validation schemas (validations.ts)
- [ ] Test utility functions (formatCents, cn, date helpers)
- [ ] Test Zustand stores (auth-store, chat-store)
- [ ] Test custom hooks with renderHook (useJobs, useBids, useAuth, useSubscription, useAnalytics, useAdmin)
- [ ] Test form components (job posting, bid placement, payment, profile, registration, login)
- [ ] Test data-display components in loading/success/error/empty states

### 1.2 Frontend E2E Tests (Playwright)
- [ ] Auth flow: register → verify email → login → logout
- [ ] Job flow: create job → publish → view listing
- [ ] Bid flow: browse jobs → place bid → view my bids
- [ ] Contract flow: accept bid → start work → mark complete → approve
- [ ] Payment flow: add payment method → process payment
- [ ] Chat flow: open channel → send message → receive message
- [ ] Admin flow: login as admin → view dashboard → suspend user

### 1.3 Go Backend Unit Tests
- [ ] Gateway middleware tests (auth JWT parsing, rate limiting, CORS, admin role check)
- [ ] Gateway handler tests (httptest for request/response validation)
- [ ] User service: registration, login, profile CRUD, role management
- [ ] Job service: job lifecycle (draft → open → bidding → awarded → completed → cancelled)
- [ ] Payment service: fee calculation, escrow state machine, refund logic
- [ ] Payment service: subscription tier management, usage checks
- [ ] Chat service: channel creation, message persistence
- [ ] Notification service: dispatcher routing, preference filtering

### 1.4 Go Backend Integration Tests
- [ ] User service + PostgreSQL (testcontainers): full CRUD with real DB
- [ ] Job service + PostgreSQL: job lifecycle with constraints
- [ ] Payment service + PostgreSQL: payment state transitions
- [ ] Gateway → gRPC service integration (bufconn)

### 1.5 Rust Engine Tests
- [ ] Bidding engine: sealed-bid validation, auction timing, concurrent bid safety
- [ ] Bidding engine: proptest for numerical invariants
- [ ] Trust engine: score computation, dimension weighting, boundary conditions
- [ ] Trust engine: proptest (arbitrary inputs → output always 0..=100)
- [ ] Fraud engine: fingerprint analysis, risk scoring
- [ ] Imaging engine: resize, format conversion, pipeline correctness
- [ ] Criterion benchmarks: bid processing <1ms p99, trust scoring <5ms p99

---

## Phase 2: WebSocket & Real-Time (Priority: Critical)

Chat and live notifications are broken — gateway returns 501.

### 2.1 Chat Service WebSocket Implementation
- [ ] Implement WebSocket upgrade handler (nhooyr.io/websocket or gorilla/websocket)
- [ ] Connection registry: track active connections by user ID
- [ ] Authentication: validate JWT from query param or first message
- [ ] Message broadcasting: deliver to all channel participants
- [ ] Presence tracking: online/offline status, typing indicators
- [ ] Reconnection handling: message replay from last seen ID
- [ ] Heartbeat/ping-pong for connection health

### 2.2 Gateway WebSocket Proxy
- [ ] Replace WebSocket stub with actual proxy to chat service
- [ ] Auth token extraction from query params
- [ ] Connection upgrade handling in Chi router

### 2.3 Frontend WebSocket Client
- [ ] WebSocket connection manager with auto-reconnect
- [ ] Message queue for offline/reconnecting state
- [ ] Integration with chat-store (Zustand)
- [ ] Live typing indicators
- [ ] Unread count real-time updates

### 2.4 Live Notification Delivery
- [ ] WebSocket channel for notification push
- [ ] Real-time bid update notifications
- [ ] Contract status change notifications
- [ ] Payment confirmation notifications

---

## Phase 3: Containerization & Local Stack (Priority: High)

Can't run the full system or do integration testing without this.

### 3.1 Service Dockerfiles
- [ ] gateway/Dockerfile — multi-stage Go build (alpine)
- [ ] services/user/Dockerfile — multi-stage Go build
- [ ] services/job/Dockerfile — multi-stage Go build
- [ ] services/payment/Dockerfile — multi-stage Go build
- [ ] services/chat/Dockerfile — multi-stage Go build
- [ ] services/notification/Dockerfile — multi-stage Go build
- [ ] engines/bidding/Dockerfile — multi-stage Rust build (bookworm-slim)
- [ ] engines/fraud/Dockerfile — multi-stage Rust build
- [ ] engines/trust/Dockerfile — multi-stage Rust build
- [ ] engines/imaging/Dockerfile — multi-stage Rust build
- [ ] web/Dockerfile — multi-stage Next.js build (standalone output)

### 3.2 Docker Compose — Full Stack
- [ ] Add all Go services to docker-compose.yml with healthchecks
- [ ] Add all Rust engines to docker-compose.yml
- [ ] Add web frontend container
- [ ] Add gateway container
- [ ] Service dependency ordering (depends_on with healthchecks)
- [ ] Shared network configuration
- [ ] Volume mounts for development hot-reload

### 3.3 Local Development Scripts
- [ ] `make dev` — start infrastructure + all services
- [ ] `make dev-web` — start infrastructure + gateway + web only
- [ ] `make seed` — run migrations + seed data
- [ ] Database initialization script (create extensions, run migrations)
- [ ] MinIO bucket initialization on startup

---

## Phase 4: Notification Dispatchers (Priority: High)

Email/push/SMS are log-only stubs. Email verification, bid alerts, payment receipts don't work.

### 4.1 Email Integration
- [ ] SendGrid or AWS SES integration in notification service
- [ ] Email templates: verification, bid alert, payment receipt, contract update
- [ ] HTML email rendering with Go templates
- [ ] Unsubscribe link handling

### 4.2 Push Notifications
- [ ] Firebase Cloud Messaging integration
- [ ] Device token registration endpoint
- [ ] Push notification payloads for bid/contract/payment events

### 4.3 SMS Notifications
- [ ] Twilio integration for critical alerts
- [ ] Phone number verification flow
- [ ] SMS templates for time-sensitive events (bid expiring, payment due)

---

## Phase 5: Payment Flow Completion (Priority: High)

Stripe calls are dev-mode stubs. Real payment processing doesn't work.

### 5.1 Stripe Connect Flow
- [ ] Provider onboarding: real Stripe Connect Express account creation
- [ ] Onboarding link generation and redirect handling
- [ ] Account status polling and webhook updates
- [ ] Dashboard link generation for providers

### 5.2 Payment Processing
- [ ] PaymentIntent creation with real Stripe calls
- [ ] Manual capture for escrow (hold → capture on job completion)
- [ ] Transfer to provider Connect account on approval
- [ ] Refund processing (full and partial)
- [ ] Fee calculation enforcement (platform fee deduction)

### 5.3 Subscription Billing
- [ ] Real Stripe subscription creation
- [ ] Tier upgrade/downgrade with proration
- [ ] Invoice generation and PDF access
- [ ] Webhook handling for subscription lifecycle events

### 5.4 Webhook Hardening
- [ ] Stripe webhook signature verification tests
- [ ] Idempotent webhook processing (deduplication)
- [ ] Retry handling for failed webhook deliveries
- [ ] Event type routing for all payment/subscription events

---

## Phase 6: Fraud & Trust Completion (Priority: Medium)

Scaffolding exists but behavioral scoring doesn't actually score anything.

### 6.1 Fraud Detection
- [ ] Implement behavioral scoring module (not just scaffolding)
- [ ] Browser fingerprint analysis with real heuristics
- [ ] IP geolocation cross-referencing
- [ ] Bid pattern anomaly detection (shill bidding, bid rotation)
- [ ] Risk score thresholds and auto-flagging
- [ ] ONNX model loading and inference integration

### 6.2 Trust Score Refinement
- [ ] Wire review aggregation into trust score inputs
- [ ] Implement time-decay weighting for older reviews
- [ ] Volume dimension: job completion rate, response time
- [ ] Risk dimension: dispute history, cancellation rate
- [ ] Score recalculation triggers on relevant events

---

## Phase 7: Admin Enforcement (Priority: Medium)

Admin UI exists but actions don't enforce anything.

### 7.1 User Management Enforcement
- [ ] User suspension: revoke active JWTs, block new logins
- [ ] User ban: permanent suspension + data retention policy
- [ ] Suspension notification to affected user
- [ ] Audit log for all admin actions

### 7.2 Dispute Resolution
- [ ] Dispute workflow: open → under review → resolved
- [ ] Resolution actions: refund, partial refund, release payment, no action
- [ ] Automatic payment adjustment on resolution
- [ ] Notification to both parties on resolution

### 7.3 Content Moderation
- [ ] Job removal: delist + notify poster with reason
- [ ] Review removal: remove from public display + recalculate ratings
- [ ] Flag resolution: dismiss or action

---

## Phase 8: Image Pipeline Integration (Priority: Medium)

Rust engine exists but isn't connected through the gateway.

### 8.1 Upload Flow
- [ ] Presigned URL generation for direct-to-S3 upload
- [ ] Upload confirmation and processing trigger
- [ ] Image validation (MIME type, dimensions, file size)

### 8.2 Processing Pipeline
- [ ] Gateway handlers for image upload/process endpoints
- [ ] Resize variants: thumbnail (150px), medium (600px), large (1200px)
- [ ] Format optimization: WebP/AVIF conversion
- [ ] Metadata stripping (EXIF removal for privacy)

### 8.3 CDN Integration
- [ ] Serve processed images through CDN URLs
- [ ] Cache invalidation on re-upload
- [ ] Lazy processing for on-demand variants

---

## Phase 9: Deployment & Production Readiness (Priority: Medium)

### 9.1 Kubernetes Manifests
- [ ] Deployment manifests for each service
- [ ] Service and Ingress definitions
- [ ] ConfigMaps and Secrets
- [ ] Horizontal Pod Autoscaler for gateway and bidding engine
- [ ] PersistentVolumeClaims for database and MinIO

### 9.2 CI/CD Pipeline Enhancement
- [ ] Add test execution to CI (unit + integration)
- [ ] Add E2E test execution with Playwright
- [ ] Code coverage reporting and thresholds
- [ ] Container image building and registry push
- [ ] Staging deployment on PR merge
- [ ] Production deployment on release tag

### 9.3 Monitoring & Observability
- [ ] Prometheus metrics endpoints on all services
- [ ] Grafana dashboards (request rates, latency, error rates)
- [ ] Sentry integration for error tracking (frontend + backend)
- [ ] OpenTelemetry distributed tracing across services
- [ ] Alerting rules for SLA breaches

### 9.4 Security Hardening
- [ ] Rate limiting with Redis (replace stub)
- [ ] CSP headers configuration
- [ ] CORS production allowlist
- [ ] Secrets rotation procedure
- [ ] Dependency vulnerability scanning (dependabot/renovate)

---

## Phase 10: Performance & Load Testing (Priority: Low)

### 10.1 Load Tests (k6)
- [ ] Concurrent job posting (target: 1000 req/s)
- [ ] Concurrent bidding (target: 5000 bids/s)
- [ ] WebSocket connections (target: 10K concurrent)
- [ ] Search queries under load (target: sub-50ms p99)

### 10.2 Optimization
- [ ] Database query optimization (EXPLAIN ANALYZE on slow queries)
- [ ] Connection pooling tuning (pgx pool sizes)
- [ ] Redis caching for hot paths (trust scores, category tree)
- [ ] Frontend bundle optimization (code splitting, lazy loading)
