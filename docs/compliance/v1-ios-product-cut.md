# v1 iOS Product Cut — Free-Tier-Only Digital

**Status:** Stage C product decision (locked for first App Store binary)  
**Date:** 2026-07-26  
**Guideline anchor:** App Store Review **3.1.1** (digital goods/features → IAP inside the app)  
**Related:** [`ios-payment-rails-design.md`](./ios-payment-rails-design.md) · [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) §7 · [`app-store-review-2026-07-26-launch.md`](./app-store-review-2026-07-26-launch.md) · [`submission-blockers.md`](./submission-blockers.md)

---

## Decision

| Item | Choice |
|------|--------|
| **First binary digital commerce** | **Free tier only** — no paid digital subscription purchase in the iOS app |
| **StoreKit / In-App Purchase** | **Deferred (Stage B2)** — no IAP capability, no product IDs, no purchase/restore UI |
| **Paid Pro / Business digital unlocks** | **Web-only** (Stripe Subscriptions) **or** later IAP when B2 ships |
| **In-app “buy cheaper on web” for digital** | **Forbidden** (no external digital purchase steering by default) |
| **Rail A (physical goods + offline services GMV)** | **Stripe** when payment UI is wired — **not** IAP (**3.1.3(e)**) |
| **Regulated rails** | **Server-flag gated** (no client hard-offs — below) |

**Rationale:** Shipping a digital paywall or paid feature gate on iOS without StoreKit violates **3.1.1**. Completing B2 (ASC products + server JWS/ASN + restore + Option A multiplatform) is not ready. The compliant interim is to **omit digital purchase** entirely and ship browse/auth/legal/free-tier posture only.

This is **not** a claim that the binary is submission-ready overall (funnel, ASC media, signing still open).

---

## What “free tier only” means

### In the binary

- Account UI continues to state: **“Digital subscriptions (StoreKit) — not in this build.”**
- No paywall, no tier upsell sheet, no Stripe Checkout for analytics/featured/bid-limit unlocks.
- Users operate under the product **free** baseline (web seed free tier limits apply server-side where enforced):
  - Lower bid / category / portfolio caps vs Pro/Business
  - No paid analytics / featured placement / priority support unlocks sold in-app
- Users who already purchased Pro/Business **on web** may later be honored under multiplatform **Option A** when B2 ships; **v1 does not implement** entitlement sync UI for paid digital tiers. Do not promise web-tier parity in ASC metadata for v1.

### On the web (unchanged)

- Stripe Subscriptions for Pro/Business remain valid for **web**.
- Do not deep-link from the iOS binary into a digital purchase flow that undercuts IAP rules.

### After B2 (future)

When StoreKit ships:

1. ASC auto-renewable products for Pro/Business (draft IDs only in checklist — create in ASC).
2. Server verify JWS / ASN v2 before granting entitlements.
3. Restore Purchases + Manage Subscriptions.
4. Multiplatform **Option A**: honor verified web Stripe **and** offer same tiers as IAP.
5. Schedule 2 / 3.1.2 disclosures on paywall.

Until then: **do not stub StoreKit.**

---

## Rail A vs Rail B (v1)

| Rail | Scope | v1 iOS |
|------|--------|--------|
| **A — GMV** | Jobs escrow, goods orders, Connect, real-world services | Stripe when **pay UI** is implemented; **non-IAP** (**3.1.3(e)**) |
| **B — Digital** | Analytics, featured, bid limits, fee discounts, etc. | **No purchase path** — free tier only; paid = web or later IAP |

Payment dual-rail design remains the long-term architecture; this cut only freezes **Rail B purchase** for v1.

---

## Regulated rails (server flags — restated)

**Policy (2026-07-26):** Client hard-offs for BNPL / insurance / advances / instant payout are **removed**.  
`FeatureFlags.iOSHardOffKeys` is **empty** (reserved for emergency kill-switches only).  
Rails are controlled by **server feature flags** + gateway `RequireFlag` (fail closed when off).  
Native UI lives under **Account → Business & finance** (`BusinessFeaturesHubView`).

| Key | Product surface | Gate |
|-----|-----------------|------|
| `customer_bnpl` | Customer BNPL / installment plans | Server flag + API |
| `working_capital` | Working-capital advances | Server flag + API |
| `per_job_insurance` | Per-job insurance | Server flag + API |
| `insurance_competition` | Multi-carrier insurance | Server flag + API |
| `legal_services` | Legal services marketplace | Server flag |
| `lead_gen` | Lead-gen fee surfaces | Server flag (web/admin primary) |
| `instant_payout` | Instant payout | Server flag + API |

**App Review risk:** If any regulated flag is **on** for the review environment, reviewers can open those surfaces in-app. Keep production (and review) flags **off** until licenses + counsel exit, or document intentional enablement in Review Notes. Server off = UI shows disabled/unavailable copy; API must still `RequireFlag` where money paths exist.

Canonical matrix: [`ios-web-feature-matrix.md`](./ios-web-feature-matrix.md) § Policy change.

---

## What App Review should test

Use with seed accounts (`customer@nomarkup.com` primary) and live API. Full paste block: `asc-packaging-checklist.md` §11.

### Expected to work

1. Cold launch → native tabs (Home, Marketplace, Jobs, Messages, Account).
2. **Marketplace** public browse → listing detail.
3. **Jobs** public browse → job detail; signed-in **Mine** when auth works.
4. **Sign in** email/password **or** **Sign in with Apple** (`POST /api/v1/auth/apple/native`).
5. **Messages** channel list / read path when auth + seed threads exist.
6. **Account** → Privacy, Terms, Community Guidelines, Support (Safari/legal).
7. **Delete Account** entry (and export if exercised).
8. Explicit copy that **StoreKit / digital subscriptions are not in this build**.

### Not expected

- In-App Purchase products, restore, or subscription management.
- Digital Pro/Business paywall or Stripe digital checkout inside the app.
- Active regulated-rail **purchase** flows when server flags are **off** (default review posture). Surfaces exist under Account → Business & finance when flags are **on** — keep review flags off or disclose (see regulated rails above).
- Push notifications (B5 deferred).
- Full web-parity bid → escrow pay → sell funnel gaps only where write paths are still incomplete (matrix is the live inventory).

### Review notes one-liner (digital)

> This build does **not** include In-App Purchases or a digital subscription paywall. Free-tier only for platform digital feature unlocks. Paid Pro/Business remain web-only until a future StoreKit release. Physical goods and real-world service GMV use Stripe under Guideline 3.1.3(e) when payment UI is enabled.

---

## Acceptance criteria for this cut

| Criterion | Met when |
|-----------|----------|
| No StoreKit / IAP in binary | No IAP capability; no purchase UI |
| Account discloses omission | Current AccountView copy retained |
| No digital Stripe Checkout in binary | No deep-link/paywall for tiers |
| Regulated rails server-gated | `iOSHardOffKeys` empty; hub gated by `isEnabled` + server flags |
| ASC notes include free-tier sentence | Human pastes checklist §11 / this one-liner |
| B2 not claimed | Metadata does not advertise subscriptions |

**Re-open this cut** only when B2 StoreKit is product-ready **or** product permanently abandons in-app paid digital unlocks.

---

## Out of scope for this document

- Completing bid/pay write funnel (engineering Stage B3+ follow-on).
- ASC screenshot capture, App Icon, team signing (ops B6 residual).
- Legal counsel sign-off on Privacy/Terms.

---

*Owner: App Store launch readiness Stage C. Aligns with dual-rail design; does not replace `ios-payment-rails-design.md`.*
