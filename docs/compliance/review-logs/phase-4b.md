# Phase 4B — Rail B commerce: digital subscriptions (3.1.1 / 3.1.2 / 3.1.3(b) / 3.1.1(a))

**Date:** 2026-07-26  
**Reviewer:** Grok (app-store-launch-readiness Stage A Phase 4B)  
**Guidelines:** [App Review Guidelines §3.1](https://developer.apple.com/app-store/review/guidelines/#payments)  
**Apple product docs:** [StoreKit](https://developer.apple.com/documentation/storekit), [Subscriptions](https://developer.apple.com/app-store/subscriptions/), [External Purchase](https://developer.apple.com/documentation/storekit/external_purchase)  
**Domain source:** `services/payment/internal/domain/subscription.go` + `CheckFeatureAccess` / seed tiers (`019_subscription_schema_fix`)  
**Status:** **done**  
**Implementation this phase:** **None** — design / review only. **Do not stub StoreKit.**

---

## Verdict

| Topic | Decision |
|-------|----------|
| Digital tier unlocks on iOS | Must use **StoreKit IAP** (auto-renewable subscriptions) when offered in binary |
| Web Stripe Subscriptions | Remain valid on web; multiplatform policy below |
| Multiplatform 3.1.3(b) | **Recommend Option A** — honor web-purchased tiers on iOS **and** offer same tiers via IAP |
| External purchase / “cheaper on web” CTA | **No global CTA**; US storefront exceptions only; entitlements for other regions if ever used |
| Fake / placeholder product IDs as “implemented” | **Forbidden** |

---

## 1. Digital feature inventory from `SubscriptionTier`

Domain fields (`domain.SubscriptionTier`) and feature gates (`SubscriptionService.CheckFeatureAccess` + free defaults in `GetUsage`):

### 1.1 Tier seeds (migration 019)

| Slug | Monthly | Annual | Fee discount | Max bids | Max categories | Featured | Analytics | Priority support | Badge boost | Portfolio images | Instant |
|------|---------|--------|--------------|----------|----------------|----------|-----------|------------------|-------------|------------------|---------|
| `free` | $0 | $0 | 0 | 3 | 1 | no | no | no | no | 5 | no |
| `pro` | $29.99 | $287.90 | 2% | 10 | 5 | no | yes | yes | no | 20 | no |
| `business` | $79.99 | $767.90 | 4% | 50 | 20 | yes | yes | yes | yes | 100 | yes |

Stripe price IDs live on the tier (`StripePriceIDMonthly` / `StripePriceIDAnnual`) — **web Rail B only today**.

### 1.2 Feature → IAP requirement map

Every paid increment below unlocks **digital platform capability** (not physical goods / offline services). On an iOS binary that sells or unlocks these, **IAP is required** under **3.1.1**.

| Feature key / field | What it unlocks | Free baseline | Requires IAP on iOS? | Notes |
|---------------------|-----------------|---------------|----------------------|-------|
| `analytics` / `AnalyticsAccess` | Analytics dashboard access | false | **Yes** | Explicit `CheckFeatureAccess` gate; Pro+ |
| `featured_placement` / `FeaturedPlacement` | Featured listing / placement | false | **Yes** | Business; digital merchandising boost |
| `priority_support` / `PrioritySupport` | Priority support queue | false | **Yes** | Digital service tier benefit |
| `verified_badge_boost` / `VerifiedBadgeBoost` | Badge boost in discovery | false | **Yes** | Digital ranking / trust UI boost |
| `instant` / `InstantEnabled` | Instant platform capability (tier flag) | false | **Yes** | Distinct from regulated `instant_payout` **feature flag** — still a digital unlock if sold via sub |
| `MaxActiveBids` | Higher concurrent bid limit | 3 | **Yes** (paid tiers raise limit) | Metered freemium → paywall; digital quota |
| `MaxServiceCategories` | More service categories | 1 | **Yes** | Digital catalog capacity |
| `PortfolioImageLimit` | More portfolio images | 5 | **Yes** | Digital storage/display quota |
| `FeeDiscountPercentage` | Lower platform take-rate | 0 | **Yes** | Digital commercial term tied to subscription tier, not a physical good |

**Not in `SubscriptionTier` (do not IAP these as tier products):**

| Item | Rail | Why |
|------|------|-----|
| Job escrow / goods order principal + GMV fees | **A** Stripe | **3.1.3(e)** physical/offline |
| `customer_bnpl`, `working_capital`, insurance flags | Flag-off / Stripe web | Regulated; not StoreKit content |
| Free tier itself | N/A | No purchase |

### 1.3 Ongoing value (3.1.2(a))

Monthly/annual periods (≥ 7 days). Ongoing value: analytics refresh, placement, limits, support priority while subscribed — fits auto-renewable subscription model (SaaS-style provider tools).

---

## 2. StoreKit 2 requirements (when Rail B is un-deferred)

**Docs:** [StoreKit](https://developer.apple.com/documentation/storekit), [App Store subscriptions](https://developer.apple.com/app-store/subscriptions/), [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi/), [App Store Server Notifications](https://developer.apple.com/documentation/appstoreservernotifications/).

| Requirement | NoMarkup application |
|-------------|----------------------|
| **Products in App Store Connect** | Auto-renewable products mapped to `pro` / `business` × monthly/annual (or equivalent levels). **Do not commit invented live product IDs** as “shipped.” |
| **Subscription group** | Single group (recommended) so user has one active level; rank Business > Pro > (free out-of-band) for upgrade/downgrade |
| **Purchase UI** | StoreKit 2 `Product.purchase` / SubscriptionStoreView (or equivalent); clear price, duration, what is included |
| **Restore** | Mandatory restore path (`AppStore.sync` / restore UI) for reinstall / new device (**3.1.1**) |
| **Manage subscriptions** | `AppStore.showManageSubscriptions` + link to system manage UI |
| **Server verification** | Verify JWS / Transaction before granting entitlements; never trust client-only |
| **App Store Server Notifications (ASN) v2** | Subscribe for renew, fail-to-renew, refund, revoke, grace period — drive `subscriptions` status |
| **Entitlement model** | Platform-aware: `web` → Stripe customer subscription; `ios` → StoreKit product → same feature flags / tier slugs |
| **Cross-device** | Subscription available on all devices where app is available (**3.1.2(a)**) |
| **No Stripe purchase of digital unlocks inside iOS binary** | Feature matrix test: iOS cannot complete digital tier buy via Stripe in-app |
| **Family Sharing** | Optional; if enabled, validate `ownershipType` |

### Schedule 2 / subscription disclosures (3.1.2(c))

Before subscribe, communicate (align with [Schedule 2 of the Apple Developer Program License Agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/#S2) and Apple subscription guidelines):

- Title / length of subscription  
- Content or services included during the period  
- Price that will be charged and billing frequency (localized)  
- Links to **Privacy Policy** and **Terms of Use (EULA)**  
- How to cancel / manage (system UI)  
- If free trial: duration + price after trial ends  

Metadata + paywall copy must stay accurate (**2.3**).

---

## 3. Multiplatform decision — 3.1.3(b)

**Rule:** Multiplatform apps **may** let users access content/subscriptions/features acquired on other platforms or the website, **provided those items are also available as in-app purchases within the app**.

### Options

| Option | Behavior | Pros | Cons |
|--------|----------|------|------|
| **(A) IAP parity + honor web** | User with active **web Stripe** Pro/Business gets same features on iOS; non-subscribers can buy the same tiers via **StoreKit** | Matches 3.1.3(b); no double pay; best retention; web GTM unchanged | Need server entitlement merge (Stripe ∪ StoreKit); careful refund/cancel sync |
| **(B) Force iOS re-subscribe via IAP** | Web sub **not** honored on iOS; only StoreKit unlocks digital features in binary | Simpler client gate (“ios → IAP only”) | Double pay / anger; may look like hostage paywall; still must offer IAP for any digital sell-in-app |

### Recommendation: **Option A**

**Rationale:**

1. **Guideline fit:** 3.1.3(b) is written for exactly this: multiplatform services with web purchase + IAP availability.  
2. **Commerce honesty:** Pro/Business already sold on web via Stripe; stripping access on iOS forces repurchase of the same digital entitlements.  
3. **Compliance still hard-closed on purchase path:** Selling digital unlocks *inside* the iOS app always uses StoreKit; Stripe is never the iOS purchase mechanism for tiers.  
4. **Implementation sketch (future):**  
   - `CheckFeatureAccess` / entitlement service: grant if **either** active Stripe sub **or** verified StoreKit entitlement maps to tier.  
   - iOS paywall: only StoreKit products.  
   - Web paywall: only Stripe.  
   - Optional: if user already has Stripe sub, iOS shows “Subscribed via web” and hides buy CTA (no external “buy cheaper on web” marketing).  
5. **Option B rejected** unless legal/product later requires hard separation; default is A.

**Not optional under A:** IAP products for the same digital feature set **must exist** if the app unlocks paid digital features and/or sells them on iOS. Honoring web alone without IAP availability violates the “also available as IAP” clause of 3.1.3(b) if the multiplatform exception is relied upon while offering digital value in-app.

---

## 4. External purchase / 3.1.1(a) caveats

**Docs:** [External Purchase](https://developer.apple.com/documentation/storekit/external_purchase), Guidelines **3.1.1(a)** and **3.1.3** chapeau.

| Storefront / path | Rule of thumb for NoMarkup |
|-------------------|----------------------------|
| **Default (most storefronts)** | No buttons, links, or CTAs that direct users to buy **digital** content/services outside IAP |
| **United States storefront** | Guidelines allow more flexibility for buttons/links/CTAs for other purchase methods without the same entitlement requirement as other regions — **do not** treat “US is free-for-all”; avoid deceptive “cheaper on web” bait; still offer IAP for digital unlocks sold in-app |
| **External Purchase Link entitlement** | Required for *other* specific regions if using StoreKit external purchase link APIs; limited disclosure language per agreement |
| **Out-of-app communication** | Email / web can discuss web pricing; **in-app** must not globally push “subscribe cheaper on the website” |
| **Reader / External Link Account** | Not the primary model (NoMarkup is marketplace + SaaS tools, not magazine/music “reader”) |

**Policy for product/copy:**

- **No global “cheaper on web” CTA** in the iOS binary or App Store metadata.  
- Do not implement External Purchase until counsel + ASC entitlements are explicit.  
- Rail A (physical/offline) Stripe CTAs are fine (checkout for jobs/goods) — that is **not** external purchase of digital content.

---

## 5. Boundary with Phase 4A

| Rail | Payment | Guideline |
|------|---------|-----------|
| **A** jobs GMV, goods escrow, Connect, real-world insurance PI | Stripe (+ Apple Pay wallet) | **3.1.3(e)** |
| **B** subscription tier digital unlocks | StoreKit on iOS; Stripe on web | **3.1.1**, **3.1.2**, multiplatform **3.1.3(b)** Option A |

Never use StoreKit for physical goods escrow. Never use in-app Stripe to unlock analytics/featured/limits on iOS.

---

## 6. Explicit non-goals this phase

- **No implementation** of StoreKit, ASN handlers, or ASC product creation as “done.”  
- **No** checked-in fake product IDs presented as live (`com.nomarkup.*` stubs claiming production readiness).  
- **No** Capacitor/RN/Xcode target.  
- **No** change to production web Stripe subscription billing.  
- **Do not stub StoreKit** in CI to claim IAP works.

---

## 7. Acceptance when Rail B is un-deferred (carry-forward)

1. ASC subscription group + products for Pro/Business (monthly/annual) configured for real review.  
2. Server verifies every grant; ASN v2 wired.  
3. Restore + Manage Subscriptions present.  
4. Schedule 2-aligned paywall disclosures.  
5. Feature matrix: iOS digital buy = StoreKit only; web = Stripe; **Option A** entitlement union.  
6. No global cheaper-on-web digital CTA.  
7. Review notes describe dual-rail for App Review.

---

## 8. Status

**Phase 4B: done** — digital feature → IAP map complete; StoreKit 2 / ASN / Schedule 2 requirements listed; multiplatform **Option A recommended**; external-purchase caveats recorded; **no code**.
