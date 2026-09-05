# App Store Connect packaging checklist (Stage B6)

**Program:** App Store launch readiness — Stage **B6**  
**Updated:** 2026-08-02 (**eng packaging 100** — free-tier lock + dual-rail depth)  
**Product:** NoMarkup — local two-sided marketplace (services reverse-auction + goods forward-auction)  
**Marketing site:** [https://no-markup.com](https://no-markup.com) (hyphenated zone)  
**Binary tree:** `ios/NoMarkup` (SwiftUI native dual-rail)  
**Related:** [`app-review-notes.md`](./app-review-notes.md) · [`privacy-purpose-string-inventory.md`](./privacy-purpose-string-inventory.md) · [`asc-content-rating-answers.md`](./asc-content-rating-answers.md) · [`app-store-screenshot-matrix.md`](./app-store-screenshot-matrix.md) · [`submission-blockers.md`](./submission-blockers.md) · [`launch-board.md`](./launch-board.md) · [`testflight-process.md`](./testflight-process.md) · [`v1-ios-product-cut.md`](./v1-ios-product-cut.md) · [`eng-completion-scorecard-2026-08-02.md`](./eng-completion-scorecard-2026-08-02.md)

**Claim discipline:** Completing **eng** rows does **not** mean App Review is submitted. Remaining work is **founder / ASC portal** only (Team signing, media upload, nutrition labels, always-on review backend).

**SDK floor:** App Store / TestFlight upload requires **Xcode 26+ / iOS 26 SDK**. See [`testflight-process.md`](./testflight-process.md).

**First public marketing version:** **`1.0.0`** (tree: `MARKETING_VERSION = 1.0.0`, `CURRENT_PROJECT_VERSION = 3`).

Status legend:

| Mark | Meaning |
|------|---------|
| `[x]` | **Eng done** in monorepo / binary / docs — founder need not rebuild |
| `[~]` | **Founder / ASC / ops** — exact steps listed; eng cannot click portal |
| `[ ]` | Open (should not remain after this packaging pass for eng items) |

---

## 1. App identity (ASC + Xcode)

| Field | Proposed value | Notes |
|-------|----------------|--------|
| **Bundle ID** | **`com.nomarkup.app`** | Used in Xcode, URL type, Keychain default, `.env.example` `APPLE_NATIVE_CLIENT_ID` |
| **SKU** (ASC internal) | e.g. `nomarkup-ios-001` | Pick once; do not recycle |
| **App name** | **NoMarkup** | `CFBundleDisplayName` |
| **Subtitle** | **Local jobs & marketplace** | ≤30 chars |
| **Primary category** | **Shopping** | Goods marketplace shelf |
| **Secondary category** | **Lifestyle** | Services / jobs |
| **Content rights** | You own or license all content | UGC under Terms + guidelines — answers in [`asc-content-rating-answers.md`](./asc-content-rating-answers.md) |
| **Age rating** | Honest UGC questionnaire | See content-rating answers doc |
| **Copyright** | `© 2026 NoMarkup` (or legal entity) | Update entity if needed |

### 1.1 Capabilities on the App ID

| Capability | First binary | Eng status |
|------------|--------------|------------|
| **Sign in with Apple** | Required | `[x]` entitlement in tree (`NoMarkup.entitlements`) |
| **Push Notifications (APNs)** | Enabled in binary | `[x]` client registration; declare Device ID in privacy |
| In-App Purchase | **Off** (free-tier) | `[x]` no IAP capability / no StoreKit purchase UI |
| Associated Domains | Optional later | `[x]` `nomarkup://` URL scheme registered |
| App Groups (widget) | As needed for widget | `[x]` widget target present |

### 1.2 Env pairing for SIWA

| Variable | Role | Founder |
|----------|------|---------|
| `APPLE_CLIENT_ID` | Web Services ID | `[~]` set on gateway for web SIWA |
| **`APPLE_NATIVE_CLIENT_ID`** | iOS Bundle ID audience = `com.nomarkup.app` | `[~]` **must** set on review/production gateway |

---

## 2. Store listing URLs & contact

| ASC field | Value | Status |
|-----------|--------|--------|
| **Privacy Policy URL** | **https://no-markup.com/privacy** | `[x]` eng URL locked |
| **Support URL** | **https://no-markup.com/support** | `[x]` |
| **Marketing URL** | https://no-markup.com | `[x]` |
| **Terms** | https://no-markup.com/terms | `[x]` in-app |
| **App Review contact email** | **support@no-markup.com** | `[~]` enter in ASC |
| **App Review phone** | Ops-owned number | `[~]` enter in ASC |
| **Demo account** | Seed emails — [`app-review-notes.md`](./app-review-notes.md) | `[~]` password in ASC secure field only |

In-app legal: SwiftUI → `SFSafariViewController` (`LegalWebView`) for Privacy, Terms, Community Guidelines, Support.

---

## 3. Version & build

| Item | Guidance | Status |
|------|----------|--------|
| Marketing version | **`1.0.0`** | `[x]` in project |
| Build number | Monotonic integer (currently **3**) | `[x]` tree; `[~]` +1 per upload |
| Deployment target | **iOS 17.0** | `[x]` |
| Upload SDK | **Xcode 26+ / iOS 26 SDK** | `[~]` founder machine |
| Devices | iPhone + iPad universal | `[x]` |
| API base (Release) | Empty `APIBaseURL` → `https://api.no-markup.com` | `[x]` code; `[~]` host must be up |

---

## 4. App Privacy nutrition label (roll-up)

**Source inventory:** [`privacy-purpose-string-inventory.md`](./privacy-purpose-string-inventory.md).  
**Manifest:** `ios/NoMarkup/PrivacyInfo.xcprivacy` (+ widget).  
**Tracking / ATT:** **No** — no IDFA, no ad SDK; do **not** add `NSUserTrackingUsageDescription`.

### 4.1 Tracking

| Question | Answer | Status |
|----------|--------|--------|
| App Tracking Transparency? | **No** | `[x]` |
| Data used to track users? | **No** | `[x]` product model |

### 4.2 Data types (enter in ASC)

**Truth:** Binary registers for remote notifications and may associate **Device ID** (`identifierForVendor` / push token) with the account. Declare **Device ID — collected, linked, not tracking**.

| ASC data type | Collected? | Linked? | Tracking? | Purposes | Status |
|---------------|------------|---------|-----------|----------|--------|
| **Email Address** | Yes | Yes | No | App Functionality, Account Management | `[x]` table + manifest |
| **Name** | Yes | Yes | No | App Functionality | `[x]` |
| **Phone Number** | Yes (optional) | Yes | No | App Functionality | `[x]` |
| **Physical Address** | Yes | Yes | No | App Functionality | `[x]` |
| **Date of Birth** | Yes | Yes | No | App Functionality | `[x]` |
| **Other User Contact Info** | **No** | — | — | — | `[x]` do not declare |
| **Photos or Videos** | Yes | Yes | No | App Functionality | `[x]` |
| **Audio Data** | **No** | — | — | — | `[x]` |
| **Customer Support** | Yes | Yes | No | App Functionality | `[x]` |
| **Other User Content** | Yes | Yes | No | App Functionality | `[x]` |
| **Purchase History** | Yes | Yes | No | App Functionality | `[x]` |
| **Payment Info** | Yes (tokenized) | Yes | No | App Functionality | `[x]` Stripe |
| **Precise Location** | Yes (when used) | Yes | No | App Functionality | `[x]` check-in |
| **Coarse Location** | Yes | Yes | No | App Functionality | `[x]` market / browse |
| **Sensitive Info** | Yes | Yes | No | App Functionality | `[x]` verification docs |
| **Crash Data** | **No** (first binary) | — | — | — | `[x]` no Sentry in iOS SPM |
| **Performance Data** | **No** unless telemetry ships | — | — | — | `[x]` omit |
| **Product Interaction** | Omit until analytics ships | — | — | — | `[x]` |
| **Device ID** | **Yes** | **Yes** | **No** | App Functionality | `[x]` |
| **User ID** | Yes | Yes | No | App Functionality | `[x]` |
| **Advertising Data** | **No** | — | — | — | `[x]` |

| Founder action | Status |
|----------------|--------|
| Type §4.2 into ASC App Privacy | `[~]` portal only |

**Third parties in binary:** **Stripe** (SPM) only. SIWA system. Google = SDK-less `ASWebAuthenticationSession`. Do not list Mapbox/Sentry unless linked at submit time.

### 4.3 Purpose strings in binary (`Info.plist`)

| Key | Status |
|-----|--------|
| `NSLocationWhenInUseUsageDescription` | `[x]` Present |
| `NSPhotoLibraryUsageDescription` | `[x]` Present |
| `NSCameraUsageDescription` | `[x]` Present (camera path live) |
| `NSFaceIDUsageDescription` | `[x]` Present (app lock + sensitive actions) |
| `NSMicrophoneUsageDescription` | `[x]` **Absent — correct** |
| `NSUserTrackingUsageDescription` | `[x]` **Absent — correct** |
| `ITSAppUsesNonExemptEncryption` | `[x]` **`false`** |

---

## 5. Age rating questionnaire

**Ready-to-enter answers:** [`asc-content-rating-answers.md`](./asc-content-rating-answers.md).

| Item | Status |
|------|--------|
| Draft answer table (honest UGC) | `[x]` eng docs |
| Entered in ASC | `[~]` founder |

---

## 6. Screenshots & previews

Canonical matrix: [`app-store-screenshot-matrix.md`](./app-store-screenshot-matrix.md).

| Item | Status |
|------|--------|
| Scene list + required sizes (6.9" + 13") | `[x]` docs |
| Surfaces exist in app for capture | `[x]` see matrix “In app?” column |
| Automated walk harness | `[x]` `ios/NoMarkupUITests/ScreenshotWalkUITests.swift` |
| Pixels captured + uploaded to ASC | `[~]` founder |
| App Icon 1024 + dark/tinted | `[x]` asset catalog |
| In-App Events | `[x]` **Defer** decision recorded |
| Custom Product Pages / PPO | `[x]` **Defer** decision recorded |
| Accessibility nutrition claims | `[x]` docs; `[~]` claim only after human AX pass |

**Do not screenshot:** BNPL, working capital, insurance purchase, legal services, lead-gen, instant payout, fake StoreKit prices.

---

## 7. In-App Purchase strategy (first binary)

| Choice | **Ship free-tier-only — no digital paywall / no IAP** |
|--------|------------------------------------------------------|
| Eng evidence | `PlanLimitsView` + Account copy; no StoreKit purchase UI |
| IAP capability | **Off** |
| ASC In-App Purchases | **None** for v1 |
| Status | `[x]` product lock + binary posture |

### 7.1 Review notes IAP sentence

> This build does **not** include In-App Purchases or a digital subscription paywall. Account → Plan limits / Subscriptions states StoreKit is not in the build. Marketplace GMV and real-world service escrow use Stripe under Guideline 3.1.3(e). Digital Pro/Business tiers remain web-only until a future StoreKit release.

Full paste: [`app-review-notes.md`](./app-review-notes.md).

### 7.2 When B2 ships (future — not v1)

Draft product IDs only — create in ASC later: `com.nomarkup.sub.pro.monthly|annual`, `com.nomarkup.sub.business.monthly|annual`. Require Restore, Manage Subscriptions, JWS, ASN v2, Option A multiplatform. **Forbidden:** Stripe Checkout for digital unlocks inside iOS.

---

## 8. App Review Information (demo)

| Item | Status |
|------|--------|
| Paste-ready notes | `[x]` [`app-review-notes.md`](./app-review-notes.md) |
| Demo account emails documented | `[x]` seed pattern |
| Password in git | **Never** — `[x]` policy |
| Password entered in ASC | `[~]` founder from `SEED_PASSWORD` / seed log |
| Backend always-on | `[~]` PRE-05 ops |
| Regulated flags off on review env | `[~]` founder/ops |

### 8.1 Dual-rail summary

| Rail | What | Processor |
|------|------|-----------|
| **A — GMV** | Jobs escrow, goods orders, Connect | **Stripe** (3.1.3(e)) |
| **B — Digital** | Pro/Business unlocks | **Not in binary** |

### 8.2 Regulated rails (review)

Server flags (not client hard-off list). Keep **off** for review:

`customer_bnpl`, `working_capital`, `per_job_insurance`, `insurance_competition`, `legal_services`, `lead_gen`, `instant_payout`

`FeatureFlags.iOSHardOffKeys = []` — server authoritative.

---

## 9. Export compliance / encryption

| Question | Guidance | Status |
|----------|----------|--------|
| Uses encryption? | **Yes** (HTTPS/TLS) | — |
| Exempt (standard HTTPS / OS crypto only)? | **Yes** for this client | `[x]` posture |
| Custom export-controlled crypto in iOS binary? | **No** — PII secretbox/argon2 are **server-side** | `[x]` |
| **`ITSAppUsesNonExemptEncryption`** | **`false`** in `ios/NoMarkup/Info.plist` | `[x]` |
| ASC export questionnaire (if prompted) | Answer exempt / HTTPS-only | `[~]` founder if ASC still asks |

**One-liner:** NoMarkup uses standard HTTPS/TLS for API traffic. The client does not implement non-exempt custom encryption algorithms.

---

## 10. Pre-submit gate checklist

### 10.1 Identity & signing

- [x] Bundle ID in project: `com.nomarkup.app`
- [x] SIWA entitlement + native exchange code path
- [~] **Founder:** App ID created in Developer portal with **Sign in with Apple**
- [~] **Founder:** Distribution certificate + App Store provisioning profile
- [~] **Founder:** ASC app record (name, SKU, primary/secondary category)
- [~] **Founder:** `APPLE_NATIVE_CLIENT_ID=com.nomarkup.app` on review/production gateway

### 10.2 Metadata

- [x] Privacy URL locked: https://no-markup.com/privacy
- [x] Support URL locked: https://no-markup.com/support
- [x] Subtitle proposal (≤30): “Local jobs & marketplace”
- [x] Review notes paste block ready
- [x] Age rating answers documented
- [x] Nutrition label table ready
- [x] Export compliance key in binary
- [~] **Founder:** Subtitle / description / keywords entered in ASC
- [~] **Founder:** Age rating questionnaire completed in ASC
- [~] **Founder:** App Privacy nutrition labels entered
- [~] **Founder:** Export compliance answered in ASC if prompted
- [~] **Founder:** Review notes pasted; demo password in ASC secure field
- [~] **Founder:** Contact email/phone

### 10.3 Media

- [x] App Icon 1024×1024 (+ dark/tinted) in asset catalog
- [x] Screenshot scene list + UITest walk harness
- [~] **Founder:** Capture **6.9"** iPhone screenshots (scenes 1–6)
- [~] **Founder:** Capture **13"** iPad screenshots (same scenes)
- [~] **Founder:** Upload to ASC Media Manager
- [~] **Founder:** Accessibility nutrition only after human AX device pass

### 10.4 Binary content (eng)

- [x] Native SwiftUI `TabView` root when signed in — **not** pure WKWebView (**4.2**)
- [x] SIWA + purpose strings + Face ID string
- [x] In-app legal links (Privacy, Terms, Community, Support)
- [x] In-app account deletion entry (Guideline **5.1.1(v)**)
- [x] Public marketplace + jobs browse + dual-rail write depth (eng scorecard 100)
- [x] Free-tier digital — no StoreKit paywall
- [x] Privacy manifest app + widget
- [x] `ITSAppUsesNonExemptEncryption` = false
- [x] Release API base HTTPS when plist empty
- [x] Push privacy truth: Device ID linked, not tracking
- [x] Regulated rails server-flag model documented
- [~] **Founder:** Release API host reachable; seed data present
- [~] **Founder:** TestFlight internal group + first upload
- [~] **Founder:** Optional push delivery check (ASC Push Console)

### 10.5 Policy alignment

- [x] Dual-rail design documented
- [x] Free-tier lock documented
- [x] Phase 4B digital → IAP map (future B2)
- [~] **Founder:** Counsel review of Privacy/Terms before public launch (recommended)
- [~] **Founder:** `DEPLOY_PROVISIONED` / ops if production origin

### 10.6 Deferred growth surfaces

| Surface | Decision | Status |
|---------|----------|--------|
| In-App Events | Defer | `[x]` recorded 2026-07-27 |
| Custom Product Pages / PPO | Defer post-launch | `[x]` recorded 2026-07-27 |

---

## 11. Paste block — ASC App Review Notes

**Canonical paste:** [`app-review-notes.md`](./app-review-notes.md) → **ASC paste block** (free-tier, seed accounts, regulated off, SIWA, no IAP).

---

## 12. What “B6 eng packaging 100” means

| Layer | Status |
|-------|--------|
| **B6 eng docs** (this checklist, review notes, blockers, content rating, screenshot matrix, TestFlight process) | **Done (100)** |
| Binary eng gates (4.2, 5.1.1, purpose strings, free-tier, export key, privacy manifest) | **Done (100)** |
| ASC portal fill, signing, screenshots upload, live demo backend, device smoke sign-off | **Open — founder only** |

**Eng ASC packaging bar: 100 / 100**  
**Overall App Store submit bar: blocked only by §10 `[~]` founder rows**

Do **not** claim “submitted” or “Ready for Sale” until founder clears `[~]` rows and Apple approves.

---

*Owner: App Store launch readiness Stage B6. Update when Bundle ID, IAP products, or binary scope change.*
