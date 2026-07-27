# PRD + iOS parity backlog

**Date:** 2026-07-26 (audit session continued 2026-07-27)  
**Sources:** `PRD.md` v2.0 §8–16 · `ios/NoMarkup/` · gateway/services/engines · compliance docs under `docs/compliance/`  
**Verdict:** **Not fully implemented.** Core dual-rail marketplace is largely live on iOS + backend; full PRD parity and App Store submit are not.

---

## 1. Overall status

| Scope | Result |
|--------|--------|
| **Backend (MVP core)** | Largely present: reverse auction, sealed bids, contracts, escrow, reviews/trust, fraud heuristics, chat service, payments, maps APIs |
| **iOS consumer app** | Core paths **live/partial**; many FRs **backend-only or missing UI** |
| **PRD §1 scope** | MVP = web; native iOS = post-MVP — this backlog still measures **full PRD product coverage on iOS** |
| **PRD §22 / expansion** | Intentionally roadmap (Instant AI, enterprise, verticals) |
| **App Store binary** | **NOT READY** — signing, ASC media/labels, review backend, free-tier ASC lock, human device smoke |

Do **not** claim “PRD fully implemented on iOS.” Claim **core reverse-auction + goods dual-rail + contracts/unhappy paths + reviews/trust**, with gaps below still open.

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
| iOS ↔ web matrix | Near-live core; OAuth social, native WS, StoreKit/admin intentionally incomplete |
| **FR-18 per-instance Stripe pay** | Config/instances/pause/resume/cancel + lazy roll-forward + approve/complete CreatePayment + one off-session attempt + FR-16.7 due-row gateway CreatePayment retry **shipped**; iOS shows `off_session_charged` + `payment_retry_count`/`next_retry_at` when gateway projects them. Residual: dogfood + webhook first-fail pause |

---

## 3. PRD coverage snapshot (iOS + backend)

### FR-1…10 (~93 FRs)

| Status | Share |
|--------|------:|
| LIVE (E2E iOS) | ~19% |
| PARTIAL | ~39% |
| BACKEND_ONLY | ~24% |
| OUT_OF_SCOPE_IOS (admin) | ~10% |
| MISSING | ~9% |

### FR-11…19 + §§10–16

| Strength | Weak / missing |
|----------|----------------|
| Contracts lifecycle, guarantee claim, notifications/prefs | FR-18 visit PI + off-session + FR-16.7 due-row CreatePayment retry shipped |
| Properties CRUD + dashboard lite, referrals, FinServ hub (flagged) | Full FR-19 spend analytics depth |
| Trust scores / verification upload | — |
| Dual-rail goods + services shell | Instant AI/ETA Phase 2 |
| Leave review + document download | Subscription purchase FR-12; growth share cards §11 |

### Solid on iOS today

- Auth: email/password + SIWA + MFA hooks; Keychain JWT  
- Jobs: browse/map, post (subset), drafts, bid/award/close/cancel, live auction poll  
- Goods: marketplace, sell, orders, Apple Pay Rail A (env-dependent); bid retract (detail + MyBids, 60s)  
- Contracts: accept/start/complete/approve, milestones, change orders, tip, dispute, no-show, abandonment, documents + leave review + **local_terms card (FR-5.4)**  
- Instant: customer emergency CTA + provider offers; provider weekly schedule (GET hydrate + PUT)  
- Trust: score/tiers; verification doc upload  
- Account: properties, messages (REST poll), notifications + APNs register, Stripe Connect, business/finance hub  
- Growth: referrals, savings, NPS  

### Highest-impact residual gaps

| Area | PRD | Gap |
|------|-----|-----|
| Chat | FR-8 | Attachments/search + native WS/typing + last_read Seen + live `read_receipt` WS shipped |
| Recurring | FR-18 | Lifecycle + roll-forward + approve/complete CreatePayment + off-session + FR-16.7 due-row gateway retry **shipped**; iOS surfaces `off_session_charged` + payment retry count / next retry when present |
| Instant | §13 | iOS + web Instant schedule GET/PUT + hydrate; ListProviderOffers/Accept **consume schedule** (wave12); push/ETA/AI Phase 2 residual |
| Digital subs | FR-12 | Read-only tiers; StoreKit deferred |
| Social OAuth | FR-1.1 | **Google native shipped** (ASWebAuth+PKCE → `/auth/google/native`); needs `GOOGLE_IOS_CLIENT_ID` + reverse URL scheme for dogfood. Facebook still not on iOS |
| Admin / fraud UI | FR-7/13 | Correctly **web-only** |

---

## 4. Unified backlog (execute in order)

### Engineering residual status (2026-07-27 wave15)

**Consumer iOS product surface for PRD MVP depth is largely implemented.** Remaining unchecked items are:
1. **Human/ops-gated** (ASC, device smoke sign-off, always-on review API, Apple Pay domain file, Google iOS client IDs in Console)
2. **Accepted risk / licenses** (MON-14–18, R6.2–R6.6, Checkr, mTLS, StoreKit B2)
3. **Thin polish residuals (honest, as of wave15):**
   - **FR-16.7 due-row auto-charge + UX** — **shipped (gateway + webhook + client project)**: cron CreatePayment `attempt-N`; `payment_intent.payment_failed` joins 3-strike schedule; config GET/JSON projects `payment_retry_count` / `next_retry_at` when non-zero; iOS/web recurring sections show count + next auto-retry. Residual: live Stripe dogfood of full day-0/3/7 path.
   - **Instant AI / ETA / push polish** — schedule window **is** consumed on ListProviderOffers + Accept (wave12); H:MM parse edge hardened (wave15). Phase 2 residual only.
   - **Chat receipts polish** — **shipped (wave17)**: MarkRead publishes live `read_receipt` WS; web last_read watermark Seen + Sent/Seen labels; iOS patches peer watermark on frame. Residual: delivery receipts out of scope.
   - **FR-18 per-instance pay** — approve/auto-approve CreatePayment + soft-replay + off-session + iOS/web pay CTAs + scheduled retry cron **shipped**. Edge residuals only (durable approved_at / funded instance state).

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
- [x] **FR-3 job form + repost** — Full job form (recurrence, offer-accepted, schedule, property) + repost UX  
- [x] **FR-4 bid advanced** — Lower bid, accept-offer, sort/filter bids on iOS  
- [x] **FR-9 services pay** — Services escrow PaymentSheet capture + fee breakdown (not goods-only)  
- [x] **FR-10.4 directions** — Post-award Get Directions (Maps) + `property_id` on PostJob  
- [x] **Web Instant re-request** — JobDetail owner CTA → `POST …/instant-match` when accept-now set  

### P1 — Product depth

- [~] **ops** **Apple Pay domain** — Replace placeholder association file; see [`apple-pay-domain.md`](./apple-pay-domain.md) (do not invent merchant files)  
- [x] **Idempotency residual** — Job-bid durable SQL dedup (migration 110 + PlaceBid key stamp/replay); bid-bond create (109) + confirm authorized soft-replay; iOS sticky keys verified (job/listing bid, bond, payments; buy-now/order-pay deterministic keys)
- [x] **FR-12 digital** — Free-tier-only binary lock (PlanLimitsView + v1 cut); StoreKit deferred  
- [x] **Perf gate close** — Mark parent `perf-gate-2026-07-26.md` PASS from samples; optional BrandAppIcon true 1x/2x/3x  
- [x] **FR-5 profile terms** — Portfolio upload UI + global terms editor + local terms in chat  
- [x] **FR-6 review polish** — Category sub-ratings, respond to review, flag review on iOS  
- [x] **FR-8 chat parity** — Attachments + search + native ChatWebSocketClient + typing + last_read Seen + live `read_receipt`  
- [x] **FR-11 market bars** — Real p25/p50/p75 range bars on post + bid sheet (`/analytics/market/range`)  
- [x] **FR-19 property dash** — Summary cards, edit, history drill-in, property picker on jobs  
- [x] **FR-15/16 evidence** — Revision 200-char + cap UI; dispute/guarantee evidence upload in-app  
- [x] **FR-17.5 deep links** — Notification tap → job / contract / chat / payment  

### P2 — Growth, Instant, platform

- [x] **§13 Instant** — Customer emergency CTA + provider offer accept/decline (iOS); web post + JobDetail re-request  
- [x] **FR-1.1 / realtime** — Google native OAuth (PKCE+id_token) + chat WS; APNs registration already; job auction native WS (`AuctionWebSocketClient` / `/ws/auction/{jobId}`) with HTTP poll fallback; spectator `/spectate` residual
- [x] **§11 share cards** — Savings / review share cards via ShareLink  
- [~] **Apple docs Phases 5–7** (process residual; 0–4 done) — Framework/ASC ops reviews + refresh stale `capability-matrix` / privacy inventory headers  
- [~] **Deploy / mTLS** (ops/infra residual) — `DEPLOY_PROVISIONED` + gRPC mesh mTLS (S9.8 / SEC-GATE-09)  

### P3 / explicit non-goals for consumer binary

- [~] **FR-2.8 / 2.9** — Expiration UX (30d warning) shipped; Checkr still open question / not built  
- [x] **Keep out of consumer iOS** — Admin FR-13; enterprise API / white-label §14; §16 vertical expansion until planned; StoreKit until B2 decision  

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
