# Privacy purpose-string + data inventory (web → future iOS)

**Date:** 2026-07-26  
**Stage:** A Phase 3 — App Store launch readiness  
**Scope:** Map **current web product** collection surfaces to future **Info.plist purpose strings**, **pre-prompt UX**, and **App Store Connect App Privacy** labels.  
**Not in scope:** Stage B native code, StoreKit wiring, real Info.plist commits.

**Sources (code + policy):**

| Source | Path / notes |
|--------|----------------|
| Cookie consent | `web/src/components/compliance/CookieConsent.tsx` |
| Age gate (DOB) | `web/src/components/compliance/AgeGate.tsx` |
| Location — market | `web/src/components/location/MarketSelector.tsx` |
| Location — GPS check-in | `web/src/hooks/useWorkspace.ts`, `web/src/components/providers/CheckInOut.tsx` |
| Maps / geocoding | Mapbox (`JobPostingForm`, `MarketplaceMap`, CSP allowlist) |
| Uploads | `web/src/hooks/useImageUpload.ts`, `UPLOAD_CONTEXT` in `web/src/types/index.ts` |
| Auth / OAuth | register/login forms; `gateway/internal/handler/oauth*.go` |
| Payments | Stripe Elements + `PaymentRequestButton` (Apple Pay / Google Pay) |
| Sentry | `web/src/instrumentation-client.ts` (analytics consent gate) |
| Web push | `web/src/lib/web-push.ts`, `web/src/components/pwa/PushPermission.tsx` |
| Permissions-Policy | `web/next.config.ts`, `gateway/internal/middleware/security.go` |
| Export / deletion | `GET /api/v1/me/export` (router also `/me/export`); account settings UI |
| Privacy policy | `web/src/app/(public)/privacy/page.tsx` |
| PII at rest | `Claude.md` §6 / migrations `031`/`033`/`104`–`107` |
| Remediation baseline | `docs/compliance/app-store-review-2026-07-26-remediated.md` |

**Legend**

| Column | Meaning |
|--------|---------|
| **Proposed iOS API** | System permission / framework the future native client would declare or call |
| **Pre-prompt UI needed?** | In-app explanation *before* the OS dialog (Apple best practice; already partially done on web for GPS/push) |
| **Tracking?** | Apple “tracking” (link with third-party data for ads / data broker). **Y** only if product behavior meets that bar |
| **ASC category** | Approximate App Privacy Nutrition Label type (confirm in ASC UI at packaging time) |

**Global ATT recommendation:** **No ATT / no `NSUserTrackingUsageDescription` required for the current product model** — no IDFA, no ad network SDK, no cross-app advertising identifier. Sentry and optional analytics are first-party product diagnostics under consent, not advertising tracking. Revisit if a retargeting/ad SDK or IDFA-based measurement is added.

---

## 1. Inventory table

| # | Data / permission | Collection surface (web path) | Backend / third party | Proposed iOS API | Info.plist purpose string (draft English) | Pre-prompt UI needed? | ASC privacy label category (approx) | Tracking? Y/N | Notes |
|---|-------------------|-------------------------------|----------------------|------------------|-------------------------------------------|----------------------|-------------------------------------|---------------|-------|
| 1 | **Email** | `/register`, `/login`, OAuth return, profile/settings | User service / Postgres (`users.email` plaintext for auth lookup); session JWT | Account credentials (no special plist key); Sign in with Apple / email field | N/A (not a protected resource purpose string) | No (form context is sufficient) | Contact Info → Email Address | N | Required for account; disclosed in Privacy Policy §2. |
| 2 | **Password** | `/register`, `/login`, reset flows | User service — **argon2id** hash only; never exported | Secure TextField / Keychain optional | N/A | No | (Not listed as collected if only hash stored — treat as account credential; do not claim “password collected” as shareable data) | N | Export deliberately omits password hash / MFA secrets (`data_export.go`). |
| 3 | **Display name** | `/register`, `/profile`, ProfileForm | User service; shown to counterparties | N/A | N/A | No | Contact Info → Name (or Other User Content if treated as public handle) | N | Public-facing in jobs, listings, chat, reviews. |
| 4 | **Phone** | ProfileForm (`/profile`), provider onboarding / employees | User service; **encrypted at rest** (`users.phone` secretbox); verification flag | Contacts optional only if native picker used later — **not required today** | If Contacts used later: *“NoMarkup uses your contacts only when you choose a phone number to add to your profile.”* — **not used today** | Soft copy in form (“for SMS alerts / verification”) recommended | Contact Info → Phone Number | N | Optional on profile; Twilio-proxy patterns may exist for relay. |
| 5 | **Date of birth / age** | `AgeGate` (global layout for authed unverified users) → `useSetDOB` / age-status API | User service; **`users.dob_encrypted`**; `dob_verified_at` audit | N/A (form field) | N/A | Yes (modal already explains 18+ and non-public storage) | Sensitive Info → Other Sensitive Info (or “Other Data”) — age verification | N | Client UX only; gateway enforces ≥18. Not shown publicly. |
| 6 | **OAuth — Google** | Login/register OAuth buttons → `/oauth/google` + callback | Gateway OAuth; Google OIDC scopes `openid email profile`; stores provider link | ASWebAuthenticationSession / Google SDK (if used) | N/A for Google; disclose in Privacy labels + Privacy Policy | Optional “Continue with Google” is the disclosure | Identifiers → User ID; Contact Info → Email/Name from provider | N | Unlink: `GET/DELETE /me/oauth-accounts/{provider}` + ConnectedAccounts UI. |
| 7 | **OAuth — Apple** | `/oauth/apple` + form_post callback | Gateway; scopes `name`, `email`; SIWA required on iOS if other social login offered | **AuthenticationServices** (Sign in with Apple) | N/A (SIWA entitlement, not usage description) | SIWA button is sufficient | Identifiers → User ID; Email (may be private relay) | N | **Guideline 4.8:** if third-party login ships on iOS binary, SIWA must be offered equivalently. |
| 8 | **OAuth — Facebook** | `/oauth/facebook` + callback | Gateway; scopes `email`, `public_profile` | ASWebAuthenticationSession / FB SDK (prefer no FB SDK if web-only OAuth) | If FB SDK: follow Meta’s required strings | Soft prompt if native SDK | Identifiers → User ID; Contact Info | N | Same unlink path as other OAuth. Avoid unused FB SDK permissions. |
| 9 | **Location — market picker (approx)** | Header / market chip → `MarketSelector` “Use my location” | Browser Geolocation → nearest launched market client-side; markets catalog from API | **CoreLocation** `WhenInUse` | **NSLocationWhenInUseUsageDescription:** *“NoMarkup uses your location to suggest the nearest marketplace city. You can always pick a city manually.”* | **Yes** — web already: “Used to find your nearest NoMarkup market…” | Location → Coarse Location (if only city-level retained) / Precise if raw coords stored | N | Purpose string shipped web (ASR-5.1.5). Prefer not retaining GPS if only market slug is saved. |
| 10 | **Location — maps / job & listing address** | Job post form geocode; marketplace map; service area maps | **Mapbox** geocoding + tiles; gateway/job service stores address + coarsened geometry | MapKit or Mapbox iOS SDK; no continuous GPS required for typed address | If Mapbox needs location: same When-In-Use string scoped to “show nearby jobs and pickup areas” | Yes when device GPS used; typed address needs no OS dialog | Location → Coarse/Precise depending on stored precision; Physical Address | N | Public `/jobs/map` must use **coarsened** points only (`approximate_location`). Exact service points encrypted alongside coarsened public geometry. |
| 11 | **Location — GPS check-in / check-out** | Contract workspace `CheckInOut` → `POST .../checkin` / `checkout` | Gateway + contract store; lat/lng with contract for disputes | **CoreLocation** `WhenInUse` (possibly temporary full accuracy) | **NSLocationWhenInUseUsageDescription:** *“NoMarkup uses your location to confirm you arrived at the job site. Check-in location is stored with the contract for dispute protection.”* | **Yes** — web copy already present; GPS **required** (no note-only API) | Location → Precise Location | N | Fail closed without permission. Do not background-track. |
| 12 | **Photos — avatar** | Profile / avatar upload (`UPLOAD_CONTEXT.AVATAR`) | Gateway → imaging service → S3 presign; variants | **Photo Library** (read) | **NSPhotoLibraryUsageDescription:** *“NoMarkup needs access to your photos so you can set a profile picture.”* | Recommended before first picker | Photos or Files → Photos or Videos; User Content | N | File input / picker today; no camera capture API on web. |
| 13 | **Photos — portfolio** | Provider portfolio (`PORTFOLIO`) | Imaging + S3 | Photo Library | **NSPhotoLibraryUsageDescription:** *“NoMarkup needs access to your photos so you can add work portfolio images to your provider profile.”* | Yes (first upload) | Photos or Videos; User Content | N | Limit enforced server-side (portfolio image limits). |
| 14 | **Photos — job** | Job posting / completion evidence (`JOB_PHOTO`) | Imaging + S3; job service | Photo Library; optional **Camera** | Library string: *“…so you can attach photos to job posts and completion evidence.”* Camera: see row 17 | Yes | Photos or Videos; User Content | N | Completion photos also via workspace handler path. |
| 15 | **Photos — listing (goods)** | Listing posting form (`LISTING`) | Imaging + S3; marketplace listings | Photo Library; optional Camera | *“…so you can add photos of items you list for sale.”* | Yes | Photos or Videos; User Content | N | Local pickup goods marketplace UGC. |
| 16 | **Files — insurance / documents** | Insurance claim form, guarantee claim (`DOCUMENT`) | Imaging/S3 DOCUMENT context; MIME validated | Photo Library and/or **Files** (UTType PDF/images) | **NSPhotoLibraryUsageDescription** and/or document picker (no extra plist for UIDocumentPicker): *“…so you can upload insurance and claim documents.”* | Yes — sensitive docs | Purchases / Financial Info (claim meta); Files or Docs; User Content | N | `InsuranceClaimForm` uses real `useImageUpload` DOCUMENT context (ASR-2.1.a.1). Cap **10MB** server-side (`MAX_FILE_SIZE_BYTES`); client may mention larger soft limits for docs — align copy with gateway. |
| 17 | **Camera** | **Not used** on web today | N/A | `AVCapture` / `UIImagePickerController` camera | **NSCameraUsageDescription:** *“NoMarkup uses the camera so you can take photos for jobs, listings, or your profile instead of choosing an existing photo.”* | **Yes** if/when enabled | Photos or Videos (if captured images uploaded) | N | **Permissions-Policy: `camera=()`** on Next (`web/next.config.ts`) and gateway security middleware — **explicitly disabled**. Stage B may re-enable with purpose string + pre-prompt. |
| 18 | **Microphone** | **Not used** | N/A | AVAudioSession | **NSMicrophoneUsageDescription** only if voice notes/calls ship | N/A until product needs it | Audio Data (if collected) | N | **Permissions-Policy: `microphone=()`**. Do not declare unused mic permission. |
| 19 | **Payment method / card metadata** | `/settings/payment-methods`, checkout, bid bonds, orders | **Stripe** Elements / PaymentIntents; Connect Express for providers | PassKit / Stripe iOS SDK; **no raw PAN in app** | N/A for card entry in Stripe UI; Apple Pay has PassKit flows | Wallet sheet is OS-owned | Financial Info → Payment Info; Purchases → Purchase History | N | No full PAN stored by NoMarkup. Privacy Policy: Stripe only. |
| 20 | **Apple Pay / Payment Request** | `PaymentRequestButton` (Stripe Payment Request API) | Stripe; domain association `/.well-known/apple-developer-merchantid-domain-association` (placeholder noted) | **PassKit** `PKPaymentAuthorizationController` | N/A (wallet UI) | No separate pre-prompt beyond checkout context | Financial Info; Purchases | N | Web: `requestPayerName` + `requestPayerEmail`. Live Apple Pay needs real domain association before production. |
| 21 | **Provider payout / Connect** | Stripe onboarding UI | Stripe Connect Express; payment service | SafariView / Stripe Connect | N/A | Onboarding copy | Financial Info; Identifiers (Stripe account id) | N | Payouts/escrow; provider never self-releases escrow (product rule). |
| 22 | **Chat messages** | `/messages`, WebSocket chat | Chat service + Postgres; content filter on create | N/A (network) | N/A | No | User Content → Other User Content; Messages (if labeled) | N | UGC: filter + report + block. Export includes messages **sent**. |
| 23 | **UGC — jobs** | Job create/edit | Job service; contentfilter | N/A | N/A | No | User Content | N | Includes budgets, categories, service address (PII). |
| 24 | **UGC — listings** | Marketplace sell / edit | Listing write handlers; contentfilter | N/A | N/A | No | User Content; Physical Address (pickup) | N | Pickup location published by design within 25 mi model. |
| 25 | **UGC — reviews** | Review forms; review photos (`REVIEW_PHOTO`) | Review handlers; flag/report | Photo Library if photos | Photo string covers review photos | Soft | User Content; Photos | N | FlagReviewButton + admin queue. |
| 26 | **Reports / blocks** | Report buttons (listing, job, provider, chat) | Gateway + admin queues | N/A | N/A | No | User Content; Other Diagnostic (moderation) | N | Safety surface for Guideline 1.2. |
| 27 | **Device / crash diagnostics (Sentry)** | Client `instrumentation-client.ts`; server `instrumentation.ts` | **Sentry** | None beyond network; optional MetricKit later | N/A | **Cookie/analytics consent** (web); native: ATT **not** required for crash SDK alone if not used for tracking | Diagnostics → Crash Data, Performance Data | N | **Opt-in** via `nm:consent` analytics. Session Replay **disabled**. `beforeSend` re-checks consent. |
| 28 | **Cookies / local storage** | CookieConsent banner; session cookies; consent cookie `nm:consent` | Gateway `/cookie-consent` log; auth cookies | App Storage (no OS dialog) | N/A | Consent banner for non-essential | Identifiers → Device ID (if any); Product Interaction | N | Necessary always on; analytics + marketing opt-in default **false**. |
| 29 | **Optional analytics / marketing flags** | CookieConsent analytics + marketing toggles | Product telemetry / future marketing (consent-gated) | None unless third-party ad SDK | If ATT ever needed: **NSUserTrackingUsageDescription** (see ATT section) | Consent UI | Product Interaction; Advertising Data **only if** ads/retargeting ships | **N today** | Marketing copy says “Personalized recommendations” — **not** IDFA tracking. Do not enable ATT until true cross-app tracking exists. |
| 30 | **Push notifications (web push partial)** | `PushPermission` soft prompt → VAPID subscribe → `POST /me/push-subscriptions` | Notification service + webpush-go; SW `/sw.js` | **UserNotifications** + APNs | **N/A for remote notifications entitlement**; optional provisional | **Yes** — soft prompt before `requestPermission` (web pattern to copy) | Identifiers → Device ID (push token) | N | SW currently kill-switch/unregister posture in places; push helpers exist. iOS: transactional auction/job alerts — not ads. |
| 31 | **Service / property address (PII)** | Job post, properties, provider onboarding | **Encrypted:** `jobs.service_address`, `jobs.service_location_encrypted`, `properties.address` / notes / `location_encrypted`; geometry coarsened 0.01° | N/A | N/A | Contextual form labels | Physical Address; Location | N | Readers needing precision decrypt. `provider_profiles.service_location` remains exact plaintext (documented limitation for matching). |
| 32 | **Provider insurance / EIN / licenses** | Provider onboarding, employee forms, licenses | Encrypted: `ein_tin`, insurance policy numbers, license numbers, employee PII fields | Photo Library for doc images | Document photo strings as above | Yes for sensitive docs | Financial Info; Other Sensitive Info; Contact Info | N | Full encrypted inventory in Claude.md §6. |
| 33 | **IP address / user agent** | All HTTP; push subscribe sends `user_agent` | Gateway logs (often hashed IP per policy); rate limits | N/A | N/A | No | Diagnostics; Identifiers | N | Privacy Policy §2 device/usage. |
| 34 | **Account data export** | Settings → Account → “Download my data” | Gateway `DataExportHandler` JSON `nomarkup.data-export.v1` | Files app save | N/A | Confirm download only | (Access right — not a new collection category) | N | Owner-scoped JWT only; sections: profile, jobs, listings, payments meta, messages_sent, etc. |
| 35 | **Account deletion** | Settings → Account → request deletion (30-day grace) | User service schedule + finalize; Stripe customer delete adapter | N/A | N/A | **Yes** — multi-step confirm + reason (already on web) | (Deletion right — Guideline **5.1.1(v)**) | N | Cancel within grace. Tax/ledger residuals retained as disclosed. |
| 36 | **MFA secrets** | Settings security (if enabled) | `users.mfa_secret` encrypted; not in export | Local auth / Keychain for TOTP seed display once | N/A | Setup wizard | (Credentials — not shared) | N | Never include in export. |
| 37 | **Referrals** | `/register?ref=` redeem | User service referrals | N/A | N/A | No | Identifiers / Other | N | Best-effort post-register. |
| 38 | **Permissions-Policy baseline (web)** | All pages | Next headers + gateway middleware | Documents **denied** camera/mic; geolocation self; payment self | N/A | N/A | N/A | N | Next: `camera=(), microphone=(), geolocation=(self), payment=(self)`. Gateway: `camera=(), microphone=(), geolocation=(self)`. |

---

## 2. Consolidated draft Info.plist keys (future native)

Use only keys for APIs the binary **actually calls**. Prefer one combined location string if a single `WhenInUse` authorization covers market + check-in + maps (customize copy to list purposes):

```xml
<!-- Location (required if CoreLocation used) -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>NoMarkup uses your location to suggest your nearest market, show local jobs and pickup areas, and confirm job-site check-in for dispute protection. You can pick a city manually and revoke location access in Settings.</string>

<!-- Optional: only if Always authorization is ever requested (not planned) -->
<!-- NSLocationAlwaysAndWhenInUseUsageDescription — do not add without product need -->

<!-- Photos -->
<key>NSPhotoLibraryUsageDescription</key>
<string>NoMarkup needs access to your photo library so you can upload profile, portfolio, job, listing, review, and claim document images.</string>

<!-- Camera — only if Stage B enables capture (currently off on web) -->
<key>NSCameraUsageDescription</key>
<string>NoMarkup uses the camera so you can take photos for jobs, listings, profile, or claim documents.</string>

<!-- Microphone — do not ship until product uses audio -->
<!-- NSMicrophoneUsageDescription -->

<!-- Tracking — do NOT ship while ATT decision is N -->
<!-- NSUserTrackingUsageDescription -->

<!-- Local network / Bluetooth / Face ID: not used by current product map -->
```

**Photo Library Add-Only / limited library:** If iOS limited-library picker is used exclusively, still provide `NSPhotoLibraryUsageDescription` when required by the API level you call; prefer `PHPicker` (no full-library access) to reduce permission friction.

---

## 3. ASC App Privacy label — roll-up (approximate)

Confirm each row in App Store Connect against live binary + third-party SDKs at packaging time.

| Data type (ASC) | Linked to user? | Used for tracking? | Purposes (typical) | Collected? |
|-----------------|-----------------|--------------------|--------------------|------------|
| Email Address | Yes | No | App Functionality, Account | Yes |
| Name | Yes | No | App Functionality | Yes |
| Phone Number | Yes | No | App Functionality | Yes (optional) |
| Physical Address | Yes | No | App Functionality | Yes (jobs/properties/pickup) |
| Other User Contact Info | Yes | No | App Functionality | OAuth / chat display |
| Photos or Videos | Yes | No | App Functionality | Yes (uploads) |
| Audio Data | — | — | — | **No** (mic off) |
| Customer Support | Yes | No | App Functionality | Support tickets / reports |
| Other User Content | Yes | No | App Functionality | Jobs, listings, reviews, chat |
| Purchase History | Yes | No | App Functionality | Yes (orders, escrow meta) |
| Payment Info | Yes | No | App Functionality | Via Stripe (tokenized) |
| Precise Location | Yes | No | App Functionality | Check-in; optional market GPS |
| Coarse Location | Yes | No | App Functionality | Market / maps / coarsened public map |
| Crash Data | Yes | No | Analytics (opt-in posture) | Sentry when consented |
| Performance Data | Yes | No | Analytics | Web vitals / Sentry traces when consented |
| Product Interaction | Yes | No | Analytics / App Functionality | Consent-gated analytics |
| Device ID | Yes | No | App Functionality | Push tokens |
| User ID | Yes | No | App Functionality | Account UUID, OAuth sub |
| Advertising Data | — | — | — | **No** product ad network today |
| Other Diagnostic Data | Yes | No | Analytics / App Functionality | Logs |

**Third-party SDKs to list when native ships:** Stripe, Mapbox (if embedded), Sentry, Sign in with Apple / Google / Facebook as used, APNs.

---

## 4. Account deletion & export (Guideline 5.1.1(v))

| Requirement | Web evidence | iOS packaging note |
|-------------|--------------|--------------------|
| In-app account deletion | Settings → Account; 30-day grace; cancel restore | Must remain **in-app**, not only web link, if account creation exists in app |
| Deletion not harder than create | Multi-step confirm with typed confirm — acceptable if not dark-patterned | Keep equivalent flow; deep-link to same API |
| Data export (good practice / privacy laws) | JSON download owner-scoped | Offer in-app or clearly linked account management |
| Privacy policy link | `/privacy` in-app + footer | Include in binary metadata + settings |

---

## 5. ATT decision detail

| Question | Answer |
|----------|--------|
| Does the app use IDFA / AppTrackingTransparency today? | **No** (web product; no ad SDK) |
| Is data used to track users across apps/sites owned by other companies for advertising? | **No** per current Privacy Policy and code paths |
| Sentry / optional analytics | First-party product diagnostics; consent-gated; not advertising tracking under Apple’s ATT definition |
| Marketing cookie category | Personalized recommendations flag only; **not** sufficient to declare ATT unless a tracking SDK is added |
| **Recommendation** | **Do not** add `NSUserTrackingUsageDescription` or ATT prompt in Stage B1 unless a deliberate ad/measurement SDK is introduced. Document re-review trigger: any MMP, Meta/Google Ads SDK, or sharing device data with data brokers. |

---

## 6. Pre-prompt UX checklist (Stage B1)

| Permission | Web pre-prompt exists? | Stage B1 action |
|------------|------------------------|-----------------|
| Location (market) | Yes (`MarketSelector`) | Port copy before `requestWhenInUseAuthorization` |
| Location (check-in) | Yes (`CheckInOut`) | Port copy; disable CTA if denied |
| Push | Yes (`PushPermission`) | Port soft prompt before UN authorization |
| Photos | Implicit (upload control) | Short sheet: what photos are used for |
| Camera | N/A (disabled) | Only if enabling capture |
| Tracking | N/A | Do not implement |
| Age / DOB | Yes (`AgeGate`) | Port 18+ gate for account use |
| Cookie/analytics | Yes (`CookieConsent`) | Map to native analytics toggle in Settings |

---

## 7. Gaps / non-claims

1. **No Info.plist in repo** — drafts above are design inputs only.  
2. **Camera/mic are policy-denied on web** — do not claim mobile capture until Stage B enables and documents them.  
3. **Apple Pay domain association** is still a production ops follow-up (placeholder noted in remediation).  
4. **provider_profiles.service_location** exact plaintext is a known PII limitation (matching).  
5. **ASC labels must be revalidated** against the actual binary binary dependencies at submission.  
6. **Service worker** may unregister in production kill-switch mode — push is **partial** on web.

---

## 8. Row count

**Inventory rows in §1 table: 38**

---

*Document owner: App Store launch readiness Stage A Phase 3. Update when collection surfaces or third-party SDKs change.*
