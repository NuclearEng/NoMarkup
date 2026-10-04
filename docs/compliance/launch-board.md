# App Store Launch Board — NoMarkup

**Program:** `/app-store-launch-readiness`  
**Updated:** 2026-08-27  
**Current stage:** Dual-rail product **core shipped**; named FR-3.1 / web OTP / no-show residuals **closed in code**. Free-tier lock locked; B6 eng docs exist. **Remaining = founder / ASC portal + production go-live.** **Not App Store submit ready.** Production origin does **not** resolve; do **not** set `DEPLOY_PROVISIONED=true`.  
**Brand:** Terminal app icon master **37** · SSOT: `docs/brand/showcase-ssot.md`  
**Binary readiness for App Review submit:** **BLOCKED** — founder ops only (signing, ASC media, always-on backend, device smoke). Do **not** claim submit-ready. Do **not** re-open closed Swift/web FR bugs.  
**v1 digital cut:** **free-tier-only** (StoreKit deferred) — [`v1-ios-product-cut.md`](./v1-ios-product-cut.md)  
**Eng dual-rail scorecard:** [`eng-completion-scorecard-2026-08-02.md`](./eng-completion-scorecard-2026-08-02.md) → **core shipped**; named FR residuals **closed**  
**Consumer admin:** iOS Account → Admin console (`AdminConsoleView`) **exists**, role-gated.

---

## Score snapshot

| Bar | Score | Owner residual |
|-----|------:|----------------|
| Consumer dual-rail **engineering** | **Core shipped** (FR-3.1 / OTP / no-show **closed**) | Founder Decision-IDs (Checkr, StoreKit, secrets) — not Swift/web FR bugs |
| **Eng ASC packaging** (docs + binary eng gates 4.2 / 5.1.1 / free-tier / export / privacy) | **Docs packaged** | Portal fill + media still founder |
| **Overall App Store submit** | **Not ready** | Founder: Team, ASC, screenshots, PRE-05, Lightsail/DNS, device smoke |

---

## Stage A — done

All review-logs phase-0…4b, privacy inventory, capability matrix, dual-rail Option A.

---

## Stage B

| ID | Item | Eng | Founder |
|----|------|:---:|:-------:|
| B0 | SwiftUI TabView shell (not WKWebView) | **Done** | — |
| B1 | SIWA + purpose strings + legal + delete/export | **Done** | App ID + SIWA capability on portal |
| B2 | StoreKit digital IAP | **Deferred** free-tier lock | Do not create IAP products for v1 |
| B3 / B3+ | Catalog + auth jobs/chat + bids + Rail A pay UI | **Done** | Live `pk_` / Apple Pay merchant optional |
| B4 | Regulated rails **server-flag** gated + iOS hard-off keys | **Done** | Keep review flags **OFF** |
| B5 | Push client + privacy Device ID truth | **Done** (client) | APNs provider reliability / console test |
| B6 | ASC packaging **docs** + eng gates | **Done (docs)** | Portal fill + media upload |

---

## Eng columns (closed)

| Area | Status | Notes |
|------|--------|--------|
| Dual-rail services + goods product depth | **Core shipped** | Named FR-3.1 / web OTP / no-show **closed**; not App Store submit |
| Consumer admin desk | **Done** | Role-gated `AdminConsoleView` (Account) |
| Free-tier digital lock | **Done** | No StoreKit purchase UI |
| Guideline 4.2 native chrome | **Done** | `RootTabView` TabView; Safari only for legal/support |
| Account deletion + privacy links | **Done** | Account → Your data / Legal |
| Purpose strings + Face ID + no mic/ATT | **Done** | `Info.plist` |
| `ITSAppUsesNonExemptEncryption=false` | **Done** | Export exempt posture |
| Privacy manifests | **Done** | App + widget |
| B6 docs package | **Done** | blockers, checklist, review notes, content rating, screenshot matrix, TestFlight |
| Unit tests target | **Done** | `NoMarkupTests` |
| Screenshot walk harness | **Done** | `ScreenshotWalkUITests` — pixels still founder |

---

## Founder columns (open — still required for submit)

| # | Action | Doc |
|---|--------|-----|
| 1 | Apple Developer team + App ID `com.nomarkup.app` + SIWA + Push | packaging §10.1 |
| 2 | Set gateway `APPLE_NATIVE_CLIENT_ID=com.nomarkup.app` | SIWA native |
| 3 | Create ASC app record (SKU, categories, subtitle) | packaging §1 |
| 4 | Archive (Xcode 26+) + upload TestFlight | [`testflight-process.md`](./testflight-process.md) |
| 5 | Internal TestFlight group + install on device | testflight §5 |
| 6 | Paste App Review Notes; seed password in ASC **secure** field only | [`app-review-notes.md`](./app-review-notes.md) |
| 7 | Enter App Privacy nutrition labels (Device ID linked) | packaging §4 |
| 8 | Complete age rating + content rights | [`asc-content-rating-answers.md`](./asc-content-rating-answers.md) |
| 9 | Capture/upload **6.9" + 13"** screenshots | [`app-store-screenshot-matrix.md`](./app-store-screenshot-matrix.md) |
| 10 | Always-on review API + `make seed` | PRE-05 — production origin currently **does not resolve**; Lightsail + DNS A + `DEPLOY_PROVISIONED` stay founder (flag **must remain unset/false**) |
| 11 | Keep regulated server flags **OFF** for review | [`regulated-rails-live-flagged.md`](./regulated-rails-live-flagged.md) / blockers |
| 12 | Optional: Apple Pay merchant + domain association | [`apple-pay-domain.md`](./apple-pay-domain.md) |
| 13 | Human device smoke sign-off | [`device-smoke-checklist.md`](./device-smoke-checklist.md) |
| 14 | Submit for App Review when 1–13 done | ASC |

---

## Go-live (founder — not eng FR work)

Do **not** treat these as open Swift/web product bugs. Production is **not** live.

| Item | Status |
|------|--------|
| Lightsail instance + static IP | **Open** — capital-light origin |
| DNS A records (`no-markup.com` / `api.no-markup.com`) | **Open** — origin does not resolve |
| `DEPLOY_PROVISIONED` | **Must stay unset/false** until a real cluster + secrets exist |
| Live Stripe `sk_live` / `pk_live` | **Open** |
| OAuth consoles (Google / Facebook / Apple) | **Open** — code fail-closed without IDs |
| SendGrid / Sentry / Twilio | **Open** — vendor keys |
| Checkr live vendor | **SCAFFOLDED** fail-closed — Founder-Action |
| Apple Pay domain association | **PLACEHOLDER** file — do not invent bytes |
| Off-session charge env pair | Default **off** (`OFFSESSION-LEGAL`) — do not flip |
| ASC + TestFlight | **Open** — founder columns 1–14 above |

---

## Stage C

| Item | Eng | Founder |
|------|-----|---------|
| Launch verification report | done | — |
| v1 free-tier product cut | done | honor in ASC notes |
| B6 eng packaging | **docs done** | portal residual |
| Device smoke matrix | checklist ready | **pending human pass** |
| TestFlight process | docs done | **upload + group** |
| ASC free-tier notes pasted | paste-ready | **paste in ASC** |

---

## Build (eng / local)

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
cd ios && xcodebuild -scheme NoMarkup -project NoMarkup.xcodeproj \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

### Unit tests

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
cd ios && xcodebuild test -scheme NoMarkup -project NoMarkup.xcodeproj \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:NoMarkupTests
```

---

## Key docs

| Doc | Role |
|-----|------|
| `submission-blockers.md` | Founder-only remaining one-pager |
| `asc-packaging-checklist.md` | Eng `[x]` / founder `[~]` gates |
| `app-review-notes.md` | ASC paste block |
| `asc-content-rating-answers.md` | Age rating / content rights |
| `app-store-screenshot-matrix.md` | Scenes + UITest path |
| `testflight-process.md` | Founder archive/upload steps |
| `eng-completion-scorecard-2026-08-02.md` | Dual-rail core shipped; named FR residuals closed |
| `v1-ios-product-cut.md` | Free-tier lock |
| `privacy-purpose-string-inventory.md` | Purpose strings vs Info.plist |
| `device-smoke-checklist.md` | Human smoke matrix |
| `ios/README.md` | How to build |

---

## Next

**Founder only** — work the founder columns + go-live table above. Do **not** re-open FR-3.1 encode, web phone OTP, or contract/order no-show (those are **shipped**).  
**Eng:** ASC packaging docs exist; do **not** treat that as App Store submit-ready. Remaining submit/go-live is founder.

---

*Do not claim App Store “READY”, “submit ready”, or “production is live” without founder rows 1–13 and go-live. `DEPLOY_PROVISIONED` stays unset.*
