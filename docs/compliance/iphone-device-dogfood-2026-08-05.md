# iPhone device dogfood — 2026-08-05

**Device:** Tanner’s iPhone 15 Pro Max (`00008130-0018493E3A41001C`) — connected  
**Gateway:** `http://127.0.0.1:8081` and `http://192.168.1.101:8081` (both **HTTP 200** health)  
**App:** `com.nomarkup.app` Debug · LAN base for device → `http://192.168.1.101:8081`  
**Seed accounts:** `admin@nomarkup.com` · `customer@nomarkup.com` · `provider@nomarkup.com` / `Password123!`  
**Related reports:**
- [`admin-api-smoke-2026-08-05.md`](./admin-api-smoke-2026-08-05.md) — admin GET matrix, no unexpected 500s  
- [`ios-ui-workflow-matrix-2026-08-05.md`](./ios-ui-workflow-matrix-2026-08-05.md) — Account + tab verification map (API vs UITest vs residual)

---

## Executive summary

| Dimension | Result | Claim boundary |
|-----------|--------|----------------|
| **Readiness** | **YELLOW** | Strong **API + device install/launch** for all three seed roles. **Not** full manual UI 100%. **Not** GREEN on end-to-end touch coverage of every Account row. |
| Gateway reachability | **PASS** | Loopback + LAN both 200 |
| Seed login (admin / customer / provider) | **PASS** | All three → HTTP 200 |
| Full feature API E2E | **PASS** | **71 pass · 0 fail · 2 skip** |
| Legacy smoke E2E | **PASS** | **19 pass · 0 fail** |
| Soft-id payment / Stripe regressions | **PASS** | `cus_dev_*` / `acct_dev_*` no longer 500 |
| Device install + launch (3 roles, auto-login) | **PASS** | Process live per role env |
| Admin API smoke | **PASS** | No unexpected 500s (see dedicated report) |
| Full touch walkthrough (every Account row) | **RESIDUAL GAP** | Not claimed done |
| XCUITest full walk | **UNKNOWN / residual** | May still be running or interrupted this session — do not treat as signed-off |
| Lightsail / remote staging dogfood | **DEFERRED** | Not part of this local-device run |

**Do not claim GREEN 100/100 UI.** This session proves backend contract readiness for dual seed profiles, soft-id resilience, admin read smoke, and physical-device signed-in shell launch for admin/customer/provider auto-login. It does **not** prove every SwiftUI Account destination was human-tapped, every mutation submitted, Stripe PaymentSheet live charge, camera/permissions, or multi-party escrow handshake.

---

## Environment

| Field | Value |
|-------|--------|
| Device | Tanner’s iPhone 15 Pro Max |
| UDID | `00008130-0018493E3A41001C` |
| Connection | Connected (developer / local network dogfood) |
| Gateway (Mac loopback) | `http://127.0.0.1:8081` → **200** |
| Gateway (LAN for device) | `http://192.168.1.101:8081` → **200** |
| Seed logins | admin · customer · provider — all **200** |
| Bundle | `com.nomarkup.app` (Debug auto-login env) |

---

## Suite scoreboard

| Suite | Pass | Fail | Skip | Verdict |
|-------|-----:|-----:|-----:|---------|
| Full feature API E2E (`scripts/ios-full-feature-e2e.sh`) | **71** | **0** | **2** | **GREEN (API)** |
| Legacy API smoke (`scripts/ios-api-e2e-smoke.sh`) | **19** | **0** | 0 | **GREEN (API)** |
| Admin API smoke ([report](./admin-api-smoke-2026-08-05.md)) | — | **0 unexpected 500s** | flag/404 expected | **GREEN (admin GET)** |
| Soft-id regression (`/payments/methods`, `/providers/me/stripe/status`) | 2×200 | 0 | 0 | **GREEN** |
| Device install + launch · admin auto-login | — | — | — | **OK** |
| Device install + launch · customer auto-login | — | — | — | **OK** |
| Device install + launch · provider auto-login | — | — | — | **OK** |
| Full Account-row manual UI matrix | — | — | — | **GAP (residual)** |
| XCUITest / screenshot walk this session | — | — | — | **Not signed off** (may be running/interrupted) |

### Full-feature intentional skips (not failures)

| Skip | Reason |
|------|--------|
| `provider.quote-templates` (or equivalent quote-templates path) | **503** feature-flag gated — fail-closed when flag off; product-correct, not a suite red |
| Listing bid / auction state path | Auction not bidable at moment of run (state/increment/seller rules) — product-correct soft skip, not a hard fail |

Owner-selection fixes (below) restored previously flaky **owner-only** job bid list and **provider place-bid** active-job selection so the pass count holds without spurious reds.

---

## Fixes landed this dogfood window

| Issue | Symptom | Fix / outcome |
|-------|---------|----------------|
| Payment methods soft id | `GET /api/v1/payments/methods` → **500** on `cus_dev_*` Stripe customer ids | Soft handling — **200** (empty/configured path, no crash) |
| Stripe Connect status soft id | `GET /api/v1/providers/me/stripe/status` → **500** on `acct_dev_*` | Soft handling — **200** status object (e.g. transfers not ready) |
| `customer.job.bids` owner selection | E2E could miss owner-only bids list when seed job selection was wrong | Fixed **owner** job selection for bids list |
| `provider.job.bid` active job selection | Provider place-bid could fail when picking non-active / owned job | Fixed **active auction job** selection for provider bid |

Post-fix admin smoke re-checked payment-methods + stripe status with admin dual-role token: both **200** (see admin report § soft-id regression).

---

## Device dogfood (physical)

1. Device connected: UDID `00008130-0018493E3A41001C`.  
2. Gateway healthy on loopback **and** LAN (`192.168.1.101:8081`).  
3. **Install + launch** with DEBUG auto-login env for **all three roles**:
   - Admin seed  
   - Customer seed  
   - Provider seed  
4. Auto-login env: `NOMARKUP_UI_TEST_EMAIL` / `NOMARKUP_UI_TEST_PASSWORD` (and/or `DEVICECTL_CHILD_*` as used by the harness) + `NOMARKUP_API_BASE_URL=http://192.168.1.101:8081`.  
5. Process live after each role launch (signed-in shell). **Admin on iOS** still uses the same 5-tab consumer shell — there is **no** native admin console ([UI matrix honesty rules](./ios-ui-workflow-matrix-2026-08-05.md)).

### What device launch proves vs does not prove

| Proves | Does **not** prove |
|--------|---------------------|
| Binary installs and starts on hardware | Every Account list row opened and exercised |
| Auto-login reaches signed-in tabs for 3 seeds | Mutations (pay, delete, OTP, MFA, Connect onboarding) |
| API base on LAN is reachable from phone process | Stripe PaymentSheet live charge / Apple Pay |
| Shell chrome loads under dogfood config | Full screenshot walk or XCUITest green this session |

---

## Admin API smoke (summary)

Full matrix: [`admin-api-smoke-2026-08-05.md`](./admin-api-smoke-2026-08-05.md).

| Class | Result |
|-------|--------|
| List/detail admin GETs 200 | PASS |
| Flag-gated 503 (e.g. guarantee claims) | PASS (expected) |
| Unknown UUID 404 probes | PASS (expected) |
| Unexpected 5xx | **0** |
| Soft-id payment-methods + stripe status | **2×200 PASS** |

---

## UI workflow matrix (pointer)

Canonical Account + root-tab map with **API e2e / UITest smoke / Screenshot walk / Device launch / Manual residual** tags:

→ [`ios-ui-workflow-matrix-2026-08-05.md`](./ios-ui-workflow-matrix-2026-08-05.md)

Use that file when claiming which surfaces are proven vs residual. This dogfood report does **not** upgrade residual rows to “done.”

---

## Residuals & deferred

| Item | Status | Notes |
|------|--------|-------|
| Full touch walkthrough of **every Account row** | **GAP** | Honest residual; API + tab smoke ≠ row-level human UI |
| XCUITest / screenshot walk completion this session | **Unknown** | May still be running or interrupted — re-run before claiming UI automation green |
| Money rails requiring live Stripe / flags | Residual | Soft-id no longer 500; live onboarding/charge still manual |
| Multi-party escrow / dual confirm | Residual | Out of auto-login scope |
| Camera / permissions / APNs system dialogs | Residual | Device human |
| Listing bid when auction closed/not bidable | Soft skip | Re-run on open listing if product needs green on that mutation |
| Quote templates when flag off | Soft skip 503 | Enable flag only if intentional product dogfood |
| **Lightsail** / remote host dogfood | **DEFERRED** | Local Mac + LAN device only this run |
| GREEN 100/100 UI claim | **Rejected** | Readiness stays **YELLOW** until manual matrix + UITest sign-off |

---

## Readiness judgment

| Level | Meaning | This run |
|-------|---------|----------|
| **GREEN** | API green **and** full manual UI + automation signed off | **No** |
| **YELLOW** | Strong API + device launch; residual human UI / XCUITest | **Yes ← current** |
| **RED** | Blocking 500s, install failure, or login failure | **No** |

**YELLOW** means: safe to continue product dogfood and iterate UI residuals; **not** ready to claim “every Account surface verified on device” or App Store human smoke complete solely from this report.

---

## Reproduce commands

```bash
# Health (loopback + LAN)
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/health
curl -sS -o /dev/null -w '%{http_code}\n' http://192.168.1.101:8081/health

# Seed login smoke (expect 200 bodies with access_token)
for email in admin@nomarkup.com customer@nomarkup.com provider@nomarkup.com; do
  curl -sS -o /dev/null -w "$email %{http_code}\n" \
    -X POST http://127.0.0.1:8081/api/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"${SEED_PASSWORD:-Password123!}\"}"
done

# Full feature API E2E (71 pass / 0 fail / 2 skip expected shape)
API_BASE=http://127.0.0.1:8081 SEED_PASSWORD=Password123! \
  ./scripts/ios-full-feature-e2e.sh

# Or against LAN (same stack the phone uses)
API_BASE=http://192.168.1.101:8081 SEED_PASSWORD=Password123! \
  ./scripts/ios-full-feature-e2e.sh

# Legacy smoke (19 pass / 0 fail)
API_BASE=http://127.0.0.1:8081 SEED_PASSWORD=Password123! \
  ./scripts/ios-api-e2e-smoke.sh

# Soft-id regression (after login token export)
# GET /api/v1/payments/methods
# GET /api/v1/providers/me/stripe/status
# Expect 200, not 500 — detail in admin-api-smoke-2026-08-05.md

# Admin API smoke — follow procedure in:
#   docs/compliance/admin-api-smoke-2026-08-05.md

# Device install + role launch (example pattern; adjust team / derived data as local)
# Build + install Debug, then:
xcrun devicectl device process launch \
  --device 00008130-0018493E3A41001C \
  --terminate-existing \
  --environment-variables \
  '{"NOMARKUP_API_BASE_URL":"http://192.168.1.101:8081","NOMARKUP_UI_TEST_EMAIL":"customer@nomarkup.com","NOMARKUP_UI_TEST_PASSWORD":"Password123!"}' \
  com.nomarkup.app

# Repeat with admin@ / provider@ emails for all three roles.

# XCUITest (simulator smoke — not a substitute for Account row walk)
cd ios && xcodebuild test -scheme NoMarkup \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:NoMarkupUITests
```

---

## Changelog (this document)

| Date | Note |
|------|------|
| 2026-08-05 | Consolidated local iPhone dogfood: API suites, soft-id fixes, 3-role device launch, admin smoke pointer, UI matrix pointer, **YELLOW** readiness, residuals explicit. |
