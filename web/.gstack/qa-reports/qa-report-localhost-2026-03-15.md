# QA Report: NoMarkup (localhost:3000)

**Date:** 2026-03-15
**Duration:** ~15 minutes
**Mode:** Full
**Framework:** Next.js 15 (App Router)
**Pages Visited:** 10
**Screenshots:** 11

---

## Health Score: 78/100

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| Console | 70 | 15% | 10.5 |
| Links | 100 | 10% | 10.0 |
| Visual | 100 | 10% | 10.0 |
| Functional | 70 | 20% | 14.0 |
| UX | 77 | 15% | 11.6 |
| Performance | 100 | 10% | 10.0 |
| Content | 100 | 5% | 5.0 |
| Accessibility | 92 | 15% | 13.8 |
| **Total** | | | **84.9** |

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 2 |

---

## Top 3 Things to Fix

1. **Token refresh fails on hard navigation** — Dashboard pages redirect to login when accessed via URL bar or page refresh. The refresh token cookie isn't being sent/accepted correctly by the `/api/v1/auth/refresh` endpoint (returns 500).
2. **Contract cards show truncated UUID** — The `job_title` field was added to the proto/backend but isn't populating yet in the API response (proto needs regeneration).
3. **WebSocket chat connection unstable** — Initial connection attempt fails with "closed before established", though subsequent retries may succeed.

---

## Issues

### ISSUE-001: Auth refresh fails on hard page navigation (High / Functional)

**Description:** When navigating to any dashboard route via URL bar (not client-side link), the AuthGuard correctly attempts `refreshToken()`, but the refresh endpoint returns 500. User is redirected to login.

**Repro:**
1. Login as customer@nomarkup.com
2. Navigate to dashboard (works via client-side redirect)
3. Type `localhost:3000/payments` in URL bar
4. Observe redirect to login page

**Impact:** Users lose session on page refresh or bookmarked URLs.

**Evidence:** Screenshots qa2-07-payments.png, qa2-08-messages.png, qa2-09-postjob.png all show login redirect. Console shows 500 on `/api/v1/auth/refresh`.

---

### ISSUE-002: Contract cards show truncated UUID instead of job title (Medium / Content)

**Description:** Contract cards display "Job: 00000000..." (truncated UUID) instead of the job title. The `job_title` field was added to the backend but the proto-generated Go code may need regeneration via `make proto-gen`.

**Repro:**
1. Login and navigate to Contracts page
2. Observe "Job: 00000000..." on both contract cards

**Evidence:** Screenshot qa2-04-contracts.png

---

### ISSUE-003: WebSocket chat connection warning on every page (Medium / Functional)

**Description:** A WebSocket connection warning appears in console on every authenticated page load: "WebSocket is closed before the connection is established." The connection to `ws://localhost:8080/ws/chat` initiates but closes immediately.

**Impact:** Chat/real-time features may not work. Not a blocking error (warning, not error), but indicates the WS proxy needs investigation.

**Evidence:** Console output on every authenticated page.

---

### ISSUE-004: Dashboard sidebar hidden on mobile (Low / UX)

**Description:** The sidebar navigation uses `hidden lg:block`, so it's invisible on mobile. There's a hamburger menu in the header, but it only shows auth actions (Sign out), not the dashboard navigation links (Profile, Contracts, etc.).

**Evidence:** Not directly tested — inferred from CSS classes in layout.

---

### ISSUE-005: Browse Jobs page loses auth state (Low / UX)

**Description:** The public `/jobs` page always shows "Sign in" in the header even if the user was previously authenticated. This is because it's outside the dashboard layout group and has no AuthGuard. The auth state is lost when navigating from dashboard to public pages via full navigation.

**Evidence:** Screenshot qa2-06-browse-jobs.png — header shows "Sign in" / "Get started".

---

## Pages Tested

| Page | Status | Notes |
|------|--------|-------|
| Landing (`/`) | Pass | Clean, no errors, responsive |
| Login (`/login`) | Pass | Form works, redirects to dashboard |
| Dashboard (`/dashboard`) | Pass | Auth persists, sidebar nav works |
| Profile (`/profile`) | Pass | Shows user data, Edit/Become Provider buttons |
| Contracts (`/contracts`) | Pass* | Data loads, *job title shows UUID |
| My Jobs (`/jobs/mine`) | Pass | All 3 jobs with correct statuses |
| Browse Jobs (`/jobs`) | Pass | 1 active job found, filters work |
| Payments (`/payments`) | Fail | Redirects to login (refresh token issue) |
| Messages (`/messages`) | Fail | Redirects to login (refresh token issue) |
| Post Job (`/jobs/new`) | Fail | Redirects to login (refresh token issue) |

## Mobile Responsiveness

| Page | Status | Notes |
|------|--------|-------|
| Landing (375px) | Pass | Stacks correctly, hamburger menu visible |
| Browse Jobs (375px) | Pass | Filters stack above results, job cards adapt |

## Console Health

- **Errors:** 3 (all from refresh token 500s on hard navigation)
- **Warnings:** 1 recurring WebSocket warning per page load
- **Hydration errors:** 0
- **Framework errors:** 0
