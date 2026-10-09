# Privacy purpose-string + data inventory (web + iOS)

**Date:** 2026-08-02 (refreshed vs live `Info.plist` + free-tier dual-rail binary)  
**Stage:** App Store launch readiness — packaging  
**Scope:** Map **web + native** collection surfaces to **Info.plist purpose strings**, **pre-prompt UX**, and **App Store Connect App Privacy** labels.  
**Native status:** iOS project `ios/NoMarkup.xcodeproj`. Purpose strings **ship in** [`ios/NoMarkup/Info.plist`](../../ios/NoMarkup/Info.plist); helpers in [`ios/NoMarkup/Location/LocationPurposeCopy.swift`](../../ios/NoMarkup/Location/LocationPurposeCopy.swift). Camera **is** used. Face ID **is** used (optional app lock + sensitive actions). StoreKit IAP **not** in binary. No Checkr SDK. Export: `ITSAppUsesNonExemptEncryption = false`.

**Sources (code + policy):**

| Source | Path / notes |
|--------|----------------|
| **iOS Info.plist (live purpose strings)** | `ios/NoMarkup/Info.plist` — location, photos, camera, Face ID (no mic / no ATT) |
| **iOS purpose-string helpers** | `ios/NoMarkup/Location/LocationPurposeCopy.swift` |
| **Privacy manifest** | `ios/NoMarkup/PrivacyInfo.xcprivacy` + widget |
| Cookie consent | `web/src/components/compliance/CookieConsent.tsx` |
| Age gate (DOB) | web AgeGate + iOS `AgeGateView` |
| Location — market | MarketSelector + iOS market picker |
| Location — GPS check-in | CheckInOut + iOS provider workspace |
| Uploads | web `useImageUpload`; iOS `ImageUploader` / PhotosUI / camera |
| Auth / OAuth | SIWA native; Google/Facebook ASWebAuthenticationSession paths |
| Payments | Stripe PaymentSheet; Rail A only on iOS (no StoreKit) |
| Push | iOS `PushRegistration` (APNs); web push partial |
| Export / deletion | `GET` export / `DELETE` users/me; iOS `AccountDeletionView` |
| Privacy policy | https://no-markup.com/privacy + in-app `LegalWebView` |

**Legend**

| Column | Meaning |
|--------|---------|
| **Proposed iOS API** | System permission / framework |
| **Pre-prompt UI needed?** | In-app explanation *before* OS dialog |
| **Tracking?** | Apple “tracking” (ads / data broker). **Y** only if product meets that bar |
| **ASC category** | Nutrition Label type |

**Global ATT recommendation:** **No ATT / no `NSUserTrackingUsageDescription`** — no IDFA, no ad network SDK. Revisit if retargeting/ad SDK or IDFA measurement is added.

---

## 0. Info.plist ↔ inventory reconciliation (2026-08-02)

| Key | In Info.plist? | Matches inventory copy? | Notes |
|-----|:--------------:|:-----------------------:|-------|
| `NSLocationWhenInUseUsageDescription` | **Yes** | **Yes** | Combined market + check-in string (see §2) |
| `NSPhotoLibraryUsageDescription` | **Yes** | **Yes** | Consolidated avatar/portfolio/jobs/listings/claims |
| `NSCameraUsageDescription` | **Yes** | **Yes** | Capture path live via camera picker |
| `NSFaceIDUsageDescription` | **Yes** | **Yes** (row 39 below) | App lock + account deletion / payment method sensitive actions |
| `NSMicrophoneUsageDescription` | **No** | **Correct** | Unused |
| `NSUserTrackingUsageDescription` | **No** | **Correct** | No ATT |
| `NSSupportsLiveActivities` | **Yes** | N/A (not a purpose string) | Auction countdown Live Activities |
| `ITSAppUsesNonExemptEncryption` | **`false`** | Export exempt posture | HTTPS / OS crypto only in client |
| `LSApplicationQueriesSchemes` | `comgooglemaps` | Optional directions | Not a privacy purpose string |

**Copy helpers** in `LocationPurposeCopy.swift` mirror location/photo/camera plist strings for pre-prompts. Face ID string lives only in Info.plist (LocalAuthentication reason strings are separate runtime prompts).

---

## 1. Inventory table

| # | Data / permission | Collection surface (web path) | Backend / third party | Proposed iOS API | Info.plist purpose string (English) | Pre-prompt UI needed? | ASC privacy label category (approx) | Tracking? Y/N | Notes |
|---|-------------------|-------------------------------|----------------------|------------------|-------------------------------------|----------------------|-------------------------------------|---------------|-------|
| 1 | **Email** | `/register`, `/login`, OAuth | User service; email plaintext for auth | Credentials / SIWA | N/A | No | Email Address | N | Required for account |
| 2 | **Password** | login/register/reset | argon2id hash only | SecureField / Keychain | N/A | No | (credential — not shareable data type) | N | Not in export |
| 3 | **Display name** | profile | User service | N/A | N/A | No | Name | N | Public-facing |
| 4 | **Phone** | profile / provider | Encrypted at rest | Optional Contacts later — **not required** | N/A today | Soft form copy | Phone Number | N | Optional |
| 5 | **Date of birth / age** | AgeGate | `dob_encrypted` | Form | N/A | Yes (18+) | Date of Birth | N | Gateway ≥18 |
| 6 | **OAuth — Google** | OAuth buttons | Gateway OIDC | ASWebAuthenticationSession | N/A | Button disclosure | User ID; Email/Name | N | Unlink path exists |
| 7 | **OAuth — Apple** | SIWA | Gateway native + web | **AuthenticationServices** | N/A (entitlement) | SIWA button | User ID; Email (relay) | N | **4.8** if other social login |
| 8 | **OAuth — Facebook** | OAuth | Gateway | ASWebAuthenticationSession | N/A | Soft if native | User ID; Contact | N | Prefer no FB SDK |
| 9 | **Location — market picker** | MarketSelector | Client nearest market | CoreLocation WhenInUse | Combined When-In-Use (§2) | **Yes** | Coarse Location | N | Manual city always available |
| 10 | **Location — maps / address** | Job/listing forms | MapKit / geocode; coarsened public map | MapKit; typed address no GPS | Same When-In-Use if GPS used | Yes when GPS | Coarse/Precise; Physical Address | N | Public map coarsened |
| 11 | **Location — GPS check-in** | CheckInOut | Contract store | CoreLocation WhenInUse | Combined When-In-Use (§2) | **Yes** | Precise Location | N | Fail closed without permission |
| 12 | **Photos — avatar** | avatar upload | Imaging + S3 | Photo Library / PhotosPicker | Photo library string (§2) | Recommended | Photos or Videos | N | |
| 13 | **Photos — portfolio** | portfolio | Imaging + S3 | Photo Library | Same | Yes | Photos; User Content | N | Server limits |
| 14 | **Photos — job** | job photos | Imaging + S3 | Library + Camera | Same + camera string | Yes | Photos; User Content | N | |
| 15 | **Photos — listing** | listing form | Imaging + S3 | Library + Camera | Same | Yes | Photos; User Content | N | |
| 16 | **Files — documents** | claims / verification | Imaging DOCUMENT | Library / document picker | Photo string covers images | Yes | Sensitive Info; User Content | N | 10MB server cap |
| 17 | **Camera** | **iOS only** (web Permissions-Policy deny) | Imaging when submitted | UIImagePicker / capture | **NSCameraUsageDescription** live | **Yes** before first open | Photos or Videos | N | |
| 18 | **Microphone** | **Not used** | N/A | — | **Do not declare** | N/A | Audio Data — **No** | N | |
| 19 | **Payment method** | checkout / methods | **Stripe** | Stripe iOS / PassKit | N/A | Checkout context | Payment Info; Purchase History | N | No full PAN on NoMarkup |
| 20 | **Apple Pay** | PaymentSheet when configured | Stripe + merchant ID | PassKit | N/A | Wallet UI | Financial Info | N | Ops: domain association |
| 21 | **Provider payout / Connect** | onboarding | Stripe Connect | Safari / Stripe | N/A | Onboarding copy | Financial Info | N | |
| 22 | **Chat messages** | messages / WS | Chat service | N/A | N/A | No | Other User Content | N | Report/block |
| 23 | **UGC — jobs** | job create | Job service | N/A | N/A | No | User Content | N | |
| 24 | **UGC — listings** | sell/edit | Listing handlers | N/A | N/A | No | User Content; Physical Address | N | |
| 25 | **UGC — reviews** | review forms | Review handlers | Photos if images | Photo string | Soft | User Content | N | |
| 26 | **Reports / blocks** | report UIs | Gateway + admin | N/A | N/A | No | Customer Support; User Content | N | Guideline 1.2 |
| 27 | **Crash diagnostics (Sentry)** | web consent-gated | Sentry (web) | **Not in iOS SPM today** | N/A | Consent if added | Crash Data — **No** on first iOS binary | N | Do not declare crash on iOS until SDK ships |
| 28 | **Cookies / local storage** | CookieConsent | Gateway | App Storage | N/A | Consent non-essential | Product Interaction (if analytics) | N | |
| 29 | **Optional analytics / marketing** | consent toggles | First-party | None unless ad SDK | ATT only if tracking | Consent UI | Product Interaction; Ads **only if ads** | **N today** | |
| 30 | **Push notifications** | web partial; **iOS APNs** | Notification service | UserNotifications + APNs | N/A entitlement; soft pre-prompt | **Yes** soft prompt | Device ID | N | Linked for delivery, not tracking |
| 31 | **Service / property address** | jobs/properties | Encrypted + coarsened geometry | N/A | N/A | Form labels | Physical Address; Location | N | |
| 32 | **Provider insurance / EIN / licenses** | onboarding | Encrypted fields | Photo for docs | Photo string | Yes | Sensitive Info; Financial | N | |
| 33 | **IP / user agent** | all HTTP | Gateway logs / rate limit | N/A | N/A | No | Diagnostics | N | |
| 34 | **Account data export** | Settings export | DataExportHandler | Share sheet | N/A | Confirm only | Access right | N | |
| 35 | **Account deletion** | Settings / **AccountDeletionView** | 30-day grace | Face ID optional step | Face ID string if biometrics on | **Yes** multi-step | Guideline **5.1.1(v)** | N | In-app required |
| 36 | **MFA secrets** | security settings | encrypted; not exported | Keychain | N/A | Setup wizard | Credentials | N | |
| 37 | **Referrals** | `?ref=` | User service | N/A | N/A | No | Identifiers | N | |
| 38 | **Permissions-Policy (web)** | all pages | Next + gateway | camera/mic denied on web | N/A | N/A | N/A | N | |
| 39 | **Face ID / biometrics** | N/A web | Local only | **LocalAuthentication** | **NSFaceIDUsageDescription:** *“NoMarkup uses Face ID to protect sensitive actions like account deletion and removing payment methods, and to unlock the app when you enable app lock.”* | Toggle + system prompt | (OS auth — not a separate ASC data type) | N | Optional; user-controlled app lock |
| 40 | **Device ID (push / vendor)** | APNs registration | Notification devices API | UIDevice / UNUserNotificationCenter | N/A | Soft push pre-prompt | **Device ID** linked, not tracking | N | Must declare in ASC |

---

## 2. Consolidated Info.plist keys (native — live)

**Authoritative file:** [`ios/NoMarkup/Info.plist`](../../ios/NoMarkup/Info.plist).

```xml
<!-- Location — single When-In-Use covers market + check-in -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>NoMarkup uses your location to suggest the nearest marketplace city and, when you check in to a job, to confirm you arrived at the job site for dispute protection. You can pick a city manually.</string>

<!-- Photos -->
<key>NSPhotoLibraryUsageDescription</key>
<string>NoMarkup needs access to your photos so you can set a profile picture, add portfolio images, and attach photos to jobs, listings, and claims.</string>

<!-- Camera — live on iOS -->
<key>NSCameraUsageDescription</key>
<string>NoMarkup uses the camera so you can take photos for jobs, listings, or your profile instead of choosing an existing photo.</string>

<!-- Face ID — app lock + sensitive actions -->
<key>NSFaceIDUsageDescription</key>
<string>NoMarkup uses Face ID to protect sensitive actions like account deletion and removing payment methods, and to unlock the app when you enable app lock.</string>

<!-- Live Activities (not a privacy purpose string) -->
<key>NSSupportsLiveActivities</key>
<true/>

<!-- Export compliance — HTTPS / OS crypto only -->
<key>ITSAppUsesNonExemptEncryption</key>
<false/>

<!-- Do NOT add: NSMicrophoneUsageDescription, NSUserTrackingUsageDescription -->
```

**Photo Library:** Prefer `PhotosPicker` / limited access; keep library string for APIs that require it.

---

## 3. ASC App Privacy label — roll-up (aligned with packaging checklist)

Confirm at submit against binary + SDKs. Canonical ASC entry table: [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) §4.2.

| Data type (ASC) | Linked to user? | Used for tracking? | Collected? |
|-----------------|-----------------|--------------------|------------|
| Email Address | Yes | No | Yes |
| Name | Yes | No | Yes |
| Phone Number | Yes | No | Yes (optional) |
| Physical Address | Yes | No | Yes |
| Date of Birth | Yes | No | Yes |
| Other User Contact Info | — | — | **No** (do not declare) |
| Photos or Videos | Yes | No | Yes |
| Audio Data | — | — | **No** |
| Customer Support | Yes | No | Yes (reports/disputes) |
| Other User Content | Yes | No | Yes |
| Purchase History | Yes | No | Yes |
| Payment Info | Yes | No | Yes (tokenized via Stripe) |
| Precise Location | Yes | No | Yes (check-in) |
| Coarse Location | Yes | No | Yes |
| Sensitive Info | Yes | No | Yes (verification docs) |
| Crash Data | — | — | **No** (first iOS binary — no Sentry SPM) |
| Performance Data | — | — | **No** unless telemetry ships |
| Product Interaction | — | — | Prefer omit until analytics ships |
| Device ID | Yes | No | **Yes** (APNs / vendor ID) |
| User ID | Yes | No | Yes |
| Advertising Data | — | — | **No** |

**Third-party SDKs in binary:** Stripe only (SPM). SIWA system. Google/Facebook without mobile ad SDKs when configured.

---

## 4. Account deletion & export (Guideline 5.1.1(v))

| Requirement | Web evidence | iOS evidence |
|-------------|--------------|--------------|
| In-app account deletion | Settings → Account | **Account → Your data → Delete Account** (`AccountDeletionView`) |
| Not harder than create | Multi-step confirm | Toggle + type `DELETE` + optional Face ID |
| Data export | JSON download | Account → Export Data (share sheet) |
| Privacy policy link | `/privacy` | Login footer + Account → Privacy Policy (`LegalWebView` / Safari) |

---

## 5. ATT decision detail

| Question | Answer |
|----------|--------|
| IDFA / ATT today? | **No** |
| Data used to track across apps for ads? | **No** |
| **Recommendation** | Do **not** add `NSUserTrackingUsageDescription` or ATT prompt unless an ad/measurement SDK is introduced |

---

## 6. Pre-prompt UX checklist

| Permission | Web pre-prompt? | iOS action |
|------------|-----------------|------------|
| Location (market) | Yes | `LocationPurposeCopy.marketPickerPrePrompt` |
| Location (check-in) | Yes | `LocationPurposeCopy.jobSiteCheckInPrePrompt` |
| Push | Yes (web) | Soft prompt before UN authorization |
| Photos | Implicit | PhotosPicker + purpose string |
| Camera | N/A web | Purpose string + pre-prompt before first capture |
| Face ID | N/A | User enables app lock / system prompt on sensitive action |
| Tracking | N/A | Do not implement ATT |
| Age / DOB | Yes | `AgeGateView` |

---

## 7. Gaps / non-claims

1. **Info.plist is SSOT** for purpose strings — keep this inventory + ASC labels in sync when keys change.  
2. **Camera on iOS**; **mic unused** — do not declare mic.  
3. **Face ID** declared because optional lock + sensitive actions use LocalAuthentication.  
4. **Apple Pay domain association** remains ops if Apple Pay is marketed.  
5. **Crash Data** not declared for first iOS binary (no Sentry in Package.resolved).  
6. **No Checkr** — do not list background-check categories until productized.  
7. **Free-tier digital** — no IAP; purchase history still applies to **Rail A** orders/escrow.

---

## 8. Row count

**Inventory rows in §1 table: 40** (added Face ID + Device ID push explicit rows; reconciled 2026-08-02).

---

*Document owner: App Store launch readiness. Update when collection surfaces or third-party SDKs change.*
