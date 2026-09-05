# App Store Compliance Report

- **Target**: `/Users/nuclearisotope/Projects/Personal/NoMarkup`
- **Date**: 2026-07-26
- **Guidelines snapshot**: 2026-06-08 ([App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/))
- **Platform / posture**: **web** (Next.js 15 + Go/Rust) · App Store packaging readiness (gap analysis — no native iOS binary)
- **Submission readiness**: **NOT READY**

> **Framing:** NoMarkup is a production-grade **web marketplace** today. Apple App Store payment and binary rules do **not** apply until an iOS binary is submitted. This audit scores **(A)** current web product quality against analogous guideline intent and **(B)** readiness if the product is packaged for the App Store. Packaging-only findings are labeled.

---

## Applicability profile

| Flag | Value | Evidence |
|------|-------|----------|
| `always` | true | Any future App Store / notarization packaging |
| `ugc` | true | Jobs, listings, chat, reviews, photos |
| `social` | true | Messaging, follows, profiles |
| `location` | true | Mapbox, PostGIS, market geolocation, GPS check-in |
| `account` | true | Email/password + OAuth accounts |
| `third_party_login` | true | Google, Apple, Facebook OAuth |
| `physical_goods` | true | Goods marketplace + local pickup + escrow |
| `p2p` | true | Real-world job services (1:1 awarded provider) |
| `multiplatform` | true | Web today; future native clients |
| `subscriptions` / `iap` | true | Provider/customer **Stripe** tiers unlock digital features (analytics, featured placement, bid limits, etc.) |
| `insurance` | true | Per-job insurance (Stripe PI) |
| `financial` | true | Working capital advances, BNPL, instant payout |
| `regulated` | true | Insurance, advances, legal-services vertical (flag-gated) |
| `recording` | partial | Camera/mic disabled via Permissions-Policy; file photo pickers |
| `metadata` | true (future ASC) | No ASC package in repo |
| `us_storefront` | true (assumed) | King County / US launch market |
| `kids_*`, `medical`, `health`, `crypto`, `nft`, `loot_boxes`, `ads`, `gambling`, `vpn`, `mdm`, `mac`, `arkit`, `extensions`, `widgets`, `mini_apps` | **false** | Not in product scope |

**Platform:** No `Info.plist` / Xcode / Capacitor / RN app target. Service worker is a kill-switch (`web/public/sw.js`).

---

## Executive summary

| Metric | Count (merged, material findings) |
|--------|-----------------------------------|
| **Blocker FAIL** | **12** |
| **Major FAIL** | **5** |
| **RISK** | **14** |
| **GAP** (packaging / evidence) | **40+** |
| **PASS** (verified applicable) | **~70** across sections |
| **N/A** | Large (kids, medical, crypto, gambling, VPN, MDM, …) |

### Top 5 actions before any App Store packaging

1. **Ship `/privacy` + real `/terms`** (and Community Guidelines); fix ToS `body_url` that points at broken `/legal/terms` while `/legal` is the attorney marketplace. Hard fail **ASR-5.1.1.i**.
2. **UGC safety pack**: pre-post content filters (**ASR-1.2.a**), complete report surfaces including listings (**ASR-1.2.b**), expand block enforcement, prohibited-item bans (firearms/tobacco/controlled substances).
3. **Split payment rails for iOS**: marketplace GMV + real-world services stay **Stripe (3.1.3.e PASS)**; digital subscription tiers (**analytics, featured placement, bid limits, …**) must move to **StoreKit IAP** (**ASR-3.1.1.1 FAIL** for packaging).
4. **Regulated features**: Organization Apple Developer account + licenses for insurance/advances/BNPL **or** flag them **off** in the iOS binary (**ASR-3.2.1.viii / 5.1.1.ix RISK**).
5. **App Review packaging**: Support URL/contact, demo accounts, live staging backend, ASC metadata/screenshots, review notes for flags/escrow/geo markets.

### What is already strong

- **Physical goods & offline services via Stripe Connect escrow** correctly avoid IAP (**ASR-3.1.3.e.1 PASS**).
- **Sign in with Apple** present alongside Google/Facebook + email (**ASR-4.8 PASS**).
- **Account deletion** + data export implemented (**ASR-5.1.1.v PASS**).
- **18+ age gate**, report/block foundations, secretbox PII encryption, guest browse of public catalog.
- Design substance is a real marketplace, not a brochure (**4.2 product content strong**; thin-WebView packaging remains a RISK).

---

## Findings

Findings ordered: **blocker FAIL → major FAIL → RISK → selected GAP**. PASS items summarized by section only.

### Blocker FAIL

#### [ASR-5.1.1.i] Privacy policy missing (ASC + in-app)

- Status: **FAIL**
- Severity: blocker
- Notarization: yes
- Rule: Privacy policy URL in App Store Connect and easily accessible in-app; must cover collection/use, third parties, retention/deletion.
- Evidence: No `web/src/app/**/privacy` route; launch checklist still open for `no-markup.com/privacy`; `/legal` is Legal Services marketplace, not documents; seeded ToS `body_url` = `/legal/terms` with no such page; no footer Privacy links under `web/src`.
- Remediation: Counsel-approved `/privacy` + `/terms`; footer, settings, registration links; ASC Privacy Policy URL; disclose Mapbox, Stripe, Sentry, OAuth, retention/deletion.
- Confidence: 10

#### [ASR-1.2.a] No pre-post UGC filter

- Status: **FAIL**
- Severity: blocker
- Notarization: no
- Rule: UGC apps must filter objectionable material from being posted.
- Evidence: Chat filters contact-info patterns only (`DetectContactInfo`); listing auto-hide is post-hoc after ≥3 reports; internal docs mark chat moderation / profanity classifier as partial/v2; no NSFW image filter on upload.
- Remediation: Keyword/ML filters on listings, jobs, reviews, chat, images before public visibility; reject/quarantine paths + tests.
- Confidence: 9

#### [ASR-1.2.b] Incomplete report + no timely-response process

- Status: **FAIL**
- Severity: blocker
- Notarization: no
- Rule: Report mechanism + timely responses to concerns.
- Evidence: Message report UI + admin `/admin/user-reports` exist; listing report **API** exists but E2E notes frontend “Report this listing” **not shipped**; jobs/profiles weaker; no moderation SLA/runbook.
- Remediation: Ship Report on listing/job/review/profile; staffed queue + SLA before App Review.
- Confidence: 9

#### [ASR-3.1.1.1] Digital feature unlock without IAP (packaging)

- Status: **FAIL** *(App Store packaging readiness; N/A for pure web distribution)*
- Severity: blocker
- Notarization: no
- Rule: Unlocking features/functionality within the app must use In-App Purchase.
- Evidence: Subscription tiers gate `FeeDiscountPercentage`, `MaxActiveBids`, `FeaturedPlacement`, `AnalyticsAccess`, `PrioritySupport`, `VerifiedBadgeBoost`, `InstantEnabled` (`services/payment/internal/domain/subscription.go`); billed via Stripe (`CreateStripeSubscription`); UI `settings/subscription`, `SubscriptionTierCard.tsx`; **no StoreKit** in monorepo.
- Remediation: StoreKit 2 auto-renewable group for digital tiers on iOS; receipt/ASN V2 → same `CheckFeatureAccess`; keep Stripe for web only.
- Confidence: 10

#### [ASR-3.1.1.2] Alternate payment unlocks digital features (packaging)

- Status: **FAIL** *(packaging)*
- Severity: blocker
- Notarization: no
- Rule: No own mechanisms (external payment, keys, etc.) to unlock digital functionality.
- Evidence: Stripe webhook → subscription row entitlements; admin grant path also unlocks without Apple.
- Remediation: iOS entitlements from StoreKit only (admin comp with audit exception).
- Confidence: 10

#### [ASR-3.1.1.5] No restore purchases (packaging)

- Status: **FAIL** *(packaging)*
- Severity: blocker
- Notarization: no
- Rule: Restore mechanism for restorable purchases.
- Evidence: No StoreKit restore / `Transaction.currentEntitlements`.
- Remediation: Restore Purchases control + StoreKit 2 entitlement sync.
- Confidence: 10

#### [ASR-3.1.3.b.1] Multiplatform digital items without IAP parity (packaging)

- Status: **FAIL** *(packaging)*
- Severity: blocker
- Notarization: no
- Rule: Multiplatform apps may honor web-acquired digital content only if also offered as IAP in-app.
- Evidence: Web Stripe tiers unlock features usable on any authenticated client; no IAP catalog.
- Remediation: IAP parity for every digital tier sold on web that works on iOS.
- Confidence: 10

#### [ASR-2.1.a.1] Placeholder / temporary content

- Status: **FAIL**
- Severity: blocker
- Notarization: yes
- Rule: Final versions; scrub placeholders; functional URLs.
- Evidence: Insurance claim form uses object URL placeholders (`InsuranceClaimForm.tsx` “For now, we create object URLs as placeholders”); admin payments “UI preview only”; deploy unprovisioned (`DEPLOY_PROVISIONED`); no ASC Support/Marketing URLs.
- Remediation: Real S3 evidence upload; remove/flag preview UIs; live Support URL; provision review backend.
- Confidence: 9

#### [ASR-2.1.a.4] Incomplete product / technical problems

- Status: **FAIL**
- Severity: blocker
- Notarization: yes
- Rule: Incomplete apps / obvious technical problems rejected.
- Evidence: Insurance evidence incomplete; open money-integrity tracker items (MON-14+ in `docs/planning/adversarial-action-tracker.md`); no native binary.
- Remediation: Close P0 money races; finish insurance uploads; complete packaging shell.
- Confidence: 8

#### [ASR-2.3.1.a.3] Misleading marketing vs launch readiness

- Status: **FAIL**
- Severity: blocker
- Notarization: yes
- Rule: Do not promote content/services not actually offered.
- Evidence: Product marketed as full escrow marketplace while production provisioning and money integrity remain open; feature-flagged verticals may be off.
- Remediation: Align public claims with enabled production flags and closed P0s.
- Confidence: 7

#### [ASR-3.1.2.a.3] Subscriptions across devices (packaging)

- Status: **FAIL** *(packaging)*
- Severity: blocker
- Notarization: no
- Rule: Subscriptions available across user’s devices where app is available.
- Evidence: Account-bound Stripe OK for web multi-device; no Apple-ID IAP restore path for App Store compliance.
- Remediation: Account linking + StoreKit restore on all iOS devices.
- Confidence: 8

#### [ASR-3.1.2.1] Auto-renewable subscriptions not via IAP (packaging)

- Status: **FAIL** *(packaging)*
- Severity: major (registry) / blocker with 3.1.1
- Notarization: no
- Rule: Auto-renewable subscriptions via IAP and 3.1.2 rules.
- Evidence: Monthly/annual Stripe Billing only.
- Remediation: ASC subscription group + StoreKit.
- Confidence: 10

### Major FAIL

#### [ASR-1.2.d] / [ASR-1.5.a] / [ASR-BYS.1] No published developer contact / Support URL

- Status: **FAIL**
- Severity: major
- Notarization: yes (1.5.a)
- Rule: UGC apps and Support URL must provide easy contact; keep review contact current.
- Evidence: No `/contact` or `/support` route; launch checklist `support@no-markup.com` unchecked; “contact support” strings without path.
- Remediation: Public Support URL + in-app Help; monitored email for App Review.
- Confidence: 9

#### [ASR-2.1.a.2] On-device testing incomplete for submission

- Status: **FAIL**
- Severity: major
- Notarization: yes
- Rule: Test on-device for bugs/stability before submission.
- Evidence: Strong Vitest; Playwright Chromium smoke only (`E2E.md`); no iOS device matrix.
- Remediation: Live-stack dogfood + iOS device plan before packaging.
- Confidence: 8

### Critical RISK (payments / privacy / safety)

#### [ASR-3.2.1.viii] Financial services licensing (advances / BNPL)

- Status: **RISK**
- Severity: blocker
- Notarization: no
- Rule: Financial trading/investing/money management submitted by institution with licenses.
- Evidence: Working capital advances (APR, origination); BNPL installments; Stripe Connect MTL covers escrow facilitation, not automatically lending.
- Remediation: Legal memo + licenses / lender-of-record **or** disable advances/BNPL in iOS binary.
- Confidence: 8

#### [ASR-3.2.1.v] Insurance compliance posture

- Status: **RISK**
- Severity: major–blocker
- Notarization: no
- Rule: Insurance apps free, region-compliant, cannot use IAP.
- Evidence: Embedded per-job insurance via Stripe PI (non-IAP correct); competition flag-off; licensing docs thin.
- Remediation: Free marketplace positioning; underwriter/producer docs; geo-fence; non-IAP premiums only.
- Confidence: 7

#### [ASR-5.1.1.ix] Regulated fields → legal entity submitter

- Status: **RISK**
- Severity: blocker
- Notarization: yes
- Rule: Regulated services submitted by legal entity providing them.
- Evidence: Insurance, advances, legal vertical; launch checklist entity/licenses unchecked.
- Remediation: Organization Apple Developer Program; attach licenses; geo-restrict.
- Confidence: 9

#### [ASR-1.1.3.b] / [ASR-1.4.3.c] Marketplace can facilitate firearms / tobacco / controlled substances

- Status: **RISK**
- Severity: blocker
- Notarization: no
- Rule: Do not facilitate purchase of firearms/ammo; no tobacco/controlled substance sale (except licensed exceptions).
- Evidence: Open goods categories + free-text; prohibited enforcement mostly report-reactive; age-21 alcohol/tobacco noted as future in compliance code comments.
- Remediation: Create-time blocklists + category bans; seller policy; geo/license exceptions only if intentional.
- Confidence: 7

#### [ASR-1.2.c] Block incomplete across surfaces

- Status: **RISK**
- Severity: blocker
- Notarization: no
- Rule: Ability to block abusive users.
- Evidence: Block API + chat UI exist; chat block check can fail open; listing bid path does not clearly enforce `user_blocks`.
- Remediation: Fail closed; enforce on bids/offers/follows/channels.
- Confidence: 8

#### [ASR-1.2.g] / ToS body missing

- Status: **RISK**
- Severity: blocker
- Notarization: no
- Rule: Developer removes violating content under ToS/community standards.
- Evidence: Admin suspend/report tools exist; public ToS/community pages missing; `body_url` broken.
- Remediation: Ship ToS + Community Guidelines; keep admin takedown.
- Confidence: 8

#### [ASR-1.6] Data security — mesh / deploy gaps

- Status: **RISK**
- Severity: blocker
- Notarization: yes
- Rule: Appropriate security for user information.
- Evidence: Strong: JWT RS256, argon2id, secretbox PII, parameterized SQL. Gaps: plaintext gRPC mesh (documented), production not fully provisioned.
- Remediation: mTLS target; Vault/prod secrets; pen-test money/PII.
- Confidence: 7

#### [ASR-4.2] Thin WebView packaging risk

- Status: **RISK**
- Severity: blocker (registry)
- Notarization: no
- Rule: Elevate beyond repackaged website.
- Evidence: Product is rich; no native shell — pure WKWebView of site is classic rejection.
- Remediation: Real hybrid/native UX beyond Safari wrapper.
- Confidence: 8

#### [ASR-2.3.1.a.1] Feature flags as dormant features

- Status: **RISK**
- Severity: blocker
- Notarization: yes
- Rule: No hidden/dormant/undocumented features.
- Evidence: Many flags (`customer_bnpl`, `working_capital`, `legal_services`, `insurance_competition`, …); only subset enforced on backend.
- Remediation: Review notes map every flag; ship review build with intended features only.
- Confidence: 7

#### [ASR-3.1.3.1] External digital purchase CTAs (non-US)

- Status: **RISK**
- Severity: blocker (non-US)
- Notarization: no
- Rule: No steering to non-IAP digital purchase except US / entitled regions.
- Evidence: Web Stripe subscribe UX; iOS shell linking “buy on web” for digital tiers fails outside US without entitlement.
- Remediation: Digital → IAP on iOS; storefront-gate any external links.
- Confidence: 8

### Selected GAP (packaging / submission ops)

| ID | Issue |
|----|--------|
| ASR-BYS.2 / PRE-04 | Demo accounts exist in seed; no ASC Review Notes / MFA-safe review package |
| ASR-BYS.3 / PRE-05 | Backend not proven live for App Review (`DEPLOY_PROVISIONED`) |
| ASR-2.1.b.1 | No StoreKit IAP completeness |
| ASR-2.3.* cluster | No ASC screenshots, age rating answers, privacy nutrition labels |
| ASR-4.9.info | Apple Pay domain association missing; mainly $1 setup path |
| ASR-4.5.4 push packaging | FCM path; web SW kill-switch; no native APNs app |
| ASR-5.1.5 | Location purpose UX incomplete (check-in); native plist TBD |
| ASR-5.1.1.ii | Cookie analytics default on; Sentry not bound to consent |
| ASR-5.1.1.v partial | No in-app social account disconnect UI |
| ASR-PRE-01–08 | Operational submission checklist largely open |

### PASS highlights (not exhaustive)

| Area | Examples |
|------|----------|
| **Business 3.1.3(e)** | Physical goods + offline services **must** use non-IAP — Stripe Connect escrow **PASS** |
| **Design 4.8** | Sign in with Apple + name/email scopes + email/password alternative **PASS** |
| **Legal 5.1.1.v** | Account deletion + export + 30-day grace **PASS** |
| **Safety 1.1 first-party** | No hate/violence/prank utilities in first-party product **PASS** |
| **Safety 1.3** | Not Kids Category; 18+ gate **N/A/PASS** |
| **Design 4.1 / 4.3** | Original brand; single-app geo filter not city spam **PASS** |
| **Performance 2.5.14** | Camera/mic blocked; no silent recording; Replay off **PASS** |
| **Business 3.2.2.x** | No forced App Store rating walls **PASS** |

---

## Pre-submit operational checklist

| ID | Status | Notes |
|----|--------|-------|
| ASR-PRE-01 Test for crashes | **GAP** | Web tests strong; no iOS matrix; full dogfood manual |
| ASR-PRE-02 Metadata complete | **GAP** | No ASC package |
| ASR-PRE-03 Contact current | **GAP** | Support email unchecked |
| ASR-PRE-04 Demo account | **GAP** | Seed personas exist; not packaged for Review |
| ASR-PRE-05 Backend live | **RISK** | Deploy not provisioned |
| ASR-PRE-06 Review notes | **GAP** | Need escrow, flags, regulated features narrative |
| ASR-PRE-07 HIG / brand | **GAP** | Web-first; native shell TBD |
| ASR-PRE-08 Active support | **GAP** | Support channel incomplete |

---

## Registry coverage

| Section | Registry | Result |
|---------|----------|--------|
| 1 Safety | `01-safety.md` | 5 FAIL · 5 RISK · 4 GAP · 18 PASS (≈32 applicable) |
| 2 Performance | `02-performance.md` | 4 FAIL · 3 RISK · ~27 GAP · ~14 PASS |
| 3 Business | `03-business.md` | 6 packaging FAIL · 4 RISK · ~18 PASS (3.1.3e strong) |
| 4 Design | `04-design.md` | 0 FAIL · 3 RISK · 2 GAP · 22 PASS |
| 5 Legal + PRE/POST | `05-legal.md` | 4 FAIL · 6 RISK · 16 GAP · ~18 PASS |

**Sections run:** full (safety, performance, business, design, legal).  
**Method:** five parallel section agents; orchestrator merge + ASR-ID existence check.

---

## Remediation workstreams (PR-sized plan)

Do **not** implement in this audit. Suggested order for packaging readiness:

| Workstream | Priority | Scope |
|------------|----------|-------|
| **Privacy & legal docs** | P0 | `/privacy`, `/terms`, Community Guidelines, fix ToS body_url, footer links, ASC privacy URL |
| **UGC safety** | P0 | Pre-post filters; report UI completeness; block fail-closed; prohibited goods |
| **Payments dual-rail** | P0 (iOS only) | StoreKit for digital tiers; Stripe remains for GMV/insurance/payouts |
| **Regulated features** | P0 | Entity + licenses **or** flag-off advances/BNPL/insurance competition/legal in iOS |
| **Contact & Review packaging** | P1 | Support URL, demo accounts, review notes, flag map, staging uptime |
| **Completeness** | P1 | Insurance evidence upload; close money P0 tracker rows; production provision |
| **Native shell** | P1 | Not thin WebView; SIWA parity; Apple Pay domain; APNs if claiming push |
| **Consent polish** | P2 | Analytics default opt-out; bind Sentry; location purpose copy; social unlink |

---

## Disclaimer

This audit maps product evidence to Apple’s published App Store Review Guidelines (registry snapshot **2026-06-08**). It is **not legal advice** and does **not** guarantee App Review approval. Guidelines are a living document; re-verify against the [canonical URL](https://developer.apple.com/app-store/review/guidelines/) before submission. Pure **web** distribution is not currently subject to App Store binary review; findings labeled **packaging** apply when an iOS binary is submitted.
