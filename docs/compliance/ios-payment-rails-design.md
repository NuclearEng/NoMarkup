# iOS Payment Rails Design (Dual-Rail)

**Status:** DEFERRED packaging — design only. **Do not stub StoreKit.**  
**Related ASR:** ASR-3.1.1.* (IAP), ASR-3.1.3.e (marketplace), ASR-3.2.1.viii
(licenses), ASR-5.1.1.ix (regulated).  
**Date:** 2026-07-26

---

## Decision summary

| Category | Rail | Why |
|----------|------|-----|
| Job services GMV, goods marketplace, escrow, Connect payouts, dispute refunds | **Stripe Connect** | Real-world goods & offline services → App Store **3.1.3(e)** marketplace exception |
| Per-job insurance premiums (when licensed) | **Stripe** PaymentIntent | Insurance is a regulated real-world product, not digital unlock — still needs licenses / org account |
| Working capital advances, BNPL | **Stripe** (web) | Regulated financial products — **flag off** on first iOS binary until licensed |
| **Digital** subscription tiers (analytics, featured listing placement, bid limits, platform feature unlocks) | **StoreKit IAP** on iOS; Stripe on web | Guideline **3.1.1** — digital content/features must use IAP inside the binary |

---

## Rail A — Stripe (multiplatform GMV)

**Owns:**

- Customer → provider payments for awarded jobs.
- Buyer → seller marketplace orders (escrow, local pickup).
- Stripe Connect Express onboarding, transfers, instant payout (when flag on).
- Bid bonds / SetupIntents (anti-fraud).
- Insurance purchase PI paths (when product + licenses allow).

**Does not own:** unlocking purely digital in-app capabilities on iOS.

**Multiplatform parity:** Web and future native clients share the same payment
service contracts (`services/payment`, gateway handlers). Native clients use
Stripe mobile SDKs for PaymentSheet / Apple Pay for **Rail A** only.

---

## Rail B — StoreKit (iOS digital unlocks) — future

**Owns (when implemented):**

- Provider/customer **subscription tiers** that unlock digital features:
  analytics dashboards, featured placement, higher bid limits, spectator
  premium, etc. (today modeled as Stripe Subscriptions on web).

**Implementation constraints (when un-deferred):**

1. No fake StoreKit stubs in CI that claim IAP works.
2. Server must verify App Store Server Notifications / JWS transactions
   before granting entitlements.
3. Entitlement model should be platform-aware: `web` → Stripe customer
   subscription; `ios` → StoreKit product IDs mapped to the same feature flags
   / tier codes.
4. Restore purchases + Manage Subscriptions link (App Store) required.
5. Do not force IAP for physical goods or real-world services.

**Web remains Stripe for Rail B** under multiplatform rules (readers buy on web
with Stripe; iOS binary uses IAP for the same digital unlocks).

---

## First iOS binary — flag-off list

Until Organization Apple Developer + applicable licenses are in place, the iOS
client (or server-side client-type gate) must treat these as **off**:

| Flag | Reason |
|------|--------|
| `customer_bnpl` | Consumer credit / installment regulation |
| `working_capital` | Commercial lending / advances regulation |
| `per_job_insurance` | Insurance intermediary / carrier licensing |
| `insurance_competition` | Same + multi-carrier quotes |
| `legal_services` | Legal services marketplace compliance |
| `instant_payout` | Optional: keep web-only until product + risk review |

Seed defaults today enable several of these for **web** (`060_seed_financial_feature_flags`).
iOS packaging is a **separate** configuration, not a silent change to web defaults.

---

## Apple Pay

- Apple Pay is a **wallet on Stripe** for Rail A (and web), not a separate
  processor.
- Domain association:
  `web/public/.well-known/apple-developer-merchantid-domain-association`
  must be the **Stripe/Apple-provided** file in production (placeholder until
  then). See sibling `README.md` in that folder.
- Policy text: disclose Stripe + Apple Pay / Google Pay; no raw PAN storage
  (see `app-review-notes.md`).

---

## Explicit non-goals this cycle

- No Capacitor/RN/Xcode target in-repo.
- No StoreKit product IDs checked in as “live”.
- No claim that digital tiers are IAP-compliant on iOS until Rail B ships.
- No fake insurance/lending licenses.

---

## Acceptance when this is un-deferred

1. ASC IAP products + server receipt verification for every digital tier.
2. Feature matrix test: iOS build cannot purchase digital tier via Stripe
   in-app; web still can.
3. Rail A E2E on device (job escrow or goods order) still Stripe.
4. Regulated flags off **or** counsel-approved license evidence attached to
   review notes.
