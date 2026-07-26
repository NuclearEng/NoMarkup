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

## App Icon

Single-size universal asset (Xcode 14+ single-size catalog):

| Path | Role |
|------|------|
| `NoMarkup/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | 1024×1024 RGB PNG (no alpha) — App Store + home-screen source |
| `NoMarkup/Assets.xcassets/AppIcon.appiconset/Contents.json` | References the 1024 universal iOS slot |

**Brand (placeholder ops mark):** dark navy `#070b14` background, gold `#c9a84c` “NM” monogram with ring. Opaque RGB only (App Store rejects transparency). Replace with final marketing art before ASC upload if design ships a refined mark.

Regenerate with Python + Pillow from the monorepo root:

```bash
python3 - <<'PY'
from PIL import Image, ImageDraw, ImageFont
import os
out = "ios/NoMarkup/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
size, bg, gold = 1024, (0x07, 0x0b, 0x14), (0xc9, 0xa8, 0x4c)
img = Image.new("RGB", (size, size), bg)
d = ImageDraw.Draw(img)
cx = cy = size // 2
for r, w, col in [(380, 28, (0xa8, 0x8a, 0x3a)), (320, 8, gold)]:
    for i in range(w):
        d.ellipse([cx - r + i, cy - r + i, cx + r - i, cy + r - i], outline=col)
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Avenir Next.ttc", 340)
bbox = d.textbbox((0, 0), "NM", font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text(((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1] - 20), "NM", font=font, fill=gold)
img.save(out, format="PNG", optimize=True)
print("wrote", out)
PY
```

## Device smoke

Executable Simulator checklist (cold launch → auth → catalog → legal → sign-out):

→ **[`docs/compliance/device-smoke-checklist.md`](../docs/compliance/device-smoke-checklist.md)**

Program board (Stage C residual, binary readiness):

→ **[`docs/compliance/launch-board.md`](../docs/compliance/launch-board.md)**

Quick path: gateway + seed → open `ios/NoMarkup.xcodeproj` → run **NoMarkup** on **iPhone 16** → walk the 12 smoke rows and mark Pass/Fail.

## Capabilities

| Capability | Status |
|------------|--------|
| **Sign in with Apple** | Entitlement `com.apple.developer.applesignin` in `NoMarkup/NoMarkup.entitlements`. In Xcode: target → **Signing & Capabilities** → **+ Capability** → Sign in with Apple. Requires App ID with SIWA enabled in the Developer portal. |
| **Apple Pay** | Entitlement `com.apple.developer.in-app-payments` → `merchant.com.nomarkup.app`. Enable Apple Pay capability + merchant ID in Developer portal; mirror in Stripe Dashboard. |
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

| Rail | Product | This client |
|------|---------|----------------|
| **A — Stripe + Apple Pay** | Jobs GMV, goods marketplace, escrow, Connect | **Wired:** buy-now + order pay → Stripe PaymentSheet (Apple Pay preferred, card fallback). SPM: `StripePaymentSheet`. |
| **B — StoreKit** | Digital subscriptions / feature unlocks | **Explicitly omitted** — free-tier digital only in v1 |

### Rail A setup (device)

1. Register Apple Pay merchant ID `merchant.com.nomarkup.app` (or override
   `ApplePayMerchantId` / `NOMARKUP_APPLE_PAY_MERCHANT_ID`) and enable the
   **Apple Pay** capability on the App ID.
2. Add the same merchant ID in **Stripe Dashboard → Settings → Payment methods → Apple Pay**.
3. Set publishable key via scheme env `NOMARKUP_STRIPE_PUBLISHABLE_KEY` or
   Info.plist `StripePublishableKey` (`pk_test_…` / `pk_live_…`).
4. Flow: listing detail **Buy now** → `POST …/buy-now` → PaymentSheet; or
   **Account → Orders → Pay with Apple Pay** for `pending_payment` rows.

First binary should keep regulated digital-adjacent flags off per `ios-payment-rails-design.md`.

## TODOs (not B0)

- [ ] Exchange SIWA `identityToken` with gateway OAuth / native token endpoint
- [ ] Align login/refresh JSON with real `services/user` + gateway routes
- [ ] Marketplace / jobs / messages list + detail from API + WebSocket
- [ ] CoreLocation market picker + job check-in with pre-prompts
- [ ] Photo picker / camera capture paths
- [ ] Account export (`GET /api/v1/me/export`) + real deletion schedule path
- [x] App icon 1024×1024 asset (placeholder brand mark in AppIcon catalog)
- [ ] Organization team signing + App Store Connect record
- [ ] Human-execute device smoke checklist and sign launch-board
- [ ] Stage B2 StoreKit only when digital unlocks ship

## License / monorepo

Part of the NoMarkup monorepo. Web app lives in `web/`; API gateway in `gateway/`.
