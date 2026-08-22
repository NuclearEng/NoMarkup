# App Store screenshot matrix (iOS)

**Audit IDs:** IOS-DES.14 · IOS-DIST.5  
**Updated:** 2026-08-22  
**Related:** [`asc-packaging-checklist.md`](./asc-packaging-checklist.md) §6 · [`testflight-process.md`](./testflight-process.md) · [`asc-screenshot-frames.md`](./asc-screenshot-frames.md)

---

## Required display sizes

| Priority | Display class | Example simulators | Notes |
|----------|---------------|--------------------|--------|
| **Required** | **6.9" iPhone** | iPhone 16 Pro Max / 17 Pro Max class | Primary modern ASC iPhone set |
| **Required** (universal) | **13" iPad** | 13" iPad Pro | `TARGETED_DEVICE_FAMILY = 1,2` |
| Optional / if ASC prompts | 6.5" / 6.7" iPhone | 15/16 Plus / Pro Max class | Legacy slots |
| Optional | 12.9" iPad | Older iPad Pro | Only if ASC still lists |

Portrait by default. Prefer **native SwiftUI** chrome (Guideline **4.2** — not Safari shots of the marketing site).

**Bezels (required):** composite capture into **Apple official product bezels** from [Apple Design Resources](https://developer.apple.com/design/resources/) — **iPhone 6.9″** (`Bezel-iPhone-17.dmg` / `Bezel-iPhone-16.dmg`) and **iPad 13″** (`Bezel-iPad-Pro-(M5).dmg`). URLs, marketing-guidelines link, and harness: [`asc-screenshot-frames.md`](./asc-screenshot-frames.md). Do **not** use unofficial mockups. Do **not** invent or commit fake screenshot PNGs.

**Pixel status:** Media boxes open — **no** production screenshot set committed under `ios/` for ASC upload. Capture is **founder/ops**. Eng provides surfaces + harness + official-bezel URLs.

**App icon:** flattened 1024 masters already live in [`brand/`](../../brand/) (`app-icon-1024.png`, `app-icon-champagne-m.png`, candidates). Apple’s App Icon Template / Icon Composer is on the same Design Resources hub — see frames doc.

---

## ASC required scenes — exist in app?

| # | ASC scene | In app? | Surface / path | Capture notes |
|---|-----------|:-------:|----------------|---------------|
| 1 | **Home** | **Yes** | Tab **Home** → `HomeView` | Market context / value prop; no regulated rails as pitch |
| 2 | **Marketplace** | **Yes** | Tab **Marketplace** → `MarketplaceView` | Local pickup goods browse |
| 3 | **Job detail** | **Yes** | Tab **Jobs** → row → `JobDetailView` | Budget/category; location coarsened as product allows |
| 4 | **Login + SIWA** | **Yes** | Signed-out `LoginView` + system SIWA button | Email/password **and** Sign in with Apple (equal prominence) |
| 5 | **Account / legal** | **Yes** | Tab **Account** → Legal & support + Your data | Privacy, Terms, Support; **Delete Account**; free-tier / no StoreKit OK |
| 6 | **Catalog beat** | **Yes** | Jobs list **or** Marketplace scroll | Proves non-thin shell |

### Strong optional ASC frames (exist — use if slots remain)

| Scene | In app? | Path |
|-------|:-------:|------|
| Listing detail | **Yes** | Marketplace → detail |
| Messages list / thread | **Yes** | Tab Messages |
| Place-bid UI | **Yes** | Listing or job detail (provider for jobs) |
| Plan limits (free-tier honesty) | **Yes** | Account → Plan limits |
| Provider workspace | **Yes** | Account → Provider workspace (provider seed) |

### Hard avoid in every frame

BNPL, working capital, insurance purchase, legal services, lead-gen, instant payout, fake StoreKit prices, competitor keyword spam overlays.

---

## Automated capture harness

| Item | Path / command |
|------|----------------|
| **UITest class** | [`ios/NoMarkupUITests/ScreenshotWalkUITests.swift`](../../ios/NoMarkupUITests/ScreenshotWalkUITests.swift) |
| **What it does** | Ordered walk across Home / Marketplace / listing / Jobs / job detail / Messages / Account rows / provider surfaces; attaches `XCTAttachment` screenshots named `NN-surface-state` |
| **Credentials** | Env: `NOMARKUP_UI_TEST_EMAIL`, `NOMARKUP_UI_TEST_PASSWORD` (and provider variants). Defaults to seed emails; password from env — **do not commit real passwords** |
| **Requires** | Live gateway + seed data reachable from Simulator/device |

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
# Optional: point at staging; password from vault / SEED_PASSWORD — not git
export NOMARKUP_UI_TEST_EMAIL=customer@nomarkup.com
export NOMARKUP_UI_TEST_PASSWORD='…from seed log…'

cd ios
xcodebuild test \
  -scheme NoMarkup \
  -project NoMarkup.xcodeproj \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro Max' \
  -only-testing:NoMarkupUITests/ScreenshotWalkUITests
```

Extract attachments from the test result bundle (Xcode Test Report → screenshots) or Result Bundle path after the run. Repeat with a **13" iPad** destination for the iPad set.

**Manual alternative:**

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
open ios/NoMarkup.xcodeproj
# Run on 6.9" iPhone simulator + 13" iPad simulator
# Device → Screenshot / Simulator File → Save Screen
```

---

## Capture procedure checklist (founder)

| Step | Done? |
|------|:-----:|
| Gateway + seed for realistic catalog | [ ] |
| Download official 6.9″ iPhone + 13″ iPad bezels ([frames](./asc-screenshot-frames.md)) | [ ] |
| 6.9" iPhone set (ASC scenes 1–6), composited in Apple bezels | [ ] |
| 13" iPad set (same scenes), composited in Apple bezels | [ ] |
| App Icon 1024 present (`AppIcon-1024.png`) | [x] champagne M↓ in `brand/` + asset catalog |
| Uploaded to ASC Media Manager | [ ] |

---

## App preview video

Optional for v1. Same dual-rail honesty rules (no regulated rails, no fake IAP).

---

*DES.14: official Apple bezels required ([`asc-screenshot-frames.md`](./asc-screenshot-frames.md)); harness is `ScreenshotWalkUITests`. ASC pixels remain founder residual — no fake PNGs in tree.*
