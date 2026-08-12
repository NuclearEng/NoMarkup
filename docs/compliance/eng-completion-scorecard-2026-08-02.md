# Engineering completion scorecard — consumer dual-rail

**Date:** 2026-08-02 (honesty sweep 2026-08-12)  
**Scope:** In-scope **consumer** product engineering for **services reverse-auction + goods marketplace dual-rail** (web + iOS + gateway + Go/Rust services).  
**Not in scope for this score:** App Store ops packaging, founder secrets, vendor contracts (Checkr), regulated licenses, Phase 2 Instant AI.

---

## Score

| Bar | Score | Meaning |
|-----|------:|---------|
| **Engineering consumer dual-rail (in-scope FR eng work)** | **Core shipped — not 100** | Auction → contract → escrow → review (services) and list → bid/BIN → order → release/dispute (goods) are **in code**. Named FR stubs remain (see residuals). Do not treat this as a clean 100. |
| **Full PRD eng-max** | **Core shipped — not 100** | Companion scorecard. Checkr + StoreKit **scaffolded** fail-closed; Instant MapKit drive ETA shipped; AI tracking residual Decision-ID. **ADMIN-IOS SUPERSEDED** — consumer admin desk shipped. |
| **App Store eng packaging pack** | **Docs packaged** | Review Notes, content rating answers, privacy inventory, export compliance key, screenshot matrix, launch board, TestFlight founder steps exist. **Portal submit** still founder (**ASC-OPS**). Not a submit-ready claim. |
| **App Store “submitted / live”** | **Not ready** | Requires Team signing, ASC uploads, screenshots capture, always-on review API, seed password in ASC secure field. |

**Handoff:** founder/next engineer start at [`TURNOVER-2026-08-02.md`](./TURNOVER-2026-08-02.md).

**Honesty clause:** “Core shipped” means dual-rail journeys exist in code. It does **not** mean ASC portal was clicked, licenses are live, Instant AI tracking shipped, or every named FR stub is gone.

---

## Decision-IDs — OUT_OF_SCOPE (explicit)

These are **not** counted as missing dual-rail UI. Closing them is ops, founder, vendor, or product Phase 2 — not “missing auction/escrow UI.”

| Decision-ID | What | Why out of eng bar |
|-------------|------|--------------------|
| **ASC-OPS** | Team signing, ASC app record, 1024 icon, 6.7"+12.9" screenshots, privacy labels, age rating, free-tier Review Notes | Human / ASC portal work (`asc-packaging-checklist.md`, `submission-blockers.md`) |
| **STOREKIT-B2** | StoreKit IAP for digital tiers (FR-12) | **SCAFFOLDED** off-by-default (`StoreKitEnabled=false`). Fail-closed `POST /api/v1/iap/app-store/verify` (503 unless `APP_STORE_IAP_VERIFY` + Apple-root crypto; never `{valid:true}` without crypto). Live IAP = ASC products + roots = Founder-Action. |
| **CHECKR-FR-2.9** | Background checks | **SCAFFOLDED** (`background_checks` flag + POST fail-closed without `CHECKR_API_KEY`; `POST /api/v1/webhooks/checkr` HMAC fail-closed without `CHECKR_WEBHOOK_SECRET`; persist only after verify; never invent PASS). Live vendor keys = Founder-Action. |
| **INSTANT-AI-P2** | Instant live GPS **tracking** + AI match | Soft + MapKit drive ETA **shipped**; tracking/AI remain Phase 2. |
| **ADMIN-IOS** | **SUPERSEDED 2026-08-12** | Was “web-only / zero admin in consumer binary.” **False now:** iOS Account → Admin console (`AdminConsoleView`) is **shipped**, role-gated. Do **not** claim admin was removed. |
| **FOUNDER-SECRETS** | Vault / live Stripe `sk_live` / Apple Pay merchant / domain association / OAuth Console IDs / `APPLE_NATIVE_CLIENT_ID` / PRE-05 always-on review stack | Founder + env provisioning; not code absence |
| **R6-LICENSES** | R6.2–R6.6 regulated-rail true-live | License + compliance exit checklists (`regulated-rails-live-flagged.md`) |
| **DEPLOY-MTLS** | `DEPLOY_PROVISIONED` + gRPC mesh mTLS | Infra residual (S9.8 / SEC-GATE-09) |

---

## Evidence — major shipped items (dual-rail + supporting)

### Money integrity (MON-14–18)

| ID | Closed | Evidence |
|----|--------|----------|
| MON-14 | 2026-07-27 | ProcessPayment CAS + capture idem key; concurrent capture test |
| MON-15 | 2026-07-27 | BNPL charge-first + keyed off-session; fail-closed customer Stripe ID |
| MON-16 | 2026-07-27 | RequestAdvance under provider advisory lock |
| MON-17 | 2026-07-27 | Dispute resolve stamps `stripe_transfer_id` via release key family |
| MON-18 | 2026-07-27 | Dispute freeze ↔ release claim mutual FOR UPDATE |

ADR: `adr-2026-07-26-money-integrity-residual.md` → **SUPERSEDED** (ops dogfood residual only).  
Tracker: `docs/planning/adversarial-action-tracker.md`.

### Services rail (reverse auction)

- Job post (schedule flexible/specific/range, property, offer-accepted, recurrence), drafts, browse, **map filters** (category + min bid)
- Sealed bids, ladder sort/filter (price/trust/rating/volume + trust band + min jobs), award/close/cancel
- Live auction WS + public spectate + LIVE honesty
- Contracts: accept/start/complete/approve, milestones, revision **200-char + 3-cap**, change orders, tip, dispute, no-show, abandonment, local terms
- Escrow PaymentSheet + actor rules (provider cannot self-release)
- Recurring FR-18 + FR-16.7 3-strike retry + visit-row CreatePayment + off-session paths
- Instant MVP: emergency CTA, offers, weekly schedule, geo/category/trust prefilter, InstantPayout gRPC + hub UI (flag-gated)

### Goods rail (forward auction / marketplace)

- List / browse / sell / orders / bid retract (60s leading)
- Apple Pay / Stripe Rail A (env-dependent)
- Bid-bond create/confirm/forfeit/release paths
- **Promote:** pay-then-flip `is_promoted` (`/promote` + `/confirm`)
- Goods dispute/release mutual claim (MON-18) + transfer stamp (MON-17)

### Chat, trust, properties, notifications

- Chat FR-8: WS typing/Seen/read_receipt, **PDF + image**, **inquiry**, **share-contact** — **web + iOS parity**
- Verification center (docs + PDF; FR-2.10 lockout path)
- FR-19: properties + **account spend** + **per-property spend** + **preferred-providers API** (account + property scope)
- FR-17.3 **critical notification locks** (client + gateway enforcement)
- Tab unread badges; notif deep links
- Reviews with **real FR-6.2 persona wire fields** (provider→customer: payment_promptness / scope_accuracy / access); respond/flag; trust tiers
- Instant soft **approx. travel minutes** (haversine heuristic, not live GPS/AI)
- Property **photo_urls** (max 5); onboarding optional address step

### Auth / growth / flags

- SIWA + Google + Facebook native, MFA, passkeys
- Feature flags fail-closed in production on money keys; sticky % where allowed
- Team / Challenges / Legal (flag); referrals, savings, NPS, share cards

### Docs reconciled this pass

- `prd-ios-parity-backlog.md` — polish wave (preferred providers, spend, chat parity, promote, verify center, map filters, notif locks, FR-6.2 honesty, MON ADR)
- `adr-2026-07-26-money-integrity-residual.md` — SUPERSEDED

---

## Honest residuals (do **not** zero the dual-rail eng bar)

**In-scope dual-rail core is shipped; this is not a 100.** Remaining items:

| Residual | Class | Notes |
|----------|-------|-------|
| **Web phone OTP / no-show** | FR stub — **gap-close in progress 2026-08-12** | Gateway `/auth/send-phone-otp` + `/auth/verify-phone` exist. Web client OTP UI not in `web/src`. Contract `ReportNoShow` type exists; no web report-no-show mutation. Do not claim done. |
| **iOS FR-3.1 schedule encode** | Bug (parallel fix) | `PostJobView` picker uses `specific`/`range` (API wants `specific_date`/`date_range`); dates collected, **not sent**. Prior “FIXED” claim was false. |
| **Live Stripe dogfood** | Ops-adjacent verify | FR-16.7 ladder + BNPL/advances under real keys when rails enabled — implementation exists. |
| **Instant AI + live GPS tracking** | **INSTANT-AI-P2** | Soft haversine approx travel **shipped**; traffic-aware live ETA + AI match remain Phase 2. |
| **ASC / Checkr / StoreKit / founder secrets** | Decision-IDs above | Explicit OUT_OF_SCOPE. **ADMIN-IOS no longer OOS** (desk shipped). |
| **Historical security-gate prose** | Doc drift | Prefer this scorecard + SUPERSEDED money ADR over older “MON residual Open” language. |

**Closed this final eng wave (2026-08-02):** FR-6.2 real review columns; map `schedule_type`; web job `distance_km`; Instant soft travel; property photos; FR-18.7 deeper prefill; FR-8.6 server `q=` (already shipped earlier same day).

No **open MAJOR money race** from MON-14–18 remains in the adversarial tracker.

---

## What this scorecard authorizes saying

**Allowed:**

- Core reverse-auction + goods dual-rail + contracts/unhappy paths + escrow actor rules + chat parity depth + properties spend/preferred providers + critical notif locks are **shipped in engineering**.
- MON-14–18 money races are **code-closed** (2026-07-27).
- Consumer iOS is not a thin shell relative to web for dual-rail journeys.
- Consumer iOS **admin desk exists** (role-gated `AdminConsoleView`).

**Not allowed:**

- “PRD fully implemented” or “eng 100/100.”
- “App Store submit READY” without ASC-OPS / PRE-05 / device smoke / Apple Pay domain / founder secrets.
- “Instant AI / live GPS ETA shipped.”
- “StoreKit / Checkr live.”
- “Admin was removed from the consumer binary.”
- “Web phone OTP / contract no-show shipped” (gap-close in progress 2026-08-12).
- “Regulated rails live” without R6 licenses + flags + dogfood.
- “FR-6.2 fully asymmetric wire storage” (labels only today).
- “iOS FR-3.1 schedule FIXED” (tokens + dates still wrong as of this sweep).

---

## Related

| Doc | Role |
|-----|------|
| [`full-prd-completion-scorecard-2026-08-02.md`](./full-prd-completion-scorecard-2026-08-02.md) | Full PRD vs Decision-IDs (FR-1…19 + Phases 2–9) — core shipped, not 100 |
| [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) | **ASC packaging** ops bar (submit packaging — not eng-max) |
| `prd-ios-parity-backlog.md` | Unified backlog + wave log |
| `ios-prd-coverage-audit-2026-07-27.md` | FR census + 2026-08-02 delta |
| `ios-web-feature-matrix.md` | Live/partial/OOS matrix |
| `adr-2026-07-26-money-integrity-residual.md` | SUPERSEDED money ADR |
| `fr-6-2-review-dimensions-residual.md` | Thin FR-6.2 residual |
| `submission-blockers.md` / `launch-board.md` | ASC / smoke ops |
| `docs/planning/adversarial-action-tracker.md` | MON/SEC tracker SSOT |
