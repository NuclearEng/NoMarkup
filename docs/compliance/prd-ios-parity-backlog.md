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

### Not complete (program / product)

| Area | Reality |
|------|---------|
| App Store submit | NOT READY — signing, ASC media/labels, review backend, free-tier ASC lock, human device smoke |
| Showcase living checklist | Global security gates still unchecked; R6.2–R6.6 blocked-compliance; program exit criteria unmet |
| Regulated rails | Still blocked for true live; licenses + E2E + security exits open |
| Security gate | PASS WITH GAPS — money races, RequireFlag gaps |
| Perf gate | Samples PASS but parent sign-off still marked PENDING in places |
| iOS ↔ web matrix | Near-live core; OAuth social, native WS, StoreKit/admin intentionally incomplete |
| v1 cut / hard-offs | **Docs stale:** code has `iOSHardOffKeys = []` + Business & finance UI; several docs still say hard-off |

### Critical honesty gap

Code + `ios-web-feature-matrix.md` = **no client hard-offs**, regulated UI behind **server flags**.

Still describe hard-offs (must reconcile before submit):

- `v1-ios-product-cut.md`
- `device-smoke-checklist.md`
- `submission-blockers.md`
- `security-gate-2026-07-26.md` (hard-off PASS language)
- `showcase-living-checklist.md` §11
- `launch-board.md` B4

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
| Contracts lifecycle, guarantee claim, notifications/prefs | **Recurring FR-18** (gRPC stubs) |
| Properties CRUD-lite, referrals, FinServ hub (flagged) | Property dashboard FR-19 |
| Trust scores / verification upload | True market range bars FR-11 |
| Dual-rail goods + services shell | Instant customer funnel §13 |
| Leave review + document download | Subscription purchase FR-12; growth share cards §11 |

### Solid on iOS today

- Auth: email/password + SIWA + MFA hooks; Keychain JWT  
- Jobs: browse/map, post (subset), drafts, bid/award/close/cancel, live auction poll  
- Goods: marketplace, sell, orders, Apple Pay Rail A (env-dependent)  
- Contracts: accept/start/complete/approve, milestones, change orders, tip, dispute, no-show, abandonment, documents + leave review  
- Trust: score/tiers; verification doc upload  
- Account: properties, messages (REST poll), notifications + APNs register, Stripe Connect, business/finance hub  
- Growth: referrals, savings, NPS  

### Highest-impact PRD gaps

| Area | PRD | Gap |
|------|-----|-----|
| Onboarding | FR-1.5–1.9 | No guided flow; no email-verify UI; no phone OTP |
| Job form / repost | FR-3.1, 3.5, 3.10 | Missing recurrence, offer-accepted, schedule, property; no repost |
| Bidding | FR-4.3–4.7 | No lower-bid, accept-offer, multi-sort/filter |
| Chat | FR-8 | Poll only; no typing/WS/attachments/search/terms |
| Payments | FR-9 | Services PaymentSheet capture + fee UX thin vs goods |
| Maps | FR-10.4–10.6 | No Get Directions; no property on post |
| Recurring | FR-18 | Backend Unimplemented + no iOS lifecycle |
| Properties | FR-19 | List/CRUD-lite only; no dashboard/spend/history |
| Instant | §13 | Backend match route; no customer emergency CTA |
| Digital subs | FR-12 | Read-only tiers; StoreKit deferred |
| Social OAuth | FR-1.1 | Google/Facebook not on iOS |
| Admin / fraud UI | FR-7/13 | Correctly **web-only** |

---

## 4. Unified backlog (execute in order)

Status legend: `[ ]` open · `[x]` done · `[~]` partial / accepted residual

### P0 — Integrity, submit, core PRD

- [x] **Doc hygiene** — Reconcile empty `FeatureFlags.iOSHardOffKeys` vs hard-off claims in v1 cut, smoke checklist, submission-blockers, security-gate, living-checklist, launch-board B4  
- [~] **MON-14–18** — Close money races + concurrency tests, **or** keep accepted residual and never enable regulated money in prod  
- [x] **SEC-GATE-03** — `RequireFlag` on money/regulated API routes (today ~7/13 flags UI-only)  
- [~] **R6.2–R6.6** — Stay `blocked-compliance` until licenses + live-flagged exit checklists  
- [ ] **ASC ops** — Team signing, ASC app record, 1024 icon, 6.7" + 12.9" screenshots, privacy labels, age rating, free-tier Review Notes paste  
- [ ] **PRE-05 review backend** — Always-on review API + seed + `APPLE_NATIVE_CLIENT_ID` + Stripe `pk_` for Apple Pay dogfood  
- [ ] **Device smoke** — Human-execute `device-smoke-checklist.md` + sign `launch-board.md` (auto smoke ≠ signed)  
- [ ] **FR-18 recurring** — Implement recurring RPCs (instances / pause / resume) + iOS post / timeline / pause  
- [~] **FR-1.5–1.9 onboarding** — Email/phone **VerificationCenterView** live; full guided multi-step wizard still open  
- [~] **FR-3 job form + repost** — Full job form (recurrence, offer-accepted, schedule, property) + repost UX  
- [x] **FR-4 bid advanced** — Lower bid, accept-offer, sort/filter bids on iOS  
- [ ] **FR-9 services pay** — Services escrow PaymentSheet capture + fee breakdown (not goods-only)  
- [x] **FR-10.4 directions** — Post-award Get Directions (Maps) + `property_id` on PostJob  

### P1 — Product depth

- [ ] **Apple Pay domain** — Replace `apple-developer-merchantid-domain-association` placeholder  
- [~] **Idempotency residual** — Job-bid durable SQL dedup + sticky iOS Idempotency-Key + bid-bond double-tap uniqueness  
- [ ] **FR-12 digital** — ASC free-tier-only lock **or** full StoreKit B2 (no stubs)  
- [x] **Perf gate close** — Mark parent `perf-gate-2026-07-26.md` PASS from samples; optional BrandAppIcon true 1x/2x/3x  
- [ ] **FR-5 profile terms** — Portfolio upload UI + global terms editor + local terms in chat  
- [~] **FR-6 review polish** — Category sub-ratings, respond to review, flag review on iOS  
- [ ] **FR-8 chat parity** — Native WS / typing / receipts, attachments, search, proposed terms  
- [ ] **FR-11 market bars** — Real p25/p50/p75 range bars on post + bid sheet (`/analytics/market/range`)  
- [ ] **FR-19 property dash** — Summary cards, edit, history drill-in, property picker on jobs  
- [ ] **FR-15/16 evidence** — Revision 200-char + cap UI; dispute/guarantee evidence upload in-app  
- [x] **FR-17.5 deep links** — Notification tap → job / contract / chat / payment  

### P2 — Growth, Instant, platform

- [ ] **§13 Instant** — Customer emergency CTA + provider offer accept/decline inbox on iOS  
- [ ] **FR-1.1 / realtime** — Google OAuth on iOS; native chat/auction WS (poll OK interim); claim APNs only if real  
- [ ] **§11 share cards** — Savings / review share cards via ShareLink  
- [ ] **Apple docs Phases 5–7** — Framework/ASC ops reviews + refresh stale `capability-matrix` / privacy inventory headers  
- [ ] **Deploy / mTLS** — `DEPLOY_PROVISIONED` + gRPC mesh mTLS (S9.8 / SEC-GATE-09)  

### P3 / explicit non-goals for consumer binary

- [ ] **FR-2.8 / 2.9** — Document expiration alerts + Checkr background checks (open question)  
- [x] **Keep out of consumer iOS** — Admin FR-13; enterprise API / white-label §14; §16 vertical expansion until planned; StoreKit until B2 decision  

---

## 5. Suggested implementation waves

| Wave | Focus | Unlocks |
|------|-------|---------|
| **W0** | Doc hygiene + hard-off honesty + ASC free-tier narrative | Submit honesty |
| **W1** | FR-18 recurring backend + iOS | PRD recurring / lock-in |
| **W2** | FR-1 onboarding/OTP + FR-3 job form + FR-4 bid advanced | Core auction completeness |
| **W3** | FR-9 services pay + FR-10 directions + property picker | Money + geo UX |
| **W4** | FR-8 chat + FR-6 reviews + FR-15/16 evidence + notif deep links | Trust / support |
| **W5** | FR-11 market bars + FR-19 property dashboard | Intelligence differentiators |
| **W6** | §13 Instant + §11 share cards | Growth / emergency |
| **W7** | StoreKit **or** permanent free-tier ASC lock | Digital commerce policy |
| **W8** | Ops: ASC media, signing, review backend, human smoke | App Review submit |

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
| `v1-ios-product-cut.md` | Free-tier-only digital cut (**stale on hard-offs**) |

---

## 7. Change log

| Date | Note |
|------|------|
| 2026-07-27 | Initial backlog written from PRD §8–16 audit + compliance gate residual list |

| 2026-07-27 | Wave: doc hygiene, RequireFlag SEC-GATE-03 + tests, FR-4 lower/accept-offer, FR-10 directions+property, FR-1 verify center, FR-3 post fields, FR-6 category ratings, FR-17 deep links, perf-gate PASS close |

