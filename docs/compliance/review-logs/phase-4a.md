# Phase 4A — Rail A commerce: physical/offline goods & services (3.1.3(e)) + Apple Pay / PassKit

**Date:** 2026-07-26  
**Reviewer:** Grok (app-store-launch-readiness Stage A Phase 4A)  
**Guidelines:** [App Review Guidelines §3.1 Payments](https://developer.apple.com/app-store/review/guidelines/#payments)  
**Design input:** `docs/compliance/ios-payment-rails-design.md`  
**Product under review:** Web marketplace (jobs reverse-auction + goods forward-auction). **No iOS binary / StoreKit in tree.**  
**Status:** **done**

---

## Verdict

| Question | Answer |
|----------|--------|
| May jobs GMV + goods escrow use Stripe (non-IAP) on a future iOS binary? | **Yes** — Guideline **3.1.3(e)** |
| Must Apple Pay for Rail A use PassKit / Stripe wallet path (not StoreKit)? | **Yes** |
| Domain association production-ready? | **No** — placeholder gap (see §4) |
| Implementation this phase? | **None** — documentation only |

---

## 1. Guideline 3.1.3(e) — Goods and services outside of the app

**Rule (paraphrase):** If the app enables purchase of **physical goods** or **services consumed outside the app**, payments **must** use methods other than IAP (e.g. Apple Pay or traditional card entry). Within the app, do not encourage non-IAP purchase of **digital** goods except as allowed under **3.1.1(a)** / US storefront rules.

### Product mapping (NoMarkup)

| Flow | What the buyer pays for | Consumed where | Rail | Processor today |
|------|-------------------------|----------------|------|-----------------|
| Jobs / contracts (`/jobs`, bids, contracts) | Real-world labor / offline services | Off-device (at property / job site) | **A** | Stripe Connect Express escrow |
| Goods marketplace (`/marketplace`, `/sell`, `/orders`) | Physical items, local pickup (25 mi product model) | Physical handover | **A** | Stripe escrow on `listing_orders` |
| Bid bonds / SetupIntents | Anti-fraud hold related to real-world bidding | Not a digital unlock | **A** | Stripe |
| Connect transfers / payouts | Provider/seller proceeds for real-world work/goods | Bank / Stripe Express | **A** | Stripe Connect |
| Dispute refunds / escrow release | Settlement of real-world transaction | Off-app | **A** | Stripe (actor-gated release) |
| Per-job insurance premiums (when licensed) | Regulated real-world product | Policy, not app feature | **A** (Stripe PI) | Flag-off on first iOS binary until licenses |
| Working capital / BNPL | Regulated credit | Off-app financing | **A** web only | **Flag OFF** on first iOS binary |

**Sources:** `docs/marketplace.md`, `docs/compliance/app-review-notes.md` (Escrow rails), `services/payment` escrow/Connect paths, README fee table (platform / guarantee fees on GMV).

### Classification decision

- **Physical goods + offline services → non-IAP is mandatory** under 3.1.3(e), not optional. Charging IAP for job award escrow or listing-order escrow would be the **wrong** rail.
- Platform **take-rate / guarantee fees** embedded in the GMV transfer are part of the real-world marketplace settlement, not a separate digital content unlock — they stay on Rail A with the principal.
- **Person-to-person 1:1 real-time services** (3.1.3(d)) is a secondary fit for some job types (e.g. live consultation), but the primary marketplace product is physical goods + offline services under **3.1.3(e)**. Do not reclassify the whole jobs surface as “digital services” for IAP.

### First iOS binary — preserve Rail A

From `app-review-notes.md` flag-off list (regulated / incomplete money):

| Flag | First iOS binary |
|------|------------------|
| `customer_bnpl` | **OFF** until licenses |
| `working_capital` | **OFF** until licenses |
| `per_job_insurance` | **OFF** until licenses |
| `insurance_competition` | Stay off |
| `legal_services` | Stay off |
| `instant_payout` | OFF or Stripe-only web until product + risk review |

Core jobs/goods escrow **stays on**. Regulated add-ons stay web-gated or off.

---

## 2. Apple Pay / PassKit requirements for Rail A

**Docs:** [PassKit](https://developer.apple.com/documentation/passkit), [Apple Pay marketing guidelines](https://developer.apple.com/apple-pay/marketing/), Stripe Apple Pay domain flow.

| Requirement | Application to NoMarkup |
|-------------|-------------------------|
| Apple Pay is a **wallet**, not a separate commerce processor for IAP | Rail A uses **Stripe** PaymentSheet / Apple Pay as a payment method; funds still settle via Stripe Connect escrow |
| Do **not** route Apple Pay through StoreKit for goods/services | StoreKit is reserved for Rail B digital unlocks only |
| Merchant identity + domain verification for web | Stripe Dashboard → Apple Pay → register `no-markup.com` (and `www` / staging hosts) |
| Native (future): PassKit + Stripe iOS SDK PaymentSheet | When binary exists, use Stripe’s Apple Pay integration for **Rail A only** |
| Disclosure | Privacy / review notes: payments (card, Apple Pay, Google Pay) processed by Stripe; no raw PAN storage |
| Branding | Follow Apple Pay mark / button guidelines when UI ships |

**Guideline cross-ref:** 3.1.3(e) explicitly names Apple Pay as an allowed non-IAP method for physical goods/offline services.

---

## 3. What Rail A does **not** own (boundary with 4B)

Do **not** use Stripe in-app on iOS to unlock:

- Analytics dashboards  
- Featured placement  
- Higher bid / category / portfolio limits  
- Priority support, verified badge boost  
- Subscription fee-discount tier benefits as a **digital entitlement**  

Those are **3.1.1 / 3.1.2** digital features — Phase **4B** / Rail B (StoreKit when implemented).  
Web may continue Stripe Subscriptions until multiplatform IAP ships.

---

## 4. Domain association placeholder gap

| Path | State |
|------|--------|
| `web/public/.well-known/apple-developer-merchantid-domain-association` | **PLACEHOLDER** text: “replace before production Apple Pay” |
| `web/public/.well-known/README.md` | Documents Stripe download + ASR-5.1.2.vii |

**Gap (ops / packaging):**

1. Production host `https://no-markup.com/.well-known/apple-developer-merchantid-domain-association` must serve the **exact** Stripe/Apple-provided association file (not the repo placeholder).
2. Register every public host that will present Apple Pay (apex, `www`, staging if demoed).
3. Do not claim Apple Pay support in App Review notes or marketing until verification succeeds.
4. Related: privacy copy already drafted in `app-review-notes.md` — keep in sync when Apple Pay goes live.

**Does not block Phase 4A design acceptance.** Blocks production Apple Pay claims.

---

## 5. Acceptance criteria for a future native Rail A ship

1. Job escrow + goods order PI/escrow still Stripe; no StoreKit product for GMV.  
2. Apple Pay (if offered) verifies domain + uses Stripe/PassKit path.  
3. Regulated flags off or counsel-approved per `ios-payment-rails-design.md`.  
4. Review notes explain dual-rail: marketplace GMV = Stripe; digital tiers = StoreKit (when present).  
5. No in-app CTA that steers users to buy **digital** unlocks cheaper on the web outside allowed storefronts / entitlements (see 4B).

---

## 6. Explicit non-goals this phase

- No StoreKit / native code.  
- No fake IAP product IDs.  
- No replacement of domain association file with invented production content.  
- No change to web Stripe defaults for GMV.

---

## 7. Status

**Phase 4A: done** — Rail A classification under **3.1.3(e)** confirmed; PassKit/Apple Pay requirements and domain-association gap documented. Proceed to Phase **4B** for digital / multiplatform decisions.
