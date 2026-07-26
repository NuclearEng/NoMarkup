# App Store Launch Board — NoMarkup

**Program:** `/app-store-launch-readiness`  
**Started:** 2026-07-26  
**Current stage:** **B0–B4 done** (scaffold, auth hooks, catalog browse, flag-off) → next **B2 StoreKit** when ASC products exist; **B6** packaging  
**Binary readiness:** **NOT READY** for App Review (no StoreKit digital unlocks, no ASC package, no team signing)

Status: `todo` · `in_progress` · `done` · `blocked` · `deferred`

---

## Stage A — Documentation

| ID | Status | Artifact |
|----|--------|----------|
| A0–A6 | **done** | review-logs, inventories, dual-rail Option A, capability-matrix |

---

## Stage B — Implementation

| ID | Item | Status | Notes |
|----|------|--------|-------|
| B0 | SwiftUI scaffold | **done** | `ios/NoMarkup.xcodeproj` BUILD SUCCEEDED |
| B1 | SIWA + purpose strings + legal + delete/export | **done** | + `POST /api/v1/auth/apple/native` |
| B2 | StoreKit digital dual-rail | **todo** | No stubs; wait ASC products |
| B3 | Marketplace + jobs list/detail | **done** | Live GET listings/jobs APIs |
| B4 | iOS hard-off regulated flags | **done** | FeatureFlags.iOSHardOffKeys |
| B5 | Push | **deferred** | Do not claim in ASC |
| B6 | ASC packaging | **todo** | Screenshots, labels, IAP, demo |

### Agent team B3/B4 (this turn)

| Stream | Result |
|--------|--------|
| B3 catalog | Models + APIClient fetch + Marketplace/Jobs list/detail UI |
| B4 flags | FeatureFlags hard-off set + Home “Launch gates” + Account StoreKit notice |

---

## Decision log

| Date | Decision |
|------|----------|
| 2026-07-26 | SwiftUI native chrome; reject pure WKWebView |
| 2026-07-26 | Dual-rail Option A (web Stripe honor + IAP sell) |
| 2026-07-26 | Native SIWA: `POST /api/v1/auth/apple/native` |
| 2026-07-26 | B4 hard-off: bnpl, working_capital, insurance*, legal_services, lead_gen, instant_payout |
| 2026-07-26 | Public catalog browse on device without auth |

---

## Build

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
cd ios
xcodebuild -scheme NoMarkup -project NoMarkup.xcodeproj \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

---

## Next

```text
Option A — B6 packaging docs + app icon + ASC checklist (no StoreKit).
Option B — B2 StoreKit when Apple team + subscription products ready.
Option C — B3+ bid/pay/chat write paths (auth-gated).
```

Do **not** claim App Store submission-ready until B2 (or explicit “no digital IAP in v1” product cut) + B6 + ops staging.
