# Apple Documentation Review Roadmap — NoMarkup

**Purpose:** Ordered plan to review every Apple document that matters for shipping and maintaining NoMarkup (web + iOS/iPad App Store binary).  
**Product:** Two-sided local marketplace — services reverse auction + goods forward auction, Stripe escrow, chat/UGC, maps, subscriptions (digital tiers), insurance/advances (regulated, flag-gated).  
**Last updated:** 2026-07-27  
**Phase progress:** **Phases 0–4 first-pass review `done`** (see `review-logs/phase-0.md` … `phase-4b.md`). **Phases 5–7 remain process residual** (packaging / ops / regulated go-no-go — not closed by the Stage A doc pass). Phase 8 is ongoing cadence.  
**Companion artifacts:**

| Artifact | Role |
|----------|------|
| [app-store-review-2026-07-26.md](./app-store-review-2026-07-26.md) | Baseline ASR audit |
| [app-store-review-2026-07-26-remediated.md](./app-store-review-2026-07-26-remediated.md) | Post-remediation delta |
| [remediation-checklist.md](./remediation-checklist.md) | ASR ID status |
| [ios-payment-rails-design.md](./ios-payment-rails-design.md) | Dual-rail Stripe / StoreKit |
| [ios-mobile-web-readiness.md](./ios-mobile-web-readiness.md) | Safari / PWA mobile UX |
| [app-review-notes.md](./app-review-notes.md) | Demo accounts, flags, review narrative |
| [capability-matrix.md](./capability-matrix.md) · [privacy-purpose-string-inventory.md](./privacy-purpose-string-inventory.md) | Stage A deliverables (refreshed with live iOS tree) |
| Review logs | `review-logs/phase-0.md` … `phase-4b.md` |
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

| Phase | Name | Goal | Status | Review log | Depends on |
|-------|------|------|--------|------------|------------|
| **0** | Orientation | Know where policy vs API docs live | **done** | [`review-logs/phase-0.md`](./review-logs/phase-0.md) | — |
| **1** | Policy lock | Full ASR re-read against product | **done** | [`review-logs/phase-1.md`](./review-logs/phase-1.md) | Phase 0 |
| **2** | Design & mobile | HIG + iPhone/iPad behavior | **done** | [`review-logs/phase-2.md`](./review-logs/phase-2.md) | Phase 1 |
| **3** | Privacy & identity | Purpose strings, SIWA, consent, labels | **done** | [`review-logs/phase-3.md`](./review-logs/phase-3.md) | Phase 1 |
| **4** | Commerce rails | Apple Pay (physical) + StoreKit (digital) | **done** | [`phase-4a.md`](./review-logs/phase-4a.md) · [`phase-4b.md`](./review-logs/phase-4b.md) | Phase 1, dual-rail doc |
| **5** | Platform & packaging | Public APIs, bundle, notifications, location, media | **todo** (process residual) | — | Phase 3 + live binary |
| **6** | Review operations | ASC, TestFlight, demo, expedite/appeal | **todo** (process residual) | — | Phases 1–5 |
| **7** | Regulated & optional | Insurance/lending, alt distribution, intents | **todo** (process residual + counsel) | — | Product decision |
| **8** | Cadence | Re-review on SDK / guideline updates | Ongoing | — | All |

**First-pass doc review (Phases 0–4):** complete 2026-07-26. **Residual process work (Phases 5–7)** is not closed by that pass — packaging, ASC ops, and regulated go/no-go remain open.

---

## Phase 0 — Orientation (hub literacy) — **DONE**

**Exit criteria:** Team can name the difference between Guidelines, HIG, Documentation, and ASC Help; bookmark set exists.  
**Review log:** [`review-logs/phase-0.md`](./review-logs/phase-0.md) (2026-07-26, Grok).

| # | Document | URL | Status | Reviewer | Date | Notes |
|---|----------|-----|--------|----------|------|-------|
| 0.1 | Apple Developer Documentation hub | https://developer.apple.com/documentation/ | **done** | Grok | 2026-07-26 | API reference home |
| 0.2 | Documentation Updates (platform waves) | https://developer.apple.com/documentation/updates | **done** | Grok | 2026-07-26 | Track iOS / Xcode churn |
| 0.3 | Sample Code Library (index) | https://developer.apple.com/documentation/samplecode | **done** | Grok | 2026-07-26 | Use samples when implementing |
| 0.4 | Internal: this roadmap + dual-rail + remediated audit | `docs/compliance/*` | **done** | Grok | 2026-07-26 | + launch-board.md |

---

## Phase 1 — Policy lock (App Review Guidelines) — **DONE**

**Exit criteria:** Every applicable ASR cluster mapped to product behavior; open gaps listed with owner. Prefer re-running `/app-store-compliance` after material product changes.  
**Review log:** [`review-logs/phase-1.md`](./review-logs/phase-1.md). Blockers: [`submission-blockers.md`](./submission-blockers.md).

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

**Supporting policy / program links (bookmark; optional re-read — not blocking Phase 1 first-pass):**

| # | Document | URL | Status |
|---|----------|-----|--------|
| 1.8 | Apple Developer Program License Agreement (esp. Schedule 2 subscriptions) | https://developer.apple.com/support/terms/ | residual bookmark |
| 1.9 | App Store Improvements / removals | https://developer.apple.com/support/app-store-improvements/ | residual bookmark |
| 1.10 | Offering account deletion | https://developer.apple.com/support/offering-account-deletion-in-your-app/ | residual bookmark (product path exists) |
| 1.11 | User privacy and data use (tracking) | https://developer.apple.com/app-store/user-privacy-and-data-use/ | residual bookmark (ATT = N) |
| 1.12 | Kids apps / parental gates (confirm N/A — we are 18+) | https://developer.apple.com/app-store/kids-apps/ | residual / **n/a** product |
| 1.13 | Reader apps external link (confirm N/A) | https://developer.apple.com/support/reader-apps/ | residual / **n/a** product |
| 1.14 | Skill registries refresh if Apple “Last Updated” drifts | `~/.grok/skills/app-store-compliance/references/SOURCE.md` | Phase 8 cadence |

**Phase 1 deliverable:** Covered by remediated audit + `review-logs/phase-1.md` + `submission-blockers.md`.

---

## Phase 2 — Design & multi-device UX — **DONE**

**Exit criteria:** HIG checklist for core flows (browse → bid/buy → pay → chat → settings); iPhone + iPad patterns agreed for native and current web.  
**Review log:** [`review-logs/phase-2.md`](./review-logs/phase-2.md) (2026-07-26).

| # | Document | URL | Status | Reviewer | Date |
|---|----------|-----|--------|----------|------|
| 2.1 | Human Interface Guidelines (home) | https://developer.apple.com/design/human-interface-guidelines/ | **done** | Grok | 2026-07-26 |
| 2.2 | HIG — Foundations (layout, typography, color, accessibility) | same site / Foundations | **done** | Grok | 2026-07-26 |
| 2.3 | HIG — Patterns (navigation, sheets, search, feedback) | same | **done** | Grok | 2026-07-26 |
| 2.4 | HIG — Inputs & feedback; touch targets | same | **done** | Grok | 2026-07-26 |
| 2.5 | HIG — Privacy / accessing private data patterns | https://developer.apple.com/design/human-interface-guidelines/privacy | **done** | Grok | 2026-07-26 |
| 2.6 | Configuring a multiplatform app target | https://developer.apple.com/documentation/xcode/configuring-a-multiplatform-app-target | **done** | Grok | 2026-07-26 |
| 2.7 | SwiftUI (or UIKit if hybrid) landing | https://developer.apple.com/documentation/swiftui · https://developer.apple.com/documentation/uikit | **done** | Grok | 2026-07-26 |
| 2.8 | Internal mobile web readiness | `ios-mobile-web-readiness.md` | **done** | Grok | 2026-07-26 |

**Flows re-walked against HIG (see phase-2 log):** marketplace, jobs, map, auth, messages, payments, settings, provider workspace — web strong; native now in tree (`ios/NoMarkup`).

**Phase 2 deliverable:** UX gap list in `review-logs/phase-2.md` + `ios-mobile-web-readiness.md`.

---

## Phase 3 — Privacy, security, and identity — **DONE**

**Exit criteria:** Purpose-string inventory drafted; SIWA requirements confirmed; App Privacy nutrition label worksheet started; consent model matches implementation.  
**Review log:** [`review-logs/phase-3.md`](./review-logs/phase-3.md).  
**Deliverable:** [`privacy-purpose-string-inventory.md`](./privacy-purpose-string-inventory.md) (refreshed 2026-07-27 — purpose strings live in `ios/NoMarkup/Info.plist`).

| # | Document | URL | Maps to product | Status |
|---|----------|-----|-----------------|--------|
| 3.1 | Protecting the User’s Privacy | https://developer.apple.com/documentation/uikit/protecting_the_user_s_privacy | Consent, minimization | **done** |
| 3.2 | Requesting access to protected resources (purpose strings) | Linked from 3.1 / Info.plist keys | Location, camera, photos, mic | **done** (Info.plist live) |
| 3.3 | App Tracking Transparency | https://developer.apple.com/documentation/apptrackingtransparency | Only if cross-app tracking | **done** (ATT = N) |
| 3.4 | User privacy and data use (policy) | https://developer.apple.com/app-store/user-privacy-and-data-use/ | ASC privacy labels | **done** (worksheet in inventory) |
| 3.5 | AuthenticationServices / Sign in with Apple | https://developer.apple.com/documentation/authenticationservices | SIWA parity | **done** |
| 3.6 | LocalAuthentication (if Face ID later) | https://developer.apple.com/documentation/localauthentication | ASR 2.5.13 | **n/a** (not productized) |
| 3.7 | Keychain / Secure Enclave (as needed) | Security docs under documentation hub | Tokens | **done** (Keychain in tree) |
| 3.8 | Account deletion support article | https://developer.apple.com/support/offering-account-deletion-in-your-app/ | Existing Erasure service | **done** |
| 3.9 | Internal `/privacy` + cookie consent | `web/src/app/(public)/privacy`, CookieConsent | Label accuracy | **done** |

---

## Phase 4 — Commerce (critical path for App Store) — **DONE** (doc review)

**Exit criteria:** Dual-rail design validated against StoreKit + Apple Pay docs; no Stripe-for-digital-unlock on iOS path.  
**Review logs:** [`review-logs/phase-4a.md`](./review-logs/phase-4a.md) (Rail A) · [`review-logs/phase-4b.md`](./review-logs/phase-4b.md) (Rail B).  
**Note:** First-pass was **documentation only** — do not treat as StoreKit implementation complete; still no fake product IDs.

### 4A — Physical / offline (Stripe + Apple Pay)

| # | Document | URL | Status |
|---|----------|-----|--------|
| 4A.1 | Guideline **3.1.3(e)** (in App Review Guidelines) | guidelines §3.1.3(e) | **done** |
| 4A.2 | PassKit / Apple Pay | https://developer.apple.com/documentation/passkit | **done** |
| 4A.3 | Apple Pay Marketing Guidelines | https://developer.apple.com/apple-pay/marketing/ | **done** |
| 4A.4 | Apple Pay HIG | HIG Apple Pay patterns | **done** |
| 4A.5 | Merchant domain association (web) | Stripe + Apple Pay domain docs; `web/public/.well-known/` | **done** (gap: prod association still open) |
| 4A.6 | Internal dual-rail Rail A | `ios-payment-rails-design.md` | **done** |

### 4B — Digital unlocks (StoreKit)

| # | Document | URL | Status |
|---|----------|-----|--------|
| 4B.1 | StoreKit framework | https://developer.apple.com/documentation/storekit | **done** |
| 4B.2 | In-App Purchase overview / StoreKit 2 | StoreKit In-App Purchase docs | **done** |
| 4B.3 | Auto-renewable subscriptions | https://developer.apple.com/app-store/subscriptions/ | **done** |
| 4B.4 | Offering a subscription across multiple apps | StoreKit multi-app subscription docs | **done** |
| 4B.5 | App Store Server Notifications / transaction verification | StoreKit server docs | **done** |
| 4B.6 | External purchase / StoreKit External Purchase Link | https://developer.apple.com/documentation/storekit/external_purchase | **done** |
| 4B.7 | Promoting In-App Purchases | https://developer.apple.com/app-store/promoting-in-app-purchases/ | **done** |
| 4B.8 | DeviceCheck (trials / abuse) | https://developer.apple.com/documentation/devicecheck | **done** (optional) |
| 4B.9 | Internal dual-rail Rail B | `ios-payment-rails-design.md` | **done** |

### 4C — Explicit N/A confirmations (short read)

| # | Topic | Why N/A or limited | Status |
|---|--------|-------------------|--------|
| 4C.1 | Reader app entitlement | Not magazines/books media library | **done** / **n/a** |
| 4C.2 | NFT IAP rules | No NFT product | **done** / **n/a** |
| 4C.3 | Loot boxes odds | No randomized paid items | **done** / **n/a** |

**Phase 4 deliverable:** Dual-rail design + phase-4a/4b logs. ASC SKU catalog remains residual until IAP ships.

---

## Phase 5 — Platform frameworks (feature-by-feature) — **PROCESS RESIDUAL**

**Exit criteria:** For each feature we ship natively, “intended use” + public API confirmed.  
**Status:** **todo** — not closed by Phases 0–4 doc pass; walk against live `ios/NoMarkup` binary before ASC submit.

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

## Phase 6 — App Store Connect & review operations — **PROCESS RESIDUAL**

**Exit criteria:** Review runbook matches Apple process docs; demo + flags narrative ready.  
**Status:** **todo** — ASC packaging, TestFlight, demo env remain operational work (not first-pass doc review).

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

## Phase 7 — Regulated, distribution edge cases, optional tech — **PROCESS RESIDUAL**

**Exit criteria:** Explicit go/no-go per feature on first iOS binary; counsel sign-off recorded where needed.  
**Status:** **todo** — flag-off posture documented; live licenses / counsel sign-off not claimed.

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

- [x] Phases **0–4** first-pass review `done` with logs under `review-logs/`  
- [x] Privacy purpose-string inventory checked in (refreshed; Info.plist live)  
- [x] Dual-rail design cites StoreKit + 3.1.3(e) docs (`ios-payment-rails-design.md` + phase-4 logs)  
- [x] Capability matrix checked in (header refreshed for live iOS tree)  
- [ ] Phases **5–7** process residual closed (frameworks walk, ASC ops, regulated counsel)  
- [ ] `/app-store-compliance` re-run after material product change  
- [ ] Phase 8 calendar on team ritual (quarterly or release-aligned)

---

## Out of scope for this roadmap

- Implementing StoreKit product IDs or claiming IAP shipped (execution follows review; no stubs)  
- Google Play / Android policy  
- Checkr / third-party background-check vendor integration (PRD FR-2.9 open — do not invent)  
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

---

## Decision log — IOS-DES.4 Liquid Glass adoption (2026-07-27)

- **Scroll-edge (DES.9/DES.4 opaque half)**: all 70 unconditional
  `.toolbarBackground(.visible, for: .navigationBar)` sites deleted (57 files);
  the paired `BrandTheme.navy` color line stays, so pre-26 keeps the branded
  opaque bar via `UINavigationBarAppearance` while iOS 26+ gets the system
  scroll-edge (glass) behavior that `BrandTheme.applyGlobalChrome()` already
  leaves to the system.
- **Glass API verification (installed Xcode 26.5.0, iOS 26.5 SDK)**: the
  SwiftUI swiftinterface (`arm64e-apple-ios.swiftinterface`) contains
  `GlassButtonStyle` / `.glass` and `GlassProminentButtonStyle` /
  `.glassProminent` (`@available(iOS 26.0, *)`), but **no `glassEffect` view
  modifier and no `GlassEffectContainer`**. Decision: adopt only the verified
  API — `buttonStyle(.glassProminent)` behind `if #available(iOS 26.0, *)` on
  ONE high-value control: the primary **Place bid** CTA in
  `ios/NoMarkup/Features/ListingDetailView.swift`
  (`GlassProminentBidCTAStyle`; pre-26 falls back to `.borderedProminent`).
  `glassEffect` adoption stays deferred until an SDK that actually ships it.
