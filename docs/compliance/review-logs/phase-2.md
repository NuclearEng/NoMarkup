# Phase 2 — HIG / design policy review log

**Date:** 2026-07-26  
**Reviewer:** Grok subagent (Phase 2)  
**Status:** **done**  
**Program:** Stage A Phase 2 (`launch-board.md` A2)  
**Scope:** Human Interface Guidelines + App Review **Guideline 4.x** (esp. **4.2** minimum functionality) as they apply to NoMarkup’s **current mobile web** product and a **future** iOS/iPadOS binary.  
**Out of scope:** Stage B code, Xcode scaffold, StoreKit implementation, ASC screenshots.

**Sources consulted**

| Source | Path / URL |
|--------|------------|
| Internal mobile web readiness | `docs/compliance/ios-mobile-web-readiness.md` |
| App Review notes | `docs/compliance/app-review-notes.md` |
| Launch board + blockers | `docs/compliance/launch-board.md`, `submission-blockers.md` |
| Phase 0–1 logs | `docs/compliance/review-logs/phase-0.md`, `phase-1.md` |
| Product design rules | `Claude.md` §4 (HIG + Material 3 + WCAG 2.2 AA goal) |
| Web chrome | `web/src/components/layout/*`, public + dashboard layouts |
| Core surfaces | marketplace, jobs, map, auth, messages, payments, settings, provider workspace |
| Apple HIG (layout hub) | https://developer.apple.com/design/human-interface-guidelines/ |
| HIG Layout (safe areas, iPad adaptability) | https://developer.apple.com/design/human-interface-guidelines/layout |
| Guidelines (Phase 1 lock) | https://developer.apple.com/app-store/review/guidelines/ (§4 Design; 2.4.1 multiplatform) |

**Verdict this phase**

| Surface | Design readiness |
|---------|------------------|
| Mobile Safari / standalone web (320–1024px+) | **STRONG** — touch, safe areas, tab chrome, dialogs, purpose copy largely ship-ready |
| App Store **binary** (HIG + **4.2**) | **NOT READY** — no native target; pure WKWebView shell would be a **high rejection risk** |

---

## 1. HIG topics reviewed

| # | Topic | Product evidence (web) | vs Apple HIG | Native / binary note |
|---|-------|------------------------|--------------|----------------------|
| 1 | **Navigation** | Auth: bottom **MobileTabBar** (4 primary + More drawer); desktop **SidebarNav**; logged-out: header + hamburger. Primary tabs: customer Home / Jobs / Messages / Payments; provider Home / Bids / Messages / Payments. | **PASS** (mobile web): ≤5 primary destinations, thumb-reachable, `aria-current`, Escape + focus on More. | Stage **B0**: map to `TabView` / convertible tab bar + sidebar (HIG: sidebarAdaptable). Avoid dumping entire web IA into tabs. |
| 2 | **Layout** | `min-h-[100dvh]`, `overflow-x-clip`, sticky header, full-bleed dark glass shells; marketplace/jobs responsive grids; messages list/thread split at `md+`. | **PASS** web adaptability across widths; content extends under chrome with spacers. | **GAP** native: safe-area APIs, Dynamic Type reflow, Stage Manager window sizes, background extension under bars (HIG Layout). |
| 3 | **Touch targets (44pt)** | Systematic `min-h-[44px]` / `min-w-[44px]` on `Button` sizes (default/sm/lg/icon), inputs (`h-11 text-base` on small screens), footer legal links, hamburger, dialog close, tab More close, report/block CTAs. | **PASS** web HIG touch target policy (project + Apple 44×44). | Preserve in native controls; do not shrink hit regions for density. Audit dense tables/admin later. |
| 4 | **Sheets / modals** | Radix **Dialog**: `max-h min(90dvh)`, scrollable body, safe-area bottom padding, 44px close + `sr-only` Close. MobileTabBar **More** = bottom sheet (`role="dialog"`, `aria-modal`). Report listing/user dialogs. | **PASS** for web constraints (viewport, home indicator). | **GAP**: prefer system sheet presentation (detents, drag-to-dismiss, grabber) over centered web modal on phone. |
| 5 | **Accessibility** | Skip-nav; `lang="en"`; focus-visible rings; form labels + `FormMessage`; toasts; `role="alert"`/`status`; reduced-motion media queries in `globals.css`; empty/error/retry patterns. WCAG 2.2 AA is product goal (not full axe gate). | **PARTIAL PASS** web. | **GAP** native: VoiceOver traits, Dynamic Type, Reduce Motion system setting, Invert/Differentiate Without Color, keyboard on iPad. |
| 6 | **Privacy prompts / purpose** | Market selector: “Used to find your nearest NoMarkup market…” before geolocation. Provider check-in: purpose string + GPS-required messaging (`CheckInOut`). Cookie banner analytics/marketing **opt-in**. Age gate 18+. | **PASS** web (ASR-5.1.5 posture). | **GAP** native: `Info.plist` purpose strings + system permission dialogs (Stage **A3** → **B1**). Do not invent a second purpose story. |
| 7 | **Feedback** | Skeleton loaders; specific empty states + Retry; Sonner toasts on report success/error; connection status on chat; loading labels on check-in. | **PASS** web feedback hierarchy. | **GAP** native: haptics on bid/check-in success, system alerts for destructive account delete confirm. |
| 8 | **Typography / inputs** | Inputs `text-base` on small screens → no iOS focus zoom; brand Syne + system sans; dark-first tokens. | **PASS** anti-zoom + readability baseline. | **GAP**: Dynamic Type scale mapping; avoid fixed `text-[0.625rem]` tab labels as sole affordance (icons help). |
| 9 | **iPad / multitasking** | Manifest `orientation: any`; responsive layout; landscape usable per readiness doc; messages dual-pane ≥md. | **PASS** Safari iPad. | **GAP Guideline 2.4.1**: iPhone app must work on iPad — multiplatform target + layout at 1/2, 1/3 Stage Manager widths (HIG Multitasking). |
| 10 | **Platform chrome / status bar** | `appleWebApp` statusBarStyle `black-translucent`; header `env(safe-area-inset-top)`. | **PASS** PWA/web. | Native: prefer standard status bar integration; don’t hide status bar for marketplace UI. |
| 11 | **Dark mode / materials** | App is dark-first glass aesthetic; semantic tokens in Tailwind. | **PARTIAL** — intentional brand dark. | Offer system light/dark if ASC screenshots expect both; HIG does not require light, but contrast audit still required. |
| 12 | **Guideline 4.2 min functionality** | Full product: jobs reverse-auction, goods marketplace, escrow payments, chat, bids, workspace, settings, UGC tools — **not** a brochure site. | **N/A as Safari app**; product is functionally rich. | **BLOCKER if binary = pure WKWebView of no-markup.com** without native interaction model (see §4). |

---

## 2. Core flow walkthroughs (PASS / GAP)

Legend: **HIG** = design quality vs Apple HIG expectations on the reviewed surface. **4.2** = whether that flow contributes app-like value for a future binary (not whether web alone is submittable).

### 2.1 Public — Marketplace list / detail

| Aspect | Finding | HIG | 4.2 |
|--------|---------|-----|-----|
| Browse | Server-seeded list + client filters (`ListingBrowseClient`); ending-soon sort default; grid usable on phone. | **PASS** | **PASS** (real catalog) |
| Detail | Listing detail with bid/spectate paths; **Report** via `ReportListingButton` (reason + optional details, toast feedback). | **PASS** | **PASS** (UGC + commerce) |
| Gaps | Filter chrome density on SE-class widths needs device QA; map deep-link separate route. | **RISK** density | — |
| Native | Native list/detail with share sheet + native report sheet; avoid full-site iframe. | **GAP** | Required for 4.2 |

### 2.2 Public — Jobs browse / map

| Aspect | Finding | HIG | 4.2 |
|--------|---------|-----|-----|
| Jobs search | Filters collapsible on small screens; mobile-first patterns in `JobsSearchClient`. | **PASS** | **PASS** |
| Map | `/jobs/map`, `/marketplace/map` (Mapbox); approximate geo privacy rules in product (coarsened public map). | **PASS** with privacy care | **PASS** if native MapKit/Mapbox embedded properly |
| Gaps | Map gesture conflicts with page scroll; heavy Mapbox JS — lazy load already product direction. | **RISK** performance | WebView map worse |

### 2.3 Auth — Login / register / SIWA-style buttons

| Aspect | Finding | HIG | 4.2 |
|--------|---------|-----|-----|
| Forms | Card layout, MFA step, inline errors `role="alert"`, 44px CTAs, OAuth + email divider. | **PASS** | Auth is baseline |
| OAuth | `OAuthButtons`: Continue with Google / **Apple** / Facebook → `/api/v1/auth/oauth/*`. Equal treatment of Apple among third-party login (**Guideline 4.8** posture on web). | **PASS** web | **GAP** native: must use **ASAuthorization** / SIWA native control, not a web OAuth redirect-only shell |
| Gaps | Custom “Continue with Apple” button is **not** Apple’s system button styling (acceptable on web; native HIG prefers system SIWA button). | **RISK** native brand | **4.8** native |

### 2.4 Customer — Post job, pay, chat, report

| Flow | Evidence | HIG | 4.2 |
|------|----------|-----|-----|
| **Post job** | `/jobs/new` → `JobPostingForm`; primary CTA “Post a Job” in header (44px). | **PASS** | **PASS** core loop |
| **Pay** | `/payments` tabs (all/pending/escrow/…), empty + error + retry; escrow model Stripe Connect (Rail A / **3.1.3(e)** — commerce policy Phase 1). | **PASS** UX | **PASS** as offline goods/services payments; do **not** force IAP for GMV |
| **Chat** | `/messages`: list/thread master-detail; mobile back; Report + Block in header; typing + WS status. | **PASS** | **PASS** (real-time utility) |
| **Report** | Listing + user report dialogs; toast confirmation; admin queues exist for moderation. | **PASS** | **PASS** Safety 1.2 alignment |
| Gaps | Chat height `calc(100dvh - …)` vs tab bar + keyboard: readiness checklist calls out keyboard QA. Destructive flows use dialogs/toasts; confirm native alert patterns later. | **RISK** keyboard | — |

### 2.5 Provider — Workspace check-in, bids

| Flow | Evidence | HIG | 4.2 |
|------|----------|-----|-----|
| **Workspace** | `/provider/workspace`: today’s contracts, **CheckInOut** + completion photos; purpose string before GPS; loading/disabled states. | **PASS** | **PASS** (field utility — strong 4.2 argument) |
| **Bids** | Primary tab “Bids” for providers; bidding is product core (Rust engine backend). | **PASS** nav findability | **PASS** |
| Gaps | Camera/photo capture on web vs native photo picker; location denial messaging is clear but not a system Settings deep-link (web limitation). | **RISK** media | Native camera improves 4.2 story |

### 2.6 Settings — Privacy, deletion, accounts, subscription

| Flow | Evidence | HIG | 4.2 |
|------|----------|-----|-----|
| **Security / accounts** | MFA setup, password change, **ConnectedAccounts** (OAuth unlink). | **PASS** | Required legal surface |
| **Account deletion / export** | Settings → account: reason select, type DELETE, grace period, restore, data export download. | **PASS** (clear destructive UX) | **5.1.1(v)** ready if exposed in-app natively |
| **Notifications** | Settings notifications page present. | **PASS** web prefs | Do not claim APNs until B5 |
| **Subscription** | Full Stripe tier UI (usage bars, cancel confirm, invoices). | **PASS** as **web** billing UI | **GAP binary**: digital unlocks need **StoreKit** (3.1.1) — design only until Phase 4B; **do not** embed this Stripe checkout as the iOS path for digital tiers |
| **Privacy policy** | Public `/privacy` + footer links 44px. | **PASS** | ASC + in-app link still required |

---

## 3. Explicit risks — pure WKWebView native shell

Shipping “NoMarkup” as a thin container that only loads `https://no-markup.com` (or a single full-screen `WKWebView` with no native features) creates concrete rejection and quality risks:

| # | Risk | Why it matters |
|---|------|----------------|
| **R1** | **Guideline 4.2** rejection | App Review treats website wrappers with limited native capability as insufficient. Phase 1 already flags pure WebView as **#1 design risk**. |
| **R2** | **No app-like navigation model** | System tab bar, large titles, swipe-back edge gestures, and iPad sidebar patterns are absent; Safari already provides the web experience. |
| **R3** | **Auth / SIWA mismatch** | Web OAuth redirect inside WebView is fragile (cookie/session, Apple auth guidelines) and fails HIG expectation for Sign in with Apple. |
| **R4** | **Payments dual-rail confusion** | Stripe web checkout for **digital** tiers inside iOS binary conflicts with **3.1.1**; GMV Stripe is OK only if product clearly uses native commerce surfaces for physical/offline (**3.1.3(e)**), not “entire site in a browser.” |
| **R5** | **Permissions opacity** | Camera/location prompts from web may not match Info.plist purpose strings; App Review expects native purpose accuracy. |
| **R6** | **iPad 2.4.1** | A phone-only WebView stretched to iPad looks like a poorly scaled website (HIG: defer compact collapse; support multitasking sizes). |
| **R7** | **Performance / jank** | Mapbox + Next.js hydration in WebView often worse than Safari; reviewers notice sluggishness as incomplete. |
| **R8** | **Accessibility** | Web a11y ≠ VoiceOver parity; Dynamic Type ignored. |
| **R9** | **Metadata honesty** | Screenshots of a website shell invite **2.3** accuracy issues if marketed as a native marketplace app. |

**Program rule (reaffirmed):** *We will not ship a pure WKWebView of no-markup.com as the product* (`submission-blockers.md`).

---

## 4. Recommendations — Stage B0 native chrome

### 4.1 Navigation pattern (preferred)

1. **SwiftUI multiplatform** (`iOS` + `iPadOS` same target) with:
   - **iPhone:** `TabView` — 4–5 tabs aligned to current `MobileTabBar` (Home, Jobs|Bids, Messages, Payments, More/Settings).
   - **iPad:** convertible tab bar / **sidebar** (HIG `sidebarAdaptable`) listing provider extras (Workspace, Bids) without hiding core customer paths.
2. **Native stack navigation** for detail (job, listing, contract, chat thread) so swipe-back and titles work.
3. **Hybrid only where justified:** optional `WKWebView` for **legal HTML** (Privacy/Terms) or rarely changing marketing — **not** for browse/bid/pay/chat.

### 4.2 Safe areas & layout

- Respect top/bottom/side safe areas (Dynamic Island, home indicator, landscape).
- Reuse web lessons: tab bar spacer ≈ `3.5rem + safe-area-inset-bottom`; dialogs/sheets clear home indicator.
- Extend content under translucent bars where appropriate (HIG Layout) without obscuring primary CTAs.
- Test **half / third / full** Stage Manager sizes before submit.

### 4.3 Mobile web wins to **preserve** (do not regress)

| Win | Location / pattern |
|-----|-------------------|
| 44pt minimum controls | `button.tsx`, inputs, dialogs, footer |
| Safe-area header + tab bar + cookie banner | layouts, `MobileTabBar`, readiness doc |
| `viewportFit: cover` + `interactiveWidget: resizes-content` | root layout |
| `text-base` inputs on small screens (no zoom) | `input.tsx` |
| Bottom tabs + More for authenticated IA | `MobileTabBar.tsx` |
| Master-detail chat | `messages/page.tsx` |
| Location purpose copy | MarketSelector, CheckInOut |
| Report/block as first-class actions | chat + listing detail |
| Account deletion grace + export | settings/account |
| Loading / error / empty + retry | payments, jobs, etc. |
| Skip link + reduced-motion CSS | root layout, globals |
| Continue with Apple available when third-party login offered | oauth-buttons |

### 4.4 What **not** to carry over as-is

| Web pattern | Native alternative |
|-------------|-------------------|
| Centered Radix dialogs for primary actions | Sheets / confirmation dialogs |
| Stripe subscription checkout UI | StoreKit paywall (after Phase 4B) |
| Full sidebar “feature catalogue” on phone | Nested “More” / settings groups |
| Mapbox web in WebView-only map | Native map view with same privacy coarsening |
| Custom OAuth Apple button | System SIWA button |

### 4.5 Multiplatform note (Guideline **2.4.1**)

iPhone apps must work on iPad. Plan B0 as **universal**:

- Same binary runs on iPad with adaptive layout (not 1× letterboxed phone UI only).
- Point 9 of HIG layout review: convertible navigation, resizable windows.
- Smoke matrix (Stage C) should include iPad landscape + Split View.

---

## 5. Top design gaps for native (priority)

1. **No native chrome / 4.2 risk** — binary does not exist; pure WebView would fail design review.  
2. **System navigation & iPad multitasking** — TabView + sidebar + Stage Manager layouts not designed in code.  
3. **Dynamic Type & VoiceOver** — web rem/`text-base` ≠ UIFont metrics / accessibility API.  
4. **Native SIWA + permission purpose strings** — web OAuth + in-UI copy are not Info.plist / ASAuthorization.  
5. **Subscription / digital paywall UX** — current Settings subscription is Stripe-shaped; iOS needs StoreKit presentation (commerce Phase 4B), separate from Rail A escrow UX.

---

## 6. Exit criteria checklist (Phase 2)

- [x] HIG topics table completed (navigation, layout, 44pt, sheets, a11y, privacy prompts, feedback, iPad).  
- [x] Core flows walked: public marketplace/jobs/map; auth/SIWA buttons; customer post/pay/chat/report; provider workspace/bids; settings privacy/deletion/accounts/subscription.  
- [x] Each flow marked **PASS / GAP / RISK** vs HIG and vs **4.2** intent.  
- [x] Pure **WKWebView** risks explicit (R1–R9).  
- [x] Stage **B0** recommendations: nav pattern, safe areas, preserve list, avoid list.  
- [x] **2.4.1** multiplatform / iPad note recorded.  
- [x] Artifact path: `docs/compliance/review-logs/phase-2.md`.  
- [ ] Device lab re-run of `ios-mobile-web-readiness.md` checklist on physical iPhone + iPad — **ops/manual** (not blocking this doc phase).  
- [ ] Stage B0 implementation — **explicitly deferred** (no Stage B code this phase).

---

## 7. Product impact → later stages

| Finding | Feeds |
|---------|--------|
| Web HIG posture strong | B3 can port **interaction models**, not just URLs |
| 4.2 / WebView risk | B0 decision lock (SwiftUI multiplatform) |
| Purpose strings already drafted in UI | A3 inventory should **quote** MarketSelector + CheckInOut copy |
| Subscription UI is Stripe | A4b / B2 dual-rail; hide or re-route digital paywall on iOS |
| Chat + workspace are 4.2 strength | Feature in App Review notes + screenshots |

**Next Stage A work:** Phase **3** privacy purpose-string inventory; Phase **4A/4B** commerce reads — still **before** any B0/B2 code.

---

## 8. Non-claims

- This log does **not** claim App Store readiness or that HIG is “fully met” for a binary.  
- This log does **not** authorize Stage B engineering.  
- Mobile web readiness ≠ multiplatform native HIG compliance.  
- Design review is **not** a substitute for StoreKit / privacy / ASC packaging phases.
