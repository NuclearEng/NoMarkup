# NoMarkup — TODO Tracker

> Last updated: 2026-03-28 (post-CEO review — EXPANSION mode)
> Priority: P0 = do next, P1 = launch-blocking, P2 = post-launch, P3 = nice-to-have
> Status: Done, In Progress, Not Started
> Phase: 1 = Foundation (Week 1-2), 2 = Expansion (Week 3-5), 3 = Hardening (Week 6-7), 4 = Launch Prep (Week 8)

---

## P0 — Foundation (Must Complete Before Anything Else)

### Not Started — 1. Start the full local stack (Phase 1)
```bash
docker compose up -d          # Postgres, Redis, Meilisearch, MinIO, Jaeger, PgBouncer
make migrate-up               # Run all 12 migrations
make seed                     # Insert test users, jobs, bids, contracts
cd gateway && go run ./cmd/server   # Start API gateway on :8080
# Start each Go service (user, job, payment, chat, notification)
# Start each Rust engine (bidding, fraud, trust, imaging)
cd web && npm run dev          # Frontend on :3000
```
- **Test credentials:** `customer@nomarkup.com` / `Password123!`, `provider@nomarkup.com` / `Password123!`, `admin@nomarkup.com` / `Password123!`
- **Verify:** Login -> dashboard loads -> jobs listing shows seed data -> place a bid
- **Effort:** 1 day
- **Depends on:** Nothing

### Not Started �� 2. Fix all 14 critical error paths from audit (Phase 1)
Discovered in 2026-03-28 CEO review. All fail silently with zero test coverage.
- **JSON decode helper:** Create `decodeJSON[T](w, r, *T) bool` in `gateway/internal/handler/response.go`. Fix 6 handlers: `job.go:283`, `payment.go:37,258,433`, `subscription.go:145`, `contract.go:335`
- **Chat access control:** Fail closed when bid checker errors (`services/chat/internal/service/service.go:52-58`). Return `ErrServiceUnavailable`, don't allow access.
- **Token revocation blocking:** Return error if `RevokeAllUserTokens` fails in `services/user/internal/service/admin.go:28,49`. Don't proceed with suspension/ban.
- **Search indexing retry queue:** On Meilisearch failure in `services/job/internal/service/job.go:58,100,114,128,143`, push job ID to Redis retry queue. Background goroutine retries every 30s. Alert after 3 failures.
- **Email template HTML escaping:** Switch from `text/template` to `html/template` in `services/notification/internal/service/email.go:127`.
- **SMS dev mode warning:** Change `slog.Info` to `slog.Warn` in `services/notification/internal/service/sms.go:39`. Add `X-Dev-Mode: true` response header.
- **Fraud engine unwrap fix:** Replace `unwrap()` with pattern match in `engines/fraud/src/engine.rs:1499`.
- **Stripe production guard:** In `services/payment/cmd/server/main.go`, if `STRIPE_SECRET_KEY` is empty and `APP_ENV != "development"`, `log.Fatal` and exit.
- **Effort:** 1-2 days
- **Depends on:** Nothing (can run in parallel with #1)

### Not Started — 3. Build ownership middleware for IDOR prevention (Phase 1)
- Gateway middleware that resolves resource->owner from DB and compares with JWT user_id
- Applied per-route via Chi middleware chain
- **Handlers affected:** `GetJob`, `GetContract`, `UpdateContract`, `CancelContract`, `GetDispute`, `UpdateDispute`
- **Pattern:** Middleware extracts resource ID from URL, queries ownership table, compares with JWT claim
- **Effort:** 2-3 days
- **Priority:** P0 (OWASP Top 10 IDOR vulnerability)
- **Depends on:** Nothing

### Not Started — 4. Add PgBouncer to infrastructure stack (Phase 1)
- Add PgBouncer as Docker Compose service between all Go/Rust services and PostgreSQL
- Transaction pooling mode, `pool_size=100`, `max_client_conn=500`
- Update all service `DATABASE_URL` env vars to point to `pgbouncer:6432`
- **Why:** 4 Rust engines x 20 connections + 5 Go services = 80+ connections against default 100 limit
- **Effort:** Half day
- **Depends on:** Nothing

### Not Started — 5. Build admin feature flag system (Phase 1)
- New `feature_flags` DB table + migration 013: key (unique), enabled (bool), description, updated_at
- Admin API: `GET /api/v1/admin/flags`, `PUT /api/v1/admin/flags/{key}` — extend `admin_platform.go`
- Frontend flag provider: reads flags at app init, gates expansion features
- Kill-switch for: Fair Price Index, spectator mode, guarantee, matching, Provider Business OS
- **Effort:** 1 day
- **Depends on:** Admin panel working
- **Replaces:** P3 #12 (localStorage toggle) — promoted to P0

### Not Started — 6. Wire email verification — SendGrid (Phase 1)
- **Account setup:** Create SendGrid account -> get API key -> create verification email template
- **Env vars:** Set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_VERIFICATION_TEMPLATE_ID` in `.env.local`
- **Code changes needed:**
  - `services/user/internal/grpc/server.go:64` — Replace TODO with SendGrid API call
  - `services/user/internal/service/auth.go` — Add `if !user.EmailVerified` check in `Login()`
  - `gateway/internal/handler/auth.go` — Map `ErrEmailNotVerified` to 403
  - Add `POST /api/v1/auth/resend-verification` endpoint
- **Effort:** 2-3 days
- **Depends on:** SendGrid account

### Not Started — 7. Wire Sentry error tracking (Phase 1)
- **Account setup:** Create Sentry project (Next.js + Go) -> get DSN
- **Env vars:** Set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` in `.env.local`
- **Code changes:** Frontend (@sentry/nextjs), Go services (sentry-go), Rust engines (sentry crate)
- **Effort:** 1-2 days
- **Depends on:** Sentry account

### Not Started — 8. Build Playwright E2E test suite (Phase 1-2)
- 12 critical user flows:
  1. Registration -> email verify -> login
  2. Job creation -> publish -> appears in search
  3. Standard auction -> bid -> award -> contract
  4. Live auction -> real-time bids -> snipe extension -> winner
  5. Contract -> milestones -> payment -> completion
  6. Chat -> message delivery -> channel access control
  7. Provider onboarding -> profile -> search visibility
  8. Review -> trust score update -> tier change
  9. Admin panel -> user management -> suspension
  10. Provider Business OS -> expenses -> working capital
  11. Notification -> preferences -> delivery
  12. Fair Price Index -> public pricing -> SEO page
- **Config:** `web/playwright.config.ts` (exists), `web/tests/e2e/` (currently empty)
- **Effort:** 5-7 days
- **Depends on:** Full stack running (#1)

### Not Started — 9. Fix migrations 007/008 — missing updated_at triggers (Phase 1)
- `working_capital_advances` table (migration 007) — missing `trigger_set_updated_at`
- `provider_expenses` table (migration 008) — missing `trigger_set_updated_at`
- Safe to modify directly since migrations have never been deployed to production
- **Effort:** 15 minutes
- **Depends on:** Nothing

---

## P1 — Launch-Blocking Features

### Done — 10. Live Auction Arena
- **Status:** Complete (commit `35ecfd0`)
- Dual-mode auctions, real-time price drop chart, anti-snipe extensions, WebSocket streaming, savings tracker, provider rankings

### Done — 11. Observability Stack (Partial)
- **Status:** OTel tracing done, Grafana dashboards done, Prometheus metrics done
- **Remaining:** Sentry integration (see P0 #7 above)

### Done — 12. Email Verification (Backend)
- **Status:** Token generation + validation complete
- **Remaining:** SendGrid wiring (see P0 #6 above)

### Not Started — 13. Build expense + working capital backend (Phase 2)
- Implement real expense CRUD and working capital advance logic in the **Payment service** (not a new service)
- Wire gateway handlers (`expense.go`, `working_capital.go`) to gRPC calls instead of returning mock data
- Extend payment proto with expense + advance message types
- Add repository methods + service logic in `services/payment/internal/`
- **Why:** These feature surfaces are 100% stub — returning mock data to real users
- **Effort:** 3-5 days
- **Depends on:** Payment service running, PgBouncer (#4)

### Not Started — 14. Implement savings + streaks backend queries (Phase 2)
- `gateway/internal/handler/user.go:124` — Replace TODO with real savings query via user service gRPC
- `gateway/internal/handler/provider.go:292` — Replace TODO with real streaks query via user service gRPC
- **Effort:** 1 day
- **Depends on:** User service running

### Not Started — 15. Build Fair Price Index — public pricing tool (Phase 2)
- PostgreSQL materialized view aggregating completed auction data by category + ZIP code
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` on hourly schedule
- Public API endpoint: `GET /api/v1/pricing/{category}?zip={zip}` — extend analytics handler
- SEO-friendly landing page: "What does X cost in your area?"
- **Why:** Growth engine. Every homeowner googling service pricing lands on NoMarkup.
- **Effort:** 3-5 days
- **Depends on:** Auction data (seed data or real auctions)

### Not Started — 16. Build spectator mode for live auctions (Phase 2)
- Public WebSocket endpoint: `/ws/auction/{id}/spectate`
- Anonymous access with rate limiting: 5 connections/IP, 500 total spectators/auction
- 3-second data delay for spectators (prevent competitive advantage)
- **Why:** Viral growth. "Watch this auction" links on social media. FOMO-driven acquisition.
- **Effort:** 2-3 days
- **Depends on:** Live Auction Arena (done)

### Not Started — 17. Build NoMarkup Guarantee claims flow (Phase 2)
- Customer submits claim with photo evidence against completed contract
- Admin review queue: evidence, chat history, contract terms
- If valid: platform pays for fix from escrow/insurance pool via Stripe
- **Why:** Breaks the cold-start problem. Customers trust the platform, not the individual provider.
- **Effort:** 5-7 days
- **Depends on:** Payment service, contract service, admin panel

### Not Started — 18. Gateway payment idempotency keys (Phase 3)
- Require `Idempotency-Key` header on all payment POST/PUT routes
- Pass key to Stripe API
- Store in Redis with 24h TTL for server-side dedup
- **Why:** CLAUDE.md mandates this. Prevents double-charge on retry/double-click.
- **Effort:** 2 hours
- **Depends on:** Redis running

### Not Started — 19. Wire OAuth providers — Google + Apple (Phase 3)
- **Account setup:**
  - Google: Cloud Console -> OAuth 2.0 -> client ID/secret
  - Apple: Developer -> "Sign in with Apple" -> Services ID
- **Code changes:** Gateway OAuth handler, user service `FindOrCreateByOAuth`, frontend OAuth buttons
- **Effort:** 3-5 days
- **Depends on:** Google Cloud + Apple Developer accounts

### Not Started — 20. Add MFA setup page (Phase 3)
- TOTP library: `github.com/pquerna/otp`
- User service: `EnableMFA()`, `VerifyMFA()` RPCs
- Gateway: `/api/v1/users/me/mfa/{enable,verify,disable}`
- Frontend: QR code display, code verification, backup codes grid, MFA step in login
- Database: Add `mfa_secret` and `mfa_backup_codes` columns (new migration)
- **Effort:** 3-5 days
- **Depends on:** Nothing (self-contained)

---

## P2 — Post-Launch High-Value

### Not Started — 21. Smart pre-matching engine
- When a customer posts a job, auto-identify and notify top 3-5 providers
- Match on: category, geo proximity, trust score, win rate, availability
- **Why:** Reduces time-to-first-bid from hours to minutes. Makes the platform feel intelligent.
- **Effort:** 3-5 days
- **Depends on:** Trust scores computed, notification service wired

### Not Started — 22. Auction Replay System
- Record bid timeline for completed live auctions
- Generate animated replay showing price evolution
- Shareable as GIF/video for social media
- **Depends on:** Live Auction Arena (done)
- **Effort:** 1 week

### Not Started — 23. Provider Challenges & Seasonal Events
- Time-limited competitions with progress tracking
- Reward distribution (priority placement, badges)
- **Depends on:** Provider rankings (done)
- **Effort:** 2-3 weeks

### Not Started — 24. Secrets Rotation Procedure
- Document + automate rotation for JWT keys, Stripe keys, DB credentials
- **Effort:** S

### Not Started — 25. Dependency Vulnerability Scanning
- Enable Dependabot or Renovate for automated security updates
- **Effort:** S

### Not Started — 26. Database Query Optimization
- EXPLAIN ANALYZE on slow queries, add composite indexes for provider search
- Add `idx_auction_bid_events_created_at` for spectator "most active" queries
- **Effort:** M

---

## Vision — Delight Opportunities

These are small (<1 hour) polish items that make users think "oh nice, they thought of that."

### Not Started — V1. "You saved $X" celebration moment
- Confetti animation + large savings number after auction win
- Like Robinhood's confetti on first trade
- **Effort:** 30 min

### Not Started — V2. Smart bid suggestion for providers
- "Similar jobs in this area typically close at $X-$Y" hint on bid form
- Uses Fair Price Index materialized view
- **Depends on:** Fair Price Index (#15)
- **Effort:** 20 min

### Not Started — V3. Provider response time badge
- "Usually responds in <1 hour" on provider profile cards
- Calculated from chat message response timestamps
- **Effort:** 30 min

### Not Started — V4. "Share your savings" social card
- OG-image-ready card: "I saved $X,XXX on NoMarkup for my [service]"
- One-click share to social media
- **Effort:** 30 min

### Not Started — V5. Neighborhood price heat map
- Mapbox heatmap layer on Fair Price Index page
- Color-coded pricing by area, zoomable
- **Depends on:** Fair Price Index (#15)
- **Effort:** 1 hour

---

## Completion Summary

| Priority | Total | Done | Remaining |
|----------|-------|------|-----------|
| P0 (foundation) | 9 | 0 | 9 |
| P1 (launch-blocking) | 11 | 3 | 8 |
| P2 (post-launch) | 6 | 0 | 6 |
| Vision (delight) | 5 | 0 | 5 |

**Estimated timeline:** 8 weeks (EXPANSION mode)
- Phase 1 (Week 1-2): P0 items #1-9
- Phase 2 (Week 3-5): P1 items #13-17
- Phase 3 (Week 6-7): P1 items #18-20, hardening
- Phase 4 (Week 8): Launch prep, feature flag rollout, go/no-go

**Next action:** Run parallel tracks — infra bring-up (#1 + #4) alongside critical error fixes (#2). Then ownership middleware (#3) and feature flags (#5).
