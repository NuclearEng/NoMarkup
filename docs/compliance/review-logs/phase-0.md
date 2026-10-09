# Phase 0 — Orientation review log

**Date:** 2026-07-26  
**Reviewer:** Grok (app-store-launch-readiness Stage A)  
**Status:** **done**

---

## Documents reviewed (orientation)

| # | Document | URL / path | Status |
|---|----------|------------|--------|
| 0.1 | Developer Documentation hub | https://developer.apple.com/documentation/ | done |
| 0.2 | Documentation Updates | https://developer.apple.com/documentation/updates | done |
| 0.3 | Sample Code Library | https://developer.apple.com/documentation/samplecode | done |
| 0.4 | Internal compliance pack | `docs/compliance/*` | done |

---

## Takeaways

1. **Four different “Apple doc” systems** (do not conflate):
   - **App Review Guidelines** = rejection policy (Safety / Performance / Business / Design / Legal).
   - **developer.apple.com/documentation** = API/reference (StoreKit, PassKit, SwiftUI, etc.).
   - **HIG** = design quality and platform idioms (not a substitute for Guidelines).
   - **App Store Connect Help** = metadata, IAP catalog, review notes, TestFlight ops.

2. **Guideline 2.5.1** requires public APIs only; implementation detail lives in Documentation + release notes (e.g. iOS/iPadOS 26 / Xcode 26 wave as of mid-2026 updates).

3. **Samples** are for Stage B implementation spikes (StoreKit 2, SIWA, Apple Pay), not for policy answers.

4. Internal pack already separates: remediated **web** policy surface vs deferred **binary** packaging (`ios-payment-rails-design.md`, remediated audit).

---

## Product impact

| Decision | Impact |
|----------|--------|
| Policy work can complete on web without binary | Stage A Phase 1 is valid now |
| StoreKit/PassKit reads must complete before B2 code | Prevents Stripe-for-digital-unlock mistake |
| HIG Phase 2 informs both mobile web polish and native shell | Avoid 4.2 thin-WebView trap |

---

## Exit criteria (Phase 0)

- [x] Team can name Guidelines vs Documentation vs HIG vs ASC Help  
- [x] Bookmarks listed in `apple-docs-review-roadmap.md` Quick links  
- [x] Scope locked: Stage A 0–1 this session; no Stage B code  
