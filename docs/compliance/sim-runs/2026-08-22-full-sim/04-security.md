# SIM-SEC — iOS client security (2026-08-22 full sim)

- **Target**: `ios/NoMarkup.xcodeproj` scheme `NoMarkup` · bundle `com.nomarkup.app`
- **Date**: 2026-08-22
- **Simulator**: iPhone 17 Pro (`7F123C44-2F2C-442B-90A6-92DE8E548510`) / iOS 26.5 (target card). **Not launched this pass** — static + live gateway curls (task: prefer curl 403 for non-admin admin APIs).
- **API base / backend**: Debug sim `http://127.0.0.1:8081` (gateway `/health` → 200 `{"status":"ok","version":"dev"}`). Release default `https://api.no-markup.com`
- **Mode**: fix · **Depth**: deep · **Scope**: security (ATS / Keychain / secrets / admin 403 / delete / sign-out / `iOSHardOffKeys` / deep-link schemes / LegalWebView)
- **Personas**: `customer@nomarkup.com`, `provider@nomarkup.com`, `admin@nomarkup.com` (seed from `00-target-card.md`)
- **Readiness**: **GREEN** — zero open client FAIL. No code changes.

Do **not commit** (per task).

---

## Target card

| Field | Value |
|-------|-------|
| Project / scheme | `ios/NoMarkup.xcodeproj` / `NoMarkup` |
| Bundle id | `com.nomarkup.app` |
| Simulator | iPhone 17 Pro / iOS 26.5 (card; not launched) |
| API base (Debug sim) | `http://127.0.0.1:8081` |
| API base (Release) | `https://api.no-markup.com` |
| Backend health | up (`curl` `/health` 200) |
| Mode | fix |
| Depth / scope | deep / full security |

---

## Verdict

| ID | Check | Status |
|----|-------|--------|
| SIM-SEC.1 | Release ATS / cleartext API (Debug loopback OK; Release never arbitrary HTTP) | **PASS** |
| SIM-SEC.2 | Tokens in Keychain, not UserDefaults | **PASS** |
| SIM-SEC.3 | No `sk_live` / private keys in repo | **PASS** |
| SIM-SEC.4 | Admin console row only when `hasAdminRole`; customer/provider admin APIs 403 | **PASS** |
| SIM-SEC.5 | Delete account confirm (phrase + toggle + biometric); server re-checks | **PASS** |
| SIM-SEC.6 | Sign-out confirm dialog | **PASS** |
| SIM-SEC.7 | `iOSHardOffKeys` hide insurance / legal purchase surfaces | **PASS** |
| SIM-SEC.8 | Deep links: `javascript:` / `file:` / `data:` rejected | **PASS** |
| SIM-SEC.9 | Legal via SFSafariViewController (or system Safari) to `https://no-markup.com` | **PASS** |
| SIM-SEC.10 | Debug auto-login not compiled into Release | **PASS** |
| Extra | Archive lint fail-closed (shipping plist + Debug/Release INFOPLIST split) | **PASS** |
| Extra | GDPR export requires auth | **PASS** |
| Extra | No access tokens in client logs | **PASS** |
| Extra | Chat media host allowlist | **PASS** |
| Extra | WS token not in query | **PASS** |
| Extra | Keychain `AfterFirstUnlockThisDeviceOnly` (device) | **PASS** |
| Extra | Feature flag status is diagnostic, not a bypass | **PASS** |
| Extra | StoreKit default off (no IAP CTA) | **PASS** |

**Open FAIL (client):** none. **Fixes applied:** none. **Do not commit.**

---

## Findings

### [SIM-SEC.1] Release ATS / cleartext API
- Status: PASS
- Severity: blocker
- Surface: `ios/NoMarkup/Info.plist` · `Info-Debug.plist` · `AppConfig.apiBaseURL` · `scripts/ios-archive-lint.sh`
- Evidence:
  - **Shipping plist** (`Info.plist`, `GENERATE_INFOPLIST_FILE=NO`): `APIBaseURL` empty; **no** `NSAppTransportSecurity` dict; **no** `NSAllowsArbitraryLoads`; **no** `NSAllowsLocalNetworking`. Default ATS = HTTPS-only. Widget `ios/NoMarkupWidget/Info.plist` has no ATS keys.
  - **Debug-only plist** (`Info-Debug.plist`, Debug `INFOPLIST_FILE`): `NSAllowsLocalNetworking=true` only — **not** `NSAllowsArbitraryLoads`. Lets a physical device hit `http://192.168.x.x:8081`. Simulator loopback `http://127.0.0.1:8081` is allowed by OS ATS regardless.
  - `project.pbxproj`: Debug `INFOPLIST_FILE = NoMarkup/Info-Debug.plist`; Release `INFOPLIST_FILE = NoMarkup/Info.plist`.
  - `AppConfig.swift`: `#if DEBUG` `allowCleartext = true`; Release `false`. Resolver skips non-`https` env/plist when `allowCleartext == false`. `#if !DEBUG` belt: non-HTTPS resolved URL is logged (host only) and replaced with `productionAPIBaseURL` (`https://api.no-markup.com`).
  - DEBUG Simulator default: `http://127.0.0.1:8081` (task-allowed). DEBUG device default: stamped `DevAPIBase.lanURLString` (`http://192.168.1.101:8081`) — compiled out of Release.
  - Unit: `AppConfigTests.testReleaseRejectsCleartextEnvAndPlist`, `testIsHTTPSAPIBaseRejectsHTTP`, `testResolveFallsBackToProductionHTTPSWhenEmpty`.
  - `bash scripts/ios-archive-lint.sh` (2026-08-22): **passed**. `PlistBuddy Print :NSAppTransportSecurity` on shipping plist → `Does Not Exist`. Debug local-networking `true`; ArbitraryLoads absent.
- Expected: Release never uses cleartext HTTP; Debug loopback OK; no ArbitraryLoads anywhere.
- Actual: shipping plist default ATS; Release resolver + belt force HTTPS; Debug local-networking only.
- Remediation: none. **Do not copy Debug ATS into the shipping plist.**
- Confidence: 10

### [SIM-SEC.2] Tokens in Keychain, not UserDefaults
- Status: PASS
- Severity: blocker
- Surface: `KeychainTokenStore` / `APIClient` / `AuthViewModel`
- Evidence:
  - Accounts `com.nomarkup.auth.accessToken` / `.refreshToken`. Login, refresh, Apple/Google/Facebook persist via `tokenStore.save` only (`APIClient.swift`, `APIClient+Auth.swift`).
  - `AuthViewModel` holds a `KeychainTokenStore`; restore/sign-out read/clear Keychain. No UserDefaults.
  - Device ACL on `SecItemAdd`: `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Simulator: `AfterFirstUnlock` (documented XCTest-clone workaround).
  - UserDefaults usage is non-secret: Debug dogfood API base (`nomarkup.debug.apiBaseURL`, `#if DEBUG`), biometric **preference**, StoreKit **local entitlement cache**, widget App Group **bid snapshots** (titles/amounts/end times; `WidgetSharedStore.clear()` on sign-out).
  - Grep: no `UserDefaults` write of access/refresh/JWT/password. Account email fallback reads JWT from **Keychain** (`AccountView.refreshSessionHints`).
- Expected: tokens only in Keychain.
- Actual: Keychain only.
- Remediation: none
- Confidence: 9

### [SIM-SEC.3] No `sk_live` / private keys in repo
- Status: PASS
- Severity: blocker
- Surface: repo grep + git index
- Evidence:
  - No committed `sk_live_[A-Za-z0-9…]` values. `sk_test_…` hit is a **detector fixture** in `services/payment/internal/service/stripe_test.go` (ellipsis placeholder). `pk_live_CHANGE_ME` only in `deploy/prod/.env.example`.
  - `-----BEGIN … PRIVATE KEY-----` appears only as **table copy** in `docs/auth-flow.md` (env-var docs), not a PEM blob.
  - No `AKIA…` AWS keys.
  - Plist `StripePublishableKey` / `GoogleIosClientID` / `FacebookAppID` empty. `StoreKitEnabled` false.
  - Local-only (gitignored): `.env.local`, `web/.env.local`, `keys/private.pem` + `keys/public.pem`. `git check-ignore` + `git ls-files` — not in the index. Tracked env files are `*.example` only.
- Expected: no live Stripe secrets or committed PEM private keys.
- Actual: none in git.
- Remediation: none
- Confidence: 9

### [SIM-SEC.4] Admin console gated `hasAdminRole` + API 403
- Status: PASS
- Severity: blocker
- Surface: Account hub `account.row.admin` · `GET /api/v1/admin/*`
- Evidence:
  - Row wrapped in `if hasAdminRole` (`AccountView.swift` ~879–891). `hasAdminRole` is `false` until `GET /api/v1/users/me` succeeds; sign-out / scaffold clears it (`refreshOnboardingBanner`).
  - `UserProfile.hasAdminRole` is case-insensitive `roles` contains `"admin"` (`APIClient+Platform.swift` 396–398). Not inferred from JWT on the client.
  - `AdminConsoleView` is only constructed from that row. No admin deep link in `DeepLinkRouter`.
  - Gateway: `r.Route("/admin")` + `RequireAdmin` (`gateway/internal/router/router.go` 1075–1076, `middleware/admin.go`).
  - **Curl** (`http://127.0.0.1:8081`, 2026-08-22; tokens not logged):

    | Caller | `GET /users/me` roles | `GET /admin/users` | `GET /admin/flags` | `PUT /admin/flags/customer_bnpl` |
    |--------|------------------------|--------------------|--------------------|----------------------------------|
    | none | 401 missing authorization header | 401 | 401 | — |
    | customer | `["customer","provider"]` (no admin) | **403** `admin access required` | **403** | **403** |
    | provider | `["provider"]` | **403** | **403** | — |
    | admin | `["admin","provider"]` | **200** | **200** | — |

  - Also 403 as customer **and** provider: `/admin/jobs`, `/admin/disputes`, `/admin/fraud/alerts`, `/admin/listings`, `/admin/user-reports`. Admin those same paths **200**.
- Expected: customer/provider never see Admin console; admin APIs 403 without admin role.
- Actual: hub row hidden unless `hasAdminRole`; APIs 403.
- Remediation: none
- Confidence: 10

### [SIM-SEC.5] Delete account confirm
- Status: PASS
- Severity: major
- Surface: `account.row.deleteAccount` → `AccountDeletionView`
- Evidence:
  - Submit disabled until toggle **and** typed `DELETE` (`canSubmit`).
  - `BiometricGate.authenticateIfRequired` before `requestAccountDeletion`.
  - Body `{ reason, confirmation: "DELETE" }` → `DELETE /api/v1/users/me`.
  - Scaffold / unsigned: no API call; copy says sign-in required. Hub row `.disabled` when scaffold / unsigned.
  - **Curl customer** `DELETE /api/v1/users/me` `{"reason":"test","confirmation":"NOPE"}` → **400** `deletion confirmation phrase invalid`. Did **not** submit a valid `DELETE`.
- Expected: fat-finger cannot schedule deletion; server re-checks phrase.
- Actual: client + server confirm.
- Remediation: none
- Confidence: 10

### [SIM-SEC.6] Sign-out confirm
- Status: PASS
- Severity: major
- Surface: `account.row.signOut`
- Evidence:
  - Button sets `confirmSignOut = true`; does **not** call `signOut()` immediately (`AccountView.swift` 229–235).
  - `confirmationDialog("Sign out of this device?")` destructive **Sign out** + **Cancel**; message: password needed to return; bids stay on account (933–946).
  - Confirmed path: `auth.signOut()` clears Keychain (`clearSession`), widget snapshots, in-memory fields, then best-effort device unregister + `POST` logout with the **captured** refresh token (never re-read Keychain after clear).
- Expected: confirm before dumping the user on LoginView.
- Actual: confirm dialog present.
- Remediation: none
- Confidence: 10

### [SIM-SEC.7] `iOSHardOffKeys` hide insurance / legal purchase
- Status: PASS
- Severity: major (App Store 3.2.1 honesty)
- Surface: `FeatureFlags.iOSHardOffKeys` · Account · Business hub · gateway `RequireFlag`
- Evidence:
  - Hard-off keys (`FeatureFlags.swift` 18–26): `customer_bnpl`, `working_capital`, `per_job_insurance`, `insurance_competition`, `legal_services`, `lead_gen`, `instant_payout`. `isEnabled` returns **false** before reading `serverFlags`. Covered by `AppConfigTests.testIOSHardOffKeysContainsRegulatedRails`.
  - Account **Insurance quote** `NavigationLink` only when `isEnabled("per_job_insurance") || isEnabled("insurance_competition")` → **absent** in this binary (`AccountView.swift` 417–431).
  - Account **Legal services** `NavigationLink` only when `isEnabled("legal_services")` → **absent** (`AccountView.swift` 481–493).
  - Business hub `gatedMoneyRow`: static “Not in this App Store build”, `allowsHitTesting(false)` — no NavLink into BNPL / policies / advances / instant payout / quote when hard-off (`BusinessFeaturesHubView.swift` 148–186).
  - Diagnostic `RegulatedRailsStatusView` is read-only ON/OFF from `isEnabled` (no toggles).
  - **Curl public** `GET /api/v1/flags` → 200 with all seven regulated keys **false** on this seed (migration 129 / review env). Gateway money routes **503** `This feature is currently unavailable` as customer (dual-role) and provider:
    | Route | Result |
    |-------|--------|
    | `GET /api/v1/insurance/policies` | **503** |
    | `GET /api/v1/insurance/quote-requests` | **503** |
    | `POST /api/v1/insurance/quote` | **503** |
    | `GET /api/v1/providers/me/advances` | **503** |
    | `GET /api/v1/payments/instant-payout/summary` | **503** |
    | `POST /api/v1/payments/instant-payout` | **503** |
  - Customer cannot flip flags: `PUT /api/v1/admin/flags/customer_bnpl` → **403**.
- Expected: off copy must not be a NavigationLink into a quote/purchase surface; server fails closed when flags are false.
- Actual: client rows hidden / static; gateway 503.
- Remediation: none
- Confidence: 10

### [SIM-SEC.8] Deep links reject dangerous schemes
- Status: PASS
- Severity: major
- Surface: `DeepLinkRouter.handle` / `open(actionURL:)` / `NotificationDeepLink.normalizedPath`
- Evidence:
  - `DeepLinkRouter.isAllowedIncomingURL` allowlists `nomarkup` / `https` / `http` only. `handle` and `open(actionURL:)` reject the rest (`DeepLinkRouter.swift` 42–45, 95–96, 114–120).
  - `NotificationDeepLink.normalizedPath` independently rejects other schemes (no MainActor hop) so `file:///jobs/{uuid}` and `javascript:/jobs/{uuid}` cannot open `JobDetailView` (`NotificationsView.swift` 422–434).
  - Unit tests: `DeepLinkIncomingSchemeTests.testHandleRejectsJavaScriptAndFileSchemes`, `testOpenActionURLRejectsDangerousSchemes`, `testHandleStillAcceptsNomarkupAndHTTPS`, `NotificationDeepLinkTests.testDestinationRejectsDangerousSchemesEvenWhenPathLooksValid`.
  - Custom URL types: `nomarkup` only (`Info.plist` / `Info-Debug.plist` `CFBundleURLSchemes`).
- Expected: `javascript:` / `file:` / `data:` never become destinations.
- Actual: rejected at router + parser.
- Remediation: none
- Confidence: 10

### [SIM-SEC.9] Legal via SFSafariViewController / system Safari
- Status: PASS
- Severity: advisory
- Surface: `LegalWebView` · Account Legal & support · Login footer
- Evidence:
  - `publicWebBaseURL = https://no-markup.com`. Paths: `/privacy`, `/terms`, `/community-guidelines`, `/support` (`AppConfig.swift` 18–24).
  - Account buttons set `legalSheet` to those URLs; sheet is `LegalWebView` → `SFSafariViewController` (no WKWebView / JS bridge). Support uses native in-app copy + `mailto:support@no-markup.com` (DIST.17 NXDOMAIN fallback).
  - Login footer `Link` to `privacyURL` / `termsURL` (system Safari).
  - App-target grep: no `WKWebView` / `WKScriptMessageHandler` / `evaluateJavaScript` in `ios/NoMarkup` (comment-only mention in `RootTabView`).
  - `AppConfigTests.testLegalURLsAreHTTPSOnPublicSite`.
- Expected: legal HTML not in an arbitrary JS-bridge WebView; public hyphenated zone over HTTPS.
- Actual: SFSafariViewController / system Safari to `https://no-markup.com/…`; Support native mailto if DNS fails.
- Remediation: none
- Confidence: 10

### [SIM-SEC.10] Debug auto-login not compiled into Release
- Status: PASS
- Severity: major
- Surface: `AuthViewModel.applyLaunchTestCredentialsIfNeeded`
- Evidence:
  - Entire credential/argv/env auto-login body is `#if DEBUG` … `#else return false` (`AuthViewModel.swift` 114–150). Init also skips Keychain restore for UITest launches under `#if DEBUG` only (96–106).
  - Scaffold `-ui-test-scaffold` / `NOMARKUP_UI_TEST_SCAFFOLD` also DEBUG-only.
  - Did not add Release auto-login to make Simulator greener.
- Expected: Release binary cannot auto-login from env/argv.
- Actual: compiled out of Release.
- Remediation: none
- Confidence: 10

### [SIM-SEC.ATS] Archive lint fail-closed
- Status: PASS
- Severity: major
- Surface: `scripts/ios-archive-lint.sh`
- Evidence: same as SIM-SEC.1. Lint green: empty `APIBaseURL`, absent shipping ATS, Debug vs Release INFOPLIST split, Debug local-networking only, no ArbitraryLoads, `ITSAppUsesNonExemptEncryption=false`, PrivacyInfo present. DIST.17 Support URL DNS is **warn-only** (public `no-markup.com` not provisioned — founder/ops; in-app Support is native mailto).
- Confidence: 10

### [SIM-SEC.EXPORT] GDPR export auth
- Status: PASS
- Severity: major
- Surface: `account.row.exportData` → `GET /api/v1/users/me/export`
- Evidence:
  - Button `.disabled` when scaffold / unsigned / exporting.
  - Client uses `authorizedRequest` (Bearer from Keychain). Unauthenticated curl → **401**. Customer Bearer → **200** (payload length 190415; tokens not logged).
- Confidence: 10

### [SIM-SEC.LOG] No access tokens in client logs
- Status: PASS
- Severity: major
- Surface: `NSLog` / `print` in app target
- Evidence:
  - App-target `NSLog` only: `AppConfig.logInsecureBaseOnce` — host only, never the URL userinfo/query.
  - WS clients: `// Do not log request or token`; `components.query = nil`.
- Confidence: 8

### [SIM-SEC.MEDIA] Chat media host allowlist
- Status: PASS
- Severity: major
- Surface: `ChatMessage.safeHTTPURL` / `isAllowedChatMediaURL`
- Evidence: rejects `javascript:`, `data:`, userinfo, non-allowlisted HTTPS, loopback without object-storage path (`Models.swift` 1330–1379).
- Confidence: 9

### [SIM-SEC.WS] Access token not in WebSocket query
- Status: PASS
- Severity: major
- Surface: chat / auction / spectator sockets
- Evidence:
  - Chat + auction: `Authorization: Bearer` header; `components.query = nil`.
  - Spectator clients: no Authorization and no `?token=`.
  - `WebSocketURLSecurityTests.testChatAndAuctionWSURLsHaveNoQueryToken`.
- Confidence: 10

### [SIM-SEC.KC] Keychain accessibility AfterFirstUnlockThisDeviceOnly
- Status: PASS
- Severity: advisory
- Surface: `KeychainTokenStore.save`
- Evidence: device `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` on `SecItemAdd` (`KeychainTokenStore.swift` 36–43). Updates keep the existing item ACL. Service defaults to `Bundle.main.bundleIdentifier`. Simulator uses `AfterFirstUnlock` only.
- Residual: empty entitlements on **unsigned** sim builds → `-34018` (known; signed adhoc works). Do **not** loosen Release keychain/entitlements. Entitlements file: Sign in with Apple, Apple Pay merchant, App Group, associated domains `applinks` + `webcredentials` on `no-markup.com`, `aps-environment=development` (archive export rewrites for production).
- Confidence: 9

### [SIM-SEC.IAP] StoreKit default off
- Status: PASS
- Severity: major (App Store 3.1.1)
- Surface: `AppConfig.storeKitEnabled` / `PlanLimitsView`
- Evidence: Info.plist `StoreKitEnabled` = false. When false: no Subscribe / Restore; no web digital upgrade CTA. `StoreKitManager` purchase / restore / `Transaction.updates` all `guard storeKitEnabled`.
- Confidence: 10

---

## Fixes applied

**None** — all SIM-SEC checks already green. Did **not** weaken Release ATS, entitlements, or Keychain ACL.

**Not changed (on purpose):** Debug `Info-Debug.plist` `NSAllowsLocalNetworking` (required for device LAN dogfood; archive lint enforces it stays Debug-only); `DevAPIBase` LAN default (DEBUG device only); seed flags (already off); StoreKit default false.

---

## Residuals

| Item | Owner | Note |
|------|-------|------|
| Face ID on delete / remove PM / app lock | device | Simulator `canEvaluatePolicy` false → `authenticateIfRequired` allows (documented). Exercise on hardware. |
| Seed `customer@` also has `provider` | seed | `GET /users/me` roles `["customer","provider"]`. Admin still absent → console row hidden. Dual-role does not bypass `RequireFlag` 503 while flags are off. |
| DIST.17 `no-markup.com/support` DNS | founder / ops | Archive lint warning only. In-app Support is native mailto. Do not fail the binary on public DNS. |
| Device Debug HTTP to RFC1918 | eng | Uses Debug plist local-networking. Do **not** restore ATS exceptions on the shipping plist. Prefer HTTPS tunnel / staging for physical-device dogfood. |
| Adhoc sim entitlements empty | env | Expected for unsigned/local; do not weaken Release. |
| Local `keys/*.pem` + `.env.local` | env | Gitignored; present on this machine for local gateway. Not in git. |
| Web `/settings/account` sign-out | web | No confirm dialog (iOS Account does). Out of iOS client scope. |

---

## Commands to reproduce

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
bash scripts/ios-archive-lint.sh

API=http://127.0.0.1:8081
# seed password: docs/compliance/sim-runs/2026-08-22-full-sim/00-target-card.md

curl -sS -o /dev/null -w "%{http_code}\n" "$API/health"   # 200

# tokens (do not log them)
CT=$(curl -sS -X POST "$API/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"customer@nomarkup.com","password":"<seed>"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
PT=$(curl -sS -X POST "$API/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"provider@nomarkup.com","password":"<seed>"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
AT=$(curl -sS -X POST "$API/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@nomarkup.com","password":"<seed>"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

curl -sS -o /dev/null -w "%{http_code}\n" "$API/api/v1/admin/users"                                 # 401
curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $CT" "$API/api/v1/admin/users"  # 403
curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $PT" "$API/api/v1/admin/users"  # 403
curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $AT" "$API/api/v1/admin/users"  # 200
curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $CT" -X PUT \
  "$API/api/v1/admin/flags/customer_bnpl" -H 'Content-Type: application/json' \
  -d '{"enabled":true}'   # 403
curl -sS -o /dev/null -w "%{http_code}\n" "$API/api/v1/users/me/export"                             # 401
curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $CT" \
  "$API/api/v1/users/me/export"  # 200
curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $CT" -X DELETE \
  "$API/api/v1/users/me" -H 'Content-Type: application/json' \
  -d '{"reason":"test","confirmation":"NOPE"}'   # 400
curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $CT" \
  "$API/api/v1/insurance/policies"   # 503 (flags off)
```

---

## Disclaimer

Static review + live gateway curls against the local seed. Simulator UI was not re-snapshotted this pass (task: prefer static + curl 403). No access tokens, PANs, or seed password in this report.
