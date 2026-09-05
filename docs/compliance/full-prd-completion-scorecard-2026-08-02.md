# Full PRD completion scorecard — eng-max vs Decision-IDs

**Date:** 2026-08-02 (honesty sweep 2026-08-12)  
**Corpus:** `PRD.md` v2.0 §8 (FR-1…FR-19), §12–14, §22 Phases 2–9  
**Scope:** Full product engineering completeness across **web + gateway + Go/Rust services + consumer iOS dual-rail**, scored against MVP FRs and roadmap Decision-IDs.  
**Companion:** Consumer dual-rail eng = [`eng-completion-scorecard-2026-08-02.md`](./eng-completion-scorecard-2026-08-02.md) (**core shipped — not 100**). ASC ops packaging = [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) (not eng-max).

---

## Score

| Bar | Score | Meaning |
|-----|------:|---------|
| **Full PRD eng-max** (non–Decision-ID FRs) | **Core shipped — not 100** | Dual-rail FR-1…19 core is in code. Named stubs remain (web phone OTP / contract no-show gap-close **in progress 2026-08-12**; iOS FR-3.1 encode broken). Do not re-score to 100. |
| **Consumer dual-rail eng** | **Core shipped — not 100** | See eng-completion scorecard — auction → contract → escrow → review (services) + list → bid/BIN → order → release (goods). |
| **App Store binary submit** | **Not ready** | **ASC-OPS** + founder secrets + device smoke — ops/founder, not a submit-ready claim. |
| **Roadmap Phases 2–9 product-live** | **Not claimed** | Tracked as **CLOSED_NA** / **SCAFFOLDED** / **DEFERRED** Decision-IDs below — not charged as live. |

### Honesty clause

**“Core shipped”** means dual-rail journeys exist in code. It does **not** mean:

- every Phase 2–9 roadmap product is live,
- TaxJar/Avalara remittance, enterprise API, white-label, or materials catalog ship,
- Checkr / StoreKit / Instant AI live GPS ETA ship,
- admin was removed from the consumer iOS binary (it **shipped** — see **ADMIN-IOS SUPERSEDED**),
- production licenses, Vault secrets, or ASC packaging are done,
- every named FR stub is closed.

**Rule:** do **not** declare eng-max 100 while named FR stubs remain.

---

## FR-1…FR-19 status table

Status vocabulary:

| Status | Meaning |
|--------|---------|
| **Implemented** | MVP FR intent present in code (web UI and/or backend as PRD scopes). Sub-items under Decision-IDs do not demote the area. |
| **Partial** | In-scope MVP work still missing **without** a Decision-ID. |
| **OOS Decision-ID** | Entire area or named sub-requirement intentionally out of eng-max via Decision-ID. |

| FR area | Status | Notes / evidence |
|---------|--------|------------------|
| **FR-1** Auth & onboarding | **Implemented** + **Partial** phone OTP on web | Email/password, Google/Apple OAuth (+ Facebook), role select, guided onboarding, email verify, dual-role enable. Gateway phone OTP (`/auth/send-phone-otp`, `/auth/verify-phone`) exists. **Web OTP UI not in `web/src`** — gap-close in progress 2026-08-12. |
| **FR-2** Identity & verification | **Implemented** + **SCAFFOLDED** FR-2.9 | Doc upload (PDF/JPG/PNG), statuses, badges, admin verification queue + require-to-bid toggle, resubmit path. **CHECKR-FR-2.9 SCAFFOLDED**: `provider_background_checks` + flag `background_checks` + POST fail-closed without `CHECKR_API_KEY` + webhook `POST /api/v1/webhooks/checkr` HMAC fail-closed without `CHECKR_WEBHOOK_SECRET` (persist only after verify) + iOS VerificationCenter row (no fake PASS). Live vendor = Founder-Action. |
| **FR-3** Job posting & reverse auction | **Implemented** | Taxonomy-driven post, schedule flexible/specific/range, property attach, drafts, sealed reverse auction, close/cancel/repost. |
| **FR-4** Bidding | **Implemented** | Sealed bids, ladder sort/filter (price/trust/rating/volume + bands), withdraw, award notifications. |
| **FR-5** Provider profiles & terms | **Implemented** | Public profile fields, global terms, local terms card, portfolio, radius, completeness signals. |
| **FR-6** Reviews & trust | **Implemented** | Double-blind window, FR-6.2 persona wire dims (closed 2026-08-02), respond/flag, trust tiers 0–100. |
| **FR-7** Fraud detection | **Implemented** (MVP heuristics) | FR-7.8: rule-based heuristics + admin fraud queue ship; **ONNX/ML v2** reserved (not charged — PRD itself defers ML). Admin surface = web (FR-13). |
| **FR-8** In-app chat | **Implemented** | Post-bid + pre-bid inquiry, typing/Seen, image + PDF, share-contact post-award, proposed terms, search, unread badges — web + iOS parity. |
| **FR-9** Payments & billing | **Implemented** + **Decision-IDs** | Stripe Connect Express, escrow, milestones, plans, refunds, 1099-K/NEC tax center, fee breakdown. Goods **state-level sales tax compute** ships (`sales_tax.go`). **SALES-TAX-REMIT-P2** — full jurisdiction remittance / TaxJar|Avalara|Stripe Tax. **OFFSESSION-LEGAL** — off-session goods charge / unpaid-win expiry exist in code but are **not live** (default off; ToS version required). |
| **FR-10** Maps & location | **Implemented** + **Decision-ID residual** | Mapbox job map, coarsened pre-award location, post-award exact + directions, multi-property address, **distance_km**, Instant **MapKit drive ETA** (with haversine fallback). Live GPS tracking of providers + AI match → **INSTANT-AI-P2**. |
| **FR-11** Market analytics | **Implemented** | Always-on market range / fair-price widgets; `/analytics`; admin analytics visibility controls on platform/admin. FR-11.6 Shift+~ keyboard overlay remains a **doc-spec chrome residual** (no `ui-store.ts`); product analytics do **not** depend on it — not scored Partial. |
| **FR-12** Subscription & monetization | **Implemented** (web) + **SCAFFOLDED** iOS IAP | Stripe tiers, fee config, revenue admin. **STOREKIT-B2 SCAFFOLDED**: free-tier binary default (`StoreKitEnabled=false`); StoreKit 2 manager + product IDs; no web digital purchase steering; fail-closed `POST /api/v1/iap/app-store/verify` (never `{valid:true}` without Apple-root crypto). ASC products + live JWS crypto = Founder-Action. |
| **FR-13** Admin & internal tooling | **Implemented** (web + iOS desk) | Full web admin console (evidence below). **ADMIN-IOS SUPERSEDED** — iOS Account → Admin console (`AdminConsoleView`) shipped, role-gated. Not “zero admin routes in consumer binary.” |
| **FR-14** Contract management | **Implemented** | Auto-generate on award, accept, milestones, local terms, status machine. |
| **FR-15** Completion & handoff | **Implemented** | Complete/approve, revision **200-char + 3-cap**, tip, documents, leave review. |
| **FR-16** Cancellation & unhappy paths | **Implemented** + **Partial** web no-show | Cancel, dispute, abandonment, FR-16.7 3-strike payment retry + off-session. Web has `no_show` as a **dispute reason** + `ReportNoShowResponse` type; **no contract report-no-show mutation** — gap-close in progress 2026-08-12. |
| **FR-17** Notifications | **Implemented** | Inbox, prefs, critical locks (FR-17.3), tab badges, push registration (delivery ops-gated). |
| **FR-18** Recurring jobs | **Implemented** | Frequency at post, roll-forward, auto-approve + future rate PATCH, pause/resume, pay-fail ladder. |
| **FR-19** Multi-property | **Implemented** + **Decision-ID** | CRUD, dashboard, account + per-property spend, preferred-providers API, job↔property. **BULK-PROPERTY-POST** (FR-19.6 multi-property simultaneous post) — PRD “future consideration”; **not** an easy flag stub (N job creates + address inheritance + auction lifecycle). |

**Partial count (non–Decision-ID):** **> 0** (web phone OTP, web contract no-show; iOS FR-3.1 encode) → **not 100**.

### Named FR residuals (2026-08-12)

| Residual | Status |
|----------|--------|
| Web phone OTP UI | Gap-close **in progress 2026-08-12** — do not claim done |
| Web contract no-show | Gap-close **in progress 2026-08-12** — do not claim done |
| iOS FR-3.1 schedule | Prior “FIXED” was false; tokens + dates still wrong (parallel fix) |
| **ADMIN-IOS** | **SUPERSEDED** — consumer admin desk shipped |

---

## Decision-ID registry (Full PRD)

### From consumer dual-rail eng bar (still valid)

| Decision-ID | Class | What |
|-------------|-------|------|
| **ASC-OPS** | Ops / founder | ASC packaging, screenshots, privacy labels, Review Notes |
| **STOREKIT-B2** | **SCAFFOLDED** | StoreKit 2 off by default; fail-closed `POST /api/v1/iap/app-store/verify` (503 / never `{valid:true}` without crypto). Live IAP = ASC products + Apple-root verifier (Founder-Action). |
| **CHECKR-FR-2.9** | **SCAFFOLDED** | POST fail-closed without `CHECKR_API_KEY`; webhook HMAC fail-closed without `CHECKR_WEBHOOK_SECRET`; persist only after verify; never invent PASS. Live vendor keys/package = Founder-Action. |
| **INSTANT-AI-P2** | Roadmap residual | Soft travel + MapKit drive ETA **shipped**; live GPS tracking of providers + AI recommendation remain Phase 2. |
| **ADMIN-IOS** | **SUPERSEDED** | Was CLOSED_NA / web-only. iOS Account → Admin console (`AdminConsoleView`) **shipped**, role-gated. Do not claim admin was removed. |
| **FOUNDER-SECRETS** | Ops | Vault, live Stripe, Apple Pay domain, OAuth Console IDs, PRE-05 |
| **R6-LICENSES** | Compliance | Regulated rails true-live (BNPL / advances / insurance / lead_gen / instant payout) |
| **DEPLOY-MTLS** | Infra | `DEPLOY_PROVISIONED` + mesh mTLS |
| **OFFSESSION-LEGAL** | **LEGAL-GATED** | Goods off-session charge + unpaid-win expiry default off. Not live. Flip only after bid-authorization ToS ships and `MARKETPLACE_OFFSESSION_TOS_VERSION` is set (pair with `MARKETPLACE_OFFSESSION_CHARGE` / `MARKETPLACE_PAYMENT_EXPIRY`). |

### Full-PRD additions (this scorecard)

| Decision-ID | Class | What | Scaffold / close reason |
|-------------|-------|------|-------------------------|
| **ADMIN-IOS** | **SUPERSEDED** | Consumer iOS admin | Desk **shipped** in consumer binary (`AdminConsoleView`, role-gated). Web admin still Implemented. |
| **SALES-TAX-REMIT-P2** | **DEFERRED** (scaffold exists for *compute*) | FR-9.14 remittance / TaxJar·Avalara·Stripe Tax | Static state-level tax in `services/payment/internal/service/sales_tax.go` + charge path; **not** remittance/filing. Full automation is Phase-2 product, not a flag stub. |
| **BULK-PROPERTY-POST** | **DEFERRED** | FR-19.6 bulk multi-property job post | Architecture ready (per-property post ships); simultaneous multi-create is multi-entity write path — Decision-ID only, **no stub**. |
| **MATERIALS-P2** | **DEFERRED** | §22 Phase 2 materials & hardware procurement | No vendor catalog / drop-ship engine in tree |
| **ENTERPRISE-P6** | **DEFERRED** | §14 / §22 Phase 6 enterprise API + sales | No `/enterprise` public API surface |
| **WHITE-LABEL-P6** | **DEFERRED** | White-label embed for PM / warranty | No theming/tenant shell product |
| **AIML-P7** | **DEFERRED** | §22 Phase 7 advanced AI/ML (matching, dynamic pricing, chatbot, predictive fraud) | Fraud **heuristics** + reserved `ort` path; not Phase-7 product |
| **VERTICALS-P8** | **DEFERRED** | §22 Phase 8 new verticals at scale | Taxonomy extensible; `legal_services` flag-gated wedge only |
| **ANALYTICS-OVERLAY-FR11.6** | **CLOSED_NA** | Shift+~ hidden overlay chrome | Dedicated `/analytics` + fair-price widgets fulfill product analytics; keyboard overlay was internal/demo |
| **OFFSESSION-LEGAL** | **LEGAL-GATED** | Off-session goods charge + payment-window expiry | Code path exists; flags default **off**. Not Implemented-as-live. Enable only after legal terms authorize bid-time off-session charge and `MARKETPLACE_OFFSESSION_TOS_VERSION` is set. Production refuses to start if either flag is true without that env. |

---

## Phase 2–9 PRD roadmap (§22) — Decision-IDs

PRD §22 “Future Phases (Out of MVP Scope)”. Each row is **not** charged against eng-max.

| Phase | PRD theme | Decision-ID | Class | Evidence / honesty |
|------:|-----------|-------------|-------|--------------------|
| **2** | Materials & hardware procurement | **MATERIALS-P2** | **DEFERRED** | No materials catalog, supplier accounts, or bid line-item catalog integration. |
| **3** | Financial services launch (§12) | **FINSERV-P3** | **SCAFFOLDED** | Flag-gated: BNPL, working capital advances, per-job insurance, business expenses/tax, instant payout — web + iOS surfaces + payment/underwriting paths. **True-live** still **R6-LICENSES**. |
| **4** | Native mobile applications | **NATIVE-MOBILE-P4** | **SCAFFOLDED** (iOS ahead of plan) | Consumer iOS dual-rail **shipped** (camera, map, push register, contracts, goods). Android not in tree. Offline = banner only (PRD offline drafting residual). |
| **5** | NoMarkup Instant — full launch (§13) | **INSTANT-FULL-P5** | **SCAFFOLDED** | Emergency CTA, offers, weekly schedule, geo/category/trust prefilter, soft travel + MapKit drive ETA. Live GPS tracking + AI recommend = **INSTANT-AI-P2**. |
| **6** | B2B & enterprise channel (§14) | **ENTERPRISE-P6** | **DEFERRED** | No enterprise job-post API, provider-network API product, or enterprise account management. |
| **6b** | White-label | **WHITE-LABEL-P6** | **DEFERRED** | No embeddable white-label portal. |
| **7** | Advanced AI/ML | **AIML-P7** | **DEFERRED** | Heuristic fraud + imaging; no automated matching/pricing chatbot product. |
| **8** | Platform expansion — new verticals (§16) | **VERTICALS-P8** | **DEFERRED** (wedge **SCAFFOLDED**) | Home-services taxonomy live; `legal_services` flag-gated; Tier 1–3 verticals not productized. |
| **9** | Platform intelligence & content | **PLATFORM-INTEL-P9** | **SCAFFOLDED** | Fair-price / market range, provider analytics, customer spend, provider **teams** (`/provider/team` + employees API). Public SEO market-reports product residual. |

### Sales tax & bulk property — scaffold vs Decision-ID only

| Item | Easy flag stub? | Action taken 2026-08-02 |
|------|-----------------|-------------------------|
| Sales tax **remittance** / TaxJar·Avalara | **No** — needs jurisdiction graph, filing, money remittance, vendor contract | **Decision-ID only:** **SALES-TAX-REMIT-P2**. State-level **compute** already ships (not a new stub). |
| FR-19.6 bulk multi-property post | **No** — multi-job transaction, per-property address/notes inherit, N auctions | **Decision-ID only:** **BULK-PROPERTY-POST**. |

---

## Admin FR-13 — SUPERSEDED: consumer iOS desk shipped; web evidence

**PRD FR-13.1** said admin is web-based / separate. **ADMIN-IOS is SUPERSEDED (2026-08-12):** consumer iOS now has a role-gated desk. Do **not** claim “zero admin routes in the consumer binary” or that admin was removed.

| Surface | Status |
|---------|--------|
| Consumer iOS admin | **Shipped** — Account → Admin console (`AdminConsoleView`), `hasAdminRole` gate |
| Web admin | **Implemented** — role-gated layout + sidebar + gateway `/api/v1/admin/*` |

### Key web admin routes (evidence paths)

Layout / shell:

| Path | Role |
|------|------|
| [`web/src/app/(dashboard)/admin/layout.tsx`](../../web/src/app/(dashboard)/admin/layout.tsx) | Admin role gate + sidebar shell |
| [`web/src/components/admin/AdminSidebar.tsx`](../../web/src/components/admin/AdminSidebar.tsx) | Nav SSOT for admin destinations |

Primary FR-13.1 surfaces (App Router pages under `web/src/app/(dashboard)/admin/`):

| Route | FR-13 mapping |
|-------|----------------|
| `/admin` | Overview / system metrics cards |
| `/admin/users`, `/admin/users/[id]` | User management |
| `/admin/verification` | Verification queue |
| `/admin/jobs` | Job management |
| `/admin/listings` | Goods listing moderation |
| `/admin/disputes`, `/admin/disputes/[id]` | Dispute resolution queue |
| `/admin/fraud` | Fraud review queue |
| `/admin/reviews` | Flagged reviews |
| `/admin/taxonomy` | Service taxonomy management |
| `/admin/payments` | Payments + fee config (FR-13.4 / FR-12.8–12.9) |
| `/admin/platform` | Platform / analytics visibility (FR-13.3/13.5 adjacent) |
| `/admin/flags` | Feature flags |
| `/admin/markets` | Geographic market control |
| `/admin/banking` | Platform banking |
| `/admin/advances` | Working-capital admin |
| `/admin/guarantee`, `/admin/guarantee/[id]` | Guarantee claims |
| `/admin/insurance`, `/admin/insurers` | Insurance admin (flag-gated insurers) |
| `/admin/licenses` | License review (`legal_services`) |
| `/admin/goods-reports`, `/admin/user-reports` | UGC report queues |
| `/admin/challenges` | Challenges admin |

Supporting components: `web/src/components/admin/*` (DataTable, FraudAlert*, GuaranteeClaimReview, MetricsCard, …).  
Hooks: `web/src/hooks/useAdmin.ts`, `useFraud.ts`, etc.  
Gateway: `RequireAdmin` on `/api/v1/admin/*` (`gateway/internal/router/router.go`).  
E2E smoke: `web/tests/e2e/admin.spec.ts`.

**FR-13.7 RBAC note:** `support` / `analyst` roles exist in domain types + `RequireSupport` middleware; admin **UI** currently requires `admin` role. Support/Analyst fine-grained UI matrix is a thin residual — admin full-access path satisfies MVP operator needs; not scored as Partial against eng-max.

---

## Enterprise / white-label / materials

| Theme | Decision-ID | Class | eng-max impact |
|-------|-------------|-------|----------------|
| Materials & hardware procurement | **MATERIALS-P2** | **DEFERRED** | None (OOS) |
| Enterprise API + account channel | **ENTERPRISE-P6** | **DEFERRED** | None (OOS) |
| White-label embed | **WHITE-LABEL-P6** | **DEFERRED** | None (OOS) |

No scaffolds opened for these — product scope is multi-quarter with vendor/legal dependencies.

---

## Cross-scorecard map

| Scorecard | Path | Bar |
|-----------|------|-----|
| **This doc** | `docs/compliance/full-prd-completion-scorecard-2026-08-02.md` | Full PRD core shipped — **not 100** |
| Consumer dual-rail eng | [`eng-completion-scorecard-2026-08-02.md`](./eng-completion-scorecard-2026-08-02.md) | Dual-rail core shipped — **not 100** |
| ASC packaging | [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) | Ops/submit packaging (not eng-max) |
| iOS FR census | [`ios-prd-coverage-audit-2026-07-27.md`](./ios-prd-coverage-audit-2026-07-27.md) | iOS-centric FR audit + 2026-08-02 delta |
| Parity backlog | [`prd-ios-parity-backlog.md`](./prd-ios-parity-backlog.md) | Wave log + residuals |
| Regulated rails | [`regulated-rails-live-flagged.md`](./regulated-rails-live-flagged.md) | R6 license gate |

---

## What this scorecard authorizes saying

**Allowed:**

- Dual-rail **MVP FR-1…19 core** is in code for requirements **not** listed as a Decision-ID, **except** named residuals above.
- Web **admin FR-13** ships; consumer iOS **admin desk also ships** (role-gated).
- Financial-services and Instant **scaffolds** exist behind flags; Phase 2–9 live claims are Decision-ID gated.

**Not allowed:**

- “eng-max 100 / PRD fully implemented.”
- “Every line of PRD.md including Phases 2–9 is production-live.”
- “Materials catalog / enterprise API / white-label shipped.”
- “Sales tax remittance / Avalara live.”
- “Bulk multi-property post ships.”
- “Checkr / StoreKit / Instant AI ETA shipped.”
- “App Store submit READY” without **ASC-OPS** / **FOUNDER-SECRETS** / smoke sign-off.
- “Regulated rails live” without **R6-LICENSES**.
- “Off-session goods charging / unpaid-win expiry is live” without **OFFSESSION-LEGAL** (bid-authorization ToS + `MARKETPLACE_OFFSESSION_TOS_VERSION`).
- “Zero admin routes in the consumer iOS binary” / “admin was removed.”
- “Web phone OTP / contract no-show done” (gap-close in progress 2026-08-12).

---

*Scorecard authored 2026-08-02. Honesty sweep 2026-08-12. Update Decision-IDs when a deferred item is productized or a SUPERSEDED ID is reopened.*
