# App Store Launch Board — NoMarkup

**Program:** `/app-store-launch-readiness`  
**Updated:** 2026-07-26  
**Current stage:** **Stage C partial** — B0–B4 + B3+/write (report + bid) + B6 docs + free-tier cut; residual: **B6 ops** (signing, screenshots, ASC) + **pay** (Stripe Rail A) + live review backend + **device smoke**  
**Binary readiness:** **NOT READY** for App Review (ASC assets, signing, payment not native, smoke not signed off)  
**v1 digital cut:** **free-tier-only** (StoreKit deferred) — [`v1-ios-product-cut.md`](./v1-ios-product-cut.md)

---

## Stage A — done

All review-logs phase-0…4b, privacy inventory, capability matrix, dual-rail Option A.

---

## Stage B

| ID | Item | Status |
|----|------|--------|
| B0 | SwiftUI shell | **done** |
| B1 | SIWA + purpose strings + legal + delete/export | **done** |
| B2 | StoreKit digital IAP | **deferred for v1** — free-tier-only cut locked in docs; implement when paid digital ships in-app |
| B3 | Public catalog list/detail | **done** |
| B3+ | Auth my jobs + chat channels/messages | **done** |
| B3++ | Listing report + job/listing place bid | **done** |
| B4 | Hard-off regulated flags | **done** |
| B5 | Push | **deferred** |
| B6 | ASC packaging docs | **done** (docs); ops residual open |

---

## Stage C — partially complete

| Item | Status |
|------|--------|
| Launch verification report | **done** — [`app-store-review-2026-07-26-launch.md`](./app-store-review-2026-07-26-launch.md) |
| v1 free-tier-only product cut | **done** — [`v1-ios-product-cut.md`](./v1-ios-product-cut.md) |
| Binary readiness label | **NOT READY** (honest) |
| Device smoke matrix | **checklist only** — not human-executed/signed |
| ASC free-tier notes pasted | **open** (ops) |
| Remaining submit blockers | See [`submission-blockers.md`](./submission-blockers.md) |

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
| `app-store-review-2026-07-26-launch.md` | Stage C verification |
| `v1-ios-product-cut.md` | Free-tier-only digital decision |
| `asc-packaging-checklist.md` | ASC pre-submit |
| `app-review-notes.md` | Review paste + native section |
| `submission-blockers.md` | One-pager |
| `ios-payment-rails-design.md` | Dual-rail + Option A |
| `ios/README.md` | How to build |

---

## Next (human-gated)

1. Apple Developer team + bundle id + SIWA App ID (`APPLE_NATIVE_CLIENT_ID`)  
2. Capture screenshots from Simulator; fill App Icon  
3. Paste free-tier-only Review Notes (cut is **documented** — confirm in ASC)  
4. Staging always-on for App Review  
5. Execute Stage C **device smoke matrix** and sign off  
6. Complete bid/pay write funnel (or narrow ASC claims to browse + account scope)
