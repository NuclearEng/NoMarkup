# iOS Developer Audit — Remediation Tracker (final)

**Source audit:** [`ios-developer-audit-2026-07-27.md`](./ios-developer-audit-2026-07-27.md)  
**Remediation completed:** 2026-07-27  
**Verification:** `xcodebuild build` **SUCCEEDED** (iPhone 17 sim); `xcodebuild test -only-testing:NoMarkupTests` **30/30 PASSED**; `go test ./services/notification/...` green; `scripts/ios-archive-lint.sh` green.

### Status legend

| Status | Meaning |
|--------|---------|
| **Closed** | Code/docs requirement met with path evidence |
| **Ops residual** | Implementation done; App Store Connect / device / secrets still need human action |
| **Deferred** | Explicit product deferral with date (not a launch blocker for this audit class) |

**Honesty rule:** Device-matrix and ASC form entry are **ops residual**, not fake “verified.” All **code-closeable** audit gaps from the 2026-07-27 report are **Closed**.

---

## Blockers (required) — all code-closed

| ID | Status | Evidence |
|----|--------|----------|
| **IOS-SEC.1** | **Closed** | Empty `APIBaseURL` in `ios/NoMarkup/Info.plist`; `AppConfig.resolveAPIBaseURL` rejects HTTP in Release; unit tests; `scripts/ios-archive-lint.sh` |
| **IOS-DIST.7** | **Closed** (binary/docs) · **Ops residual** (ASC form) | `PrivacyInfo.xcprivacy` + packaging §4.2 push/Device ID truth; ASC privacy questionnaire still human-entered |
| **IOS-PERF.6** | **Closed** | `ImageUploader` not `@MainActor`; ImageIO downsample + JPEG on detached task |
| **IOS-DES.20** | **Closed** (layout risk) · **Ops residual** (device sign-off) | Dynamic Type on money/hero; zero fixed `.system(size:)`; checklist ready — human SE/iPad/AX5 pass still required |

---

## 01 — Design

| ID | Status | Evidence |
|----|--------|----------|
| IOS-DES.3 | **Closed** | Forced app-wide dark removed; production sheets no longer force dark; Adaptive AccentColor light/dark; Dynamic Type on critical surfaces |
| IOS-DES.4 | **Closed** | iOS 26+ leaves `scrollEdgeAppearance` to system in `BrandTheme.applyGlobalChrome()` |
| IOS-DES.6 | **Closed** | AppIcon dark + tinted appearance slots in `Contents.json` (same 1024 master until Icon Composer redesign) |
| IOS-DES.7 | **Closed** | `QuoteTemplatesView` + `BusinessFeaturesHubView` contextMenu Delete alongside swipe |
| IOS-DES.8 | **Closed** | Value-moment pre-prompt (`NotificationPermissionCopy`); no login-time bare request |
| IOS-DES.9 | **Closed** | Scroll-edge system path on iOS 26+ (with DES.4) |
| IOS-DES.12 | **Closed** | `NavigationSplitView` at regular width: Marketplace, Jobs, Messages |
| IOS-DES.14 | **Closed** (plan) · **Ops residual** (captures) | [`app-store-screenshot-matrix.md`](./app-store-screenshot-matrix.md) 6.9"/13" |
| IOS-DES.16 | **Closed** | User-facing Rail/PRD jargon removed; IDs in comments only |
| IOS-DES.20 | See blockers | |

**Still PASS:** DES.1, .2, .5, .10, .11, .15, .17, .18, .19.

---

## 02 — Privacy & Security

| ID | Status | Evidence |
|----|--------|----------|
| IOS-SEC.1 | **Closed** | See blockers |
| IOS-PRI.7 | **Closed** | `ios/NoMarkup/PrivacyInfo.xcprivacy` in app Resources |
| IOS-SEC.2 | **Closed** (client) · **Ops residual** (server WebAuthn) | `PasskeyAuth.swift` + ASAuthorization platform provider; gated until `NOMARKUP_PASSKEYS=1` / server ready |
| IOS-SEC.3 | **Closed** | AutoFill username/password/OTP already present; passkey coexistence path exists when server live |
| IOS-SEC.5 | **Closed** | No `NSAllowsLocalNetworking` in shipping plist; Release HTTPS-only |
| IOS-SEC.7 | **Closed** | `BiometricGate` on account deletion + remove payment method; optional app lock |
| IOS-SEC.9 | **Closed** (tree) · **Ops residual** (CDN AASA) | Entitlements `applinks:` + `webcredentials:`; `web/public/.well-known/apple-app-site-association`; deep link router |
| SIWA nonce | **Closed** | SHA256 nonce on request + gateway exchange body |

**Still PASS:** PRI.1–4, .8, .11; SEC.4, .6, .8, .10–13.

---

## 03 — System experiences

| ID | Status | Evidence |
|----|--------|----------|
| IOS-SYS.NT.4 | **Closed** (code) · **Ops residual** (.p8 secrets) | `services/notification/internal/service/apns.go` HTTP/2 token auth; iOS path uses APNs |
| IOS-SYS.NT.2 | **Closed** | Value-moment permission + Settings deep-link on denial |
| IOS-SYS.NT.3 | **Closed** | Categories + actions; tap → `DeepLinkRouter` / `NotificationDeepLink` |
| IOS-SYS.NT.5 | **Closed** | Badge clear on active + mark-all-read; server `aps.badge` when known |
| IOS-SYS.MISC.3 | **Closed** | `remote-notification` background mode removed |
| IOS-SYS.NT.1 | **Closed** | Prefs seed defaults; global toggles functional |
| IOS-SYS.NT.6 | **Closed** | Foreground sound branched by notification type |
| IOS-SYS.LA.4 | **Closed** | ActivityKit auction Live Activity + widget UI; starts on bid |
| IOS-SYS.WD.5 | **Closed** | `NoMarkupWidget` target embedded (active bids / next closing) |
| IOS-INT.7 | **Closed** | App Intents + `AppShortcutsProvider` |

---

## 04 — Intelligence

| ID | Status | Evidence |
|----|--------|----------|
| IOS-AI.1 | **Closed** | App Intents + shortcuts for core verbs |
| IOS-AI.11 | **Deferred** 2026-07-27 | Visual Intelligence post-launch after intents mature |
| IOS-AI.9, .10, .18 | **Closed** (PASS) | Unchanged |

---

## 05 — Quality

| ID | Status | Evidence |
|----|--------|----------|
| IOS-A11Y.2 | **Closed** | Zero remaining `.font(.system(size:))`; money uses scalable mono + scale factor |
| IOS-A11Y.3 | **Closed** | `BrandTheme.animation` / reduce-motion gates on root + chat scroll |
| IOS-A11Y.6 | **Closed** (doc) · **Ops residual** (ASC claim after VO pass) | [`accessibility-nutrition-claims.md`](./accessibility-nutrition-claims.md) — VoiceOver-only until AX5 |
| IOS-L10N.5 | **Closed** | `Localizable.xcstrings` + `SWIFT_EMIT_LOC_STRINGS=YES` |
| IOS-PERF.3 | **Closed** | ImageIO max-pixel 2048 + `URLCache` bounds |
| IOS-PERF.6 | **Closed** | See blockers |
| IOS-TEST.1 | **Closed** | `NoMarkupTests` — 30 tests green |
| IOS-TEST.2 | **Closed** (process) · **Ops residual** (first upload) | [`testflight-process.md`](./testflight-process.md) |
| IOS-TEST.3 | **Closed** (matrix) · **Ops residual** (human pass) | SE / iPad / AX5 / iOS 17 in smoke checklist |
| IOS-MP.1 | **Closed** | Regular-width split views on main hubs |

**Still PASS:** A11Y.1, .4, .7; PERF.1–2, .4–5; TEST.4; MP.2; L10N.4.

---

## 06 — Games & Media

| ID | Status | Evidence |
|----|--------|----------|
| IOS-MED.5 | **Closed** | Camera auth pre-check + Settings recovery; ImageIO orientation transform + camera normalize |
| IOS-MED.6 | **Closed** (PASS) | — |

---

## 07 — Distribution

| ID | Status | Evidence |
|----|--------|----------|
| IOS-DIST.1 | **Closed** | README + archive lint Xcode 26+ floor |
| IOS-DIST.2 | **Closed** (matrix) · **Ops residual** (sign-off) | Smoke checklist updated |
| IOS-DIST.4 | **Closed** (process) · **Ops residual** (ASC group) | TestFlight process doc |
| IOS-DIST.5 | **Closed** (plan) · **Ops residual** (media capture) | Screenshot matrix |
| IOS-DIST.6 | **Closed** (draft) · **Ops residual** (ASC entry) | Age table in packaging checklist |
| IOS-DIST.7 | See blockers | |
| IOS-DIST.8 | **Closed** (doc) · **Ops residual** (ASC) | A11y nutrition claims |
| IOS-DIST.13 | **Deferred** 2026-07-27 | In-App Events post-launch |
| IOS-DIST.14 | **Deferred** 2026-07-27 | CPP/PPO post-launch |
| IOS-DIST.15 | **Closed** | `ITSAppUsesNonExemptEncryption=false` |
| IOS-DIST.16 | **Closed** | `MARKETING_VERSION=1.0.0`, build 3 |

**Still PASS:** DIST.3, .9, .10, .12, .17, .18.

---

## Out-of-registry

| ID | Status | Notes |
|----|--------|-------|
| OBS-1 Google Sign-In | **Closed** | Button hidden unless `AppConfig.isGoogleSignInConfigured` |
| OBS-2 pbxproj IDs | **Deferred** | Cosmetic; builds succeed |

---

## Platform readiness (re-scored after remediation)

| Metric | Pre-remediation | Post-remediation (code) |
|--------|-----------------|-------------------------|
| Blocker FAIL (required) | 3 | **0** |
| Major FAIL (required) | many | **0** (code) |
| Readiness | **NOT READY** | **READY WITH FOLLOW-UPS** |

**Follow-ups (human / ops only — not code gaps):**

1. Device smoke sign-off: SE 3rd gen, Pro Max, 13" iPad, AX5, iOS 17 sim — [`device-smoke-checklist.md`](./device-smoke-checklist.md)
2. ASC: privacy nutrition labels, age rating, screenshots, TestFlight internal group, export-compliance checkbox
3. Deploy AASA to live `https://no-markup.com/.well-known/apple-app-site-association`
4. Provision APNs `.p8` + env (`APNS_*`) for production push
5. Optional: enable passkeys end-to-end when WebAuthn endpoints ship (`NOMARKUP_PASSKEYS=1`)
6. Archive with Xcode 26+; confirm production `aps-environment` on export

---

## Key artifacts

| Path | Role |
|------|------|
| `ios/NoMarkup/PrivacyInfo.xcprivacy` | Privacy manifest |
| `ios/NoMarkup/Localizable.xcstrings` | String catalog |
| `ios/NoMarkupWidget/` | Widgets + Live Activity UI |
| `ios/NoMarkup/Intents/` | App Intents |
| `ios/NoMarkup/Auth/PasskeyAuth.swift` | Passkey client |
| `ios/NoMarkup/Core/BiometricGate.swift` | LocalAuthentication |
| `ios/NoMarkup/Core/DeepLinkRouter.swift` | UL / push / intent routing |
| `services/notification/internal/service/apns.go` | APNs provider |
| `web/public/.well-known/apple-app-site-association` | AASA |
| `scripts/ios-archive-lint.sh` | Release hygiene gate |
| `ios/NoMarkupTests/` | Unit tests (30) |

---

*All audit FAIL/GAP/RISK items that can be closed in-repo are Closed. Remaining rows are ops residual or deliberate deferrals, not incomplete engineering.*
