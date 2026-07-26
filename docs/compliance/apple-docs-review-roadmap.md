# Apple Documentation Review Roadmap — NoMarkup

**Purpose:** Ordered plan to review every Apple document that matters for shipping and maintaining NoMarkup (web + future iOS/iPad App Store binary).  
**Product:** Two-sided local marketplace — services reverse auction + goods forward auction, Stripe escrow, chat/UGC, maps, subscriptions (digital tiers), insurance/advances (regulated, flag-gated).  
**Last updated:** 2026-07-26  
**Companion artifacts:**

| Artifact | Role |
|----------|------|
| [app-store-review-2026-07-26.md](./app-store-review-2026-07-26.md) | Baseline ASR audit |
| [app-store-review-2026-07-26-remediated.md](./app-store-review-2026-07-26-remediated.md) | Post-remediation delta |
| [remediation-checklist.md](./remediation-checklist.md) | ASR ID status |
| [ios-payment-rails-design.md](./ios-payment-rails-design.md) | Dual-rail Stripe / StoreKit |
| [ios-mobile-web-readiness.md](./ios-mobile-web-readiness.md) | Safari / PWA mobile UX |
| [app-review-notes.md](./app-review-notes.md) | Demo accounts, flags, review narrative |
| Skill registries | `~/.grok/skills/app-store-compliance/references/` |

**How to use this roadmap**

1. Work **phase by phase** (do not skip Phase 0).  
2. For each row: read the linked Apple source → fill **Review log** (date, reviewer, 3–5 takeaways, product impact) → mark status.  
3. Status values: `todo` · `in_progress` · `done` · `n/a` · `blocked`.  
4. Prefer **current** Apple pages over memory; re-check after each major Xcode / iOS SDK release ([Documentation Updates](https://developer.apple.com/documentation/updates)).  
5. Policy text lives in **App Review Guidelines**; **how to implement** lives under [developer.apple.com/documentation](https://developer.apple.com/documentation/).

---

## Product → documentation map

Use this table to decide which phases apply if scope shrinks.

| NoMarkup surface | Apple docs cluster | ASR / guideline anchors |
|------------------|--------------------|-------------------------|
| App Store listing & review | Guidelines, ASC Help, metadata | 2.1–2.3, PRE, 5.6 |
| Physical goods + offline services payments | PassKit, Stripe (non-Apple), Apple Pay marketing | **3.1.3(e)**, 4.9 |
| Digital subscription tiers (analytics, featured, bid limits) | StoreKit 2, subscriptions, restore, ASN | **3.1.1**, **3.1.2**, multiplatform **3.1.3(b)** |
| Sign-in (email + Google/Apple/Facebook) | AuthenticationServices, Sign in with Apple | **4.8**, 5.1.1.v |
| Privacy policy, consent, analytics | Privacy best practices, ATT, App Privacy labels | **5.1**, 5.1.1–5.1.2 |
| Location (markets, maps, check-in) | Core Location, MapKit, HIG private data | **5.1.5**, 2.5.1 intended use |
| Photos / uploads (jobs, listings, claims) | PhotosUI, camera purpose strings | 5.1.1.iii, 2.5.14 |
| Chat + UGC + report/block | Guidelines 1.2; no special framework | **1.2**, 5.6 |
| Push notifications | UserNotifications, APNs | **4.5.4**, 2.5.4 |
| In-app web content | WebKit (if native shell) | **2.5.6**, **4.2** |
| Insurance / advances / BNPL | Guidelines 3.2 / 5.1.1.ix; legal counsel | **3.2.1.v**, **3.2.1.viii**, **5.1.1.ix** |
| iPhone + iPad UI | HIG, SwiftUI/UIKit, multiplatform Xcode | **4.x**, **2.4.1** |
| Packaging / public APIs only | Bundle resources, entitlements, public API rule | **2.5.1–2.5.2** |

---

## Phase overview

| Phase | Name | Goal | Est. effort | Depends on |
|-------|------|------|-------------|------------|
| **0** | Orientation | Know where policy vs API docs live | 0.5 day | — |
| **1** | Policy lock | Full ASR re-read against product | 1–2 days | Phase 0 |
| **2** | Design & mobile | HIG + iPhone/iPad behavior | 1–2 days | Phase 1 |
| **3** | Privacy & identity | Purpose strings, SIWA, consent, labels | 1–2 days | Phase 1 |
| **4** | Commerce rails | Apple Pay (physical) + StoreKit (digital) | 2–3 days | Phase 1, dual-rail doc |
| **5** | Platform & packaging | Public APIs, bundle, notifications, location, media | 2–3 days | Phase 3 |
| **6** | Review operations | ASC, TestFlight, demo, expedite/appeal | 1 day | Phases 1–5 |
| **7** | Regulated & optional | Insurance/lending, alt distribution, intents | 1–2 days + counsel | Product decision |
| **8** | Cadence | Re-review on SDK / guideline updates | Ongoing | All |

**Total first-pass review:** ~10–14 engineer-days (can parallelize 2–3 after Phase 1).

---

## Phase 0 — Orientation (hub literacy)

**Exit criteria:** Team can name the difference between Guidelines, HIG, Documentation, and ASC Help; bookmark set exists.

| # | Document | URL | Status | Reviewer | Date | Notes |
|---|----------|-----|--------|----------|------|-------|
| 0.1 | Apple Developer Documentation hub | https://developer.apple.com/documentation/ | **done** | Grok | 2026-07-26 | API reference home; see `review-logs/phase-0.md` |
| 0.2 | Documentation Updates (platform waves) | https://developer.apple.com/documentation/updates | **done** | Grok | 2026-07-26 | Track iOS 26 / Xcode 26 churn |
| 0.3 | Sample Code Library (index) | https://developer.apple.com/documentation/samplecode | **done** | Grok | 2026-07-26 | Use samples only when implementing Stage B |
| 0.4 | Internal: this roadmap + dual-rail + remediated audit | `docs/compliance/*` | **done** | Grok | 2026-07-26 | + launch-board.md |

**Review log (Phase 0):**

```
Date:
Reviewer:
Takeaways:
-
Product impact:
-
```

---

## Phase 1 — Policy lock (App Review Guidelines)

**Exit criteria:** Every applicable ASR cluster mapped to product behavior; open gaps listed with owner. Prefer re-running `/app-store-compliance` after material product changes.

**Primary source (single living document):**  
https://developer.apple.com/app-store/review/guidelines/

| # | Section | Focus for NoMarkup | Related internal | Status | Reviewer | Date |
|---|---------|-------------------|------------------|--------|----------|------|
| 1.1 | Introduction + Before You Submit | Demo accounts, backends live, third-party SDKs | `app-review-notes.md` | **done** | Grok | 2026-07-26 |
| 1.2 | **1 Safety** | UGC filter/report/block, weapons/tobacco, contact, data security | contentfilter, community guidelines | **done** | Grok | 2026-07-26 |
| 1.3 | **2 Performance** | Completeness, metadata, IPv6, public APIs, recording, ads N/A | launch checklist | **done** | Grok | 2026-07-26 |
| 1.4 | **3 Business** | **3.1.3(e)** Stripe GMV; **3.1.1/3.1.2** digital tiers IAP; multiplatform; insurance/financial | `ios-payment-rails-design.md` | **done** | Grok | 2026-07-26 |
| 1.5 | **4 Design** | Min functionality (not thin WebView), SIWA 4.8, Apple Pay 4.9, push 4.5.4 | mobile web readiness | **done** | Grok | 2026-07-26 |
| 1.6 | **5 Legal** | Privacy policy, account deletion, location, ATT, regulated entity, code of conduct | `/privacy`, deletion, OAuth unlink | **done** | Grok | 2026-07-26 |
| 1.7 | After You Submit | Appeals, bug-fix process | ops | **done** | Grok | 2026-07-26 |

Full write-up: [`review-logs/phase-1.md`](./review-logs/phase-1.md). Blockers: [`submission-blockers.md`](./submission-blockers.md).

**Supporting policy / program links (read once, bookmark):**

| # | Document | URL | Status |
|---|----------|-----|--------|
| 1.8 | Apple Developer Program License Agreement (esp. Schedule 2 subscriptions) | https://developer.apple.com/support/terms/ | todo |
| 1.9 | App Store Improvements / removals | https://developer.apple.com/support/app-store-improvements/ | todo |
| 1.10 | Offering account deletion | https://developer.apple.com/support/offering-account-deletion-in-your-app/ | todo |
| 1.11 | User privacy and data use (tracking) | https://developer.apple.com/app-store/user-privacy-and-data-use/ | todo |
| 1.12 | Kids apps / parental gates (confirm N/A — we are 18+) | https://developer.apple.com/app-store/kids-apps/ | todo |
| 1.13 | Reader apps external link (confirm N/A) | https://developer.apple.com/support/reader-apps/ | todo |
| 1.14 | Skill registries refresh if Apple “Last Updated” drifts | `~/.grok/skills/app-store-compliance/references/SOURCE.md` | todo |

**Phase 1 deliverable:** Short memo `docs/compliance/policy-review-notes-YYYY-MM-DD.md` (or update remediated audit) listing any new FAIL/RISK vs product.

---

## Phase 2 — Design & multi-device UX

**Exit criteria:** HIG checklist for core flows (browse → bid/buy → pay → chat → settings); iPhone + iPad patterns agreed for native and current web.

| # | Document | URL | Status | Reviewer | Date |
|---|----------|-----|--------|----------|------|
| 2.1 | Human Interface Guidelines (home) | https://developer.apple.com/design/human-interface-guidelines/ | todo | | |
| 2.2 | HIG — Foundations (layout, typography, color, accessibility) | same site / Foundations | todo | | |
| 2.3 | HIG — Patterns (navigation, sheets, search, feedback) | same | todo | | |
| 2.4 | HIG — Inputs & feedback; touch targets | same | todo | | |
| 2.5 | HIG — Privacy / accessing private data patterns | https://developer.apple.com/design/human-interface-guidelines/privacy | todo | | |
| 2.6 | Configuring a multiplatform app target | https://developer.apple.com/documentation/xcode/configuring-a-multiplatform-app-target | todo | | |
| 2.7 | SwiftUI (or UIKit if hybrid) landing | https://developer.apple.com/documentation/swiftui · https://developer.apple.com/documentation/uikit | todo | | |
| 2.8 | Internal mobile web readiness | `ios-mobile-web-readiness.md` | todo | | |

**Flows to re-walk against HIG (checklist):**

- [ ] Public: marketplace list, listing detail, job detail, map  
- [ ] Auth: login / register / SIWA  
- [ ] Customer: post job, bid/award, pay, chat, report  
- [ ] Seller/provider: list item, workspace check-in, payouts  
- [ ] Settings: privacy links, deletion, connected accounts, subscription  

**Phase 2 deliverable:** UX gap list (web vs future native); no requirement to implement native yet.

---

## Phase 3 — Privacy, security, and identity

**Exit criteria:** Purpose-string inventory drafted; SIWA requirements confirmed; App Privacy nutrition label worksheet started; consent model matches implementation.

| # | Document | URL | Maps to product | Status |
|---|----------|-----|-----------------|--------|
| 3.1 | Protecting the User’s Privacy | https://developer.apple.com/documentation/uikit/protecting_the_user_s_privacy | Consent, minimization | todo |
| 3.2 | Requesting access to protected resources (purpose strings) | Linked from 3.1 / Info.plist keys | Location, camera, photos, mic | todo |
| 3.3 | App Tracking Transparency | https://developer.apple.com/documentation/apptrackingtransparency | Only if cross-app tracking | todo |
| 3.4 | User privacy and data use (policy) | https://developer.apple.com/app-store/user-privacy-and-data-use/ | ASC privacy labels | todo |
| 3.5 | AuthenticationServices / Sign in with Apple | https://developer.apple.com/documentation/authenticationservices | SIWA parity | todo |
| 3.6 | LocalAuthentication (if Face ID later) | https://developer.apple.com/documentation/localauthentication | ASR 2.5.13 | todo |
| 3.7 | Keychain / Secure Enclave (as needed) | Security docs under documentation hub | Tokens | todo |
| 3.8 | Account deletion support article | https://developer.apple.com/support/offering-account-deletion-in-your-app/ | Existing Erasure service | todo |
| 3.9 | Internal `/privacy` + cookie consent | `web/src/app/(public)/privacy`, CookieConsent | Done product-side; re-read for label accuracy | todo |

**Phase 3 deliverable:** `docs/compliance/privacy-purpose-string-inventory.md` (table: data type → API → purpose string → UI pre-prompt → ASC label category).

---

## Phase 4 — Commerce (critical path for App Store)

**Exit criteria:** Dual-rail design validated against StoreKit + Apple Pay docs; no Stripe-for-digital-unlock on iOS path.

### 4A — Physical / offline (Stripe + Apple Pay)

| # | Document | URL | Status |
|---|----------|-----|--------|
| 4A.1 | Guideline **3.1.3(e)** (in App Review Guidelines) | guidelines §3.1.3(e) | todo |
| 4A.2 | PassKit / Apple Pay | https://developer.apple.com/documentation/passkit | todo |
| 4A.3 | Apple Pay Marketing Guidelines | https://developer.apple.com/apple-pay/marketing/ | todo |
| 4A.4 | Apple Pay HIG | HIG Apple Pay patterns | todo |
| 4A.5 | Merchant domain association (web) | Stripe + Apple Pay domain docs; `web/public/.well-known/` | todo |
| 4A.6 | Internal dual-rail Rail A | `ios-payment-rails-design.md` | todo |

### 4B — Digital unlocks (StoreKit)

| # | Document | URL | Status |
|---|----------|-----|--------|
| 4B.1 | StoreKit framework | https://developer.apple.com/documentation/storekit | todo |
| 4B.2 | In-App Purchase overview / StoreKit 2 | StoreKit In-App Purchase docs | todo |
| 4B.3 | Auto-renewable subscriptions | https://developer.apple.com/app-store/subscriptions/ | todo |
| 4B.4 | Offering a subscription across multiple apps | StoreKit multi-app subscription docs | todo |
| 4B.5 | App Store Server Notifications / transaction verification | StoreKit server docs | todo |
| 4B.6 | External purchase / StoreKit External Purchase Link | https://developer.apple.com/documentation/storekit/external_purchase | todo |
| 4B.7 | Promoting In-App Purchases | https://developer.apple.com/app-store/promoting-in-app-purchases/ | todo |
| 4B.8 | DeviceCheck (trials / abuse) | https://developer.apple.com/documentation/devicecheck | todo |
| 4B.9 | Internal dual-rail Rail B | `ios-payment-rails-design.md` | todo |

### 4C — Explicit N/A confirmations (short read)

| # | Topic | Why N/A or limited | Status |
|---|--------|-------------------|--------|
| 4C.1 | Reader app entitlement | Not magazines/books media library | todo |
| 4C.2 | NFT IAP rules | No NFT product | todo |
| 4C.3 | Loot boxes odds | No randomized paid items | todo |

**Phase 4 deliverable:** Updated dual-rail design with “doc citations” section; ASC product catalog draft (SKUs for tiers).

---

## Phase 5 — Platform frameworks (feature-by-feature)

**Exit criteria:** For each feature we ship natively, “intended use” + public API confirmed.

| # | Feature | Document | URL | Status |
|---|---------|----------|-----|--------|
| 5.1 | Public APIs only / current OS | Documentation hub + Guideline 2.5.1 | https://developer.apple.com/documentation/ | todo |
| 5.2 | Bundle layout / Frameworks | Placing content in a bundle | https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle | todo |
| 5.3 | Entitlements catalog | Entitlements | https://developer.apple.com/documentation/bundleresources/entitlements | todo |
| 5.4 | Location | Core Location | https://developer.apple.com/documentation/corelocation | todo |
| 5.5 | Maps | MapKit | https://developer.apple.com/documentation/mapkit | todo |
| 5.6 | Push | User Notifications | https://developer.apple.com/documentation/usernotifications | todo |
| 5.7 | Background modes | Background Tasks / UIBackgroundModes (only if needed) | documentation search | todo |
| 5.8 | Photos / camera | PhotosUI, AVFoundation as needed | https://developer.apple.com/documentation/photosui | todo |
| 5.9 | In-app browser | WebKit / SFSafariViewController | https://developer.apple.com/documentation/webkit | todo |
| 5.10 | File picking | Uniform Type Identifiers + document picker | https://developer.apple.com/documentation/uniformtypeidentifiers | todo |
| 5.11 | Networking IPv6 | Guideline 2.5.5 + networking best practices | todo | | |
| 5.12 | App extensions (only if shipped) | App extensions overview | https://developer.apple.com/documentation/technologyoverviews/app-extensions | todo |
| 5.13 | iOS/iPadOS SDK release notes (target version) | e.g. iOS 26 RN | https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-26-release-notes | todo |
| 5.14 | Xcode release notes | Xcode 26 RN | https://developer.apple.com/documentation/Xcode-Release-Notes/xcode-26-release-notes | todo |

**Phase 5 deliverable:** Capability matrix (feature → framework → entitlement → purpose string → flag).

---

## Phase 6 — App Store Connect & review operations

**Exit criteria:** Review runbook matches Apple process docs; demo + flags narrative ready.

| # | Document | URL | Status |
|---|----------|-----|--------|
| 6.1 | App Store Connect Help | https://developer.apple.com/help/app-store-connect/ | todo |
| 6.2 | Developer Account Help | https://developer.apple.com/help/account/ | todo |
| 6.3 | TestFlight | https://developer.apple.com/testflight/ | todo |
| 6.4 | App Review (process) | https://developer.apple.com/distribute/app-review/ | todo |
| 6.5 | App categories | https://developer.apple.com/app-store/categories/ | todo |
| 6.6 | In-App Events (if used) | https://developer.apple.com/app-store/in-app-events/ | todo |
| 6.7 | Marketing / identity guidelines | https://developer.apple.com/app-store/marketing/guidelines/ | todo |
| 6.8 | Trademark guidelines | https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html | todo |
| 6.9 | Internal app-review-notes | `app-review-notes.md` | todo |

**Phase 6 deliverable:** ASC launch checklist checklisted against Help articles (screenshots, age rating, privacy nutrition, review notes, IAP).

---

## Phase 7 — Regulated, distribution edge cases, optional tech

**Exit criteria:** Explicit go/no-go per feature on first iOS binary; counsel sign-off recorded where needed.

| # | Topic | Apple / external docs | Product stance | Status |
|---|--------|----------------------|----------------|--------|
| 7.1 | Insurance apps free / compliance | Guidelines **3.2.1(v)** | Flag / partner licenses | todo |
| 7.2 | Financial / money management | Guidelines **3.2.1(viii)** | Advances/BNPL flag-off until licensed | todo |
| 7.3 | Legal entity submitter | Guidelines **5.1.1(ix)** | Org Apple Developer account | todo |
| 7.4 | Notarization / alt distribution (EU) | MarketplaceKit, notarization help | Only if product goal | todo |
| 7.5 | Alternative browser engines (EU/Japan) | Support article on entitlements | N/A unless browser product | todo |
| 7.6 | App Intents / Siri | https://developer.apple.com/documentation/appintents | Post-MVP | todo |
| 7.7 | Widgets | WidgetKit | Only if related to core | todo |

---

## Phase 8 — Cadence (keep current)

| Trigger | Action | Owner |
|---------|--------|-------|
| Apple “Last Updated” on Guidelines changes | Diff skill registries; re-run `/app-store-compliance` | Eng |
| New major iOS / Xcode | Read platform + Xcode release notes; update capability matrix | Eng |
| New payment / OAuth / analytics SDK | Re-read privacy + 3.1 / third-party responsibility intro | Eng + Sec |
| New regulated vertical (insurance live, advances live) | Phase 7 + counsel | Founder + counsel |
| Quarterly | Spot-check HIG + StoreKit subscription best practices | Eng |

---

## Suggested calendar (first pass)

| Week | Focus |
|------|--------|
| **Week 1** | Phase 0 + Phase 1 (policy lock) + start Phase 3 privacy inventory |
| **Week 2** | Phase 2 HIG walkthroughs + Phase 4A Apple Pay; Phase 4B StoreKit deep read |
| **Week 3** | Phase 5 frameworks + Phase 6 ASC operations |
| **Week 4** | Phase 7 go/no-go; update dual-rail + remediated report; schedule native spike only if Phase 4 exit met |

Parallelization: after Phase 1, **Design (2)** and **Privacy (3)** can run in parallel; **Commerce (4)** should not start implementation until 4A/4B review is `done`.

---

## Roles

| Role | Owns |
|------|------|
| Eng lead | Phases 0, 4B, 5, 8 |
| Product / founder | Phase 1 business model narrative, Phase 7 go/no-go |
| Design | Phase 2 |
| Security / privacy | Phase 3 |
| Ops | Phase 6, demo env (PRE-05) |
| Outside counsel | Phase 7 insurance/lending; Privacy/Terms legal review |

---

## Review log template (copy per phase or per doc)

```markdown
### Review: [doc id e.g. 4B.1 StoreKit]
- Date:
- Reviewer:
- URL / version or “as of” date:
- Applicable product surfaces:
- Key requirements (bullets):
- Gaps vs current NoMarkup (path or “not built”):
- Decision: no-op | doc-only | implement | flag-off on iOS | counsel
- Follow-up ticket / PR:
```

---

## Definition of done (roadmap complete)

- [ ] All Phase 1–6 rows `done` or `n/a` with reviewer + date  
- [ ] Privacy purpose-string inventory checked in  
- [ ] Dual-rail design cites StoreKit + 3.1.3(e) docs  
- [ ] Capability matrix checked in  
- [ ] `/app-store-compliance` re-run after any product change from this review  
- [ ] Phase 8 calendar on team ritual (quarterly or release-aligned)

---

## Out of scope for this roadmap

- Implementing StoreKit or a native shell (execution follows review)  
- Google Play / Android policy  
- Non-Apple third-party API docs except where they affect Apple review (Stripe, Mapbox, Sentry) — track those in eng onboarding, not this file  

---

## Quick links (bookmark bar)

1. https://developer.apple.com/documentation/  
2. https://developer.apple.com/app-store/review/guidelines/  
3. https://developer.apple.com/design/human-interface-guidelines/  
4. https://developer.apple.com/documentation/storekit  
5. https://developer.apple.com/documentation/passkit  
6. https://developer.apple.com/documentation/authenticationservices  
7. https://developer.apple.com/help/app-store-connect/  
8. https://developer.apple.com/documentation/updates  
