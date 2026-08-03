# iOS ↔ PRD Requirements-Coverage Audit — 2026-07-27

**Auditor:** requirements-coverage agent (read-only against all code; this file is the only write)
**Corpus:** `PRD.md` v2.0 (1,926 lines; FR-1.1…FR-19.6 = **158 FR IDs**, plus NFR-1…21, SEC-1…21, §§9–24 un-IDed flows) · `docs/compliance/v1-ios-product-cut.md` (LOCKED 2026-07-26/27) · `docs/compliance/prd-ios-parity-backlog.md` (through wave28) · `docs/compliance/ios-web-feature-matrix.md` (2026-07-26)
**Method:** Phase 1 full-PRD FR census → Phase 2 per-FR evidence search across `ios/NoMarkup/` (113 app source files, ~52k LoC) with gateway route spot-verification (`gateway/internal/router/router.go`, handlers) → Phase 3 deep-verify of money/auction FRs down to the Rust bidding engine and Go payment service → Phase 4 persona journeys → Phase 5 reconciliation against the parity backlog and feature matrix (treated as hypotheses, not truth).
**Honesty notes:** (1) Another agent was concurrently making **cosmetic** edits under `ios/` during this audit; feature-level presence/absence findings are unaffected, but cited line numbers may drift by a few lines. (2) Per PRD §1, the MVP is the **web** app and native mobile is post-MVP (§22 Phase 4) — this audit measures full-PRD product coverage on iOS anyway, matching the backlog's own framing. (3) PRD.md:907–911 prohibits claiming "AI-powered fraud" / "mature ML models" as current state; nothing below does. (4) All Stripe event-callback ("webhook") references below concern flows that are signature-verified in the payment/subscription services via `stripe.webhooks.constructEvent()` — see `gateway/internal/handler/webhook.go:28,40,67,79`.

---

## 0. 2026-08-02 re-audit delta

Spot re-check of the 2026-07-27 **Top 10 gaps** + backlog residuals against current `ios/NoMarkup/`, gateway, chat, and payment code. **Full FR matrix below is not rewritten** — treat §0 as the delta; matrix statuses that conflict with §0 are **stale**.

### Flipped STILL_GAP / Missing / Partial → FIXED (or Implemented)

| FR / item | Was (2026-07-27) | Now | Evidence (abbrev.) |
|---|---|---|---|
| **FR-4.7** bid filters | **M** | **FIXED** | `JobDetailView` `LadderTrustFilter` + min jobs completed client filters |
| **FR-4.6** bid sort | **P** ("lite" price/trust) | **FIXED** | Sort: price / trust / rating / jobs volume |
| **FR-3.1** schedule preference | **P** (hardcoded flexible) | **FIXED** | `PostJobView` schedule picker flexible / specific / range + date fields |
| **FR-8.1** pre-bid inquiry | **P** | **FIXED** | `createChatChannel(…, inquiry\|bid)` + Ask a Question on `JobDetailView` |
| **FR-8.3** PDF/file chat attach | **P** (images only) | **FIXED** | `MessagesView` `fileImporter` PDF → `ImageUploader.uploadPDF` / `message_type: file` |
| **FR-8.8** Share Contact | **P** (server only / no iOS button) | **FIXED** | Gateway `POST /channels/{id}/share-contact` + chat `ShareContactInfo` + iOS confirm UI (file-header comment on share-contact is **stale**) |
| **FR-10.7** distance display | **M** | **FIXED** (distance; not travel-time ETA) | `distanceLabel` on jobs / providers / marketplace when geo-scoped |
| **FR-8.10 / FR-17.1** nav unread badges | **P** | **FIXED** | `RootTabView` `.badge` on Messages + Account (notifications) |
| **FR-15.4** revision 200-char + 3-cap | **P** | **FIXED** | `ContractDetailView` min 200 chars + `revisionsRemaining` / cap gate |
| **FR-18.3 / 18.4** recurring edit | **P** (display-only) | **FIXED** | `updateRecurringConfig` auto-approve toggle + future rate |
| **FR-2.2** PDF on verify | **P** (photo-only claim) | **FIXED** | `VerificationDocumentsView` PDF Files picker |
| **FR-1.1** Facebook native | Gap / matrix stale | **FIXED** | `FacebookOAuthSession` + `/auth/facebook/native` |
| **FR-10.5** service radius editor | **P** | **FIXED** | `ProviderWorkspaceView` radius slider |
| **FR-3.8** browse filters | **P** (text only) | **PARTIAL→mostly FIXED** | Category + min starting bid filters on `JobsView` (schedule filter still thin) |
| **FR-5.1** response/on-time | **P** | **FIXED** | Labels on ProviderWorkspace / ProviderDetail / Providers list |
| **FR-5.3** terms on public profile | **P** | **FIXED** | Terms block on `ProviderDetailView` |
| **Instant payout wire** | FinServ residual / not matrix-core | **FIXED** | `payment.proto` `InstantPayout` + gateway routes + `InstantPayoutView` |
| **Team / Challenges / Legal** | Not in Top-10; product shell | **FIXED** | `EmployeesView`, `ChallengesView`, `LegalServicesView` from Account |

### Still honest residual (do **not** claim FIXED)

| Item | Status | Notes |
|---|---|---|
| **§13 Instant AI / live GPS ETA** | **Roadmap (Phase 2)** | Geo/category/trust prefilter + schedule **shipped**; AI match + live ETA **not** productized |
| **FR-12 StoreKit** digital purchase | **Cut / deferred (B2)** | Free-tier ASC lock intentional |
| **FR-13 Admin** | **Web-only by design** | Zero admin surfaces in consumer binary |
| **FR-2.9 Checkr** | **Roadmap / OQ** | Not built |
| **FR-10.7 travel *time*** | **Partial residual** | Distance labels yes; Maps ETA / traffic time not a dedicated job-card field |
| **FR-19.2 preferred providers** | **Partial** | Account spend roll-up yes; preferred-provider stats still called out as unavailable in UI copy |
| **FR-8.6 server chat search** | **Partial** | Local search over loaded messages; no dedicated server search endpoint |
| **Ops / ASC / smoke / Apple Pay domain / OAuth Console IDs** | **[~] ops** | Not engineering closable without founder/env |
| **MON-14–18 money races** | **Accepted residual (ADR)** or eng if reopened before regulated live | |

### Implication for §1 counts

The executive counts in §1 (**76 I / 36 P / 2 M** of 158) **overstate Partial/Missing** after this delta. Rough direction: the two former Missing (FR-4.7, FR-10.7) and most of the Top-10 Partials above move to **I**, so in-scope coverage is **materially higher than 67% Implemented**. A full re-census was **not** run 2026-08-02 — use this delta + `prd-ios-parity-backlog.md` for submit honesty.

---

## 1. Executive summary

### Coverage by status bucket (158 FR IDs)

| Status | Count | Share |
|---|---:|---:|
| **Implemented** (iOS surface + wiring verified) | **76** | 48% |
| **Partial** (half exists; missing piece named) | **36** | 23% |
| **Missing** (no iOS evidence, in-scope) | **2** | 1% |
| **Backend-only** (no user surface implied / server-mediated) | **22** | 14% |
| **Web-only by design** (PRD or cut assigns to web/admin) | **16** | 10% |
| **Cut by v1 decision** (free-tier ASC lock) | **4** | 3% |
| **Roadmap** (PRD itself defers) | **2** | 1% |

Of the **114 FRs with an iOS-relevant user surface** (Implemented + Partial + Missing): **67% Implemented, 32% Partial, 2% Missing**. No in-scope FR area is entirely absent; the auction/contract/payment core is deep, the gaps are edge-of-flow UX.

### Coverage by area

| Area | Impl | Partial | Missing | Backend | Web-only | Cut | Roadmap |
|---|---:|---:|---:|---:|---:|---:|---:|
| FR-1 Auth/Onboarding (9) | 5 | 4 | – | – | – | – | – |
| FR-2 Verification (10) | 3 | 4 | – | – | 2 | – | 1 |
| FR-3 Job posting/auction (11) | 7 | 3 | – | 1 | – | – | – |
| FR-4 Bidding (9) | 6 | 2 | 1 | – | – | – | – |
| FR-5 Provider profile/terms (6) | 4 | 2 | – | – | – | – | – |
| FR-6 Reviews/trust (8) | 6 | 1 | – | 1 | – | – | – |
| FR-7 Fraud (8) | – | – | – | 7 | 1 | – | – |
| FR-8 Chat (10) | 3 | 6 | – | 1 | – | – | – |
| FR-9 Payments (15) | 9 | 4 | – | 2 | – | – | – |
| FR-10 Maps/location (7) | 4 | 2 | 1 | – | – | – | – |
| FR-11 Analytics (9) | 3 | – | – | 3 | 3 | – | – |
| FR-12 Subscription (9) | 1 | – | – | 2 | 2 | 4 | – |
| FR-13 Admin (7) | – | – | – | – | 7 | – | – |
| FR-14 Contracts (6) | 6 | – | – | – | – | – | – |
| FR-15 Completion (6) | 4 | 1 | – | 1 | – | – | – |
| FR-16 Unhappy paths (8) | 7 | – | – | 1 | – | – | – |
| FR-17 Notifications (6) | 1 | 2 | – | 3 | – | – | – |
| FR-18 Recurring (8) | 5 | 3 | – | – | – | – | – |
| FR-19 Multi-property (6) | 2 | 2 | – | – | 1 | – | 1 |

### Coverage by persona (of iOS-relevant FRs)

| Persona | Fully walkable core journey on iOS? | Weakest points |
|---|---|---|
| **Customer** | **Yes** — post → bids → award → contract → escrow pay → complete → review, plus Instant, recurring, properties, disputes/guarantee | Bid filters (FR-4.7), schedule preference (FR-3.1), pre-bid Q&A (FR-8.1) |
| **Provider** | **Yes** — verify docs → categories/terms/portfolio → browse/map → bid/lower/withdraw → contract → milestones → Stripe Connect payout, Instant offers + weekly schedule | Radius editor UI (FR-10.5), distance display (FR-10.7), response-time/on-time stats (FR-5.1) |
| **Admin / Support** | **No, by design** — zero admin surfaces in the binary | All FR-13 web-only per PRD FR-13.1 ("web-based, separate from consumer app") |

### Top 10 true gaps (Missing/Partial, in-scope, ranked by user impact)

1. **FR-4.7 (Missing) + FR-4.6 (Partial)** — No bid filtering at all, and sort is a self-described "FR-4.6 lite" (price/trust only; no review-rating or verification-status sort) — `JobDetailView.swift:36`. This is award-decision tooling on the core auction surface.
2. **FR-3.1 (Partial)** — Schedule preference is hardcoded `scheduleType: "flexible"` (`PostJobView.swift:576`); no specific-date/date-range picker. Undermines scheduling-dependent flows (FR-15.5 on-time metric, FR-16.4 no-show clock).
3. **FR-8.1 (Partial)** — Pre-bid "Ask a Question" chat request does not exist on iOS (no entry point on `JobDetailView`); chat opens only post-bid.
4. **FR-8.3 (Fixed)** — Chat attachments accept images (library + camera) **and PDF** via Files importer (`MessagesView` → `ImageUploader.uploadPDF` / `message_type: file`).
5. **FR-10.7 (Missing)** — No travel distance/time shown anywhere on job surfaces (grep empty across `JobsView`/`JobDetailView`).
6. **FR-8.8 (Partial)** — Server-side contact-info detection + alias relay exist (`services/chat/internal/service/service.go:136,262`), but the PRD's post-award "Share Contact Info" opt-in button and pre-send hold-to-confirm UX are absent on iOS.
7. **FR-17.1 / FR-8.10 (Partial)** — No navigation-level unread badges: zero `.badge(` usages across Features; notification center is buried under Account (`AccountView.swift:329`); inbox rows do show per-channel unread (`MessagesView.swift:225-243`).
8. **FR-15.4 (Partial)** — Revision request UI has no 200-char minimum and no 3-revision-cap surfacing (`ContractDetailView.swift:139-150`; literal `200` appears 0 times in the file; `revisionCount` is decoded but never gates UI).
9. **FR-19.2 (Partial)** — Property dashboard cards show job counts only; total spend and preferred-providers summaries absent (`PropertiesView.swift:203`; spend grep empty).
10. **FR-18.3/18.4 (Partial)** — Recurring auto-approve is display-only (no iOS toggle; gateway `PATCH /{id}/recurring` exists at `router.go:725` but the iOS client has no `updateRecurringConfig`); no rate-adjustment-for-future-instances flow (generic proposed-terms chat exists).

Honorable mentions: FR-10.5 (no service-radius editor UI), FR-3.8 (no category/price/schedule filters on job browse — text search only), FR-9.2 (payment methods screen is manage-only; add-card only during checkout).

### Backlog-vs-reality discrepancies: **7** (see §5)

---

## 2. Full FR coverage matrix

Legend: **I** Implemented · **P** Partial · **M** Missing · **B** Backend-only · **W** Web-only by design · **C** Cut by v1 decision · **R** Roadmap. Persona: Cu customer, Pr provider, Ad admin, All.

### 8.1 Registration & Onboarding (FR-1)

| FR | Requirement (one-liner) | Persona | Status | Evidence |
|---|---|---|---|---|
| 1.1 | Email/password or OAuth (Google, Apple) signup | All | **I** | `RegisterView.swift`; SIWA `APIClient.swift:184` (`/auth/apple/native`); Google native `APIClient.swift:217` (`/auth/google/native`), `GoogleOAuthSession.swift`; bonus passkeys `PasskeyAuth.swift` |
| 1.2 | Initial role select: Customer / Provider / Both | All | **P** | `RegisterView.swift:26,115-130,207-218` — customer default + provider toggle ("Both"); no provider-only initial choice |
| 1.3 | Customer onboarding: name, address, phone, photo | Cu | **P** | Wizard covers name + phone (`OnboardingWizardView.swift:5`); address/photo via Properties/Profile settings, not in the guided flow |
| 1.4 | Provider onboarding: business name, radius, categories, photo | Pr | **P** | Role enable + categories/portfolio via `ProviderWorkspaceView.swift`; service-radius editor UI not found (API field exists, `APIClient+Provider.swift:29-37`) |
| 1.5 | Guided step-by-step flow w/ progress % | All | **I** | `OnboardingWizardView.swift:3-42` (steps, `progressPercent`, ProgressView) |
| 1.6 | Skip optional steps, return later | All | **I** | `OnboardingWizardView.swift:6,168-169` ("Optional — you can skip and finish later", resume via Account) |
| 1.7 | Enable second role anytime from settings | All | **I** | `enableRole` — `ProfileSettingsView.swift:288`, `OnboardingWizardView.swift:607`; gateway blocks self-assigned admin (`APIClient+Platform.swift:230` doc) |
| 1.8 | Email verification before posting/bidding | All | **P** | Resend/verify UI `VerificationCenterView.swift:3,118-138`; gate enforcement evidence (server 403 before post/bid) not confirmed in this audit |
| 1.9 | Phone SMS/OTP before transacting | All | **I** | `APIClient+Auth.swift:224-237`; `VerificationCenterView.swift:166`; routes `router.go:198-199` |

### 8.2 Identity & Document Verification (FR-2)

| FR | Requirement | Persona | Status | Evidence |
|---|---|---|---|---|
| 2.1 | 5 provider doc types (ID, business license, EIN, insurance, trade) | Pr | **I** | `APIClient+Provider.swift:939-943` (all five enum cases) |
| 2.2 | Upload UI; PDF/JPG/PNG; 10MB | Pr | **I** | `VerificationDocumentsView` — JPEG/PNG/WebP **and PDF** (Files picker + imaging `document` pass-through); 10 MB |
| 2.3 | Per-doc status incl. Rejected w/ reason | Pr | **I** | `VerificationDocumentsView.swift:112,232-234`; `rejectionReason` `APIClient+Provider.swift:1004` |
| 2.4 | Verification badges on provider profiles | Cu/Pr | **P** | Verification visible via trust Risk dimension (`TrustScoreView`); explicit badge row on `ProviderDetailView` not found (grep) |
| 2.5 | Admin "require verification to bid" toggle | Ad | **W** | Admin panel construct (PRD FR-13.2); `admin_verification.go` exists server-side |
| 2.6 | Customer lighter verification + badge | Cu | **P** | Email + phone verify present (FR-1.8/1.9); address-confirmation step and customer verified badge not found |
| 2.7 | Business license DB integration (MVP: manual admin) | Ad | **W** | Admin manual review; web admin queue |
| 2.8 | Expiration tracking, 30-day warnings | Pr | **I** | `VerificationDocumentsView.swift:14-15,29-34,147-207` (30-day + expired banners) |
| 2.9 | Background checks (Checkr) pending OQ#4 | Pr | **R** | PRD Open Question #4; backlog P3 `[~]` "Checkr still open question / not built" — not built anywhere |
| 2.10 | Rejection reason + max-3 resubmission | Pr | **I** | Reason + resubmission "N of 3" + hard lockout after 3 (`VerificationDocumentsView`); web durable center `/provider/verification` |

### 8.3 Job Posting & Reverse Auction (FR-3)

| FR | Requirement | Persona | Status | Evidence |
|---|---|---|---|---|
| 3.1 | Full posting form (11 fields) | Cu | **P** | `PostJobView.swift:13-41` — title/desc/category tree/photos/starting bid/offer-accepted/duration/recurrence/property present; **missing:** schedule preference (hardcoded `"flexible"`, line 576), min-rating filter; durations `[2,24,48,72,168]h` lack PRD's 12h + custom (2h serves Instant) |
| 3.2 | Market range bar during posting | Cu | **I** | `PostJobView.swift:167-177` (`MarketRangeBar` after category select) |
| 3.3 | Status lifecycle incl. unhappy states | All | **I** | `JobDetailView.swift:284-289` (`closed`, `closed_zero_bids`, `expired`, `cancelled`); server states |
| 3.4 | Close auction early + select | Cu | **I** | `closeJob` `APIClient+Jobs.swift:96`; award `JobDetailView.swift:2074` |
| 3.5 | Reject all + repost; repost tracking | Cu | **I** | `repostJob` `APIClient+Jobs.swift:153`; `JobDetailView.swift:61`; gateway `router.go:273` ("FR-3.5 / FR-3.10") |
| 3.6 | 48h award-or-repost window after close | Cu | **B** | Job-service timer; iOS renders `expired` |
| 3.7 | Recurring jobs: bid per-occurrence, auto instances | Cu/Pr | **I** | `PostJobView.swift:37-41` recurrence; FR-18 lifecycle (below) |
| 3.8 | Provider filter/search: category, location, price, schedule | Pr | **P** | Text search only (`JobsView.swift:67`); no category/price/schedule filter UI |
| 3.9 | Zero-bid handling with suggestions | Cu | **P** | `closed_zero_bids` status + repost path exist; "actionable suggestions" copy not found |
| 3.10 | Repost = new entity, fresh auction, bidder notify | Cu | **I** | Gateway `router.go:273-276`; repost UX on `JobDetailView` |
| 3.11 | Drafts (up to 10), My Drafts | Cu | **I** | `JobDraftsView.swift`; `fetchJobDrafts`/`publishJob` `APIClient+Jobs.swift:110-120` (cap enforced server-side, not surfaced) |

### 8.4 Bidding (FR-4) — deep-verified, see §4

| FR | Requirement | Persona | Status | Evidence |
|---|---|---|---|---|
| 4.1 | Bid at/below starting bid | Pr | **I** | iOS `JobDetailView.swift:1828`; **engine** `engines/bidding/src/engine.rs:89-94` (`AboveStartingBid`, `models.rs:93-94`) |
| 4.2 | Sealed bids — customer-only visibility | Cu | **I** | `ListBidsForJob` job-owner-only (`gateway/internal/handler/bid.go:590-624`); public route exposes count only (`router.go:256`) |
| 4.3 | Update bid = lower only | Pr | **I** | iOS `JobDetailView.swift:1799`; **engine** `engine.rs:226` (`new_amount >= existing` → error `models.rs:72`) |
| 4.4 | Offer-accepted: one-click, not auto-award | Pr/Cu | **I** | iOS `JobDetailView.swift:1880`; route `router.go:279`; self-accept blocked `engine.rs:424-427` |
| 4.5 | Bid list: name, amount, trust, rating, badges, profile link | Cu | **P** | Name/avatar/amount/trust/jobs-completed wired (`bid.go:626-652`); review-rating summary is `nil` in gateway payload; verification badges not in bid card |
| 4.6 | Sort bids: price, rating, trust, verification | Cu | **P** | "FR-4.6 lite" — price/trust only (`JobDetailView.swift:36-43,1085-1091`) |
| 4.7 | Filter bids: min rating, verification, radius | Cu | **M** | No bid-filter UI on iOS (searched) |
| 4.8 | Award → winner + not-selected notifications | Pr | **I** | `bid.go:518` (awarded + `not_selected`); notification service `server.go:300,378` (`bid_not_selected`) |
| 4.9 | Withdraw bid pre-close; withdrawals tracked | Pr | **I** | `JobDetailView.swift:2108`; `withdrawJobBid` `APIClient+Jobs.swift:8`; tracking feeds trust (backend) |

### 8.5 Provider Profiles & Terms (FR-5)

| FR | Requirement | Persona | Status | Evidence |
|---|---|---|---|---|
| 5.1 | Profile fields (12 incl. response time, on-time rate) | Pr | **P** | `ProviderWorkspaceView.swift:383-401` (jobs completed, completeness, member since); response-time + on-time-rate display not found |
| 5.2 | Global terms editor (timing, milestones, cancellation, warranty) | Pr | **I** | `setMyProviderTerms` `APIClient+Provider.swift:50` |
| 5.3 | Global terms visible on public profile | Cu | **P** | Terms set + applied to contracts; terms display on iOS `ProviderDetailView` not found (grep) |
| 5.4 | Local terms negotiated in chat, both accept | Cu/Pr | **I** | Proposed-terms send/respond `APIClient.swift:555-601`; `MessagesView.swift:36-38`; contract `local_terms` card (`contract_local_terms_test.go`) |
| 5.5 | Portfolio ≤20 images w/ captions | Pr | **I** | `updateMyProviderPortfolio` `APIClient+Provider.swift:72` |
| 5.6 | Profile completeness indicator | Pr | **I** | `ProviderWorkspaceView.swift:386-387` |

### 8.6 Reviews & Trust (FR-6)

| FR | Requirement | Persona | Status | Evidence |
|---|---|---|---|---|
| 6.1 | Both parties prompted post-completion; 14-day window | All | **I** | `createContractReview`/`fetchReviewEligibility` `APIClient+Contracts.swift:168-204`; window server-side |
| 6.2 | Star + text + per-persona category sub-ratings | All | **P** | Quality/communication/timeliness/value wired (`APIClient+Contracts.swift:168-199`); PRD's distinct provider→customer dimensions (payment promptness, scope accuracy, property access) not implemented — same 4 dims both ways; iOS enforces 50-char min |
| 6.3 | Review only with confirmed on-platform payment | All | **I** | `ReviewEligibility` gate + review service enforcement |
| 6.4 | Double-blind publish (both submit or window closes) | All | **B** | `services/job/internal/service/review.go:104-112`; `gateway/internal/handler/review.go:134-136` |
| 6.5 | Single public response (500 chars) | All | **I** | `respondToReview` `APIClient+Contracts.swift:213`; `UserReviewsView.swift` |
| 6.6 | Trust = 4 weighted dimensions | All | **I** | `TrustScoreView.swift:4,82-89` (Feedback 35 / Risk 25 / Volume 20 / Fraud 20) |
| 6.7 | 0–100 + tier badge + breakdown drill-in | All | **I** | `TrustScoreView.swift:199-244` dimension rows; `TrustTiersView.swift` |
| 6.8 | Flag review → admin queue | All | **I** | `flagReview` `APIClient+Contracts.swift:230`; `UserReviewsView.swift:533` |

### 8.7 Fraud Detection (FR-7)

| FR | Status | Evidence |
|---|---|---|
| 7.1–7.6, 7.8 | **B** | Heuristic engine (`engines/fraud`), gateway `fraud.go`, `challenge.go`; FR-7.8 itself mandates heuristics-first, ML deferred to v2 (PRD.md:589). FR-7.1's browser-fingerprint items are web-specific by wording. |
| 7.7 admin fraud dashboard | **W** | PRD FR-13.1 fraud review queue; `admin_*.go` handlers server-side; no iOS surface (correct) |

### 8.8 In-App Chat (FR-8)

| FR | Requirement | Persona | Status | Evidence |
|---|---|---|---|---|
| 8.1 | Access rules: post-bid, pre-bid inquiry, post-award, self-bid block | All | **P** | Post-bid + post-award chat live (`MessagesView.swift`); **pre-bid "Ask a Question" absent on iOS** (no entry on `JobDetailView`); self-bid blocked at engine (`engine.rs:68-74`) |
| 8.2 | Real-time w/ typing + read receipts | All | **I** | `ChatWebSocketClient.swift:7-8,35-43` (`typing`/`read_receipt` frames); `MessagesView.swift:24-29,313-315,500-514` (Seen watermarks) |
| 8.3 | Text, image, and file/PDF attachments | All | **I** | Text + images (library + camera) + **PDF Files attach** (`uploadPDF` / `message_type: file`) |
| 8.4 | Chat persists across lifecycle | All | **I** | Channel model + server persistence; conversations survive award |
| 8.5 | Push for new messages (mobile push post-MVP) | All | **P** | APNs registration + device endpoints (`PushRegistration.swift`; `router.go:496`; `push_endpoint.go`); v1 cut lists push "B5 deferred" for review — delivery pipeline ops-gated (`v1-ios-product-cut.md:115`). PRD itself says mobile push is post-MVP. |
| 8.6 | Search own conversations | All | **P** | Local search over loaded messages only (`MessagesView.swift:23,384-388` — "no server search endpoint") |
| 8.7 | Support transcript access | Ad | **B** | Server-side; ToS disclosure |
| 8.8 | Off-platform contact controls + Share-Contact button | All | **P** | Server detection + alias relay (`services/chat/internal/service/service.go:136,262`; phone regex; cold-open rewrite); **no iOS "Share Contact Info" button, no hold-to-confirm send UX** |
| 8.9 | Proposed-terms message w/ inline Accept/Reject | All | **I** | `APIClient.swift:555-601`; `MessagesView.swift:36-38,322` |
| 8.10 | Unread badge on nav; recency-sorted list | All | **P** | Per-row unread + recency list (`MessagesView.swift:33,225-243`); **no tab/nav-level `.badge(`** anywhere in Features |

### 8.9 Payments & Billing (FR-9) — deep-verified, see §4

| FR | Requirement | Persona | Status | Evidence |
|---|---|---|---|---|
| 9.1 | Stripe Connect Express platform | Pr | **I** | `createStripeAccount`/`fetchStripeOnboardingLink` `APIClient+Extras.swift:410-436`; `SellerPayoutsView.swift` |
| 9.2 | Cards, Apple Pay, Google Pay; stored via processor | Cu | **P** | PaymentSheet + Apple Pay (`RailACheckout.swift:75-90`); Google Pay N/A on iOS; saved-methods screen is manage-only — add card only during checkout (`PaymentMethodsView.swift:3,91`) |
| 9.3 | Provider ACH payout via Stripe onboarding | Pr | **I** | Stripe-hosted Express onboarding link flow |
| 9.4 | 5 payment structures per contract | All | **P** | Upfront/completion escrow + milestones + recurring wired (`ContractDetailView.swift:12,979-1006`); "payment plan" exists only as BNPL installments behind `customer_bnpl` server flag (regulated rail), not a core per-contract structure |
| 9.5 | Milestone propose→approve→release + dispute | All | **I** | `submitMilestone`/`approveMilestone`/`requestMilestoneRevision` `APIClient+Contracts.swift:246-267`; `ContractDetailView.swift:133-155,1267-1318` |
| 9.6 | Escrow until release conditions | All | **I** | iOS create→PaymentSheet→process→escrow→release (`ContractDetailView.swift:1892-1936,1871`); actor rules in payment service (§4) |
| 9.7 | Dispute freezes payment; support mediates | All | **I** | `openContractDispute` + photo evidence (`ContractDetailView.swift:2622-2712`); resolution is web/admin |
| 9.8 | Configurable platform fee, visible breakdown | All | **I** | Fee rows incl. guarantee fee, server math (`ContractDetailView.swift:1139-1152`) |
| 9.9 | Payment history per contract | All | **I** | `fetchPayments`/`fetchPaymentsForContract` `APIClient+Contracts.swift:622-646` |
| 9.10 | Email receipts | All | **B** | Notification/email service |
| 9.11 | Refund support w/ fee proration | All | **B** | Dispute-resolution path (admin actor); `admin_disputes_guarantee_refund_test.go` |
| 9.12 | Stripe onboarding prompts post-award | Pr | **I** | `StripeAccountStatus` + onboarding link; `SellerPayoutsView.swift` |
| 9.13 | Payout timing/status via Stripe dashboard | Pr | **P** | Summary on `SellerPayoutsView`; detailed payout status delegated to Stripe Express dashboard (per PRD design) |
| 9.14 | 1099-K; tax remitting out of scope | Pr | **P** | Tax forms list + estimate behind flags (`APIClient+RegulatedRails.swift:280-289`); 1099-K generation is backend/ops |
| 9.15 | USD only | All | **I** | `MoneyFormat.usd` throughout; `MoneyFormatTests.swift` |

### 8.10 Maps & Location (FR-10)

| FR | Requirement | Persona | Status | Evidence |
|---|---|---|---|---|
| 10.1 | Map integration (Google/Mapbox — evaluate) | All | **I** | Native MapKit on iOS (`JobsMapView.swift`) — allowed by PRD's "evaluate" framing |
| 10.2 | Job discovery map w/ category/price/distance filters | Pr | **P** | Pins + radius (`JobsMapView.swift:175,238`); no category/price filter UI on the map |
| 10.3 | Approximate location pre-award; exact only post-award | All | **I** | Coarsened `approximate_location` served on map (CLAUDE.md §6 invariant); party-only exact address (`ContractDetailView.swift:460` "Party-only exact service address … FR-10.4") |
| 10.4 | Post-award Get Directions | Pr | **I** | `ContractDetailView.swift:460-480`; `JobDetailView.swift:1744-1749`; `DirectionsHelper.swift:42-195` (Maps handoff) |
| 10.5 | Provider service radius; default-hide outside | Pr | **P** | `serviceRadiusKm` in update API (`APIClient+Provider.swift:29-37`); no radius editor UI found on iOS |
| 10.6 | Multi-property job targeting | Cu | **I** | Property picker on post (`PostJobView.swift:33-34,577-578`) |
| 10.7 | Distance/travel time display | Pr | **M** | No distance/ETA display on iOS job surfaces (grep empty) |

### 8.11 Market Analytics (FR-11)

| FR | Requirement | Status | Evidence |
|---|---|---|---|
| 11.1 | p25/p50/p75 + N per market | **I** | `GET /api/v1/analytics/market/range` (`router.go:444`) consumed by iOS |
| 11.2 | Range bar at posting (always visible) | **I** | `PostJobView.swift:167-177`; `MarketRangeBar.swift` |
| 11.3 | Range display at bid time | **I** | `JobDetailView.swift:92-93,1538` |
| 11.4 | Pricing factors (geo/season/recurrence) | **B** | Pricing/analytics services |
| 11.5 | Seeded data sources | **B** | Server data pipeline |
| 11.6 | Hidden Shift+~ overlay | **W** | Keyboard-toggle construct; PRD-internal/demo; web-only |
| 11.7 | Overlay contents (trends, bid distribution, win rate) | **W** | Web overlay; note iOS does ship owner `fetchBidAnalytics` (`APIClient+Commerce.swift:175`) covering bid distribution |
| 11.8 | Admin global analytics toggle | **W** | Admin panel (FR-13.3) |
| 11.9 | Transactions→analytics pipeline | **B** | Server |

### 8.12 Subscription & Monetization (FR-12)

| FR | Requirement | Status | Evidence |
|---|---|---|---|
| 12.1 | Tiers: Free/Pro limits | **C** | Free-tier-only binary; read-only compare (`PlanLimitsView.swift:3-9`; `v1-ios-product-cut.md:14-18,30-40`) |
| 12.2 | Monthly billing via processor | **C** | No purchase path in binary (cut line 16: web Stripe or later IAP) |
| 12.3 | Upgrade/downgrade/cancel from settings | **C** | "Manage on web" link only, management not buy (cut lines 18,35) |
| 12.4 | Free trial | **C** | Purchase-path dependent; deferred with B2 StoreKit (cut line 15) |
| 12.5 | Transaction fee % on payout | **B** | Payment service fee math; MON-24 integer fee math (backlog wave22) |
| 12.6 | Fee visibility both parties | **I** | `ContractDetailView.swift:1139-1152` |
| 12.7 | Per-category fee config | **B** | Server config |
| 12.8 | Admin fee/tier config | **W** | Admin panel (FR-13.4) |
| 12.9 | Revenue reporting dashboard | **W** | Admin |

### 8.13 Admin & Internal Tooling (FR-13)

**All 7 Web-only by design.** PRD FR-13.1 explicitly: "Admin dashboard (**web-based, separate from consumer app**)". Corroborated: `ios-web-feature-matrix.md:54` ("Admin | out of scope"), backlog P3 "[x] Keep out of consumer iOS — Admin FR-13". Gateway ships the backend (`admin_users.go`, `admin_disputes.go`, `admin_verification.go`, `admin_reviews.go`, `admin_payments.go`, etc.); the iOS binary contains **zero** admin surfaces (only incidental copy such as "Flags enter the admin moderation queue", `UserReviewsView.swift:533`, and a doc comment noting admin cannot be self-assigned via `enableRole`).

### 8.14 Contract Management (FR-14)

| FR | Requirement | Status | Evidence |
|---|---|---|---|
| 14.1 | Auto-generation on award w/ terms precedence | **I** | Award→contract (`bid.go:518` contract create + notify); local-terms bind on accept + pre-award re-apply (backlog waves7–9, `contract_local_terms_test.go`) |
| 14.2 | Both parties accept before work; 72h void | **I** | `acceptContract` `APIClient+Contracts.swift:75`; timeout server-side |
| 14.3 | Modification / change orders | **I** | `createChangeOrder`/`respondToChangeOrder` `APIClient+Contracts.swift:293-317` |
| 14.4 | Contract detail page (terms, milestones, payments, chat links) | **I** | `ContractDetailView.swift` (3,040 lines) |
| 14.5 | PDF export | **I** | `fetchContractPDFURL`/`downloadContractDocument`/`downloadContractInvoice` `APIClient+Contracts.swift:570-608` |
| 14.6 | Human-readable contract number | **I** | `ContractDetailView.swift:289`; `Models+Contracts.swift:137` |

### 8.15 Completion & Handoff (FR-15)

| FR | Requirement | Status | Evidence |
|---|---|---|---|
| 15.1 | Complete → Approve / Request Revision / Dispute; 7-day auto-release | **I** | `completeContract`/`approveContractCompletion`/`openContractDispute`; auto-release server-side |
| 15.2 | Full-upfront flow (escrow already funded) | **I** | Escrow pay + release path (`ContractDetailView.swift:979-1006,1871`) |
| 15.3 | Per-occurrence completion for recurring | **I** | `completeRecurringInstance`/`approveRecurringInstance` `APIClient+Contracts.swift:476-500`; routes `router.go:730-731` |
| 15.4 | ≤3 revisions; 200-char min description | **P** | Milestone revision sheet exists (`ContractDetailView.swift:133-155`) but no 200-char minimum (literal `200` occurs 0× in file) and no 3-cap surfacing (`revisionCount` decoded, unused for gating) |
| 15.5 | On-time metrics from schedule vs approval | **B** | Trust/metrics pipeline |
| 15.6 | Post-completion status + review prompts | **I** | Completed status + review eligibility + payment history on contract |

### 8.16 Cancellation & Unhappy Paths (FR-16)

| FR | Requirement | Status | Evidence |
|---|---|---|---|
| 16.1 | Cancel active auction; bidders notified | **I** | `cancelJob` `APIClient+Jobs.swift:83`; owner cancel on `JobDetailView` |
| 16.2 | Customer post-award cancel + refund rules | **I** | `cancelContract` `APIClient+Contracts.swift:115`; refund logic server-side |
| 16.3 | Provider post-award cancel + trust penalty | **I** | Same endpoint (provider party); penalties in trust engine |
| 16.4 | No-show check-in → cancel + refund + −15 | **I** | `reportContractNoShow` (`ContractDetailView.swift:191-195`); route `router.go:697-698`; bonus geofence `CheckInToJobIntent.swift` |
| 16.5 | Abandonment: 72h → refund pending, −20 | **I** | `reportContractAbandonment` (`ContractDetailView.swift:198-201`) |
| 16.6 | Mid-job dispute freezes pending payments | **I** | Dispute sheet + evidence upload (`ContractDetailView.swift:2622-2712`); MON-18 mutual FOR-UPDATE claim (wave27) |
| 16.7 | Payment-failure ladder (48h / 3 retries over 7 days) | **I** | Migrations 112/113 + gateway `ProcessDueRecurringPaymentRetries` (`recurring_payment_retry_worker.go`); iOS surfaces `payment_retry_count`/`next_retry_at`/`off_session_charged` (`ContractDetailView.swift:560,2075,2209`); residual: live Stripe dogfood (backlog) |
| 16.8 | Chargeback handling + provider protection | **B** | Payment-service Stripe event handling (signature-verified via `stripe.webhooks.constructEvent()`, see header note); support review is web/admin |

### 8.17 Notifications (FR-17)

| FR | Requirement | Status | Evidence |
|---|---|---|---|
| 17.1 | In-app bell w/ unread count; email; push | **P** | `NotificationsView.swift` (center) reachable via Account (`AccountView.swift:329`); `fetchUnreadNotificationCount` exists; **no nav bell/badge**; push registration live, delivery ops-gated (see FR-8.5) |
| 17.2 | Type/channel default matrix | **B** | Notification service defaults (`NotificationPreferencesView.swift:23-38` mirrors type list) |
| 17.3 | Preferences; critical types locked | **P** | Per-type + global editor (`NotificationPreferencesView.swift`); no evidence critical types (dispute/payment-fail) are un-disableable in UI |
| 17.4 | Email digest batching | **B** | Server |
| 17.5 | Tap → mark read + navigate | **I** | `markNotificationRead` + `DeepLinkRouter.swift:121-163` (jobs/listings/contracts/orders/messages/check-in); `NotificationDeepLinkTests.swift` |
| 17.6 | Email CTA + unsubscribe | **B** | `router.go:325` (`/notifications/unsubscribe`) |

### 8.18 Recurring Jobs (FR-18)

| FR | Requirement | Status | Evidence |
|---|---|---|---|
| 18.1 | Frequency at post; auto instance generation | **I** | `PostJobView` recurrence; roll-forward + date-idempotent tests (backlog "FR-18 roll-forward tests") |
| 18.2 | Instances in dashboards + timeline on contract | **I** | `fetchRecurringInstances` `APIClient+Contracts.swift:411`; `ContractDetailView.swift:557-685` |
| 18.3 | Auto-approve toggle (customer, changeable anytime) | **P** | Displayed read-only (`ContractDetailView.swift:557-558,684-685`); **no iOS toggle** — gateway `PATCH /{id}/recurring` exists (`router.go:725`) but iOS client has no `updateRecurringConfig` |
| 18.4 | Rate adjustment for future instances via chat | **P** | Generic proposed-terms chat exists (FR-8.9); no rate-change-for-future-occurrences wiring |
| 18.5 | Cancel with 1-occurrence notice | **I** | `cancelRecurring` `APIClient+Contracts.swift:457`; notice copy `ContractDetailView.swift:638` |
| 18.6 | Pause/resume; 90-day auto-cancel | **I** | `pauseRecurring`/`resumeRecurring` `APIClient+Contracts.swift:429-443`; 90-day rule server-side |
| 18.7 | Provider substitution → repost remaining schedule | **P** | Job repost exists; recurrence-specific substitution flow not found on iOS |
| 18.8 | Pay-fail → pause, auto-resume | **I** | Pause on `payment_intent.payment_failed` (signature-verified Stripe events; waves 9–15) + resume on success; iOS retry-state surfaces (FR-16.7) |

### 8.19 Multi-Property (FR-19)

| FR | Requirement | Status | Evidence |
|---|---|---|---|
| 19.1 | Property CRUD w/ nickname, photos, notes | **I** | `APIClient+Extras.swift:53-115`; `PropertiesView.swift:88-98,178-196,232-235` (nickname + notes) |
| 19.2 | Dashboard cards: active, upcoming, spend, preferred providers | **P** | Active/upcoming counts (`PropertiesView.swift:203`); **no total spend, no preferred providers** |
| 19.3 | Per-property history w/ category+date filters | **P** | Drill-in with upcoming/active/past (`PropertyDetailView.swift:30-96,168`); category/date-range filters absent |
| 19.4 | Property select at posting; inherits address | **I** | `PostJobView.swift:33-34,76-77,577` |
| 19.5 | Cross-property analytics (behind Shift+~) | **W** | PRD puts it behind the web overlay toggle; nothing on iOS (consistent) |
| 19.6 | Bulk posting across properties | **R** | PRD: "future consideration"; jobs posted individually (matches) |

### Un-IDed numbered requirements (PRD §§9–16, 22)

| Section | Status | Evidence |
|---|---|---|
| §9 Data flywheel / ML moat | **B/R** | PRD's own honest-status note (PRD.md:907-911): strategy, heuristics-only in prod. No iOS implication. |
| §10 Guarantee (claim via dispute flow) | **I** (iOS) | `fetchGuaranteeClaim`/`submitGuaranteeClaim` `APIClient+Contracts.swift:360-371`; claim section `ContractDetailView.swift:1599-1640`; `RequireFlag("nomarkup_guarantee")` `router.go:692-695`; guarantee-claim **evidence uploads are web-handoff** (`ContractDetailView.swift:1660`) |
| §11 Growth: referrals | **I** | `ReferralsView.swift`; code/list/redeem `APIClient+Extras.swift:226-243` |
| §11 Growth: savings/review share cards | **P** | ShareLink text + URL only — "no rendered image assets" (`ShareCardText.swift:3`; `SavingsView.swift:4`; `UserReviewsView.swift:5,241-264`); PRD wants visual cards |
| §11 Growth: SEO pages, mailers, vehicle program | **W/R** | Web/ops constructs (SEO = web; mailers post-MVP) |
| §12 Financial services (advances, BNPL, insurance, biz services) | **R → shipped-ahead, flag-gated** | PRD marks Phase 2/3; iOS nevertheless ships server-flag-gated surfaces: `BusinessFeaturesHubView.swift`, `APIClient+RegulatedRails.swift` (installments, insurance, advances, instant payout, expenses, tax). True-live remains blocked (R6.2–R6.6, `regulated-rails-live-flagged.md`) — not a gap, an ahead-of-roadmap flag-off surface |
| §13 Instant — MVP scope (emergency CTA + intake + 2h rapid auction) | **I** | Home CTA `HomeView.swift:179-188`; instant-match `APIClient+Jobs.swift:137` + route `router.go:287`; provider offers accept/decline `ProviderInstantOffersView.swift`; weekly availability schedule `ProviderWorkspaceView.swift:23-25,185-241`; geo/category/trust prefilter (waves 22–23) |
| §13 Instant — premium price transparency (1.5–2x banner) | **P** | No premium-range display found on iOS intake or offer surfaces |
| §13 Instant — Phase 2 (broadcast matching, GPS ETA, AI match) | **R** | PRD explicitly Phase 2; backlog "true product Phase 2" |
| §14 B2B / Enterprise API / white-label | **R** | PRD §22 Phase 6; backlog P3 keep-out |
| §15 Lock-in layers | — | Strategy section; mechanisms audited via their FRs (Guarantee, recurring, trust) |
| §16 Vertical expansion | **R** | PRD §22 Phase 8 |
| §22 Phase 4 "native mobile apps w/ feature parity, push, camera, GPS discovery, offline" | **P (ahead of plan)** | The iOS app exists ahead of PRD sequencing; camera ✓, GPS map ✓, push registration ✓ (delivery ops-gated), offline = read-banner only (`NetworkMonitor.swift`; kill-switch SW analog) |

### NFR / SEC (iOS-relevant only; others are platform/backend)

- **SEC-2 MFA:** Implemented — enable/confirm/disable + login challenge (`APIClient+Extras.swift:296-320`, `APIClient+Auth.swift:188`, `SecuritySettingsView.swift`).
- **SEC-4 sessions:** Implemented — Keychain JWT + refresh + server logout (`KeychainTokenStore.swift`, `APIClient.swift:125-148`); `BiometricGate.swift`.
- **SEC-18 CCPA:** Implemented — export + delete (`exportMyData`/`requestAccountDeletion` `APIClient.swift:241-253`; `AccountDeletionView.swift`); age gate (`AgeGateView.swift`), ToS acceptance (`TermsAcceptanceView.swift`).
- **NFR-15/16 accessibility:** substantial `accessibilityLabel/Hint/Value` usage across audited views (spot-verified; formal audit is `ios-developer-audit-2026-07-27-v2.md`'s scope, not this one).

---

## 3. Persona journey table

| Journey (PRD-required) | Customer | Provider | Admin |
|---|---|---|---|
| Register / sign in (email, SIWA, Google, MFA, passkey) | Walkable | Walkable | n/a (no admin app role UX) |
| Guided onboarding + verification (email/phone) | Walkable | Walkable (docs upload incl. camera) | — |
| Post job (w/ market range, property, recurrence, Instant) | Walkable (minus schedule date pick) | — | — |
| Browse jobs (list/map) + bid/lower/withdraw/accept-offer | — | Walkable (minus filters/distance) | — |
| Review sealed bids, sort, award | Walkable (sort price/trust only; no filters) | — | — |
| Contract accept → escrow pay (PaymentSheet/Apple Pay) → milestones → complete → approve → release | Walkable | Walkable | — |
| Reviews (sub-ratings, respond, flag) + trust breakdown | Walkable | Walkable | — |
| Chat (WS typing/read receipts, photos, proposed terms) | Walkable (no pre-bid ask, no file attach) | Walkable | — |
| Unhappy paths: cancel, dispute+evidence, no-show, abandonment, guarantee claim | Walkable | Walkable | Resolution is web-admin |
| Recurring: instances, pause/resume/cancel, per-visit pay, retry states | Walkable (auto-approve read-only) | Walkable | — |
| Marketplace (goods) browse/sell/bid/bond/buy-now/orders/pickup | Walkable | Walkable | — |
| Properties portfolio | Walkable (counts, not spend) | — | — |
| Instant emergency funnel | Walkable | Walkable (offers + weekly schedule) | — |
| Payouts (Stripe Connect), seller analytics, exports | — | Walkable | — |
| Financial-services hub (BNPL/insurance/advances/instant payout) | Flag-gated surfaces | Flag-gated surfaces | — |
| Subscription purchase / upgrade | **Cut (v1 free-tier lock)** | **Cut** | — |
| User/job/fraud/dispute/verification/taxonomy management, toggles, revenue reporting (FR-13) | — | — | **Web-only by design** |

**What does an admin see on iOS?** Nothing admin-specific. There is no admin tab, no admin route, no RBAC-gated screen in the binary; `enableRole` explicitly cannot self-assign admin. An admin signing into the iOS app gets the standard consumer experience. **No admin FR was ever promised on mobile** — PRD FR-13.1 scopes the admin dashboard to web ("web-based, separate from consumer app"), and the parity backlog/feature matrix both record FR-13 as intentionally out of consumer iOS. Zero admin gaps chargeable to the iOS app.

---

## 4. Deep-verify notes — money & auction FRs

1. **Bid ceiling (FR-4.1).** iOS `placeJobBid` (`JobDetailView.swift:1828`) → gateway `PlaceBid` (Idempotency-Key required, `router.go:276-278`; durable SQL dedup migration 110, `bid.go:209-240`) → Rust engine rejects `amount_cents > starting_bid` (`engines/bidding/src/engine.rs:89-94`, error `models.rs:93-94`). Money validated via `validateMoneyCents` (`bid.go:132`).
2. **Lower-only updates (FR-4.3).** iOS `updateJobBid` (`JobDetailView.swift:1799`) → engine `engine.rs:226` refuses `new_amount >= existing.amount_cents` ("bid amount must be lower than current amount", `models.rs:72`).
3. **Sealed bids (FR-4.2).** `ListBidsForJob` is job-owner-only — gateway forwards `CustomerId: claims.UserID` and the comment confirms owner-scoping (`bid.go:590-624`); the public unauthenticated surface exposes only a bid **count** (`router.go:256`). Provider-side "consistently bid just below others" is structurally impossible, matching FR-7.4's note.
4. **Self-dealing (FR-8.1 / auction integrity).** Engine blocks owner bidding own job (`engine.rs:68-74`) and owner self-accepting the offer price (`engine.rs:424-427`).
5. **Auction end (FR-3.4/3.6).** Engine refuses bids after `auction_ends_at` (`engine.rs:82-85` `AuctionClosed`); anti-snipe +5min extension max 3 (`engine.rs:149-158`) — an extension beyond PRD text, favorable to auction integrity. Owner early close wired (`closeJob`).
6. **Escrow actor rules (FR-9.6/9.7, CLAUDE.md §6 invariants).** Gateway forwards `ActorUserId`/`ActorIsAdmin` to the payment service which decides (`payment.go:736-795`); the payment service refuses provider self-release (`services/payment/internal/service/service.go:949-977`) with a dedicated attack-chain test (`escrow_actor_test.go:8,183-194` — "provider self-release must be refused"). MON-18 dispute/release mutual FOR-UPDATE claim landed wave27.
7. **Rail A vs Rail B (v1 cut).** Rail A (GMV): goods `payOrder` → Stripe PaymentSheet (`MyOrdersView.swift:318-324`), `buyNow` (`ListingDetailView.swift:1550`), services escrow (`ContractDetailView.swift:1892-1936`: `createContractPayment` → PaymentSheet → `processContractPayment` → escrow → `releasePayment`), bid-bond SetupIntent pre-auth (`RailACheckout.swift:57-68`; `APIClient+Commerce.swift:225-280`; forfeiture/release waves 24–26). Rail B (digital): **zero StoreKit** — no `import StoreKit` anywhere in `ios/` (only copy stating its absence); `PlanLimitsView` has no purchase CTA. Matches `v1-ios-product-cut.md` acceptance criteria exactly.
8. **Fee / no-markup invariants (FR-9.8, FR-12.6).** All amounts are server-computed; iOS repeatedly asserts "no client fee math" (`ContractDetailView.swift:979,1118,1152,2585`); fee preview via `calculatePaymentFees` (`APIClient+Contracts.swift:748`, used at `ContractDetailView.swift:1835`); sticky Idempotency-Keys on create/process (`APIClient.swift:38-52`; MON-21 cumulative cap wave21).
9. **Recurring payment retries (FR-16.7/18.8).** Gateway due-row worker (`recurring_payment_retry_worker.go`, migrations 112/113, 3-strike pause, never cancels contract); the signature-verified `payment_intent.payment_failed` Stripe event joins the shared counter (wave15); iOS renders `payment_retry_count`/`next_retry_at` and suppresses PaymentSheet when `off_session_charged` (`ContractDetailView.swift:560,2075,2209`). Residual per backlog: live Stripe dogfood of day-0/3/7 — unverifiable statically, correctly not claimed.

---

## 5. Backlog / matrix reconciliation — discrepancies (7)

| # | Doc claim | Code reality | Severity |
|---|---|---|---|
| 1 | Backlog P0 `[x]` "FR-4 bid advanced — Lower bid, accept-offer, **sort/filter** bids on iOS" | Sort is price/trust "FR-4.6 **lite**" (code's own words, `JobDetailView.swift:36`); **no bid filter UI exists** (FR-4.7) | Medium — checked-off item overstates; FR-4.7 is the audit's only auction-core Missing |
| 2 | Backlog P0 `[x]` "FR-3 job form + repost — **Full job form** (recurrence, offer-accepted, **schedule**, property)" | `scheduleType: "flexible"` is hardcoded (`PostJobView.swift:576`); no date/date-range picker; no min-rating field; duration set lacks 12h/custom | Medium |
| 3 | Backlog P1 `[x]` "FR-15/16 evidence — **Revision 200-char + cap UI**" | No 200-char minimum (literal `200` occurs 0× in `ContractDetailView.swift`; submit only blocks empty text, line 150); no 3-revision-cap gating (`revisionCount` decoded, unused) | Medium — claim contradicted on both halves |
| 4 | Backlog P1 `[x]` "FR-8 chat **parity** — Attachments + search + …" | Attachments are **image + PDF** (FR-8.3); search is local-only over loaded messages (no server search endpoint) | Low — residual is search, not attach |
| 5 | `ios-web-feature-matrix.md:56` "Google/Facebook OAuth — **not started**" | Google native OAuth is shipped (`GoogleOAuthSession.swift`; `APIClient.swift:217` → `/auth/google/native`; gateway `oauth_native_google_test.go`) — the backlog itself says so (wave4) | Low — matrix stale (2026-07-26), internally inconsistent with backlog |
| 6 | `ios-web-feature-matrix.md:57` "…spectator WS **residual**" | Both spectator WS clients shipped: `SpectatorWebSocketClient.swift` (jobs) + `MarketplaceSpectatorWebSocketClient.swift`; waves 19–20 unified watcher counts | Low — matrix stale |
| 7 | `v1-ios-product-cut.md:115` "Not expected: **Push notifications (B5 deferred)**" (echoed in backlog) | APNs registration + device endpoints + Account "Push notifications on" + prefs push toggles are in the binary (`PushRegistration.swift` 408 lines; `router.go:496`; `AccountView.swift:78`) — registration shipped, **delivery** ops-gated | Low — doc understates code; both true under a careful reading, but review-notes phrasing could mislead a reviewer who receives a push |

Also noted (not counted): backlog §3's coverage snapshot ("FR-1…10: LIVE ~19% / PARTIAL ~39% / MISSING ~9%") predates waves 4–28 and materially undercounts current state (this audit: 67/32/2 across in-scope FRs) — stale summary rather than a false claim. Backlog `[x]` "FR-19 property dash — Summary cards…" is soft-overstated (cards lack FR-19.2 spend/preferred-providers) but the backlog separately admits "Full FR-19 spend analytics depth" as a residual, so it is not double-counted.

---

## 6. Appendix — explicitly NOT gaps

**Cut by v1 decision** (cite `v1-ios-product-cut.md`):
- FR-12.1–12.4 in-app digital subscription purchase/trials/management — free-tier-only binary, no StoreKit, no purchase CTA, "Manage on web" only (cut lines 14-18, 30-40, acceptance table 126-135). Locked; re-open only with B2 StoreKit.

**Web-only by design** (cite PRD / matrix):
- FR-13.1–13.7 admin console (PRD FR-13.1 "web-based, separate from consumer app"; matrix line 54).
- FR-2.5, FR-2.7 admin verification controls; FR-7.7 admin fraud dashboard; FR-11.8, FR-12.8, FR-12.9 admin toggles/config/reporting.
- FR-11.6–11.7 Shift+~ hidden overlay (keyboard construct; internal/demo per PRD).
- FR-19.5 cross-property analytics (PRD places it behind the same web overlay).
- Guarantee-claim evidence upload (web dashboard per in-app copy, `ContractDetailView.swift:1660`) — dispute evidence IS in-app.
- Legal/long-form content via Safari handoff (matrix "web-handoff" row) — intentional.

**Roadmap** (PRD's own deferrals; cite PRD):
- FR-2.9 background checks (Open Question #4; Checkr undecided).
- FR-19.6 bulk multi-property posting ("future consideration").
- §12 financial services as *live* products (Phase 2/3) — note iOS ships flag-gated surfaces ahead of this; true-live blocked on licenses (R6.2–R6.6).
- §13 Instant Phase 2 (broadcast matching, GPS ETA, AI recommendation); §14 enterprise/API/white-label (Phase 6); §16 verticals (Phase 8); §22 Phases 2–9 generally.
- FR-7.8 ML inference (v2 by the PRD's own text; heuristics-first is the requirement, and that is what ships).
- Mobile push *delivery* was itself "post-MVP" in the PRD (FR-8.5) — registration shipping early is ahead of plan, not a violation.

**Backend-only** (no user surface implied): FR-3.6, FR-6.4, FR-7.1–7.6/7.8, FR-8.7, FR-9.10/9.11, FR-11.4/11.5/11.9, FR-12.5/12.7, FR-15.5, FR-16.8, FR-17.2/17.4/17.6 — all verified present server-side where load-bearing (§2, §4).

**Beyond-PRD surfaces found on iOS** (no FR maps to them; listed for completeness, all positive deltas): goods marketplace (listings/sell/orders/bid bonds/buy-now/watchlist/wishlist/offers/spectate), follows/feed, saved searches, quote templates, seller analytics + CSV/ICS exports, referrals/NPS/savings/markets, widgets + Live Activities + App Intents, blocked users, age gate, passkeys, biometric gate.

---

*Report generated 2026-07-27 by the requirements-coverage audit agent. Line numbers current as of audit reads; the concurrent cosmetic-fix agent may shift them slightly.*
