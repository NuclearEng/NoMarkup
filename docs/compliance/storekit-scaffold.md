# StoreKit 2 Scaffold — Rail B Digital Subscriptions (FR-12)

**Status:** Scaffold only — **disabled by default** (`AppConfig.storeKitEnabled = false`)  
**Date:** 2026-08-02  
**Guideline:** App Store Review **3.1.1** (digital features → IAP inside the binary)  
**Related:** [`v1-ios-product-cut.md`](./v1-ios-product-cut.md) · [`ios-payment-rails-design.md`](./ios-payment-rails-design.md) · [`asc-packaging-checklist.md`](./asc-packaging-checklist.md)

---

## Decision for the shipping free-tier binary

| Item | Value |
|------|--------|
| **IAP master switch** | `AppConfig.storeKitEnabled` → **false** (Info.plist `StoreKitEnabled` = false) |
| **Purchase UI** | Hidden when flag is false |
| **Web digital upgrade** | **Forbidden** — PlanLimitsView does **not** link to web checkout / “Manage on web” for digital tiers while IAP is off |
| **Free-tier posture** | “Included free for launch” + read-only paid tier comparison |
| **When to flip true** | ASC products live + Review Notes updated + (ideally) server JWS verify |

This scaffold is **not** a claim that paid digital IAP is review-ready. Default ships free-tier-safe.

---

## Product IDs (draft ASC catalog)

Create as **auto-renewable subscriptions** in App Store Connect under the NoMarkup app.  
Group recommendation: subscription group `nomarkup.provider.plans` (name free-form in ASC).

| Product ID | Tier | Period | Maps to |
|------------|------|--------|---------|
| `nomarkup.provider.pro.monthly` | Pro / Professional | 1 month | Provider Pro digital unlocks |
| `nomarkup.provider.pro.yearly` | Pro / Professional | 1 year | Same features, annual |
| `nomarkup.provider.business.monthly` | Business | 1 month | Business digital unlocks |
| `nomarkup.provider.business.yearly` | Business | 1 year | Same features, annual |

**Defaults** live in:

- `AppConfig.defaultStoreKitProductIDs`
- Info.plist `StoreKitProductIDs` (comma-separated string)
- Override: env `NOMARKUP_STOREKIT_PRODUCT_IDS`

Do **not** enable `StoreKitEnabled` until these IDs exist in ASC for the app record (or StoreKit Configuration file for local dogfood).

---

## Client surface (iOS)

| File | Role |
|------|------|
| `ios/NoMarkup/Core/AppConfig.swift` | `storeKitEnabled`, `storeKitProductIDs` |
| `ios/NoMarkup/Core/StoreKitManager.swift` | Load products, purchase, `Transaction.updates`, restore, local entitlement flag |
| `ios/NoMarkup/Features/PlanLimitsView.swift` | Free-tier / read-only when off; Subscribe / Restore when on |
| `ios/NoMarkup/Features/AccountView.swift` | Subscriptions section copy reflects flag |
| `ios/NoMarkup/Info.plist` | `StoreKitEnabled` = false; product ID string |

### When `storeKitEnabled == false` (default)

1. Plan limits show **Included free for launch** for free rows.
2. Paid API tiers render **read-only** (limits comparison only).
3. **No** “Upgrade”, **no** Stripe Checkout deep link, **no** “Manage on web” for digital purchase steering.
4. `StoreKitManager` does not load products for purchase UI and does not present sheets.

### When `storeKitEnabled == true`

1. PlanLimitsView loads ASC products and may show **Subscribe** + **Restore purchases**.
2. Purchase path is StoreKit 2 only (`Product.purchase`, `Transaction.updates`).
3. Still **no** web digital purchase CTA (multiplatform Option A: web Stripe entitlements may be honored later via server; purchase *inside* the binary remains IAP).

---

## Entitlement residual (honest)

| Path | Status |
|------|--------|
| StoreKit transaction on device | Scaffolded (`Transaction.currentEntitlements` + local UserDefaults flag) |
| Backend verify (App Store Server API / JWS / ASN v2) | **Not implemented** — no `POST /api/v1/subscriptions/apple/verify` in monorepo |
| Server feature grant from IAP | **Do not** grant production paid unlocks from the local flag alone |

`StoreKitManager.notifyBackendIfAvailable` is an intentional no-op placeholder until payment/subscription service accepts verified Apple transactions and maps product IDs → tier slugs.

---

## Enable checklist (before flipping the flag)

1. [ ] Create four auto-renewable products in ASC (IDs above).
2. [ ] Paid Apps Agreement + banking + tax complete.
3. [ ] Optional: StoreKit Configuration `.storekit` file for Simulator dogfood.
4. [ ] Wire server JWS verify (preferred) or accept residual risk with local-only UI.
5. [ ] Set Info.plist `StoreKitEnabled` = true **or** scheme env `NOMARKUP_STOREKIT_ENABLED=true` for dogfood only.
6. [ ] Update App Review Notes (paste block below).
7. [ ] Schedule 2 / 3.1.2 subscription disclosures on any paywall UI.
8. [ ] Restore Purchases tested on device.

---

## App Review Notes language

### Free-tier binary (current default — `storeKitEnabled` false)

> This build does **not** offer In-App Purchase for digital subscriptions. Provider digital feature unlocks are **included free for launch** (free-tier limits). The Plan limits screen is **read-only** comparison of free vs paid tier caps — there is no upgrade button and no link that starts a web digital purchase. Physical goods and real-world service GMV use Apple Pay / Stripe under Guideline **3.1.3(e)** when payment UI is enabled. Paid Pro/Business digital plans may be sold on the website only outside this binary; the app does not steer users to buy digital unlocks on the web.

### When IAP is enabled (`storeKitEnabled` true)

> Digital Pro / Business feature unlocks are sold as **auto-renewable In-App Purchases** (StoreKit 2). Product IDs: `nomarkup.provider.pro.monthly`, `nomarkup.provider.pro.yearly`, `nomarkup.provider.business.monthly`, `nomarkup.provider.business.yearly`. Users can restore purchases from Account → Plan limits. Physical goods and offline services continue to use Apple Pay / Stripe (**3.1.3(e)**), not IAP. Sandbox tester: *[fill in]*.

---

## Alignment with v1 product cut

The free-tier lock in [`v1-ios-product-cut.md`](./v1-ios-product-cut.md) remains the **shipping** policy while `storeKitEnabled` is false. This scaffold is the **B2 on-ramp**: code present, purchase path compile-ready, default off so Review still sees a free-tier-safe binary.

**Re-open paid digital in-app sales** only after the enable checklist above.
