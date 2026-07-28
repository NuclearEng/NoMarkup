# iOS Developer Documentation Audit

- **Target**: `ios/NoMarkup` (repo `/Users/nuclearisotope/Projects/Personal/NoMarkup`, project `ios/NoMarkup.xcodeproj`)
- **Date**: 2026-07-27
- **Hub snapshot**: 2026-07-26 — https://developer.apple.com/ios/ (registry fresh; 1 day old, no drift check needed)
- **Platform / stack**: Native iOS, SwiftUI-primary (71 imports) + supporting UIKit (15), Swift 6.0, strict concurrency complete, iOS 17.0 deployment floor, iPhone+iPad (`TARGETED_DEVICE_FAMILY = "1,2"`), sole SPM dependency `stripe-ios 24.25.0`
- **Target SDK bar**: Submit floor Xcode 26 / iOS 26 SDK (as of 2026-04-28); hub features iOS 27
- **Platform readiness**: **NOT READY**
- **Related**: App Store policy audit is separate → `/app-store-compliance` (already run 3×, see `docs/compliance/app-store-review-2026-07-26*.md`)

## Goal (audit)

Map the native iOS app against Apple's published iOS developer hub guidance (design, privacy/security, system experiences, intelligence, quality, games/media, distribution) so the team knows exactly what blocks a quality submission, what to modernize, and what is intentionally deferred — every FAIL/GAP citing a registry `IOS-*` ID with file-level evidence.

## Applicability profile

| Flag | Value | Evidence |
|---|---|---|
| native_ios / swiftui | true | `ios/NoMarkup.xcodeproj`; 71× `import SwiftUI`; `@main` in `ios/NoMarkup/NoMarkupApp.swift` |
| uikit | true (supporting) | 15× `import UIKit` — representables/pickers only |
| cross_platform / web_only | false | No RN/Flutter/Expo/Capacitor configs; native target exists (`web/` is a separate surface) |
| custom_chrome | true | `Core/BrandTheme.swift`, `Features/RootTabView.swift`, `Core/NoMarkupIcon.swift` |
| app_icon | true | `Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` (single 1024 universal) |
| accounts / passwords / third_party_login | true | `Auth/` — Login/Register/Forgot, `GoogleOAuthSession.swift`, `SignInWithAppleButton.swift` |
| sensitive_data | true | Stripe payments (`Core/RailACheckout.swift`), ID docs (`Features/VerificationDocumentsView.swift`), DOB (`Features/AgeGateView.swift`), addresses/geo |
| permissions / camera | true | `NSLocationWhenInUse`/`NSPhotoLibrary`/`NSCamera` usage descriptions in `ios/NoMarkup/Info.plist:82-87` |
| tracking / analytics_sdks | false | No ATT keys (deliberate, `Info.plist:88`); only SPM dep is stripe-ios |
| notifications / push | true | `Core/PushRegistration.swift`; `UIBackgroundModes=[remote-notification]`; `aps-environment=development` |
| widgets / live_activities / app_intents / siri | false | Zero WidgetKit/ActivityKit/AppIntents/SiriKit imports; app + UI-test targets only |
| apple_intelligence / on_device_ml / cloud_llm | false | No FoundationModels/CoreML/LLM SDKs in `ios/` (`ml/` is server-side training, not deployed) |
| accessibility_target | true | GUI app (default true) |
| localization | false | No `*.lproj`, `*.xcstrings`, `*.strings` anywhere under `ios/` |
| game / metal / media_playback / health / watch / catalyst | false | No imports/targets; `SUPPORTS_MACCATALYST = NO` etc. in `project.pbxproj` |
| ipad | true | `TARGETED_DEVICE_FAMILY = "1,2"`; `UISupportedInterfaceOrientations~ipad`; `UIRequiresFullScreen=false` |
| app_store_distribution | true | Signing configured, Apple Pay merchant, v0.1.0, ASC packaging docs in `docs/compliance/` |
| subscription_or_iap | pointer-true | `Features/PlanLimitsView.swift` (read-only tiers, "Manage on web"); Rail A/B split → ASR skill |

## Executive summary

**93 of 151 registry items applicable; 58 N/A on false flags.**

| Status | Count | Severity of FAILs |
|---|---|---|
| PASS | 42 | — |
| FAIL | 15 | **3 blocker (all `required`)** · 10 major · 2 advisory |
| GAP | 28 | incl. 1 blocker-severity (IOS-DES.20) |
| RISK | 8 | incl. 1 blocker-severity (IOS-DIST.1) |
| N/A | 58 | flag-gated |

**Readiness: NOT READY** — three blocker FAILs on `required` items:

1. **IOS-SEC.1** — A Release/TestFlight build resolves its API base to the committed cleartext `http://192.168.1.101:8081` (`Info.plist:60-61` wins over the HTTPS fallback in `Core/AppConfig.swift:43-60`; the simulator-DEBUG branch is compiled out), sending login credentials, DOB, and ID-document uploads over plaintext HTTP that the `NSAllowsLocalNetworking` ATS exception permits.
2. **IOS-DIST.7** — The privacy nutrition label plan contradicts the shipped binary (label says "push deferred / omit Device ID" while the binary registers for APNs and sends `identifierForVendor`), no `PrivacyInfo.xcprivacy` exists anywhere, and no label has been entered in ASC.
3. **IOS-PERF.6** — `ImageUploader` is `@MainActor`: full-resolution image decode + JPEG encode (×10 photos, sequential) run on the main thread.

This matches the team's own `docs/compliance/launch-board.md` "Binary readiness: NOT READY" self-assessment — the audit adds the cleartext-Release finding, the dead push pipeline, and the main-thread image work as items *not* previously tracked.

### Top 5 actions (severity × user impact)

1. **Make Release builds HTTPS-only** (IOS-SEC.1, IOS-SEC.5): empty the committed `APIBaseURL` so the `https://api.no-markup.com` default applies; move LAN dogfood to a Debug-only `.xcconfig`/scheme env; strip `NSAllowsLocalNetworking` from Release so ATS fails closed; add an archive lint that rejects a non-`https` resolved base URL. Also add the missing Sign in with Apple `request.nonce`.
2. **Tell the truth about data, in both directions** (IOS-DIST.7, IOS-PRI.7): add `ios/NoMarkup/PrivacyInfo.xcprivacy` (collected data types incl. Device ID/push token, precise location, photos, payment, government ID; tracking=false), reconcile `asc-packaging-checklist.md` §4.2/§1.1 with the shipped push registration, set `aps-environment=production` for release archives.
3. **Rebuild the push pipeline end-to-end** (IOS-SYS.NT.4, NT.2, NT.3, NT.5, MISC.3): the server posts to the decommissioned FCM legacy API with a raw APNs token hex — **no push can reach an iOS device today**. Ship a real APNs HTTP/2 provider (.p8 JWT), move the permission prompt behind a value moment with a Settings deep-link on denial, add categories + tap-routing through the existing `NotificationDeepLink` parser, reconcile the badge, and either implement or remove the `remote-notification` background mode.
4. **Take image work off the main thread and bound it** (IOS-PERF.6, IOS-PERF.3, IOS-MED.5): non-isolated encoder using `CGImageSourceCreateThumbnailAtIndex` (≤2048px) so 48 MP originals never materialize; bounded `URLCache`; camera-denied recovery + EXIF orientation normalization (gateway `AutoOrient` defaults false and the imaging engine strips EXIF — sideways-photo risk is live).
5. **Dynamic Type + adaptivity, then prove it on devices** (IOS-A11Y.2, IOS-DES.3, IOS-DES.20, IOS-TEST.3): replace the 69 fixed `.system(size:)` fonts with text styles (money surfaces at 34–40pt + `lineLimit(1)` are the clipping risk), stop forcing dark (or ship real light assets), then execute the smoke matrix on iPhone SE, 13" iPad, and AX5 text size — currently zero device-verified UI passes and zero iPad testing despite claiming iPad support.

### Modernization highlights (opportunity, not blockers)

- **Live Activities** (IOS-SYS.LA.4) — the app already streams `auction_ends_at` over WebSocket, hand-rolls a countdown, and spams `auction_closing_soon`/`bid_outbid` pushes: it pays the cost of a Live Activity without shipping one. Best single platform-adoption win available.
- **Widgets** (IOS-SYS.WD.5) — "my active bids / next closing auction" small widget + Lock Screen countdown, deep-linking via the existing `nomarkup` scheme.
- **App Intents / Shortcuts** (IOS-INT.7, IOS-AI.1) — check-in-to-job and my-highest-bid intents first; prerequisite for Visual Intelligence (IOS-AI.11) over the photo catalog.
- **Passkeys** (IOS-SEC.2, IOS-SEC.3) — currently structurally impossible: no associated-domains entitlement and no AASA file (IOS-SEC.9, which also blocks Universal Links).
- **Liquid Glass** (IOS-DES.4) — chrome actively suppresses system materials via opaque `UI*BarAppearance` on `scrollEdgeAppearance`; adopt behind `#available(iOS 26)`.

---

## Findings

Grouped by section. Non-PASS findings carry the full schema; PASS items are one-line with their anchor evidence. Confidence is the section agent's 1–10 self-assessment.

### 01 — Design (22 items: 9 PASS · 5 FAIL · 4 GAP · 1 RISK · 3 N/A)

**PASS**: IOS-DES.1 (content-first IA — `Features/HomeView.swift:33-50`, 5 content tabs) · IOS-DES.2 (progressive disclosure — 33 `.sheet`, 21 `confirmationDialog`, 151 empty-state sites) · IOS-DES.5 (system containers — `TabView`, 82 `NavigationStack`, 0 `NavigationView`, 50 `List`) · IOS-DES.10 (native IA, not a web port — web confined to `SFSafariViewController` in `Features/LegalWebView.swift:24-35`) · IOS-DES.11 (`.searchable` on all five search surfaces with loading/error/empty states) · IOS-DES.15 (no stereotyping imagery; sample data confined to `#Preview`) · IOS-DES.17 (lazy lists + real pagination — `Features/JobsView.swift:129,240-349`) · IOS-DES.18 (modern UIKit appearance APIs; zero deprecated `keyWindow`/`UIScreen.main`/`UIAlertController`) · IOS-DES.19 (HIG as living reference — `docs/compliance/apple-docs-review-roadmap.md`, phase-2 HIG log)

### [IOS-DES.3] Appearance adaptivity is overridden, not adapted (forced dark + non-scaling type)
- Status: FAIL
- Severity: major
- Kind: required
- Rule: Adapt seamlessly to orientation, Dark Mode, and Dynamic Type; let people choose.
- Evidence: `NoMarkupApp.swift:24` `.preferredColorScheme(.dark)` app-wide + `Core/BrandTheme.swift:209` forcing `.environment(\.colorScheme, .dark)`; `AccentColor.colorset` ships identical values for universal and dark — no light appearance exists, no in-app appearance setting. 69 fixed `.font(.system(size:))` sites with zero `ScaledMetric`/`relativeTo:`/`dynamicTypeSize`; 34–40pt money text paired with `.lineLimit(1)` (`Features/JobDetailView.swift:501,721`, `Features/ListingDetailView.swift:436`) and only two `minimumScaleFactor` guards. Landscape/iPad orientations claimed in `Info.plist:35-47` with no size-class-aware layout anywhere.
- Remediation: Semantic Color Set assets with light+dark appearances (or system-default appearance with an optional override); convert fixed fonts to text styles / `relativeTo:`; `@ScaledMetric` for icon dims; drop `lineLimit(1)` on money text.
- Doc: https://developer.apple.com/design/human-interface-guidelines/designing-for-ios
- Confidence: 9

### [IOS-DES.4] Zero Liquid Glass adoption; chrome actively opts out of system materials
- Status: RISK
- Severity: major
- Kind: opportunity
- Rule: Adopt the unified platform design language (Liquid Glass) while preserving app identity.
- Evidence: Zero `glassEffect`/`GlassEffectContainer`/`scrollEdgeEffect` in tree. iOS 17.0 floor means glass is not required, but `Core/BrandTheme.swift:130-158` applies `configureWithOpaqueBackground()` to `scrollEdgeAppearance` on both bars — actively suppressing glass when an Xcode-26 binary runs on iOS 26+. No adoption plan recorded.
- Remediation: `#available(iOS 26)`-gated chrome path that drops opaque bar overrides (keep gold `.tint`); record decision + date in `apple-docs-review-roadmap.md`.
- Doc: https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass
- Confidence: 9

### [IOS-DES.6] App icon is a single raster with no dark/tinted appearances
- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Follow current layered/Liquid Glass icon expectations on modern OS.
- Evidence: `AppIcon.appiconset/Contents.json` has exactly one entry (`AppIcon-1024.png`), no `appearances` array — the registry's exact failure mode. No Icon Composer source; `brand/` holds flat PNGs only. (SF Symbols usage is strong: 421 `systemName:` sites.)
- Remediation: Icon Composer layered `.icon` (Xcode 26), or minimally add `luminosity: dark` + `tinted` entries with matching PNGs.
- Doc: https://developer.apple.com/design/
- Confidence: 9

### [IOS-DES.7] Two secondary lists expose destructive delete via swipe only
- Status: GAP
- Severity: major
- Kind: required
- Rule: Avoid gesture-only critical actions without alternatives.
- Evidence: `Features/QuoteTemplatesView.swift:129-136` and `Features/BusinessFeaturesHubView.swift:553-559` — swipe Delete with no inline/context/`onDelete` alternative. Money-critical path is covered (MyBids has row buttons + contextMenu + swipe). Broader input hygiene is good: 266 `accessibilityLabel`, 487 `minHeight: 44+` frames, `@FocusState` across auth.
- Remediation: Mirror the swipe action in a `.contextMenu` or `.onDelete` + `EditButton` on those two rows.
- Doc: https://developer.apple.com/design/human-interface-guidelines/designing-for-ios
- Confidence: 8

### [IOS-DES.8] Notification permission fires on sign-in with no context; denied state is a dead end
- Status: GAP
- Severity: major
- Kind: required
- Rule: Request access in context and respect the user's choice.
- Evidence: `NoMarkupApp.swift:62-91` triggers `requestAuthorization` the moment auth flips (3 root-level triggers), no pre-prompt, no value moment. Denied → `lastError` string surfaced passively in `Features/AccountView.swift:76-80` with no Settings link. Location and camera flows are exemplary by contrast (`Features/JobsMapView.swift:186-208`, `Location/LocationPurposeCopy.swift`).
- Remediation: Move behind first bid/message with a pre-prompt modeled on `LocationPurposeCopy`; add `openSettingsURLString` on denial. (Same fix satisfies IOS-SYS.NT.2.)
- Doc: https://developer.apple.com/design/human-interface-guidelines/designing-for-ios
- Confidence: 9

### [IOS-DES.9] Scroll edge transition disabled app-wide by permanently opaque bars
- Status: FAIL
- Severity: advisory
- Kind: recommended
- Rule: Use scroll edge effects so content transitions under control areas.
- Evidence: `Core/BrandTheme.swift:143-158` pins opaque appearance on `standardAppearance` + `scrollEdgeAppearance` + `compactAppearance`; 70 `.toolbarBackground(...navy...)/.visible` pairs re-pin per screen. Contrast is fine; the platform edge behavior is simply removed.
- Remediation: Leave `scrollEdgeAppearance` to the system; drop blanket `.toolbarBackground(.visible)`.
- Doc: https://developer.apple.com/design/human-interface-guidelines/layout
- Confidence: 8

### [IOS-DES.12] iPad support claimed in build settings, but no adaptive layout exists
- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: On iPad, support size classes, multitasking, pointer/keyboard where iPad support is claimed.
- Evidence: `TARGETED_DEVICE_FAMILY = "1,2"`, all-orientation iPad, `UIRequiresFullScreen=false`, multiple scenes — yet zero `horizontalSizeClass`/`NavigationSplitView`/`userInterfaceIdiom` in tree; every screen is iPhone-width single-column with fixed `.padding(.horizontal, 20)`. Already flagged internally (`docs/compliance/review-logs/phase-2.md` row 9).
- Remediation: `NavigationSplitView` for Marketplace/Jobs/Messages at regular width + readable-width caps; verify at 1/2 and 1/3 Stage Manager widths. (Or decide iPhone-only — see IOS-MP.1.)
- Doc: https://developer.apple.com/design/human-interface-guidelines/designing-for-ios
- Confidence: 9

### [IOS-DES.14] Store screenshot plan targets retired display sizes; no iOS marketing assets exist
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: Prefer official Apple design resources for App Store marketing.
- Evidence: `asc-packaging-checklist.md:164,351` specifies 6.7"/12.9" (+ legacy 6.5"/5.5") — not the current 6.9"/13" set; zero iOS screenshots in repo; no Icon Composer source.
- Remediation: Update the size matrix; capture on 6.9" iPhone + 13" iPad simulators; use Apple Design Resources frames.
- Doc: https://developer.apple.com/design/resources/
- Confidence: 7

### [IOS-DES.16] Internal codenames leak into shipped user-visible copy
- Status: FAIL
- Severity: advisory
- Kind: recommended
- Rule: Craft clear names; avoid jargon.
- Evidence: `Features/AccountView.swift:541` ("Rail A: … StoreKit / IAP intentionally omitted"), `Features/ProviderWorkspaceView.swift:439` ("PRD FR-5.2."), `:465` ("(PRD FR-5.5)") — shipped, non-Preview strings.
- Remediation: Rewrite in user language; move requirement IDs to code comments.
- Doc: https://developer.apple.com/ios/whats-new/
- Confidence: 9

### [IOS-DES.20] No device-verified pass on primary flows; small-phone clipping risk unresolved
- Status: GAP
- Severity: blocker
- Kind: required
- Rule: UI must not ship with broken/overlapping layouts on supported devices.
- Evidence: Clean on placeholders (zero lorem/TODO strings; no storyboards). Unverified on devices: 69 fixed fonts + `lineLimit(1)` with 2 scale guards (see IOS-DES.3) and the smoke pass never human-executed (`ios/README.md` TODO; `asc-packaging-checklist.md:427` Open). GAP not FAIL: nothing demonstrably broken — it is unverified.
- Remediation: Execute `device-smoke-checklist.md` on iPhone SE (3rd gen), 16 Pro Max, 13" iPad at default + AX5 type; sign off in `launch-board.md`; fix any clipping found.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 8

**N/A**: IOS-DES.13 (cross_platform=false) · IOS-DES.21 (no Wallet passes; Apple Pay is Stripe PaymentSheet) · IOS-DES.22 (web_only=false)

### 02 — Privacy & Security (24 items: 13 PASS · 1 FAIL · 5 GAP · 1 RISK · 4 N/A)

**PASS**: IOS-PRI.1 (informed consent; consent-gated flows; only SDK is stripe-ios) · IOS-PRI.2 (privacy policy linked from login/account/deletion — `Core/AppConfig.swift:14`) · IOS-PRI.3 (purpose strings specific and matched to real API use; deliberate mic/ATT omissions documented `Info.plist:88`) · IOS-PRI.4 (just-in-time prompts; zero dialogs at cold launch signed-out) · IOS-PRI.8 (no pasteboard reads; `PhotosPicker` per-item access) · IOS-PRI.11 (real in-app account deletion → `DELETE /api/v1/users/me` with 30-day grace, verified through `gateway/internal/handler/user.go:166-243`) · IOS-SEC.4 (tokens in Keychain via `SecItem*`; zero `UserDefaults` in target; Stripe owns PAN entry) · IOS-SEC.6 (SIWA system button alongside Google; Google is SDK-less `ASWebAuthenticationSession` + PKCE S256 + state) · IOS-SEC.8 (platform crypto only — CryptoKit SHA256 for PKCE, `SecRandomCopyBytes`) · IOS-SEC.10 (zero logging calls in target; no PII to console) · IOS-SEC.11 (no brittle jailbreak checks; risk handled server-side) · IOS-SEC.12 (no pinning = no rotation brick; `URLSession.shared`, no delegate) · IOS-SEC.13 (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` — intentional for session tokens)

### [IOS-SEC.1] Release builds resolve to a cleartext HTTP LAN endpoint for all auth and PII traffic
- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Protect collected data — TLS for network, no hardcoded secrets, secure token storage.
- Evidence: `Info.plist:60-61` commits `APIBaseURL = http://192.168.1.101:8081`. `Core/AppConfig.swift:43-60` resolution order: env → simulator-DEBUG `127.0.0.1` (compiled out of Release) → **Info.plist value when non-empty** → `https://api.no-markup.com` (unreachable while the plist value stands). `NSAllowsLocalNetworking=true` (`Info.plist:100-105`) permits the RFC1918 cleartext load. Login (`Core/APIClient.swift:96-110`), Bearer/refresh, DOB, and ID-document uploads all transit plaintext in a Release/TestFlight build. `ios/README.md:122` contradicts the committed file ("defaults to https://api.no-markup.com"). Secondary: `Auth/SignInWithAppleButton.swift:12-14` sets no `request.nonce` (Google path does PKCE correctly). Positive: no committed secrets (`StripePublishableKey`/`GoogleIosClientID` empty; test creds `#if DEBUG` env-only).
- Remediation: Empty the plist `APIBaseURL` (Release default kicks in) or set it to the HTTPS host; LAN override via Debug-only `.xcconfig`/scheme env; archive-time assertion that the resolved scheme is `https`; add SIWA nonce (random → SHA256 in request, verify raw nonce in gateway exchange).
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 9

### [IOS-PRI.7] App privacy manifest absent
- Status: GAP
- Severity: major
- Kind: required
- Rule: Declare Required Reason APIs and data collection in privacy manifests.
- Evidence: No `PrivacyInfo.xcprivacy` anywhere in repo; no pbxproj reference. App collects email/name, DOB, government ID docs, precise location, photos, payment, `identifierForVendor` (`Core/PushRegistration.swift:106`). Mitigating: zero first-party Required-Reason API usage found (no `UserDefaults`, file-timestamp, disk-space, boot-time APIs); stripe-ios ships its own manifest in the SPM checkout. Gap untracked in `docs/compliance/`.
- Remediation: Add `ios/NoMarkup/PrivacyInfo.xcprivacy` — `NSPrivacyTracking=false`, empty tracking domains, collected-data types as above, `NSPrivacyAccessedAPITypes` empty until a Required-Reason API is used.
- Doc: https://developer.apple.com/documentation/bundleresources/privacy_manifest_files
- Confidence: 9

### [IOS-SEC.2] No passkey sign-in path
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Adopt passkeys as phishing-resistant sign-in.
- Evidence: Zero `ASAuthorizationPlatformPublicKeyCredential`/WebAuthn in tree. Auth = password + SIWA + Google + TOTP MFA. Structurally blocked: no associated-domains entitlement → no `webcredentials:` anchor (see IOS-SEC.9).
- Remediation: Associated domains + AASA first, then `ASAuthorizationPlatformPublicKeyCredentialProvider` registration/assertion with password fallback.
- Doc: https://developer.apple.com/passkeys
- Confidence: 9

### [IOS-SEC.3] Passkey/password coexistence and AutoFill
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: Passkeys should coexist with passwords via AutoFill.
- Evidence: AutoFill half is complete and correct (`.username`/`.password`/`.newPassword`/`.oneTimeCode` across all auth forms); recovery + unlink-lockout protection exist. Missing half: nothing to coexist with (no passkeys).
- Remediation: After IOS-SEC.2, add `ASAccountAuthenticationModificationController` upgrade prompts + shared web credentials for `no-markup.com`.
- Doc: https://developer.apple.com/passkeys
- Confidence: 8

### [IOS-SEC.5] ATS exception ships unconditionally in Release
- Status: RISK
- Severity: major
- Kind: required
- Rule: Keep ATS enabled; exceptions minimal and justified.
- Evidence: Exception shape is minimal (`NSAllowsLocalNetworking` only, justified comment, no `NSAllowsArbitraryLoads`) — but the single `Info.plist` serves Debug and Release (`GENERATE_INFOPLIST_FILE = NO`), and it is exactly what makes the IOS-SEC.1 cleartext URL loadable in a shipped build.
- Remediation: Debug/Release plist split (`.xcconfig` or preprocessing) so the exception is absent from App Store builds; ATS then fails closed on any cleartext slip.
- Doc: https://developer.apple.com/documentation/security
- Confidence: 8

### [IOS-SEC.7] No LocalAuthentication step-up for payments or destructive account changes
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use LocalAuthentication appropriately; reauth policy for high-risk actions.
- Evidence: No `LAContext` anywhere (so no biometric theater either). Checkout (`Core/RailACheckout.swift:41-90`, card/Link path) and account deletion (`Features/AccountDeletionView.swift:81-111`, typed phrase only) run on the ambient session. Counterexamples exist server-side: password change requires current password; MFA disable requires live TOTP.
- Remediation: Optional biometric app-lock (`.deviceOwnerAuthentication` with passcode fallback); server-verified reauth (password/TOTP) before deletion request and payment-method changes.
- Doc: https://developer.apple.com/documentation/localauthentication
- Confidence: 7

### [IOS-SEC.9] No associated domains — no Universal Links and no webcredentials
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Universal Links / webcredentials configured correctly for passkeys and deep links.
- Evidence: Entitlements carry only applesignin + in-app-payments + aps. Zero `applinks:`/`webcredentials:` in tree; `web/public/.well-known/` has the Apple Pay file but no `apple-app-site-association`; no `onOpenURL`/`NSUserActivity` router exists, so even a Universal Link would not route. Only entry is the hijackable custom scheme `nomarkup://`.
- Remediation: Associated-domains entitlement (`applinks:` + `webcredentials:no-markup.com`), publish AASA for `TEAMID.com.nomarkup.app`, add an `onOpenURL` router mapping job/listing/auction paths to detail views.
- Doc: https://developer.apple.com/documentation/authenticationservices
- Confidence: 9

**N/A**: IOS-PRI.5 (ATT — tracking=false, verified no ATT APIs) · IOS-PRI.6 (analytics SDK inventory — stripe-ios only) · IOS-PRI.9 (health=false) · IOS-PRI.10 (cloud_llm=false)

### 03 — System Experiences (26 items: 0 PASS · 5 FAIL · 5 RISK · 16 N/A)

### [IOS-SYS.NT.4] APNs provider does not exist — iOS push cannot be delivered; entitlement stuck on development
- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Use APNs correctly; validate with Push Notifications Console; monitor delivery.
- Evidence: `services/notification/internal/service/push.go` POSTs to `https://fcm.googleapis.com/fcm/send` (FCM **legacy** API, decommissioned) with `Authorization: key=` and no `apns` block. iOS sends a **raw APNs token hex** (`Core/PushRegistration.swift:49`) as the device token; zero Firebase SDK in `ios/`, so no FCM registration token ever exists — the APNs hex is not a valid FCM target. `aps-environment=development` (App Store requires production). Sign-out never unregisters the token server-side (`PushRegistration.swift:61`). No Push Console validation step anywhere in `docs/compliance/`.
- Remediation: Real APNs provider (token-based `.p8` JWT, HTTP/2 `api.push.apple.com`) keyed on `platform == "ios"` — or adopt the Firebase iOS SDK and register FCM tokens. Emit `apns-push-type`/`apns-priority`/`apns-topic`. Production `aps-environment` for release. Unregister on sign-out. Add a Push Console check to the smoke checklist.
- Doc: https://developer.apple.com/notifications/push-notifications-console/
- Confidence: 9

### [IOS-SYS.NT.2] Permission prompt fires immediately at login with no context; denied state is a dead end
- Status: FAIL
- Severity: major
- Kind: required
- Rule: Request authorization in context; respect provisional/denial states.
- Evidence: `NoMarkupApp.swift:62-91` — three root triggers fire `requestAuthorization` the instant auth flips; no pre-permission screen; `.provisional` never requested. Denied → passive status row in `AccountView.swift:76-80`, no Settings link. Coherence gap: all push types default `Push: false` server-side (`services/notification/internal/service/service.go:500-506`) and the iOS global toggle is `.disabled(true)` — permission granted, nothing deliverable.
- Remediation: Gate behind a value moment (first watchlist/bid/contract) reusing the `LocationPurposeCopy` pattern, or request `.provisional` at login and upgrade later; Settings deep-link on denial; make the grant meaningful (enable a default type on grant).
- Doc: https://developer.apple.com/design/human-interface-guidelines/managing-notifications
- Confidence: 9

### [IOS-SYS.NT.3] No notification categories, actions, interruption levels, or push-tap routing
- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Clear title/body, useful actions, appropriate interruption levels.
- Evidence: Zero `UNNotificationCategory`/`interruptionLevel`/`threadIdentifier`/communication-notification usage. `didReceive response:` body is `completionHandler()` only (`PushRegistration.swift:137-143`) — tapping a push routes nowhere, while a working `NotificationDeepLink.destination(from:)` parser sits at `NotificationsView.swift:334-400` wired only to inbox rows. Actionable types (`bid_outbid`, `bid_awarded`, `auction_closing_soon`, `contract_created`) ship without actions; chat has no communication-notification treatment.
- Remediation: Categories + actions per type ("Bid again", "View contract", "Reply"); route `didReceive` through the existing parser via `userInfo`; `.timeSensitive` only for closing/outbid; communication notifications for chat.
- Doc: https://developer.apple.com/design/human-interface-guidelines/managing-notifications
- Confidence: 9

### [IOS-SYS.NT.5] Badge is requested and presented but never cleared — guaranteed stale badge
- Status: FAIL
- Severity: major
- Kind: required
- Rule: Badge counts stay accurate and clearable.
- Evidence: `.badge` requested (`PushRegistration.swift:85`) and presented (`:134`); zero `setBadgeCount`/`applicationIconBadgeNumber` anywhere; `markAllRead()` resets only in-app state (`NotificationsView.swift:312-328`); server sends no `badge` key.
- Remediation: Authoritative `badge` from server unread count; `setBadgeCount(0)` on active scene; reconcile after mark-read.
- Doc: https://developer.apple.com/notifications/
- Confidence: 10

### [IOS-SYS.MISC.3] `remote-notification` background mode declared with no background-push code path
- Status: FAIL
- Severity: major
- Kind: required
- Rule: Declared background modes must match real features.
- Evidence: `Info.plist:51-54` declares it; zero `didReceiveRemoteNotification`/`BGTaskScheduler` in tree; server never sends `content-available`.
- Remediation: Remove the mode (alert pushes don't need it) or implement silent-refresh handling + `content-available: 1` for auction state.
- Doc: https://developer.apple.com/documentation/backgroundtasks
- Confidence: 9

### [IOS-SYS.NT.1] Per-type opt-down exists server-side but is unreachable from the app; no send-rate policy
- Status: RISK
- Severity: major
- Kind: required
- Rule: Notifications are timely and high-value, not spam; users can tune them.
- Evidence: Content is transactional and per-type prefs exist server-side, but both iOS global toggles are `.disabled(true)` and per-type rows render only "when server returns rows" (`NotificationPreferencesView.swift:64-84`) — empty prefs response = zero in-app opt-down. No rate cap/quiet hours; marketing-adjacent schedulers (`reengagement.go`, `price_drop_scheduler.go`, `nps.go`) share the same fan-out.
- Remediation: Seed per-type rows from defaults so the empty path is impossible; writable global toggle; per-user send-rate cap; separate promotional group opt-down.
- Doc: https://developer.apple.com/notifications/
- Confidence: 8

### [IOS-SYS.NT.6] Every foreground notification plays a sound regardless of priority
- Status: RISK
- Severity: advisory
- Kind: recommended
- Rule: Sounds only when they add value; respect Focus.
- Evidence: `willPresent` returns `[.banner, .sound, .badge]` unconditionally (`PushRegistration.swift:134`) — `price_drop` sounds like `bid_outbid`; no `interruptionLevel` anywhere.
- Remediation: Branch on payload type — silent `[.banner]` for promotional; `.passive` interruption level.
- Doc: https://developer.apple.com/design/human-interface-guidelines/managing-notifications
- Confidence: 8

### [IOS-SYS.LA.4] Live-auction domain is a textbook Live Activities fit; ActivityKit absent
- Status: RISK
- Severity: advisory
- Kind: opportunity
- Rule: Multi-hour live status people care about → evaluate Live Activities over notification spam.
- Evidence: Zero ActivityKit; no widget/extension target; no `NSSupportsLiveActivities`. Fit is unusually strong: WebSocket auction state (`Core/AuctionWebSocketClient.swift:278,355`), hand-rolled countdown (`Core/Models.swift:24-51`), and dedicated `auction_closing_soon`/`bid_outbid`/`auction_closed` push types — the app pays a Live Activity's cost in pushes without shipping one.
- Remediation: Widget extension + `ActivityAttributes` (low bid, bid count, `Text(timerInterval:)`, your-position); start on first bid/watch; update via WebSocket + `liveactivity` push; Dynamic Island compact = countdown + low bid.
- Doc: https://developer.apple.com/ios/
- Confidence: 9

### [IOS-SYS.WD.5] No WidgetKit despite multiple glanceable metric surfaces
- Status: RISK
- Severity: advisory
- Kind: opportunity
- Rule: Glanceable status → evaluate a widget.
- Evidence: Zero WidgetKit; glanceable surfaces already built as full screens (`MyBidsView`, `WatchlistView`, `SavingsView`, `SellerAnalyticsView`, auction countdown, unread count).
- Remediation: Small/medium "active bids / next closing" widget + Lock Screen `accessoryRectangular` countdown, deep-linked via `nomarkup` scheme.
- Doc: https://developer.apple.com/ios/
- Confidence: 9

### [IOS-INT.7] Strong action verbs with no App Intents adoption
- Status: RISK
- Severity: advisory
- Kind: opportunity
- Rule: Clear verbs → evaluate App Intents.
- Evidence: Zero AppIntents/CoreSpotlight; roadmap defers it (`apple-docs-review-roadmap.md:263`). Verbs already implemented as views: bid, post job, check in (location-bound), watch listing, saved search.
- Remediation: Start with "Check in to my job" and a my-highest-bid `AppEntity` query via `AppShortcutsProvider`.
- Doc: https://developer.apple.com/ios/
- Confidence: 9

**N/A**: IOS-SYS.MISC.1 (App Clips — none; registry directs N/A) · IOS-SYS.LA.1–3 (live_activities=false) · IOS-SYS.WD.1–4, IOS-SYS.MISC.2 (widgets=false) · IOS-INT.1–6 (app_intents=false) · IOS-INT.8 (siri=false). Product-fit surrogates scored above as LA.4/WD.5/INT.7.

### 04 — Intelligence (18 items: 3 PASS · 2 GAP · 13 N/A)

**PASS**: IOS-AI.9 (all text entry on stock SwiftUI controls → Writing Tools inherited; no custom text engine — `Features/MessagesView.swift:914,1466`) · IOS-AI.10 (Genmoji rendering inherited via stock `TextField`/`Text`; transactional chat) · IOS-AI.18 (**blocker-severity check, passes cleanly**: zero AI/intelligence claims in app strings or ASC copy; no bundled models; PRD self-polices roadmap language)

### [IOS-AI.1] No App Intents or Foundation Models surface for a marketplace with strong intent-shaped actions
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: Integrate content/actions into system intelligence via App Intents; Foundation Models where valuable.
- Evidence: Zero `AppIntents`/`FoundationModels` across 97 Swift files; no intent keys in Info.plist; no Siri entitlements. No opaque-server-bot failure mode either — server AI (`engines/` heuristics, `ml/`) is never marketed in-app.
- Remediation: `AppIntent` + `AppShortcutsProvider` for core verbs (post job, create listing, my orders, saved searches) + `IndexedEntity` for listings; Foundation Models later (e.g. draft listing from photo).
- Doc: https://developer.apple.com/apple-intelligence/
- Confidence: 9

### [IOS-AI.11] Visual Intelligence not integrated despite a photo-rich goods catalog that fits the surface
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: Evaluate Visual Intelligence integration when a content catalog fits.
- Evidence: No `VisualIntelligence`/`IntentValueQuery`; yet the goods catalog is photo-backed (`CameraImagePicker`, `ImageUploader`, `CreateListingView`, `ListingDetailView`) — the registry's named shopping-app profile.
- Remediation: Sequence after App Intents (built on `IntentValueQuery` → `AppEntity`); reasonable to defer past launch.
- Doc: https://developer.apple.com/documentation/VisualIntelligence/
- Confidence: 8

**N/A**: IOS-AI.2–6, 8, 13–15, 17 (apple_intelligence=false) · IOS-AI.7, 16 (on_device_ml=false; no model artifacts) · IOS-AI.12 (cloud_llm=false)

### 05 — Quality (27 items: 10 PASS · 3 FAIL · 7 GAP · 7 N/A)

**PASS**: IOS-A11Y.1 (**blocker-severity, passes**: 253 `accessibilityLabel`, 184 hints, 79 elements across 66/96 files; custom `MarketRangeBar` fully combined+labeled; zero unlabeled icon-only buttons) · IOS-A11Y.4 (no gesture-only critical actions; swipes are List-native, rotor-exposed) · IOS-A11Y.7 (never color alone — 718 `Label`/symbol sites; offline banner icon+text; range bar text-labeled) · IOS-L10N.4 (inclusion — no baked personas; locale-aware formatters; USD literal noted for future regions `Core/Models.swift:91`) · IOS-PERF.1 (documented budgets + reproducible sampler — `docs/compliance/perf-gate-2026-07-26.md`; client-side instrumentation blind spot noted) · IOS-PERF.2 (clean cold launch — appearance-proxy-only `init()`, all startup work in async `.task`) · IOS-PERF.4 (lazy lists everywhere; the one unbounded ScrollView correctly uses `LazyVStack`) · IOS-PERF.5 (push-over-poll; WebSockets with jittered exponential backoff + anti-hot-loop guard; one 15s view-scoped timer) · IOS-TEST.4 (modern toolchain — Xcode 26.5 pinned via `DEVELOPER_DIR`, Swift 6, strict concurrency, shared scheme) · IOS-MP.2 (reuse-friendly layering — `actor APIClient`, UIKit fenced behind `canImport`; deliberate Catalyst/visionOS opt-outs)

### [IOS-A11Y.2] Dynamic Type not supported — 69 fixed-point fonts, no scaling primitives
- Status: FAIL
- Severity: major
- Kind: required
- Rule: Text scales with user settings without truncating critical content.
- Evidence: 69 `.font(.system(size:))` sites (55 in `HomeView.swift` alone — hero 32pt:137, chips 10–12pt); auction amounts 40pt/34pt (`JobDetailView.swift:501,721`) with `.lineLimit(1)`; zero `ScaledMetric`/`relativeTo:`/`dynamicTypeSize`; 3 `minimumScaleFactor` total — one clipping the leading bid rather than reflowing.
- Remediation: Text styles / `Font.custom(_:size:relativeTo:)`; `.largeTitle.monospacedDigit()` for amounts; `@ScaledMetric` for dims; AX5 `#Preview` variants for Home/JobDetail/RootTab.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 9

### [IOS-A11Y.3] Reduce Motion, Increase Contrast, Reduce Transparency unhandled
- Status: GAP
- Severity: major
- Kind: required
- Rule: Respect motion/contrast/transparency accessibility settings.
- Evidence: Zero `accessibilityReduceMotion`/`ReduceTransparency`/`DifferentiateWithoutColor` env reads. Unconditional animations (`NoMarkupApp.swift:57,66`; `BrandTheme.swift:277-278`) — though volume is low (6 sites, no `repeatForever`). Hardcoded literal brand colors with no high-contrast asset variants (`textSecondary #8b949e` on `#07080b`); translucent hairlines can't flatten; forced dark overrides user choice. Already flagged in phase-2 log.
- Remediation: Env-gate the animation sites; opaque swaps under Reduce Transparency; migrate brand colors to colorsets with High Contrast variants.
- Doc: https://developer.apple.com/ios/
- Confidence: 9

### [IOS-A11Y.6] Accessibility Nutrition Label readiness — no feature matrix, overclaim risk
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Declare a11y support accurately in ASC; don't overclaim.
- Evidence: Zero accessibility-label references in packaging docs (`asc-packaging-checklist.md` has no a11y section); `capability-matrix.md:126` "not started". Given A11Y.2/A11Y.3, declaring Larger Text or Reduced Motion would be an overclaim; VoiceOver is defensible per A11Y.1.
- Remediation: Add a per-feature claim table mapped to code evidence; claim only VoiceOver/Voice Control until A11Y.2/.3 land; gate on launch-board.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 9

### [IOS-L10N.5] Base language hygiene — 100% inline string literals, no extraction path
- Status: GAP
- Severity: advisory
- Kind: recommended
- Rule: Externalize strings even single-locale.
- Evidence: No String Catalog/`.strings` anywhere; zero `NSLocalizedString`/`String(localized:)`; hand-rolled plurals (`"template\(count == 1 ? "" : "s")"`).
- Remediation: Add `Localizable.xcstrings` + `SWIFT_EMIT_LOC_STRINGS = YES`; wrap non-`Text` strings; catalog plural rules.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 9

### [IOS-PERF.3] Memory — full-resolution image decode with no downsampling, no cache limits
- Status: GAP
- Severity: major
- Kind: required
- Rule: No unbounded image memory; handle warnings.
- Evidence: `ImageUploader.swift:112` decodes full-res (`UIImage(data:)`), re-encodes at `:135`; only the byte budget (10 MB) is enforced — a 48 MP HEIC ≈ 190 MB bitmap, ×10 sequential. Zero `CGImageSourceCreateThumbnailAtIndex`/`preparingThumbnail`; zero `URLCache`/`NSCache` config on the 3 `AsyncImage` sites; no memory-warning handler. Mitigating: Swift 6 strict concurrency, 16 `[weak self]`, cancellable socket Tasks.
- Remediation: ImageIO downsample (`kCGImageSourceThumbnailMaxPixelSize` ≈ 2048); bounded `URLCache` on a dedicated session.
- Doc: https://developer.apple.com/documentation/xcode/improving-your-app-s-performance
- Confidence: 8

### [IOS-PERF.6] Main thread blocked by full-image decode and JPEG encode
- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Do not block the main thread with heavy decode/encode.
- Evidence: `ImageUploader.swift:14-15` — `@MainActor enum ImageUploader`, nothing `nonisolated`: decode (`:112`), encode (`:134-135`), retry encode (`:140`) all run on main; `uploadAll` (`:41-56`) drives up to 10 sequentially; camera path calls it from MainActor UI (`:340`). Registry's stated failure mode. Everything else is correctly isolated (`actor APIClient`, 261 scoped `@MainActor`, strict concurrency complete, zero `Data(contentsOf:)`/semaphores).
- Remediation: Drop `@MainActor` from the enum (keep it on the SwiftUI section members); `nonisolated` prepare/encode/sniff; background `actor ImageEncoder` doing downsample+encode; only `Sendable` `PreparedImage` crosses back.
- Doc: https://developer.apple.com/documentation/xcode/improving-your-app-s-performance
- Confidence: 9

### [IOS-TEST.1] No unit test target; UI tests not run in CI
- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Maintain automated tests for critical paths.
- Evidence: pbxproj has exactly two targets — app + UI-test bundle; **no unit-test target** for 96 files (APIClient refresh/401, Keychain round-trip, money math, bid ladder uncovered). The UI bundle holds 3 tests, 2 self-skip without creds; the always-on one asserts login-or-tabs. CI has zero `xcodebuild`/macOS runner in any workflow. Existing `scripts/ios-*-e2e*.sh` exercise the Go gateway, not the binary.
- Remediation: Unit-test target (APIClient/Keychain/Models/ImageUploader branches); macOS CI job `xcodebuild test -scheme NoMarkup`; CI creds so skipped paths run.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 9

### [IOS-TEST.2] TestFlight process not established
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: TestFlight for real-device feedback before release.
- Evidence: Every TestFlight mention in docs is an open item ("todo"); no fastlane/`.xcconfig`/upload automation; no beta groups; launch-board records NOT READY.
- Remediation: ASC record + internal group before first submission; `docs/compliance/testflight-process.md` (build-number policy, groups, What-to-Test, crash triage); gating row on launch-board.
- Doc: https://developer.apple.com/testflight/
- Confidence: 9

### [IOS-TEST.3] Device matrix omits small phones, iPad, and the iOS 17.0 floor
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Validate on representative devices/OS including smaller phones.
- Evidence: All evidence is Pro-Max-class + one simulator (`device-smoke-checklist.md:27` pins iPhone 16; results = iPhone 15 Pro Max + iPhone 17 Pro Sim). No SE/mini despite A11Y.2 findings; **zero iPad testing** despite `TARGETED_DEVICE_FAMILY = "1,2"`; no run on the iOS 17.0 floor; matrix "checklist only — not human-executed."
- Remediation: Add SE (3rd gen) @ AX5, iPad (portrait/landscape/Split View), and one iOS 17.0 simulator; execute and sign.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 9

### [IOS-MP.1] iPad shipped as universal target with no regular-width adaptation
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: iPadOS support should be a decision, not an accidental stretched-iPhone dump.
- Evidence: iPad actively claimed (family 1,2; 4 orientations; multitasking enabled; README markets "iPhone + iPad") with zero `NavigationSplitView`/size-class code — full-width stretched lists at 13", arbitrary Stage Manager widths unhandled. Registry's exact failure mode; flagged in phase-2 log.
- Remediation: Either adopt split-view layouts at regular width + iPad smoke rows, or set family "1" and update README — make it a decision.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 9

**N/A**: IOS-A11Y.5 (media_playback=false) · IOS-L10N.1–3 (localization=false; RTL hygiene incidentally good — 240 `.leading` vs 8 `.left`) · IOS-MP.3 (catalyst=false, explicit `NO` settings) · IOS-MP.4 (no watch target) · IOS-MP.5 (cross_platform=false)

### 06 — Games & Media (16 items: 1 PASS · 1 GAP · 14 N/A)

**PASS**: IOS-MED.6 (no pro-photo claims; JPEG-0.85 evidence photography; no RAW pipeline needed)

### [IOS-MED.5] Camera capture: permission-denial path and orientation normalization missing
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Camera features handle permissions and capture appropriately.
- Evidence: System `UIImagePickerController` (no warm-up risk); purpose strings present; hardware-gated at all 3 call sites. Gaps: no `AVCaptureDevice.authorizationStatus` check → no camera-denied copy or Settings recovery (the location flow has exactly this pattern at `JobsMapView.swift:205`); `ImageUploader.swift:135` encodes without normalizing EXIF orientation while the gateway's `AutoOrient` defaults false (`gateway/internal/handler/image.go:211,448`) and the imaging contract strips EXIF — live sideways-photo risk for portrait captures.
- Remediation: Pre-check auth status at the 3 `showCamera` sites with library fallback + Open Settings on denial; redraw via `UIGraphicsImageRenderer` before encode and/or send `auto_orient: true`.
- Doc: https://developer.apple.com/ios/whats-new/
- Confidence: 8

**N/A**: IOS-GAME.1–9 (game/metal=false) · IOS-MED.1–4, 7 (media_playback=false). Verified: zero Metal/GameKit/AVFoundation/MusicKit imports; no `.metal`/`.usdz` assets.

### 07 — Distribution (18 items: 6 PASS · 1 FAIL · 9 GAP · 1 RISK · 1 N/A)

**PASS**: IOS-DIST.3 (review-guideline self-audit done 3× with logs + blockers tracker) · IOS-DIST.9 (no `UIRequiredDeviceCapabilities` over-restriction; camera degrades to library) · IOS-DIST.10 (deliberate Mac/Vision opt-out in pbxproj; mirror in ASC availability at record creation) · IOS-DIST.12 (business model locked — free-tier digital, Rail A/B split, enforced read-only `PlanLimitsView`) · IOS-DIST.17 (support URL declared, wired in-app, real web route) · IOS-DIST.18 (`/app-store-compliance` run; ASR-owned residuals: 3.1.1 free-tier lock; `APIBaseURL` reachability for App Review = ASR 2.1/PRE-05)

### [IOS-DIST.7] Privacy nutrition label contradicts the shipped binary (push/Device ID) and no label is entered
- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Privacy labels are required to submit and must reflect actual practices, including third-party code.
- Evidence: `asc-packaging-checklist.md` §4.2/§1.1 say push is "B5 deferred — omit Device ID / do not enable"; the binary ships push (`aps-environment` entitlement, `remote-notification` mode, live `registerForRemoteNotifications` at `NoMarkupApp.swift:19` → `PushRegistration.swift:41`) and sends `identifierForVendor`. Third-party rows are conditional ("Mapbox (if…), Sentry (if…)") while `Package.resolved` proves Stripe only. No `PrivacyInfo.xcprivacy` (see IOS-PRI.7). Label not entered (§10.2 unchecked). Purpose strings themselves correct.
- Remediation: Reconcile label with binary (declare Device ID/push token linked-not-tracking, or strip push from the target); reduce partner rows to Stripe; add the privacy manifest; `aps-environment=production` for the store archive.
- Doc: https://developer.apple.com/app-store/app-privacy-details/
- Confidence: 9

### [IOS-DIST.1] Release archive SDK floor is not pinned; stated minimum is below Apple's floor
- Status: RISK
- Severity: blocker
- Kind: required
- Rule: Uploads must be built with the iOS 26 SDK or later.
- Evidence: `SDKROOT = iphoneos` floats with selected Xcode; `ios/README.md:16` says "Xcode 16+" (iOS 18 SDK — below floor). Mitigating: documented toolchain is `Xcode-26.5.0` (`README:23,39`, launch-board, device-smoke). No CI lane to enforce (zero `xcodebuild`/macOS in workflows).
- Remediation: README floor → "Xcode 26.x minimum (ASC upload requirement)"; pin `DEVELOPER_DIR` in the archive script or a pinned-Xcode runner.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 8

### [IOS-DIST.2] Latest-OS test evidence is iPhone-only; iPad untested; smoke unsigned
- Status: GAP
- Severity: major
- Kind: required
- Rule: Verify on devices running latest OS releases.
- Evidence: Real iPhone 15 Pro Max @ iOS 26.5.2 + iPhone 17 Pro Sim XCUITest (3/3) exist; no iPad destination anywhere; checklist row still says "iOS 18.x"; matrix recorded as "checklist only — not human-executed/signed."
- Remediation: iPad destination in the matrix; refresh stale OS rows; human-execute and sign.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 9

### [IOS-DIST.4] No TestFlight path for the first binary
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: TestFlight beta before wide release.
- Evidence: All mentions are "todo"; no fastlane/upload lane in CI.
- Remediation: ASC record, internal/external groups, archive→upload lane; budget beta review time.
- Doc: https://developer.apple.com/testflight/
- Confidence: 9

### [IOS-DIST.5] Product page assets planned but not produced
- Status: GAP
- Severity: major
- Kind: required
- Rule: Name, icon, description, screenshots, keywords accurate and ready.
- Evidence: Good plan (§6 shot list, §1 identity); all media boxes `[ ]`; zero iOS screenshots in repo; §6.4 icon row stale (icon now exists at `AppIcon-1024.png`); screenshot tooling unavailable on last device run.
- Remediation: Capture §6.2 scenes on current-size simulators; finalize subtitle/description/keywords; correct §6.4.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 9

### [IOS-DIST.6] Age rating questionnaire drafted but not completed
- Status: GAP
- Severity: major
- Kind: required
- Rule: Age rating reflects actual content (UGC, chat).
- Evidence: Honest §5 guidance (UGC Yes, messaging Yes, 18+ gate, "do not sandbag"); §10.2 still `[ ]`. In-app corroboration: `AgeGateView`, UGC surfaces.
- Remediation: Complete in ASC from §5 once the record exists; record final answers back into §5.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 9

### [IOS-DIST.8] No Accessibility Nutrition Label declarations or supporting audit
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Declare accessibility support accurately; don't overclaim.
- Evidence: No a11y section in the packaging checklist; native a11y "not started" in capability matrix; phase-2 GAPs on Dynamic Type/Reduce Motion. VoiceOver defensible (see IOS-A11Y.1).
- Remediation: Verified-claims-only label sourced from a measured VoiceOver/Dynamic Type/Reduce Motion pass (same work as IOS-A11Y.6).
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 8

### [IOS-DIST.13] In-App Events not evaluated
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: Consider In-App Events for live content/launches.
- Evidence: Single "todo" row; no decision recorded.
- Remediation: Decide (use or defer) at launch; record in packaging checklist.
- Doc: https://developer.apple.com/app-store/in-app-events/
- Confidence: 8

### [IOS-DIST.14] Custom product pages / PPO not considered
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: CPP/PPO for growth testing when it matters.
- Evidence: Zero references anywhere.
- Remediation: Record a deliberate post-launch deferral.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 8

### [IOS-DIST.15] `ITSAppUsesNonExemptEncryption` absent from the binary despite documented answer
- Status: GAP
- Severity: major
- Kind: required
- Rule: Answer export compliance honestly.
- Evidence: §9 documents the `false` answer (HTTPS-exempt posture, consistent with TLS+Keychain-only client crypto); the key is not in `Info.plist`; §10.2 unchecked.
- Remediation: Add `<key>ITSAppUsesNonExemptEncryption</key><false/>`; re-verify if non-exempt crypto is ever linked.
- Doc: https://developer.apple.com/documentation/security
- Confidence: 9

### [IOS-DIST.16] Version scheme still pre-1.0 and no What's New copy exists
- Status: GAP
- Severity: advisory
- Kind: recommended
- Rule: Meaningful versions and release notes.
- Evidence: `MARKETING_VERSION = 0.1.0` / build 2; §3 instructs 1.0.0 for first public release; no bump automation; no changelog/What's-New source anywhere.
- Remediation: 1.0.0 for submission; build-bump step in the archive path; real v1 release notes.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 8

**N/A**: IOS-DIST.11 (universal purchase — single-platform, no IAP products; StoreKit deferred Stage B2)

---

## Out-of-registry observations

- **OBS-1 — Google sign-in cannot complete on a device as committed.** `Info.plist` `GoogleIosClientID` is an empty string and `CFBundleURLTypes` carries only the `nomarkup` scheme — the reverse-client-id scheme the plist's own comment calls for is absent, and `Core/AppConfig.swift` only fills the ID from env/plist at runtime. Dev overrides exist (`NOMARKUP_GOOGLE_IOS_CLIENT_ID`), but a plain archive ships a Google button wired to an unconfigured OAuth client. Verify the release configuration injects the ID and registers the scheme, or hide the button when `googleIosClientID` is empty.
- **OBS-2 — hand-authored pbxproj object IDs.** `project.pbxproj` uses placeholder-shaped IDs (e.g. `P10000000000000000000001` for the stripe-ios package reference) rather than Xcode-generated hex. Builds succeed per device-smoke docs, so this is cosmetic — but expect Xcode to rewrite these IDs on the next GUI edit, producing a noisy diff.

## Registry coverage

| Section | Registry | Items | Applicable | Scored | N/A |
|---|---|---|---|---|---|
| Design | 01-design.md | 22 | 19 | 19 | 3 |
| Privacy & Security | 02-privacy-security.md | 24 | 20 | 20 | 4 |
| System Experiences | 03-system-experiences.md | 26 | 10 | 10 | 16 |
| Intelligence | 04-intelligence.md | 18 | 5 | 5 | 13 |
| Quality | 05-quality.md | 27 | 20 | 20 | 7 |
| Games & Media | 06-games-media.md | 16 | 2 | 2 | 14 |
| Distribution | 07-distribution.md | 18 | 17 | 17 | 1 |
| **Total** | | **151** | **93** | **93** | **58** |

All seven section agents ran to completion; no section skipped. Every cited `IOS-*` ID was grep-verified against the registry files (92 cited IDs, 0 missing).

## Done-when checklist

- [x] All applicable required items scored (93/93 applicable items have a status)
- [x] Every FAIL/GAP has path evidence or explicit "not found in tree"
- [x] Readiness label matches metric rules (3 blocker FAILs on `required` → NOT READY)
- [x] Disclaimer present

## Also run `/app-store-compliance` for

Policy-side residuals surfaced here but owned by the ASR skill: the 3.1.1 free-tier/StoreKit strategy lock, App Review reachability of the release API host (the same `APIBaseURL` issue viewed as ASR 2.1/PRE-05), UGC-moderation review notes, and age-rating honesty. Three prior runs exist under `docs/compliance/app-store-review-2026-07-26*.md` — re-run after the blockers above are fixed.

## Disclaimer

This audit maps product evidence to Apple's published iOS developer documentation
hub and linked guidance. It is not legal advice, not App Review, and does not
guarantee App Store approval or feature eligibility. Docs are living; re-verify
against the canonical URLs before shipping. For rejection-risk policy, use
/app-store-compliance.
