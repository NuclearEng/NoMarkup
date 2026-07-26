# App Review Notes (NoMarkup)

**Purpose:** Paste/adapt into App Store Connect **App Review Information → Notes**
and internal review packaging.  
**Source ASR IDs:** ASR-PRE-03, ASR-PRE-04 / BYS.2, ASR-PRE-06 / BYS.4, ASR-2.3.1.a.1.  
**Product today:** Web marketplace at **no-markup.com** (hyphenated). Native iOS
binary is **in development** (SwiftUI scaffold, Stages B0–B4); full ASC packaging
checklist lives in [`asc-packaging-checklist.md`](./asc-packaging-checklist.md). Dual-rail
design: [`ios-payment-rails-design.md`](./ios-payment-rails-design.md).

---

## Native iOS binary (in development)

**Status:** Simulator/generic iOS build succeeds; **not** App Review submission-ready
(see [`submission-blockers.md`](./submission-blockers.md) and [`launch-board.md`](./launch-board.md)).

### Scaffold status (B0–B4)

| Stage | What shipped |
|-------|----------------|
| **B0** | SwiftUI `TabView` shell (`ios/NoMarkup`) — Home · Marketplace · Jobs · Messages · Account; **not** a pure WKWebView of the site (Guideline **4.2**) |
| **B1** | Sign in with Apple entitlement + UI; purpose strings in `Info.plist`; in-app legal links (Privacy / Terms / Community Guidelines / Support via Safari); account deletion entry + export wiring |
| **B3** | Public marketplace + jobs list/detail against live GET APIs |
| **B4** | Client hard-off for regulated feature flags |
| **B2** | StoreKit digital unlocks — **not started** (no stubs) |
| **B5** | APNs push — **deferred** (do not claim in ASC metadata) |
| **B6** | ASC packaging docs — checklist in `asc-packaging-checklist.md` |

**Bundle ID (proposed / project):** `com.nomarkup.app`  
**Release API base:** `https://api.no-markup.com` (`AppConfig` / `APIBaseURL`) — gateway **must be reachable** for any review build.

### Dual-rail (same product rule as web packaging)

| Rail | Scope | Processor in first binary |
|------|--------|---------------------------|
| **A — GMV** | Jobs escrow, goods orders, Connect payouts, real-world services | **Stripe** when payment UI ships (**3.1.3(e)** — non-IAP). Not a digital content unlock. |
| **B — Digital tiers** | Analytics, featured placement, bid limits, fee discount, portfolio limits, etc. | **Not in this build.** Account UI states StoreKit / IAP is intentionally omitted. Web continues Stripe Subscriptions only. |

Do **not** sell digital unlocks via Stripe inside the iOS binary. Do **not** stub StoreKit.

### Hard-off flags (this binary)

`FeatureFlags.iOSHardOffKeys` always returns **off**, regardless of `GET /api/v1/flags`:

- `customer_bnpl`
- `working_capital`
- `per_job_insurance`
- `insurance_competition`
- `legal_services`
- `lead_gen`
- `instant_payout`

Reviewers should **not** expect BNPL, advances, insurance purchase, legal vertical, lead-gen, or instant payout CTAs in the native app.

### How to review catalog without IAP

1. Launch app → **Home** (launch gates / hard-off notice if shown).  
2. **Marketplace** → browse public listings → open **listing detail**.  
3. **Jobs** → browse public jobs → open **job detail**.  
4. No purchase of Pro/Business digital tiers is available in-app; free-tier-only posture for platform feature unlocks.  
5. **Account → Subscriptions** explicitly: “Digital subscriptions (StoreKit) — not in this build.”

Optional auth for account/legal paths:

- Email/password against seed users (below), **or**
- **Sign in with Apple** (system button).

### Sign in with Apple — native endpoint

| Item | Value |
|------|--------|
| Client | `AuthenticationServices` → `ASAuthorizationAppleIDCredential.identityToken` |
| Exchange | **`POST /api/v1/auth/apple/native`** |
| Body | `{ "identity_token": "<JWT>", "full_name": "optional", "nonce": "" }` |
| Success | JSON access + refresh tokens (same shape as password login) |
| Audience | Gateway accepts `APPLE_CLIENT_ID` and/or **`APPLE_NATIVE_CLIENT_ID`** (set to Bundle ID `com.nomarkup.app`) |
| Web path (unchanged) | `GET /api/v1/auth/oauth/apple` + `form_post` callback — **Safari / web only**, not the primary native path |

Capability: **Sign in with Apple** on the App ID + `NoMarkup.entitlements`.  
Guideline **4.8:** if other third-party logins are offered in the binary, SIWA remains available with equivalent prominence.

### Demo / ops for native review

Same seed accounts as web (§ Demo accounts). Password via `SEED_PASSWORD` / seed log — not committed.  
Full funnel needs live gateway + services + engines + Postgres seed. Point the binary at a staging/production API that Apple’s network can reach; DEBUG `localhost` is for local only.

### ASC paste block

Prefer the consolidated Notes block in [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) §11 for App Store Connect. Keep the web sections below for web/TestFlight dogfood and dual-rail context.

---

## Support ownership (ASR-PRE-03 / BYS.1)

| Field | Value |
|-------|--------|
| Support email | **support@no-markup.com** |
| In-app path | `/support` (when shipped) + Settings / footer contact |
| Ownership | Platform Support (ops); escalations for payments/disputes to admin queue |
| Do not use | Personal founder Gmail, `support@example.com` fixtures |

Reviewers: prefer email to **support@no-markup.com** with the demo account email
in the body so we can correlate logs.

---

## Demo accounts (from `E2E.md` / seed)

Seed after stack is up (`make seed`). Password is **not** committed:

- Capture from seed log (`dev-account password`) **or** set `SEED_PASSWORD` before `make seed`.
- All four accounts share the same `$SEED_PASSWORD`.

| Email | Role |
|-------|------|
| `admin@nomarkup.com` | admin |
| `customer@nomarkup.com` | customer |
| `provider@nomarkup.com` | provider |
| `provider2@nomarkup.com` | provider |

**Staging note:** Full funnel dogfood needs live gateway + services + engines +
Postgres seed. CI Playwright is Chromium **backend-tolerant smoke** only
(see `E2E.md`).

Suggested review path:

1. Login as `customer@…` → browse `/jobs` and `/marketplace` in **King County** markets.
2. Login as `provider@…` → `/provider/workspace` for check-in purpose UX (GPS).
3. Login as `admin@…` only if reviewing moderation queues.

---

## Feature flag matrix (money / regulated)

Canonical keys: `web/src/hooks/useFeatureFlags.ts` + `feature_flags` table  
(migrations `013`, `060`). Gateway `RequireFlag` → **503** when row exists and
`enabled=false` (fails closed in production for missing/error/nil DB).

| Flag key | Default seed (060 / 013) | Surface | First iOS binary guidance |
|----------|--------------------------|---------|---------------------------|
| `live_auction` | true (013) | Live auction arena | Keep if product ships auctions |
| `spectator_mode` | false | Anonymous auction watch | Optional |
| `nomarkup_guarantee` | false | Guarantee claims | Optional |
| `smart_matching` | false | Auto-match | Optional |
| `provider_business_os` | false | Provider business OS | Optional |
| `fair_price_index` | false | Fair price widget | Optional |
| `marketplace_offers` | (if present) | Offers flow | Optional |
| `customer_bnpl` | **true** (060) | BNPL installments | **Flag OFF** until licenses |
| `instant_payout` | **true** (060) | Instant payout | **Flag OFF** or keep Stripe-only web |
| `per_job_insurance` | **true** (060) | Per-job insurance | **Flag OFF** until licenses |
| `working_capital` | **true** (060) | Provider advances | **Flag OFF** until licenses |
| `insurance_competition` | **false** (060) | Multi-carrier quotes | Stay off |
| `legal_services` | **false** (060) | Legal vertical | Stay off |
| `lead_gen` | **false** (060) | Paid leads | Stay off |

Financial / regulated keys also **fail closed in the web UI** when missing
(`FINANCIAL_FEATURE_FLAG_KEYS` default `false`).

---

## Escrow rails (ASR-3.1.3.e)

- **Services & goods GMV** settle via **Stripe Connect Express** escrow.
- Customer funds held until contract/order completion paths as implemented;
  release/refund carry an **actor** (provider cannot self-release escrow;
  refund after payout is admin-only).
- **Physical goods + real-world services** are not digital content unlocks —
  they correctly use external payment (Guideline **3.1.3(e)** marketplace
  exception), not IAP.
- **Digital subscription tiers** (analytics access, featured placement, bid
  limits, etc.) are currently Stripe on **web**; iOS packaging requires
  StoreKit for those unlocks — see `ios-payment-rails-design.md`.

---

## Geo markets

- Launch pilot: **King County, WA** markets (migration `058_launch_wa_king_county`):
  Auburn, Maple Valley, Black Diamond, Enumclaw, Kent, Renton (active set).
- Market picker geolocation purpose: nearest launched market only; user can
  pick a city instead (ASR-5.1.5).
- Goods: local pickup model / radius product rules as documented in
  `docs/marketplace.md`.

---

## Age gate (18+)

- Global minimum age **18** (`minAgeYears` in gateway compliance handler).
- DOB captured via `PUT /api/v1/me/dob`; only verification boolean exposed via
  `/api/v1/me/age-status`. DOB encrypted at rest (secretbox).

---

## Report / block (how to test)

| Action | Where |
|--------|--------|
| Block user | Chat / profile surfaces → block; list via `GET /api/v1/me/blocks` |
| Report user | User report API + admin queue `/admin/user-reports` |
| Report listing | Listing report **API** exists; frontend “Report this listing” tracked as UGC remediation |
| Report message | In-chat report UI (where shipped) |

Admin: sign in as `admin@…` → moderation queues for reports.

---

## Dual payment note (reviewers)

| Rail | What | Processor |
|------|------|-----------|
| **Marketplace GMV / escrow / insurance PI / payouts** | Real-world jobs, physical goods, Connect transfers | **Stripe** (web + future native shell for offline goods/services) |
| **Digital feature subscriptions** | Analytics, featured placement, bid-limit tiers, etc. | **Stripe on web today**; **StoreKit IAP** required on iOS binary (deferred design doc) |

Apple Pay / Google Pay (when enabled) are Stripe payment methods; domain
association file must be production content (see
`web/public/.well-known/README.md`). NoMarkup never stores raw card numbers.

**Privacy (policy sentence for legal page / ASC):**  
*Payments, including card, Apple Pay, and Google Pay, are processed by Stripe.
NoMarkup does not store full card numbers or payment credentials on our servers.*

---

## Privacy / consent (shipped in this P1 pack)

- Cookie banner defaults **analytics and marketing off** (opt-in).
- Browser Sentry enabled only with analytics consent (`nm:consent`).
- Location purpose strings on market selector and provider check-in.
- Settings → Security → **Connected accounts** (OAuth unlink, lockout-safe).

---

## What is intentionally DEFERRED / residual for packaging

- **Done (docs):** ASC packaging checklist — `asc-packaging-checklist.md`; native review section above.
- **Residual ops:** App Icon, 6.7"/12.9" screenshots, ASC record fill, team signing, always-on review backend.
- StoreKit dual-rail **implementation** (design only — `ios-payment-rails-design.md`); first binary is **free-tier-only** (no IAP).
- Org licenses for insurance / advances / BNPL on iOS (flag-off strategy — hard-off in binary).
- mTLS mesh, `DEPLOY_PROVISIONED` production gate.
- Native shell is **scaffolded** (not thin WebView) but full product funnel / payment UI still incomplete for App Review quality.
