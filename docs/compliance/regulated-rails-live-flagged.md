# Regulated rails — path to `live-flagged` (fail-closed)

**Date:** 2026-07-26 · **Truth refresh:** 2026-08-21  
**Mandate:** Do **not** enable BNPL / working capital / insurance / lead-gen / instant payout for **App Review / production** until licenses + live-flagged exit.  
**Gate model:** Server feature flags + gateway `RequireFlag` (fail closed). iOS additionally hard-offs the seven regulated keys in `FeatureFlags.iOSHardOffKeys` so a seed-true flag cannot expose purchase CTAs. Migration `129_disable_regulated_feature_flags` sets those rows `enabled=false` in the DB. No licenses are claimed. No StoreKit. No production flag flip from this doc alone.

**Related:**  
[`showcase-living-checklist.md`](./showcase-living-checklist.md) R6.2–R6.6 ·  
[`ios-payment-rails-design.md`](./ios-payment-rails-design.md) ·  
[`FeatureFlags.swift`](../../ios/NoMarkup/Core/FeatureFlags.swift) ·  
[`useFeatureFlags.ts`](../../web/src/hooks/useFeatureFlags.ts) ·  
[`gateway/internal/middleware/feature_flag.go`](../../gateway/internal/middleware/feature_flag.go)

---

## Status vocabulary (this doc)

| Term | Meaning |
|------|---------|
| **Hard-off (iOS)** | Client always returns `false` for the key, ignoring `GET /api/v1/flags` |
| **Server fail-closed** | `RequireFlag` in production → **503** when flag row missing, `enabled=false`, DB error, or nil DB |
| **Web fail-closed UI** | Financial keys in `FINANCIAL_FEATURE_FLAG_KEYS` default **off** while flags load/missing |
| **`live-flagged`** | Full product + E2E + security complete; flag may stay **off** in prod until licenses; iOS hard-off may remain |
| **`blocked-compliance`** | Must not ship as a consumer product until licenses **and** product completeness |

**Honest program status (2026-07-26):** R6.2–R6.6 remain **`blocked-compliance`**. Several rails have **substantial server + web scaffolding**; none meet the checklist bar for **`live-flagged`** (full product + dedicated E2E + security sign-off) yet. This document is the graduation map, not a claim that rails are live.

---

## iOS hard-off + DB disable (review binary)

```text
ios/NoMarkup/Core/FeatureFlags.swift → FeatureFlags.iOSHardOffKeys
database/migrations/129_disable_regulated_feature_flags.up.sql → enabled=false
```

`iOSHardOffKeys` (v1 App Store binary; `isEnabled` returns false regardless of `GET /api/v1/flags`):

- `customer_bnpl`
- `working_capital`
- `per_job_insurance`
- `insurance_competition`
- `legal_services`
- `lead_gen`
- `instant_payout`

Migration **129** sets the same seven keys `enabled=false` in `feature_flags` (060 seeded `customer_bnpl` / `instant_payout` / `per_job_insurance` / `working_capital` as TRUE). Diagnostic UI that already shows "Flag off" keeps working because `isEnabled` is false. This is **not** a license claim; rails stay `blocked-compliance` until live-flagged exit.

| Flag key | Showcase row | Product one-liner | Review / prod until licenses |
|----------|--------------|-------------------|------------------------------|
| `lead_gen` | R6.2 | Outcome / qualified-lead fee on take-rate | **OFF** (server + iOS hard-off) |
| `working_capital` | R6.3 | Provider advances against awarded work | **OFF** (server + iOS hard-off) |
| `customer_bnpl` | R6.4 | Customer installment (BNPL) plans | **OFF** (server + iOS hard-off) |
| `per_job_insurance` | R6.5 | Per-contract insurance quote / purchase / claims | **OFF** (server + iOS hard-off) |
| `insurance_competition` | R6.5 | Multi-carrier quote competition | **OFF** (server + iOS hard-off) |
| `legal_services` | E7 / expansion | Legal vertical browse + license surfaces | **OFF** (server + iOS hard-off) |
| `instant_payout` | R6.6 | Provider instant Connect payout | **OFF** (server + iOS hard-off) |

**Proof path:** `isEnabled(_:)` returns `false` for any key in `iOSHardOffKeys` before reading `serverFlags`. Gateway `RequireFlag` still fails closed when flags are disabled (including after migration 129). Server remains the production gate; iOS hard-off is belt-and-suspenders so seed cannot expose purchase CTAs on the review binary.

iOS consumer surface for App Review education:

- `ios/NoMarkup/Features/RegulatedRailsStatusView.swift` / Business features hub
- Account → Feature flag status / Business & finance

---

## Global security requirements (all rails)

These apply before any rail may leave `blocked-compliance` toward `live-flagged` / `live`.

1. **Fail closed (server):** production `RequireFlag` → 503 on missing flag / error / nil DB (SEC-01). Non-prod may fail-open on missing only.
2. **Fail closed (web UI):** financial keys default off (`useFeatureFlags.ts`).
3. **Fail closed (iOS):** hard-off set unchanged until written legal + product-owner sign-off removes a key.
4. **Money:** integer cents only; **Idempotency-Key** on all money mutations; no client-trusted amounts for fees/premiums/advances.
5. **Authz:** role + ownership on every mutation; providers cannot self-release escrow; admin-only sensitive refunds.
6. **PCI:** Stripe Elements / PaymentIntent only — never raw PAN.
7. **No synthetic success:** never return a fake paid-out / purchased / advanced response when the money path is not wired (production fail-closed).
8. **Feature flag vs fee config:** platform fee knobs (e.g. `lead_gen_enabled` on fee config) must not silently re-enable a product that the feature flag has disabled — dual gates must stay coherent.
9. **Observability:** structured logs + metrics on enablement and money outcomes; metrics scrape auth in prod.
10. **App Review:** no iOS CTAs that start BNPL / advances / insurance purchase / lead-gen sale / instant payout; Account status list is **informational only**.

---

## Per-flag inventory

### 1. `lead_gen` — Outcome lead-gen fee (R6.2)

| Layer | What exists today |
|-------|-------------------|
| **Gateway routes** | **No** `RequireFlag(..., "lead_gen")` on any route group. Fee is applied inside payment fee calculation when **fee_config** `lead_gen_enabled` is true. Admin fee config: `GET/PUT` admin payment fee-config handlers (`gateway/internal/handler/admin_payments.go`) expose `lead_gen_*` fields. |
| **Payment service** | Fee breakdown includes `LeadGenFeeCents` when config enabled (`services/payment/internal/service/service.go`). Default config has `LeadGenEnabled: false`. |
| **Web UI** | Admin: `/admin/payments` fee config toggles + `/admin/flags` lists key. Consumer: `PaymentBreakdownDisplay` shows line item only if fee &gt; 0. **No** dedicated lead-gen marketplace / lead purchase CTA gated on `useFeatureFlag('lead_gen')`. |
| **iOS** | Hard-off. No product UI. Listed as unavailable in `RegulatedRailsStatusView`. |
| **Scaffolding maturity** | **Fee-model partial** — not a full outcome lead-gen product. |

**Exit criteria → `live-flagged`**

- [ ] Product definition: what “outcome lead” is, who pays, when fee attaches, refunds on unclosed outcomes.
- [ ] Wire `RequireFlag(..., "lead_gen")` (or equivalent) so money path cannot charge lead-gen when flag is off — independent of fee_config drift.
- [ ] E2E: flag off → no lead-gen fee in breakdown; flag on (staging) → fee + audit trail.
- [ ] Security review of fee stacking vs platform + guarantee fees; adversarial money tests.
- [ ] Legal/compliance memo for lead-gen / referral fee model in target jurisdictions.
- [ ] iOS hard-off retained until counsel + product-owner remove key.

**Security (fail closed)**

- Flag off or missing → **zero** lead-gen fee, not a soft default 10%.
- Admin fee_config cannot override a disabled product flag in production.
- No iOS monetization surface for lead-gen.

---

### 2. `working_capital` — Provider advances (R6.3)

| Layer | What exists today |
|-------|-------------------|
| **Gateway routes** (under provider auth, `RequireFlag` `working_capital`) | `POST /api/v1/providers/me/advances` · `GET /api/v1/providers/me/advances` · `GET /api/v1/providers/me/advances/{id}` · `POST /api/v1/providers/me/advances/{id}/repay` (idempotency middleware). Handler: `working_capital.go`. Note: `GET /api/v1/providers/me/credit-limit` is **outside** the flag group today — review before live. |
| **Web UI** | Provider: `/provider/advances`. Admin: `/admin/advances`. Nav gated by `useFeatureFlag('working_capital')` in `SidebarNav`. |
| **iOS** | Hard-off. No advances CTA. Status list only. |
| **Scaffolding maturity** | **Substantial server + web product scaffolding** (request/list/repay + admin). Not graduated to `live-flagged` without licenses + money E2E + residual risk close-out. |

**Exit criteria → `live-flagged`**

- [ ] Lending / commercial finance licenses (or partner bank / true lender model) for every live market.
- [ ] Underwriting rules documented; credit-limit endpoint authz + flag consistency.
- [ ] Concurrency / double-advance tests; repay idempotency proven.
- [ ] Disclosures, APR/fee copy, collections policy; state-by-state matrix.
- [ ] E2E staging dogfood with flag on; production flag remains off until go-live checklist.
- [ ] Security review (`/security-review` or CSO) on advance + repay paths.
- [ ] iOS hard-off retained until exit (or permanent web-only disposition).

**Security (fail closed)**

- `RequireFlag` production 503 when off/missing.
- Provider-only mutations; no customer access to advance principal.
- No advance of unreleased / disputed escrow.
- iOS never presents request-advance UI in this binary family.

---

### 3. `customer_bnpl` — Customer installment plans (R6.4)

| Layer | What exists today |
|-------|-------------------|
| **Gateway routes** (`RequireFlag` `customer_bnpl`, under payments auth) | `POST /api/v1/payments/installment-plans` · `GET /api/v1/payments/installment-plans` · `GET /api/v1/payments/installment-plans/{id}` (`installmentHandler`). |
| **Web UI** | Contract detail: `InstallmentPlanSelector` when `useFeatureFlag('customer_bnpl')` + ACTIVE contract + customer. Plan detail: `/payments/installments/[id]`. |
| **Payment domain** | Installment plan + scheduled installment types/services in payment service. |
| **iOS** | Hard-off. No BNPL CTA. Status list only. App Store consumer-credit / 3.1.x sensitivity. |
| **Scaffolding maturity** | **Substantial server + web scaffolding**. Residual money integrity / charge-schedule gaps tracked in planning trackers may still block `live-flagged`. |

**Exit criteria → `live-flagged`**

- [ ] Consumer credit / installment licenses or partner (state/federal as required).
- [ ] Clear TIL / state disclosure UX; default-to-cash path when flag off.
- [ ] Charge schedule failure handling, dunning, refund interaction with escrow release.
- [ ] Adversarial tests: double-create plan, plan on non-owned contract, flag flip mid-plan.
- [ ] E2E staging; production flag off until licenses.
- [ ] iOS hard-off retained (likely longer than web) per App Review posture.

**Security (fail closed)**

- Gateway 503 when flag off; web entry points hidden fail-closed.
- Plan amounts server-computed; customer cannot underpay via client.
- No iOS deep link to create a plan or open web checkout for BNPL.

---

### 4. `per_job_insurance` — Per-job / per-contract insurance (R6.5 part A)

| Layer | What exists today |
|-------|-------------------|
| **Gateway routes** (`RequireFlag` `per_job_insurance`) | Public: `GET /api/v1/insurance/products` (listed public in router — confirm flag attachment on any sensitive subset). Auth group: `POST /api/v1/insurance/quote` · `POST /api/v1/insurance/purchase` · `GET /api/v1/insurance/policies` · `GET /api/v1/insurance/policies/{id}` · `POST /api/v1/insurance/claims` · `GET /api/v1/insurance/claims/{id}`. Admin claims review under admin routes. |
| **Web UI** | `InsuranceSelector` on contract checkout path (`useFeatureFlag('per_job_insurance')`). Dashboard: `/insurance`, `/insurance/[id]`. Admin: `/admin/insurance`. |
| **iOS** | Hard-off. No purchase UI. Status list only. |
| **Scaffolding maturity** | **Substantial server + web scaffolding**. Carrier / MGA / surplus-lines posture and claim evidence paths need production readiness before `live-flagged`. |

**Exit criteria → `live-flagged`**

- [ ] Insurance intermediary / producer licenses (or appointed partner) per state.
- [ ] Binding authority, premium trust accounting, cancel/refund rules.
- [ ] Premium charged only via Stripe PI; server-priced quotes; claim evidence not `blob:` placeholders in prod.
- [ ] E2E quote → purchase → policy → claim (staging).
- [ ] Security review of purchase + claim; fraud interaction.
- [ ] iOS hard-off until licenses + Review notes strategy.

**Security (fail closed)**

- Flag off → 503 on gated routes; no silent bind.
- Premium never client-trusted; policy issuance transactional with payment.
- iOS: zero purchase / bind CTAs.

---

### 5. `insurance_competition` — Competitive quotes (R6.5 part B)

| Layer | What exists today |
|-------|-------------------|
| **Gateway routes** (`RequireFlag` `insurance_competition`) | `POST/GET /api/v1/insurance/quote-requests` · `GET .../{id}` · `POST .../{id}/select`. Admin insurers CRUD under admin. |
| **Web UI** | `/insurance/quotes` + `InsuranceQuoteCompare`; contract page competitive flag; admin `/admin/insurers`. |
| **iOS** | Hard-off. Status list only. |
| **Scaffolding maturity** | **Substantial server + web scaffolding** (multi-carrier request/select). Same insurance-law bar as per-job. |

**Exit criteria → `live-flagged`**

- [ ] Same license bar as per-job insurance + multi-carrier solicitation rules.
- [ ] Insurer onboarding / approval workflow production-ready.
- [ ] Select-quote money path cannot double-bind; flag off mid-funnel safe.
- [ ] E2E multi-quote select; security review.
- [ ] iOS hard-off retained.

**Security (fail closed)**

- RequireFlag 503; web fail-closed hide.
- Select only on owned quote request; no cross-tenant quote read.

---

### 6. `legal_services` — Legal vertical (hard-off; expansion)

| Layer | What exists today |
|-------|-------------------|
| **Gateway routes** (`RequireFlag` `legal_services`) | `GET /api/v1/legal/categories`. Provider verified licenses public list is separate; legal browse is flag-gated. |
| **Web UI** | Public `/legal` landing; header/sidebar when `useFeatureFlag('legal_services')`; job post legal path; provider license UI pieces. |
| **iOS** | Hard-off. Status list only. |
| **Scaffolding maturity** | **Partial vertical** — browse/license surfaces, not a full regulated legal marketplace. |

**Exit criteria → `live-flagged`**

- [ ] Legal services marketplace compliance (UPL, advertising rules, jurisdiction).
- [ ] Verified-lawyer badge policy + license verification ops.
- [ ] E2E browse → engage path without unauthorized practice implications.
- [ ] iOS hard-off until counsel sign-off.

**Security (fail closed)**

- Flag off → legal category browse 503; no iOS legal marketplace CTAs.

---

### 7. `instant_payout` — Instant provider payout (R6.6)

| Layer | What exists today |
|-------|-------------------|
| **Gateway routes** (provider + `RequireFlag` `instant_payout`) | `POST /api/v1/payments/instant-payout` · `GET /api/v1/payments/instant-payout/summary`. Ledger claim-first design in `PaymentHandler.InstantPayout`. |
| **Web UI** | `InstantPayoutButton` + summary on `/provider` when `useFeatureFlag('instant_payout')`. |
| **Production Stripe** | **Not fully wired:** with a real Stripe key present, handler **fail-closes 503** (`instant payout is not configured`) rather than synthetic success. Dev path uses `payout_dev_*` ledger rows only. |
| **iOS** | Hard-off. No instant-payout CTA (`SellerPayoutsView` is standard payouts posture only). Status list only. |
| **Scaffolding maturity** | **Partial** — ledger + risk model + UI exist; **live Stripe instant path incomplete**. Not product-complete. |

**Exit criteria → `live-flagged`**

- [ ] Wire real Connect instant payout RPC/service path; remove any remaining synthetic success under live keys.
- [ ] Caps, fees, eligibility (released/completed only) locked + tested under concurrency.
- [ ] Risk review: clawback, Connect losses, velocity limits, KYC.
- [ ] E2E staging with test Connect accounts; prod flag off until risk sign-off.
- [ ] iOS hard-off retained until product-owner + risk allow (may stay web-only).

**Security (fail closed)**

- Flag off → 503.
- No payout of escrow-held / disputed funds.
- Live Stripe key + unwired path → **503**, never fake `payout_id` success.
- iOS: no instant payout purchase/CTA.

---

## Cross-cutting exit: `blocked-compliance` → `live-flagged` → `live`

### To `live-flagged` (per rail)

1. Server product complete for that rail (no critical stubs on money path).  
2. Web UX complete and flag-gated fail-closed.  
3. `RequireFlag` (or equivalent dual gate) on all money/entry routes.  
4. Dedicated E2E + security review recorded in living checklist measurement log.  
5. Written compliance/legal **path** identified (licenses or partner); flag **remains off** in production.  
6. iOS hard-off **still on** (or permanent `web-only` disposition documented).

### To `live` (flag on in production)

1. Licenses / partner contracts executed for markets where enabled.  
2. Production flag `enabled=true` via controlled admin + runbook.  
3. Monitoring / kill-switch drill.  
4. Only then consider removing a key from `iOSHardOffKeys` (separate App Review decision — **not** automatic with web go-live).

### Explicit non-goals of this graduation step

- Enabling any hard-off flag on iOS.  
- Adding StoreKit.  
- Flipping production flags.  
- Claiming `live-flagged` without product + E2E + security evidence.

---

## App Review education (iOS)

`RegulatedRailsStatusView` under Account → Plan limits section:

- Lists every `iOSHardOffKeys` capability as **Not available in this build / requires compliance**.  
- Shows effective enablement always off for hard-off keys.  
- **Never** deep-links to web purchase, BNPL, insurance bind, advances, or instant payout.  
- Optional legal/support links only if already present as non-purchase legal pages.

Reviewers should conclude: regulated financial/insurance rails are **intentionally omitted** from this binary, not broken.

---

## Evidence pointers (code)

| Concern | Path |
|---------|------|
| iOS hard-off | `ios/NoMarkup/Core/FeatureFlags.swift` (`iOSHardOffKeys`) |
| DB disable (review/prod) | `database/migrations/129_disable_regulated_feature_flags.up.sql` |
| iOS status UI | `ios/NoMarkup/Features/RegulatedRailsStatusView.swift` |
| Account entry | `ios/NoMarkup/Features/AccountView.swift` (Subscriptions / plan limits section) |
| Web financial flag set | `web/src/hooks/useFeatureFlags.ts` |
| Gateway flag middleware | `gateway/internal/middleware/feature_flag.go` |
| Router gates | `gateway/internal/router/router.go` (`working_capital`, `customer_bnpl`, insurance*, `instant_payout`, `legal_services`) |
| Living checklist rows | `docs/compliance/showcase-living-checklist.md` §6 R6.2–R6.6 |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-08-21 | ASR-3.2 / licenses: populate `iOSHardOffKeys` with the seven regulated rails; migration 129 sets DB `enabled=false`. No licenses claimed. |
| 2026-07-26 | Initial inventory + path to live-flagged; iOS read-only status surface; checklist remains honest `blocked-compliance` with scaffolding notes. |
