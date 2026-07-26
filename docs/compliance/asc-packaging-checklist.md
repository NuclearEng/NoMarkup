# App Store Connect packaging checklist (Stage B6)

**Program:** App Store launch readiness — Stage **B6**  
**Date:** 2026-07-26  
**Product:** NoMarkup — local two-sided marketplace (services reverse-auction + goods forward-auction)  
**Marketing site:** [https://no-markup.com](https://no-markup.com) (hyphenated zone)  
**Binary tree:** `ios/NoMarkup` (SwiftUI scaffold; Stages **B0–B4** code paths)  
**Related:** [`app-review-notes.md`](./app-review-notes.md) · [`privacy-purpose-string-inventory.md`](./privacy-purpose-string-inventory.md) · [`ios-payment-rails-design.md`](./ios-payment-rails-design.md) · [`review-logs/phase-4b.md`](./review-logs/phase-4b.md) · [`launch-board.md`](./launch-board.md) · [`submission-blockers.md`](./submission-blockers.md)

**Claim discipline:** This checklist packages the **first binary**. Completing the *docs* portion of B6 does **not** mean App Review submission-ready. Remaining blockers: team signing, App Icon asset, live review backend, and either **B2 StoreKit** **or** an explicit free-tier-only product cut (already the scaffold posture — no digital paywall).

Status legend: `[ ]` open · `[x]` done in monorepo/docs · `[~]` partial / ops outside repo

---

## 1. App identity (ASC + Xcode)

| Field | Proposed value | Notes |
|-------|----------------|--------|
| **Bundle ID** | **`com.nomarkup.app`** | **Proposed / already used** in `ios/NoMarkup.xcodeproj` (`PRODUCT_BUNDLE_IDENTIFIER`), URL type name, Keychain service default, and `.env.example` `APPLE_NATIVE_CLIENT_ID`. Confirm uniqueness in Apple Developer → Identifiers before first archive. |
| **SKU** (ASC internal) | e.g. `nomarkup-ios-001` | Not user-visible; pick once and do not recycle. |
| **App name** | **NoMarkup** | Matches `CFBundleDisplayName` / marketing site. Max 30 characters. |
| **Subtitle** | **Local jobs & marketplace** | ≤30 chars. Alternatives: “Local marketplace, zero markup”, “Jobs & local pickup”. Avoid trademarked third-party names. |
| **Primary category** | **Shopping** | Goods marketplace (listings, bids, local pickup) is the clearest App Store shelf. |
| **Secondary category** | **Lifestyle** | Services / reverse-auction jobs surface. |
| **Content rights** | You own or license all content | UGC is user-provided; Community Guidelines + report/block cover 1.2. |
| **Age rating** | See §5 | UGC marketplace → answer questionnaires **honestly** (not “Ages 4+”). |
| **Copyright** | `© 2026 NoMarkup` (or legal entity) | Update year/entity before ship. |

### 1.1 Capabilities to enable on the App ID

| Capability | First binary | Source of truth |
|------------|--------------|-----------------|
| **Sign in with Apple** | **Required** | `NoMarkup.entitlements` → `com.apple.developer.applesignin`; Xcode Signing & Capabilities |
| Push Notifications (APNs) | **Do not enable for claims** | Stage **B5 deferred** — do not claim push in metadata |
| In-App Purchase | **Only if shipping B2** | Current scaffold: **no** IAP capability / no StoreKit UI |
| Associated Domains | Optional later | Universal links / `nomarkup://` already registered as URL scheme |
| App Groups / iCloud | Not required | — |

### 1.2 Env pairing for SIWA

| Variable | Role |
|----------|------|
| `APPLE_CLIENT_ID` | Web Services ID (Safari OAuth `form_post`) |
| **`APPLE_NATIVE_CLIENT_ID`** | iOS Bundle ID audience — **`com.nomarkup.app`** (proposed) for `POST /api/v1/auth/apple/native` |

Gateway accepts either audience when verifying the AuthenticationServices `identity_token` (multi-audience `verifyAppleIDToken`). Production gateway **must** set `APPLE_NATIVE_CLIENT_ID=com.nomarkup.app` (or the final Bundle ID if it changes).

---

## 2. Store listing URLs & contact

| ASC field | Value |
|-----------|--------|
| **Privacy Policy URL** | **https://no-markup.com/privacy** |
| **Support URL** | **https://no-markup.com/support** |
| **Marketing URL** (optional) | https://no-markup.com |
| **Copyright / Terms** | https://no-markup.com/terms (also link in-app) |
| **App Review contact email** | **support@no-markup.com** (see `app-review-notes.md`) |
| **App Review phone** | Ops-owned number reachable during review windows |
| **Demo account** | Seed accounts — §8 and `app-review-notes.md` |

In-app legal surfaces (SwiftUI → `SFSafariViewController` / `LegalWebView`): Privacy, Terms, Community Guidelines, Support — same host.

---

## 3. Version & build

| Item | Guidance |
|------|----------|
| Marketing version | Start `1.0.0` for first public App Store (scaffold currently `0.1.x` locally is fine for TestFlight) |
| Build number | Monotonic integer per upload |
| Deployment target | **iOS 17.0** (`ios/README.md`) |
| Devices | iPhone + iPad (universal; orientations in `Info.plist`) |
| API base (Release) | `https://api.no-markup.com` via `APIBaseURL` / `AppConfig` — **must be reachable** for review |
| Debug local | `http://localhost:8080` (DEBUG) — never ship DEBUG to review |

---

## 4. App Privacy nutrition label (roll-up)

**Source inventory:** [`privacy-purpose-string-inventory.md`](./privacy-purpose-string-inventory.md) §3.  
**Revalidate** every type against the **actual binary** + SDKs at submit time (Stripe / Mapbox / Sentry only if linked).

### 4.1 Tracking / ATT

| Question | Answer for first binary |
|----------|-------------------------|
| App Tracking Transparency? | **No** — no IDFA, no ad network SDK |
| `NSUserTrackingUsageDescription` | **Do not add** |
| Data used to track users? | **No** for current product model |

### 4.2 Data types to declare (typical “Collected / Linked to user / Not used for tracking”)

| ASC data type | Collected? | Linked to user? | Tracking? | Purposes (typical) | Product evidence |
|---------------|------------|-----------------|-----------|--------------------|------------------|
| **Email Address** | Yes | Yes | No | App Functionality, Account Management | Register / login / OAuth / SIWA |
| **Name** | Yes | Yes | No | App Functionality | Profile, SIWA name once, counterparty display |
| **Phone Number** | Yes (optional) | Yes | No | App Functionality | Profile / provider onboarding |
| **Physical Address** | Yes | Yes | No | App Functionality | Jobs, properties, listing pickup |
| **Other User Contact Info** | Yes | Yes | No | App Functionality | OAuth / chat display names |
| **Photos or Videos** | Yes | Yes | No | App Functionality | Avatar, portfolio, job/listing/claim uploads |
| **Audio Data** | **No** | — | — | — | Mic not used; do not declare |
| **Customer Support** | Yes | Yes | No | App Functionality | Support / reports |
| **Other User Content** | Yes | Yes | No | App Functionality | Jobs, listings, reviews, chat (UGC) |
| **Purchase History** | Yes | Yes | No | App Functionality | Orders / escrow metadata (when payment UI ships) |
| **Payment Info** | Yes (tokenized) | Yes | No | App Functionality | Stripe only — no full PAN on NoMarkup servers |
| **Precise Location** | Yes (when used) | Yes | No | App Functionality | Job-site check-in GPS |
| **Coarse Location** | Yes | Yes | No | App Functionality | Market suggestion; coarsened public map |
| **Crash Data** | Yes (if Sentry linked) | Yes | No | Analytics / App Functionality | Opt-in / product diagnostics posture |
| **Performance Data** | Yes (if telemetry) | Yes | No | Analytics | Consent-gated where applicable |
| **Product Interaction** | Yes | Yes | No | Analytics / App Functionality | Consent-gated analytics |
| **Device ID** | Yes (if push later) | Yes | No | App Functionality | Push token — **B5 deferred**, omit if no APNs |
| **User ID** | Yes | Yes | No | App Functionality | Account UUID, OAuth `sub` |
| **Advertising Data** | **No** | — | — | — | No ad network today |
| **Other Diagnostic Data** | Yes | Yes | No | Analytics / App Functionality | Logs as disclosed |

**Third parties to list when present in binary:** Stripe (payments), Mapbox (if maps SDK), Sentry (if crash SDK), Sign in with Apple (system), Google/Facebook **only if** those OAuth SDKs ship in the binary.

### 4.3 Purpose strings already in binary (`Info.plist`)

| Key | Status |
|-----|--------|
| `NSLocationWhenInUseUsageDescription` | Present |
| `NSPhotoLibraryUsageDescription` | Present |
| `NSCameraUsageDescription` | Present (only use if camera path is live) |
| `NSMicrophoneUsageDescription` | **Absent — correct** |
| `NSUserTrackingUsageDescription` | **Absent — correct** |

---

## 5. Age rating questionnaire (honest UGC answers)

NoMarkup is **18+** product-side (`minAgeYears` / DOB gate) and hosts **user-generated** jobs, listings, chat, and reviews. Complete the ASC age rating questionnaire **truthfully**:

| Topic | Guidance for NoMarkup |
|-------|------------------------|
| **Unrestricted web access** | No (app is not a general browser) |
| **User-generated content** | **Yes** — jobs, marketplace listings, messages, reviews, photos |
| **Messaging / chat** | **Yes** — in-app messaging (when live in binary); report/block exist on platform |
| **Mature / suggestive themes** | Unlikely as core product; do not over-claim “none” if UGC can include adult-adjacent categories — use **Infrequent/Mild** only if taxonomy allows such listings; otherwise None |
| **Profanity / crude humor** | Possible via UGC chat — answer per real moderation posture |
| **Gambling** | **No** (marketplace auctions for goods/services are not casino gambling; do not mislabel) |
| **Contests** | No (unless product adds prize contests) |
| **Alcohol / tobacco / drugs** | Only if verticals allow listing/services in those categories — answer from live taxonomy |
| **Violence / horror** | No as designed content |
| **Medical / treatment info** | No as core feature |
| **Age gate** | Platform enforces **18+**; reflect in rating + review notes |

**Expected outcome:** Not a 4+ “utility-only” rating. UGC + social features typically land in a higher band; App Store Connect computes the final badge from answers. Do **not** sandbag UGC questions to force a lower badge.

Also set **Age Assurance / Kids** flags: this is **not** a Kids Category app; no COPPA-directed child targeting.

---

## 6. Screenshots & previews

Capture on **real device or simulator** at required sizes. Prefer light mode + King County pilot data (seed markets). No placeholder lorem that contradicts live API.

### 6.1 Required size families (minimum)

| Device class | Display | Portrait sizes to prepare |
|--------------|---------|---------------------------|
| **6.7" iPhone** | e.g. iPhone 15 Pro Max / 16 Plus class | Required for modern iPhone set |
| **12.9" iPad** | 12.9" iPad Pro | Required if iPad is supported (this binary is universal) |

Also produce any additional sizes ASC still requires for your account’s media matrix (e.g. 6.5" / 5.5" if prompted). Prefer **native SwiftUI chrome**, not Safari screenshots of the website (Guideline **4.2**).

### 6.2 Scene list (shoot these)

| # | Scene | What to show | Tab / path |
|---|--------|--------------|------------|
| 1 | **Home** | Launch gates / market context / value prop without regulated rails | Home |
| 2 | **Marketplace** | Public listings browse (local pickup goods) | Marketplace |
| 3 | **Job detail** | A single job detail (budget/category/location coarsened as product allows) | Jobs → detail |
| 4 | **Login + SIWA** | Email/password form **and** system **Sign in with Apple** button (equal prominence) | Login |
| 5 | **Account / legal** | Privacy, Terms, Support links + Delete Account entry; StoreKit-not-in-build notice is OK | Account |
| 6 | **Marketplace or Jobs list** (second catalog beat) | Scrollable catalog proving non-thin shell | Marketplace **or** Jobs list |

Optional sixth/seventh if ASC slots allow: Messages empty/list state; listing detail.

**Do not screenshot:** BNPL, working capital, insurance purchase, legal services, lead-gen, instant payout (hard-off — §9). Do not show Stripe digital-tier paywall or fake StoreKit prices.

### 6.3 App preview video

Optional for v1. If filmed: same dual-rail honesty; no regulated features.

### 6.4 App icon

| Item | Status |
|------|--------|
| 1024×1024 App Store icon | **Open** — `Assets.xcassets/AppIcon` must be filled before upload |
| No transparency / no rounded-rect baking | Follow HIG |

---

## 7. In-App Purchase strategy (first binary)

**Product rule (locked):** dual-rail — **Rail A** Stripe for physical goods + offline services GMV (**3.1.3(e)**); **Rail B** StoreKit for digital unlocks (**3.1.1**) when offered in-app. Design: `ios-payment-rails-design.md` + Phase 4B.

### 7.1 Current scaffold decision (recommended for first binary)

| Choice | **Ship free-tier-only — no digital paywall / no IAP** |
|--------|------------------------------------------------------|
| Evidence | `AccountView`: “Digital subscriptions (StoreKit) — not in this build”; “StoreKit / IAP is intentionally not included” |
| IAP capability | **Off** |
| ASC In-App Purchases | **None** for v1 |
| Web Stripe Pro/Business | Remain **web-only**; do not deep-link “buy cheaper on web” for digital unlocks inside the binary |
| Free-tier baseline | Analytics off, featured off, bid/category/portfolio limits per free tier seed (`free` in Phase 4B) |

This avoids **3.1.1** incomplete IAP rejection **if** the binary never sells or gates paid digital unlocks.

### 7.2 When B2 ships — configure StoreKit products first

Do **not** invent live product IDs in git. Create in ASC after Apple team is ready:

| Proposed product id (draft only) | Type | Maps to tier slug | Features unlocked (Phase 4B) |
|----------------------------------|------|-------------------|------------------------------|
| `com.nomarkup.sub.pro.monthly` | Auto-renewable | `pro` | Analytics, priority support, higher bid/category/portfolio limits, 2% fee discount |
| `com.nomarkup.sub.pro.annual` | Auto-renewable | `pro` | Same (annual) |
| `com.nomarkup.sub.business.monthly` | Auto-renewable | `business` | Pro+ · featured placement · badge boost · instant tier flag · higher limits · 4% fee discount |
| `com.nomarkup.sub.business.annual` | Auto-renewable | `business` | Same (annual) |

| Free tier (`free`) — not an IAP | Included without purchase |
|---------------------------------|---------------------------|
| Max active bids | 3 |
| Max service categories | 1 |
| Featured / analytics / priority support / badge boost / instant | no |
| Portfolio images | 5 |
| Fee discount | 0% |

**Subscription group:** single group, rank Business > Pro.  
**Required with products:** Restore Purchases, Manage Subscriptions, server JWS verify, ASN v2, Schedule 2 disclosures, multiplatform **Option A** (honor web Stripe **and** offer IAP).  
**Forbidden:** Stripe Checkout for digital unlocks **inside** iOS; fake StoreKit stubs in CI.

### 7.3 Review notes IAP sentence (v1 free-tier-only)

> This build does **not** include In-App Purchases or a digital subscription paywall. Account → Subscriptions states StoreKit is not in the build. Marketplace GMV and real-world service escrow use Stripe under Guideline 3.1.3(e) when payment UI is enabled; digital Pro/Business tiers remain web-only until a future StoreKit release.

---

## 8. App Review Information (demo)

Paste / adapt from [`app-review-notes.md`](./app-review-notes.md). Summary for ASC **Notes** field:

### 8.1 Demo accounts

Seed after stack is up (`make seed`). Password from seed log or `SEED_PASSWORD` (not committed):

| Email | Role |
|-------|------|
| `customer@nomarkup.com` | customer — primary path |
| `provider@nomarkup.com` | provider |
| `provider2@nomarkup.com` | provider |
| `admin@nomarkup.com` | admin (moderation only if needed) |

All share `$SEED_PASSWORD`.

### 8.2 Backend reachability (PRE-05)

| Requirement | Detail |
|-------------|--------|
| Gateway | HTTPS production/staging API must answer from Apple’s network |
| Release base URL | `https://api.no-markup.com` (or review-specific host in Info.plist + notes) |
| Services | User, job, payment, chat as needed for demo path; Postgres seed applied |
| SIWA | `APPLE_NATIVE_CLIENT_ID` + Apple keys valid for Bundle ID |
| Downtime | Do not submit if seed/staging is cold |

### 8.3 Suggested review path (native)

1. Cold launch → **Home** (note Launch gates / hard-off list if shown).  
2. **Marketplace** → open a listing detail (public catalog).  
3. **Jobs** → open a job detail.  
4. **Sign in** as `customer@…` **or** **Sign in with Apple** → `POST /api/v1/auth/apple/native`.  
5. **Account** → Privacy / Terms / Support; note Delete Account; note StoreKit not in build.  
6. Do **not** expect BNPL, insurance purchase, advances, or digital IAP.

### 8.4 Dual-rail (for Notes)

| Rail | What | Processor |
|------|------|-----------|
| **A — GMV** | Jobs escrow, goods orders, Connect payouts | **Stripe** (3.1.3(e)) — non-IAP |
| **B — Digital tiers** | Analytics, featured, bid limits, etc. | **Not in this binary**; web Stripe only until StoreKit (B2) |

### 8.5 Flags hard-off in this binary

Client always forces **off** regardless of server (`FeatureFlags.iOSHardOffKeys`):

- `customer_bnpl`
- `working_capital`
- `per_job_insurance`
- `insurance_competition`
- `legal_services`
- `lead_gen`
- `instant_payout`

Full matrix: `app-review-notes.md` § Feature flag matrix.

### 8.6 Contact

- Email: **support@no-markup.com** (include demo account email in body)  
- In-app: Account → Support → https://no-markup.com/support  

---

## 9. Export compliance / encryption

Apple asks whether the app uses encryption.

| Question | Guidance |
|----------|----------|
| Uses encryption? | **Yes** (standard HTTPS / TLS to API) |
| Exempt under US EAR / French regs for standard HTTPS only? | **Usually yes** — app only uses encryption for **HTTPS** (and OS-provided Keychain / TLS stacks). No proprietary military-grade crypto algorithm beyond standard system libraries. |
| Custom crypto beyond HTTPS? | Product uses **server-side** secretbox for PII at rest and argon2id for passwords — **not** implemented as an export-controlled custom crypto module inside the iOS client. Client talks TLS to gateway. |
| ITSAppUsesNonExemptEncryption | Set **`false`** in Info.plist / ASC when only exempt encryption (HTTPS) applies — **confirm with counsel** if you add custom crypto libraries to the binary. |
| Annual self-classification report | Follow Apple/US export wizard if ASC prompts after first non-exempt answer |

**Review note one-liner:**

> NoMarkup uses standard HTTPS/TLS for API traffic. The client does not implement non-exempt custom encryption algorithms.

---

## 10. Pre-submit gate checklist

### 10.1 Identity & signing

- [x] Bundle ID proposed and used in project: `com.nomarkup.app`
- [ ] App ID created in Developer portal with **Sign in with Apple**
- [ ] Distribution certificate + App Store provisioning profile
- [ ] ASC app record created (name, SKU, primary/secondary category)
- [ ] `APPLE_NATIVE_CLIENT_ID` set on review/production gateway

### 10.2 Metadata

- [x] Privacy URL: https://no-markup.com/privacy
- [x] Support URL: https://no-markup.com/support
- [ ] Subtitle finalized (≤30)
- [ ] Description + keywords (no competitor keyword spam; dual-rail honest)
- [ ] Age rating questionnaire completed honestly (UGC)
- [ ] App Privacy nutrition labels entered from §4
- [ ] Export compliance answered (§9)
- [ ] Review notes pasted from `app-review-notes.md` + this doc §8
- [ ] Demo accounts + password in ASC secure fields
- [ ] Contact email/phone

### 10.3 Media

- [ ] App Icon 1024×1024
- [ ] 6.7" screenshots for scenes in §6.2
- [ ] 12.9" iPad screenshots for same scenes
- [ ] Optional preview video

### 10.4 Binary content

- [x] Native SwiftUI shell (not pure WKWebView) — B0
- [x] SIWA entitlement + native exchange endpoint — B1
- [x] Purpose strings in Info.plist — B1
- [x] In-app legal links + account deletion entry — B1
- [x] Public marketplace + jobs browse — B3
- [x] Regulated feature hard-off — B4
- [x] No StoreKit digital paywall in Account — free-tier-only posture
- [ ] No DEBUG-only “scaffold session” as the only path if claiming production auth
- [ ] Release API host reachable; seed data present
- [ ] Push **not** claimed (B5 deferred)
- [ ] Either no IAP (§7.1) **or** full B2 StoreKit stack (§7.2)

### 10.5 Policy alignment

- [x] Dual-rail design documented
- [x] Phase 4B digital feature → IAP map (for future B2)
- [ ] Counsel review of Privacy Policy / Terms before public launch (recommended)
- [ ] `DEPLOY_PROVISIONED` / ops checklist if pointing at production (`docs/operations/provisioning-checklist.md`)

---

## 11. Paste block — ASC App Review Notes (v1 free-tier-only)

Copy into **App Store Connect → App Review Information → Notes**:

```text
NoMarkup is a local two-sided marketplace: reverse-auction services (jobs) and
forward-auction goods (local pickup). Native SwiftUI client (not a website wrapper).

DEMO ACCOUNTS (password provided in App Review password field; from seed SEED_PASSWORD):
- customer@nomarkup.com (customer) — primary
- provider@nomarkup.com (provider)
- admin@nomarkup.com (admin / moderation only if needed)

API: https://api.no-markup.com (must be up for review). Sign in with Apple uses
POST /api/v1/auth/apple/native with APPLE_NATIVE_CLIENT_ID = app Bundle ID
(com.nomarkup.app).

SUGGESTED PATH:
1) Home → 2) Marketplace browse + listing detail → 3) Jobs browse + job detail →
4) Sign in (email/password or Sign in with Apple) → 5) Account: Privacy, Terms,
Support, Delete Account. Digital subscriptions / StoreKit are NOT in this build
(Account shows that explicitly). Free-tier only for platform feature unlocks.

PAYMENTS (dual-rail):
- Rail A: Physical goods + real-world services GMV use Stripe escrow (Guideline
  3.1.3(e)), not IAP, when payment UI is enabled.
- Rail B: Digital Pro/Business unlocks (analytics, featured placement, bid limits,
  etc.) are web-only via Stripe today; no in-app digital paywall / no IAP products
  in this binary.

HARD-OFF in this iOS binary (always disabled client-side): customer_bnpl,
working_capital, per_job_insurance, insurance_competition, legal_services,
lead_gen, instant_payout. Do not expect those flows.

GEO: Pilot markets King County, WA (e.g. Kent, Renton, Auburn, …).
AGE: 18+ age gate on platform.
SUPPORT: support@no-markup.com · https://no-markup.com/support
PRIVACY: https://no-markup.com/privacy
ENCRYPTION: Standard HTTPS/TLS only for client traffic (export-exempt posture).

Full internal notes: docs/compliance/app-review-notes.md
```

---

## 12. What “B6 done” means

| Layer | Status after this doc |
|-------|------------------------|
| **B6 docs** (checklist + review-notes native section + launch-board) | **Done** |
| ASC record filled, screenshots, icon, signing, live demo backend | **Open** (ops + design) |
| B2 StoreKit (if product wants paid digital unlocks in-app) | **todo** or permanently N/A if free-tier-only stays |

Do **not** claim App Store submission-ready until §10 gates and `submission-blockers.md` are cleared.

---

*Owner: App Store launch readiness Stage B6. Update when Bundle ID, categories, IAP products, or binary scope change.*
