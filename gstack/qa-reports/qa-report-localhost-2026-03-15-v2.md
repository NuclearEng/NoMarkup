# QA Report: NoMarkup Multi-Profile (localhost:3000) — v2

**Date:** 2026-03-15
**Duration:** ~20 minutes
**Mode:** Full, multi-profile
**Framework:** Next.js 15 (App Router) with same-origin API proxy
**Profiles Tested:** Customer, Provider, Admin
**Pages Visited:** 22
**Screenshots:** 20

---

## Health Score: 89/100

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| Console | 70 | 15% | 10.5 |
| Links | 100 | 10% | 10.0 |
| Visual | 100 | 10% | 10.0 |
| Functional | 85 | 20% | 17.0 |
| UX | 85 | 15% | 12.8 |
| Performance | 92 | 10% | 9.2 |
| Content | 100 | 5% | 5.0 |
| Accessibility | 97 | 15% | 14.6 |
| **Total** | | | **89.1** |

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 3 |

---

## Regression vs Previous Run (baseline score: 85)

**Score delta: +4.1** (85 → 89.1)

### Issues Fixed Since Last Run
- ~~Auth refresh fails on hard navigation~~ — **FIXED** (same-origin proxy + inet::text + SameSite:Lax)
- ~~Contract cards show truncated UUID~~ — **FIXED** (proto regenerated, job_title shows correctly)
- ~~Profile page fails to load~~ — **FIXED** (snake_case mapping)
- ~~Browse Jobs empty~~ — **FIXED** (query params + seed upsert)
- ~~WebSocket "closed before established"~~ — **IMPROVED** (debounce + context.Background)
- ~~Dashboard sidebar hidden on mobile~~ — **FIXED** (horizontal nav bar)

### Remaining Issues

---

## Issues

### ISSUE-001: Browse Jobs shows skeleton loaders when auth state changes (Medium / Functional)

**Description:** When navigating to /jobs as a logged-in provider, the page shows permanent skeleton loaders instead of job cards. The AuthRestorer runs asynchronously and the page appears to re-render mid-request, causing the query to hang.

**Repro:**
1. Login as provider@nomarkup.com
2. Navigate to /jobs
3. Observe skeleton loading cards that never resolve

**Note:** Works correctly for customer and unauthenticated users. Provider-specific issue may relate to the AuthRestorer triggering a re-render that resets the TanStack Query state.

**Evidence:** Screenshot qa5-p05-browse.png

---

### ISSUE-002: Rate limiter too aggressive for multi-session testing (Medium / Functional)

**Description:** After 3-4 login attempts across different accounts, the gateway returns 429 Too Many Requests. The AuthGuard and AuthRestorer then also get rate-limited when trying to refresh, causing cascading failures across all pages.

**Repro:**
1. Login as customer, navigate pages
2. Login as provider, navigate pages
3. Login as admin — subsequent page loads return 429
4. All dashboard pages redirect to login

**Impact:** Blocks multi-profile testing and would affect real users switching between accounts on the same device.

**Evidence:** Console errors showing 429 responses.

---

### ISSUE-003: WebSocket still shows initial connection warning (Low / Functional)

**Description:** A single WebSocket warning appears in console on first authenticated page load: "WebSocket is closed before the connection is established." The debounce fix reduced this from multiple errors to a single warning, and subsequent reconnections succeed.

**Impact:** Non-blocking. Chat features may have a ~1 second delay on first page load.

---

### ISSUE-004: No admin-specific navigation or views (Low / UX)

**Description:** Admin users see the same sidebar as customers. No admin panel, user management, dispute resolution, or analytics views exist yet.

**Evidence:** Screenshot qa5-a01-dashboard.png (before rate limit kicked in — showed standard customer sidebar).

---

### ISSUE-005: Public pages lose auth header briefly (Low / UX)

**Description:** When navigating from dashboard to public pages like /jobs, the header briefly shows "Sign in" before AuthRestorer completes the token refresh. This is a cosmetic flash — the auth state is restored after ~500ms.

**Evidence:** Screenshot qa5-c08-browsejobs.png shows "Sign in" header on /jobs despite being logged in.

---

## Pages Tested Per Profile

### Customer (customer@nomarkup.com)
| Page | Status | Notes |
|------|--------|-------|
| Dashboard | **Pass** | Auth persists via refresh token cookie, sidebar nav works |
| Profile | **Pass** | "Jane Customer", customer badge, Edit Profile + Become Provider |
| Contracts | **Pass** | 2 contracts with **job titles** (Kitchen Sink, Ceiling Fan) |
| My Jobs | **Pass** | 3 jobs (active/in_progress/completed), 2 bids on AC Unit |
| Payments | **Pass** | First 4 pages work; later pages hit rate limit |
| Messages | Rate-limited | 429 after multiple profile switches |
| Post Job | Rate-limited | 429 |
| Browse Jobs | **Pass** | 1 active job found, filters visible |

### Provider (provider@nomarkup.com)
| Page | Status | Notes |
|------|--------|-------|
| Dashboard | **Pass** | Shows Provider Dashboard + My Bids nav items |
| Profile | **Pass** | "Mike Provider", provider badge, Edit Profile only |
| Provider Dashboard | **Pass** | Placeholder page loads correctly |
| My Bids | **Pass** | 3 bids with amounts, "Won" badges, View Job links |
| Contracts | **Pass** | Same 2 contracts visible (provider side), job titles shown |
| Browse Jobs | **Issue** | Skeleton loaders stuck (ISSUE-001) |

### Admin (admin@nomarkup.com)
| Page | Status | Notes |
|------|--------|-------|
| Dashboard | Rate-limited | 429 from previous session's login attempts |
| Profile | Partial | Loaded briefly before rate limit cascade |
| Contracts | Rate-limited | 429 |

---

## What's Working Well

1. **Logo branding** — Gold "Markup" accent visible across all pages
2. **Role-based navigation** — Provider sidebar shows Provider Dashboard + My Bids; Customer shows Become a Provider
3. **Contract job titles** — Now display actual job names instead of UUIDs
4. **Same-origin proxy** — API requests go through Next.js rewrites, cookies work
5. **Auth persistence** — Dashboard pages survive hard navigation via refresh token
6. **Responsive design** — Landing and Browse Jobs look great on mobile
7. **Seeded data quality** — 4 users, 3 jobs, 4 bids, 2 contracts, reviews, trust scores
8. **Error states** — Empty states (payments, messages) render cleanly with icons

---

## Console Health
- **Errors:** 429 rate limiting (expected after rapid multi-profile testing)
- **Warnings:** 1 WebSocket warning per session
- **Hydration errors:** 0
- **Framework errors:** 0
