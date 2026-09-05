# Device smoke checklist — NoMarkup iOS

**Program:** Stage C residual (B6 **ops** — human-gated; not an open engineering task)  
**Updated:** 2026-07-27 (matrix expanded: SE, iPad 13", iOS 17 floor, AX5)  
**Related:** [`launch-board.md`](./launch-board.md) · [`app-store-review-2026-07-26-launch.md`](./app-store-review-2026-07-26-launch.md) · [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) · [`apple-pay-domain.md`](./apple-pay-domain.md) · [`ios/README.md`](../../ios/README.md) · [`testflight-process.md`](./testflight-process.md) · [`ios-instruments-culture.md`](./ios-instruments-culture.md)

Manual **Simulator and/or device** pass against a reachable gateway + seed.  
Check **Pass** only after a human executes the step. Leave **Fail** notes specific enough to file a fix.

**Honesty rule:** This checklist is **executable**. Prior runs may exist for Pro-Max-class devices; **SE, 13" iPad, iOS 17 floor, and AX5 are not automatically signed**. Do not mark Overall PASS until the required matrix rows below are human-executed.

### Engineering already closed (do not re-file as eng residual)

| Item | Status |
|------|--------|
| Client hard-offs | `FeatureFlags.iOSHardOffKeys = []` — rails are **server-flag** gated |
| B4 hub | Account → Business & finance reflects `GET /api/v1/flags` |
| Rail A code path | PaymentSheet buy-now / order pay (needs ops `pk_` + merchant + domain) |
| Unit tests | `NoMarkupTests` target — run without device (see README) |
| Web Instant re-request | JobDetail owner CTA (not part of this iOS matrix) |

---

## Device / OS matrix (required coverage)

Run the smoke scenarios on **each** row before claiming “device verified.” One engineer may split rows across people; every row needs a sign-off line in § Sign-off.

| Row ID | Destination | OS | Type size | Required? | Pass | Fail | Tester / date |
|--------|-------------|-----|-----------|:---------:|:----:|:----:|---------------|
| **M-SE** | **iPhone SE (3rd gen)** physical or sim | latest shipping | Default | **Yes** | [ ] | [ ] | |
| **M-PM** | Pro Max class (15/16/17) | latest shipping | Default | **Yes** | [ ] | [ ] | |
| **M-IPAD** | **13" iPad** (Pro if available) portrait + landscape | latest shipping | Default | **Yes** (universal binary) | [ ] | [ ] | |
| **M-AX5** | iPhone SE **or** small phone | latest | **Accessibility → largest text (AX5)** | **Yes** (DES.20 / A11Y.2) | [ ] | [ ] | |
| **M-17** | Any iPhone sim | **iOS 17.0** (deployment floor) | Default | **Yes** once per release train | [ ] | [ ] | |
| M-SIM | iPhone 16/17 sim (fast path) | Xcode 26 sim runtime | Default | Optional dogfood | [ ] | [ ] | |

**iPad note:** Layout may still be stretched iPhone (DES.12). Fail only on **broken** UI (unusable controls, hard clips of primary CTAs, crashes) — file adaptivity as separate eng if merely suboptimal.

---

## Preflight

| # | Step | Pass | Fail | Notes |
|---|------|:----:|:----:|-------|
| P1 | Gateway up (local Docker/`make` or staging). DEBUG sim default: `http://127.0.0.1:8081` (see `AppConfig`) | [ ] | [ ] | |
| P2 | DB seed applied (`customer@` / `provider@` + `SEED_PASSWORD` if auth paths used) | [ ] | [ ] | |
| P3 | Open project: `open ios/NoMarkup.xcodeproj` with **Xcode 26.x** | [ ] | [ ] | |
| P4 | Run **NoMarkup** scheme on the matrix destination (⌘R) | [ ] | [ ] | |
| P5 | (Optional) Unit tests: `xcodebuild test -only-testing:NoMarkupTests` | [ ] | [ ] | No device needed |

### Build (optional CLI sanity)

```bash
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-26.5.0.app/Contents/Developer}"
cd ios
xcodebuild \
  -scheme NoMarkup \
  -project NoMarkup.xcodeproj \
  -destination 'platform=iOS Simulator,name=iPhone SE (3rd generation)' \
  -configuration Debug \
  build
```

Also exercise: `name=iPad Pro 13-inch` (exact sim name varies by Xcode), and an **iOS 17.0** runtime if installed.

---

## Smoke matrix (functional)

| # | Scenario | Expected | Pass | Fail | Notes |
|---|----------|----------|:----:|:----:|-------|
| 1 | **Cold launch** → Login or scaffold | App shows native `LoginView` (email/password + SIWA + browse chrome). **Not** a WKWebView of the website. | [ ] | [ ] | Guideline **4.2** |
| 2 | **Health check on Home** | Enter main tabs (sign in **or** scaffold). **Home** → Gateway section → **Refresh status**. Green check when API reachable; red + error copy when not. | [ ] | [ ] | |
| 3 | **Launch gates / regulated server flags** | Rails follow **server** `GET /api/v1/flags`. **Account → Business & finance**: flags **off** → CTAs disabled; **on** → surface opens. Review/prod dogfood: regulated keys **false** unless intentional. | [ ] | [ ] | |
| 4 | **Marketplace** loads list | List / empty / clear error; pull-to-refresh. | [ ] | [ ] | |
| 5 | **Listing detail → Report sheet → cancel** | Detail renders; Report cancels without submit. | [ ] | [ ] | |
| 6 | **Jobs browse + mine (auth)** | Browse public; Mine needs auth. | [ ] | [ ] | |
| 7 | **Messages channels (auth)** | List or empty; scaffold prompts sign-in. | [ ] | [ ] | |
| 8 | **Place bid UI** | Form validates; API may fail without provider role — no crash. | [ ] | [ ] | |
| 8b | **Buy now → Apple Pay sheet** | Needs `pk_` + merchant; cancel OK. | [ ] | [ ] | Rail A |
| 8c | **Orders → Pay with Apple Pay** | `pending_payment` → PaymentSheet. | [ ] | [ ] | |
| 9 | **Account legal links** | Privacy / Terms / Support open in-app Safari to `no-markup.com`. | [ ] | [ ] | |
| 10 | **Export / Delete account UI** | Auth only; **do not** delete shared seed. | [ ] | [ ] | |
| 11 | **Sign out** | Returns to login; token cleared. | [ ] | [ ] | |
| 12 | **Sign in with Apple visible** | Button tappable; full flow may fail without team config — document. | [ ] | [ ] | |

---

## Accessibility rows (A11Y / DES.20)

| # | Scenario | Expected | Pass | Fail | Notes |
|---|----------|----------|:----:|:----:|-------|
| **AX-VO** | VoiceOver on Login, Home, Marketplace list, Job detail, Listing detail, Account | Focus order sensible; labels present; money/controls announced | [ ] | [ ] | Required before ASC **VoiceOver** claim |
| **AX5** | Largest Accessibility text size on SE (or small phone) | Primary CTAs reachable; **money labels reflow or scale** (no hard unreadable clip of leading bid / buy-now) | [ ] | [ ] | Required before **Larger Text** claim — expect fails until A11Y.2 complete |
| **AX-RM** | Reduce Motion on | No jarring loops; app usable | [ ] | [ ] | Optional until A11Y.3 |

---

## Instruments (IOS-PERF.1)

Full culture doc: **[`ios-instruments-culture.md`](./ios-instruments-culture.md)** (Release scheme, Time Profiler + Allocations).

| # | Scenario | Expected | Pass | Fail | Notes |
|---|----------|----------|:----:|:----:|-------|
| **I1** | **Time Profiler** — cold launch | First interactive chrome **&lt; 2 s**; no multi-second main-thread stall | [ ] | [ ] | Profile **Release** |
| **I2** | **Time Profiler** — Marketplace + Jobs scroll | Sustained **~60 fps**; no multi-frame freezes on seed data | [ ] | [ ] | |
| **I3** | **Allocations** — browse + open/close detail | Memory **steady** after warm-up (no unbounded climb over 2–3 min) | [ ] | [ ] | Optional: SwiftUI/Hangs |

---

## Sign-off template (copy per matrix row or aggregate)

| Field | Value |
|-------|--------|
| Tester | |
| Date | |
| Build / version | `CFBundleShortVersionString` (`CFBundleVersion`) |
| Matrix rows completed | e.g. M-SE, M-PM, M-IPAD, M-AX5, M-17 |
| Simulator / device detail | e.g. iPhone SE (3rd gen) / iOS 26.x |
| API base | |
| Overall | [ ] **PASS** · [ ] **FAIL** (block submit) · [ ] **PASS with notes** |
| Device verified claim allowed? | **Only if** M-SE + M-PM + M-IPAD + M-AX5 are Pass or accepted Fail-with-ticket — never claim “device verified” from sim-only Pro Max |

### Failures to file

| Step # / Row | Severity | Summary | Owner |
|--------------|----------|---------|-------|
| | | | |

---

## Launch board link

→ **[`docs/compliance/launch-board.md`](./launch-board.md)**

When this checklist is human-executed and signed, update launch-board **Device smoke matrix** from “checklist only / pending human device pass” to signed-off (or list residual fails under Next).

---

## Regulated flag keys (reference)

`FeatureFlags.iOSHardOffKeys = []` — no permanent client hard-offs. Effective enablement = server map (default **false** if unknown).

| Key | Product surface (server-gated UI) |
|-----|-------------------------------------|
| `customer_bnpl` | Customer BNPL / installment plans |
| `working_capital` | Working-capital advances |
| `per_job_insurance` | Per-job insurance purchase |
| `insurance_competition` | Insurance competition |
| `legal_services` | Legal services marketplace |
| `lead_gen` | Lead-gen fee surfaces |
| `instant_payout` | Instant payout CTA |

Source: `ios/NoMarkup/Core/FeatureFlags.swift` · hub: `BusinessFeaturesHubView` · policy: [`ios-web-feature-matrix.md`](./ios-web-feature-matrix.md) · cut: [`v1-ios-product-cut.md`](./v1-ios-product-cut.md).
