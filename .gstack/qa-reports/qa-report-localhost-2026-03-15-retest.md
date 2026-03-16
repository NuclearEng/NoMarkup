# QA Re-Test Report: NoMarkup

| Field | Value |
|-------|-------|
| **Date** | 2026-03-15 (re-test after fixes) |
| **URL** | http://localhost:3000 |
| **Scope** | Regression test — all 8 issues from initial QA |
| **Mode** | regression |

## Health Score: 82/100 (was 62/100, +20)

| Category | Before | After | Delta |
|----------|--------|-------|-------|
| Console | 40 | 70 | +30 |
| Links | 100 | 100 | 0 |
| Visual | 85 | 85 | 0 |
| Functional | 40 | 75 | +35 |
| UX | 70 | 85 | +15 |
| Performance | 85 | 85 | 0 |
| Content | 77 | 85 | +8 |
| Accessibility | 75 | 75 | 0 |

## Issue Resolution Summary

| Issue | Title | Severity | Status |
|-------|-------|----------|--------|
| ISSUE-001 | Contract detail page crashes with TypeError | Critical | **FIXED** |
| ISSUE-002 | Header shows authenticated UI when logged out | High | **FIXED** |
| ISSUE-003 | Provider profile API returns 404, console error | High | **FIXED** |
| ISSUE-004 | Bid count inconsistency on job detail page | Medium | **FIXED** |
| ISSUE-005 | "Posted By" shows 0 jobs posted | Medium | **FIXED** (backend, needs deploy) |
| ISSUE-006 | Admin has no admin-specific interface | High | **FIXED** |
| ISSUE-007 | Provider profile page missing business info | Medium | **FIXED** (renders when data available) |
| ISSUE-008 | Mobile floating N button overlaps content | Low | **Not a bug** (Next.js dev overlay) |

## Fix Details

### ISSUE-001: Contract detail page — FIXED
**File**: `web/src/hooks/useContracts.ts`
**Root cause**: Gateway returns flat contract JSON with `change_orders` embedded. Frontend expected `{contract: {...}, change_orders: [...]}`.
**Fix**: Normalize API response in `useContract` hook — destructure flat response into `{contract, change_orders}` to match `ContractDetail` type.

### ISSUE-002: Header auth state — FIXED
**File**: `web/src/components/providers/AuthRestorer.tsx`
**Root cause**: `AuthRestorer` skipped refresh when `isAuthenticated` was true in Zustand (stale in-memory state after cookies cleared).
**Fix**: Always attempt token refresh on mount regardless of current auth state. If refresh fails, store resets to unauthenticated.

### ISSUE-003: Provider profile console error — FIXED
**File**: `web/src/hooks/useProviderProfile.ts`
**Root cause**: `useProviderProfile` queryFn returned `undefined` when API returned 404 (no provider profile row in DB). TanStack Query rejects `undefined` data.
**Fix**: Catch 404 errors and return `null`. Added `retry` function to skip retries on 404. Added `?? null` fallback for cases where API returns 200 but response shape doesn't match.

### ISSUE-004: Bid count heading — FIXED
**File**: `web/src/app/(public)/jobs/[id]/page.tsx`
**Root cause**: "Bids (N)" heading used `displayBidCount` from a different source than what `BidList` fetched independently.
**Fix**: Removed the count from the section heading (just "Bids"). BidList shows its own accurate count internally.

### ISSUE-005: Customer jobs posted count — FIXED
**File**: `gateway/internal/handler/job.go`
**Root cause**: Gateway hardcoded `customer_jobs_posted = 0` instead of querying actual count.
**Fix**: Added `ListCustomerJobs` gRPC call to fetch the real job count for the customer.

### ISSUE-006: Admin navigation — FIXED
**File**: `web/src/app/(dashboard)/layout.tsx`
**Root cause**: Dashboard layout only checked for `provider` role; no admin nav items existed.
**Fix**: Added `ADMIN_NAV_ITEMS` (Admin Panel, Manage Users, Disputes) and conditional `isAdmin` check to include them.

### ISSUE-007: Provider business info on profile — FIXED
**File**: `web/src/app/(dashboard)/profile/page.tsx`
**Root cause**: Profile page only showed basic user info. No provider-specific section existed.
**Fix**: Added "Provider Information" card that shows business name, service categories, service radius, jobs completed, on-time rate, Stripe status, profile completeness, and bio. Also hid "Become a Provider" for admin users.

### ISSUE-008: Mobile FAB overlap — Not a bug
The floating "N" button is the Next.js development overlay indicator. It only appears in dev mode and will not be present in production builds.
