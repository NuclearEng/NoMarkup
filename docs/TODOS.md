# NoMarkup — TODO Tracker

> Last updated: 2026-08-12 (founder-secrets-check: machine-check only — residuals stay Founder-Action)
> Priority: P0 = do next, P1 = launch-blocking, P2 = post-launch, P3 = nice-to-have
> Status: Done, In Progress, Not Started, Founder-Action
> Phase: 1 = Foundation (Week 1-2), 2 = Expansion (Week 3-5), 3 = Hardening (Week 6-7), 4 = Launch Prep (Week 8)
>
> **Status sweep 2026-04-25:** statuses below were re-audited against actual repo state; many "Not Started" items were already shipped before this audit and are now correctly marked Done. Items that genuinely require external resources (Stripe webhook secret in prod, SendGrid API key, Sentry DSN, git history rewrite) are now labelled `Founder-Action` to distinguish them from undone engineering work.

---

## P0 — Security Audit Follow-Ups (from 2026-04-23 branch — DO BEFORE DEPLOY)

### Done (code) / Founder-Action (rotation) — S1. Rotate every credential that used `Password123!`
The file `qa/scripts/qa-creds.env` containing `QA_PASSWORD=Password123!` was untracked on branch `fix/security-audit-2026-04-23`, but the password is permanent in git history and accessible to anyone with repo read access via `git log -p`.
- **Code (Done, commit `68d5cbf`):** `database/cmd/seed/main.go` now reads `SEED_PASSWORD` from env (or generates a one-shot random and prints it). No real credential is committed. The dev-credentials log line + this doc updated to match. New dev environments will never use `Password123!` again.
- **Founder-Action (still required):** identify every existing staging/QA/dev account that currently uses `Password123!` (the four seeded emails — `admin@`, `customer@`, `provider@`, `provider2@nomarkup.com` — plus any `qa@*` accounts) and reset each in your secrets manager. After rotation, re-seed with `make seed` using a new `SEED_PASSWORD`.
- **Do NOT attempt `git filter-repo` on a repo that has been cloned** — tracked separately in S7.
- **Effort remaining:** 1 hour for the rotation sweep
- **Priority:** P0 (blast radius: anyone with prior repo access)

### Done — S2. Set new required env vars in every deploy target
Wired in commit `68d5cbf`: staging + production overlays declare `ENVIRONMENT`, `JWT_ISSUER`, `JWT_AUDIENCE`, `WS_ALLOWED_ORIGINS`, `TRUSTED_PROXIES`, and `APPLE_CLIENT_ID` in their ConfigMap. **OPS-08 (2026-07-27):** neither staging nor production carries a `GOOGLE_CLIENT_ID` / `SET_ME_*` ConfigMap literal — provision `GOOGLE_CLIENT_ID` (+ confidential `GOOGLE_CLIENT_SECRET`) into `nomarkup-secrets` per environment (see `deploy/k8s/SECRETS.md`). Image tags in production are fail-closed `require-ci-stamp` until deploy.yml stamps CI-built GHCR tags.

#### (original spec preserved below)
The audit fixes made several env vars mandatory (services refuse to start without them). Deploy WILL fail if these aren't set in Vault / K8s secrets / CI before merging the audit branch.
- `ENVIRONMENT` — one of development|staging|production (payment service fail-closes)
- `STRIPE_WEBHOOK_SECRET` — now mandatory everywhere (no env-based bypass)
- `JWT_ISSUER`, `JWT_AUDIENCE` — defaults exist but should be set explicitly per environment
- `WS_ALLOWED_ORIGINS` — comma-separated host allowlist (CSWSH defense). Prod hosts baked into defaults.
- `TRUSTED_PROXIES` — comma-separated CIDRs of reverse proxies (XFF trust boundary). Default: loopback + RFC1918.
- `APPLE_CLIENT_ID` — required if Apple OAuth is enabled (JWKS audience claim)
- **Action:** update `deploy/k8s/overlays/{staging,production}/` configmaps/secrets; add the same to any Helm values; update CI test env
- **Effort:** 30 min
- **Priority:** P0 (blocks deploy)

### Founder-Action — S3. Apply migration 025_stripe_events before deploying payment service
New Stripe event-id dedup table. The payment service will call `RecordStripeEventStart` on every webhook — if the table doesn't exist, every webhook returns 500 and Stripe starts its retry-storm.
- **Action:** `make migrate-up` on staging and production databases BEFORE the new payment pod rolls out
- **Order:** migration → payment pod → verify with a Stripe test event from the dashboard
- **Effort:** 5 min
- **Priority:** P0 (blocks deploy)

### Done — S4. Complete Google OAuth signature verification
Shipped in commit `68d5cbf`. `gateway/internal/handler/oauth.go` now:
- Extracts the `id_token` from the Google token-exchange response
- Verifies signature against Google JWKS (`https://www.googleapis.com/oauth2/v3/certs`) via the same `keyfunc` pattern used for Apple
- Enforces `aud == GOOGLE_CLIENT_ID`, valid `iss` (accepts both `https://accounts.google.com` and `accounts.google.com`), and `RS256` only
- Sources `provider_id` and `email` from the cryptographically signed claim — userinfo endpoint is now used only for display name/avatar (display data, not auth-gating)
- `email_verified` is enforced via the signed claim, not the unauthenticated userinfo response

#### (original spec preserved below)
Apple OAuth now verifies ID tokens via Apple JWKS (landed in audit branch). Google OAuth was not in scope — check whether it has the same "trust payload without verifying signature" bug.
- **Action:** read `gateway/internal/handler/oauth.go` GoogleOAuthCallback; if it decodes the id_token without verifying via Google JWKS (`https://www.googleapis.com/oauth2/v3/certs`), apply the same `keyfunc`-based pattern used for Apple
- **Related:** `GOOGLE_CLIENT_ID` must match the `aud` claim
- **Effort:** 2-3 hours
- **Priority:** P0 (same class of bug as the Apple one that just shipped)

### Done — S5. Replace the jobs IDOR point-fix with generic ownership middleware
Shipped in commit `68d5cbf`. `RequireOwnership` and `RequirePartyAccess` middleware applied to:
- **Contracts** (`/contracts/{id}/*` — RequirePartyAccess on customer_id+provider_id covering Get/Accept/Start/Complete/Approve/Cancel/Review/ChangeOrders/Disputes/GuaranteeClaim/NoShow/Abandonment/PDF/Invoice/Workspace endpoints)
- **Payments** (`/payments/{id}/*` — RequirePartyAccess on customer_id+provider_id covering Get/Process/Refund/Release)
- **Reviews** (`/reviews/{id}/*` — RequirePartyAccess on reviewer_id+reviewee_id; handler enforces writer-only for Respond)
- **Disputes** (`/disputes/{id}` — new `RequireJoinedPartyAccess` middleware that JOINs through `disputes.contract_id → contracts.customer_id/provider_id`, since disputes have no direct party columns)
- **Subscriptions** — already user-scoped via JWT (`/me`, `/cancel`, `/change-tier`); no `/{id}` IDOR surface to gate.

#### (original spec preserved below)
The audit patched the 3 jobs IDOR sites (UpdateJob / DeleteDraft / PublishJob) + GetJob draft-leak by threading `customer_id` end-to-end. The generic middleware `RequireOwnership` exists and is unit-tested but is not yet applied repo-wide.
- **Audit finding:** same class of bug likely exists on contracts, disputes, reviews, payments (any GET/PUT/DELETE `/{resource}/{id}`)
- **Action:** apply `RequireOwnership` middleware to every `/{resource}/{id}` mutating route; add per-resource owner-column mapping
- **Routes to review:** GetContract, UpdateContract, CancelContract, GetDispute, UpdateDispute, GetReview, UpdateReview, GetPayment, RefundPayment, GetSubscription
- **Effort:** 2 days
- **Priority:** P0 (same vulnerability class the jobs fix closed)

### Done — S6. Finish the remaining clippy pedantic errors in engines
Shipped in commit `68d5cbf`. `cargo clippy --workspace -- -D clippy::pedantic` now passes clean across all four engines (bidding, fraud, trust, imaging). Intentional design-choice categories (cast_precision_loss for i64↔f64 score math, missing_const_for_fn for trivial functions, doc_markdown for backtick nits, similar_names for proximate variable names) are documented as crate-level `#![allow(...)]` blocks at each `lib.rs` and `main.rs` with rationale comments. Race-clean test suite confirms behaviour preserved.

#### (original spec preserved below)
`CLAUDE.md` mandates `#![deny(clippy::pedantic)]` but the Rust crates currently fail clippy with 50+ errors (only the NaN correctness bug and integration-test imports were fixed in the audit branch). Remaining:
- `engines/trust/src/scoring.rs`: 9 `cast_precision_loss` (i64 → f64 in score math). Add `#[allow]` with a documented tolerance comment OR refactor to use `u32` counters where precision matters.
- `engines/fraud/src/`: 31 clippy errors (missing backticks in doc comments, `Result`-returning fns missing `# Errors`, identical match-arm bodies)
- `engines/bidding/src/`: 10 clippy errors (similar mix)
- **Action:** run `cd engines && cargo clippy --workspace --all-targets -- -D clippy::pedantic -D clippy::nursery` and address each class; commit per crate
- **Effort:** 4-6 hours
- **Priority:** P0 (blocks CI once clippy gate is wired)

### Founder-Action — S7. Plan git history rewrite for `Password123!` leak
Dangerous operation, requires coordination. All clones must re-clone after.
- **Option A:** `git filter-repo --path qa/scripts/qa-creds.env --invert-paths` + force-push to main. Requires telling every developer to delete their clone and re-clone.
- **Option B:** Accept that the password is in history (mitigated by S1 rotation) and document that the history contains leaked-and-rotated credentials. Cheaper but imperfect.
- **Recommendation:** Option B unless there's a regulatory requirement. The value leaked is a dev/QA password, not customer data.
- **Action:** bring this decision to the team before the branch merges
- **Effort:** half day if Option A; 0 if Option B
- **Priority:** P0 (decision needed before merging audit branch)

### Done — S8. Fix the `proto/payment/v1/payment.proto` drift prevention
Shipped in commit `68d5cbf`. New `make verify-proto` target regenerates Go proto code, fails if `proto/gen` has drift, then runs `go vet` across all six Go modules. CI workflow `.github/workflows/ci.yml` adds a `verify-proto` job (installs protoc 25.1 + protoc-gen-go + protoc-gen-go-grpc) that gates on this. A broken `.proto` now fails the PR build instead of silently persisting behind hand-written stand-ins.

#### (original spec preserved below)
The audit branch closed two missing braces in `payment.proto` that had silently broken `make proto-gen-go` for weeks. Hand-written stand-in Go files had been covering for the broken proto — meaning nobody noticed the breakage until this audit.
- **Action:** add a `make verify-proto` target that runs `make proto-gen-go` + `go vet ./...` and require it in CI. A broken .proto should fail the build, not silently persist behind stand-ins.
- **Effort:** 1 hour
- **Priority:** P0 (prevents the same class of silent drift)

---

## P0 — Foundation (Must Complete Before Anything Else)

### Done — 1. Start the full local stack (Phase 1)
`bin/dev` (native dev environment manager) replaces docker-compose for local development. Supports `bin/dev up | down | status | logs | setup`. Docker-compose remains available for legacy / CI use.

#### (original spec preserved below)
```bash
docker compose up -d          # Postgres, Redis, Meilisearch, MinIO, Jaeger, PgBouncer
make migrate-up               # Run all 12 migrations
make seed                     # Insert test users, jobs, bids, contracts
cd gateway && go run ./cmd/server   # Start API gateway on :8080
# Start each Go service (user, job, payment, chat, notification)
# Start each Rust engine (bidding, fraud, trust, imaging)
cd web && npm run dev          # Frontend on :3000
```
- **Test credentials:** seeder reads `SEED_PASSWORD` env var (or generates a random one and prints it). Set in `.env.local` as `SEED_PASSWORD=$(openssl rand -base64 18)` and re-seed with `make seed`. The four seeded emails are `admin@nomarkup.com`, `customer@nomarkup.com`, `provider@nomarkup.com`, `provider2@nomarkup.com` — all share the same `$SEED_PASSWORD`.
- **Verify:** Login -> dashboard loads -> jobs listing shows seed data -> place a bid
- **Effort:** 1 day
- **Depends on:** Nothing

### Done — 2. Fix all 14 critical error paths from audit (Phase 1)
All 14 paths now closed (commit `68d5cbf`):
- ✅ JSON decode helper + 67 silent-decode handler sites migrated to `decodeJSON` (decode errors now surface to client for field-name-mismatch debugging)
- ✅ Chat access control fail-closed (`services/chat/internal/service/service.go:50-58`)
- ✅ Token revocation atomic via single-tx `SuspendUserAndRevokeTokens` / `BanUserAndRevokeTokens` (no half-state where user is suspended but tokens still authenticate)
- ✅ Search indexing retry queue: 3-attempt exponential backoff for index AND remove (symmetric `removeJobFromSearchWithRetry`); durable Redis-backed queue (ARC-16, 2026-07-27) in `search_retry_queue.go` — ZSET `search:retry`, 30s worker, max 5 durable attempts, Prometheus + DEAD-LETTER log
- ✅ Email templates use `html/template` (XSS-safe)
- ✅ SMS dev-mode at `slog.Warn` with explicit "OTP will not be delivered" message
- ✅ Fraud engine has zero raw `.unwrap()` in production paths
- ✅ Stripe production guard (S2/E1)

#### (original spec preserved below)
Discovered in 2026-03-28 CEO review. All fail silently with zero test coverage.
- **JSON decode helper:** Create `decodeJSON[T](w, r, *T) bool` in `gateway/internal/handler/response.go`. Fix 6 handlers: `job.go:283`, `payment.go:37,258,433`, `subscription.go:145`, `contract.go:335`
- **Chat access control:** Fail closed when bid checker errors (`services/chat/internal/service/service.go:52-58`). Return `ErrServiceUnavailable`, don't allow access.
- **Token revocation blocking:** Return error if `RevokeAllUserTokens` fails in `services/user/internal/service/admin.go:28,49`. Don't proceed with suspension/ban.
- **Search indexing retry queue:** ✅ DONE (ARC-16) — in-process 3-shot + Redis ZSET durable queue (`search:retry`); worker every 30s; dead-letter after 5 durable attempts with `search_retry_dead_letter_total` + ERROR log.
- **Email template HTML escaping:** Switch from `text/template` to `html/template` in `services/notification/internal/service/email.go:127`.
- **SMS dev mode warning:** Change `slog.Info` to `slog.Warn` in `services/notification/internal/service/sms.go:39`. Add `X-Dev-Mode: true` response header.
- **Fraud engine unwrap fix:** Replace `unwrap()` with pattern match in `engines/fraud/src/engine.rs:1499`.
- **Stripe production guard:** ✅ DONE on branch `fix/security-audit-2026-04-23` — `STRIPE_WEBHOOK_SECRET` is now mandatory at payment-service startup regardless of environment; `ENVIRONMENT` is the canonical env var (APP_ENV removed from payment service), validated to be one of `development|staging|production` at boot.
- **Effort:** 1-2 days
- **Depends on:** Nothing (can run in parallel with #1)
- **Progress (2026-04-23):** 1 of 14 fixed (Stripe guard). Remaining 13 items above still pending.

### Done — 3. Build ownership middleware for IDOR prevention (Phase 1)
Closed via S5 (see above) — `RequireOwnership` + `RequirePartyAccess` + `RequireJoinedPartyAccess` middleware applied repo-wide.

#### (original spec preserved below)
- Gateway middleware that resolves resource->owner from DB and compares with JWT user_id
- Applied per-route via Chi middleware chain
- **Handlers affected:** `GetJob`, `GetContract`, `UpdateContract`, `CancelContract`, `GetDispute`, `UpdateDispute`
- **Pattern:** Middleware extracts resource ID from URL, queries ownership table, compares with JWT claim
- **Effort:** 2-3 days
- **Priority:** P0 (OWASP Top 10 IDOR vulnerability)
- **Depends on:** Nothing
- **Progress (2026-04-23):** `RequireOwnership` middleware exists + unit-tested; jobs IDOR specifically patched end-to-end (proto + gateway + service + repo + GetJob draft-leak). Remaining: apply the middleware to Contract / Dispute / Review / Payment / Subscription routes — tracked as S5 above.

### Done — 4. Add PgBouncer to infrastructure stack (Phase 1)
Already shipped: `pgbouncer:` service in `docker-compose.yml` (line 21+, edoburu/pgbouncer:v1.25.1-p0). Go services and Rust engines connect via `postgresql://nomarkup:password@pgbouncer:5432/nomarkup` rather than direct Postgres.

#### (original spec preserved below)
- Add PgBouncer as Docker Compose service between all Go/Rust services and PostgreSQL
- Transaction pooling mode, `pool_size=100`, `max_client_conn=500`
- Update all service `DATABASE_URL` env vars to point to `pgbouncer:6432`
- **Why:** 4 Rust engines x 20 connections + 5 Go services = 80+ connections against default 100 limit
- **Effort:** Half day
- **Depends on:** Nothing

### Done — 5. Build admin feature flag system (Phase 1)
Already shipped:
- Migration `013_feature_flags.up.sql`: `feature_flags` table (key, enabled, description, updated_at)
- Backend handler `gateway/internal/handler/feature_flag.go` with public `GET /api/v1/flags` + admin `GET/PUT /api/v1/admin/flags/{key}`
- Frontend `web/src/hooks/useFeatureFlags.ts` + admin page in dashboard

#### (original spec preserved below)
- New `feature_flags` DB table + migration 013: key (unique), enabled (bool), description, updated_at
- Admin API: `GET /api/v1/admin/flags`, `PUT /api/v1/admin/flags/{key}` — extend `admin_platform.go`
- Frontend flag provider: reads flags at app init, gates expansion features
- Kill-switch for: Fair Price Index, spectator mode, guarantee, matching, Provider Business OS
- **Effort:** 1 day
- **Depends on:** Admin panel working
- **Replaces:** P3 #12 (localStorage toggle) — promoted to P0

### Founder-Action — 6. Wire email verification — SendGrid (Phase 1)
**Code (Done):** `services/notification/internal/service/email.go` is fully wired to the SendGrid v3 API. When `apiKey == ""` it operates in dev-mode (logs the would-be email). Email verification token generation + handler are in place (P1 #12 below). The user-service call for "send verification email" delegates to the notification service.
**Founder-Action:** create the SendGrid account → get API key → set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` (e.g. `notifications@nomarkup.com`), and (optionally) a verification template ID in the production secrets store. Re-roll the notification pod and the dev-mode warning will switch off.
**Machine-check (does not close this item):** `make founder-secrets-check` reports `SENDGRID_API_KEY` as present/missing/placeholder. Fail-closed with `--strict` or `ENVIRONMENT=production`. Never prints the key.

#### (original spec preserved below)
- **Account setup:** Create SendGrid account -> get API key -> create verification email template
- **Env vars:** Set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_VERIFICATION_TEMPLATE_ID` in `.env.local`
- **Code changes needed:**
  - `services/user/internal/grpc/server.go:64` — Replace TODO with SendGrid API call
  - `services/user/internal/service/auth.go` — Add `if !user.EmailVerified` check in `Login()`
  - `gateway/internal/handler/auth.go` — Map `ErrEmailNotVerified` to 403
  - Add `POST /api/v1/auth/resend-verification` endpoint
- **Effort:** 2-3 days
- **Depends on:** SendGrid account

### Founder-Action — 7. Wire Sentry error tracking (Phase 1)
**Code (Done):** Every Go service initializes Sentry when `SENTRY_DSN` is set (see `services/payment/cmd/server/main.go:58-71` for the canonical pattern; same block exists in user/job/chat/notification/gateway). Sets `Environment` from `ENVIRONMENT` env var, `Release` from `APP_VERSION`, `TracesSampleRate=0.1`, and flushes on graceful shutdown. Frontend uses `@sentry/nextjs` integration.
**Founder-Action:** create the Sentry project → get DSN → set `SENTRY_DSN` (Go services) and `NEXT_PUBLIC_SENTRY_DSN` (frontend) in the secrets store.
**Machine-check (does not close this item):** `make founder-secrets-check` reports `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` as present/missing/placeholder. Fail-closed with `--strict` or `ENVIRONMENT=production`. Never prints the DSN.

#### (original spec preserved below)
- **Account setup:** Create Sentry project (Next.js + Go) -> get DSN
- **Env vars:** Set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` in `.env.local`
- **Code changes:** Frontend (@sentry/nextjs), Go services (sentry-go), Rust engines (sentry crate)
- **Effort:** 1-2 days
- **Depends on:** Sentry account

### Done (backendless smoke) — 8. Build Playwright E2E test suite (Phase 1-2)
**Not a full 12-flow Done.** Specs exist under `web/tests/e2e/` (admin, auth, bid, chat, contract, job, live-auction, payment, marketplace, provider-business, axe). CI Playwright is **backendless smoke** (web-only; `playwright.config.ts` ignores `dogfood/**` when `SEED_PASSWORD` is unset). Dogfood of the 12-flow funnel is **optional** behind `SEED_PASSWORD` + a live stack — not the CI gate.

#### (original spec preserved below)
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

### Done — 9. Fix migrations 007/008 — missing updated_at triggers (Phase 1)
Verified: both migrations already create `set_working_capital_advances_updated_at` and `set_provider_expenses_updated_at` triggers wired to `trigger_set_updated_at()` (defined in 001). Closed without code change.

#### (original spec preserved below)
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

### Done — 13. Build expense + working capital backend (Phase 2)
Verified end-to-end (gateway handler → gRPC client → service → repo). `services/payment/internal/service/expense.go` + `advance.go` carry the business logic; `services/payment/internal/grpc/expense_server.go` + `advance_server.go` expose the gRPC surface; gateway handlers `expense.go` + `working_capital.go` proxy to the gRPC client. Mock-data placeholders are gone. Test coverage on these files is in `expense_test.go` + `advance_test.go`.

#### (original spec preserved below)
- Implement real expense CRUD and working capital advance logic in the **Payment service** (not a new service)
- Wire gateway handlers (`expense.go`, `working_capital.go`) to gRPC calls instead of returning mock data
- Extend payment proto with expense + advance message types
- Add repository methods + service logic in `services/payment/internal/`
- **Why:** These feature surfaces are 100% stub — returning mock data to real users
- **Effort:** 3-5 days
- **Depends on:** Payment service running, PgBouncer (#4)

### Done — 14. Implement savings + streaks backend queries (Phase 2)
Verified: `gateway/internal/handler/user.go:119+` queries the `user_savings` table directly via dbPool; `gateway/internal/handler/provider.go:290+` queries `provider_streaks`. No TODO placeholders remain.

#### (original spec preserved below)
- `gateway/internal/handler/user.go:124` — Replace TODO with real savings query via user service gRPC
- `gateway/internal/handler/provider.go:292` — Replace TODO with real streaks query via user service gRPC
- **Effort:** 1 day
- **Depends on:** User service running

### Done — 15. Build Fair Price Index — public pricing tool (Phase 2)
Verified shipped: backend `gateway/internal/handler/pricing.go` reads from the `fair_price_index` materialized view (migration 014); routes `GET /api/v1/pricing` and `GET /api/v1/pricing/{category}` are public; frontend `web/src/app/(public)/pricing/page.tsx` + `PricingPageContent.tsx` are SEO-tagged with OpenGraph metadata.

#### (original spec preserved below)
- PostgreSQL materialized view aggregating completed auction data by category + ZIP code
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` on hourly schedule
- Public API endpoint: `GET /api/v1/pricing/{category}?zip={zip}` — extend analytics handler
- SEO-friendly landing page: "What does X cost in your area?"
- **Why:** Growth engine. Every homeowner googling service pricing lands on NoMarkup.
- **Effort:** 3-5 days
- **Depends on:** Auction data (seed data or real auctions)

### Done — 16. Build spectator mode for live auctions (Phase 2)
Verified shipped: `gateway/internal/handler/spectator_ws.go` provides anonymous WebSocket endpoint with PII stripping (provider_id, provider_name, email, phone, etc), 3-second anti-front-running delay, per-IP rate limiting (max 5 concurrent + max 500 spectators per auction), and Redis-backed spectator counts. Frontend client at `web/src/lib/spectator-websocket.ts`.

#### (original spec preserved below)
- Public WebSocket endpoint: `/ws/auction/{id}/spectate`
- Anonymous access with rate limiting: 5 connections/IP, 500 total spectators/auction
- 3-second data delay for spectators (prevent competitive advantage)
- **Why:** Viral growth. "Watch this auction" links on social media. FOMO-driven acquisition.
- **Effort:** 2-3 days
- **Depends on:** Live Auction Arena (done)

### Done — 17. Build NoMarkup Guarantee claims flow (Phase 2)
Verified shipped end-to-end:
- Customer-side: `gateway/internal/handler/contract.go` `SubmitGuaranteeClaim` + `GetGuaranteeClaim`
- Admin-side: `gateway/internal/handler/admin_disputes.go` `ListGuaranteeClaims` + `ReviewGuaranteeClaim` (PUT /api/v1/admin/guarantee-claims/{id}/review)
- Frontend: `useGuarantee` hook, `GuaranteeCoverage`, `GuaranteeClaimForm`, `GuaranteeClaimReview` components, `(dashboard)/admin/guarantee` admin page
- Schema: migration 015 added `disputes.guarantee_*` columns

#### (original spec preserved below)
- Customer submits claim with photo evidence against completed contract
- Admin review queue: evidence, chat history, contract terms
- If valid: platform pays for fix from escrow/insurance pool via Stripe
- **Why:** Breaks the cold-start problem. Customers trust the platform, not the individual provider.
- **Effort:** 5-7 days
- **Depends on:** Payment service, contract service, admin panel

### Done — 18. Gateway payment idempotency keys (Phase 3)
- Shipped on branch `fix/security-audit-2026-04-23` (commit `c89baff`). `RequireIdempotencyKey` middleware is now mounted on `/payments` and `/subscriptions` route groups with 24h Redis TTL.

### Done (code) / Founder-Action (credentials) — 19. Wire OAuth providers — Google + Apple + Facebook (Phase 3)
**Code path is complete** (JWKS verification, state cookies, Facebook Login, native iOS paths).  
**2026-08-05:** Init handlers fail closed when client IDs are missing (`google_not_configured` / `facebook_not_configured` / `apple_not_configured`) instead of redirecting to the provider with an empty `client_id` (Google’s “Access blocked: Missing required parameter: client_id”). Login/register surface those codes via `web/src/lib/oauth-errors.ts`. Tests: `gateway/internal/handler/oauth_web_init_test.go`, `web/tests/unit/lib/oauth-errors.test.ts`.

#### Open — OAUTH-FULL-SETUP (Founder-Action, P1 launch-blocking)
Social login is **not fully set up** until real credentials exist in every environment and a human completes one successful sign-in per provider.

| Env | Where to put secrets | Redirect base |
|-----|----------------------|---------------|
| Local | `.env.local` → restart gateway | `http://localhost:8081` (or your `GATEWAY_PORT`) |
| Staging | `nomarkup-secrets` (not ConfigMap — OPS-08) | staging API host |
| Production | `nomarkup-secrets` / `deploy/prod/.env` | `https://api.no-markup.com` |

**Checklist (do all):**
- [ ] **Google** — Cloud Console → OAuth 2.0 Web client  
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`  
  - Optional iOS: `GOOGLE_IOS_CLIENT_ID` (bundle `com.nomarkup.app`)  
  - Authorized redirect URI: `{OAUTH_REDIRECT_BASE}/api/v1/auth/callback/google`
- [ ] **Facebook** — Meta Developer app → Facebook Login  
  - `FACEBOOK_CLIENT_ID` (App ID), `FACEBOOK_CLIENT_SECRET`  
  - Valid OAuth Redirect URI: `{OAUTH_REDIRECT_BASE}/api/v1/auth/callback/facebook`
- [ ] **Apple** — Developer → Sign in with Apple Services ID  
  - `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET` (and native audience if different)
- [ ] Set `OAUTH_REDIRECT_BASE` + `FRONTEND_URL` to match the env
- [ ] Restart gateway / roll pods so env is loaded
- [ ] Dogfood: Continue with Google → consent → lands authenticated
- [ ] Dogfood: Continue with Facebook → same
- [ ] Dogfood: Continue with Apple (web and/or native iOS) → same
- [ ] Confirm login error UX still works if a secret is intentionally blank (redirect + in-app message, not provider 400 page)

**Machine-check (does not close this item):** `make founder-secrets-check` reports `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_CLIENT_ID`, `APPLE_CLIENT_ID` as present/missing/placeholder. Fail-closed with `--strict` or `ENVIRONMENT=production`. Never prints values.

**Refs:** `.env.example` OAuth block · `deploy/k8s/SECRETS.md` · `docs/operations/prod-launch-todo.md` Phase 2 · `docs/compliance/founder-action-board.md` · `scripts/founder-secrets-check.sh` · resume phrase: `resume OAuth full setup` or `OAUTH-FULL-SETUP`

#### (original spec preserved below)
- **Account setup:**
  - Google: Cloud Console -> OAuth 2.0 -> client ID/secret
  - Apple: Developer -> "Sign in with Apple" -> Services ID
- **Code changes:** Gateway OAuth handler, user service `FindOrCreateByOAuth`, frontend OAuth buttons
- **Effort:** 3-5 days
- **Depends on:** Google Cloud + Apple Developer accounts
- **Progress (2026-04-23):** Apple ID token now verifies against Apple JWKS with iss/aud/exp checks (commit `c89baff`). Google still needs the same JWKS verification — tracked as S4 above.

### Founder-Action — Apple Pay domain association
**Code (Done):** placeholder file + README. PaymentSheet / Payment Request is code-ready when a real association file + merchant ID + `pk_` exist. **Do not invent association bytes.**
**Founder-Action:** download the exact file from Stripe Dashboard → Settings → Payment methods → Apple Pay → Add domain (or Apple Developer) and replace `web/public/.well-known/apple-developer-merchantid-domain-association`. Verify `https://no-markup.com/.well-known/apple-developer-merchantid-domain-association` serves it. Status stays Founder-Action until that human step lands.
**Machine-check (does not close this item):** `make founder-secrets-check` **FAIL**s the Apple Pay row while the file still contains `PLACEHOLDER` / `TODO` / `example`.
**Refs:** `docs/compliance/apple-pay-domain.md` · `web/public/.well-known/README.md` · `docs/compliance/founder-action-board.md`

### Done — 20. Add MFA setup page (Phase 3)
Verified shipped: migration 016_mfa added `mfa_secret` + `mfa_backup_codes` + `mfa_enabled` columns; user-service repo has `StoreMFASecret`, `GetMFASecret`, `EnableMFA`, `DisableMFA`, `IsMFAEnabled`; gateway routes `/api/v1/auth/mfa/{enable,verify-setup,disable,verify}`; frontend hook `useMFA.ts` + 514-LOC settings/security page with QR code, code verification, and backup codes grid.

#### (original spec preserved below)
- TOTP library: `github.com/pquerna/otp`
- User service: `EnableMFA()`, `VerifyMFA()` RPCs
- Gateway: `/api/v1/users/me/mfa/{enable,verify,disable}`
- Frontend: QR code display, code verification, backup codes grid, MFA step in login
- Database: Add `mfa_secret` and `mfa_backup_codes` columns (new migration)
- **Effort:** 3-5 days
- **Depends on:** Nothing (self-contained)

---

## P2 — Post-Launch High-Value

### Done — 21. Smart pre-matching engine
Already shipped: `services/job/internal/service/matching.go` + `services/job/internal/repository/matching.go`. `triggerProviderMatching` is invoked on every job creation/publish and dispatches notifications via the wired notifier interface.

#### (original spec preserved below)
- When a customer posts a job, auto-identify and notify top 3-5 providers
- Match on: category, geo proximity, trust score, win rate, availability
- **Why:** Reduces time-to-first-bid from hours to minutes. Makes the platform feel intelligent.
- **Effort:** 3-5 days
- **Depends on:** Trust scores computed, notification service wired

### Done — 22. Auction Replay System
Already shipped: `gateway/internal/handler/auction_replay.go` backend; `web/src/components/bids/AuctionReplay.tsx` + `web/src/hooks/useAuctionReplay.ts` frontend; `(terminal)/auctions/[id]/replay/` page route. Records full bid timeline with animated playback.

#### (original spec preserved below)
- Record bid timeline for completed live auctions
- Generate animated replay showing price evolution
- Shareable as GIF/video for social media
- **Depends on:** Live Auction Arena (done)
- **Effort:** 1 week

### Done — 23. Provider Challenges & Seasonal Events
Already shipped: `gateway/internal/handler/challenge.go` (gateway), migration 017_provider_challenges, gateway routes `/api/v1/challenges/{,me,{id},{id}/join}`. Frontend integration via `useChallenges` hook.

#### (original spec preserved below)
- Time-limited competitions with progress tracking
- Reward distribution (priority placement, badges)
- **Depends on:** Provider rankings (done)
- **Effort:** 2-3 weeks

### Done — 24. Secrets Rotation Procedure
Documented at `docs/secrets-rotation.md`. Rotation runbook covers JWT keys, Stripe keys, DB credentials, OAuth client secrets.

#### (original spec preserved below)
- Document + automate rotation for JWT keys, Stripe keys, DB credentials
- **Effort:** S

### Done — 25. Dependency Vulnerability Scanning
`.github/dependabot.yml` configured. Renovate alternatively can be added later.

#### (original spec preserved below)
- Enable Dependabot or Renovate for automated security updates
- **Effort:** S

### In Progress — 27. Go test coverage in repository/grpc/domain packages (Phase 3)
**Service-layer status (commit `4ea4d99`):** payment service `internal/service/` is now at **73.2%** (up from 16.5%) via 14 new test files added across 2026-04-24 / 2026-04-25 sessions. `service.go`, `subscription.go`, `webhook.go`, `installment.go`, `insurance.go`, `advance.go`, `expense.go`, `tax.go`, `invoice.go`, `stripe.go` (dev paths), `devstore.go` all have dedicated test files. Coverage push to 80%+ is in progress via StripeService interface refactor (tracked separately).

**Remaining (per-service tally):**
- `payment/internal/repository/` — still 0% (production paths require testcontainers-go for real Postgres per CLAUDE.md). Tracked as a follow-up batch.
- `payment/internal/grpc/` — still 0% (bufconn integration tests planned).
- Other Go services (user, job, chat, notification, gateway): mix of mostly-untested repo + grpc layers, partial service-layer coverage.

**Action:** the service-layer of payment/ is the highest-risk surface and is now well-covered. Repository + gRPC layers need testcontainers-go infrastructure per CLAUDE.md. Tracked in this session's task list as a separate batch.

#### (original spec preserved below)
- CLAUDE.md targets 80% line coverage for Go; currently near-zero in `repository/`, `grpc/`, and `domain/` packages across all 6 services (gateway, user, job, payment, chat, notification). Service layer is partially covered.
- **Action:** use testcontainers-go for real Postgres in repository tests (no mocking the DB per CLAUDE.md); bufconn for in-process gRPC tests; table-driven per CLAUDE.md convention.
- **Priority:** raise to P1 before launch (repositories handle auth-scoped queries — untested = brittle).
- **Effort:** 1-2 weeks (systematic, per package)

### Done — 28. Rust imaging engine clippy cleanup (Phase 3)
Closed via S6 (commit `68d5cbf`). Imaging engine now passes `cargo clippy --workspace -- -D clippy::pedantic` clean alongside the other three engines.

#### (original spec preserved below)
- Same class as S6 but specific to `engines/imaging/` which also has pedantic warnings (dead_code on `to_image_format`, fields `strip_exif` / `auto_orient` never read).
- **Action:** either wire the dead code into the pipeline or remove it. `grpc` module still excluded from the imaging lib target — decide whether to surface it.
- **Effort:** 2 hours

### Done — 26. Database Query Optimization
Already shipped across migrations 018 + 020 (12 + 20 indexes respectively):
- `idx_auction_bid_events_created_at` (018) — exactly the spectator "most active" index TODOS-26 called out
- Provider search composites (018: `idx_jobs_category_status_created`, `idx_jobs_zip_category`, `idx_trust_scores_tier_user`, `idx_psc_category_provider`)
- Analytics composites (020: `idx_payments_provider_status_created`, `idx_payments_customer_status_created`, `idx_bids_provider_created`, `idx_contracts_provider_status_created`, `idx_reviews_reviewee_created`)
- Trigram GIN indexes for ILIKE searches (020: `idx_users_email_trgm`, `idx_users_display_name_trgm`, `idx_jobs_title_trgm`)
- Partial indexes on common status filters (018: `idx_contracts_completed`, `idx_bids_awarded_amount`; 020: `idx_jobs_customer_drafts`, `idx_chat_messages_channel_active`)

#### (original spec preserved below)

---

## Vision — Delight Opportunities

These are small (<1 hour) polish items that make users think "oh nice, they thought of that."

### Done — V1. "You saved $X" celebration moment
Shipped: `web/src/components/bids/SavingsCelebration.tsx` (demo auction + tests). Confetti + savings % after win.
- **Effort:** 30 min

### Done — V2. Smart bid suggestion for providers
Shipped: `web/src/components/bids/BidSuggestion.tsx` on BidForm (non-dock, via `usePricingByCategory`). "Similar jobs in this area typically close at $X–$Y" from Fair Price Index p25–p75.
- **Depends on:** Fair Price Index (#15)
- **Effort:** 20 min

### Done — V3. Provider response time badge
Shipped: gateway `response_time_label` (avg first chat reply, last 90 days) + web `ResponseTimeBadge` on providers list and profile.
- **Effort:** 30 min

### Done — V4. "Share your savings" social card
Shipped: `web/src/components/ui/ShareSavingsCard.tsx` on completed contract detail. Card + X/Facebook/copy. Share URL is `https://no-markup.com` (owned production zone).
- **Effort:** 30 min

### Partial — V5. Neighborhood price heat map
UI exists (`web/src/components/maps/PriceHeatMap.tsx` on `/pricing`) but is **illustrative**: points are a deterministic hash offset around the US centroid, not ZIP geocodes. Mapbox heatmap layer + zoom ship; neighborhood accuracy does not.
- **Depends on:** Fair Price Index (#15)
- **Effort:** 1 hour

---

## Completion Summary (re-audited 2026-04-25)

| Priority | Total | Done | In Progress | Founder-Action | Remaining |
|----------|-------|------|-------------|----------------|-----------|
| P0 — Security audit follow-ups (S1-S8) | 8 | 6 | 0 | 2 (S3, S7) | 0 |
| P0 — Foundation | 9 | 7 | 0 | 2 (#6, #7) | 0 |
| P1 — Launch-blocking | 11 | 11 | 0 | 0 | 0 |
| P2 — Post-launch | 8 | 7 | 1 (#27) | 0 | 0 |
| Vision — Delight | 5 | 4 (V1–V4) | 1 Partial (V5) | 0 | 0 |

**Engineering work remaining (no founder dependency):**
- **#27** Repository + gRPC test coverage (testcontainers-go infrastructure required, needs Docker locally to develop the test scaffolding) — multi-day infra setup. Partial credit for service-layer push to 73.2% on payment service this session.
- **Push payment service test coverage from 73.2% → 80%+** — last 7 points are Stripe SDK production paths; would require either an HTTP-level Stripe mock (stripe-mock) or wrapping every SDK function call in a custom shim (iterator return types make this non-trivial). Appropriate as a separate follow-up PR after the audit branch lands.

**Founder-Action items (engineering side complete; external resource required):**
- **S1** Manually rotate any deployed account currently using `Password123!` in your secrets manager.
- **S3** Run `make migrate-up` on staging + production DBs before payment pod rollout (delivers migration `025_stripe_events`).
- **S7** Decide: git history rewrite (Option A: filter-repo + force-push, requires every dev to re-clone) vs accept history (Option B). Recommend B unless regulatory.
- **#6** Provision SendGrid API key + `SENDGRID_FROM_EMAIL` in production secrets. Check: `make founder-secrets-check`.
- **#7** Provision Sentry DSN (Go services + frontend) in production secrets. Check: `make founder-secrets-check`.
- **#19 / OAUTH-FULL-SETUP** Provision real Google + Facebook + Apple OAuth credentials for **local** (`.env.local`), **staging**, and **production** (`nomarkup-secrets` / `deploy/prod/.env` — not ConfigMap, OPS-08). Register redirect URIs, set `OAUTH_REDIRECT_BASE` + `FRONTEND_URL`, restart gateway, and dogfood each “Continue with …” button once. See §19 checklist above. Resume: `resume OAuth full setup`. Check: `make founder-secrets-check`.
- **Apple Pay** Download the real Stripe/Apple association file (never invent bytes) and replace the PLACEHOLDER. Check: `make founder-secrets-check`.

**Shipped across audit branch + 2026-04-24/25 sweep (commits `68d5cbf`, `cb4b478`, `a97393b`, `f890143`, `0a9fd90`, `4ea4d99`):**
- All 8 security audit follow-ups (S1-S8) closed code-side
- All 14 critical error paths closed; 67 silent-decode handlers migrated to `decodeJSON`
- IDOR middleware applied repo-wide via new `RequireOwnership` / `RequirePartyAccess` / `RequireJoinedPartyAccess`
- Stripe service fail-closes in non-development environments
- Atomic single-tx `SuspendUserAndRevokeTokens` / `BanUserAndRevokeTokens`
- Real **XSS bug** found and fixed in tax-form HTML generation (provider legal name was injected unescaped into IRS document)
- Symmetric Meilisearch retry (index + remove) with 3-attempt exponential backoff
- All four Rust engines pass `clippy::pedantic + clippy::all` clean
- Payment service test coverage: 16.5% → 73.2% (14 new test files)
- Google OAuth JWKS signature verification matches Apple

**What's left: launch readiness** is gated on the Founder-Action items above (S1/S3/S7, SendGrid, Sentry, OAUTH-FULL-SETUP, Apple Pay) + #26 + #27 (test coverage on repos). Inventory: `make founder-secrets-check` — it does not close them.

**Next action:** Clear S1-S8 before merging the audit branch. Specifically S1 (rotate Password123!) + S2 (set required env vars) + S3 (apply migration 025) are deploy blockers.
