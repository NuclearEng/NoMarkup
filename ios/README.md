# NoMarkup iOS (SwiftUI)

Native **iPhone + iPad** client for [NoMarkup](https://no-markup.com). This is **not** a WKWebView of the website (App Store Guideline **4.2**). Primary chrome is SwiftUI (`TabView`, native lists/forms). `SFSafariViewController` is used **only** for legal/support HTML.

Payment dual-rail (Stripe for real-world GMV; StoreKit for digital unlocks) is documented in [`docs/compliance/ios-payment-rails-design.md`](../docs/compliance/ios-payment-rails-design.md). StoreKit 2 scaffold lives behind `AppConfig.storeKitEnabled` (**default false**) — see [`docs/compliance/storekit-scaffold.md`](../docs/compliance/storekit-scaffold.md).

Decision record: [`docs/compliance/native-approach-decision.md`](../docs/compliance/native-approach-decision.md).

## Requirements

| Item | Minimum |
|------|---------|
| **Xcode for ASC / TestFlight upload** | **Xcode 26.0+** (iOS 26 SDK floor) |
| **Pinned dogfood toolchain** | Xcode **26.5.x** |
| Deployment target | **iOS 17.0** |
| Devices | iPhone + iPad (universal) |
| Apple Developer team | Required for device + real SIWA / push / Apple Pay |

If `xcodebuild` complains that only Command Line Tools are selected:

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
# or: sudo xcode-select -s /Applications/Xcode-26.5.0.app/Contents/Developer
xcodebuild -version   # must report 26.x for archive/upload
```

**Do not** submit archives built with Xcode 16 / iOS 18 SDK — App Store Connect rejects below the current SDK floor. See [`docs/compliance/testflight-process.md`](../docs/compliance/testflight-process.md).

## Open in Xcode

```bash
open ios/NoMarkup.xcodeproj
```

Or from the monorepo root: `open NoMarkup.xcodeproj` after `cd ios`.

## Build (CLI)

```bash
cd ios
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-26.5.0.app/Contents/Developer}"

xcodebuild \
  -scheme NoMarkup \
  -project NoMarkup.xcodeproj \
  -destination 'generic/platform=iOS Simulator' \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Simulator run (example):

```bash
xcodebuild \
  -scheme NoMarkup \
  -project NoMarkup.xcodeproj \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -configuration Debug \
  build
```

Then run from Xcode (**⌘R**) on any iPhone or iPad simulator.

## Unit tests (`NoMarkupTests`)

Hosted unit-test bundle (no physical device). Covers money formatting, API base HTTPS resolution, notification deep links, image MIME/downsample helpers, date/status helpers.

```bash
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-26.5.0.app/Contents/Developer}"
cd ios
xcodebuild test \
  -scheme NoMarkup \
  -project NoMarkup.xcodeproj \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -only-testing:NoMarkupTests
```

UI tests live in `NoMarkupUITests/` (optional; seed credentials for full login path).

## App Icon & brand

Single-size universal asset (Xcode 14+ single-size catalog):

| Path | Role |
|------|------|
| `NoMarkup/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | 1024×1024 RGB PNG (no alpha) — App Store + home-screen source |
| `NoMarkup/Assets.xcassets/AppIcon.appiconset/Contents.json` | References the 1024 universal iOS slot |
| `NoMarkup/Assets.xcassets/AccentColor.colorset` | Brand gold accent (CTAs / tint) |
| `brand/app-icon-1024.png` | Canonical master art (monorepo root) |

**App icon (current):** terminal amber-gold **N** (+ reverse-auction chevron lineage) on **pure black `#000000`** — master **37** (`brand/ICON_DECISION.md`). Opaque RGB only (App Store rejects transparency).

**In-product chrome** uses showcase shell `#07080b` (`BrandTheme.navy`). See `docs/brand/showcase-ssot.md`.

**Brand SSOT:** `qa/showcase/index.html` + `docs/brand/showcase-ssot.md`. Tagline: **The Market Sets The Price. Not The Markup.**

| Token | Hex | iOS use |
|-------|-----|---------|
| Brand gold (`--gold`) | `#c9a84c` | `AccentColor` / `BrandTheme.gold` / `BrandTheme.accent` |
| Gold bright (`--gold-bright`) | `#e4c566` | `BrandTheme.goldBright` |
| Navy shell (`--bg-primary`) | `#07080b` | `BrandTheme.navy` |
| Card surface (`--bg-card`) | `#14161e` | `BrandTheme.navyElevated` |
| Text primary / secondary | `#e8ecf1` / `#8b949e` | `BrandTheme.textPrimary` / `.textSecondary` |

**Do not use legacy** `#070b14`, `#d4af57`, or ad-hoc `Color(red:…)` outside `BrandTheme`.

## Device smoke (human-gated)

Executable matrix (SE 3rd gen, Pro Max class, **13" iPad**, **AX5** text, **iOS 17** floor):

→ **[`docs/compliance/device-smoke-checklist.md`](../docs/compliance/device-smoke-checklist.md)**

Program board:

→ **[`docs/compliance/launch-board.md`](../docs/compliance/launch-board.md)**

**Pending human device pass** — do not claim “device verified” from sim-only Pro Max runs.

## Instruments culture (IOS-PERF.1)

Pre-ship **Time Profiler** + **Allocations** on Release (optional SwiftUI/Hangs). Budgets, capture steps, and sign-off table:

→ **[`docs/compliance/ios-instruments-culture.md`](../docs/compliance/ios-instruments-culture.md)**

## Localization (IOS-L10N.3)

v1 ships **English** as the source language with a **partial Spanish (`es`) scaffold** (tab labels + a few empty-state chrome strings in `NoMarkup/Localizable.xcstrings`). `knownRegions` includes `en`, `Base`, and `es`. Full Spanish UI is progressive — do not claim complete ES coverage.

## Capabilities

| Capability | Status |
|------------|--------|
| **Sign in with Apple** | Entitlement `com.apple.developer.applesignin` |
| **Apple Pay** | Entitlement `com.apple.developer.in-app-payments` → `merchant.com.nomarkup.app` |
| **Push (APNs)** | Client registration present (`PushRegistration`); declare **Device ID** in privacy labels (linked, not tracking). Production `aps-environment` comes from archive export. |
| In-App Purchase | **Not** added (Stage B2; free-tier digital for v1) |
| Associated Domains | Optional later for universal links / passkeys |
| Privacy manifest | `NoMarkup/PrivacyInfo.xcprivacy` |

URL scheme `nomarkup` is registered in `Info.plist` for deep links.

## API base URL

Resolved in `Core/AppConfig.swift` (pure helper `resolveAPIBaseURL` unit-tested):

1. Env `NOMARKUP_API_BASE_URL` (Debug may allow cleartext; **Release rejects non-https**)
2. **DEBUG + Simulator:** `http://127.0.0.1:8081`
3. Info.plist `APIBaseURL` when non-empty (Release: https only)
4. Production: `https://api.no-markup.com`

Committed plist `APIBaseURL` should stay **empty** for Release archives so production HTTPS applies. Prefer HTTPS staging/tunnels for physical-device dogfood.

## App structure

```
ios/
  README.md
  NoMarkup.xcodeproj/
  NoMarkup/
    NoMarkupApp.swift
    Info.plist
    PrivacyInfo.xcprivacy
    NoMarkup.entitlements
    Assets.xcassets/
    Core/          AppConfig, APIClient, ImageUploader, PushRegistration, …
    Auth/          Login, SIWA, Google, Passkeys
    Features/      Tabs + product surfaces
    Intents/       App Intents / Shortcuts
    Location/      Purpose-string copy
  NoMarkupTests/   Unit tests (host app)
  NoMarkupUITests/ XCUITest smoke
```

### Tabs (native)

Home · Marketplace · Jobs · Messages · Account

### Privacy purpose strings

See `Info.plist` and `Location/LocationPurposeCopy.swift`. Inventory: `docs/compliance/privacy-purpose-string-inventory.md`.

**Not declared:** microphone, App Tracking Transparency.

## Relation to dual-rail payments

| Rail | Product | This client |
|------|---------|----------------|
| **A — Stripe + Apple Pay** | Jobs GMV, goods marketplace, escrow, Connect | **Wired:** buy-now + order pay → Stripe PaymentSheet |
| **B — StoreKit** | Digital subscriptions / feature unlocks | **Scaffold, default OFF** — free-tier digital only until ASC products + flag |

### Rail A setup (device)

1. Register Apple Pay merchant ID `merchant.com.nomarkup.app` and enable **Apple Pay** on the App ID.
2. Add the same merchant ID in **Stripe Dashboard → Apple Pay**.
3. Set `NOMARKUP_STRIPE_PUBLISHABLE_KEY` or Info.plist `StripePublishableKey`.
4. Flow: listing **Buy now** or **Account → Orders → Pay with Apple Pay**.

## Google Sign-In (FR-1.1)

Native path (no Google SDK): `ASWebAuthenticationSession` + PKCE → `POST /api/v1/auth/google/native`.

Configure: Google Cloud iOS client for `com.nomarkup.app`, gateway `GOOGLE_IOS_CLIENT_ID`, Info.plist / env `GoogleIosClientID`, reverse-client-id URL scheme.

## Distribution docs

| Doc | Role |
|-----|------|
| [`docs/compliance/asc-packaging-checklist.md`](../docs/compliance/asc-packaging-checklist.md) | ASC packaging |
| [`docs/compliance/testflight-process.md`](../docs/compliance/testflight-process.md) | TestFlight process |
| [`docs/compliance/app-store-screenshot-matrix.md`](../docs/compliance/app-store-screenshot-matrix.md) | 6.9" / 13" shots |
| [`docs/compliance/accessibility-nutrition-claims.md`](../docs/compliance/accessibility-nutrition-claims.md) | ASC a11y claims |
| [`docs/compliance/ios-developer-audit-remediation-2026-07-27.md`](../docs/compliance/ios-developer-audit-remediation-2026-07-27.md) | Audit remediation map |

## License / monorepo

Part of the NoMarkup monorepo. Web app lives in `web/`; API gateway in `gateway/`.
