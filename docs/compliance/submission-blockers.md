# Submission blockers remaining (one-pager)

**As of:** 2026-08-02 (eng packaging 100 — free-tier lock + dual-rail feature depth)  
**Binary tree:** `ios/NoMarkup` (SwiftUI native)  
**Related:** [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) · [`app-review-notes.md`](./app-review-notes.md) · [`launch-board.md`](./launch-board.md) · [`eng-completion-scorecard-2026-08-02.md`](./eng-completion-scorecard-2026-08-02.md)

---

## Claim discipline

| Claim | Status |
|-------|--------|
| Consumer dual-rail **engineering** (services + goods) | **100 / 100** — see eng scorecard |
| Free-tier digital lock (no StoreKit / no IAP paywall) | **LOCKED** — [`v1-ios-product-cut.md`](./v1-ios-product-cut.md) |
| Native chrome (Guideline **4.2**) | **Met in code** — `RootTabView` TabView; no pure WKWebView shell |
| Account deletion + privacy/terms in-app | **Met in code** — Account → Legal / Your data |
| Export compliance key | **Met** — `ITSAppUsesNonExemptEncryption = false` in `Info.plist` |
| **App Store Connect submission ready** | **Not yet** — **founder / ASC portal only** (below) |

Engineering cannot complete Team signing or ASC portal clicks. This page lists **only what still blocks first public submit**.

---

## Remaining blockers — founder / ops only

| # | Blocker | Guideline / gate | Who | Exact action |
|---|---------|------------------|-----|--------------|
| **1** | Apple Developer **Team** + App ID + SIWA capability | Signing / 4.8 | Founder | Create App ID `com.nomarkup.app`; enable **Sign in with Apple**; set gateway `APPLE_NATIVE_CLIENT_ID=com.nomarkup.app` |
| **2** | Distribution cert + App Store provisioning + archive upload | 2.1 | Founder | Xcode 26+ → Archive → Upload (see [`testflight-process.md`](./testflight-process.md)) |
| **3** | ASC **app record** + metadata | 2.3 | Founder | Name, SKU, subtitle, categories, description, keywords; paste Review Notes from [`app-review-notes.md`](./app-review-notes.md) |
| **4** | **Screenshots** 6.9" iPhone + 13" iPad | 2.3 | Founder | Capture via Simulator or `ScreenshotWalkUITests` — matrix: [`app-store-screenshot-matrix.md`](./app-store-screenshot-matrix.md) |
| **5** | App Privacy **nutrition labels** | 5.1 | Founder | Enter table from packaging checklist §4 (Device ID **linked**, not tracking) |
| **6** | Age rating + content rights questionnaires | 2.3 | Founder | Paste answers from [`asc-content-rating-answers.md`](./asc-content-rating-answers.md) |
| **7** | Export compliance in ASC (if still prompted) | Export | Founder | Answer exempt / HTTPS-only; binary already has `ITSAppUsesNonExemptEncryption=false` |
| **8** | Demo accounts + review contact in ASC | PRE-03/04 | Founder | Seed emails in notes; password in **ASC secure password field only** (from `SEED_PASSWORD` / seed log — **never commit**) |
| **9** | Review backend **always-on** + seed | PRE-05 | Founder / ops | `https://api.no-markup.com` (or review host) reachable from Apple’s network; `make seed` applied |
| **10** | Optional Apple Pay merchant + domain association | 3.1.3(e) polish | Founder | If claiming Apple Pay in screenshots: merchant ID + Stripe Dashboard + domain file — [`apple-pay-domain.md`](./apple-pay-domain.md). Without it, card/Link still works when `pk_` is set. |
| **11** | Human **device smoke** sign-off | Quality | Founder / QA | [`device-smoke-checklist.md`](./device-smoke-checklist.md) — eng does not claim “device verified” |
| **12** | Regulated rails **off** on review env | 3.2 / licenses | Founder / ops | Keep server flags **off**: `customer_bnpl`, `working_capital`, `per_job_insurance`, `insurance_competition`, `legal_services`, `lead_gen`, `instant_payout` |

Nothing in rows **1–12** is missing Swift/Go/Rust product code for the free-tier dual-rail submit posture.

---

## Cleared for eng packaging (do not re-open as code blockers)

| Item | Evidence |
|------|----------|
| Native TabView shell (not pure WebView) | `RootTabView` · `LegalWebView` = `SFSafariViewController` for legal/support only |
| SIWA path | `AuthenticationServices` + `POST /api/v1/auth/apple/native` |
| Legal links | Account + login → Privacy / Terms / Community / Support |
| Account deletion / export | `AccountDeletionView` → `DELETE /api/v1/users/me`; export share sheet |
| Dual-rail feature depth | Jobs reverse-auction + marketplace forward-auction + chat/orders/escrow UI — eng scorecard **100/100** |
| Free-tier digital | No StoreKit; Account + `PlanLimitsView` state no IAP |
| Purpose strings + Face ID | `Info.plist`: location, photos, camera, Face ID; **no** mic / ATT |
| Privacy manifest | `PrivacyInfo.xcprivacy` (app + widget) |
| Export encryption flag | `ITSAppUsesNonExemptEncryption` = **false** |
| Regulated rails gate model | `FeatureFlags.iOSHardOffKeys = []` — **server flags** + `RequireFlag`; review env keeps flags **off** |
| B6 eng docs package | This file + checklist + review notes + content rating + screenshot matrix + TestFlight process |

---

## Locked product decisions (unchanged)

1. **Rail A** Stripe GMV (goods + offline services) — Guideline **3.1.3(e)** · **Rail B** StoreKit digital — **deferred**; free-tier only in first binary.  
2. No pure WKWebView app.  
3. No ATT unless ads/IDFA.  
4. Regulated rails via **server flags** (not client hard-off list): keep off until compliance exit.  
5. First public marketing version **`1.0.0`** (build monotonic integer; tree currently `1.0.0` / `3`).

---

## Next (founder only)

1. Follow [`testflight-process.md`](./testflight-process.md) § founder steps.  
2. Tick remaining `[~]` rows in [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) §10.  
3. Paste [`app-review-notes.md`](./app-review-notes.md) § **ASC paste block**.  
4. Do **not** enable regulated flags or StoreKit for this submit.

**Eng ASC packaging bar:** **100 / 100** (docs + binary eng gates).  
**Overall App Store submit bar:** **blocked only by founder/ASC-OPS rows above** (not eng product gaps).
