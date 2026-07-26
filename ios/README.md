# NoMarkup iOS (SwiftUI scaffold)

Native **iPhone + iPad** client shell for [NoMarkup](https://no-markup.com). This is **not** a WKWebView of the website (App Store Guideline **4.2**). Primary chrome is SwiftUI (`TabView`, native lists/forms). `SFSafariViewController` is used **only** for legal/support HTML.

| Status | Stage |
|--------|--------|
| Scaffold | **B0** — structure, auth UI, API client stub, account deletion entry |
| Out of scope | StoreKit / IAP (Stage **B2**), full marketplace API wiring, APNs push |

Payment dual-rail (Stripe for real-world GMV; StoreKit later for digital unlocks) is documented in [`docs/compliance/ios-payment-rails-design.md`](../docs/compliance/ios-payment-rails-design.md). **Do not stub StoreKit** in this tree.

Decision record: [`docs/compliance/native-approach-decision.md`](../docs/compliance/native-approach-decision.md).

## Requirements

- **Xcode 16+** (verified with Xcode 26.x / Swift 6.x)
- iOS **17.0** deployment target
- Apple Developer team (for device + real Sign in with Apple); Simulator builds work without a team for compile checks

If `xcodebuild` complains that only Command Line Tools are selected:

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
# or: sudo xcode-select -s /Applications/Xcode-26.5.0.app/Contents/Developer
```

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

## Capabilities

| Capability | Status |
|------------|--------|
| **Sign in with Apple** | Entitlement `com.apple.developer.applesignin` in `NoMarkup/NoMarkup.entitlements`. In Xcode: target → **Signing & Capabilities** → **+ Capability** → Sign in with Apple. Requires App ID with SIWA enabled in the Developer portal. |
| Push (APNs) | **Not** added (Stage B later) |
| In-App Purchase | **Not** added (Stage B2; dual-rail design only) |
| Associated Domains | Optional later for universal links / `nomarkup://` deep links |

URL scheme `nomarkup` is registered in `Info.plist` for future deep links.

## API base URL

Resolved in `Core/AppConfig.swift`:

1. Env `NOMARKUP_API_BASE_URL`
2. Info.plist `APIBaseURL` (defaults to `https://api.no-markup.com` in the committed plist)
3. **DEBUG** fallback: `http://localhost:8081` (matches local gateway / `.env.local`)
4. **Release** fallback: `https://api.no-markup.com`

ATS: `NSAllowsLocalNetworking` is enabled for local HTTP gateway debugging only.

Point the scheme at a running monorepo stack (`make` / docker-compose gateway on **8081** as used by this repo’s `.env.local`).

## App structure

```
ios/
  README.md
  NoMarkup.xcodeproj/
  NoMarkup/
    NoMarkupApp.swift
    Info.plist
    NoMarkup.entitlements
    Assets.xcassets/
    Core/          AppConfig, KeychainTokenStore, APIClient
    Auth/          AuthViewModel, LoginView, SignInWithAppleButton
    Features/      Tabs, legal Safari, account deletion
    Location/      Purpose-string / pre-prompt copy from inventory
```

### Tabs (native)

Home · Marketplace · Jobs · Messages · Account

### Auth

- Email/password form → `APIClient.login` (gateway path stub)
- **Sign in with Apple** button shell (`AuthenticationServices`) — identity token **not** exchanged with gateway yet
- **Browse native chrome (scaffold)** — local-only session for layout review without API

### Account / Guideline 5.1.1(v)

- Links: Privacy, Terms, Community Guidelines, Support (`https://no-markup.com/...`)
- **Delete Account** entry with confirm UX (`AccountDeletionView`)
- Export Data row present (disabled until export endpoint is wired)

### Privacy purpose strings

See `Info.plist` and `Location/LocationPurposeCopy.swift`. Inventory: `docs/compliance/privacy-purpose-string-inventory.md`.

**Not declared:** microphone, App Tracking Transparency.

## Relation to dual-rail payments

| Rail | Product | This scaffold |
|------|---------|----------------|
| **A — Stripe** | Jobs GMV, goods marketplace, escrow, Connect | Future Stripe iOS SDK / PaymentSheet — not wired |
| **B — StoreKit** | Digital subscriptions / feature unlocks | **Explicitly omitted** — no fake IAP products |

First binary should keep regulated digital-adjacent flags off per `ios-payment-rails-design.md`.

## TODOs (not B0)

- [ ] Exchange SIWA `identityToken` with gateway OAuth / native token endpoint
- [ ] Align login/refresh JSON with real `services/user` + gateway routes
- [ ] Marketplace / jobs / messages list + detail from API + WebSocket
- [ ] CoreLocation market picker + job check-in with pre-prompts
- [ ] Photo picker / camera capture paths
- [ ] Account export (`GET /api/v1/me/export`) + real deletion schedule path
- [ ] App icon 1024×1024 asset
- [ ] Organization team signing + App Store Connect record
- [ ] Stage B2 StoreKit only when digital unlocks ship

## License / monorepo

Part of the NoMarkup monorepo. Web app lives in `web/`; API gateway in `gateway/`.
