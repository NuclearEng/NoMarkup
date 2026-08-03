# PRD + iOS parity backlog

**Date:** 2026-07-26 (audit continued 2026-07-27; **code re-reconcile 2026-08-02**)  
**Sources:** `PRD.md` v2.0 §8–16 · `ios/NoMarkup/` · gateway/services/engines · compliance docs under `docs/compliance/`  
**Verdict:** **Core product depth is largely shipped on iOS + backend.** Full PRD (admin, StoreKit digital purchase, Instant AI/ETA Phase 2, Checkr) is **not** claimed. **App Store submit remains blocked by ops/founder work**, not by missing consumer auction/escrow UI.

---

## 1. Overall status

| Scope | Result |
|--------|--------|
| **Backend (MVP core)** | Largely present: reverse auction, sealed bids, contracts, escrow, reviews/trust, fraud heuristics, chat (inquiry + share-contact), payments (incl. **InstantPayout gRPC**), maps APIs |
| **iOS consumer app** | Core paths **live**; former thin FR residuals (bid filters, schedule picker, PDF chat/verify, FR-8.1/8.8, badges, distance, recurring edit, Facebook native, team/challenges/legal hub) **shipped** as of 2026-08-02 re-check |
| **PRD §1 scope** | MVP = web; native iOS = post-MVP sequencing — this backlog still measures **full PRD product coverage on iOS** |
| **PRD §22 / expansion** | Intentionally roadmap: **Instant AI / live GPS ETA (Phase 2)**, enterprise, verticals |
| **App Store binary** | **NOT READY** — **[~] ops**: signing, ASC media/labels, review backend, free-tier ASC narrative, human device smoke, Apple Pay domain / merchant env |

Do **not** claim “PRD fully implemented on iOS.” Claim **core reverse-auction + goods dual-rail + contracts/unhappy paths + reviews/trust + chat parity depth**, with **ops/founder + accepted roadmap residuals** below still open.

---

## 2. Compliance artifacts (closed vs open)

### Done as docs / closed engineering evidence

| Doc / work | Status |
|------------|--------|
| `adr-2026-07-26-money-integrity-residual.md` | Accepted residual (MON-14–18 not fixed) |
| `native-approach-decision.md` | Accepted B0 |
| `ios-api-integration-notes.md` | Integration reference complete |
| `ios-payment-rails-design.md` | Design locked; StoreKit deferred |
| `bid-ladder-fix-dogfood-2026-07-26.md` | Ladder fix + dogfood done |
| `device-e2e-results` / `device-test-run` / `device-smoke-results` | Automated green; **human smoke still open** |
| `perf-gate-*-samples.md` | Catalog p95 PASS (LAN) |
| Review logs phase 0–4b | Done as review logs |
| `remediation-checklist.md` | Web P0/P1 mostly done; packaging deferred |
| `design-system.md` | Spec only — no open compliance checklist |
| Documents + leave-review (iOS/gateway) | Shipped (`52ad882`) |
| Hard-off honesty | Code `iOSHardOffKeys = []`; smoke/launch-board/B4 describe **server flags** |
| Web JobDetail instant match | Owner CTA → `POST /jobs/{id}/instant-match` when accept-now price set |
| FR-18 roll-forward tests | Service tests: generate + date-idempotent re-list + skip when paused |
| Apple Pay domain note | [`apple-pay-domain.md`](./apple-pay-domain.md) — placeholder explicit; no invented merchant file |

### Not complete — human / ops only (`[~]` ops-gated, not engineering)

| Area | Reality |
|------|---------|
| **ASC ops** | Team signing, app record, 1024 icon, 6.7"+12.9" screenshots, privacy labels, age rating, free-tier Review Notes paste |
| **PRE-05 review backend** | Always-on review API + seed + `APPLE_NATIVE_CLIENT_ID` + Stripe `pk_` for Apple Pay dogfood |
| **Device smoke** | Human-execute `device-smoke-checklist.md` + sign `launch-board.md` (auto smoke ≠ signed) |
| **Apple Pay domain** | Replace placeholder association file + Stripe/Apple verify (see `apple-pay-domain.md`) |
| **Apple Pay merchant + iOS `pk_`** | Merchant ID + Dashboard + env on review device |

### Not complete — product / security residual (engineering or accepted)

| Area | Reality |
|------|---------|
| App Store submit | NOT READY — blocked by ops rows above + free-tier ASC narrative confirmation |
| Showcase living checklist | Global security gates still unchecked; R6.2–R6.6 blocked-compliance; program exit criteria unmet |
| Regulated rails | Still blocked for true live; licenses + E2E + security exits open |
| Security gate | PASS WITH GAPS — money races residual (ADR) |
| Perf gate | Samples PASS; parent closed PASS from samples where marked |
| iOS ↔ web matrix | Near-live core; **Google + Facebook native OAuth shipped** (Console IDs = ops dogfood); native WS shipped; **StoreKit + admin intentionally out of consumer binary** |
| **FR-18 per-instance Stripe pay** | Config/instances/pause/resume/cancel + lazy roll-forward + approve/complete CreatePayment + one off-session attempt + FR-16.7 due-row gateway CreatePayment retry **shipped**; iOS shows `off_session_charged` + `payment_retry_count`/`next_retry_at` when gateway projects them + **auto-approve / future-rate PATCH**. Residual: live Stripe dogfood of retry ladder |

---

## 3. PRD coverage snapshot (iOS + backend)

> **Stale % snapshot retired (2026-08-02).** The FR-1…10 LIVE ~19% / PARTIAL ~39% / MISSING ~9% table predated waves 4–28 and post-audit ship work. Prefer the 2026-07-27 coverage audit + **2026-08-02 re-audit delta** in `ios-prd-coverage-audit-2026-07-27.md` (most former Top-10 Missing/Partial items flipped to Implemented).

### FR-11…19 + §§10–16

| Strength | Weak / missing (honest) |
|----------|-------------------------|
| Contracts lifecycle, guarantee claim, notifications/prefs + **tab unread badges** | — |
| Properties CRUD + spend roll-up, referrals, FinServ hub (flagged) | Per-property preferred-provider stats still thin (API) |
| Trust scores / verification upload **PDF + photo** | Checkr (FR-2.9) not built |
| Dual-rail goods + services shell | **Instant AI / live GPS ETA = Phase 2 roadmap** (not eng polish) |
| Leave review + document download + **PDF chat attach** | **StoreKit digital purchase (FR-12)** deferred; free-tier ASC lock |
| Instant payout ledger + **gRPC InstantPayout wire** + iOS hub UI | True-live still license/flag/ops gated (R6.x) |

### Solid on iOS today

- Auth: email/password + SIWA + **Google native** + **Facebook native** + MFA + passkeys; Keychain JWT  
- Jobs: browse/map (**category + min-price filters**), post (**schedule flexible/specific/range**), drafts, bid/award/close/cancel, **ladder sort + trust/volume filters**, live auction WS + spectate  
- Goods: marketplace, sell, orders, Apple Pay Rail A (env-dependent); bid retract (detail + MyBids, 60s)  
- Contracts: accept/start/complete/approve, milestones (**200-char revision + 3-cap UI**), change orders, tip, dispute, no-show, abandonment, documents + leave review + **local_terms card (FR-5.4)** + recurring auto-approve/rate edit  
- Instant: customer emergency CTA + provider offers; provider weekly schedule (GET hydrate + PUT); geo/category/trust prefilter on notify/List/Accept  
- Chat: WS typing/Seen/read_receipt, photos + **PDF**, **pre-bid inquiry (FR-8.1)**, **Share contact (FR-8.8)**  
- Trust: score/tiers; verification doc upload (JPEG/PNG/WebP/**PDF**); distance labels on browse when geo-scoped  
- Account: properties (+ spend roll-up), messages, notifications + **tab badges**, APNs register, Stripe Connect, business/finance hub (**instant payout**), **Team / Challenges / Legal services** (flag-gated where applicable)  
- Growth: referrals, savings, NPS, share cards  

### Highest-impact residual gaps (honest — not re-opened as “missing ship”)

| Area | PRD | Gap |
|------|-----|-----|
| Instant | §13 Phase 2 | **Live GPS ETA + AI recommendation** — PRD Phase 2; geo/category/trust ranking + schedule already shipped |
| Digital subs | FR-12 | **StoreKit** purchase path deferred; free-tier binary lock is intentional (`v1-ios-product-cut.md`) |
| Admin / fraud UI | FR-7/13 | Correctly **web-only** (out of consumer iOS) |
| Background checks | FR-2.9 | **Checkr** still open question / not built |
| Ops / submit | — | ASC packaging, device smoke sign-off, PRE-05 review backend, Apple Pay domain + merchant/`pk_`, OAuth Console IDs for dogfood |
| Accepted money residual | MON-14–18 ADR | Keep accepted residual **or** close races before regulated money live |

---

## 4. Unified backlog (execute in order)

### Engineering residual status (2026-07-27 waves 1–28 + **2026-08-02 re-reconcile**)

**Consumer product + shippable eng for PRD MVP depth is implemented.** Remaining unchecked items are:
1. **Human/ops-gated (`[~] ops`)** — ASC packaging, device smoke sign-off, always-on review API (PRE-05), Apple Pay domain file + merchant/`pk_`, Google/Facebook iOS client IDs in Console for dogfood, live Stripe dogfood of FR-16.7 ladder
2. **Accepted risk / licenses / cut** — MON-14–18 ADR (or close before regulated money), R6.2–R6.6 licenses, **Checkr** (FR-2.9 OQ), mTLS arming, **StoreKit B2** (digital purchase intentionally deferred), **admin FR-13 web-only**
3. **True product Phase 2 (not eng polish):** **Instant live GPS ETA + AI recommendation** (geo/category/trust prefilter already shipped waves 22–23); delivery receipts polish if still desired
4. **Shipped thin residuals (do not re-open as eng backlog):**
   - **FR-16.7 / FR-18** — 3-strike, due-row CreatePayment, visit-pay web/iOS, approved_at, payment_funded, **auto-approve + future-rate `updateRecurringConfig`**
   - **Instant** — schedule consume + in-app `job_matched` fan-out + accept notify + honest `providers_notified` + geo/category/trust prefilter + **InstantPayout gRPC + gateway + iOS hub**
   - **Chat FR-8** — WS/typing/Seen/read_receipt + **PDF attach (FR-8.3)** + **pre-bid inquiry (FR-8.1)** + **Share contact (FR-8.8)**
   - **Auction UX** — bid sort (price/trust/rating/volume) + **FR-4.7 filters**, post **schedule picker**, job browse category/min-price filters, **distance labels**, tab **unread badges**
   - **Auth / account** — Google + **Facebook native**, Team (`EmployeesView`), Challenges, Legal services (flag)
   - **Verify** — FR-2.2 PDF on verification docs; FR-15.4 revision 200-char + 3-cap UI
   - **Spectator FR-1.1** — job+marketplace spectate, LIVE honesty (FE-06 Done), unified watcher_count
   - **Money/auth** — MON-21 cumulative cap; SEC-16 RS256-only; RequireFlag on guarantee claims / instant_payout

Status legend: `[ ]` open engineering · `[x]` done · `[~]` partial / accepted residual · **`[~] ops`** = human/ops only (not an eng task)

### P0 — Integrity, submit, core PRD

- [x] **Doc hygiene** — Reconcile empty `FeatureFlags.iOSHardOffKeys` vs hard-off claims in v1 cut, smoke checklist, submission-blockers, security-gate, living-checklist, launch-board B4  
- [~] **MON-14–18** — Close money races + concurrency tests, **or** keep accepted residual and never enable regulated money in prod  
- [x] **SEC-GATE-03** — `RequireFlag` on money/regulated API routes  
- [~] **R6.2–R6.6** — Stay `blocked-compliance` until licenses + live-flagged exit checklists  
- [~] **ops** **ASC packaging** — Team signing, ASC app record, 1024 icon, 6.7" + 12.9" screenshots, privacy labels, age rating, free-tier Review Notes paste  
- [~] **ops** **PRE-05 review backend** — Always-on review API + seed + `APPLE_NATIVE_CLIENT_ID` + Stripe `pk_` for Apple Pay dogfood  
- [~] **ops** **Device smoke** — Human-execute `device-smoke-checklist.md` + sign `launch-board.md` (auto smoke ≠ signed)  
- [x] **FR-18 recurring** — Config/instances/pause/resume/cancel + lazy roll-forward **+ tests** + approve/complete CreatePayment + off-session attempt + iOS pay/`off_session_charged` + FR-16.7 scheduled due-row CreatePayment retry (gateway) **shipped**  

- [x] **GET Instant schedule** — Owner GET `/providers/me` returns `schedule`; iOS + web hydrate weekly editor (web: re-GET when key missing; PUT merges schedule into cache)  
- [x] **Web Instant schedule PUT** — Correct wire keys (`enabled`/`available_now`/`schedule`) + UI on provider dashboard/offers  
- [x] **Instant schedule consume on fan-out** — ListProviderOffers/Accept gate by `available_now` OR in-window schedule (wave12)  
- [x] **Marketplace retract parity** — Web listing detail + My Bids (iOS both); 60s leading-bid window  
- [x] **FR-16.7 payment retries** — Migration 112/113 + 3-strike pause; gateway `ProcessDueRecurringPaymentRetries` claims due rows → CreatePayment `attempt-N` (off-session re-confirm + failed remint); success resets; setup-fail and `payment_intent.payment_failed` both increment shared `payment_retry_count` / `next_retry_at` and pause only at ≥ 3; never cancels contract. Job ticker discovery-only. Config GET/JSON enriches retry fields for clients. Residual: live Stripe dogfood of day-0/3/7.  

- [x] **iOS off_session_charged UX** — Decode + surface gateway `off_session_charged` / residual on approve + complete visit (no PaymentSheet when funded)  

- [x] **iOS payment_retry UX** — Recurring section shows `payment_retry_count` / `next_retry_at` when gateway projects them (omit on happy path)  

- [x] **Web local_terms residual messaging** — Award residual badge + honest empty-snapshot note on contract detail  


- [x] **FR-1.5–1.9 onboarding** — VerificationCenter + multi-step OnboardingWizardView (skip-friendly) shipped  
- [x] **FR-3 job form + repost** — Full job form (recurrence, offer-accepted, **schedule flexible/specific/range**, property) + repost UX  
- [x] **FR-4 bid advanced** — Lower bid, accept-offer, **sort (price/trust/rating/volume) + FR-4.7 trust/volume filters** on iOS  
- [x] **FR-9 services pay** — Services escrow PaymentSheet capture + fee breakdown (not goods-only)  
- [x] **FR-10.4 directions** — Post-award Get Directions (Maps) + `property_id` on PostJob  
- [x] **FR-10.5 / FR-10.7** — Provider service-radius editor (ProviderWorkspace); **distance labels** on jobs/providers/marketplace when geo-scoped (travel-time ETA still Phase 2 Instant residual)  
- [x] **Web Instant re-request** — JobDetail owner CTA → `POST …/instant-match` when accept-now set  
- [x] **Instant payout gRPC wire** — `payment.v1.InstantPayout` + gateway `POST/GET …/instant-payout` (+ summary) + iOS `InstantPayoutView` behind `instant_payout` flag  

### P1 — Product depth

- [~] **ops** **Apple Pay domain** — Replace placeholder association file; see [`apple-pay-domain.md`](./apple-pay-domain.md) (do not invent merchant files)  
- [x] **Idempotency residual** — Job-bid durable SQL dedup (migration 110 + PlaceBid key stamp/replay); bid-bond create (109) + confirm authorized soft-replay; iOS sticky keys verified (job/listing bid, bond, payments; buy-now/order-pay deterministic keys)
- [x] **FR-12 digital** — Free-tier-only binary lock (PlanLimitsView + v1 cut); **StoreKit intentionally deferred** (not a missing eng task until B2)  
- [x] **Perf gate close** — Mark parent `perf-gate-2026-07-26.md` PASS from samples; optional BrandAppIcon true 1x/2x/3x  
- [x] **FR-5 profile terms** — Portfolio upload UI + global terms editor + local terms in chat + **terms on public ProviderDetail**  
- [x] **FR-6 review polish** — Category sub-ratings, respond to review, flag review on iOS  
- [x] **FR-8 chat parity** — Attachments (**image + PDF**) + search + native ChatWebSocketClient + typing + last_read Seen + live `read_receipt` + **FR-8.1 inquiry channel** + **FR-8.8 Share contact**  
- [x] **FR-8.10 / FR-17.1 badges** — Tab-level messages + notifications unread badges (`RootTabView`)  
- [x] **FR-11 market bars** — Real p25/p50/p75 range bars on post + bid sheet (`/analytics/market/range`)  
- [x] **FR-19 property dash** — Summary cards, edit, history drill-in, property picker + account spend roll-up (preferred-providers API still thin)  
- [x] **FR-15/16 evidence** — **Revision 200-char + 3-cap UI**; dispute/guarantee evidence paths  
- [x] **FR-17.5 deep links** — Notification tap → job / contract / chat / payment  
- [x] **FR-18.3 / 18.4 iOS edit** — Auto-approve toggle + future rate via `updateRecurringConfig` on ContractDetail  
- [x] **FR-2.2 PDF verify** — VerificationDocuments Files picker PDF + chat PDF attach  
- [x] **Team / Challenges / Legal iOS** — `EmployeesView` (Team), `ChallengesView`, `LegalServicesView` (flag `legal_services`)  

### P2 — Growth, Instant, platform

- [x] **§13 Instant (MVP)** — Customer emergency CTA + provider offer accept/decline (iOS); web post + JobDetail re-request; schedule + geo/category/trust prefilter  
- [~] **§13 Instant Phase 2** — **Live GPS ETA + AI match** (roadmap; do not claim shipped)  
- [x] **FR-1.1 / realtime** — Google **and Facebook** native OAuth (ASWebAuth → `/auth/*/native`) + chat WS; APNs registration; job auction native WS + public spectate; marketplace spectate; LIVE honesty (FE-06). **[~] ops** Console IDs / reverse schemes for dogfood  
- [x] **§11 share cards** — Savings / review share cards via ShareLink  
- [~] **Apple docs Phases 5–7** (process residual; 0–4 done) — Framework/ASC ops reviews + refresh stale `capability-matrix` / privacy inventory headers  
- [~] **ops** **Deploy / mTLS** (ops/infra residual) — `DEPLOY_PROVISIONED` + gRPC mesh mTLS (S9.8 / SEC-GATE-09)  

### P3 / explicit non-goals for consumer binary

- [x] **FR-2.8 expiration UX** — 30d warning shipped  
- [~] **FR-2.9 Checkr** — still open question / **not built** (roadmap / founder decision; not closable as pure eng without vendor)  
- [x] **Keep out of consumer iOS** — **Admin FR-13** (web-only by design); enterprise API / white-label §14; §16 vertical expansion until planned; **StoreKit until B2 decision**  

---

## 5. Suggested implementation waves

| Wave | Focus | Unlocks |
|------|-------|---------|
| **W0** | Doc hygiene + hard-off honesty + ASC free-tier narrative | Submit honesty |
| **W1** | FR-18 recurring backend + iOS (pay residual left) | PRD recurring / lock-in |
| **W2** | FR-1 onboarding/OTP + FR-3 job form + FR-4 bid advanced | Core auction completeness |
| **W3** | FR-9 services pay + FR-10 directions + property picker | Money + geo UX |
| **W4** | FR-8 chat + FR-6 reviews + FR-15/16 evidence + notif deep links | Trust / support |
| **W5** | FR-11 market bars + FR-19 property dashboard | Intelligence differentiators |
| **W6** | §13 Instant + JobDetail re-request + §11 share cards | Growth / emergency |
| **W7** | StoreKit **or** permanent free-tier ASC lock | Digital commerce policy |
| **W8** | Ops: ASC media, signing, review backend, human smoke, Apple Pay domain | App Review submit |

---

## 6. Related docs

| Doc | Role |
|-----|------|
| `PRD.md` | Requirements SSOT |
| `ios-web-feature-matrix.md` | Honest live/partial/out-of-scope matrix (current policy: server flags, no hard-offs) |
| `showcase-living-checklist.md` | Showcase program DoD |
| `launch-board.md` | Stage A–C launch board |
| `submission-blockers.md` | App Store one-pager |
| `regulated-rails-live-flagged.md` | R6.2–R6.6 graduation map |
| `security-gate-2026-07-26.md` | Money/auth gate evidence |
| `device-smoke-checklist.md` | Manual Stage C smoke (unsigned) |
| `v1-ios-product-cut.md` | Free-tier-only digital cut |
| `apple-pay-domain.md` | Placeholder + ops steps for domain association |

---

## 7. Change log

| Date | Note |
|------|------|
| 2026-07-27 | Initial backlog written from PRD §8–16 audit + compliance gate residual list |
| 2026-07-27 | Wave: doc hygiene, RequireFlag SEC-GATE-03 + tests, FR-4 lower/accept-offer, FR-10 directions+property, FR-1 verify center, FR-3 post fields, FR-6 category ratings, FR-17 deep links, perf-gate PASS close |
| 2026-07-27 wave2 | FR-9 pay escrow, FR-18 recurring partial, repost, review respond/flag, market bars, evidence photos, FR-5 terms/portfolio |
| 2026-07-27 wave3 | Chat photos/search, Instant funnel, property dashboard, onboarding wizard, recurring roll-forward |
| 2026-07-27 residual close | JobDetail Instant re-request; FR-18 roll-forward tests hardened; Apple Pay domain ops note; backlog marks ASC/smoke/PRE-05/domain as **ops-gated** not eng |

| 2026-07-27 wave4 | Closed engineering residuals: chat WS+typing, Google OAuth native, share cards, free-tier FR-12 lock, job-bid durable idempotency (110), doc expiry UX, Instant JobDetail, ops docs honesty |

| 2026-07-27 wave5 | Instant JobDetail iOS; chat Seen + proposed-terms card; auction WS on JobDetail; MFA setup complete; age gate; chat block/report; feed load-more |

| 2026-07-27 wave6 | Proposed terms Accept/Reject E2E; channel last_read Seen; auction spectator WS; OAuth unlink; marketplace offer buyer pay; MFA/age already prior |

| 2026-07-27 wave7 | Local terms bind on accept; provider propose sheet; marketplace spectate WS; FR-18 approve→CreatePayment + iOS Pay visit |

| 2026-07-27 wave8 | Pre-award local terms re-apply on award; auto-approve→CreatePayment; web terms Accept/Reject + propose API; security tests |

| 2026-07-27 wave9 | UNIQUE payment-per-instance (111) + soft-replay; FR-18.8 pause on pay fail; award stamps accept metadata; web retract + local_terms card |

| 2026-07-27 wave10 | Resume recurring on ProcessPayment; webhook payment_failed→pause; Instant weekly schedule iOS; local_terms + goods retract on MyBids |
| 2026-07-27 wave11 | GET `/providers/me` `schedule` + iOS hydrate; web Instant schedule PUT+UI; listing detail retract; FR-16.7 setup-failure 3-strike pause (migration 112); contract local_terms verified on iOS |
| 2026-07-27 wave12 | FR-16.7 `next_retry_at` (migration 113) on setup fail when count < 3; reset clears it; job-service `processRecurringPaymentRetries` log-only cron; approve-path off-session attempt; Instant schedule fan-out gate; iOS Instant schedule after GetMe re-verified |
| 2026-07-27 wave13 | Web Instant schedule hydrate from GET when key missing + PUT cache merge; iOS `off_session_charged` messaging on contract visit pay; backlog thin-residuals honesty (schedule consume + approve off-session closed; due-row auto-charge still log-only) |
| 2026-07-27 wave14 | FR-16.7 gateway `ProcessDueRecurringPaymentRetries` CreatePayment+attempt-N when `next_retry_at` due; payment remint failed + re-off-session; job ticker discovery-only; never cancel contract |
| 2026-07-27 wave15 | FR-16.7 webhook `payment_intent.payment_failed` joins 3-strike (`payment_retry_count`/`next_retry_at` shared SQL); PauseRecurring only at ≥3; never cancel contract; residual live Stripe dogfood |
| 2026-07-27 wave15b | Instant schedule H:MM parse edge + tests green; gateway projects payment_retry fields on recurring config GET/JSON; iOS recurring retry UX; web local_terms award residual messaging; thin-residuals honesty |
| 2026-07-27 wave16 | Web RecurringSchedule visit-pay + FR-18.8 pause dual-party notify; empty-userID fail-closed + `requesting_user_id` on Get/List recurring; iOS Seen polish (poll-based) |
| 2026-07-27 wave17 | Chat live `read_receipt` WS on MarkRead; web last_read watermark Seen + Sent/Seen labels; iOS peer watermark patch from WS frame |
| 2026-07-27 wave18 | Recurring instance `approved_at` wire + list `payment_id`/`payment_status`/`payment_funded` enrichment; residual Pay for any approved visit; hide Pay when funded |
| 2026-07-27 wave19 | Chat unread exact COUNT (exclude own + watermark on send); web job detail spectator feed + LIVE honesty; gateway spectate PII tests; iOS job spectator count chip |
| 2026-07-27 wave20 | Marketplace watcher_count = max(page pings, WS spectators) across listing JSON, ping-viewer, spectate broadcast, watchlist |
| 2026-07-27 wave21 | Instant in-app fan-out + accept customer notify + honest providers_notified; MON-21 payment cap; SEC-16 RS256; RequireFlag guarantee; MessageThread remake-read; JobDetail spectate tests; FE-06/route-map honesty |
| 2026-07-27 wave22 | Instant notify geo/category/trust prefilter; bid-bond `stripe_payment_method_id` on authorize; MON-24 integer advance/instant fee math |
| 2026-07-27 wave23 | Instant List/Accept use same geo/category/trust prefilter as notify (close inbox/accept skew) |
| 2026-07-27 wave24 | Bid-bond forfeit on buyer no-show (ReportNoShow → off-session capture → captured status) |
| 2026-07-27 wave25 | Bid-bond release: losers on auction close/buy-now; winner on escrow held |
| 2026-07-27 wave26 | Bond cancel release + CreateOffer bond gate; Instant distance order + enrich accept notify; fee tests; tracker honesty MON-14/16/17/19/26 Done |
| 2026-07-27 wave27 | MON-18 dispute/release mutual FOR UPDATE claim; SEC-07 signed has_session HMAC; live_auction + spectator_mode RequireFlag SSOT |
| 2026-07-27 wave28 | MON-15 BNPL charge-first hardened (resolveCustomerStripeID fail-closed) + regression tests; tracker Done |
| 2026-08-02 re-reconcile | Doc honesty vs code: InstantPayout gRPC+UI, FR-8.1 inquiry, FR-8.8 share-contact, PDF verify/chat, Facebook native, Team/Challenges/Legal, bid filters, schedule picker, recurring edit, tab badges, distance labels marked **[x]**; Instant AI/ETA Phase 2, StoreKit, admin OOS, Checkr, ops rows stay honest residual |
