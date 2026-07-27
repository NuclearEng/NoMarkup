# Showcase Living Checklist — Implementation · Security · Performance

**Canonical narrative / brand SSOT:** [`qa/showcase/index.html`](../../qa/showcase/index.html)  
**Brand tokens map:** [`docs/brand/showcase-ssot.md`](../brand/showcase-ssot.md)  
**iOS ↔ web matrix:** [`docs/compliance/ios-web-feature-matrix.md`](./ios-web-feature-matrix.md)  
**App Store / payment cut:** [`docs/compliance/v1-ios-product-cut.md`](./v1-ios-product-cut.md)

> **Standing order:** This file is the **definition of done** for “fully implement the showcase.”  
> Work continues until every row is `live` **or** has an explicit, permanent disposition  
> (`blocked-compliance`, `web-only`, `narrative-only`) with owner + exit criteria.  
> **No silent “good enough.”** Update status only with path:line or command evidence.

---

## Status vocabulary

| Status | Meaning |
|--------|---------|
| `live` | Shipped UI + API E2E on target client(s); security + perf gates met |
| `partial` | Exists but missing fidelity, E2E, security, or perf |
| `roadmap` | Designed; not shipped |
| `blocked-compliance` | Requires licenses, StoreKit, or legal — **must not ship** until exit criteria |
| `narrative-only` | Investor/marketing story only (no product surface required) |
| `n/a-client` | Not applicable to consumer iOS (admin, etc.) |

**Target clients** (per row): `web` · `ios` · `gateway` · `engines`

---

## Global gates (every `live` row must pass)

### Security (always)

- [ ] Authn + authz on every non-public endpoint (ownership / role)
- [ ] Parameterized SQL only; no secrets in client
- [ ] Money: integer cents server-side; Idempotency-Key on money mutations
- [ ] PII: secretbox inventory respected; geometry coarsened where required
- [ ] Stripe: no raw PAN; webhook signature verify on server
- [ ] iOS hard-offs for regulated flags still enforced (`FeatureFlags.iOSHardOffKeys`)
- [ ] Feature flags fail closed in production for enforced routes

### Performance (targets — measure before claiming)

| Surface | Target |
|---------|--------|
| iOS cold tab paint (perceived) | &lt; 300 ms after first frame |
| iOS list scroll | 60 fps on device, no jank on 100-row catalog |
| Public catalog API p95 | &lt; 200 ms |
| Bid path p99 (engine) | &lt; 1 ms local / budget in docs |
| Hero LCP web (lab) | &lt; 2.5 s (north star tighter — see performance.md) |
| Image upload | ≤ 10 MB; decode limits enforced |

**Proof rule:** “live” requires either automated E2E (`scripts/ios-full-feature-e2e.sh` / web tests) **or** dated device/web measurement in this file’s evidence column.

---

## 0. Brand & shell (showcase SSOT)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| B0.1 | Tagline: “The Market Sets The Price. Not The Markup.” | `live` | web, ios | `HomeView` hero; web landing | n/a | n/a | — |
| B0.2 | Wordmark No + gold Markup | `live` | web, ios | Home + Login | n/a | n/a | — |
| B0.3 | Color tokens `#07080b` / `#c9a84c` / `#e4c566` | `live` | web, ios | `BrandTheme`, `globals.css` | n/a | n/a | — |
| B0.4 | Champagne App Icon = in-app tile | `live` | ios | `BrandAppIcon` + `NoMarkupIcon` (2026-07-26) | n/a | asset size OK | — |
| B0.5 | Showcase nav sections present as product IA | `partial` | ios | Tabs: Home/Jobs/Marketplace/Messages/Account — not investor nav | n/a | n/a | Do not clone investor nav into app |

---

## 1. Hero & live auction widget (`#hero`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| H1.1 | Reverse-auction positioning copy | `live` | web, ios | Home hero | n/a | n/a | — |
| H1.2 | Live auction timer (countdown) | `partial` | web, ios | Job/listing countdown chips; not always “live widget” | public map coarsened | TimelineView 1s OK | Unify home LIVE cards + job detail |
| H1.3 | Live bid ladder / bid stream UI | `partial` | web, ios | Job ladder (owner); listing public ladder; sealed non-owner | owner-only job bids | 10s poll | Sealed public stats + live type |
| H1.4 | Market range (“147 data pts”) on job | `partial` | web, ios | Job detail strip: FPI p25–p75 when `has_data`, else budget ceiling; create-form hint | public analytics | soft-fail fetch | Seed FPI data / backfill n_eff for full fidelity |
| H1.5 | Estimated savings vs starting/industry | `partial` | web, ios | Job detail: savings vs **starting bid** when leading lower; SavingsView account-level | auth savings | n/a | Industry-average baseline when FPI usable |
| H1.6 | Auction type live vs sealed | `partial` | gateway, ios | Badge: LIVE sealed / LIVE reverse / sealed; sealed copy for non-owner ladder | authz on ladder | n/a | Enable `ENABLE_LIVE_AUCTION` in staging for state API |

---

## 2. Problem → How it works (`#problem`, `#how-it-works`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| W2.1 | Post job | `live` | web, ios | PostJobView, categories tree | auth + validation | photo 10MB | — |
| W2.2 | Market pricing before bids | `partial` | web, ios | fair-price hint | public | n/a | H1.4 |
| W2.3 | Providers submit sealed/competitive bids | `live` | web, ios | placeJobBid; dollars UI | role provider; idempotency | retries | — |
| W2.4 | Trust scores / badges on bids | `partial` | ios | trust_score object decode + display | no client trust invent | n/a | Surface 4 dimensions if API exposes |
| W2.5 | Choose provider / award | `live` | web, ios | award bid | owner only | n/a | — |
| W2.6 | Milestone tracking + guarantee | `partial` | web, ios | contracts milestones; guarantee claim UI | actor rules escrow | n/a | Guarantee fund ops + copy fidelity |
| W2.7 | Verified reviews after completion | `live` | web, ios | contract reviews | auth parties | n/a | — |

---

## 3. Competitive table (`#competitive`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| C3.1 | Reverse auction pricing | `live` | web, ios | jobs dual path | authz | bid engine | — |
| C3.2 | Market pricing intelligence | `partial` | web, ios | fair-price, savings | public + auth | cache | Expand fair-price UX |
| C3.3 | On-platform payments | `live` | web, ios | Stripe PI / Apple Pay Rail A | no PAN; webhooks | n/a | — |
| C3.4 | Milestone & escrow | `partial` | web, ios | contracts + listing orders | actor rules | n/a | Contract completion → release gaps |
| C3.5 | Identity & license verification | `partial` | web, ios | docs list, licenses | PII | n/a | Provider submit + admin review UX |
| C3.6 | AI fraud detection | `partial` | engines | heuristics v1; ML reserved | server-only | p99 budget | Keep honest copy until ONNX |
| C3.7 | Transaction-verified reviews | `live` | web, ios | reviews on contracts | auth | n/a | — |
| C3.8 | Work completion guarantee | `partial` | web, ios | claim UI | auth | n/a | Fund + payout path |

---

## 4. Trust architecture (`#trust`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| T4.1 | Composite trust score 0–100 | `partial` | engines, gateway | trust service; iOS tier list + bid trust | server computed | trust p99 &lt; 5ms | Expose composite in UI |
| T4.2 | Feedback 35% | `partial` | engines | scoring code | server | n/a | UI breakdown |
| T4.3 | Risk 25% | `partial` | engines | scoring code | server | n/a | UI breakdown |
| T4.4 | Volume 20% | `partial` | engines | scoring code | server | n/a | UI breakdown |
| T4.5 | Fraud 20% | `partial` | engines | fraud heuristics | server | fraud p99 | UI breakdown |
| T4.6 | NoMarkup Guarantee card | `partial` | web, ios | claim + copy | claim authz | n/a | Fund metrics honest |
| T4.7 | Guarantee only on-platform | `live` | product | policy + claim routes | n/a | n/a | — |

---

## 5. Moat / flywheel (`#flywheel`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| M5.1 | Data flywheel narrative | `narrative-only` | — | showcase | n/a | n/a | No app feature required |
| M5.2 | Pricing intelligence from transactions | `partial` | engines, gateway | fair-price / analytics | public careful | cache | Expand catalogs |
| M5.3 | Fraud ML maturity | `roadmap` | engines | ONNX reserved | model supply chain | n/a | Phase gated |

---

## 6. Revenue architecture (`#finserv`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| R6.1 | Marketplace take rate | `partial` | gateway, payment | fee calc paths | money integrity | n/a | Production fee config + audits |
| R6.2 | Outcome lead-gen 10% | `blocked-compliance` | — | flag `lead_gen` hard-off iOS | SEC + product | n/a | Licenses + flag review |
| R6.3 | Provider working capital | `blocked-compliance` | — | `working_capital` hard-off | lending rules | n/a | Licenses |
| R6.4 | Customer BNPL | `blocked-compliance` | — | `customer_bnpl` hard-off | consumer credit | n/a | Licenses + 3.1.x |
| R6.5 | Per-job insurance | `blocked-compliance` | — | insurance flags hard-off | insurance law | n/a | Licenses |
| R6.6 | Instant payout | `blocked-compliance` | — | `instant_payout` hard-off | risk | n/a | Risk review |
| R6.7 | Pro / Business digital subscription | `blocked-compliance` / `web-only` | web | free-tier iOS; no StoreKit | ASR 3.1.1 | n/a | StoreKit B2 or web-only permanent |
| R6.8 | Business services (1099, expenses) | `roadmap` / `web-partial` | web | provider OS partial web | PII | n/a | Provider OS program |

**Exit for blocked-compliance:** written legal/compliance sign-off + hard-off key removed + E2E + security review.

---

## 7. Expansion verticals (`#expansion`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| E7.* | Auto, moving, legal, healthcare, etc. | `roadmap` | — | taxonomy extensible | vertical compliance | n/a | After home-services liquidity |

---

## 8. KPIs (`#metrics`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| K8.* | Year-1 GMV, fill rate, LTV:CAC, etc. | `narrative-only` + ops | monitoring | Prometheus partial | metrics auth | n/a | RUM + admin dashboards |

---

## 9. Tech stack (`#tech`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| S9.1 | Next.js + Tailwind + shadcn | `live` | web | monorepo | CSP nonce | LCP work ongoing | perf.md |
| S9.2 | Go gateway + services | `live` | gateway | monorepo | rate limit, JWT | p95 budgets | mesh mTLS target |
| S9.3 | Rust engines (bid/fraud/trust/…) | `live`/`partial` | engines | workspace members | no unsafe | criterion local | CI bench optional |
| S9.4 | Postgres + PostGIS + Redis + Meilisearch | `live` | data | compose/prod path | PII encryption | query p95 | — |
| S9.5 | Mapbox | `partial` | web | web maps | token env | lazy load | iOS uses MapKit (acceptable) |
| S9.6 | WebSocket real-time | `partial` | web, gateway | WS routes; iOS polls | auth WS | fan-out | Native WS optional |
| S9.7 | Stripe Connect | `live`/`partial` | web, ios | payouts UI + PI | PCI via Stripe | n/a | Onboarding E2E dogfood |
| S9.8 | K8s / OTel / Prometheus | `partial` | deploy | manifests; deploy not full prod | secrets Vault target | scrape auth | provisioning checklist |

---

## 10. Dual-rail goods (product, not showcase hero)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| G10.1 | Forward auction listings | `live` | web, ios | Marketplace | authz | pagination | — |
| G10.2 | Bid bond | `live` | web, ios | SetupIntent flow | money | n/a | — |
| G10.3 | Best offer | `live` | web, ios | offers API | auth | n/a | — |
| G10.4 | Buy now + escrow orders | `live` | web, ios | orders | money | n/a | — |
| G10.5 | Local pickup 25 mi | `partial` | product | model; geo UX | location purpose | n/a | Radius search polish |

---

## 11. iOS consumer completeness (execution track)

Tracked also in `ios-web-feature-matrix.md`. Snapshot:

| Area | Status |
|------|--------|
| Auth / session / offline | `live` |
| Dual-rail create/browse/bid/award | `live` / `partial` live-auction fidelity |
| Contracts advanced | `live` / `partial` tip 501 possible |
| Social (follow/feed/reviews) | `live` |
| Provider workspace lite | `live` |
| Growth (NPS, referrals, markets, savings) | `live` |
| Catalog autocomplete / categories / drafts | `live` |
| Trust tiers / plan limits / ToS | `live` (plan = read-only) |
| Seller exports / templates / docs | `live` |
| WebSocket chat/auction | `partial` |
| Regulated rails | `blocked-compliance` |
| Admin | `n/a-client` |
| StoreKit IAP | `blocked-compliance` |

---

## Priority queue (execute in order)

### P0 — Core showcase fidelity (no compliance block)

1. **H1.4 / H1.5** — Job detail (and home card) market-range + savings strip from fair-price / starting bid  
2. **H1.6** — Sealed vs LIVE labeling + auction state when enabled  
3. **T4.1–T4.5** — Trust breakdown UI when gateway exposes components  
4. **C3.4** — Escrow release/completion path dogfood + fix gaps  
5. **Perf** — Catalog list image budgets; Instruments scroll; API p95 sample  
6. **Sec** — `/security-review` on money paths; idempotency audit remaining gaps  

### P1 — Product depth

7. Provider verification upload E2E  
8. Native chat WS or documented poll SLA  
9. Goods radius search polish  
10. Web RSC/data-cache performance playbook on touched routes  

### P2 — After compliance exit

11. R6.2–R6.6 regulated rails (only with licenses)  
12. R6.7 StoreKit or permanent web-only digital  

### P3 — Narrative

13. Expansion verticals E7.*  
14. KPI dashboards K8.*  

---

## Definition of “fully implemented, secure, performant”

All of the following are true:

1. **Every row** in §0–§11 is `live`, `narrative-only`, `n/a-client`, or `blocked-compliance` with documented exit.  
2. **Zero `partial`** on P0 IDs.  
3. **Security:** last `/security-review` (or equivalent) on auth + payments + PII with no open P0.  
4. **Performance:** budgets in Global gates measured on device + gateway within last 30 days; results linked below.  
5. **E2E:** `scripts/ios-full-feature-e2e.sh` green; web critical path green; device dogfood dated.

---

## Measurement log

| Date | What | Result | Link |
|------|------|--------|------|
| 2026-07-26 | iOS full feature API E2E | 72 pass / 0 fail / 1 skip | `device-e2e-results-2026-07-26.md` |
| 2026-07-26 | XCUITest sim | 3/3 | same |
| 2026-07-26 | Device install customer/provider | OK | same |
| 2026-07-26 | Living checklist created; P0 job market strip + sealed/live badges | BUILD OK | this file + `JobDetailView` |

---

## Change protocol

1. Implement → E2E/measure → update row status + evidence.  
2. Never set `live` without security row check for money/PII/auth.  
3. Blocked-compliance rows: only change after written exit criteria met.  
4. Showcase HTML change → update this checklist in the same PR.

---

*Owner: product + eng. This file is the living program for showcase completeness.*
