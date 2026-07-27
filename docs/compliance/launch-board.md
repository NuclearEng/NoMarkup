# App Store Launch Board — NoMarkup

**Program:** `/app-store-launch-readiness`  
**Updated:** 2026-07-27  
**Current stage:** **Stage C partial** — B0–B4 + B3+/write + **Rail A Apple Pay (code)** + B6 docs + free-tier cut; residual: **B6 ops** (signing, screenshots, ASC, merchant ID, domain association) + live review backend + **device smoke**  
**Brand:** Terminal app icon master **37** (amber **N** on pure black — `brand/ICON_DECISION.md`) + iOS dark shell `#07080b` / gold `#c9a84c` chrome + live marketplace seed (19 active listings). SSOT: `docs/brand/showcase-ssot.md`.  
**Binary readiness:** **NOT READY** for App Review (ASC assets, team signing, Apple Pay merchant + Stripe key on device, smoke not signed off)  
**v1 digital cut:** **free-tier-only** (StoreKit deferred) — [`v1-ios-product-cut.md`](./v1-ios-product-cut.md)  
**Brand assets:** App Icon terminal master shipped to iOS / web / `brand/`; **AccentColor / brand-gold** aligned to showcase (`#c9a84c`); residual: screenshot recapture if icon revises, any leftover system tints

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
| B3+++ | Rail A Apple Pay (PaymentSheet + buy-now / order pay) | **done** (code); device merchant ID + `pk_` + **domain association** still **ops** — see [`apple-pay-domain.md`](./apple-pay-domain.md) |
| B4 | Regulated rails server-flag gated (`iOSHardOffKeys` empty) | **done** — no client hard-offs; hub under Account → Business & finance; keep review/prod flags **off** until compliance (App Review risk if on). Authoritative map: `GET /api/v1/flags` + gateway `RequireFlag` |
| B5 | Push | **deferred** |
| B6 | ASC packaging docs | **done** (docs); ops residual open |

---

## Engineering closed (this residual pass)

| Item | Notes |
|------|--------|
| Hard-off honesty | Client hard-off set empty; smoke step 3 + B4 describe **server flags** |
| Instant match (web) | Job owner can **Request Instant match** on open jobs with accept-now price (`POST /api/v1/jobs/{id}/instant-match`) |
| FR-18 roll-forward tests | Generate on list, date-idempotent, skip when paused; **per-instance Stripe pay still residual** |
| Apple Pay domain docs | Placeholder called out; ops steps only — no fabricated merchant file |

---

## Stage C — partially complete

| Item | Status |
|------|--------|
| Launch verification report | **done** — [`app-store-review-2026-07-26-launch.md`](./app-store-review-2026-07-26-launch.md) |
| v1 free-tier-only product cut | **done** — [`v1-ios-product-cut.md`](./v1-ios-product-cut.md) |
| Binary readiness label | **NOT READY** (honest) |
| Device smoke matrix | **checklist only** — not human-executed/signed — [`device-smoke-checklist.md`](./device-smoke-checklist.md) |
| ASC free-tier notes pasted | **open** (**ops**) |
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
| `ios-payment-rails-design.md` | Dual-rail + Option A + Apple Pay native path |
| `apple-pay-domain.md` | Domain association placeholder + ops steps |
| `ios/README.md` | How to build · App Icon · Apple Pay setup · device smoke |
| `device-smoke-checklist.md` | Simulator/device Pass/Fail matrix (step 3 = server flags) |
| `prd-ios-parity-backlog.md` | Closed eng vs ops-gated residual |

---

## Next (**human / ops only**)

1. Apple Developer team + bundle id + SIWA App ID (`APPLE_NATIVE_CLIENT_ID`)  
2. Apple Pay merchant ID `merchant.com.nomarkup.app` + Stripe Dashboard Apple Pay + real domain association file (replace placeholder) + `NOMARKUP_STRIPE_PUBLISHABLE_KEY`  
3. Capture screenshots from Simulator; App Icon is terminal master 37 (amber N on black) — re-capture if master revises; finish design-system token pass if any residual system tints remain  
4. Paste free-tier-only Review Notes (cut is **documented** — confirm in ASC)  
5. Staging **always-on** for App Review  
6. Execute Stage C **device smoke matrix** (incl. step 3 server flags + Buy now / Orders pay) and sign off  

Engineering is **not** blocking those rows with open code tasks for the residual close above.
