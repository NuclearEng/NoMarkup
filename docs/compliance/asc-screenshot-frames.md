# App Store screenshot frames (official Apple bezels)

**Audit ID:** IOS-DES.14  
**Updated:** 2026-08-22  
**Related:** [`app-store-screenshot-matrix.md`](./app-store-screenshot-matrix.md) · [`testflight-process.md`](./testflight-process.md)

ASC marketing frames **must** use Apple’s official product bezels from [Apple Design Resources](https://developer.apple.com/design/resources/). Do **not** use unofficial mockup generators, third-party bezel packs, or invented screenshot PNGs.

**Pixel status:** no production ASC screenshot set is committed under `ios/` or `docs/`. Capture is founder/ops. This file is the resource + harness map only.

---

## Official resource URLs

| Resource | URL | Use |
|----------|-----|-----|
| **Design Resources hub** | https://developer.apple.com/design/resources/ | Product bezels, App Icon Template, Icon Composer |
| **iPhone 17 bezels** (6.9″ Pro Max class) | https://devimages-cdn.apple.com/design/resources/download/Bezel-iPhone-17.dmg | Required iPhone marketing frames |
| **iPhone 16 bezels** (6.9″ 16 Pro Max class) | https://devimages-cdn.apple.com/design/resources/download/Bezel-iPhone-16.dmg | Alternate / prior 6.9″ slot |
| **iPad Pro (M5) bezels** (13″) | https://devimages-cdn.apple.com/design/resources/download/Bezel-iPad-Pro-(M5).dmg | Required iPad marketing frames |
| **Marketing / identity (product images)** | https://developer.apple.com/app-store/marketing/guidelines/#section-products | How bezels may be used in marketing |
| **ASC screenshot specifications** | https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/ | Pixel sizes per display class |
| **Icon Composer** | https://developer.apple.com/icon-composer/ | Layered Liquid Glass icons (optional; shipping icon is a flattened 1024 PNG) |

Download the **iPhone 6.9″** pack that matches the capture simulator (16 Pro Max or 17 Pro Max) and the **13″ iPad Pro (M5)** pack. Photoshop + PNG are in each DMG.

---

## Capture harness (eng)

Raw **unframed** simulator shots come from UI tests — not from this repo as marketing assets.

| Item | Path |
|------|------|
| **UITest class** | [`ios/NoMarkupUITests/ScreenshotWalkUITests.swift`](../../ios/NoMarkupUITests/ScreenshotWalkUITests.swift) |
| **Scene matrix** | [`app-store-screenshot-matrix.md`](./app-store-screenshot-matrix.md) |

`ScreenshotWalkUITests` walks Home / Marketplace / listing / Jobs / job detail / Messages / Account / provider surfaces and attaches `XCTAttachment` screenshots named `NN-surface-state`. Extract from the `.xcresult` (Xcode Test Report). Repeat on a **6.9″ iPhone** simulator and a **13″ iPad** simulator.

Founder composites those raw shots into the official Apple bezels above. **Do not** commit generated framed PNGs unless ops explicitly archives a set.

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
cd ios
xcodebuild test \
  -scheme NoMarkup \
  -project NoMarkup.xcodeproj \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro Max' \
  -only-testing:NoMarkupUITests/ScreenshotWalkUITests
```

---

## App icon templates already in `brand/`

Apple’s **App Icon Template** (Design Resources / Icon Composer) is the official production template. This repo already holds **flattened 1024 masters and candidates** (not Apple’s layered template, and not ASC screenshots):

| Asset | Path |
|-------|------|
| Decision log | [`brand/ICON_DECISION.md`](../../brand/ICON_DECISION.md) |
| Appearances (dark / tinted — not invented) | [`brand/APP_ICON_APPEARANCES.md`](../../brand/APP_ICON_APPEARANCES.md) |
| Shipping-adjacent masters | `brand/app-icon-1024.png`, `brand/app-icon-champagne-m.png` |
| Candidates / archive | `brand/app-icon-*.png`, `brand/candidate-*.png`, `brand/icon-diamond-candidate-*.png` |
| iOS App Store slot | `ios/NoMarkup/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` |

Do **not** generate fake dark/tinted icon variants or fake screenshot PNGs. See `APP_ICON_APPEARANCES.md`.

---

*DES.14 eng: official bezel URLs + harness documented. ASC pixels remain founder residual.*
