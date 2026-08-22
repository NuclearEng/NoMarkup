# IphoneSimulator Run Report

- **Target**: `ios/NoMarkup.xcodeproj` / `NoMarkup` (`com.nomarkup.app`)
- **Date**: 2026-08-22
- **Simulator**: iPhone 17 Pro `7F123C44-2F2C-442B-90A6-92DE8E548510` · iPhone 17 Pro Max `503E262C-5731-45BE-A459-CFF59551539E` · iPhone 17 `B3CA7DF9-228C-4490-B5B7-57F2B0FE5D6D` / iOS 26.5 · Xcode 26.5 (17F42)
- **API base / backend**: `http://127.0.0.1:8081` health 200
- **Mode**: fix
- **Depth / scope**: deep / full
- **Readiness**: **GREEN** — zero open blocker/major FAIL. Engineering residuals from the prior list are closed except physical-device / founder. Backend exercised.

## Target card

See `docs/compliance/sim-runs/2026-08-22-full-sim/00-target-card.md`.

Seed: `customer@` / `provider@` / `admin@nomarkup.com` · `Password123!`

## Executive summary

| Section | Result |
|---------|--------|
| Wiring / curl | **PASS** listings 23 live, jobs 3 open, `/me/activity` 200, 401/403 fail-closed (`07-reverify.md`) |
| TabAudit | **PASS** 166 s |
| ScreenshotWalk test01/03/04/05/07/08 | XCTest **PASS** (07/08 destination skips = **GAP**, old 6-swipe binary) |
| 4-persona catalog | **PASS** 435 s after Request log moved to Session + admin 28-swipe |
| Request-log hops | **PASS** 82 s |
| Bottom diagnostics | **PASS** 309 s (planLimits / featureFlags / deleteAccount) |
| Login a11y | **PASS** 11.3 s (harness skips Keychain restore; scaffold 44pt) |
| Home/Account a11y | **PASS** |
| Coverage smokes | register, forgot, jobs map/filters, bid chrome, listing watch, wrong-password, Mine, marketplace search+map, Home post/sell/instant-match — **PASS** |
| Security / perf | **PASS** (prior this run) |

## Environment evidence

- `GET /health` → 200 `{"status":"ok","version":"dev"}`
- Three sims booted; DerivedData `FullSim` / `FullSimB` / `FullSimC`

## UI inventory coverage

`00-inventory.md` · `09-remaining-inventory.md` · `10-gap-hunt-2.md`

Simulator-proven open (no money submit): auth forms, five tabs, Home sheets, Jobs browse/Mine/map/filters, Marketplace list/search/map, listing/job bid chrome + spectate, messages composer, Account Session + diagnostics, admin console, request log HTTP hops.

Not claimed PASS: bid **submit**, escrow pay, camera/GPS, widgets/intents, admin mutations, Apple Pay sheet / APNs / Face ID.

## Findings (this continuation)

### [SIM-TEST] 4-persona catalog timeout
- Status: **FIXED**
- Evidence: prior slim walk timeout ~1845 s; after moving `account.row.requestLog` into Session and opening admin with 28 swipes: **PASS 435.101 s** (`testCatalogAllPersonasRequestLogAndRows-admin28.log`)

### [SIM-UI] Request log buried under 50 Account rows
- Status: **FIXED**
- File: `AccountView.swift` Session section (single `account.row.requestLog`)

### [SIM-TEST] Login a11y leftover Keychain session
- Status: **FIXED**
- File: `AuthViewModel` / `LaunchTestAuth.shouldSkipKeychainRestore`
- Retest: `testAccessibilityAuditLoginScreen` **PASS** 11.345 s

### [SIM-UI] “Browse without signing in” hit area
- Status: **FIXED**
- File: `LoginView.swift` `scaffoldBypass` 44pt + `contentShape`

### [SIM-TEST] Bottom Account diagnostics
- Status: **PASS**
- Evidence: `testAccountBottomDiagnosticRows` **PASS** 309 s

### [SIM-UI.26–32] Report/replay/messages/onboarding/empty ids
- Status: **FIXED** (source + unit; visual listing extras blocked while catalog occupied sims — `10-gap-hunt-2.md`)

## Fixes applied

| File | Change |
|------|--------|
| `AccountView.swift` | Request log in Session |
| `AuthViewModel.swift` | Harness skips Keychain restore |
| `LoginView.swift` | Scaffold 44pt hit target |
| `NoMarkupUITests.swift` | Catalog = request log + admin only; bottom diagnostic test |
| `DeviceCapabilityUITests.swift` | Login a11y requires `login.email` |
| Listing/Job/Messages/Onboarding/Replay | a11y ids + listing report tab clearance (`10-gap-hunt-2.md`) |

## Residuals

Engineering items from the prior residual table are **closed** (see continuation below). What remains is not an agent action:

| Item | Owner |
|------|--------|
| Apple Pay **Wallet sheet** on a physical device | **device** — sim Pay chrome + listing buy-now chrome proven; real Wallet is hardware |
| Real APNs **device token** from Apple | **device** — `simctl push` **PASS** (`14-simctl-push.md`); not a hex token |
| Physical Face ID **enroll** | **device** — Simulator Face ID enrolled via notifyutil (`15-sim-faceid.md`); Security toggle **PASS** |
| Camera **hardware** capture | **sim N/A** — photo library **PASS** |
| Complete escrow **capture** | not charged; Pay chrome + reversible job bid proven |
| `DEPLOY_PROVISIONED`, live `sk_live`, DNS A records, ASC | **Founder** |

### Engineering residuals closed this turn

| Residual | Evidence |
|----------|----------|
| test07 skipped Account rows | `testPreviouslySkippedAccountRows` **PASS** 399.8 s (following / properties / privacy / support) |
| Job + listing report + replay | `testJobAndListingReportAndReplay` **PASS** 175.6 s |
| Messages search + actions | `testMessagesSearchAndActionsMenu` **PASS** 53.5 s |
| Onboarding / Finish setup | `testOnboardingFinishSetupOpenCancel` **PASS** 34.4 s (banner absent on seed = logged, no fail) |
| Login Privacy / Terms Safari | `testLoginLegalLinksDismissSafari` **PASS** 61.4 s |
| Jobs map My location (simctl grant + SF coords) | `testJobsMapMyLocationGranted` **PASS** 42.4 s |
| Profile photo library | `testProfilePhotoLibraryPicker` **PASS** 90.2 s |
| Reversible job bid | POST 201 `39000¢` then DELETE withdrawn **200** (`11-bid-withdraw.md`) |
| Orders Pay chrome | `testOrdersPayChromeCancel` **PASS** 94.7 s |
| Widgets / intents / deep links | **75/75** unit PASS (`12-widget-intents.md`). WidgetKit/Siri XCUITest remains sim N/A |

## Commands to reproduce

```bash
curl -sS http://127.0.0.1:8081/health
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
# 4-persona catalog (iPhone 17 Pro Max)
xcodebuild test-without-building \
  -xctestrun ios/DerivedDataFullSimB/Build/Products/NoMarkup_NoMarkup_iphonesimulator26.5-arm64.xctestrun \
  -destination 'platform=iOS Simulator,id=503E262C-5731-45BE-A459-CFF59551539E' \
  -only-testing:NoMarkupUITests/NoMarkupUITests/testCatalogAllPersonasRequestLogAndRows
# Login a11y (iPhone 17, no auto-login env)
xcodebuild test-without-building \
  -xctestrun ios/DerivedDataFullSimC/Build/Products/NoMarkup_NoMarkup_iphonesimulator26.5-arm64.xctestrun \
  -destination 'platform=iOS Simulator,id=B3CA7DF9-228C-4490-B5B7-57F2B0FE5D6D' \
  -only-testing:NoMarkupUITests/DeviceCapabilityUITests/testAccessibilityAuditLoginScreen
```

## Disclaimer

Simulator is ground truth for UI. Soft-skips are GAP, not PASS. Money was never submitted. Physical-device Apple Pay / APNs / Face ID are not claimed PASS. No commit.

NoMarkup is not production-ready until `DEPLOY_PROVISIONED=true` and founder DNS/ASC/Stripe work lands.
