# NoMarkup — TODO Tracker

> Last updated: 2026-03-17 (post-audit)
> Priority: P0 = do next, P1 = launch-blocking, P2 = post-launch, P3 = nice-to-have
> Status: ✅ Done, 🔧 In Progress, ⬜ Not Started

---

## P0 — Enable Full-Stack Testing

These items unblock live browser testing of all features. None require writing new application logic — they're infrastructure/account setup tasks.

### ⬜ 1. Start the full local stack
```bash
docker compose up -d          # Postgres, Redis, Meilisearch, MinIO, Jaeger
make migrate-up               # Run all 11 migrations
make seed                     # Insert test users, jobs, bids, contracts
cd gateway && go run ./cmd/server   # Start API gateway on :8080
# Start each Go service (user, job, payment, chat, notification)
# Start each Rust engine (bidding, fraud, trust, imaging)
cd web && npm run dev          # Frontend on :3000
```
- **Test credentials:** `customer@nomarkup.com` / `Password123!`, `provider@nomarkup.com` / `Password123!`, `admin@nomarkup.com` / `Password123!`
- **Verify:** Login → dashboard loads → jobs listing shows seed data → place a bid

### ⬜ 2. Wire email verification (SendGrid)
- **Account setup:** Create SendGrid account → get API key → create verification email template
- **Env vars:** Set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_VERIFICATION_TEMPLATE_ID` in `.env.local`
- **Code changes needed:**
  - `services/user/internal/grpc/server.go:64` — Replace TODO with SendGrid API call to send verification email on registration
  - `services/user/internal/service/auth.go` — Add `if !user.EmailVerified` check in `Login()` method, return `ErrEmailNotVerified`
  - `gateway/internal/handler/auth.go` — Map `ErrEmailNotVerified` to 403 with message "Please verify your email before signing in"
  - Add `POST /api/v1/auth/resend-verification` endpoint for resending the email
- **Effort:** 2-3 days
- **Depends on:** SendGrid account

### ⬜ 3. Wire Sentry error tracking
- **Account setup:** Create Sentry project (Next.js + Go) → get DSN
- **Env vars:** Set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` in `.env.local`
- **Code changes needed:**
  - Frontend: `npm install @sentry/nextjs` → run `npx @sentry/wizard@latest -i nextjs` → configure `sentry.client.config.ts` and `sentry.server.config.ts`
  - Backend: Add `github.com/getsentry/sentry-go` to gateway and all Go services → init in each `main.go` with `sentry.Init()` → add `sentry.CaptureException()` to error handlers
  - Rust: Add `sentry` crate to engines workspace → init in each `main.rs`
- **Effort:** 1-2 days
- **Depends on:** Sentry account

### ⬜ 4. Wire OAuth providers (Google + Apple)
- **Account setup:**
  - Google: Create project in Google Cloud Console → enable OAuth 2.0 → get client ID/secret → set authorized redirect URI to `http://localhost:8080/api/v1/auth/callback/google`
  - Apple: Create App ID in Apple Developer → enable "Sign in with Apple" → create Services ID → get client ID/secret
- **Env vars:** Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET` in `.env.local`
- **Code changes needed:**
  - Gateway: Add OAuth handler (`gateway/internal/handler/oauth.go`) with routes for `/api/v1/auth/oauth/google`, `/api/v1/auth/oauth/apple`, `/api/v1/auth/callback/{provider}`
  - User service: Add `FindOrCreateByOAuth(provider, providerID, email)` method to create/link accounts
  - Frontend: Add OAuth buttons to `LoginForm.tsx` and `RegisterForm.tsx` (UI positions already spec'd)
  - Use `golang.org/x/oauth2` package for Google, Apple's JWT-based flow for Sign in with Apple
- **Effort:** 3-5 days
- **Depends on:** Google Cloud + Apple Developer accounts

### ⬜ 5. Add MFA setup page
- **Code changes needed:**
  - Install TOTP library: `github.com/pquerna/otp` in user service
  - User service: Add `EnableMFA()` RPC — generates TOTP secret, returns QR code URI + backup codes
  - User service: Add `VerifyMFA()` RPC — validates 6-digit code against stored secret
  - Gateway: Add `POST /api/v1/users/me/mfa/enable`, `POST /api/v1/users/me/mfa/verify`, `POST /api/v1/users/me/mfa/disable`
  - Frontend: Create `/settings/security` MFA setup flow — QR code display, code verification, backup codes grid
  - Frontend: Add MFA step to `LoginForm.tsx` — after credentials, if MFA enabled, show 6-digit input
  - Database: Add `mfa_secret` and `mfa_backup_codes` columns to users table (new migration)
- **Effort:** 3-5 days
- **Depends on:** Nothing (self-contained)

---

## P1 — Launch-Blocking

### ✅ 6. Live Auction Arena
- **Status:** Complete (commit `35ecfd0`)
- Dual-mode auctions, real-time price drop chart, anti-snipe extensions, WebSocket streaming, savings tracker, provider rankings

### ✅ 7. Observability Stack (Partial)
- **Status:** OTel tracing ✅, Grafana dashboards ✅, Prometheus metrics ✅
- **Remaining:** Sentry integration (see P0 #3 above)

### ✅ 8. Email Verification (Backend)
- **Status:** Token generation + validation complete
- **Remaining:** SendGrid wiring (see P0 #2 above)

---

## P2 — Post-Launch High-Value

### ⬜ 9. Auction Replay System
- Record bid timeline for completed live auctions
- Generate animated replay showing price evolution
- Shareable as GIF/video for social media
- **Depends on:** Live Auction Arena ✅
- **Effort:** M (1 week)

### ⬜ 10. Social Savings Cards
- Generate OG-image-style shareable cards ("I saved $4,230 on NoMarkup")
- Optimized for Twitter/Facebook/Instagram sharing
- **Depends on:** Savings tracker ✅
- **Effort:** S (2-3 days)

### ⬜ 11. Provider Challenges & Seasonal Events
- Time-limited competitions with progress tracking
- Reward distribution (priority placement, badges)
- **Depends on:** Provider rankings ✅
- **Effort:** L (2-3 weeks)

---

## P3 — Nice-to-Have

### ⬜ 12. Admin Feature Flag API
- Replace localStorage toggle with backend admin settings endpoint
- **Effort:** S

### ⬜ 13. Secrets Rotation Procedure
- Document + automate rotation for JWT keys, Stripe keys, DB credentials
- **Effort:** S

### ⬜ 14. Dependency Vulnerability Scanning
- Enable Dependabot or Renovate for automated security updates
- **Effort:** S

### ⬜ 15. Database Query Optimization
- EXPLAIN ANALYZE on slow queries, connection pool tuning
- **Effort:** M

---

## Completion Summary

| Priority | Total | Done | Remaining |
|----------|-------|------|-----------|
| P0 (enable testing) | 5 | 0 | 5 |
| P1 (launch-blocking) | 3 | 3 | 0 (P0 items close the remaining gaps) |
| P2 (post-launch) | 3 | 0 | 3 |
| P3 (nice-to-have) | 4 | 0 | 4 |

**Next action:** Start with P0 #1 (start the full stack) to validate all existing features end-to-end, then wire SendGrid (#2) and Sentry (#3).
