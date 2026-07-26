# Submission blockers remaining (one-pager)

**As of:** 2026-07-26 (post Stage **B0–B4** agent team)  
**Claim:** We do **not** claim App Store binary readiness.  
**Web policy surface:** READY WITH FOLLOW-UPS.  
**Native:** Simulator build succeeds — auth hooks, catalog browse, regulated hard-off. **Not** submission-ready.

---

## Blocks first App Store submission

| # | Blocker | Guideline | Status |
|---|---------|-----------|--------|
| **1** | Team signing, App Icon, full product funnel in binary | 2.1, **4.2** | Shell exists; not App Review–quality yet |
| **2** | Digital tiers without StoreKit (or hide purchase) | **3.1.1** | **B2** still open |
| **3** | ASC package (screenshots, age rating, privacy labels, IAP) | 2.3, 5.1 | **B6** |
| **4** | Review backend always-on | PRE-05 | Ops |
| **5** | ~~Native purpose strings~~ | 5.1 | **Done** (Info.plist) |
| **6** | ~~Regulated features left ON~~ | 3.2 | **Hard-off** in `FeatureFlags` (B4) |

---

## Cleared this session (B0–B4)

| Item | Evidence |
|------|----------|
| Native chrome (not pure WebView) | `ios/NoMarkup` TabView shell |
| SIWA path | `POST /api/v1/auth/apple/native` + client exchange |
| Legal links | Safari to no-markup.com privacy/terms/support/community |
| Account deletion / export | `DELETE/GET …/users/me` (+ export) |
| Listings + jobs list/detail | Public GET APIs wired in UI |
| Regulated rails | Hard-off keys in `FeatureFlags.iOSHardOffKeys` |

---

## Locked decisions

1. Rail A Stripe GMV · Rail B StoreKit digital (Option A multiplatform).  
2. No pure WKWebView app.  
3. No ATT unless ads/IDFA.  
4. Hard-off: `customer_bnpl`, `working_capital`, `per_job_insurance`, `insurance_competition`, `legal_services`, `lead_gen`, `instant_payout`.

---

## Next

- **B6** packaging checklist + icon, or  
- **B2** StoreKit when ASC products exist, or  
- **B3+** bid/pay/chat write paths  

Do not submit until B2 strategy is explicit (implement IAP **or** ship free-tier-only with no digital paywall).
