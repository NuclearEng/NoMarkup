# iOS Payment Rails Design (Dual-Rail)

**Status:** DEFERRED packaging — design only. **Do not stub StoreKit.**  
**Related ASR:** ASR-3.1.1.* (IAP), ASR-3.1.3.e (marketplace), ASR-3.2.1.viii
(licenses), ASR-5.1.1.ix (regulated).  
**Last updated:** 2026-07-26  
**Phase reviews:** `review-logs/phase-4a.md` (Rail A), `review-logs/phase-4b.md` (Rail B)

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
service contracts (`services/payment`, gateway handlers). Native iOS uses
**Stripe PaymentSheet with Apple Pay preferred** (card / Link as fallback) for
**Rail A** only — see § Apple Pay / native checkout below.

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

## Apple Pay / native checkout (shipped path)

- Apple Pay is a **wallet on Stripe** for Rail A (and web), not a separate
  processor — **not** StoreKit IAP.
- **iOS native (current):**
  1. `POST /api/v1/listings/{id}/buy-now` → `order_id` + PaymentIntent
     `client_secret` (Idempotency-Key `buy-now:{listingId}`).
  2. Or pay-retry: `POST /api/v1/orders/{id}/pay` → fresh `client_secret`.
  3. Client presents **Stripe PaymentSheet** with Apple Pay merchant config
     (`ios/NoMarkup/Core/RailACheckout.swift`). System Apple Pay sheet when
     the device can make payments; otherwise PaymentSheet card / Link UI.
  4. Account → **Orders** (`MyOrdersView`) lists pending orders and re-opens
     Apple Pay for `pending_payment` escrow.
- **Config (no secrets in git):**
  - Publishable key: Info.plist `StripePublishableKey` or env
    `NOMARKUP_STRIPE_PUBLISHABLE_KEY`.
  - Merchant ID: `merchant.com.nomarkup.app` (entitlement
    `com.apple.developer.in-app-payments` + Stripe Dashboard Apple Pay).
- **Web:** Stripe Payment Request Button (Apple Pay / Google Pay) + Elements;
  domain association
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

## Multiplatform digital entitlement decision

**Guideline:** App Review **3.1.3(b)** (multiplatform services).  
**Full options analysis:** `docs/compliance/review-logs/phase-4b.md` §3.

| Option | Summary |
|--------|---------|
| **A — recommended** | Honor active **web Stripe** Pro/Business entitlements on iOS **and** offer the same digital tiers as **StoreKit IAP** for in-app purchase |
| B — not recommended | Ignore web subscription on iOS; force StoreKit re-subscribe for the same features |

**Chosen: Option A.**

Rationale (short):

1. Matches multiplatform rule: users may access web-acquired subscriptions/features **if** the same items are also available as IAP in the app.
2. Avoids double payment for the same digital unlocks when a provider already pays on web.
3. Keeps purchase-path compliance: **inside the iOS binary**, digital tier sales use StoreKit only — never Stripe Checkout for analytics / featured / limits.
4. Entitlement service (future): grant features if **either** verified Stripe subscription **or** verified StoreKit transaction maps to the tier slug.

**Copy / external purchase:** No global in-app “buy cheaper on the website” CTA for digital tiers. US storefront and External Purchase Link entitlements (3.1.1(a)) are narrow exceptions — default is no external digital purchase steering. See Phase 4B §4.

**Do not stub StoreKit.** No fake product IDs, no CI that claims IAP works without App Store products + server verification.

---

## Apple documentation citations

| Topic | URL | How NoMarkup uses it |
|-------|-----|----------------------|
| App Review Guidelines — Payments (§3.1) | https://developer.apple.com/app-store/review/guidelines/#payments | Source of 3.1.1, 3.1.1(a), 3.1.2, 3.1.3(b), 3.1.3(e) |
| StoreKit | https://developer.apple.com/documentation/storekit | Rail B client APIs (products, purchase, restore, manage subscriptions) |
| In-App Purchase (StoreKit) | https://developer.apple.com/documentation/storekit/in-app_purchase | IAP purchase / subscription flows |
| Auto-renewable subscriptions (App Store) | https://developer.apple.com/app-store/subscriptions/ | Groups, offers, retention, disclosures |
| External Purchase | https://developer.apple.com/documentation/storekit/external_purchase | Entitlements / storefront-limited external digital purchase links — **not** default UX |
| PassKit (Apple Pay and Wallet) | https://developer.apple.com/documentation/passkit | Apple Pay wallet path for **Rail A** only |
| App Store Server API | https://developer.apple.com/documentation/appstoreserverapi/ | Server-side subscription status / history |
| App Store Server Notifications | https://developer.apple.com/documentation/appstoreservernotifications/ | Real-time entitlement lifecycle (ASN v2) |
| Apple Pay marketing | https://developer.apple.com/apple-pay/marketing/ | Button/mark usage when Apple Pay ships |
| Schedule 2 (subscription info) | https://developer.apple.com/support/terms/apple-developer-program-license-agreement/#S2 | Required pre-subscribe disclosures (via 3.1.2(c)) |

Guideline anchors used in this design:

- **3.1.1** — Digital feature unlocks → IAP inside the app.  
- **3.1.1(a)** — External purchase links / storefront caveats (no global cheaper-on-web CTA).  
- **3.1.2** / **3.1.2(a–c)** — Auto-renewable subscriptions, ongoing value, upgrade/downgrade, clear information.  
- **3.1.3(b)** — Multiplatform: honor other-platform purchases **if** also sold as IAP → **Option A**.  
- **3.1.3(e)** — Physical goods & offline services → non-IAP (Stripe / Apple Pay).

---

## Acceptance when this is un-deferred

1. ASC IAP products + server JWS / ASN verification for every digital tier
   (no stub products).
2. Feature matrix test: iOS build cannot purchase digital tier via Stripe
   in-app; web still can.
3. Multiplatform **Option A**: active web Stripe tier grants same digital
   features on iOS; StoreKit available for users who buy on iOS.
4. Rail A E2E on device (job escrow or goods order) still Stripe (+ Apple Pay
   when domain association is production).
5. Regulated flags off **or** counsel-approved license evidence attached to
   review notes.
6. Paywall meets Schedule 2 / 3.1.2(c) disclosure requirements; Restore +
   Manage Subscriptions present.
