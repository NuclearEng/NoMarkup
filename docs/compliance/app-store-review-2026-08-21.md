# App Store Compliance Report

- **Target**: `/Users/nuclearisotope/Projects/Personal/NoMarkup` (native iOS `ios/NoMarkup`, bundle `com.nomarkup.app`)
- **Date**: 2026-08-21
- **Guidelines snapshot**: 2026-06-08 ([App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)) — 74 days old (within 90-day refresh window; registry not re-fetched)
- **Platform / posture**: **ios** · App Store (not notarization-priority)
- **Submission readiness**: **NOT READY**

> Native SwiftUI binary is in-tree (`ios/NoMarkup.xcodeproj`, marketing `1.0.0` / build `3`). The 2026-07-26 reports assumed **no native target** and are stale for packaging claims. Privacy/terms routes now exist. Remaining blockers are **ops/ASC**, **UGC/age**, and **regulated rails shipped behind server flags that seed ON**.

---

## Applicability profile

| Flag | Value | Evidence |
|------|-------|----------|
| `always` | true | Native iOS App Store target `ios/NoMarkup.xcodeproj` |
| `ugc` | true | Jobs, listings, chat, reviews, photos, feeds |
| `social` | true | Messaging, follows, profiles, `BlockedUsersView` |
| `creator_content` | true | Seller listings, portfolio, review photos |
| `kids_category` | false | 18+ `AgeGateView` / `AgeGateMath.minimumAgeYears = 18` |
| `kids_audience` | false | 18+ required for signed-in sessions |
| `medical` / `health` | false | No HealthKit / diagnosis |
| `location` | true | `NSLocationWhenInUseUsageDescription`; job-site check-in; market picker |
| `iap` | true | StoreKit scaffold; `StoreKitEnabled=false` (free-tier lock); product IDs in Info.plist |
| `subscriptions` | true | Rail B digital Pro/Business IDs listed; purchase UI off |
| `reader` | false | Not a reader app |
| `multiplatform` | true | Web + iOS; web sells Stripe digital tiers |
| `enterprise` | false | Consumer marketplace |
| `p2p` | true | Reverse-auction jobs awarded 1:1 |
| `physical_goods` | true | Goods marketplace + local pickup + services escrow |
| `free_companion` | false | Full native client |
| `crypto` / `nft` / `loot_boxes` | false | No wallets / NFT / loot |
| `insurance` | true | `per_job_insurance`, `insurance_competition` (server flags) |
| `nonprofit` | false | — |
| `loans` | true | `working_capital` advances |
| `financial` | true | BNPL, working capital, instant payout |
| `gambling` | false | Marketplace auctions, not RMG |
| `ads` | false | No in-app ads |
| `tracking` | false | `PrivacyInfo.xcprivacy` `NSPrivacyTracking=false`; no ATT key |
| `account` | true | Email/password, SIWA, Google, Facebook |
| `third_party_login` | true | Google + Facebook + SIWA |
| `apple_pay` | true | `merchant.com.nomarkup.app` + Stripe PaymentSheet |
| `push` | true | `PushRegistration.swift`, `aps-environment` |
| `extensions` / `widgets` | true | `NoMarkupWidget` + Live Activities |
| `mini_apps` / `vpn` / `mdm` / `mac` / `arkit` / `remote_desktop` / `template` | false | Native iOS/iPad only |
| `metadata` | true | ASC drafts in repo; portal not created |
| `recording` | true | Camera + photo library; **no** microphone |
| `regulated` | true | Insurance, advances, legal services, BNPL — server-flag gated |
| `us_storefront` | true | US / King County launch |

**Open questions (conservative flags used):**

1. Are working-capital advances **personal loans** (3.2.2(ix)) or commercial MCA against contracts? Scored as `loans=true` fail-closed.
2. Will review/prod **actually** keep financial flags off? Seed migration `060` inserts them **true**; client `iOSHardOffKeys` is empty.
3. Does a web-paid Pro subscription change iOS digital limits for the same account? Shared API, no iOS client-type gate.

---

## Executive summary

| Metric | Count |
|--------|-------|
| **Blocker FAIL** | **9** |
| **Major FAIL** | **4** |
| **Advisory FAIL** | **0** |
| **RISK** | **16** |
| **GAP** | **34** |
| **PASS** (applicable, verified) | **167** |
| **N/A** | **138** |
| **Submission readiness** | **NOT READY** |

### What is already strong (do not re-open as code blockers)

- Native `TabView` dual-rail client — **not** a WKWebView wrapper (**ASR-4.2 PASS**).
- **Sign in with Apple** equivalent to Google/Facebook (**ASR-4.8 PASS**).
- In-app **account deletion** + GDPR cascade (**ASR-5.1.1.v PASS**).
- Privacy/Terms/Community/Support pages exist; in-app links via `SFSafariViewController`.
- Rail A GMV (jobs + goods + escrow) uses Stripe / Apple Pay, **not** IAP (**ASR-3.1.3.e.1 PASS**).
- This binary does **not** show Stripe CTAs for digital Pro/Business unlocks (`StoreKitEnabled=false`) (**ASR-3.1.1.1 PASS**).
- Purpose strings + privacy manifests (app + widget); no ATT (tracking false).
- Text UGC filter + listing/user report + block foundations.

### Top 5 actions before first submit

1. **Provision a live review API** (`https://api.no-markup.com`) with seed demo accounts in the ASC password field — **ASR-PRE-05 / ASR-BYS.3 / ASR-PRE-04**.
2. **Hard-off regulated rails** in the iOS binary (`FeatureFlags.iOSHardOffKeys`) **and** set review/prod DB flags `enabled=false` (seed `060` currently inserts **true**) until licenses — **ASR-3.2.1.viii / ASR-3.2.2.ix.\* / ASR-5.1.1.ix**.
3. **UGC + age:** add job-level report on `JobDetailView`; fail-**closed** age gate; do not browse creator UGC without declared age — **ASR-1.2.b / ASR-1.2.1.d**.
4. **ASC packaging:** app record, 6.9″ + 13″ screenshots, Privacy Policy URL, nutrition labels, contact, pasted review notes, live `no-markup.com` — **ASR-2.1.a.1 / ASR-PRE-02 / ASR-5.1.1.i**.
5. **Fix marketing-push consent** and **Apple Pay button branding** — **ASR-4.5.4.marketing / ASR-4.9.branding**.

---

## Findings

Findings ordered **blocker FAIL → major FAIL → RISK → GAP** inside each section. PASS items are counted in the appendix only.

### 1. Safety

#### Blocker FAIL

### [ASR-BYS.3] Backend must be live during review
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Enable backend services so they are live and accessible during App Review.
- Evidence: Review notes point at `https://api.no-markup.com`. `docs/operations/provisioning-checklist.md` is **NOT YET PROVISIONED**; deploy fail-closed until `DEPLOY_PROVISIONED=true`. `docs/compliance/submission-blockers.md` row 9 still open.
- Remediation: Provision cluster/secrets/migrate-on-deploy; keep the review host up with seed data and report/moderation routes for the review window.
- Confidence: 9

### [ASR-1.2.b] Report offensive content + timely handling
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: UGC/social apps must provide a mechanism to report offensive content and timely responses.
- Evidence: Listings, users, chat, and reviews have report paths (`ListingReportSheet`, `POST /api/v1/listings/{id}/report`, `POST /users/{id}/report`, `flagReview`). **Jobs (core UGC):** no job report API; `ios/NoMarkup/Features/JobDetailView.swift` has no report/flag control (customer section is name/stats only). Web notes the same gap. Community guidelines omit jobs from report surfaces. No live moderation SLA.
- Remediation: Add `POST /api/v1/jobs/{id}/report` + iOS report on `JobDetailView` (content + poster); staff `/user-reports` and `/goods-reports` with a first-response SLA.
- Confidence: 9

### [ASR-1.2.1.d] Age labels + age restriction for creator content
- Status: FAIL
- Severity: blocker
- Notarization: yes
- Rule: Identify content that exceeds the app’s age rating; restrict underage users via verified or declared age.
- Evidence: 18+ DOB gate exists (`AgeGateView`, `GET /api/v1/me/age-status`) **only after sign-in**. `AgeGateHost.checkAgeStatus` **fails open** on network errors (`showGate = false` in `AgeGateView.swift`). Unauthenticated users can browse jobs/listings/photos with no age declaration. No per-listing age badges.
- Remediation: Require declared age before UGC browse (or 17+ rating **and** catalog fully in-rating); fail **closed** when age-status errors; align ASC rating with 18+ policy.
- Confidence: 8

#### RISK

### [ASR-1.1.4] Sexual / pornographic / exploitation content
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Do not include overtly sexual or pornographic material, or facilitate prostitution/trafficking.
- Evidence: Text blocklist includes porn/escort/CSAM phrases (`gateway/internal/contentfilter/filter.go`). Chat images and listing photos are **not** scanned — filter is text/URL only. No NSFW default-hide.
- Remediation: Server-side image moderation (or vendor CSAM/NSFW) on listing/job/profile/review/chat media; queue hits to admin.
- Confidence: 7

### [ASR-1.2.f] Incidental NSFW from web UGC hidden by default
- Status: RISK
- Severity: major
- Notarization: no
- Rule: Incidental mature NSFW from a web-based service may display only if hidden by default and enabled via the website.
- Evidence: iOS catalog is the same web UGC. No NSFW preference, blur, or web-only mature toggle. Photos are not classified.
- Remediation: Default-hide mature media; enable only from website account setting; scan uploads.
- Confidence: 6

### [ASR-1.4.3.b] Do not encourage minors to use tobacco/vape/drugs/alcohol
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Apps that encourage minors to consume tobacco, vape, illegal drugs, or alcohol will be rejected.
- Evidence: No first-party youth substance marketing. Public catalog + fail-open age gate let under-18 device users see listings/jobs. 21+ category gates are “v2” per `compliance.go`.
- Remediation: Enforce 18+ before catalog access; keep substance listing bans.
- Confidence: 6

### [ASR-1.4.3.c] Facilitating tobacco / controlled-substance sales
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Facilitating sale of controlled substances (except licensed pharmacy/legal cannabis) or tobacco is not allowed.
- Evidence: Keywords cover tobacco/vape and hard drugs (`contentfilter/filter.go`). **Cannabis is explicitly not banned** (`// not cannabis`; test allows “Homegrown cannabis accessories decorative”). No seller licensing or geo-fence. Community Guidelines still prohibit recreational drugs.
- Remediation: Add cannabis/THC/paraphernalia phrases; reject unless a licensed geo-fenced dispensary path exists.
- Confidence: 8

### [ASR-BYS.5] Ongoing support / safety features stay operational
- Status: RISK
- Severity: major
- Notarization: no
- Rule: App must continue to function as intended and be actively supported.
- Evidence: In-app Support via `AppConfig.supportURL`. Production origin and 24×7 mailbox are not provisioned. UGC report “timely response” has no ops SLA.
- Remediation: Ship Support URL on the live zone; staff `support@no-markup.com`; keep report/block APIs up after listing.
- Confidence: 7

#### GAP

### [ASR-BYS.1] App Review contact must be current
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Keep App Review contact information current so App Review can reach the developer.
- Evidence: In-repo contact is `support@no-markup.com` / `https://no-markup.com/support`. ASC contact fields are founder remaining (`submission-blockers.md` rows 3, 8).
- Remediation: Create the ASC record; set monitored Support URL + review phone/email.
- Confidence: 8

### [ASR-BYS.2] Demo account / review access
- Status: GAP
- Severity: blocker
- Notarization: no
- Rule: Provide App Review full access, including an active demo account or fully-featured demo mode.
- Evidence: Seed emails documented (`customer@nomarkup.com`, `provider@nomarkup.com`, `admin@nomarkup.com`) in `docs/compliance/app-review-notes.md`. Password not in git (correct) and **not** in ASC. Age gate will fire for users without DOB.
- Remediation: Seed review env with those accounts, no MFA, pre-verified 18+ DOB; put password only in ASC.
- Confidence: 7

### [ASR-BYS.4] App Review notes for non-obvious safety
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Include detailed explanations of non-obvious features in App Review notes.
- Evidence: Strong paste block exists (`docs/compliance/app-review-notes.md`) but is **not pasted into ASC**.
- Remediation: Paste the ASC block; add a walkthrough of listing Report, chat Block, Community Guidelines, and age gate.
- Confidence: 8

---

### 2. Performance

#### Blocker FAIL

### [ASR-2.1.a.1] Final binary + complete metadata and live URLs
- Status: FAIL
- Severity: blocker
- Notarization: yes
- Rule: Submissions must be final versions with all necessary metadata and fully functional URLs; placeholder content must be removed.
- Evidence: `docs/compliance/submission-blockers.md` rows 1–12 — no ASC app record, no uploaded screenshots, no nutrition labels, no review contact. `https://no-markup.com/support` did not resolve (DNS) during this audit. `DEPLOY_PROVISIONED` residual. Binary itself is a complete native `RootTabView`.
- Remediation: Provision `no-markup.com` (Privacy/Support/Marketing HTTP 200), create the ASC record, upload 6.9″ + 13″ screenshots, paste review notes, then submit.
- Confidence: 8

#### RISK

### [ASR-2.3.1.a.1] No hidden, dormant, or undocumented features
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Do not include hidden, dormant, or undocumented features.
- Evidence: Full regulated rails ship in the binary (`BusinessFeaturesHubView`: BNPL, insurance, working capital, instant payout) with `FeatureFlags.iOSHardOffKeys = []`. Server `GET /api/v1/flags` can enable them post-review without a new binary. Review notes say “EXPECT OFF.”
- Remediation: Hard-off purchase CTAs until licensed; describe any flag-on path Apple should exercise.
- Confidence: 7

#### GAP (blocker / major)

### [ASR-2.1.a.2] On-device test for bugs and stability
- Status: GAP
- Severity: blocker
- Notarization: yes
- Rule: Apps must be tested on-device for bugs and stability before submission.
- Evidence: Partial device dogfood (`docs/compliance/iphone-device-dogfood-2026-08-05.md`). Required matrix in `device-smoke-checklist.md` is unsigned (M-SE, M-IPAD, M-AX5, M-17 all `[ ]`).
- Remediation: Execute and sign the device-smoke matrix on a Release-like build before upload.
- Confidence: 8

### [ASR-2.1.a.3] Demo account and live backend for review
- Status: GAP
- Severity: blocker
- Notarization: yes
- Rule: If the app includes login, provide demo account info and keep backends live.
- Evidence: Login required (`RootView` → `LoginView`). Accounts listed in review notes; password not in ASC; `https://api.no-markup.com` not provisioned. Release `APIBaseURL` empty → production host.
- Remediation: Seed review env; paste notes + password into ASC; keep API reachable from Apple’s network.
- Confidence: 9

### [ASR-2.3.1.a.3] No misleading marketing or false price claims
- Status: GAP
- Severity: blocker
- Notarization: yes
- Rule: Do not market content/services the app does not offer, or a false price.
- Evidence: No live ASC description. Draft What’s New promotes Apple Pay (`docs/compliance/release-notes/1.0.0.md`) while Apple Pay domain association is still a founder placeholder and `StripePublishableKey` is empty in the shipping plist. Marketing site DNS did not resolve.
- Remediation: Align store copy with what the review binary actually completes; verify live marketing URLs.
- Confidence: 7

### [ASR-2.1.b.2] Explain configured IAP that is not reviewable
- Status: GAP
- Severity: major
- Notarization: no
- Rule: If configured IAP items cannot be found or reviewed in the app, explain why in review notes.
- Evidence: `StoreKitProductIDs` listed; `StoreKitEnabled=false` hides purchase UI. ASC IAP catalog is “None for v1”. Explanation exists in notes, not pasted.
- Remediation: Paste the free-tier / no-IAP block; do not create those product IDs in ASC until Rail B is intended for review.
- Confidence: 8

### [ASR-2.3.0] Metadata must match the current binary
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: Description, screenshots, previews, and privacy information must accurately reflect the core experience.
- Evidence: No ASC listing. Privacy nutrition table is docs-only (`asc-packaging-checklist.md` §4).
- Remediation: Enter description, privacy labels, and screenshots that match the free-tier dual-rail binary.
- Confidence: 8

### [ASR-2.3.1.a.2] Specific Notes for Review; features accessible
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: New features must be described with specificity in Notes for Review and must be accessible.
- Evidence: Paste block exists; not entered in ASC. Flag-off rails are not fully exercisable.
- Remediation: Paste the full notes block.
- Confidence: 8

### [ASR-2.3.3] Screenshots must show the app in use
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Screenshots must show the app in use, not merely title art, login, or splash.
- Evidence: `app-store-screenshot-matrix.md`: no production screenshot set committed; 6.9″ and 13″ capture/upload `[ ]`. Harness `ScreenshotWalkUITests.swift` exists.
- Remediation: Capture and upload in-app Home / Marketplace / Jobs / Account.
- Confidence: 9

### [ASR-2.3.6.a] Honest age-rating questionnaire
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: Answer age-rating questions honestly so the app aligns with parental controls.
- Evidence: Draft in `asc-content-rating-answers.md` (UGC Yes, Messaging Yes). Not entered in ASC.
- Remediation: Enter the draft answers; do not sandbag UGC to 4+.
- Confidence: 8

### [ASR-2.3.7.a] Unique name and accurate keywords
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: Unique app name and accurate keywords; no trademark stuffing.
- Evidence: Display name `NoMarkup`. Keywords field not drafted or entered.
- Remediation: Enter descriptive keywords only (jobs, local marketplace, bidding).
- Confidence: 8

### [ASR-2.3.7.c] No prices or type-inappropriate copy in metadata
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: Names, subtitles, screenshots, and previews must not include prices.
- Evidence: Proposed subtitle has no price. ASC fields and screenshot set do not exist.
- Remediation: Keep prices out of name/subtitle/screenshots when uploading.
- Confidence: 7

### [ASR-2.3.7.d] Subtitle rules
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: Subtitles must not include inappropriate content, reference other apps, or make unverifiable claims.
- Evidence: Proposed subtitle “Local jobs & marketplace” is appropriate but not in ASC.
- Remediation: Enter that subtitle; avoid “#1” / “better than X.”
- Confidence: 8

### [ASR-2.3.9.b] Fictional account data in store art
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Display fictional account information instead of real-person data in metadata assets.
- Evidence: UITest/dogfood walks use seed emails and live catalog titles.
- Remediation: Capture store shots with clearly fictional names/avatars.
- Confidence: 7

### [ASR-2.3.12] What’s New must list significant changes
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Clearly describe new features in What’s New.
- Evidence: First-version paste exists (`release-notes/1.0.0.md`); not entered in ASC.
- Remediation: Paste the 1.0.0 block; trim Apple Pay if that path is not live.
- Confidence: 8

### [ASR-2.5.1.c] Frameworks used for intended purpose and disclosed
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: Use APIs for their intended purposes and indicate meaningful integrations in the app description.
- Evidence: Entitlements match use (SIWA, Apple Pay, APNs, app groups, associated domains). ASC description not created, so widgets/Live Activities/SIWA are not disclosed on the listing.
- Remediation: Mention Sign in with Apple, widgets/Live Activities, and (only if live) Apple Pay in the description.
- Confidence: 7

### [ASR-2.5.5] Fully functional on IPv6-only networks
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Apps must be fully functional on IPv6-only networks.
- Evidence: Release uses hostname `https://api.no-markup.com` (no IPv4 literals). No IPv6-only / NAT64 test record. Production DNS not resolvable here.
- Remediation: Confirm AAAA (or NAT64) and run a core-flow pass on an IPv6-only network.
- Confidence: 6

Additional advisory GAPs: **ASR-2.3.5** (category Shopping/Lifestyle not entered), **ASR-2.3.10.b** (on-product description not entered).

---

### 3. Business

#### Blocker FAIL

### [ASR-3.2.1.viii] Financial services submitted by licensed institution
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Apps used for financial trading, investing, or money management should be submitted by the financial institution performing such services and must have necessary licensing.
- Evidence: Native hub ships BNPL (`createInstallmentPlan`), working-capital **Request advance**, instant payout. Gated only by `GET /api/v1/flags`. `iOSHardOffKeys = []`. Migration `060_seed_financial_feature_flags.up.sql` seeds `customer_bnpl`, `working_capital`, `instant_payout` **true**. Developer is a marketplace, not a documented bank/lender. `regulated-rails-live-flagged.md` still `blocked-compliance`.
- Remediation: Put those keys in `iOSHardOffKeys` until a licensed partner model exists. Keep review API flags **off** even then. Do not treat “ops will remember to disable seed flags” as a binary control.
- Confidence: 8

### [ASR-3.2.2.ix.1] Personal loan APR and due date disclosed before commitment
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Apps offering personal loans must clearly and conspicuously disclose all loan terms, including equivalent maximum APR and payment due date.
- Evidence: `AdvancesView`: Contract ID + amount + **Request advance**. `WorkingCapitalAdvance` model has amount/fee/status only — **no APR, no due date**. Gateway computes `apr_bps` / `term_days`; iOS does not decode or show them. Form is visible even when the flag is off (button disabled).
- Remediation: Before any enablement: show max APR (all-in), fees, due date/term, and total repayable. If this is commercial MCA only, say so in Review Notes **and** still disclose price; keep the rail off native until then.
- Confidence: 9

### [ASR-3.2.2.ix.2] Maximum all-in APR ≤ 36%
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Loan apps may not charge a maximum APR higher than 36%, including costs and fees.
- Evidence: `advanceRateCeilingBps = 1500` (15% interest APR) plus **3% origination** (`advanceServiceFeeBps = 300`) over `defaultAdvanceTermDays = 30`. A 3% fee on a 30-day term annualizes well above 36% **including costs and fees**.
- Remediation: Recast as licensed commercial finance with counsel, or cap all-in APR at 36% and prove the math in UI. Do not enable `working_capital` on iOS until that holds.
- Confidence: 7

#### RISK

### [ASR-3.1.3.b.1] Multiplatform digital items must also be IAP
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Multiplatform apps may honor website purchases only if those items are also available as IAP in the app.
- Evidence: Web sells Pro/Business via Stripe (`web/src/app/(dashboard)/settings/subscription/page.tsx`). Same user/API; `GET /api/v1/subscriptions/me` has **no iOS client-type gate**. iOS offers **no IAP equivalent**. v1 cut says entitlement sync UI is unimplemented, not that the API ignores web tiers.
- Remediation: Option A — ship StoreKit products for the same tiers. Option B — force free-tier digital entitlements on iOS clients until IAP ships.
- Confidence: 7

### [ASR-3.2.1.v] Insurance apps: free, licensed, no IAP
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Insurance apps must be free, legally compliant in distributed regions, and cannot use IAP.
- Evidence: App is free; premiums use Stripe `purchaseInsurance` (correct rail). Surfaces live in binary. Seed `060` sets `per_job_insurance` **true**. Docs still unlicensed.
- Remediation: Review/prod flags **off** until licenses. Prefer client hard-off so a seed cannot expose purchase.
- Confidence: 8

### [ASR-3.2.2.ix.3] No required full repayment in 60 days or less
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Loan apps may not require repayment in full in 60 days or less.
- Evidence: `defaultAdvanceTermDays = 30`. Advances are against funded contracts / holdback, not clearly a 30-day balloon note in iOS copy. If Review treats this as a personal loan with a 30-day term, it is a 3.2.2(ix) rejection.
- Remediation: Required full-repayment term must be **> 60 days** if offered as a personal loan, or keep the rail off native and document MCA/holdback with counsel.
- Confidence: 6

#### GAP

### [ASR-3.0.1] Business model obvious in metadata and Review notes
- Status: GAP
- Severity: major
- Notarization: no
- Rule: If the app’s business model is not obvious, explain it in App Store metadata and App Review notes.
- Evidence: Paste block exists (`app-review-notes.md`: dual-rail, free-tier digital). Founder/ASC paste still open.
- Remediation: Paste the ASC notes block; describe Rail A vs free-tier digital; keep regulated flags off on the review API.
- Confidence: 8

**Business PASSes of note:** ASR-3.1.1.1 (no Stripe digital unlock CTA in this binary), ASR-3.1.3.e.1 (physical goods/services use Apple Pay/Stripe, not IAP). Promoted listings charge Stripe for a **physical listing** boost, scored under 3.1.3(e).

---

### 4. Design

#### Major FAIL

### [ASR-4.5.4.marketing] Marketing push consent + in-app opt-out
- Status: FAIL
- Severity: major
- Notarization: yes
- Rule: Push Notifications must not be used for promotions or direct marketing unless customers explicitly opted in via consent language in the app UI, and the app provides an in-app method to opt out.
- Evidence: Pre-prompt is transactional only (`NotificationPermissionCopy.prePromptBody`). Promotional types exist: `welcome_day_*`, `seller_new_listing`, `price_drop`, `promotional`, `marketing`. Server defaults Push: false, but iOS `seededDefaultRows()` sets `pushEnabled: true` for all types including promo when the server list is empty. Global “Push notifications” toggle turns on every non-critical row with **no marketing-consent sentence**.
- Remediation: Separate marketing consent copy + checkbox before any promotional APNs; keep server default push off; stop seeding `pushEnabled: true` for promo types.
- Confidence: 8

### [ASR-4.9.branding] Apple Pay button / mark HIG
- Status: FAIL
- Severity: major
- Notarization: yes
- Rule: Apps using Apple Pay must use Apple Pay branding and UI elements correctly per Apple Pay Marketing Guidelines and HIG.
- Evidence: No `PayWithApplePayButton` / `PKPaymentButton`. Custom gold CTAs with `systemImage: "apple.logo"` labeled “Buy now … with Apple Pay” / “Pay with Apple Pay” (`ListingDetailView.swift`, `MyOrdersView.swift`). Stripe PaymentSheet can show the system sheet; the **pre-sheet** buttons are unofficial lookalikes.
- Remediation: Use `PayWithApplePayButton` (or PaymentSheet’s Apple Pay only, with a generic “Pay” CTA). Do not compose `apple.logo` + “Apple Pay” as a custom button.
- Confidence: 8

#### RISK

### [ASR-4.9.recur.term] Recurring Apple Pay — renewal length + until canceled
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Apps using Apple Pay for recurring payments must disclose the length of the renewal term and that it will continue until canceled.
- Evidence: Digital subs are StoreKit-off. Recurring **jobs** charge per visit via PaymentSheet / off-session retry. Frequency is shown on an existing contract; copy does **not** say “continues until canceled” at first Apple Pay. No Apple Pay Recurring Payments API in `RailACheckout`.
- Remediation: If any saved Apple Pay PM auto-charges visits, disclose interval + “continues until canceled” on the first authorization screen.
- Confidence: 6

### [ASR-4.9.recur.provided] Recurring Apple Pay — what each period provides
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Disclose what will be provided during each period.
- Evidence: Recurring UI describes visits/instances. Not shown as Apple Pay recurring-enrollment copy before PaymentSheet.
- Remediation: On first Apple Pay for a recurring schedule, state that each period is one service visit at the listed rate, held in escrow.
- Confidence: 6

### [ASR-4.9.recur.charges] Recurring Apple Pay — actual charges
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Disclose the actual charges that will be billed.
- Evidence: Contract rate is visible. Auto-retry CreatePayment can charge a saved method without a new sheet.
- Remediation: Before saving Apple Pay for recurring visits, show the per-visit amount (and that retries may bill that amount).
- Confidence: 6

### [ASR-4.9.recur.cancel] Recurring Apple Pay — how to cancel
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Disclose how to cancel.
- Evidence: In-app Cancel schedule exists (`ContractDetailView`, `RecurringJobsView`). That copy is on the contract, not guaranteed adjacent to the Apple Pay CTA.
- Remediation: Put cancel path next to the first Apple Pay authorization for recurring work.
- Confidence: 6

#### GAP

### [ASR-4.4] Extensions (WidgetKit / Live Activities / controls)
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: Apps containing extensions must follow extension docs; disclose available extensions in marketing text; extensions may not include marketing, advertising, or IAP.
- Evidence: `ios/NoMarkupWidget/` — ActiveBids, NextClosing, Auction Live Activity, iOS 18 Control Center. No ads/IAP in the extension. In-repo ASC notes do **not** disclose widgets/Live Activities/Control Center.
- Remediation: Add Widget / Live Activity / Control Center lines to App Store description + Review Notes; add Account help for adding widgets.
- Confidence: 8

**Design PASSes of note:** ASR-4.2 (native TabView, not a website wrapper), ASR-4.8 (SIWA equivalent), ASR-4.9.info (material purchase info before sale), ASR-4.5.4.required (push not required for core use).

---

### 5. Legal

#### Blocker FAIL

### [ASR-PRE-04] Full access / demo account for account features
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Provide App Review full access; for account-based features supply an active demo account or fully-featured demo mode.
- Evidence: Notes list `customer@nomarkup.com` / `provider@nomarkup.com`. Password is seed/`SEED_PASSWORD` only — not in git, **not placed in ASC**. Review host seed not verified.
- Remediation: Seed review API, put password only in ASC Password field, paste notes, confirm login on the review host before submit.
- Confidence: 8

### [ASR-PRE-05] Backend services live during review
- Status: FAIL
- Severity: blocker
- Notarization: no
- Rule: Backend services must be live and accessible during review.
- Evidence: Release API `https://api.no-markup.com`. Provisioning checklist **NOT YET PROVISIONED**. Same fact pattern as ASR-BYS.3.
- Remediation: Provision production/review stack, apply seed, health-check from the public internet for the review window.
- Confidence: 9

#### Major FAIL

### [ASR-PRE-02] Complete and accurate App Store metadata
- Status: FAIL
- Severity: major
- Notarization: no
- Rule: Ensure all app information and metadata is complete and accurate.
- Evidence: Drafts in `asc-packaging-checklist.md`. ASC app record, screenshots, nutrition labels, age rating **not entered**.
- Remediation: Create ASC record; enter name/subtitle/description/keywords/categories; upload 6.9″ + 13″ shots; complete age rating + App Privacy labels.
- Confidence: 9

### [ASR-PRE-03] Keep App Review contact information updated
- Status: FAIL
- Severity: major
- Notarization: no
- Rule: Keep contact information updated so App Review can reach the developer.
- Evidence: Intended contact `support@no-markup.com`. ASC phone/email marked `[~]`. No evidence those fields are live in ASC.
- Remediation: Enter monitored App Review email + phone in ASC; staff the inbox during review.
- Confidence: 8

#### RISK

### [ASR-5.0] Comply with law; no criminal facilitation
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Apps must comply with all legal requirements in any location where they are made available.
- Evidence: US storefront; 18+ gate; community guidelines ban weapons/controlled substances. BNPL/insurance/advances/legal vertical exist in binary but are intended server-flagged off. No counsel memo in tree.
- Remediation: Keep regulated flags **off**; obtain counsel sign-off before enabling insurance/lending/BNPL/legal services.
- Confidence: 7

### [ASR-5.1.1.ix] Regulated fields submitted by legal entity
- Status: RISK
- Severity: blocker
- Notarization: yes
- Rule: Highly regulated services must be submitted by the legal entity providing them, not an individual.
- Evidence: Product includes escrow/Stripe Connect plus flag-gated BNPL, working capital, insurance, legal services. `iOSHardOffKeys = []`. No legal-entity enrollment or licenses in repo. Cannabis not offered.
- Remediation: Enroll Apple Developer as the operating **organization**; keep money/regulated flags off until licenses.
- Confidence: 8

### [ASR-5.2.1] No unlicensed third-party IP; submitter owns rights
- Status: RISK
- Severity: blocker
- Notarization: no
- Rule: Don’t use protected third-party material without permission; submitter owns or has licensed the IP.
- Evidence: Brand “NoMarkup”; no copycat Apple naming found. **Submitter legal entity vs individual not evidenced** in repo. UGC ToS grant present (`web/src/app/(public)/terms/page.tsx` §4).
- Remediation: Submit under the company that owns the mark; complete trademark clearance.
- Confidence: 6

#### GAP

### [ASR-5.1.1.i] Privacy policy in ASC and in-app
- Status: GAP
- Severity: blocker
- Notarization: yes
- Rule: Link privacy policy in ASC and in-app; policy must state collection/uses, third-party equal protection, and retention/deletion/revocation.
- Evidence: **In-app exists:** `AppConfig.privacyURL` = `https://no-markup.com/privacy`; Account, Login, AccountDeletion links. Page covers collection, uses, Stripe/Mapbox/Sentry/OAuth, 30-day deletion. **Missing:** explicit “third parties provide the same or equal protection” sentence. **ASC Privacy Policy URL not entered.** July 26 missing-route finding is **fixed** in code.
- Remediation: Add Apple equal-protection language to `/privacy`; set ASC Privacy Policy URL; confirm the live zone serves the Next route.
- Confidence: 9

### [ASR-PRE-01] Test for crashes and bugs before submission
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Test the app for crashes and bugs before submission.
- Evidence: Simulator/UITest walks exist. Human device matrix unsigned.
- Remediation: Complete and sign the device-smoke matrix before submit.
- Confidence: 8

### [ASR-PRE-06] Review notes for non-obvious features and IAP
- Status: GAP
- Severity: major
- Notarization: no
- Rule: Include detailed explanations of non-obvious features and in-app purchases in App Review notes.
- Evidence: Paste-ready notes cover dual-rail Stripe 3.1.3(e), StoreKit off, regulated flags off, SIWA, deletion. Not pasted into ASC.
- Remediation: Paste the ASC block; attach license docs only if regulated flags will be on (they should stay off).
- Confidence: 9

### [ASR-5.6.2] Accurate, current developer identity
- Status: GAP
- Severity: major
- Notarization: yes
- Rule: Representation of developer/business must be accurate, truthful, up-to-date.
- Evidence: Public identity `NoMarkup`, `support@no-markup.com`. ASC seller/legal name/phone **not filled**. Legal entity name not in repo.
- Remediation: Put legal seller name, org enrollment, and live support contacts in ASC.
- Confidence: 8

Advisory GAPs: **ASR-5.6.4** (quality dashboards post-launch), **ASR-POST-01** through **ASR-POST-07** (no ASC submission yet — operational process only).

**Legal PASSes of note:** ASR-5.1.1.v (account deletion), ASR-5.1.2.i (no tracking / no ATT needed), ASR-5.1.5 (When-In-Use location only), ASR-5.1.1.ii–iv (purpose strings, pickers, permission alternatives).

---

## Pre-submit operational checklist

| ID | Rule | Status | Notes |
|----|------|--------|-------|
| **ASR-PRE-01** | Test for crashes/bugs | **GAP** | Simulator walks exist; device-smoke matrix unsigned |
| **ASR-PRE-02** | Complete accurate metadata | **FAIL** | No ASC app record / screenshots / nutrition labels |
| **ASR-PRE-03** | App Review contact current | **FAIL** | Intended `support@no-markup.com`; not entered in ASC |
| **ASR-PRE-04** | Demo account / full access | **FAIL** | Seed emails documented; password not in ASC; host unproven |
| **ASR-PRE-05** | Backend live during review | **FAIL** | `api.no-markup.com` not provisioned (`DEPLOY_PROVISIONED`) |
| **ASR-PRE-06** | Review notes for non-obvious / IAP | **GAP** | Paste block ready; not in ASC |
| **ASR-PRE-07** | Follow Apple developer/design/brand docs | **PASS** | SIWA, PaymentSheet, SFSafariViewController; residual branding on custom Apple Pay CTAs (see 4.9.branding) |
| **ASR-PRE-08** | App remains functional and supported | **PASS** | Active monorepo + support page; not yet on store |

---

## Registry coverage

| Section | Registry items | Applicable scored | PASS | FAIL | RISK | GAP | N/A |
|---------|----------------|-------------------|------|------|------|-----|-----|
| Safety (`01-safety.md`) | 52 | 36 | 26 | 3 | 5 | 3 | 16 |
| Performance (`02-performance.md`) | 99 | 57 | 38 | 1 | 1 | 17 | 42 |
| Business (`03-business.md`) | 80 | 61 | 54 | 3 | 3 | 1 | 19 |
| Design (`04-design.md`) | 70 | 28 | 21 | 2 | 4 | 1 | 42 |
| Legal (`05-legal.md`) | 66 | 47 | 28 | 4 | 3 | 12 | 19 |
| **Total** | **367** | **229** | **167** | **13** | **16** | **34** | **138** |

All five sections run. Scope: full. Notarization filter: off.

### PASS appendix (IDs only)

- **Safety (26):** ASR-1.1.1, 1.1.2.a, 1.1.2.b, 1.1.3.a, 1.1.3.b, 1.1.5, 1.1.6.a, 1.1.6.b, 1.1.7, 1.2.a, 1.2.c, 1.2.d, 1.2.e, 1.2.g, 1.2.1.a, 1.2.1.b, 1.2.1.c, 1.4.0, 1.4.3.a, 1.4.4.a, 1.4.4.b, 1.4.5, 1.5.a, 1.5.b, 1.6
- **Performance (38):** ASR-2.1.a.4, 2.1.b.1, 2.3.1.b, 2.3.2.a–c, 2.3.4.a–b, 2.3.6.b, 2.3.7.b, 2.3.7.e, 2.3.8.a–c, 2.3.9.a, 2.3.10.a, 2.3.13.a–c, 2.4.1, 2.4.2.a–b, 2.4.4, 2.5.1.a–b, 2.5.2.a–c, 2.5.3.a–b, 2.5.8, 2.5.9, 2.5.13.a–b, 2.5.14, 2.5.15, 2.5.16.a–b
- **Business (54):** ASR-3.0.2, 3.0.3, 3.1.1.1–7, 3.1.1.9–12, 3.1.1.a.1–6, 3.1.2.1, 3.1.2.a.1–11, 3.1.2.b.1–2, 3.1.2.c.1–2, 3.1.3.1–2, 3.1.3.d.1–2, 3.1.3.e.1, 3.1.4.1–3, 3.2.1.i–iv, 3.2.1.vii, 3.2.2.i, 3.2.2.v, 3.2.2.vii, 3.2.2.viii.1–2, 3.2.2.x
- **Design (21):** ASR-4.1.a–c, 4.2, 4.2.media, 4.2.2, 4.2.3.i–ii, 4.3.a–b, 4.5.1, 4.5.3.spam, 4.5.4.required, 4.5.4.sensitive, 4.5.6.use, 4.5.6.restrict, 4.8, 4.8.equiv.data, 4.8.equiv.email_privacy, 4.8.equiv.ads, 4.9.info
- **Legal (28):** ASR-PRE-07, PRE-08, 5.1, 5.1.1.ii–viii, 5.1.1.x, 5.1.2.i–vii, 5.1.5, 5.2, 5.2.2–3, 5.2.4.a–b, 5.2.5, 5.6, 5.6.1, 5.6.3

---

## Remediation plan (PR-sized; not implemented)

Readiness is **NOT READY**. Grouped workstreams. Prefer &lt;400 LOC per PR.

### Payments (code + flags)

| PR | Scope | Clears |
|----|-------|--------|
| **P1** | Add `customer_bnpl`, `working_capital`, `per_job_insurance`, `insurance_competition`, `legal_services`, `instant_payout`, `lead_gen` to `FeatureFlags.iOSHardOffKeys` for the v1 binary. Hide purchase CTAs (keep diagnostic status if needed). | ASR-3.2.1.viii, 3.2.1.v, 2.3.1.a.1, 5.1.1.ix |
| **P2** | Ops/migration: set those flag rows `enabled=false` on review/prod (do not rely on seed `060` true). Document in review notes. | Same + PRE-06 |
| **P3** (later, if enabling loans) | Decode/show APR, term, due date, all-in cap ≤36%, term &gt;60 days — **or** keep off and counsel-label as commercial MCA. | 3.2.2.ix.1–3 |
| **P4** (later) | iOS ignore web Stripe Pro entitlements **or** ship StoreKit for the same SKUs. | 3.1.3.b.1 |
| **P5** | Recurring-job Apple Pay disclosures (interval, until canceled, per-visit amount, cancel path) adjacent to first charge. | 4.9.recur.* |

### Privacy / age

| PR | Scope | Clears |
|----|-------|--------|
| **P6** | Age gate fail-**closed** on network error; require declared age before UGC catalog (or guest browse only of in-rating public data). | 1.2.1.d, 1.4.3.b |
| **P7** | Add equal-protection sentence to `web/src/app/(public)/privacy/page.tsx`. | 5.1.1.i (policy text) |

### UGC moderation

| PR | Scope | Clears |
|----|-------|--------|
| **P8** | `POST /api/v1/jobs/{id}/report` + iOS report control on `JobDetailView` (and poster report). | 1.2.b |
| **P9** | Cannabis/THC/paraphernalia in `contentfilter`; keep tobacco banned. | 1.4.3.c |
| **P10** (later) | Image NSFW/CSAM scan on uploads. | 1.1.4, 1.2.f |

### Design / notifications

| PR | Scope | Clears |
|----|-------|--------|
| **P11** | Marketing-push consent checkbox; do not seed promo `pushEnabled: true`; do not fold marketing into the global push switch. | 4.5.4.marketing |
| **P12** | Replace custom `apple.logo` “Pay with Apple Pay” buttons with `PayWithApplePayButton` or generic Pay + PaymentSheet. | 4.9.branding |

### Metadata / founder-ops (not code)

| Item | Clears |
|------|--------|
| Team + App ID + SIWA capability; archive upload | signing / 4.8 already coded |
| ASC record: name, subtitle, description, keywords, Shopping+Lifestyle | PRE-02, 2.3.* |
| Screenshots 6.9″ + 13″ (fictional accounts) | 2.3.3, 2.3.9.b |
| Privacy Policy URL + nutrition labels | 5.1.1.i |
| Paste `app-review-notes.md`; demo password in ASC only | PRE-04, PRE-06, 3.0.1 |
| Live `https://api.no-markup.com` + `https://no-markup.com/{privacy,terms,support}` | PRE-05, BYS.3, 2.1.a.1 |
| Device-smoke sign-off | PRE-01, 2.1.a.2 |
| Organization enrollment (not Individual) | 5.1.1.ix, 5.6.2 |
| Disclose widgets / Live Activities in description | 4.4, 2.5.1.c |

Do **not** enable StoreKit or regulated flags for this submit.

---

## Self-check

1. Every FAIL cites an ASR-ID present in a registry file (verified by grep): ASR-BYS.3, ASR-1.2.b, ASR-1.2.1.d, ASR-2.1.a.1, ASR-3.2.1.viii, ASR-3.2.2.ix.1, ASR-3.2.2.ix.2, ASR-PRE-02, ASR-PRE-03, ASR-PRE-04, ASR-PRE-05, ASR-4.5.4.marketing, ASR-4.9.branding.
2. PASS items have concrete evidence in section agent notes (paths/symbols); none scored PASS with empty Evidence.
3. Readiness **NOT READY** because blocker FAIL count &gt; 0.
4. Disclaimer present below.

---

## Disclaimer

This audit maps product evidence to Apple’s published App Store Review Guidelines.
It is not legal advice and does not guarantee App Review approval. Guidelines are a
living document; re-verify against the canonical URL before submission.
