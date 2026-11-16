# Widget / App Intents / deep-link residual — 2026-08-22

In-process **unit tests** for widget snapshot merge, App Intent session guards, and deep-link parse/delivery. **Not** a SpringBoard / Siri / Control Center / Live Activity walk.

**No commit. No product Swift edits. Did not touch `DerivedDataFullSim`, `DerivedDataFullSimB`, or `DerivedDataFullSimC`.**

| Field | Value |
|--------|--------|
| Sim | iPhone 17e `5B84AFEE-78CD-4427-A536-95EE91D81220` / iOS 26.5 (23F77) arm64 |
| Occupied (avoided) | 17 Pro `DerivedDataFullSim` · 17 Pro Max `DerivedDataFullSimB` · 17 `DerivedDataFullSimC` |
| Xcode | 26.5 (17F42) · `DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer` |
| Scheme | `ios/NoMarkup.xcodeproj` `NoMarkup` |
| DerivedData | `ios/DerivedDataWidgetResidual` |
| xcresult | `ios/DerivedDataWidgetResidual/widget-intents.xcresult` |
| Log | `ios/DerivedDataWidgetResidual/widget-intents.log` |
| Inventory | [`00-inventory.md`](00-inventory.md) §10 App Intents / widgets / Live Activities |

---

## Verdict

| Claim | Status |
|-------|--------|
| `xcodebuild test` **TEST SUCCEEDED** | **YES** |
| Selected `NoMarkupTests` classes | **75/75 PASS**, 0 fail, 0 skip |
| XCUITest of WidgetKit / Siri / Control Center / Live Activities / Dynamic Island | **sim N/A** (see below) |
| Siri phrase actually spoken, widget gallery add, Lock Screen Live Activity | **not executed** — no XCTest path on Simulator |

**Unit layer is XCTest-green. WidgetKit/Siri surfaces remain un-driven on sim.**

---

## PASS / FAIL per class

`Result` = XCTest suite line (`Test Suite '…' passed` + `0 failures`). Times are suite-reported (`Executed N tests … in T (wall) seconds`).

| Class | File | Tests | Time | Result | Covers |
|-------|------|------:|-----:|--------|--------|
| `WidgetSharedStoreTests` | `WidgetSharedStoreTests.swift` | 6 | 0.018 s | **PASS** | App-group snapshot merge: goods+services rails, next-closing, live-only goods, withdrawable services |
| `NotificationDeepLinkTests` | `NotificationDeepLinkTests.swift` | 13 | 0.012 s | **PASS** | Push `action_url` → job/contract/listing/messages/orders; `nomarkup://` / HTTPS path parse; `/jobs` browse vs `/jobs/new` post; dangerous-scheme reject |
| `AppIntentsAuthGuardTests` | same | 21 | 0.723 s | **PASS** | `IntentAuthGuard` signed-out throws (iOS 18 `AppIntentError`); signed-in `perform()` routes My Bids / Watchlist / Post Job / Check In / Search / Open Listing; injected check-in API; empty Keychain = signed out |
| `DeepLinkOrdersRouteTests` | same | 8 | 0.004 s | **PASS** | Typed `.orders(id:)` from `/orders*`, `/order`, `nomarkup://orders`, HTTPS universal link; delivery to `DeepLinkRouter.shared` |
| `NotificationActionBranchTests` | same | 3 | 0.001 s | **PASS** | Default tap + View action deep-link; dismiss / unknown never navigate; new-message category registered |
| `DeepLinkIncomingSchemeTests` | same | 4 | 0.003 s | **PASS** | Incoming allowlist (`nomarkup`, https, loopback http); `javascript:` / `file:` / `data:` rejected |
| `AppIntentsEntityTests` | same | 6 | 0.005 s | **PASS** | `JobEntity` / `ListingEntity` / `ContractEntity` query offline; suggested listings mirror widget snapshot; visual-search matcher |
| `CatalogSearchDeepLinkTests` | same | 4 | 0.003 s | **PASS** | `/marketplace?q=` / `/jobs?q=` / `nomarkup://marketplace?q=` typed `.catalogSearch`; action-URL round-trip |
| `AppIntentsTestingFrameworkTests` | same | 2 | 0.002 s | **PASS** | In-process `AppIntent.perform()` stand-in (see honesty). Visual Intelligence query compiles / empty-label matcher |
| `LocalizedPluralsTests` | `LocalizedPluralsTests.swift` | 8 | 0.005 s | **PASS** | Widget catalog `%lld active bids` via `NoMarkupWidget.appex`; intent dialog “You have N active bid(s)”; `spokenDeadline` |

**Totals (xcresult):** passed **75** · failed **0** · skipped **0** · selected-suite wall **0.777 s**. Test observer elapsed **9.421 s** (includes host launch). Session start→finish ~65 s.

---

## XCUITest of WidgetKit / Siri — sim N/A

There is **no** XCUITest in `NoMarkupUITests` that:

- Opens the Widget gallery / adds `ActiveBidsWidget` / `NextClosingWidget`
- Taps a widget on Home / Lock Screen / StandBy
- Invokes Siri or Shortcuts UI (`OpenMyBidsIntent` phrases, `system.search`)
- Presents Control Center `PostJobControlWidget` / `CheckInControlWidget`
- Starts or asserts an Auction Live Activity / Dynamic Island
- Drives Visual Intelligence camera (`ListingVisualSearchQuery` is compile/unit only)

Simulator SpringBoard, Siri, Control Center, and Live Activities are not a reliable XCUITest destination on this Xcode 26.5 / iOS 26.5 stack. Inventory already records this: [`00-inventory.md`](00-inventory.md) §13 *“Widgets, Live Activities, Control Center, App Intents, Visual Intelligence — **No XCUITest** (unit tests for deep-link parse / widget store exist under `NoMarkupTests`)*.” ScreenshotWalk also does not drive Siri/widgets.

This residual **does not close** that gap. It only proves the in-app parse / store / `perform()` layer.

---

## Honesty bar

- **PASS here ≠ user-felt widget or Siri.** Tests call `AppIntent.perform()` and `DeepLinkRouter` inside the app process with a stub `IntentSessionProviding`. They do not go through `AppIntentsTesting.IntentDefinitions` (absent from iPhoneOS 26.5 / Xcode 26.5.0; comment in `AppIntentsTestingFrameworkTests`).
- Visual Intelligence: `testVisualIntelligenceQueryCompilesWhenFrameworkPresent` **PASS**. The `#if canImport(VisualIntelligence)` body is compile-gated; empty-label matcher always runs. Not a camera/semantic-search device walk.
- `CheckInToJobIntent` production path **does not POST GPS**; only the injected-API test posts. Failure-still-deep-links is also in-process.
- Build warning (widget target): `appintentsmetadataprocessor` *“Metadata extraction skipped. No AppIntents.framework dependency found.”* Host-app intent metadata is a separate extraction. Not treated as a test failure.
- Log noise: `Unbalanced calls to begin/end appearance transitions` during `testOpenMyBidsIntentSignedOutThrows` — XCTest still **PASS**.
- **Not selected:** `WebSocketURLSecurityTests` (same file, chat/auction WS URL hygiene — out of widget/intent/deeplink scope).

---

## Command (rerun)

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
xcodebuild test \
  -project ios/NoMarkup.xcodeproj -scheme NoMarkup \
  -destination 'platform=iOS Simulator,id=5B84AFEE-78CD-4427-A536-95EE91D81220' \
  -derivedDataPath ios/DerivedDataWidgetResidual \
  -only-testing:NoMarkupTests/WidgetSharedStoreTests \
  -only-testing:NoMarkupTests/NotificationDeepLinkTests \
  -only-testing:NoMarkupTests/DeepLinkOrdersRouteTests \
  -only-testing:NoMarkupTests/NotificationActionBranchTests \
  -only-testing:NoMarkupTests/AppIntentsAuthGuardTests \
  -only-testing:NoMarkupTests/DeepLinkIncomingSchemeTests \
  -only-testing:NoMarkupTests/AppIntentsEntityTests \
  -only-testing:NoMarkupTests/CatalogSearchDeepLinkTests \
  -only-testing:NoMarkupTests/AppIntentsTestingFrameworkTests \
  -only-testing:NoMarkupTests/LocalizedPluralsTests \
  -resultBundlePath ios/DerivedDataWidgetResidual/widget-intents.xcresult \
  -parallel-testing-enabled NO
```

`name=iPhone 17e` also resolves to this UDID when only one 17e exists.
