# Device smoke results — NoMarkup iOS (automated pass)

**Date:** 2026-07-26  
**Tester:** Automated agent (no human UI taps)  
**Program:** Stage C residual (B6 ops)  
**Checklist source:** [`device-smoke-checklist.md`](./device-smoke-checklist.md)

---

## Environment

| Field | Value |
|-------|--------|
| Device | Tanner's iPhone — **iPhone 15 Pro Max** (`iPhone16,2`) |
| UDID | `00008130-0018493E3A41001C` |
| CoreDevice id | `AE11FA5B-E952-5732-BA5C-3819ABC95443` |
| OS | **iOS 26.5.2** (build `23F84`) |
| Connection | localNetwork tunnel, developer mode enabled, DDI available |
| Bundle | `com.nomarkup.app` |
| Installed version | **0.1.0** (`CFBundleVersion` **2**) — matches `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in Xcode project |
| Install path | `/private/var/containers/Bundle/Application/F89E34B6-3FFE-49B8-B10D-7F5616465A07/NoMarkup.app` |
| `DEVELOPER_DIR` | `/Applications/Xcode-26.5.0.app/Contents/Developer` |
| API base (device binary) | `http://192.168.1.101:8081` from `Info.plist` → `APIBaseURL` |
| Gateway health (Mac → API base) | **HTTP 200** `{"status":"ok","version":"dev"}` |
| Stripe publishable key (plist) | **empty** (`StripePublishableKey` blank) |
| Screenshot tooling | **Not available** (`idevicescreenshot`, `ios-deploy`, `tidevice`, `pymobiledevice3`, `cfgutil` absent; `devicectl` has no screenshot subcommand) |

### Launch proof

```text
xcrun devicectl device process launch \
  --device 00008130-0018493E3A41001C \
  --terminate-existing \
  com.nomarkup.app
→ outcome: success, processIdentifier 51339 (activated)

Process list (post-launch):
51339  …/NoMarkup.app/NoMarkup
```

Cold relaunch with `--terminate-existing` succeeded twice; process remained live after launch (verified via `devicectl device info processes`).

---

## Status legend (this run)

| Mark | Meaning |
|------|---------|
| **PASS** | Code + install/device evidence sufficient for the step’s automated claim |
| **PARTIAL** | Source implements the path; human UI exercise still required for checklist sign-off |
| **FAIL** | Contradicts expected behavior |
| **BLOCKED** | Could not complete (tooling, network, gateway, or safety constraint) |

Checklist original “Pass only after a human executes” still applies for App Store sign-off. This document records **what automation could prove** without taps, account deletion, or real bids.

---

## Preflight

| # | Step | Result | Notes |
|---|------|:------:|-------|
| P1 | Gateway up | **PASS** | Device targets `http://192.168.1.101:8081`. `GET /health` → 200. `localhost:8080` down on Mac; `localhost:8081` also 200 (same stack). Checklist default `localhost:8080` is simulator-oriented (`AppConfig` DEBUG+simulator path). |
| P2 | DB seed applied | **PARTIAL** | Public catalog returns data (19 active listings; jobs list non-empty). Did **not** authenticate as `customer@` / `provider@` or verify `SEED_PASSWORD`. |
| P3 | Open Xcode project | **PARTIAL** | Project present at `ios/NoMarkup.xcodeproj`. Not opened in GUI this run. |
| P4 | Run NoMarkup on device/simulator | **PASS** | Physical device install + `devicectl` launch (not iPhone 16 Simulator). Scheme/bundle match. |

---

## Smoke matrix

| # | Scenario | Result | Evidence / notes |
|---|----------|:------:|------------------|
| 1 | **Cold launch** → Login or scaffold | **PASS** | App launches and stays running. Source: native `LoginView` (email/password, SIWA, “Browse without signing in” scaffold) — **not** a WKWebView shell. Only WKWebView mention is a comment in `RootTabView` stating native TabView. **Copy delta vs checklist:** scaffold CTA is `"Browse without signing in"`, not `"Browse native chrome (scaffold)"`. Visual confirm of first paint still needs human eyes / screenshot tooling. |
| 2 | **Health check on Home** | **PARTIAL** | `HomeView` auto-runs health + catalog on appear/pull; footer shows Connected/Offline + **Refresh** (label is “Refresh”, not “Refresh status”). Stats strip shows API Live/Down. Gateway is reachable from Mac on device API base → expected green once user enters main tabs (scaffold or auth). Not UI-tapped. |
| 3 | **Launch gates / hard-off flags** | **PASS** | `FeatureFlags.iOSHardOffKeys` **exact match** to checklist (see table below). `isEnabled` always `false` for those keys. Grep: no BNPL / working-capital / insurance purchase / legal marketplace / lead-gen fee / instant-payout CTAs in Swift UI. Server `GET /api/v1/flags` currently returns several hard-off keys **true** (`customer_bnpl`, `working_capital`, `per_job_insurance`, `insurance_competition`, `legal_services`, `instant_payout`) — client hard-off remains authoritative. No separate “Product rails” debug panel required if surfaces are absent. |
| 4 | **Marketplace** loads list | **PARTIAL** | `MarketplaceView`: list / empty / error + pull-to-refresh. Public API returns **19 active listings** (e.g. Makita drill kit). Human: open Marketplace tab, pull-to-refresh. |
| 5 | **Listing detail → Report → Cancel** | **PARTIAL** | `ListingDetailView` + `ListingReportSheet` with toolbar **Cancel** → `onDone()` dismiss without submit. Did not open sheet or submit reports. |
| 6 | **Jobs browse + mine (auth)** | **PARTIAL** | `JobsView` segmented **Browse** / **Mine**; Browse uses public jobs; Mine requires real auth with clear sign-in empty states for scaffold/expired session. Public jobs API returns data. No sign-in performed. |
| 7 | **Messages channels (auth)** | **PARTIAL** | `MessagesView`: scaffold → “Sign in for messages”; expired → “Sign in required”; empty inbox copy when authed. No crash paths in source review. |
| 8 | **Place bid UI** | **PARTIAL** | Place-bid sections on `ListingDetailView` (goods) and `JobDetailView` (services) with validation + scaffold/no-credentials messaging. **Did not place bids** (per instructions). |
| 8b | **Buy now → Apple Pay sheet** | **PARTIAL** | `RailACheckout.presentPaymentSheet` + Buy now UI on listing detail. **Blockers for live sheet this env:** (1) `StripePublishableKey` empty → expected “not configured” path; (2) sample of 50 listings had **0** with `buy_now_price_cents`. Full charge not attempted. |
| 8c | **Orders → Pay with Apple Pay** | **PARTIAL** | `MyOrdersView` shows **Pay with Apple Pay** when `order.needsPayment`. Requires real auth + pending order. Not exercised. |
| 9 | **Account legal links** | **PARTIAL** | Account → Privacy / Terms / Community Guidelines / Support → `LegalWebView` → `SFSafariViewController` to `https://no-markup.com/{privacy,terms,community-guidelines,support}`. **From this Mac host DNS:** `no-markup.com` did **not resolve** (`Could not resolve host`) — live open of legal HTML **not verified** here; device may still resolve if its network differs. |
| 10 | **Export data / Delete account UI** | **PARTIAL** | Export Data button (disabled on scaffold / unauth); success path shows byte count + share sheet. Delete Account → `AccountDeletionView` requires phrase **`DELETE`**. Scaffold explains missing credentials. **Did not complete deletion.** |
| 11 | **Sign out** | **PARTIAL** | Account **Sign out** calls `PushRegistration.shared.resetSessionState()` + `auth.signOut()`. Returns to login chrome in design. Not UI-tapped. |
| 12 | **Sign in with Apple button visible** | **PARTIAL** | `SignInWithAppleButtonView` on `LoginView` (`SignInWithAppleButton`, a11y “Sign in with Apple”). Full SIWA flow (team / App ID / `APPLE_NATIVE_CLIENT_ID`) **not** exercised. |

---

## Automated checklist items (operator request)

| # | Check | Result |
|---|-------|:------:|
| 1 | Confirm app installed (`devicectl`) | **PASS** — NoMarkup `com.nomarkup.app` 0.1.0 (2) |
| 2 | Launch app successfully | **PASS** — `devicectl` launch outcome success |
| 3 | `FeatureFlags.swift` hard-off keys match checklist | **PASS** — exact 7-key set |
| 4 | `Info.plist` `APIBaseURL` + `AppConfig` resolution | **PASS** — see § Config |
| 5 | `LoginView`: SIWA, email fields, scaffold | **PASS** — present in source |
| 6 | `AccountView`: export, delete, legal, sign out | **PASS** — present in source |
| 7 | `JobsView` segments, `MarketplaceView`, `MessagesView` | **PASS** — exist; wired in `RootTabView` |
| 8 | `BrandTheme` + `NoMarkupIcon` | **PASS** — both present; Login header uses icon |
| 9 | Device screenshot after launch | **BLOCKED** — no screenshot CLI on host |
| 10 | Process running after launch | **PASS** — PID 51339 (latest relaunch) |

---

## Config resolution (source)

### `Info.plist`

- `APIBaseURL` = `http://192.168.1.101:8081` (physical device / LAN gateway)
- `StripePublishableKey` = empty
- `ApplePayMerchantId` = `merchant.com.nomarkup.app`

### `AppConfig.apiBaseURL` order

1. Env `NOMARKUP_API_BASE_URL`
2. Plist `APIBaseURL` when non-empty ← **device binary hits here**
3. DEBUG + **Simulator only:** `http://localhost:8080`
4. Else: `https://api.no-markup.com`

### Hard-off keys (`FeatureFlags.iOSHardOffKeys`)

| Key | In binary hard-off | Server flag sample (2026-07-26) |
|-----|:------------------:|----------------------------------|
| `customer_bnpl` | yes | `true` (client forces off) |
| `working_capital` | yes | `true` (client forces off) |
| `per_job_insurance` | yes | `true` (client forces off) |
| `insurance_competition` | yes | `true` (client forces off) |
| `legal_services` | yes | `true` (client forces off) |
| `lead_gen` | yes | `false` |
| `instant_payout` | yes | `true` (client forces off) |

Source: `ios/NoMarkup/Core/FeatureFlags.swift`.

---

## Source map (key files)

| Area | Path |
|------|------|
| Hard-off flags | `ios/NoMarkup/Core/FeatureFlags.swift` |
| API / legal URLs | `ios/NoMarkup/Core/AppConfig.swift` |
| Plist | `ios/NoMarkup/Info.plist` |
| Login + SIWA + scaffold | `ios/NoMarkup/Auth/LoginView.swift`, `SignInWithAppleButton.swift` |
| Tabs | `ios/NoMarkup/Features/RootTabView.swift` |
| Home health / catalog | `ios/NoMarkup/Features/HomeView.swift` |
| Marketplace | `ios/NoMarkup/Features/MarketplaceView.swift` |
| Jobs Browse/Mine | `ios/NoMarkup/Features/JobsView.swift` |
| Messages | `ios/NoMarkup/Features/MessagesView.swift` |
| Account / export / legal | `ios/NoMarkup/Features/AccountView.swift` |
| Delete confirm | `ios/NoMarkup/Features/AccountDeletionView.swift` |
| Legal Safari | `ios/NoMarkup/Features/LegalWebView.swift` |
| Report cancel | `ios/NoMarkup/Features/ListingDetailView.swift` (`ListingReportSheet`) |
| Apple Pay sheet | `ios/NoMarkup/Core/RailACheckout.swift` |
| Orders pay-retry | `ios/NoMarkup/Features/MyOrdersView.swift` |
| Brand | `ios/NoMarkup/Core/BrandTheme.swift`, `NoMarkupIcon.swift` |
| App icon asset | `ios/NoMarkup/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` |

---

## Sign-off (automated)

| Field | Value |
|-------|--------|
| Tester | Automated agent (no human UI taps) |
| Date | 2026-07-26 |
| Build / version | **0.1.0 (2)** (from installed app + Xcode project) |
| Simulator / device | Physical **iPhone 15 Pro Max** / iOS **26.5.2** (UDID `00008130-0018493E3A41001C`) |
| API base | `http://192.168.1.101:8081` (plist); gateway health OK |
| Overall | [x] **PASS with notes** · [ ] PASS · [ ] FAIL (block submit) |

**Overall verdict: PASS with notes**

- Install + cold launch + process liveness: **green**.
- Hard-off keys, native chrome structure, Account/Login surfaces, brand assets: **code-verified**.
- Gateway reachable for device API base; public catalog has listings/jobs.
- Full human matrix (tab navigation, SIWA, auth seed login, report cancel gesture, bid UX, Apple Pay sheet, legal Safari paint, sign-out) remains **open**.
- **Not** a substitute for checklist human sign-off on the launch board.

### Residual human steps (priority)

1. Visually confirm Login (SIWA + email + scaffold) and Home health green after scaffold browse.  
2. Marketplace list + listing detail → Report → **Cancel**.  
3. Jobs Browse / Mine (seed customer).  
4. Messages with real session.  
5. Place-bid form validation only (no live bid if shared seed).  
6. Configure `pk_test_…` + listing with `buy_now_price` → PaymentSheet cancel path.  
7. Account legal Safari opens (confirm DNS/CDN on device network).  
8. Export Data success/error; Delete UI only (do not complete on shared seed).  
9. Sign out → login.  
10. Capture SpringBoard + Login screenshots once tooling exists (or Xcode Devices window).

### Failures to file

| Step # | Severity | Summary | Owner |
|--------|----------|---------|-------|
| 9 (host) | Low / env | Mac could not resolve `no-markup.com` during this run — legal URL live check incomplete from automation host | Ops / DNS |
| 8b | Medium / config | Empty `StripePublishableKey` + no `buy_now` listings in public sample — Apple Pay sheet not live-testable without config + seed listing | Mobile / seed |
| 9 (tooling) | Low | No device screenshot CLI on host | Tooling |
| 1 (copy) | Info | Scaffold button label differs from checklist wording | Docs or product copy |

---

## Safety constraints honored

- No account deletion completed.  
- No real bids placed.  
- No full Apple Pay charges.  
- Results file only — **not committed** unless requested.

---

## Launch board

When a human completes residual steps, update [`launch-board.md`](./launch-board.md) Device smoke matrix from “checklist only / automated partial” to signed-off (or list residual fails under Next).
