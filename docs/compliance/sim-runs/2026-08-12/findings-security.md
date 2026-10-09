# SIM-SEC — iOS client security (2026-08-12)

- **Target**: `ios/NoMarkup.xcodeproj` scheme `NoMarkup` · bundle `com.nomarkup.app`
- **Date**: 2026-08-12
- **Simulator**: iPhone 17 Pro Max (`503E262C-5731-45BE-A459-CFF59551539E`) / iOS 26.5
- **API base / backend**: Debug sim `http://127.0.0.1:8081` (gateway `/health` → 200). Release default `https://api.no-markup.com`
- **Mode**: fix · **Depth**: deep · **Scope**: security (SIM-SEC.1–10 + ATS / chat media / WS query / Keychain ACL)
- **Readiness**: **GREEN** (zero open blocker/major FAIL after fixes)

Known this run (not a finding): unsigned `CODE_SIGNING_ALLOWED=NO` produced Keychain `-34018`. Signed adhoc (“Sign to Run Locally”) login works via argv. Empty entitlements dict on adhoc sim binary is expected — do **not** weaken Release entitlements.

---

## Target card

| Field | Value |
|-------|-------|
| Project / scheme | `ios/NoMarkup.xcodeproj` / `NoMarkup` |
| Bundle id | `com.nomarkup.app` |
| Simulator | iPhone 17 Pro Max / iOS 26.5 |
| API base (Debug sim) | `http://127.0.0.1:8081` |
| API base (Release) | `https://api.no-markup.com` |
| Backend health | up (`curl` `/health` 200) |
| Mode | fix |
| Depth / scope | deep / security |

---

## Verdict

| ID | Check | Status |
|----|-------|--------|
| SIM-SEC.1 | Release API base HTTPS | **PASS** |
| SIM-SEC.2 | `NSAllowsLocalNetworking` absent from shipping plist | **FIXED** |
| SIM-SEC.3 | Tokens not in UserDefaults | **PASS** |
| SIM-SEC.4 | No `sk_live` / private keys in repo | **PASS** |
| SIM-SEC.5 | Signed-out cannot open account-only destinations | **PASS** |
| SIM-SEC.6 | Legal via SFSafariViewController (or system Safari) | **PASS** |
| SIM-SEC.7 | No access tokens in client logs | **PASS** |
| SIM-SEC.8 | Deep links: `javascript:` / `file:` rejected | **FIXED** |
| SIM-SEC.9 | Biometric gate on delete account / remove PM | **PASS** |
| SIM-SEC.10 | Debug auto-login not in Release | **PASS** |
| Extra | ATS fail-closed (archive lint) | **FIXED** (same as .2) |
| Extra | Chat media host allowlist | **PASS** |
| Extra | WS token not in query | **PASS** |
| Extra | Keychain `AfterFirstUnlockThisDeviceOnly` | **PASS** |

**Open FAIL:** none. **Do not commit** (per task).

---

## Findings

### [SIM-SEC.1] Release API base is HTTPS
- Status: PASS
- Severity: blocker
- Surface: `AppConfig.apiBaseURL` / Info.plist `APIBaseURL`
- Evidence:
  - `ios/NoMarkup/Info.plist` `APIBaseURL` empty (production HTTPS default).
  - `ios/NoMarkup/Core/AppConfig.swift:129-153` — `#if DEBUG` `allowCleartext = true`; Release `false`. `#if !DEBUG` belt: non-HTTPS resolved URL is logged (host only) and replaced with `productionAPIBaseURL` (`https://api.no-markup.com`).
  - `ios/NoMarkupTests/AppConfigTests.swift` `testReleaseRejectsCleartextEnvAndPlist`, `testIsHTTPSAPIBaseRejectsHTTP`, `testResolveFallsBackToProductionHTTPSWhenEmpty` — passed 2026-08-12 (`/tmp/nomarkup-sim-sec-derived/Logs/Test/Test-NoMarkup-2026.08.12_17-43-26--0700.xcresult`).
  - `scripts/ios-archive-lint.sh`: `APIBaseURL is release-safe (empty → AppConfig production HTTPS)`.
- Expected: Release never uses cleartext HTTP.
- Actual: Release rejects env/plist `http://…` and forces production HTTPS.
- Remediation: none
- Confidence: 10

### [SIM-SEC.2] Shipping plist had `NSAllowsLocalNetworking`
- Status: FIXED
- Severity: major
- Surface: ATS / shipping `Info.plist` (shared Debug+Release; `GENERATE_INFOPLIST_FILE=NO`)
- Evidence:
  - **Before:** `ios/NoMarkup/Info.plist` (pre-fix) `NSAppTransportSecurity` → `NSAllowsLocalNetworking=true`. Reintroduced in `abd188a2` (2026-08-06) after `ac004cb8` had stripped it. Archive lint: `FAIL: NSAppTransportSecurity must be absent from shipping Info.plist`.
  - Checklist: “NSAllowsLocalNetworking absent from committed shipping plist (Debug exception ok if documented)”. A comment is **not** a Debug-only plist — this file ships in Release.
  - **After:** keys removed. Documented Debug path: Simulator loopback (OS ATS allows `127.0.0.1`); device dogfood via HTTPS tunnel / scheme env. `PlistBuddy Print :NSAppTransportSecurity` → `Does Not Exist`. `scripts/ios-archive-lint.sh` → `OK: ATS has no exceptions in Info.plist (default HTTPS-only)`.
- Expected: no ATS exception keys in the committed shipping plist.
- Actual (before): local-networking exception in the one plist used by Archive/Release.
- Remediation: deleted `NSAppTransportSecurity` block; restored fail-closed comment (do not re-add to make LAN HTTP greener).
- Retest: `bash scripts/ios-archive-lint.sh` — pass. Parsed key count: 0 `NSAppTransportSecurity`, 0 `NSAllowsLocalNetworking`.
- Confidence: 10

### [SIM-SEC.3] Tokens not in UserDefaults
- Status: PASS
- Severity: blocker
- Surface: `KeychainTokenStore` / session restore
- Evidence:
  - Access + refresh: `ios/NoMarkup/Core/KeychainTokenStore.swift:7-9` accounts `com.nomarkup.auth.accessToken` / `.refreshToken`.
  - Writers: `APIClient` / `APIClient+Auth` `tokenStore.save`; no `UserDefaults.set` of JWT/password.
  - UserDefaults usage is non-secret: Debug dogfood API base (`AppConfig.dogfoodAPIBaseDefaultsKey`, `#if DEBUG` only), biometric preference (`BiometricGate`), StoreKit local entitlement cache, widget App Group snapshots (no tokens).
- Expected: tokens only in Keychain.
- Actual: Keychain only.
- Remediation: none
- Confidence: 9

### [SIM-SEC.4] No `sk_live` / private keys in repo
- Status: PASS
- Severity: blocker
- Surface: repo grep
- Evidence:
  - No committed `sk_live_[A-Za-z0-9…]` / `sk_test_[A-Za-z0-9]{10,}` values.
  - No `-----BEGIN … PRIVATE KEY-----` blobs.
  - Mentions only: docs (`deploy/k8s/SECRETS.md` placeholder `sk_live_…`), UI copy (`AccountView` tells Debug to set `pk_test` via env).
  - Plist `StripePublishableKey` / `GoogleIosClientID` / `FacebookAppID` empty.
- Expected: no live Stripe secrets or PEM private keys in tree.
- Actual: none found.
- Remediation: none
- Confidence: 9

### [SIM-SEC.5] Signed-out cannot open account-only destinations
- Status: PASS
- Severity: major
- Surface: Login vs Account / App Intents / custom scheme
- Evidence:
  - `RootView` (`NoMarkupApp.swift:66-75`) mounts `RootTabView` only when `auth.isAuthenticated`; else `LoginView`.
  - App Intents: `IntentAuthGuard.requireSession` (`NoMarkupAppShortcuts.swift:39-47`). Tests `testOpenMyBidsIntentSignedOutThrows`, `testOpenWatchlistIntentSignedOutThrows`, `testOpenPostJobIntentSignedOutThrows`, `testCheckInToJobIntentSignedOutThrows` — passed; signed-out `perform()` does not set `DeepLinkRouter.route`.
  - Simulator (fresh install, no tokens): `xcrun simctl openurl … nomarkup://bids` and `nomarkup://orders` stay on **Sign in** under the system “Open in NoMarkup?” sheet — never My Bids / My Orders. Screenshots: `docs/compliance/sim-runs/2026-08-12/SEC05-signedout-bids-prompt.png`, `SEC05-signedout-after-bids.png`.
  - Scaffold “Browse without signing in” can show chrome but account mutations fail closed (`isScaffoldSession` guards + sign-in empty states). No tokens.
- Expected: signed-out user cannot land on account-only UI without authenticating.
- Actual: LoginView remains; intents throw; custom scheme does not swap in Account destinations.
- Remediation: none
- Confidence: 9

### [SIM-SEC.6] Legal via SFSafariViewController / system Safari
- Status: PASS
- Severity: advisory
- Surface: Privacy / Terms / Guidelines / Support
- Evidence:
  - In-app legal sheets: `LegalWebView` → `SFSafariViewController` (`ios/NoMarkup/Features/LegalWebView.swift:1-36`). Account (`AccountView.swift:918-920`), Terms acceptance, listing/job “on web”, Stripe onboarding.
  - Login footer: `Link("Privacy"/"Terms")` to `AppConfig.privacyURL` / `termsURL` (HTTPS `no-markup.com`) — system Safari, not a WKWebView.
  - No `WKWebView` / `WKScriptMessageHandler` / `evaluateJavaScript` in `ios/NoMarkup`.
  - `AppConfigTests.testLegalURLsAreHTTPSOnPublicSite` passed.
- Expected: legal HTML not in an arbitrary JS-bridge WebView.
- Actual: SFSafariViewController or `Link` to HTTPS marketing site.
- Remediation: none
- Confidence: 9

### [SIM-SEC.7] No access tokens in client logs
- Status: PASS
- Severity: major
- Surface: `NSLog` / `os_log` / `print` in app target
- Evidence:
  - App-target `NSLog` only: `AppConfig.logInsecureBaseOnce` — host only, never the URL userinfo/query (`AppConfig.swift:476-482`).
  - No `print` / `Logger` / `os.log` of `Authorization` / access tokens in `ios/NoMarkup/**`.
  - WS clients: comments + `// Do not log request or token` (`ChatWebSocketClient.swift:160`, `AuctionWebSocketClient.swift:184`).
- Expected: JWTs never in NSLog/os_log.
- Actual: none found.
- Remediation: none
- Confidence: 8

### [SIM-SEC.8] Deep links accepted `javascript:` / `file:` via fallback
- Status: FIXED
- Severity: major
- Surface: `DeepLinkRouter.handle` / `NotificationDeepLink.normalizedPath`
- Evidence:
  - **Before:** `handle(url:)` stored any non-empty `absoluteString` when `route(from:)` returned nil. `NotificationDeepLink.normalizedPath` took `URL.path` from **any** scheme, so `file:///jobs/{uuid}` and `javascript:/jobs/{uuid}` opened `JobDetailView`.
  - **After:** `DeepLinkRouter.isAllowedIncomingURL` allowlists `nomarkup` / `https` / `http` only. `handle` and `open(actionURL:)` reject the rest. `normalizedPath` independently rejects other schemes (no MainActor hop).
  - Unit tests (passed): `DeepLinkIncomingSchemeTests.testHandleRejectsJavaScriptAndFileSchemes`, `testOpenActionURLRejectsDangerousSchemes`, `testHandleStillAcceptsNomarkupAndHTTPS`, `NotificationDeepLinkTests.testDestinationRejectsDangerousSchemesEvenWhenPathLooksValid`.
  - Simulator OS: `simctl openurl javascript:alert(1)` and `data:text/html,hi` → `LSApplicationWorkspaceErrorDomain` 115 (not delivered). `file:///jobs/{uuid}` opened the Files UI, not Job detail (`SEC08-after-dangerous-schemes.png` / Files “On My iPhone”).
- Expected: only validated routes; `javascript:` / `file:` / `data:` never become destinations.
- Actual (before): path extraction could honor dangerous schemes. After: rejected at router + parser + OS.
- Remediation: scheme allowlist on handle/open + parser.
- Retest: `xcodebuild test -only-testing:NoMarkupTests/DeepLinkIncomingSchemeTests -only-testing:NoMarkupTests/NotificationDeepLinkTests` — pass. `simctl openurl` javascript/data fail closed.
- Confidence: 10

### [SIM-SEC.9] Biometric gate on delete account / remove payment method
- Status: PASS
- Severity: major
- Surface: `AccountDeletionView` / `PaymentMethodsView` / `BiometricGate`
- Evidence:
  - Delete account: `AccountDeletionView.swift:42-49` `authenticateIfRequired` before `requestAccountDeletion`.
  - Remove PM: `PaymentMethodsView.swift:99-107` `authenticateIfRequired` before `delete(method)`.
  - Preference: Settings toggle `BiometricGate.requireForSensitiveActions` (`SecuritySettingsView.swift:170-179`). When off, `authenticateIfRequired` is a no-op (product: “gated **if feature on**”).
  - Policy `.deviceOwnerAuthentication` (biometry or passcode). Simulator without passcode: `canEvaluatePolicy` false → allow (documented; hardware Face ID is device residual).
  - Purpose string: `Info.plist` `NSFaceIDUsageDescription`.
- Expected: sensitive actions gated when the user enabled the feature.
- Actual: both call sites use `authenticateIfRequired`.
- Remediation: none
- Confidence: 9

### [SIM-SEC.10] Debug auto-login not compiled into Release
- Status: PASS
- Severity: major
- Surface: `AuthViewModel.applyLaunchTestCredentialsIfNeeded`
- Evidence:
  - Entire credential/argv/env auto-login body is `#if DEBUG` … `#else return false` (`AuthViewModel.swift:55-93`).
  - `RootView.task` always calls it; Release is a no-op.
  - Scaffold `-ui-test-scaffold` also DEBUG-only.
  - Did not add Release auto-login to make Simulator greener.
- Expected: Release binary cannot auto-login from env/argv.
- Actual: compiled out of Release.
- Remediation: none
- Confidence: 10

### [SIM-SEC.ATS] Archive lint fail-closed
- Status: FIXED
- Severity: major
- Surface: `scripts/ios-archive-lint.sh` + shipping plist
- Evidence: same as SIM-SEC.2. Lint now green after removing `NSAppTransportSecurity`. Widget `ios/NoMarkupWidget/Info.plist` has no ATS keys.
- Confidence: 10

### [SIM-SEC.MEDIA] Chat media host allowlist
- Status: PASS
- Severity: major
- Surface: `ChatMessage.safeHTTPURL`
- Evidence:
  - `Models.swift:1274-1326` — rejects `javascript:`, `data:`, userinfo, non-allowlisted HTTPS, loopback without object-storage path.
  - `ChatMediaURLTests` (allows MinIO/picsum/unsplash; rejects evil host + `javascript:` + `data:`) — passed.
- Confidence: 9

### [SIM-SEC.WS] Access token not in WebSocket query
- Status: PASS
- Severity: major
- Surface: chat / auction / spectator sockets
- Evidence:
  - Chat + auction: `Authorization: Bearer` header; `components.query = nil` (`ChatWebSocketClient.swift:156-160,468-471`; `AuctionWebSocketClient.swift:180-184,547-550`).
  - Spectator clients: no Authorization and no `?token=` (`SpectatorWebSocketClient`, `MarketplaceSpectatorWebSocketClient`).
  - `WebSocketURLSecurityTests.testChatAndAuctionWSURLsHaveNoQueryToken` — passed (`query` nil, no `token=`).
- Confidence: 10

### [SIM-SEC.KC] Keychain accessibility AfterFirstUnlockThisDeviceOnly
- Status: PASS
- Severity: advisory
- Surface: `KeychainTokenStore.save`
- Evidence: `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` on `SecItemAdd` (`KeychainTokenStore.swift:36`). Updates keep the existing item ACL. Service defaults to `Bundle.main.bundleIdentifier`.
- Residual: empty entitlements on **unsigned** sim builds → `-34018` (known; signed adhoc works). Do not loosen Release keychain/entitlements.
- Confidence: 9

---

## Fixes applied

| Item | Change |
|------|--------|
| SIM-SEC.2 / ATS | Removed `NSAppTransportSecurity` / `NSAllowsLocalNetworking` from `ios/NoMarkup/Info.plist`. Documented Debug loopback + HTTPS tunnel. Archive lint green. |
| SIM-SEC.8 | `DeepLinkRouter.handle` / `open(actionURL:)` reject non-`nomarkup`/`https`/`http`. `NotificationDeepLink.normalizedPath` rejects `javascript:`/`file:`/`data:` even when the path looks like `/jobs/{uuid}`. |
| Tests | `DeepLinkIncomingSchemeTests`, dangerous-scheme destination tests, `WebSocketURLSecurityTests`. |

**Not changed (on purpose):** Release entitlements, Release API HTTPS belt, Debug-only auto-login `#if DEBUG`. Device LAN cleartext remains fail-closed (use a tunnel).

---

## Residuals

| Item | Owner | Note |
|------|-------|------|
| Face ID hardware / passcode enroll | device / founder | Simulator `canEvaluatePolicy` false → gate allows (documented). Exercise on device. |
| Adhoc sim entitlements empty | env | Expected for “Sign to Run Locally”; do not weaken Release. |
| Device Debug HTTP to RFC1918 | eng | Needs HTTPS tunnel after ATS strip. Do **not** restore `NSAllowsLocalNetworking` on the shared plist. |
| Login `Link` legal | n/a | System Safari, not SFSafariViewController — equivalent for SIM-SEC.6. |

---

## Commands to reproduce

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
bash scripts/ios-archive-lint.sh

xcodebuild test -project ios/NoMarkup.xcodeproj -scheme NoMarkup \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' \
  -only-testing:NoMarkupTests/AppConfigTests \
  -only-testing:NoMarkupTests/ChatMediaURLTests \
  -only-testing:NoMarkupTests/DeepLinkIncomingSchemeTests \
  -only-testing:NoMarkupTests/NotificationDeepLinkTests \
  -only-testing:NoMarkupTests/WebSocketURLSecurityTests \
  -only-testing:NoMarkupTests/AppIntentsAuthGuardTests

# Signed-out account dest (fresh install, no tokens):
xcrun simctl launch booted com.nomarkup.app
xcrun simctl openurl booted 'nomarkup://bids'   # stays on Sign in
xcrun simctl openurl booted 'javascript:alert(1)'  # LS error 115
```

---

## Disclaimer

Static + Simulator evidence. Physical-device Face ID, APNs, and App Store ATS on a real archive are not re-run here; archive lint covers the shipping plist. No secrets in this report.
