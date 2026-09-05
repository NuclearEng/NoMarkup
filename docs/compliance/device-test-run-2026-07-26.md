# Device + automated test run — 2026-07-26

**Device:** Tanner’s iPhone · iPhone 15 Pro Max · iOS 26.5.2 · UDID `00008130-0018493E3A41001C`  
**API:** `http://192.168.1.101:8081` (Info.plist `APIBaseURL`)  
**Build:** Debug `com.nomarkup.app` 0.1.0 (2)

---

## Device

| Step | Result |
|------|--------|
| Install | **PASS** |
| Launch | **PASS** (PID observed live) |
| Auto-login env (`NOMARKUP_UI_TEST_EMAIL/PASSWORD`) | **PASS** — launched with customer seed via `devicectl --environment-variables` |

---

## API E2E (`scripts/ios-api-e2e-smoke.sh`)

**19 pass / 0 fail** against LAN gateway:

| Area | Result |
|------|--------|
| Health, flags, public jobs/listings/map | PASS |
| Customer login + me / jobs/mine / orders / notifications / contracts / watchlist / saved-searches / channels | PASS |
| Provider login + bids/mine / listing bids / seller-analytics | PASS |

---

## XCUITest (Simulator iPhone 17)

| Test | Result |
|------|--------|
| `testColdLaunchShowsLoginOrTabs` | **passed** (~5–6s) |
| `testLoginWithEnvCredentials` | **passed** (~5s) — seed customer auto-login / form path |

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
cd ios
xcodebuild test -project NoMarkup.xcodeproj -scheme NoMarkup \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:NoMarkupUITests
```

---

## Compile / static (prior agent)

| Gate | Result |
|------|--------|
| Simulator + device compile | PASS |
| No XCTest unit target (UITests only) | noted |
| Zero `try!` / `fatalError` | PASS |
| AppIcon 1024 RGB | PASS |

---

## How to re-run device auto-login

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
# After install:
xcrun devicectl device process launch \
  --device 00008130-0018493E3A41001C \
  --environment-variables '{"NOMARKUP_UI_TEST_EMAIL":"customer@nomarkup.com","NOMARKUP_UI_TEST_PASSWORD":"Password123!"}' \
  com.nomarkup.app
```

DEBUG builds honor those env keys in `AuthViewModel.applyLaunchTestCredentialsIfNeeded()`.

---

## Overall

**PASS** — gateway catalog + authenticated surfaces green; XCUITests green on Simulator; app running on unlocked physical device with seed auto-login path.

Human residual (optional): Apple Pay (needs Stripe key), production DNS, visual tab-by-tab dogfood.
