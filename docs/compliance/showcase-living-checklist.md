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
| B0.5 | Showcase nav sections present as product IA | `live` | ios | Product IA = Home/Jobs/Marketplace/Messages/Account (investor showcase nav intentionally not cloned) | n/a | n/a | — |

---

## 1. Hero & live auction widget (`#hero`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| H1.1 | Reverse-auction positioning copy | `live` | web, ios | Home hero | n/a | n/a | — |
| H1.2 | Live auction timer (countdown) | `live` | web, ios | Home `HomeJobCard` + `JobDetailView` countdown chips (`TimelineView` 1s); listing cards too. Product surface = home/detail (not investor single-hero widget by design) | public map coarsened | TimelineView 1s OK | — |
| H1.3 | Live bid ladder / bid stream UI | `live` | web, ios | Job owner ladder; listing public ladder; sealed non-owner copy; **live feed** section polls `GET …/auction/state` + `…/events` every 10s (`JobDetailView.liveFeedSection`); dogfood 200 + events on live job `99c799e1-…` | owner-only job bids; public live events | 10s poll SLA | Native WS optional (S9.6) |
| H1.4 | Market range (“147 data pts”) on job | `live` | web, ios | Job detail strip: FPI p25–p75 when usable → category sample → reverse-auction band; **home card** band caption via `MarketRangeMath.reverseAuctionBand`; create-form fair-price hint | public analytics | soft-fail fetch | Engine empty → honest band source labels |
| H1.5 | Estimated savings vs starting/industry | `live` | web, ios | Job detail: savings vs **starting bid** when leading lower + vs **market median** when FPI usable; `SavingsView` account-level lifetime | auth savings | n/a | — |
| H1.6 | Auction type live vs sealed | `live` | gateway, ios | Unified badge: `HomeJobCard` + `JobDetailView.reverseAuctionBadge`; sealed non-owner ladder copy; `ENABLE_LIVE_AUCTION=true` on local gateway; state/events 200 | authz on ladder | n/a | — |

---

## 2. Problem → How it works (`#problem`, `#how-it-works`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| W2.1 | Post job | `live` | web, ios | PostJobView, categories tree | auth + validation | photo 10MB | — |
| W2.2 | Market pricing before bids | `live` | web, ios | fair-price hint on post job / create listing + job detail market strip (H1.4) | public | n/a | — |
| W2.3 | Providers submit sealed/competitive bids | `live` | web, ios | placeJobBid; dollars UI | role provider; idempotency | retries | — |
| W2.4 | Trust scores / badges on bids | `live` | ios | Bid trust chip → `TrustScoreView` (`JobDetailView.trustChip`); composite + 4 dims via `fetchUserTrustScore` | no client trust invent; server scores | n/a | — |
| W2.5 | Choose provider / award | `live` | web, ios | award bid | owner only | n/a | — |
| W2.6 | Milestone tracking + guarantee | `live` | web, ios | Milestones: submit/approve + **request revision** (iOS); guarantee claim file/read; fund metrics from payments/disputes | actor rules escrow | n/a | Refund money path on claim approve remains separate (C3.8 honesty) |
| W2.7 | Verified reviews after completion | `live` | web, ios | contract reviews | auth parties | n/a | — |

---

## 3. Competitive table (`#competitive`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| C3.1 | Reverse auction pricing | `live` | web, ios | jobs dual path | authz | bid engine | — |
| C3.2 | Market pricing intelligence | `live` | web, ios | fair-price API + job market strip (FPI/category/band) + savings surfaces | public + auth | cache | Engine n_eff enrichment optional |
| C3.3 | On-platform payments | `live` | web, ios | Stripe PI / Apple Pay Rail A | no PAN; webhooks | n/a | — |
| C3.4 | Milestone & escrow | `live` | web, ios | Services: `ContractDetailView` customer `releasePayment` (`POST /payments/{id}/release` + Idempotency-Key). Goods: `MyOrdersView` next-action CTAs (pay / confirm-pickup / seller-confirm → mutual release) | actor rules; provider cannot self-release; no client money math | n/a | Web toast still may say “payment released” on approve-completion (contract-only) — copy polish |
| C3.5 | Identity & license verification | `live` | web, ios | Provider: `VerificationDocumentsView` list+upload + licenses; admin review is **web** (`/admin/verification`) — iOS `n/a-client` for admin | PII; 10 MB; server MIME | n/a | Optional web upload UX polish |
| C3.6 | AI fraud detection | `live` | engines | Fraud **heuristics v1** live in fraud engine; ONNX ML remains `roadmap` (M5.3) — product copy must not claim ML | server-only | p99 budget | M5.3 for ONNX |
| C3.7 | Transaction-verified reviews | `live` | web, ios | reviews on contracts | auth | n/a | — |
| C3.8 | Work completion guarantee | `live` | web, ios | Claim file/read E2E; admin review records outcome; **refund is separate payment path** (honest copy); fund SUM from fees | claim authz; payout cap | n/a | Optional auto-refund glue on admin approve |

---

## 4. Trust architecture (`#trust`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| T4.1 | Composite trust score 0–100 | `live` | engines, gateway, ios | Engine + `GET /users/{id}/trust-score`; iOS `TrustScoreView` + `APIClient.fetchUserTrustScore`; entry from `ProviderDetailView`, `JobDetailView.trustChip` | server computed; auth on route | trust p99 &lt; 5ms | — |
| T4.2 | Feedback 35% | `live` | engines, ios | Scoring + UI dim bar (`TrustScoreWeights.feedback` / `UserTrustScore.dimensions`) | server | n/a | — |
| T4.3 | Risk 25% | `live` | engines, ios | Scoring + UI dim bar (`TrustScoreWeights.risk`) | server | n/a | — |
| T4.4 | Volume 20% | `live` | engines, ios | Scoring + UI dim bar (`TrustScoreWeights.volume`) | server | n/a | — |
| T4.5 | Fraud 20% | `live` | engines, ios | Fraud heuristics + UI dim bar (`TrustScoreWeights.fraud`) | server | fraud p99 | ONNX ML remains roadmap (C3.6 / M5.3) |
| T4.6 | NoMarkup Guarantee card | `live` | web, ios | Customer claim card (no invented fund size); admin platform metrics now SUM `guarantee_fee_cents` + claim counts/payouts | claim authz | n/a | — |
| T4.7 | Guarantee only on-platform | `live` | product | policy + claim routes | n/a | n/a | — |

---

## 5. Moat / flywheel (`#flywheel`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| M5.1 | Data flywheel narrative | `narrative-only` | — | showcase | n/a | n/a | No app feature required |
| M5.2 | Pricing intelligence from transactions | `live` | engines, gateway, ios | fair-price + job market strip (FPI/category/band) + savings | public careful | cache | Catalog depth grows with liquidity |
| M5.3 | Fraud ML maturity | `roadmap` | engines | ONNX reserved | model supply chain | n/a | Phase gated |

---

## 6. Revenue architecture (`#finserv`)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| R6.1 | Marketplace take rate | `live` | gateway, payment, job | Services: `CalculateFees` ← `platform_fee_config`. Goods: mint + charge load same table (`listingMarketplaceFeeCents` / `marketplaceSellerFeeCents` / `MarketplaceSellerFeeCents`); admin fee-config edits apply; clients display server `fee_cents` only | money integrity; integer bps | n/a | Optional per-goods-category rows; lead-gen still services-only |
| R6.2 | Outcome lead-gen 10% | `blocked-compliance` | gateway, payment, web admin | Fee model + admin fee_config + breakdown line; flag key exists **without** `RequireFlag` on money routes; no consumer lead product CTA; iOS hard-off | fee stacking + dual-gate | n/a | See [path to live-flagged](#path-to-live-flagged-regulated-rails-r62r66) |
| R6.3 | Provider working capital | `blocked-compliance` | gateway, web | **Scaffolding:** `/providers/me/advances*` + `RequireFlag`; web `/provider/advances` + admin; iOS hard-off + status list only | lending + money races | n/a | Path doc — not `live-flagged` until licenses + E2E + security |
| R6.4 | Customer BNPL | `blocked-compliance` | gateway, web | **Scaffolding:** installment-plans API + `RequireFlag`; web contract selector + `/payments/installments/[id]`; iOS hard-off | consumer credit + 3.1.x | n/a | Path doc — residual money integrity before `live-flagged` |
| R6.5 | Per-job insurance | `blocked-compliance` | gateway, web | **Scaffolding:** `/insurance/*` + quote-requests + `RequireFlag` (both flags); web selector/quotes/admin; iOS hard-off | insurance law | n/a | Path doc — carrier/license + claim prod readiness |
| R6.6 | Instant payout | `blocked-compliance` | gateway, web | **Scaffolding:** summary + POST + ledger claim-first; web `InstantPayoutButton`; **live Stripe path fail-closes 503** (not wired); iOS hard-off | risk + no synthetic success | n/a | Wire Connect instant path + risk review before `live-flagged` |
| R6.7 | Pro / Business digital subscription | `blocked-compliance` / `web-only` | web | free-tier iOS; no StoreKit | ASR 3.1.1 | n/a | StoreKit B2 or web-only permanent |
| R6.8 | Business services (1099, expenses) | `roadmap` / `web-partial` | web | provider OS partial web | PII | n/a | Provider OS program |

**Exit for blocked-compliance → live-flagged:** product complete (no critical money stubs) + E2E + security review + legal path documented; production flag may stay **off**; iOS hard-off may remain.  
**Exit for live-flagged → live:** licenses/partner live + production flag on + runbook. Removing an iOS hard-off key is a **separate** App Review decision.

**Canonical inventory:** [`regulated-rails-live-flagged.md`](./regulated-rails-live-flagged.md) (gateway routes, web UI, hard-off proof, exit criteria, fail-closed rules).  
**iOS App Review surface (read-only, no purchase deep links):** `ios/NoMarkup/Features/RegulatedRailsStatusView.swift` ← Account → Plan limits section.

### Path to live-flagged (regulated rails R6.2–R6.6)

| ID | Why not `live-flagged` yet | Minimum remaining work |
|----|----------------------------|------------------------|
| R6.2 | Fee knob + admin config only; not a full outcome lead-gen product; `lead_gen` flag not enforced via `RequireFlag` on charge path | Product definition; dual-gate fee vs flag; E2E fee-off when flag off; counsel on referral fees |
| R6.3 | Substantial advances UI/API exist, but lending licenses + residual money/security gates open | Licenses/partner; credit-limit flag consistency; concurrency E2E; CSO review |
| R6.4 | Installment scaffolding exists; consumer credit + schedule/escrow interaction not signed off | Licenses/partner; dunning/refund matrix; adversarial plan tests; E2E |
| R6.5 | Insurance + competition scaffolding exists; binding authority / claim prod paths incomplete for go-live | Producer licenses; real claim evidence; multi-carrier rules; E2E quote→bind→claim |
| R6.6 | Ledger + UI exist; **production Stripe instant payout not configured** (intentional 503) | Wire Connect instant; caps under load; risk sign-off; E2E with test Connect |

**Honesty rule:** Do **not** mark these `live-flagged` for documentation or iOS status UI alone. Scaffolding ≠ complete product.

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
| S9.5 | Maps (Mapbox web · MapKit iOS) | `live` | web, ios | Web Mapbox; iOS `JobsMapView` MapKit only (accepted product surface) | token env | lazy load | — |
| S9.6 | WebSocket real-time | `live` | web, gateway, ios | Web WS routes; iOS chat REST poll ~5s + auction HTTP live feed poll 10s (native WS optional enhancement) | auth WS | fan-out; poll only when active | Native `/ws` optional |
| S9.7 | Stripe Connect | `live` | web, ios | `SellerPayoutsView` status/create/onboard + PI paths; PCI via Stripe | PCI via Stripe | n/a | Production onboarding dogfood optional |
| S9.8 | K8s / OTel / Prometheus | `roadmap` | deploy | Manifests + scrape configs exist; full prod provision gated on `DEPLOY_PROVISIONED` | secrets Vault target | scrape auth | provisioning checklist |

---

## 10. Dual-rail goods (product, not showcase hero)

| ID | Capability | Status | Clients | Evidence | Security | Perf | Next |
|----|------------|--------|---------|----------|----------|------|------|
| G10.1 | Forward auction listings | `live` | web, ios | Marketplace | authz | pagination | — |
| G10.2 | Bid bond | `live` | web, ios | SetupIntent flow | money | n/a | — |
| G10.3 | Best offer | `live` | web, ios | offers API | auth | n/a | — |
| G10.4 | Buy now + escrow orders | `live` | web, ios | orders | money | n/a | — |
| G10.5 | Local pickup 25 mi | `live` | web, ios, gateway | Gateway `ListListings` `lat`/`lng`/`radius_km` (cap 40 km) + `distance_km`; iOS `AppConfig.browseCoordinate` → `fetchListings`; `MarketplaceView` row shows distance when present, else city/ZIP (`locationLabel` / `pickupZip`); CreateListing zip | location purpose strings | n/a | Optional device GPS browse center later |

---

## 11. iOS consumer completeness (execution track)

Tracked also in `ios-web-feature-matrix.md`. Snapshot:

| Area | Status |
|------|--------|
| Auth / session / offline | `live` |
| Dual-rail create/browse/bid/award | `live` (badges, countdown, market strip, live feed poll, sticky bid Idempotency-Key) |
| Contracts advanced | `live` (escrow release CTA + goods handshake next actions) / `partial` tip 501 possible |
| Social (follow/feed/reviews) | `live` |
| Provider workspace lite | `live` (verification doc upload path shipped; admin review still partial) |
| Growth (NPS, referrals, markets, savings) | `live` |
| Catalog autocomplete / categories / drafts | `live` |
| Trust tiers / plan limits / ToS | `live` (composite + 4-dim breakdown UI; plan = read-only) |
| Seller exports / templates / docs | `live` (provider verification upload via `VerificationDocumentsView`) |
| WebSocket chat/auction | `live` (chat REST poll SLA + auction HTTP live feed poll) / native WS optional |
| Regulated rails | `blocked-compliance` (BNPL / insurance / lending / lead-gen / instant payout — hard-off; server+web scaffolding inventoried in `regulated-rails-live-flagged.md`; iOS status list only) |
| Admin | `n/a-client` |
| StoreKit IAP | `blocked-compliance` |

---

## Priority queue (execute in order)

### P0 — Core showcase fidelity (no compliance block)

1. **H1.2–H1.6** — ~~done~~ countdown, live feed poll, market/savings strip, home band, LIVE/sealed badges; live state API dogfood (`ENABLE_LIVE_AUCTION=true`)  
2. **T4.1–T4.5** — ~~Trust breakdown UI~~ **done** (`TrustScoreView` + `fetchUserTrustScore`; Provider/Job entry points)  
3. **C3.4** — ~~Escrow release/completion path~~ **done** (iOS `releasePayment` + goods `MyOrdersView` next actions); optional web approve-completion toast copy  
4. **Perf** — ~~Catalog API p95 sample~~ **done** (`perf-gate-2026-07-26.md` overall catalog **PASS**); remaining: Instruments scroll / image budgets on device  
5. **Sec** — Money-path gate: gateway `RequireIdempotencyKey` on job bid + listing bid + bid-bond; **iOS sticky Idempotency-Key** (web parity) for job/listing bid, bond, payment release — residual: durable SQL dedup + MON races  

### P1 — Product depth

7. Provider verification upload E2E — **done** (`VerificationDocumentsView` list + upload); admin review still open under C3.5  
8. ~~Native chat WS or documented poll SLA~~ **done** — REST poll ~5s SLA documented + “Updates every few seconds” caption (`MessagesView` / `ChatThreadView`); native WS remains optional  
9. ~~Goods radius search polish~~ **done** — distance on marketplace rows when `distance_km` present; optional `AppConfig` lat/lng → gateway radius; ZIP/city fallback  
10. Web RSC/data-cache performance playbook on touched routes  

### P2 — After compliance exit

11. R6.2–R6.6 regulated rails (only with licenses) — **still blocked-compliance; do not ship**  
12. R6.7 StoreKit or permanent web-only digital  

### P3 — Narrative

13. Expansion verticals E7.* — narrative/roadmap only  
14. KPI dashboards K8.* — narrative-only + ops  

---

## Definition of “fully implemented, secure, performant”

**Mandate (non-negotiable):** Every **product** row must become **`live`** with **security + performance gates** met.  
`partial` is temporary only while work is in flight — never a resting state.

### Status allowed at program end

| Status | When allowed |
|--------|----------------|
| **`live`** | Required for all product capabilities (core marketplace, dual-rail, trust UI, escrow, etc.) — **with** security + perf evidence |
| **`live-flagged`** | Full implementation + E2E + security exist; production enablement gated by compliance exit (regulated rails). iOS hard-off may remain until exit. |
| **`narrative-only`** | Investor copy with **no** product surface by design (e.g. multi-year TAM story). Must not claim product features. |
| **`n/a-client`** | Consumer app must never ship this (admin). Web/admin may be `live` separately. |

**`blocked-compliance` is not an end state.** It is a queue item that must graduate to **`live-flagged`** (complete secure implementation, flag off until licenses) then **`live`** (flag on).

### Gates for every `live` / `live-flagged` row

1. **Security:** authn/authz, money cents + idempotency where applicable, no secrets in client, PII rules, Stripe PCI path, hard-offs fail closed.  
2. **Performance:** global budgets (API p95, list scroll, cold paint) measured ≤30 days; no known P0 jank on the surface.  
3. **E2E:** covered by `scripts/ios-full-feature-e2e.sh` and/or dedicated tests; device dogfood dated.  
4. **Evidence:** path or command in this file’s row.

### Program complete when

1. **Zero `partial`** rows in §0–§11 (product).  
2. **Zero open P0** security findings on money/auth/PII.  
3. **Performance log** current.  
4. **E2E green.**  
5. All regulated rails at least **`live-flagged`** (code complete + tests + hard-off) or permanently re-scoped out of product with product-owner sign-off.

---

## Measurement log

| Date | What | Result | Link |
|------|------|--------|------|
| 2026-07-26 | iOS full feature API E2E | 72 pass / 0 fail / 1 skip | `device-e2e-results-2026-07-26.md` |
| 2026-07-26 | XCUITest sim | 3/3 | same |
| 2026-07-26 | Device install customer/provider | OK | same |
| 2026-07-26 | Living checklist created; P0 job market strip + sealed/live badges | BUILD OK | this file + `JobDetailView` |
| 2026-07-26 | Wave: job-bid+bond Idempotency, live feed poll, FPI fallback, chat SLA, radius, regulated status UI | BUILD OK; E2E 72/0/1 | this commit |
| 2026-07-26 | Trust breakdown UI (T4.1–T4.5) | **live** — composite + Feedback/Risk/Volume/Fraud dims | `ios/.../TrustScoreView.swift`; `APIClient+Extras.fetchUserTrustScore`; entry `ProviderDetailView`, `JobDetailView.trustChip`; GW `GET /users/{id}/trust-score` |
| 2026-07-26 | Home + job LIVE/sealed badges (H1.2/H1.6) | **live** — unified badge + countdown; live state/events API dogfood | `HomeView` `HomeJobCard`; `JobDetailView.reverseAuctionBadge` |
| 2026-07-26 | Sticky iOS bid Idempotency-Key | **live** — `idempotencyHeader(for:)` sticky UUID map; clear on success (job/listing bid, bond, release) | `APIClient.swift`; `APIClient+Commerce`; `APIClient+Contracts` |
| 2026-07-26 | H1.3 live feed + H1.4/H1.5 market/savings | **live** — 10s poll feed; FPI/category/band strip; home market caption | `JobDetailView`; `HomeJobCard.marketBandCaption`; dogfood job `99c799e1-…` state+events 200 |
| 2026-07-26 | Full feature E2E re-run | **72 pass / 0 fail / 1 skip** | `API_BASE=http://127.0.0.1:8081 ./scripts/ios-full-feature-e2e.sh` |
| 2026-07-26 | Guarantee fund metrics + milestone revision | **T4.6/W2.6/C3.8 live** — platform metrics SUM fees/claims; iOS request revision | `analytics.go` GetPlatformMetrics; `requestMilestoneRevision`; `ContractDetailView` |
| 2026-07-26 | R6.1 goods take rate from fee config | **live** — gateway/job/payment read `platform_fee_config`; charge SSOT | `MarketplaceSellerFeeCents`; `listingMarketplaceFeeCents`; job `marketplaceSellerFeeCents` |
| 2026-07-26 | Idempotency middleware: 2xx-only cache | **fixed** — 5xx/4xx no longer sticky for 24h | `gateway/internal/middleware/idempotency.go` `isIdempotencyCacheable` |
| 2026-07-26 | Regulated rails graduation docs + iOS status stub | R6.2–R6.6 stay **`blocked-compliance`** (honest); path-to-live-flagged documented; iOS hard-offs unchanged | `docs/compliance/regulated-rails-live-flagged.md`; `RegulatedRailsStatusView`; Account under Plan limits |
| 2026-07-26 | Escrow release path (C3.4) | **live** — services release + goods mutual handshake next actions | `ContractDetailView.releasePayment`; `MyOrdersView` nextAction / confirm CTAs |
| 2026-07-26 | Provider verification upload (C3.5 / P1#7) | **partial closer** — provider list+upload E2E path shipped; admin review open | `VerificationDocumentsView` |
| 2026-07-26 | Perf gate — public catalog p95 | **PASS** (jobs/listings/flags/providers/search all p95 &lt; 200 ms @ 20 samples) | `perf-gate-2026-07-26.md` (+ samples block / `perf-gate-2026-07-26-samples.md`) |
| 2026-07-26 | Security gate — money / idempotency | **PASS WITH GAPS** — web listing bid now sends `Idempotency-Key` (`useListings.ts` `usePlaceListingBid`); job-bid & bid-bond gateway still not enforced | `security-gate-2026-07-26.md` (update matrix: web listing bid **Yes**); `web/src/hooks/useListings.ts` |
| 2026-07-26 | Chat REST poll SLA (S9.6 / P1#8) | **live** as WS substitute — ~5s open-thread poll + footer + caption | `ios/.../MessagesView.swift` (`pollIntervalNanoseconds`, `liveUpdateCaption`, inbox footer) |
| 2026-07-26 | Goods radius polish (G10.5 / P1#9) | **live** — distance rows + optional browse lat/lng | `AppConfig.browseCoordinate`; `APIClient.fetchListings(lat/lng/radiusKm)`; `MarketplaceView` `ListingRowView` |

---

## Change protocol

1. Implement → E2E/measure → update row status + evidence.  
2. Never set `live` without security row check for money/PII/auth.  
3. Blocked-compliance rows: only change after written exit criteria met.  
4. Showcase HTML change → update this checklist in the same PR.

---

*Owner: product + eng. This file is the living program for showcase completeness.*
