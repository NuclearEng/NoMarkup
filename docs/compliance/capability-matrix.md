# Capability Matrix — NoMarkup App Store Launch

**Status:** Stage A deliverable (A5) — **header refreshed 2026-07-27**  
**Date:** 2026-07-27  
**Binary readiness:** **IN PROGRESS** — native target exists at [`ios/NoMarkup.xcodeproj`](../../ios/NoMarkup.xcodeproj) (SwiftUI multiplatform shell + feature surfaces). ASC packaging / TestFlight / `DEPLOY_PROVISIONED` review backend remain open.  
**Live iOS feature SSOT:** [`ios-web-feature-matrix.md`](./ios-web-feature-matrix.md) (per-surface `live` / `partial` / `web-handoff`).  
**Related:** [`launch-board.md`](./launch-board.md) · [`submission-blockers.md`](./submission-blockers.md) · [`ios-payment-rails-design.md`](./ios-payment-rails-design.md) · [`app-review-notes.md`](./app-review-notes.md) · [`ios-mobile-web-readiness.md`](./ios-mobile-web-readiness.md) · [`privacy-purpose-string-inventory.md`](./privacy-purpose-string-inventory.md)

---

## Purpose

This matrix maps **every major product capability** to:

| Column | Meaning |
|--------|---------|
| **Capability** | User- or platform-facing feature |
| **Product surface** | Routes / roles (web + shared gateway) |
| **Apple framework / API (when native)** | iOS/iPadOS stack used or intended |
| **Entitlement** | Apple Developer entitlement / capability (or none) |
| **Feature flag** | Canonical `feature_flags.key` (`useFeatureFlags.ts` + DB) or `—` |
| **Web status** | What ships on **no-markup.com** today |
| **iOS status** | Native binary status — prefer [`ios-web-feature-matrix.md`](./ios-web-feature-matrix.md) for current code; many rows below still say `not started` as the original Stage A snapshot |
| **First binary plan** | Include / flag-off / defer / N/A for v1 App Store binary |
| **ASR / guideline** | Primary App Store Review / Before You Submit anchors |

### Status vocabulary

| Value | Meaning |
|-------|---------|
| `shipped` | Live product path (web UI + backend as applicable) |
| `partial` | Backend and/or incomplete UI; known gaps |
| `missing` | Not implemented |
| `n/a` | Not applicable to this client / role |
| `flag-off-v1` | Exists on web but **must be off** (or not exposed) on first iOS binary |
| `not started` | No native client code (legacy vocabulary — see live matrix for actual status) |
| `live` / `in tree` | Native surface present in `ios/NoMarkup` (use live feature matrix) |

### How to use with Stage B / current tree

1. **Scope v1 binary** from the [Must build for v1 binary](#must-build-for-v1-binary) list — do not expand into `flag-off-v1` rows without licenses + counsel.
2. **B0 scaffold** — **done in tree**: `ios/NoMarkup.xcodeproj` + SwiftUI app (not a pure full-site WKWebView — ASR-4.2).
3. **B1** SIWA + purpose strings (`Info.plist` / `LocationPurposeCopy`) + in-app legal links + account deletion / OAuth unlink (reuse gateway APIs) — largely in tree; re-check before submit.
4. **B2** dual-rail payments: **Stripe (Rail A)** for jobs/goods GMV; **StoreKit (Rail B)** for digital tiers only — after `review-logs/phase-4b.md` (do not stub StoreKit).
5. **B3** core browse → bid → escrow pay → chat → report/block — largely live per `ios-web-feature-matrix.md`.
6. **B4** server- or client-type gate: regulated flags off for iOS.
7. **B5** push optional — do not claim if unimplemented on device.
8. **B6** ASC package; demo path from `app-review-notes.md`.
9. **C** re-run compliance + device smoke; refresh this matrix when status changes.

**Sources of truth:** README / CLAUDE product surfaces · `ios/` native app · `web/src/hooks/useFeatureFlags.ts` · seed migrations `013` / `060` · payment dual-rail design · App Review notes flag matrix · [`ios-web-feature-matrix.md`](./ios-web-feature-matrix.md).

---

## Matrix

| Capability | Product surface | Apple framework / API (when native) | Entitlement | Feature flag | Web status | iOS status | First binary plan | ASR / guideline |
|------------|-----------------|-------------------------------------|-------------|--------------|------------|------------|-------------------|-----------------|
| Email / password auth | `/login`, `/register`; JWT + refresh cookie | URLSession + Keychain (tokens); no special social API | — | — | shipped | not started | **Must build** — same backend auth | 5.1.1 · PRE-05 |
| Sign in with Apple (SIWA) | OAuth `/api/v1/auth/oauth/apple` (+ callback) | AuthenticationServices (`ASAuthorizationAppleIDProvider`) | Sign in with Apple | — | shipped | not started | **Must build** if any third-party login ships (parity) | **4.8** · 5.1.1.v |
| Google OAuth | OAuth Google routes + UI buttons | ASWebAuthenticationSession / AppAuth (or Google Sign-In SDK) | — (no Apple entitlement) | — | shipped | not started | **Must build** (or drop Google from binary and keep email-only + SIWA) | 4.8 · 5.1.1.v |
| Facebook OAuth | Gateway Facebook OAuth routes | ASWebAuthenticationSession / FB SDK | — | — | partial (API; UI parity varies) | not started | Optional; if exposed, SIWA still required | 4.8 · 5.1.1.v |
| Session / refresh tokens | Gateway JWT RS256; secure cookies web | Keychain + Authorization header / cookie parity | — | — | shipped | not started | **Must build** | 5.1.1 · 2.5.2 public APIs |
| Age gate (18+) | `PUT /me/dob`, `/me/age-status`; DOB encrypted | Same APIs; DOB capture UI | — | — | shipped | not started | **Must build** — never Kids Category | 1.3 · Kids N/A · 5.1.1 |
| Account deletion | Settings account; 30-day grace + anonymize | Same API surface in Settings | — | — | shipped | not started | **Must build** (in-app, easy to find) | **5.1.1.v** · account-deletion support |
| Data export (GDPR/CCPA) | Self-serve export (owner-scoped) | Same API | — | — | shipped | not started | **Must build** or clear support path | 5.1.1 |
| OAuth unlink (connected accounts) | Settings → Security → Connected accounts | Same APIs; lockout-safe | — | — | shipped | not started | **Must build** | **5.1.1.v** |
| Privacy policy | `/privacy` + footer / settings | `SFSafariViewController` / in-app WebView **for legal only** or native text | — | — | shipped | not started | **Must build** + ASC Privacy URL | **5.1.1.i** |
| Terms of Service | `/terms` | Same | — | — | shipped | not started | **Must build** | 5.1 · 3.1.2 |
| Community guidelines | `/community-guidelines` | Same | — | — | shipped | not started | **Must build** (UGC) | **1.2** · 5.6 |
| Support contact | `/support` + `support@no-markup.com` | Mailto / in-app form; ASC Support URL | — | — | shipped | not started | **Must build** | PRE-03 · **1.2.d** · 1.5.a |
| Cookie / analytics consent | Cookie banner; Sentry gated on analytics | App Tracking Transparency **if** tracking; App Privacy labels | Tracking (if ATT applies) | — | shipped (opt-in analytics) | not started | **Must build** labels; ATT only if tracking | **5.1.1–5.1.2** · ATT |
| Jobs browse / map | `/jobs`, jobs map (edge-cached DATA) | SwiftUI lists; MapKit or Mapbox SDK | Location (when used) | — | shipped | not started | **Must build** | 2.1 · **3.1.3(e)** marketplace |
| Job post (customer) | Post-job flow; AI vision + voice progressive | PhotosUI / AVFoundation optional; same APIs | Camera / Photo Library (if used) | — | shipped | not started | **Must build** core post; AI optional | 2.1 · 5.1.1 |
| Job bid (provider, reverse auction) | Bids on jobs; bidding engine | Same REST/WS; native UI | — | — | shipped | not started | **Must build** | 2.1 · 3.1.3(e) |
| Contracts / milestones | Contract lifecycle post-award | Same APIs | — | — | shipped | not started | **Must build** (services path) | 2.1 · 3.1.3(e) |
| Listings browse (goods) | `/marketplace` | SwiftUI catalog | — | — | shipped | not started | **Must build** | 2.1 · **3.1.3(e)** |
| Sell / list goods | `/sell` | PhotosUI uploads; same APIs | Photo Library / Camera | — | shipped | not started | **Must build** | 2.1 · 5.1.1 |
| Goods bid (forward auction) | Listing bid / proxy / anti-snipe | Same APIs + optional WS | — | — | shipped | not started | **Must build** | 2.1 · 3.1.3(e) |
| Buy-It-Now | Instant purchase → escrow order | Stripe PaymentSheet (Rail A) | — | — | shipped | not started | **Must build** (Stripe, not IAP) | **3.1.3(e)** |
| Offers / counter-offers | Make/accept/reject/counter | Same APIs | — | `marketplace_offers` | shipped (flag-gated UX) | not started | Include if flag on; optional | 2.1 · 1.2 |
| Bid bonds | SetupIntent gate on flagged listings | Stripe (Rail A) | — | — | shipped | not started | Include if product on; Stripe only | 3.1.3(e) · 2.1 |
| Live auction arena | Real-time WS order book UI | URLSessionWebSocket / NWConnection + SwiftUI | — | `live_auction` | shipped (seed true) | not started | Include if product ships auctions | 2.1 · 4.2 min function |
| Spectator mode | Anonymous auction watch | Same WS/read APIs | — | `spectator_mode` | partial / seed false | not started | Optional; off OK for v1 | 2.1 |
| Instant match / smart matching | Fast-match offer queue | Same APIs | — | `smart_matching` | partial / seed false | not started | Optional | 2.1 |
| Fair price index | Market data page / widget | Same APIs | — | `fair_price_index` | partial / seed false | not started | Optional | 2.1 |
| NoMarkup guarantee claims | Guarantee claim surfaces | Same APIs | — | `nomarkup_guarantee` | partial / seed false | not started | Optional | 2.1 · 3.1.3(e) |
| Watchlist / follows / saved search | Goods social graph | Same APIs | — | — | shipped | not started | Nice-to-have; not hard blocker | 2.1 |
| Wishlist / price alerts | Keyword + max price alerts | Push optional for delivery | Push (if used) | — | shipped | not started | Optional; in-app notifications first | 4.5.4 |
| Reviews (services double-blind) | Contract reviews | Same APIs | — | — | shipped | not started | **Must build** (trust / UGC) | **1.2** |
| Orders & goods escrow | `/orders`, `/me/orders`; Connect escrow | Stripe iOS SDK PaymentSheet (Rail A) | — | — | shipped | not started | **Must build** | **3.1.3(e)** · 3.2 |
| Services escrow pay | Job award → PI / Connect hold | Stripe iOS SDK (Rail A) | — | — | shipped | not started | **Must build** | **3.1.3(e)** |
| Escrow release / refund (actor rules) | Provider cannot self-release; admin post-payout refund | Same server rules | — | — | shipped | not started | Server-enforced; native UI for allowed actors | 3.1.3(e) · 2.1 |
| Digital subscription tiers | Stripe Subscriptions on web (analytics, featured, bid limits) | **StoreKit 2** + App Store Server Notifications / JWS verify | In-App Purchase | — (tier codes map to features) | shipped (Stripe) | not started | **Must build via IAP** or **omit digital purchase UI** from binary | **3.1.1** · **3.1.2** · 3.1.3(b) multiplatform |
| Restore purchases / manage sub | Web: Stripe portal | `AppStore.showManageSubscriptions` + restore | In-App Purchase | — | n/a (Stripe manage) | not started | **Must build** if any IAP ships | 3.1.1 · 3.1.2 |
| Apple Pay (wallet on Stripe) | Stripe PM; domain association file | PassKit + Stripe Apple Pay | Apple Pay (merchant) | — | partial (placeholder domain assoc until prod file) | not started | Optional for v1; Rail A only — not a separate processor | **4.9** · 3.1.3(e) · 5.1.1 |
| Google Pay | Stripe web | n/a on iOS binary | — | — | partial | n/a | n/a on iOS | — |
| Chat (messaging) | Chat service + WS fan-out | Same APIs + WS; UserNotifications for badges later | — | — | shipped | not started | **Must build** | **1.2** · 2.1 |
| Report user / message / listing / job | Report APIs + UI buttons; admin queues | Same APIs | — | — | shipped | not started | **Must build** | **1.2.b** |
| Block user | Block at messaging + bid/BIN/offer boundary | Same APIs | — | — | shipped | not started | **Must build** | **1.2.c** |
| Pre-post content filter | `gateway/internal/contentfilter` on listing/job/chat/review/offer | Server-side only | — | — | shipped | n/a (server) | Rely on same gateway | **1.2.a** · 1.1 |
| Maps / market picker | Mapbox GL; city selector; King County pilot | MapKit **or** Mapbox iOS; Core Location for “nearest market” | Location When In Use | — | shipped | not started | **Must build** browse/geo UX + purpose strings | **5.1.5** · 2.5.1 |
| Photo / document upload | Imaging engine + S3 presign; 10MB cap | PhotosUI / UIImagePicker; same upload APIs | Photo Library / Camera / (no special entitlement) | — | shipped | not started | **Must build** for list/job/claim evidence | 5.1.1.iii · 2.5.14 |
| Provider GPS check-in | Provider workspace; client lat/lng (no server geofence yet) | Core Location | Location When In Use | — | shipped | not started | Include if provider role in binary; purpose string required | **5.1.5** · 2.5.1 |
| In-app notifications | Notification service; prefs per type/channel | Native inbox UI over same APIs | — | — | shipped | not started | **Must build** inbox; push separate | 2.1 |
| Web Push (PWA) | `/me/push-subscriptions` | n/a (web) | — | — | partial | n/a | n/a | — |
| Push (APNs / FCM devices) | Device registration paths (mobile-oriented) | UserNotifications + APNs | Push Notifications | — | partial / backend-oriented | not started | **Defer (B5)** — do not advertise if off | **4.5.4** · 2.5.4 |
| Provider workspace / calendar | Daily jobs + 7-day calendar; completion photos | SwiftUI; EventKit only if calendar export claimed | — (EventKit if used) | `provider_business_os` (suite extras) | shipped (core workspace) | not started | Core check-in/jobs **yes**; full Business OS optional | 2.1 · 5.1.5 |
| Instant payout | Ledger + Stripe; fees/caps | Stripe (Rail A) | — | `instant_payout` | shipped (seed **true**) | not started | **flag-off-v1** (or web-only until risk review) | 3.1.3(e) · 3.2 · 5.1.1.ix residual |
| Customer BNPL | 3/6 installments | Would be Stripe; **not** in first binary | — | `customer_bnpl` | shipped (seed **true**) | not started | **flag-off-v1** until licenses | **3.2.1** · **5.1.1.ix** |
| Working capital advances | Underwriting engine + booking fees | Stripe web; **not** first binary | — | `working_capital` | shipped (seed **true**) | not started | **flag-off-v1** until licenses | **3.2.1** · **5.1.1.ix** |
| Per-job insurance | Products + claims lifecycle | Stripe PI (regulated product) | — | `per_job_insurance` | shipped (seed **true**) | not started | **flag-off-v1** until licenses / org account | **3.2.1.viii** · **5.1.1.ix** · ASR-5.1.1.ix |
| Insurance competition (multi-carrier) | Quote fan-out / bind preview | Same | — | `insurance_competition` | flag-off web (seed **false**) | not started | **flag-off-v1** (stay off) | 3.2.1.viii · 5.1.1.ix |
| Legal services vertical | `/legal`, bar badge, categories | Same | — | `legal_services` | flag-off web (seed **false**) | not started | **flag-off-v1** (stay off) | 3.2 · 5.1.1.ix · vertical compliance |
| Lead gen (paid leads) | Opt-in lead product | Same | — | `lead_gen` | flag-off web (seed **false**) | not started | **flag-off-v1** / stay off | 3.1 · 3.2 |
| Change orders / disputes | Contract change orders; dispute evidence + admin | Same APIs | — | — | shipped | not started | Include for services completeness if contracts ship | 2.1 · 1.2 |
| Trust scoring / badges | Rust trust engine; tier badges | Display-only from APIs | — | — | shipped | not started | Read-only display OK | 2.1 |
| Fraud heuristics | Rust fraud engine (server) | Server-side only | — | — | shipped (server) | n/a | Server | 1.6 · 2.1 |
| Admin console | `/admin/*` flags, reports, markets, fees | **Not in consumer binary** | — | — | shipped (web admin) | **n/a** | **n/a** — web/admin only; never ship admin in consumer App Store app | 2.3 · 4.2 · security |
| Geographic market control | Admin markets; public catalog active-gated | Server + market picker | Location (picker) | — | shipped | not started | Market picker **yes**; admin flips web-only | 5.1.5 · 2.1 |
| Feature flags (client UX) | `GET /api/v1/flags`; admin CRUD | Same public flags; iOS may use client-type override | — | (meta) | shipped | not started | **Must** honor flags; iOS packaging may force regulated keys off | SEC-01 · 2.1 |
| Search (Meilisearch) | Catalog/job search via gateway | Same APIs | — | — | shipped | not started | **Must build** for marketplace usability | 2.1 |
| AI job vision / voice input | Progressive enhancement on post job | Vision / Speech optional | Microphone / Camera if used | — | shipped | not started | Optional; form must work without | 2.1 · 5.1.1 |
| PWA / service worker | Manifest; SW is kill-switch today | n/a | — | — | partial (no prod offline cache) | n/a | n/a — native is not PWA | 4.2 |
| Dark mode / design system | Brand gold + full dark | SwiftUI color scheme / HIG | — | — | shipped | not started | Follow HIG; Stage A Phase 2 | 4.x HIG |
| Accessibility (WCAG goal) | Web a11y controls; not full axe CI gate | UIKit/SwiftUI a11y; VoiceOver | — | — | partial (goal AA) | not started | **Must** meet App Store a11y expectations | 4.x · HIG Accessibility |
| Observability (Sentry/OTel) | Client + services | Similar mobile SDK with consent | — | — | shipped (consent-gated browser Sentry) | not started | Optional; privacy labels if collect | 5.1.1–5.1.2 |
| mTLS mesh / deploy provisioned | Infra residual | n/a | — | — | partial / not production-ready | n/a | Ops prerequisite for review backend — not a UI capability | PRE-05 · BYS.3 |

---

## Feature-flag quick reference (first iOS binary)

Canonical keys: `web/src/hooks/useFeatureFlags.ts` + `feature_flags` table.  
Gateway `RequireFlag` → **503** when row exists and `enabled=false` (fails closed in production for missing/error/nil DB).  
Financial UI keys fail closed when missing (`FINANCIAL_FEATURE_FLAG_KEYS`).

| Flag | Web seed guidance (013/060) | First iOS binary |
|------|----------------------------|------------------|
| `live_auction` | true (013) | Keep if auctions ship |
| `spectator_mode` | false | Optional / off OK |
| `nomarkup_guarantee` | false | Optional |
| `smart_matching` | false | Optional |
| `provider_business_os` | false | Optional |
| `fair_price_index` | false | Optional |
| `marketplace_offers` | (if present) | Optional |
| `customer_bnpl` | **true** (060) | **OFF** |
| `instant_payout` | **true** (060) | **OFF** or web-only |
| `per_job_insurance` | **true** (060) | **OFF** |
| `working_capital` | **true** (060) | **OFF** |
| `insurance_competition` | **false** (060) | Stay **OFF** |
| `legal_services` | **false** (060) | Stay **OFF** |
| `lead_gen` | **false** (060) | Stay **OFF** |

iOS packaging is a **separate** configuration from web seed defaults (`ios-payment-rails-design.md`).

---

## Payment rails summary

| Rail | Owns | iOS | Web |
|------|------|-----|-----|
| **A — Stripe** | Jobs GMV, goods escrow, Connect payouts, bid bonds, (licensed) insurance PI | Stripe iOS SDK + optional Apple Pay | Stripe (current) |
| **B — StoreKit** | Digital subscription unlocks (analytics, featured placement, bid limits, etc.) | **Required** when digital purchase is in binary | Stripe Subscriptions (multiplatform reader rules) |

Do **not** stub StoreKit. Do **not** sell digital unlocks via Stripe inside the iOS binary.

---

## Must build for v1 binary

Minimum native surface so the app is a complete marketplace (not a thin brochure) and passes privacy / UGC / identity gates. **Assumes** regulated money products remain flag-off.

### Hard must (blocks submission if missing)

1. **Native shell** — real iOS/iPadOS app (SwiftUI multiplatform preferred); not pure full-site WKWebView (**4.2**, **2.1**).
2. **Email auth** + session handling (Keychain).
3. **Sign in with Apple** if Google/Facebook remain (**4.8**).
4. **Account deletion** + **OAuth unlink** in Settings (**5.1.1.v**).
5. **Privacy, Terms, Community Guidelines, Support** links (in-app + ASC URLs) (**5.1.1.i**, **1.2**, PRE-03).
6. **Age 18+** gate / DOB verification path.
7. **Jobs browse + post** (customer) and **bid** (provider) — reverse-auction core.
8. **Listings browse + sell** and **bid / BIN** — forward-auction / goods core.
9. **Escrow pay (Rail A Stripe)** for services and goods — **not** IAP (**3.1.3(e)**).
10. **Chat** + **report** + **block** (server content filter already shared) (**1.2**).
11. **Maps / market context** + **location purpose strings** if location used (**5.1.5**).
12. **Photo upload** for listings / jobs (and claims if insurance ever on).
13. **In-app notification inbox** (push optional).
14. **App Privacy labels** + purpose strings inventory (Stage A3 → B1).
15. **Feature-flag / client gate** so BNPL, advances, insurance*, legal, lead_gen stay **off**.
16. **Digital tiers:** either **StoreKit 2 + server verify + restore** (**3.1.1**) **or** omit in-app digital purchase entirely (web-only Stripe for those unlocks).

### Strongly recommended for provider completeness

17. Provider **workspace** job list + **GPS check-in** (with purpose string).
18. **Orders** lifecycle UI (pickup confirm / status).
19. **Reviews** on contracts.

### Explicitly out of v1 binary (unless licenses + counsel)

- `customer_bnpl`, `working_capital`, `per_job_insurance`, `insurance_competition`, `legal_services`, `lead_gen`
- `instant_payout` (default: off / web-only)
- **Admin** console
- **APNs** push (optional B5 — do not claim)
- Full **Business OS** / spectator / smart match / fair price unless product prioritizes them

### Non-product blockers (ops / packaging)

- Live review backend (`DEPLOY_PROVISIONED` / staging always-on) — PRE-05  
- ASC metadata, screenshots, age rating — B6  
- Production Apple Pay domain association file before claiming Apple Pay  

---

## Counts

| Metric | Value |
|--------|--------|
| **Matrix rows** | **68** |
| **Web `shipped` (approx.)** | Majority of marketplace + UGC + legal |
| **iOS (2026-07-27)** | Scaffold + many consumer surfaces **live** in `ios/NoMarkup` — see [`ios-web-feature-matrix.md`](./ios-web-feature-matrix.md). Per-row iOS column in this file is still partly a Stage A snapshot (`not started`); treat the live feature matrix as SSOT for code status. |
| **flag-off-v1 (regulated / risk)** | BNPL, advances, insurance×2, legal, lead_gen, instant_payout (soft) |
| **Must-build hard items** | **16** (plus 3 strongly recommended) |
| **Not invented** | No third-party **Checkr** / background-check integration (PRD FR-2.9 remains open question) |

---

## Maintenance

- Update a row when web or native status changes; bump **Date** in the header.
- Prefer patching [`ios-web-feature-matrix.md`](./ios-web-feature-matrix.md) for day-to-day iOS progress; fold into this capability matrix on release gates.
- After Phase 4B StoreKit review log, lock digital-tier rows to concrete product IDs (still no fake stubs).
- Keep aligned with `submission-blockers.md` and `launch-board.md` Stage B IDs (B0–B6).
)
