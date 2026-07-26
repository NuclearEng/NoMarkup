# Decision: Native iOS client approach (B0)

**Date:** 2026-07-26  
**Status:** Accepted for Stage B0 scaffold  
**Code:** `ios/NoMarkup.xcodeproj`  
**Related:** `docs/compliance/ios-payment-rails-design.md`, `docs/compliance/privacy-purpose-string-inventory.md`, `docs/compliance/ios-mobile-web-readiness.md`

---

## Decision

Ship a **SwiftUI multiplatform native client** (iPhone + iPad, deployment target iOS 17+) with:

- **Native chrome** — `TabView`, navigation stacks, forms, lists, account surfaces
- **URLSession** API client against the existing Go gateway (`AppConfig` base URL)
- **Keychain** token storage stub
- **Sign in with Apple** button shell (`AuthenticationServices` + entitlement)
- **Account deletion entry** and legal links for App Store Guideline **5.1.1(v)** / policy access

This is the production-shaped **scaffold** for Stage B. It is not a feature-complete marketplace app.

---

## Rejected alternatives

| Approach | Why rejected |
|----------|----------------|
| **Pure WKWebView shell of no-markup.com** | App Store Guideline **4.2** (Minimum Functionality): apps that are primarily web wrappers without native value are routinely rejected. Also poor offline/UX for location check-in, camera, and payments. |
| **Capacitor / Cordova hybrid as the app** | Same 4.2 risk if chrome remains web; dual stack maintenance without native depth for SIWA, Keychain, StoreKit (later). |
| **PWA only (no App Store binary)** | Valid product surface (see `ios-mobile-web-readiness.md`) but does not satisfy “App Store presence,” SIWA parity rules when social login is in a binary, or full push/StoreKit paths. Web remains the multiplatform baseline. |

---

## Hybrid boundary (allowed)

| Surface | Technology | Rule |
|---------|------------|------|
| App product UI | **SwiftUI** | Default. Jobs, marketplace, messages, account are native views. |
| Legal / policy HTML | **`SFSafariViewController`** (or equivalent in-app Safari) | Privacy, Terms, Community Guidelines, Support URLs on `https://no-markup.com/*` only. |
| Full product in WebView | **Forbidden as primary UX** | Do not navigate the SPA inside WKWebView as the app. |

Limited WebView for a single authenticated Stripe Connect onboarding step may be evaluated later; it must remain a **leaf** flow, not the shell.

---

## Out of scope for B0

| Item | Deferred to |
|------|-------------|
| **StoreKit / IAP products** | Stage **B2** — dual-rail design only; **no fake IAP stubs** |
| Full marketplace / jobs / chat API wiring | Stage B feature slices |
| APNs push notifications | Stage B |
| CoreLocation request flow (market + check-in) | After chrome; purpose strings already in Info.plist |
| Camera / photo capture implementation | After chrome; purpose strings present |
| Production signing, ASC listing, review submission | Packaging phase |

---

## Architecture notes

```
iOS app (SwiftUI)
  → URLSession → Go API Gateway (auth, REST)
  → (future) WebSocket for chat
  → (future) Stripe iOS SDK for Rail A (real-world GMV)
  → (future) StoreKit for Rail B (digital unlocks only)
```

Legal site and marketing remain on the web zone **`no-markup.com`** (hyphenated). API default release base: **`https://api.no-markup.com`** (overridable via Info.plist `APIBaseURL` / env). Local debug aligns with monorepo gateway on **`:8081`**.

---

## Compliance hooks already in scaffold

- **Guideline 4.2:** native tabs and features, not a website frame  
- **Guideline 4.8:** SIWA control present alongside other login methods (email; OAuth exchange TBD)  
- **Guideline 5.1.1(v):** Delete Account path in Account tab  
- **Privacy purpose strings:** location (combined market + check-in), photo library, camera — no mic / ATT  
- **Payments:** no StoreKit surface that implies digital IAP is live  

---

## Review

Revisit this ADR if:

1. App Review rejects SIWA or deletion UX and requires deeper native flows  
2. Product chooses a modular multi-target app (customer vs provider binaries)  
3. StoreKit Rail B ships and entitlement / server verification becomes in-scope  
