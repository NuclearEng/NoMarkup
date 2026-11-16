# iOS Simulator UI workflow audit — Account tab + destinations

**Date:** 2026-08-05  
**Workspace:** `/Users/nuclearisotope/Projects/Personal/NoMarkup`  
**Simulator:** iPhone 17 Pro (`7F123C44-2F2C-442B-90A6-92DE8E548510`) · iOS 26.5  
**API:** `http://127.0.0.1:8081` (gateway health **200** `{"status":"ok","version":"dev"}`)  
**Seeds:** `customer@` / `provider@` / `admin@nomarkup.com` · `Password123!`  
**Screenshots:** [`docs/compliance/sim-runs/2026-08-05-full-audit/`](sim-runs/2026-08-05-full-audit/)  
**API probe log:** [`sim-runs/2026-08-05-full-audit/api-probes/account-destinations.txt`](sim-runs/2026-08-05-full-audit/api-probes/account-destinations.txt)

---

## Executive summary

| Area | Result |
|------|--------|
| **Build** | **PASS** — Debug `build-for-testing` for iPhone 17 Pro sim (`/tmp/NoMarkupAccountAuditDD`) |
| **Launch + Account root (customer)** | **PASS** — auto-login lands signed-in; Account shows API desk `127.0.0.1:8081`, no stack overflow |
| **LazyView stack-overflow fix** | **VERIFIED** — every `NavigationLink` in `AccountView` is wrapped in `LazyView` (53/53); Account root loads without “Thread stack size exceeded” |
| **Account destination API contracts** | **PASS** — all critical gateway paths return **200** for seed roles (see API probe) |
| **Admin console (product)** | **PRESENT** — `account.row.admin` gated by `UserProfile.hasAdminRole`; destination `AdminConsoleView` (`admin.console.root`) |
| **Full XCUITest Account row sweep** | **BLOCKED / PARTIAL** — concurrent multi-agent xcodebuild contention on the same UDID (SIGKILL / lost connection); harness expanded for re-run |
| **Wrong API paths** | **None found** on money / provider / admin Account destinations (client paths match gateway) |

---

## Environment notes

1. **Scheme default API** is still `http://192.168.1.101:8081` (LAN dogfood). Simulator Debug falls through to `http://127.0.0.1:8081` when env is unset; this audit forced:
   - App launch: `NOMARKUP_API_BASE_URL=http://127.0.0.1:8081` (UITest `launchEnvironment` + `SIMCTL_CHILD_*`)
2. **Stripe (Rail A)** shows **Not configured** in Account market wiring — expected when `NOMARKUP_STRIPE_PUBLISHABLE_KEY` is unset. Money mutations stay fail-closed; list/status APIs still 200.
3. **Machine load** during the audit was extreme (load averages >100–200) with multiple parallel `xcodebuild test` personas on the same Simulator UDID. That caused:
   - `Failed to clone device` / `BUILD INTERRUPTED`
   - ScreenshotWalk legs ending with **“Test crashed with signal kill”**
   - `testAccountCriticalMoneyRows` **Lost connection to the application** during sign-in setup (not a destination open)

---

## Product verification (Account)

### Account root chrome

| Check | Evidence | Severity if fail |
|-------|----------|------------------|
| Account loads without crash | `00-customer-auto-login.png` — Signed in, market wiring, Finish setup banner | **Critical** — **PASS** |
| API desk host | Shows `127.0.0.1:8081` | Medium (config) — **PASS** |
| Finish setup banner | Customer seed has `display_name=QA Tester` but **empty phone** → banner is **correct** | Info |
| LazyView coverage | 53 `LazyView` / 53 `NavigationLink` in `AccountView.swift` | Critical (historical stack overflow) — **PASS** |
| Admin row gate | Admin seed roles `["admin","provider"]` → `hasAdminRole == true` in code | High — **code PASS** |

### `account.row.*` inventory (AccountView)

Stable IDs present (54 including export button):

`profile`, `providerWorkspace`, `instantOffers`, `security`, `verification`, `postJob`, `drafts`, `sell`, `orders`, `contracts`, `recurringJobs`, `myBids`, `positions`, `myListings`, `watchlist`, `savedSearches`, `sellerAnalytics`, `sellerPayouts`, `businessFinance`, `insuranceQuote`, `salesExport`, `calendarExport`, `team`, `challenges`, `legalServices`, `quoteTemplates`, `verificationDocuments`, `paymentMethods`, `paymentsHistory`, `notifications`, `notificationPreferences`, `providers`, `following`, `followingFeed`, `properties`, `wishlist`, `blockedUsers`, `referrals`, `feedbackSurveys`, `savings`, `markets`, `fairPrice`, `marketplaceMap`, `trustTiers`, `privacyPolicy`, `termsOfService`, `termsAcceptance`, `communityGuidelines`, `support`, `exportData`, `deleteAccount`, `planLimits`, `featureFlags`, **`admin`** (role-gated).

### Destination API contracts (gateway probe)

All of the following returned **HTTP 200** against the local gateway with seed tokens:

| Role | Path | Notes |
|------|------|--------|
| customer | `GET /api/v1/users/me` | dual roles customer+provider |
| customer | `GET /api/v1/payments` | 14 payments |
| customer | `GET /api/v1/payments/methods` | empty list OK |
| customer | `GET /api/v1/me/orders` | seeded orders |
| customer | `GET /api/v1/contracts` | seeded contracts |
| customer | `GET /api/v1/me/watchlist` | seeded |
| customer | `GET /api/v1/listings/bids/mine` | goods bids |
| customer | `GET /api/v1/bids/mine` | service bids |
| provider | `GET /api/v1/provider/offers` | empty offers OK |
| provider | `GET /api/v1/providers/me/stripe/status` | Connect not onboarded |
| provider | `GET /api/v1/providers/me` | profile present |
| provider | `GET /api/v1/me/seller-analytics` | range data |
| admin | `GET /api/v1/admin/flags` | full flag rows |
| admin | `GET /api/v1/admin/disputes` | queue |
| admin | `GET /api/v1/admin/users` | paginated |
| admin | `GET /api/v1/admin/fraud/alerts` | alerts |
| admin | `GET /api/v1/admin/jobs` | jobs |

**Client path alignment (spot-check):**

- Payment methods → `APIClient.fetchPaymentMethods` → `/api/v1/payments/methods` ✅  
- Instant offers → `/api/v1/provider/offers` ✅  
- Seller payouts → providers Stripe status ✅  
- Admin console → `/api/v1/admin/*` ✅  

No wrong-path product bugs identified on Account destinations.

---

## Findings (severity)

### Critical

| ID | Finding | Status |
|----|---------|--------|
| C1 | Historical Account stack overflow (`Thread stack size exceeded`) | **Mitigated** — `LazyView` on all Account `NavigationLink` destinations. Manual Account launch confirmed no crash. |

### High

| ID | Finding | Status |
|----|---------|--------|
| H1 | Admin console must open without crash for `admin@` | **Code ready** — `AdminConsoleView` + `account.row.admin` + hard UITest asserts in `test05` / `test08`. **Live XCUITest on this host was SIGKILLed by concurrent agents** before admin leg completed. Re-run exclusive suite when the sim is free. |
| H2 | Concurrent multi-agent sim contention | **Ops** — multiple `xcodebuild test` processes targeting the same UDID caused lost connections and SIGKILL. Not a product regression; blocks exclusive Account row proof. |

### Medium

| ID | Finding | Status |
|----|---------|--------|
| M1 | Stripe Rail A “Not configured” in Account market wiring | **Expected** without `NOMARKUP_STRIPE_PUBLISHABLE_KEY`. Document for dogfood; payments fail closed. |
| M2 | `simctl openurl nomarkup://…` shows system “Open in NoMarkup?” | **System behavior**. UITest interruption monitors previously preferred **Cancel**, blocking deep links. **Fixed** in harness: prefer **Open** / **Allow** first. |
| M3 | Prior docs claimed “No admin console” on iOS | **Stale** — `AdminConsoleView` + role gate ship in tree. Matrix should be updated on next doc pass. |

### Low / informational

| ID | Finding | Status |
|----|---------|--------|
| L1 | Customer Finish setup banner | Correct — phone empty on seed |
| L2 | Provider Instant offers empty | Correct — `{"offers":[]}` |
| L3 | Seller payouts Connect not onboarded | Correct seed state |
| L4 | Payment methods empty list | Correct — no saved cards |
| L5 | Scheme env still points at LAN `192.168.1.101` | Dogfood default; Simulator override works via env |

---

## Harness changes shipped this audit

### `ScreenshotWalkUITests.swift`

- Force `NOMARKUP_API_BASE_URL` on app launch (Simulator → `127.0.0.1:8081`).
- Complete `account.row.*` ID map (including newer rows: recurring jobs, positions blotter, insurance quote, payments history, fair price index, marketplace map, admin, export).
- `visitAllAccountRowsByID` + `visitAccountRowByID` for exhaustive NavigationLink sweeps.
- **`test06CustomerAccountRowIDSweep`** — every `account.row.*` NavigationLink for customer.
- **`test07ProviderMoneyHubWalk`** — Instant offers / Seller payouts / Business & finance (+ workspace, analytics, team, quotes).
- **`test08AdminAccountAndConsole`** — hard assert Admin console root + spot rows.
- **`test05AdminSessionWalk`** expanded — open Admin console, switch Disputes / Users / Fraud / Jobs tabs, assert no crash.
- Interruption monitor prefers **Open** for custom-scheme confirmations.

### Product (non-breaking)

- `instantOffers.root` accessibility id on `ProviderInstantOffersView`.
- `businessHub.root` accessibility id on `BusinessFeaturesHubView`.

### Build

```text
** TEST BUILD SUCCEEDED **  # /tmp/NoMarkupAccountAuditDD · iPhone 17 Pro
```

---

## Re-run (exclusive sim)

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
export PATH="$DEVELOPER_DIR/usr/bin:$PATH"
export NOMARKUP_API_BASE_URL=http://127.0.0.1:8081
# Ensure no other xcodebuild owns the UDID
xcrun simctl boot 7F123C44-2F2C-442B-90A6-92DE8E548510 2>/dev/null || true
cd ios
caffeinate -i xcodebuild test \
  -scheme NoMarkup \
  -destination 'platform=iOS Simulator,id=7F123C44-2F2C-442B-90A6-92DE8E548510' \
  -derivedDataPath /tmp/NoMarkupAccountAuditDD \
  -only-testing:NoMarkupUITests/ScreenshotWalkUITests/test06CustomerAccountRowIDSweep \
  -only-testing:NoMarkupUITests/ScreenshotWalkUITests/test07ProviderMoneyHubWalk \
  -only-testing:NoMarkupUITests/ScreenshotWalkUITests/test08AdminAccountAndConsole \
  -resultBundlePath /tmp/NoMarkupAccountAudit-rerun.xcresult \
  NOMARKUP_API_BASE_URL=http://127.0.0.1:8081
# Extract screenshots from xcresult attachments → docs/compliance/sim-runs/2026-08-05-full-audit/
```

Manual smoke (auto-login):

```bash
SIMCTL_CHILD_NOMARKUP_API_BASE_URL=http://127.0.0.1:8081 \
SIMCTL_CHILD_NOMARKUP_UI_TEST_EMAIL=admin@nomarkup.com \
SIMCTL_CHILD_NOMARKUP_UI_TEST_PASSWORD='Password123!' \
xcrun simctl launch 7F123C44-2F2C-442B-90A6-92DE8E548510 com.nomarkup.app
# Account → Admin console (bottom Subscriptions section)
```

---

## Screenshots captured this session

Under `docs/compliance/sim-runs/2026-08-05-full-audit/` (non-exhaustive):

| File | Content |
|------|---------|
| `00-customer-auto-login.png` | Account root, signed in, API 127.0.0.1:8081, Finish setup |
| `01-customer-shell.png` / `A11-home*.png` | Home / shell |
| `11-provider-shell.png` / `21-admin-shell.png` | Role launches (some overlaid by openurl dialog when deep-linking) |
| `20-marketplace-list.png`, `30-jobs-list.png`, `40-messages-list.png` | Root tabs |
| `api-probes/account-destinations.txt` | HTTP codes for Account destination APIs |

Deep-link screenshots that show only the system “Open in NoMarkup?” sheet are **not** destination proof (dialog cancel/open race during multi-agent runs).

---

## Prior successful walk (reference)

Earlier same-day full `ScreenshotWalkUITests` (5 tests, 107 attachments) succeeded when the sim was exclusive — see [`screenshot-walk-2026-08-05.md`](screenshot-walk-2026-08-05.md). That walk predated Admin console hard asserts and the new `test06`–`test08` sweeps.

---

## Residual manual checks (when exclusive)

1. Customer: open every Account row via UITest `test06` or manual scroll; screenshot any “Couldn’t load …” with non-empty seed expectation.
2. Provider: Instant offers, Seller payouts, Business & finance (`test07`).
3. Admin: Admin console Flags + 3–4 ops tabs without crash (`test05` / `test08`).
4. Confirm payment method empty state vs load-error (Stripe not configured should still list empty methods, not 500).

---

## Conclusion

**Account tab itself is healthy** under LazyView: builds, launches, signs in, shows correct API desk, and does not stack-overflow. Destination **backend contracts are green** for customer / provider / admin seeds. **Admin console is implemented and role-gated** (doc matrix was stale).  

**Exclusive end-to-end XCUITest proof of every Account NavigationLink was blocked by multi-agent Simulator contention** on this host; the harness to complete that proof is in tree (`test06`–`test08`) and should be re-run alone when no other `xcodebuild test` holds the UDID.
