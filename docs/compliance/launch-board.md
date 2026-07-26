# App Store Launch Board — NoMarkup

**Program:** `/app-store-launch-readiness`  
**Updated:** 2026-07-26  
**Current stage:** **B0–B4 + B3+ auth lists + B6 docs** done → residual: **B2 StoreKit** (or free-tier-only ship) + **B6 ops** (signing, screenshots, ASC)  
**Binary readiness:** **NOT READY** for App Review (no StoreKit decision shipped as product, no ASC assets)

---

## Stage A — done

All review-logs phase-0…4b, privacy inventory, capability matrix, dual-rail Option A.

---

## Stage B

| ID | Item | Status |
|----|------|--------|
| B0 | SwiftUI shell | **done** |
| B1 | SIWA + purpose strings + legal + delete/export | **done** |
| B2 | StoreKit digital IAP | **todo** (v1 can ship free-tier-only per ASC checklist) |
| B3 | Public catalog list/detail | **done** |
| B3+ | Auth my jobs + chat channels/messages | **done** |
| B4 | Hard-off regulated flags | **done** |
| B5 | Push | **deferred** |
| B6 | ASC packaging docs | **done** (docs); ops residual open |

---

## Build

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
cd ios && xcodebuild -scheme NoMarkup -project NoMarkup.xcodeproj \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

---

## Key docs

| Doc | Role |
|-----|------|
| `asc-packaging-checklist.md` | ASC pre-submit |
| `app-review-notes.md` | Review paste + native section |
| `submission-blockers.md` | One-pager |
| `ios-payment-rails-design.md` | Dual-rail + Option A |
| `ios/README.md` | How to build |

---

## Next (human-gated)

1. Apple Developer team + bundle id + SIWA App ID (`APPLE_NATIVE_CLIENT_ID`)  
2. Capture screenshots from Simulator  
3. Either implement **B2 StoreKit** or confirm **free-tier-only** digital (no paywall) for v1  
4. Staging always-on for App Review  
5. `/app-store-compliance` + device smoke (Stage C)
