# App Store Compliance Report — Stage C Launch Verification

- **Target**: `/Users/nuclearisotope/Projects/Personal/NoMarkup`
- **Date**: 2026-07-26 (Stage C verification — post Stage B scaffold + docs)
- **Baseline audits**:
  - Initial: `docs/compliance/app-store-review-2026-07-26.md` (NOT READY — web-only posture)
  - Post-remediation: `docs/compliance/app-store-review-2026-07-26-remediated.md` (web READY WITH FOLLOW-UPS; binary DEFERRED)
- **Guidelines snapshot**: **2026-06-08** ([App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/))
- **Platform / posture**: **ios packaging readiness** for monorepo with **native SwiftUI shell** (`ios/NoMarkup`) + shared Go/Rust API mesh
- **Submission readiness (App Store binary)**: **NOT READY**
- **Submission readiness (web product policy surface)**: **READY WITH FOLLOW-UPS** (unchanged from remediation)
- **v1 product cut (recommended)**: **free-tier-only digital on iOS** — see [`v1-ios-product-cut.md`](./v1-ios-product-cut.md)

---

## Honest readiness justification

| Surface | Label | Why |
|---------|-------|-----|
| **Web** (no-markup.com) | **READY WITH FOLLOW-UPS** | Privacy/Terms/UGC/support/consent remediated; money integrity residual ADR; deploy ops residual |
| **iOS binary** | **NOT READY** | Scaffold + partial API wiring exist and build for Simulator; **not** App Review–quality. Missing: ASC assets, team signing, live review backend, full bid/pay write funnel, and **ASC-confirmed** free-tier-only digital posture (or B2 StoreKit) |
| **Stage C smoke** | **Partial** | Docs + matrix in this file; **device smoke not executed** in this verification pass (checklist only) |

**Do not submit** until `submission-blockers.md` and `asc-packaging-checklist.md` §10 gates clear, and the free-tier product cut (or StoreKit B2) is confirmed in App Review notes.

---

## Applicability profile

Same product profile as baseline / remediation (marketplace dual surface, UGC, multiplatform):

| Flag | Value | Evidence |
|------|-------|----------|
| `always` | true | App Store packaging in progress |
| `ugc` | true | Jobs, listings, chat, reviews, photos |
| `social` | true | Messaging, profiles |
| `location` | true | Market geo, purpose strings; GPS check-in on web; native purpose copy present |
| `account` | true | Email/password + SIWA native path |
| `third_party_login` | true (web); **SIWA + email on native** | Google/Facebook not required in first binary if not exposed |
| `physical_goods` | true | Goods marketplace + local pickup + escrow (web; native browse only so far) |
| `p2p` | true | Real-world job services |
| `multiplatform` | true | Web + native shell |
| `subscriptions` / `iap` | true product-wide; **false in first binary purchase path** | Web Stripe tiers; **v1 iOS = free-tier-only** (no StoreKit UI) |
| `insurance` | true on web | **Hard-off** in iOS binary |
| `financial` | true on web | BNPL / advances **hard-off** on iOS |
| `regulated` | true | Insurance, advances, legal vertical — flag-off on iOS |
| `metadata` | true (ASC future) | Checklist exists; ASC record not filled |
| `us_storefront` | true (assumed) | King County pilot |
| `kids_*`, `medical`, `health`, `crypto`, `nft`, `loot_boxes`, `ads`, `gambling`, `vpn`, `mdm`, `mac`, `arkit`, `extensions`, `widgets`, `mini_apps` | **false** | Out of product scope |

**Platform change vs remediation:** Native tree **`ios/`** exists (`NoMarkup.xcodeproj`, SwiftUI TabView shell, marketplace/jobs, SIWA, `FeatureFlags`). This is **not** a pure WKWebView of the site.

---

## What shipped since remediation (Stage B)

| ID | Item | Status | Evidence |
|----|------|--------|----------|
| **B0** | SwiftUI native shell | **done** | `ios/NoMarkup` — Home · Marketplace · Jobs · Messages · Account (`RootTabView`) |
| **B1** | SIWA + purpose strings + legal + delete/export | **done** | `Auth/`, `Info.plist` purpose keys, `LegalWebView`, `AccountDeletionView` |
| **B2** | StoreKit digital IAP | **todo** | Explicitly omitted; Account states “not in this build” |
| **B3** | Public catalog list/detail | **done** | `MarketplaceView`, `ListingDetailView`, `JobsView`, `JobDetailView` |
| **B3+** | Auth my jobs + chat channels/messages | **done** | Jobs “Mine” segment; `MessagesView` / channel + thread read paths |
| **B4** | Hard-off regulated flags | **done** | `FeatureFlags.iOSHardOffKeys` |
| **B5** | APNs push | **deferred** | Do not claim in ASC |
| **B6** | ASC packaging docs | **done** (docs) | `asc-packaging-checklist.md`; ops residual open |
| **C** | Compliance re-score + device smoke | **this doc** (partial) | Smoke = manual checklist below — not yet signed off on device |

Related: `launch-board.md`, `submission-blockers.md`, `ios-payment-rails-design.md`, `ios/README.md`.

---

## Executive summary

**Native progress is real** (shell, SIWA exchange, public browse, hard-off, account/legal, partial auth reads). **App Store submission is still blocked** by packaging ops, incomplete commerce write funnel, and the unresolved **digital-tier purchase strategy** until free-tier-only is product-locked (this Stage C recommends locking it — [`v1-ios-product-cut.md`](./v1-ios-product-cut.md)).

**Recommended v1 cut (ASR-3.1.1):** first binary ships **without** digital subscription purchase UI and **without** IAP capability. Free-tier digital feature baseline only; paid Pro/Business unlocks remain **web-only** until StoreKit (B2). Rail A Stripe for physical/offline GMV when payment UI is wired. Cite Guideline **3.1.1**: do not sell or gate paid digital unlocks inside the binary without IAP.

---

## Findings by area (ASR IDs)

### PASS (binary + platform evidence for first-binary scope)

#### [ASR-1.2.*] Web UGC safety pack (platform)

- Status: **PASS** (server/web; native relies on same APIs)
- Severity: blocker (platform)
- Evidence: content filter, report/block, community guidelines — see remediated report. Native does not reimplement filters; writes that exist go through gateway.
- Confidence: 8

#### [ASR-5.1.1.i] Privacy / legal pages + in-app links

- Status: **PASS**
- Severity: blocker
- Evidence: `https://no-markup.com/privacy` (and terms/support/community); native `LegalWebView` / Safari from Account.
- Confidence: 9

#### [ASR-3.1.3.e] Dual-rail design (Rail A Stripe GMV)

- Status: **PASS** (design + product rule)
- Severity: blocker (design)
- Evidence: `ios-payment-rails-design.md`; Home/Account copy: real-world GMV → Stripe, not IAP.
- Confidence: 9
- Note: **Payment UI not fully in binary** — design PASS does not equal checkout E2E PASS.

#### [ASR-4.2] Native chrome (not pure WebView)

- Status: **PASS** (scaffold quality; not full product completeness)
- Severity: blocker
- Evidence: SwiftUI `TabView` + native list/detail; legal-only Safari/WebView. Not a website wrapper.
- Confidence: 8
- Residual: incomplete write funnel may still draw **2.1** “incomplete” if submitted as full marketplace claims.

#### [ASR-5.1.5] Purpose strings

- Status: **PASS**
- Severity: blocker
- Evidence: `Info.plist` — `NSLocationWhenInUseUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSCameraUsageDescription`; no mic/ATT keys (correct).
- Confidence: 9

#### [ASR-3.2 / 5.1.1.ix] Regulated features hard-off

- Status: **PASS** (client gate)
- Severity: blocker for first binary
- Evidence: `FeatureFlags.iOSHardOffKeys` forces off BNPL, working capital, insurance*, legal, lead_gen, instant_payout.
- Confidence: 9

#### [ASR-2.1] Public catalog browse

- Status: **PASS** (read path)
- Severity: major for thin-app risk
- Evidence: Marketplace + Jobs public GET list/detail wired.
- Confidence: 8

#### [ASR-4.8] Sign in with Apple endpoint

- Status: **PASS** (implementation path)
- Severity: blocker if third-party login present
- Evidence: AuthenticationServices UI + `POST /api/v1/auth/apple/native`; entitlement in project.
- Confidence: 8
- Residual: App ID + `APPLE_NATIVE_CLIENT_ID` ops still required for review.

#### [ASR-5.1.1.v] Account deletion path

- Status: **PASS** (entry + API wiring)
- Severity: blocker
- Evidence: `AccountDeletionView` → `DELETE`/`GET …/users/me` (+ export).
- Confidence: 8

---

### FAIL / GAP (block App Review binary claim)

#### [ASR-3.1.1] Digital tiers without StoreKit **or** free-tier-only confirmation

- Status: **GAP** → closes only with product decision + ASC notes (or full B2)
- Severity: **blocker** if paid digital unlock/paywall ships without IAP
- Current scaffold: no StoreKit UI; Account says “not in this build”
- **Stage C recommendation:** lock **free-tier-only** ([`v1-ios-product-cut.md`](./v1-ios-product-cut.md)) — no subscription purchase UI until B2. **ASC App Review notes must state this explicitly.**
- Confidence: 9

#### [ASR-2.3 / PRE-02] ASC assets

- Status: **FAIL / open**
- Severity: blocker for submit
- Evidence: App Icon asset open; screenshots not captured; age rating / privacy nutrition labels not entered in ASC.
- Source: `asc-packaging-checklist.md` §6, §10.3
- Confidence: 10

#### [ASR-2.1 / signing] Team signing & distribution

- Status: **FAIL / open**
- Severity: blocker
- Evidence: Simulator `CODE_SIGNING_ALLOWED=NO` build path documented; no App Store provisioning / distribution cert in-repo claim.
- Confidence: 9

#### [ASR-2.1] Full bid / pay write funnel incomplete

- Status: **FAIL / GAP** for “complete marketplace” claim
- Severity: major → blocker if metadata over-claims
- Evidence: Public browse + my jobs + chat **reads** ship; place bid, BIN, escrow PaymentSheet, post job/list sell, full compose chat not complete as web parity.
- Confidence: 8

#### [ASR-PRE-05] Deploy / review backend always-on

- Status: **DEFERRED / GAP**
- Severity: blocker at submit time
- Evidence: Release `APIBaseURL` → `https://api.no-markup.com`; `DEPLOY_PROVISIONED` not claimed; seed/staging ops human-gated.
- Confidence: 8

#### [ASR-3.1.1 / B2] StoreKit implementation

- Status: **N/A for free-tier-only v1** · **todo** if product later sells digital unlocks in-app
- Do **not** stub StoreKit products in CI.
- Confidence: 9

---

### Accepted residual (unchanged)

#### [ASR-2.1.a.4] Money integrity residual

- Status: **accepted_risk**
- Evidence: `adr-2026-07-26-money-integrity-residual.md` (MON-14–18)
- Confidence: 8

---

## Explicit v1 product cut (Stage C)

| Decision | **Free-tier-only digital on iOS** |
|----------|----------------------------------|
| StoreKit / IAP | **Deferred (B2)** — no purchase UI, no IAP capability, no ASC IAP products for v1 |
| Paid digital (Pro/Business) | **Web-only** via Stripe until B2; **no** in-app “buy on web cheaper” CTA for digital unlocks |
| Free tier | Analytics/featured/higher limits **not** sold in binary; free baseline only |
| Rail A | Stripe for physical goods + offline services **when** pay is wired (**3.1.3(e)**) |
| Guideline | **ASR-3.1.1 / 3.1.1** — digital content/features sold in-app must use IAP; avoiding sale/gate of paid digital inside the binary is the compliant interim |
| Full write-up | [`v1-ios-product-cut.md`](./v1-ios-product-cut.md) |

Without this lock (or B2), digital-tier exposure remains a **submission blocker**.

---

## Device smoke matrix (manual)

Run on **physical device or Simulator** against a reachable API (staging/prod seed). Check boxes only after human execution.

### Environment

| Check | Pass? | Notes |
|-------|-------|-------|
| Xcode scheme `NoMarkup` builds (Sim) | [ ] | `launch-board.md` build command |
| API host reachable from device | [ ] | Release: `https://api.no-markup.com` |
| Seed users available | [ ] | `customer@` / `provider@` + `SEED_PASSWORD` |
| `APPLE_NATIVE_CLIENT_ID` set on gateway | [ ] | Bundle ID audience |

### Cold start & chrome

| # | Scenario | Guideline | Pass? |
|---|----------|-----------|-------|
| 1 | Cold launch → Home tabs render (not blank WebView site) | 4.2 | [ ] |
| 2 | Marketplace list loads public listings | 2.1 | [ ] |
| 3 | Open listing detail | 2.1 | [ ] |
| 4 | Jobs Browse list + job detail | 2.1 | [ ] |
| 5 | Dark mode / Dynamic Type sanity (sample screens) | 4.x HIG | [ ] |
| 6 | iPad layout does not crash (universal) | 2.1 | [ ] |

### Auth & privacy

| # | Scenario | Guideline | Pass? |
|---|----------|-----------|-------|
| 7 | Email/password login (seed customer) | 5.1.1 | [ ] |
| 8 | Sign in with Apple (device) → tokens stored | **4.8** | [ ] |
| 9 | Jobs **Mine** loads with auth (not scaffold session) | 2.1 | [ ] |
| 10 | Messages channels list (auth) | 1.2 / 2.1 | [ ] |
| 11 | Account → Privacy / Terms / Support open (Safari/legal) | **5.1.1.i** | [ ] |
| 12 | Account deletion entry visible + confirm flow reaches API | **5.1.1.v** | [ ] |
| 13 | Data export path (if exercised) | 5.1.1 | [ ] |
| 14 | Location purpose string appears if location prompt fires | **5.1.5** | [ ] |

### Payments & regulated (must **not** mislead)

| # | Scenario | Guideline | Pass? |
|---|----------|-----------|-------|
| 15 | Account states StoreKit / digital subs **not in this build** | **3.1.1** | [ ] |
| 16 | No digital paywall / no IAP sheet | **3.1.1** | [ ] |
| 17 | No BNPL / advances / insurance purchase / legal / lead-gen / instant payout CTAs | **3.2** | [ ] |
| 18 | Hard-off keys force false even if server true (Launch gates / debug if present) | 3.2 | [ ] |
| 19 | No Stripe Checkout for digital unlocks in binary | **3.1.1** | [ ] |

### Negative / honesty

| # | Scenario | Pass? |
|---|----------|-------|
| 20 | Scaffold session cannot fake full chat/API as production | [ ] |
| 21 | Offline / API error surfaces retry (catalog) | [ ] |
| 22 | Do **not** claim push notifications | [ ] |

**Stage C smoke sign-off:** _______________ date: ________ (empty = not completed)

---

## Definition of done vs current

| Criterion | Required for “App Store ready” | Current (2026-07-26 Stage C) |
|-----------|--------------------------------|------------------------------|
| In-scope web blockers closed or accepted_risk | Yes | **Met** (remediation) |
| Native shell not pure WebView | Yes | **Met** (B0) |
| SIWA + purpose strings + legal + delete | Yes | **Met** (B1) |
| Public catalog | Yes | **Met** (B3) |
| Auth reads (my jobs, chat) | Strong for 2.1 | **Met** (B3+) |
| Regulated hard-off | Yes | **Met** (B4) |
| Digital: StoreKit **or** free-tier-only locked + ASC notes | Yes | **Decision documented**; ASC confirmation **open** |
| Bid + Rail A pay write funnel | Yes for full marketplace claim | **Incomplete** |
| ASC package (icon, screenshots, labels, age) | Yes | **Open** |
| Team signing + distribution | Yes | **Open** |
| Review backend always-on | Yes | **Open** |
| Device smoke matrix executed | Yes for Stage C complete | **Checklist only** |
| Push (B5) | No if not claimed | Deferred correctly |
| Zero remaining **binary** blocker FAIL | Yes | **Not met** |

**Stage C status:** **partially complete** — verification report + product cut written; residual blockers prevent READY / READY WITH FOLLOW-UPS for **binary** submission.

---

## Counts (binary packaging, Stage C)

| Metric | Count |
|--------|--------|
| PASS (scoped to first-binary compliance surface) | ~9 areas above |
| FAIL / open blockers (signing, ASC media, funnel, backend) | **4+** |
| GAP (3.1.1 until free-tier ASC-locked or B2) | **1** strategic |
| DEFERRED (push, full StoreKit, deploy provision) | several |
| accepted_risk | money integrity ADR |

---

## Pre-submit residual checklist (pointer)

| ID | Status |
|----|--------|
| Team / App ID / SIWA capability | open |
| App Icon + screenshots | open |
| Age rating + App Privacy labels | open |
| Free-tier-only notes in ASC **or** B2 products | open (docs recommend free-tier) |
| Demo accounts + live API | open |
| Full smoke matrix signed | open |
| See | `asc-packaging-checklist.md` §10 · `submission-blockers.md` |

---

## Artifacts

| Path | Role |
|------|------|
| `docs/compliance/v1-ios-product-cut.md` | Locked free-tier-only v1 decision |
| `docs/compliance/asc-packaging-checklist.md` | ASC packaging |
| `docs/compliance/submission-blockers.md` | One-pager blockers |
| `docs/compliance/launch-board.md` | Stage board |
| `docs/compliance/ios-payment-rails-design.md` | Dual-rail Option A |
| `docs/compliance/app-review-notes.md` | Review paste |
| `ios/NoMarkup/` | Native binary tree |

---

## Disclaimer

This Stage C verification maps product and monorepo evidence to Apple’s published App Store Review Guidelines (snapshot **2026-06-08**). It is **not legal advice** and does **not** guarantee App Review approval. Completing documentation does not make the binary submission-ready. Counsel review of Privacy/Terms and export compliance answers is recommended before public launch. Device smoke must be executed by a human on hardware/Simulator with a live review backend before any submit claim.
