# iOS Developer Documentation Audit

- **Target**: `/Users/nuclearisotope/Projects/Personal/NoMarkup` (native client `ios/NoMarkup`)
- **Date**: 2026-08-22
- **Hub snapshot**: 2026-07-26 — https://developer.apple.com/ios/ (registry age 27 days; no `--refresh-source`; not stale)
- **Platform / stack**: Native SwiftUI · `ios/NoMarkup.xcodeproj` · deployment **iOS 17.0** · Swift **6.0** · dogfood **Xcode 26.5 / iOS 26.5 SDK** · SPM **stripe-ios** only
- **Target SDK bar**: **iOS 27** hub modernization; **iOS 26 SDK** Submit floor (as of 2026-04-28)
- **Depth**: standard (7 section agents; advisory capped)
- **Prior audit**: 2026-08-05 was **READY WITH FOLLOW-UPS**; this re-audit scores **NOT READY**
- **Platform readiness**: **NOT READY**
- **Related**: App Store policy audit separate → `/app-store-compliance` (latest `docs/compliance/app-store-review-2026-08-21.md` is also **NOT READY**)

## Goal (audit)

Map NoMarkup’s native iOS client to Apple’s published iOS developer hub and pathway guidance so the team knows what is platform-ready, what blocks Submit, and what modernization (Liquid Glass, Intelligence) is optional vs required.

## Applicability profile

| Flag | Value | Evidence |
|------|-------|----------|
| `always` | true | App Store–intended native client |
| `native_ios` | true | `ios/NoMarkup.xcodeproj` |
| `swiftui` | true | SwiftUI app + widget |
| `uikit` | false | UIKit for pickers / appearance / OAuth only |
| `cross_platform` / `web_only` | false | Native client (web is a separate surface) |
| `custom_chrome` | true | `BrandTheme`, gold CTAs, custom cards |
| `app_icon` | true | `Assets.xcassets/AppIcon` 1024 + dark + tinted |
| `accounts` | true | Login / register / JWT session |
| `passwords` | true | Email/password + SIWA + Google + Facebook + passkeys |
| `third_party_login` | true | Google / Facebook (config-gated); SIWA always |
| `sensitive_data` | true | PII, payments, location, documents |
| `permissions` | true | Location, camera, photos, Face ID |
| `tracking` | false | No ATT / `NSUserTrackingUsageDescription` |
| `analytics_sdks` | false | `Package.resolved` = stripe-ios only |
| `widgets` | true | `ActiveBidsWidget`, `NextClosingWidget` |
| `live_activities` | true | ActivityKit + `NSSupportsLiveActivities` |
| `notifications` / `push` | true | `PushRegistration` + APNs |
| `app_intents` / `siri` | true | `Intents/` + `NoMarkupAppShortcuts` + Controls |
| `apple_intelligence` / `on_device_ml` / `cloud_llm` | false | No Foundation Models / Core ML / client LLM |
| `accessibility_target` | true | GUI app |
| `localization` | true | `Localizable.xcstrings`; `knownRegions` en / Base / **es** |
| `game` / `metal` / `media_playback` | false | Marketplace utility; `AuctionReplayView` is event list, not A/V |
| `camera` | true | `CameraImagePicker` + purpose string |
| `health` | false | No HealthKit |
| `ipad` | true | `TARGETED_DEVICE_FAMILY` 1,2 + split views |
| `mac_catalyst_or_silicon` | false | `SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = NO` |
| `watch_companion` | false | No watchOS target |
| `app_store_distribution` | true | ASC / TestFlight docs + packaging |
| `subscription_or_iap` | false (scaffold off) | `StoreKitEnabled=false` |

## Executive summary

### Counts

| Bucket | Count |
|--------|------:|
| Registry items | 151 |
| Sections run | 7 |
| Applicable (non-N/A) | 111 |
| **PASS** | **87** |
| **FAIL** (blocker / major / advisory) | **3** (1 blocker, 2 major, 0 advisory) |
| **GAP** | **19** |
| **RISK** | **2** |
| **N/A** | **40** |
| Required **blocker FAIL** | **1** (`IOS-PERF.6`) |
| Required **major FAIL** | **2** (`IOS-A11Y.2`, `IOS-DIST.17`) |
| Privacy/security **RISK** | **1** (`IOS-SEC.9`) |

**Readiness math:** `IOS-PERF.6` is FAIL + blocker + required → **NOT READY**. Independently, `IOS-A11Y.2` and `IOS-DIST.17` are major required FAILs, and `IOS-SEC.9` is a privacy/security RISK (would be **AT RISK** without the blocker).

### Delta vs 2026-08-05

The 2026-08-05 audit closed eng FAILs and labeled **READY WITH FOLLOW-UPS**. This run re-scores three items that now fail closed:

1. **`IOS-PERF.6`** — chat/verification PDF paths still use `Data(contentsOf:)` on the main actor (explicit registry failure mode).
2. **`IOS-A11Y.2`** — residual fixed 42 pt spectator ticker; AX5 still unsigned.
3. **`IOS-DIST.17`** — live DNS for `no-markup.com` still fails (Support URL will  fail in-app Safari and ASC).

Founder ASC / TestFlight / VO / device-matrix work from 2026-08-05 remains open (still GAP).

### Top 5 actions (severity × user impact)

1. **Move PDF reads off the main actor** (`IOS-PERF.6`) — `MessagesView.uploadAndSendPDF` and `VerificationDocumentsView.loadPDF`: after `startAccessingSecurityScopedResource`, read bytes in `Task.detached` / a nonisolated helper, then hop back. This is the only required **blocker FAIL**.
2. **Make Support URL resolve** (`IOS-DIST.17`) — provision DNS/CDN for `https://no-markup.com/support` (in-repo page exists at `web/src/app/(public)/support/page.tsx`). Do not submit while the public host is NXDOMAIN.
3. **Dynamic Type on the spectator price + sign AX5** (`IOS-A11Y.2`) — replace `.system(size: 42)` in `SpectateTerminalView.priceCard` with a scalable text style; allow wrap; human-sign SE at accessibility 5.
4. **Enter ASC App Privacy, age rating, and screenshots** (`IOS-DIST.7` / `.6` / `.5`) — eng manifests and answer sheets exist; portal is empty. `DIST.7` is a Submit **blocker** in practice even though scored GAP (incomplete portal, not a binary contradiction).
5. **VoiceOver + device matrix, then TestFlight** (`IOS-A11Y.1`, `IOS-DIST.2`, `IOS-TEST.2`/`.3`) — sign AX-VO (app + widgets + Live Activity), SE / 13″ iPad / latest iOS; archive with Xcode 26 and upload Internal TestFlight.

### Modernization highlights

| Opportunity | Status |
|-------------|--------|
| Liquid Glass | **PASS** — iOS 26+ scroll-edge chrome + `.glassProminent` CTAs |
| App Intents / Shortcuts / Controls | **PASS** — four shortcuts + Control Center widgets |
| Live Activities + widgets | **PASS** — auction LA + Home/Lock families |
| Foundation Models / Apple Intelligence | **N/A** intentional (`IOS-AI.18` PASS — no false claims) |
| Visual Intelligence over listings | **GAP** opportunity (`IOS-AI.11`) |
| Passkeys | **GAP** — client complete, `passkeys` flag default **false**; no register-time path |

## Findings

PASS findings are counted, not listed (`--verbose` not set). Below: FAIL → RISK → GAP, grouped by section.

### Design (`01-design.md`)

Applicable 18 · PASS 17 · GAP 1 · FAIL 0 · N/A: DES.13, DES.18, DES.21, DES.22

### [IOS-DES.14] Official Apple design resources for marketing frames
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: Prefer official Apple design resources (templates, color guides, icon templates) when producing App Store marketing and iconography.
- Evidence: `docs/compliance/app-store-screenshot-matrix.md` — no production screenshot set committed under `ios/`; founder/ops capture. AppIcon PNGs present (light/dark/tinted); no Icon Composer / current-bezel marketing frames. `ScreenshotWalkUITests` harness exists.
- Remediation: Capture ASC 6.9″ iPhone + 13″ iPad shots with current device templates; keep regulated-rail / IAP frames out.
- Doc: https://developer.apple.com/design/resources/
- Confidence: 9

### Privacy & security (`02-privacy-security.md`)

Applicable 20 · PASS 18 · GAP 1 · RISK 1 · FAIL 0 · N/A: PRI.5, PRI.6, PRI.9, PRI.10

### [IOS-SEC.9] Associated domains not proven live
- Status: RISK
- Severity: major
- Kind: recommended
- Rule: Universal Links / webcredentials / applinks correctly configured for passkeys and deep links.
- Evidence: `ios/NoMarkup/NoMarkup.entitlements` has `applinks:no-markup.com` and `webcredentials:no-markup.com`. In-repo AASA `web/public/.well-known/apple-app-site-association` appID `6L6565278C.com.nomarkup.app`. Live `https://no-markup.com/.well-known/apple-app-site-association` cannot be verified because `no-markup.com` DNS does not resolve (same as DIST.17).
- Remediation: After DNS/CDN, confirm production AASA is HTTPS, `application/json`, Team ID + bundle match, no placeholder TEAMID. Required before passkeys/Universal Links work in the field.
- Doc: https://developer.apple.com/documentation/authenticationservices
- Confidence: 7

### [IOS-SEC.2] Passkey path exists but is not a live sign-in alternative
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Adopt passkeys as a secure alternative to passwords for sign-in; passkeys are phishing-resistant and synced via iCloud Keychain.
- Evidence: `PasskeyAuth.swift` implements `ASAuthorizationPlatformPublicKeyCredentialProvider` assertion + registration against `/api/v1/auth/passkeys/*`. Login + `SecuritySettingsView` enrollment render only when `FeatureFlags.isEnabled("passkeys")` (default **false**). `RegisterView` is password-only; no passkey at account creation.
- Remediation: Enable `passkeys` for production accounts; offer passkey at register or immediate post-signup upgrade. Combine password AutoFill + passkey in one `ASAuthorizationController` when live (`IOS-SEC.3` is PASS for the hidden-until-ready UX).
- Doc: https://developer.apple.com/passkeys
- Confidence: 9

### System experiences (`03-system-experiences.md`)

Applicable 25 · PASS 21 · GAP 4 · FAIL 0 · N/A: SYS.MISC.1 (no App Clip)

### [IOS-SYS.NT.3] Chat alerts lack communication-notification treatment
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Follow HIG for managing notifications: clear title/body, useful actions, appropriate interruption levels.
- Evidence: `PushRegistration.registerNotificationCategories` covers `bid_outbid`, `bid_awarded`, `auction_closing_soon`, `contract_created`. Chat (`MessagesView`, type `new_message`) has no `UNNotificationCategory` and no `INSendMessageIntent` / communication-notification path. Time-sensitive interruption is limited to outbid / closing-soon (`apns.go`).
- Remediation: Register a `new_message` category with useful actions; adopt communication notifications for person-to-person chat if shipping messaging alerts.
- Doc: https://developer.apple.com/design/human-interface-guidelines/managing-notifications
- Confidence: 8

### [IOS-SYS.NT.4] APNs provider is real; Push Console still unproven
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use APNs correctly; validate with Push Notifications Console; monitor delivery metrics.
- Evidence: `services/notification/internal/service/apns.go` token JWT HTTP/2; device register in `PushRegistration`. Entitlements `aps-environment=development` with archive-rewrite comment. `docs/compliance/asc-packaging-checklist.md` still `[~] Founder: Optional push delivery check (ASC Push Console)`.
- Remediation: Make a Push Notifications Console delivery check a packaging step; confirm archived binary `aps-environment=production`.
- Doc: https://developer.apple.com/notifications/push-notifications-console/
- Confidence: 8

### [IOS-INT.3] Assistant intent schemas not adopted
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: Intent schemas let people take action naturally without hard-coded trigger phrases that break as language understanding evolves.
- Evidence: `NoMarkupAppShortcuts.swift` custom `phrases` only; comments that `@AssistantIntent(schema:)` exists on iPhoneOS 26.5 but no commerce/marketplace domain; no `ShowInAppSearchResultsIntent`.
- Remediation: Add in-app search intent + `system.search` schema, or adopt a commerce schema if Apple ships one.
- Doc: https://developer.apple.com/ios/whats-new/
- Confidence: 8

### [IOS-INT.5] App Intents Testing framework missing
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Validate App Intents integration through system pathways (App Intents Testing framework) without relying only on UI automation.
- Evidence: XCTest `AppIntentsAuthGuardTests` / `AppIntentsEntityTests` call `perform()` in-process (`NotificationDeepLinkTests.swift`). `AppIntentsTesting` / IntentTest not found in tree.
- Remediation: Add App Intents Testing framework cases in CI for Siri/Shortcuts invocation.
- Doc: https://developer.apple.com/ios/whats-new/
- Confidence: 8

### Intelligence (`04-intelligence.md`)

Applicable 5 (`always` + App Intents wiring) · PASS 4 · GAP 1 · N/A 13 (no Foundation Models / Core ML / client LLM)

### [IOS-AI.11] Visual Intelligence not adopted on a photo catalog
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: Integrating with Visual Intelligence can surface matching app content when people search the world/screen — evaluate if content catalog fits.
- Evidence: `VisualIntelligence` / `IntentValueQuery` not found. Photo-backed goods catalog (`CreateListingView`, `ListingDetailView`). `JobEntity` / `ListingEntity` exist; no `visualIntelligence` domain wiring.
- Remediation: After entity indexing is solid, evaluate Visual Intelligence `IntentValueQuery` over `ListingEntity` (iOS 27 hub opportunity; not a ship blocker).
- Doc: https://developer.apple.com/documentation/VisualIntelligence/
- Confidence: 8

### Quality (`05-quality.md`)

Applicable 23 · PASS 14 · FAIL 2 · GAP 6 · RISK 1 · N/A: A11Y.5, MP.3, MP.4, MP.5

### [IOS-PERF.6] Main-thread PDF file I/O
- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Do not block the main thread with disk, network, or heavy decode/crypto.
- Evidence: `@MainActor uploadAndSendPDF` in `ios/NoMarkup/Features/MessagesView.swift` (`Data(contentsOf: url)` after security-scoped access; chat attachments up to imaging 10 MB). `VerificationDocumentsView.loadPDF` is a View method doing the same synchronous read before a 10 MB guard. Image pipeline itself is off-main (`ImageUploader`). Registry failure mode matches: “`Data(contentsOf:)` on main for large files; UI freezes.”
- Remediation: After `startAccessingSecurityScopedResource`, read bytes with `Task.detached` / a nonisolated helper, hop back to MainActor for upload + UI. Add a unit/UI test that a 10 MB PDF does not run the read on the main thread.
- Doc: https://developer.apple.com/documentation/xcode/improving-your-app-s-performance
- Confidence: 9

### [IOS-A11Y.2] Dynamic Type residual on spectator price
- Status: FAIL
- Severity: major
- Kind: required
- Rule: Support Dynamic Type so text scales with user settings without truncation of critical content.
- Evidence: Most UI uses text styles (`DollarAmountField` `.title3`; `@ScaledMetric` in `HomeView`/`BrandTheme`). Residual: `SpectateTerminalView.priceCard` `.font(.system(size: 42, weight: .bold, design: .rounded).monospacedDigit())` + `.lineLimit(1)` + `.minimumScaleFactor(0.5)` — does not grow with Dynamic Type. `docs/compliance/device-smoke-checklist.md` **M-AX5** / **AX5** unsigned. No `#Preview` `.dynamicTypeSize(.accessibility5)`.
- Remediation: Use a scalable style (e.g. `.largeTitle.monospacedDigit()`); allow money to wrap; sign AX5 on SE.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 8

### [IOS-PERF.5] Aggressive auction fallback polling
- Status: RISK
- Severity: major
- Kind: recommended
- Rule: Batch network calls; use background transfer appropriately; avoid wake storms.
- Evidence: Chat/auction/spectator use `URLSessionWebSocketTask`. Instant offers poll every 30 s (`ProviderInstantOffersView`). `JobDetailView` live-auction fallback poll **1.5 s** when the socket is not live; 15 s when live; cancelled when inactive.
- Remediation: Raise fallback poll toward 5–10 s or WS-only; keep timers scene-phase gated.
- Doc: https://developer.apple.com/documentation/xcode/improving-your-app-s-performance
- Confidence: 8

### [IOS-A11Y.1] VoiceOver labels in code; human VO pass unsigned
- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Screen readers and accessibility features rely on information your app provides; review labels and focus-based navigation.
- Evidence: Widespread `accessibilityLabel` / `accessibilityHint` / `accessibilityHidden` (`LoginView`, `PaymentMethodsView`, `MarketRangeBar`, widgets). TabAudit/ScreenshotWalk exercise identifiers, not VoiceOver. `docs/compliance/device-smoke-checklist.md` **AX-VO** and `docs/compliance/accessibility-nutrition-claims.md` VoiceOver rows unsigned; no `performAccessibilityAudit` in UITests. Scored GAP (incomplete verification), not FAIL (no unlabeled-control contradiction found).
- Remediation: Run and sign AX-VO on Login, Home, Marketplace, Job/Listing detail, Account, plus widgets/Live Activity; add XCUI accessibility audit on those surfaces.
- Doc: https://developer.apple.com/documentation/accessibility
- Confidence: 8

### [IOS-A11Y.3] Reduce Motion mostly gated; Increase Contrast incomplete
- Status: GAP
- Severity: major
- Kind: required
- Rule: Respect Reduce Motion, Increase Contrast, Reduce Transparency (including Liquid Glass adaptations).
- Evidence: `BrandTheme.animation` / `brandAnimation`, `LivePulseDot`, skeletons, `NoMarkupApp.RootView` gate Reduce Motion; Reduce Transparency in `BrandTheme` and `MessagesView`. `colorSchemeContrast` only in widget brand (`ActiveBidsWidget`, `NextClosingWidget`) — not in app `BrandTheme`. Ungated: `SpectateTerminalView` `.animation(.easeOut(duration: 0.2), value: leadingPriceDisplay)`. **AX-RM** unsigned.
- Remediation: Gate remaining animations; adapt app tokens for Increase Contrast; sign AX-RM; refresh nutrition claims.
- Doc: https://developer.apple.com/ios/
- Confidence: 8

### [IOS-L10N.1] String catalogs exist; Spanish and remaining literals incomplete
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Prepare strings, dates, times, currencies, and numbers via Foundation for languages and regions.
- Evidence: `ios/NoMarkup/Localizable.xcstrings` + widget catalog; `String(localized:)` tabs/plurals; `MoneyFormat.usd`; `Date.formatted`. Gaps: many inline `Text("…")` (`RegisterView`, `ContractDetailView`, `ForgotPasswordView`); English-concatenated `countdownLabel` (`"Ends in \(hours)h"` in `Models.swift`); `knownRegions` includes `es` but only a handful of `es` units.
- Remediation: Extract remaining UI strings; localize countdown with `Duration` / `RelativeDateTimeFormatter`; complete `es` (and plurals) in both catalogs.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 8

### [IOS-L10N.3] es in knownRegions; widget catalog and screenshots not localized
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Localize app resources (images with text, audio) and add them to the Xcode project correctly.
- Evidence: `es` in `project.pbxproj` `knownRegions`; AppIcon not locale-split. Widget `Localizable.xcstrings` has no `es` localizations. Screenshot matrix: no production locale screenshot set.
- Remediation: Finish `es` in app+widget catalogs; capture locale screenshot sets if shipping `es` storefronts. Until then, do not claim Spanish as a shipping locale in ASC.
- Doc: https://developer.apple.com/documentation/xcode/localization
- Confidence: 8

### [IOS-TEST.2] TestFlight process documented; no upload
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use TestFlight for real-device feedback before release when distributing on App Store.
- Evidence: `docs/compliance/testflight-process.md` (eng process Done; ASC record + first archive + internal group = Open founder). `.github/workflows/ios-ci.yml` unit tests only — no TestFlight upload.
- Remediation: Archive with Xcode 26, upload, enable Internal TestFlight group, wire crash feedback.
- Doc: https://developer.apple.com/testflight/
- Confidence: 8

### [IOS-TEST.3] Device/OS matrix unsigned
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Validate on representative devices/OS versions in support matrix (including smaller phones and current OS).
- Evidence: `device-smoke-checklist.md` (M-SE, M-PM, M-IPAD, M-AX5, M-17) unsigned. Partial: Pro Max dogfood `iphone-device-dogfood-2026-08-05.md`; sim walks under `docs/compliance/sim-runs/`. Deployment target iOS 17.0.
- Remediation: Human-sign SE, 13″ iPad portrait/landscape, AX5, and one iOS 17 run.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 8

### Games & media (`06-games-media.md`)

Applicable 2 · PASS 2 (`IOS-MED.5` camera, `IOS-MED.6` no false Pro RAW claims) · N/A 14 (not a game; no Metal; no A/V playback)

### Distribution (`07-distribution.md`)

Applicable 18 · PASS 11 · FAIL 1 · GAP 6

### [IOS-DIST.17] Support URL declared; public host does not resolve
- Status: FAIL
- Severity: major
- Kind: required
- Rule: Provide working Support URL and marketing presence expected for store listing quality.
- Evidence: Locked URL `https://no-markup.com/support` (`AppConfig.supportURL`, Account → Legal `LegalWebView`, `asc-packaging-checklist.md` §2). In-repo page `web/src/app/(public)/support/page.tsx` + `SupportContactForm` + `mailto:support@no-markup.com`. This audit: `no-markup.com` and `www.no-markup.com` **DNS resolution failed**. `DEPLOY_PROVISIONED` unset. In-app Safari will fail until DNS/CDN is live. Matches `app-store-review-2026-08-21.md`.
- Remediation: Provision hyphenated zone `no-markup.com` (Cloudflare) so `/support` returns HTTP 200 with contact; then enter that URL in ASC. Do not ship NXDOMAIN as the Support URL.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 9

### [IOS-DIST.7] Privacy manifest aligned; ASC nutrition label unfilled
- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Enter all necessary privacy practices including third-party partners’ code; required to submit new apps and updates.
- Evidence: `ios/NoMarkup/PrivacyInfo.xcprivacy` + widget manifest: `NSPrivacyTracking=false`; Required Reason UserDefaults CA92.1 / 1C8F.1; collected types include Email, Device ID (linked, not tracking), PaymentInfo, location, UGC. Packing table `asc-packaging-checklist.md` §4.2. Third party: Stripe SPM only. ASC App Privacy: `[~]` founder (`submission-blockers.md` row 5).
- Remediation: Founder type §4.2 into ASC App Privacy (include Stripe as payment partner). Re-sync if SPM adds SDKs. **Submit cannot proceed without this** even though binary is consistent.
- Doc: https://developer.apple.com/app-store/app-privacy-details/
- Confidence: 8

### [IOS-DIST.2] Latest-OS QA not signed across required matrix
- Status: GAP
- Severity: major
- Kind: required
- Rule: Build and test with current Xcode supporting latest SDKs; ensure apps work on devices running latest OS releases.
- Evidence: iPhone 17 Pro Simulator iOS 26.5 (`iphone-simulator-2026-08-21.md`); physical iPhone 15 Pro Max Debug (`iphone-device-dogfood-2026-08-05.md`). Required checklist rows **M-SE, M-IPAD, M-AX5, M-17, Overall** still `[ ]`. No signed iPad-on-latest-OS pass despite universal target.
- Remediation: Human-sign smoke on latest shipping iOS for Pro Max + SE + 13″ iPad; keep one iOS 17.0 floor run per train.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 8

### [IOS-DIST.4] TestFlight documented; no archive uploaded
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use TestFlight for internal/external beta feedback including screenshots with context and crash details before wide release.
- Evidence: `docs/compliance/testflight-process.md`; `launch-board.md` founder rows 4–5 open. No Fastlane upload lane; ios-ci tests only.
- Remediation: Founder: App ID + ASC record → Xcode 26 archive → Upload → Internal TestFlight group.
- Doc: https://developer.apple.com/testflight/
- Confidence: 9

### [IOS-DIST.5] Product-page assets planned; screenshots/keywords not in ASC
- Status: GAP
- Severity: major
- Kind: required
- Rule: App name, icon, description, screenshots, previews, and keywords must be accurate and ready; update subtitle/promotional text thoughtfully.
- Evidence: Identity pack in `asc-packaging-checklist.md` §1 (`NoMarkup`, subtitle “Local jobs & marketplace”). Icon complete. `app-store-screenshot-matrix.md`: capture is founder/ops. Description/keywords `[~]` (`submission-blockers.md` row 3).
- Remediation: Capture 6.9″ + 13″ scenes from the matrix (native chrome only); enter subtitle/description/keywords in ASC.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 9

### [IOS-DIST.6] Age-rating answers drafted; not entered in ASC
- Status: GAP
- Severity: major
- Kind: required
- Rule: Age rating questionnaire must reflect actual content; system updated for more granular ratings on modern OS.
- Evidence: `docs/compliance/asc-content-rating-answers.md`: UGC Yes, messaging Yes, unrestricted web No, 18+ `AgeGateView`, auctions ≠ gambling. Founder checklist `[ ]`. No ASC export in tree.
- Remediation: Paste §2 into ASC Age Rating; keep honest UGC (expect teen/17+ class, not 4+).
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 9

### [IOS-DIST.8] Accessibility Nutrition Label withheld until human AX
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Share accurate accessibility support (VoiceOver, Voice Control, Larger Text, Captions, etc.) for product page labels; optional detail URL.
- Evidence: `docs/compliance/accessibility-nutrition-claims.md` withholds Larger Text / Reduced Motion / Voice Control; VoiceOver claim gated on unsigned VO pass. Correct non-overclaim posture.
- Remediation: Sign VoiceOver (app + widgets/LA) then declare VoiceOver only; do not overclaim.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 8

## Out-of-registry observations

### [OBS-1] Archive lint path
`Info.plist` comments and the privacy agent referred to `ios/scripts/ios-archive-lint.sh`. The gate actually lives at repo-root **`scripts/ios-archive-lint.sh`** (executable; used by `make ios-archive` / prior remediations). Release ATS remains PASS (`IOS-SEC.5`). Restore a scheme Pre-Action / CI call if Archive is not already wired.

### [OBS-2] App Review is a separate blocker set
`/app-store-compliance` on 2026-08-21 scored **NOT READY** (ops/ASC, UGC/age, regulated rails seed-on). This skill does not duplicate `ASR-*` IDs. Re-run `/app-store-compliance` immediately before first binary submit.

### [OBS-3] Passkeys vs production domain
Even if `passkeys` is flipped on, `webcredentials:no-markup.com` cannot work until DNS + AASA are live (`IOS-SEC.9` + `IOS-DIST.17`).

## Registry coverage

| Section | Run | Items | Applicable | PASS | FAIL | GAP | RISK | N/A |
|---------|-----|------:|-----------:|-----:|-----:|----:|-----:|----:|
| design | yes | 22 | 18 | 17 | 0 | 1 | 0 | 4 |
| privacy | yes | 24 | 20 | 18 | 0 | 1 | 1 | 4 |
| system | yes | 26 | 25 | 21 | 0 | 4 | 0 | 1 |
| intelligence | yes | 18 | 5 | 4 | 0 | 1 | 0 | 13 |
| quality | yes | 27 | 23 | 14 | 2 | 6 | 1 | 4 |
| games-media | yes | 16 | 2 | 2 | 0 | 0 | 0 | 14 |
| distribution | yes | 18 | 18 | 11 | 1 | 6 | 0 | 0 |
| **Total** | **7** | **151** | **111** | **87** | **3** | **19** | **2** | **40** |

All FAIL/GAP/RISK IDs exist in `references/*.md`. No PASS with empty evidence.

## Remediation plan (not implemented)

Grouped PR-sized slices. Do not implement unless asked.

| Workstream | Slice | IDs |
|------------|-------|-----|
| Performance | Off-main PDF read helper used by chat + verification | PERF.6 |
| Performance | Raise JobDetail fallback poll ≥5 s | PERF.5 |
| Accessibility | Scalable spectator price + AX5 preview | A11Y.2 |
| Accessibility | App Increase Contrast tokens + gate remaining animation | A11Y.3 |
| Accessibility | XCUI `performAccessibilityAudit` + signed AX-VO | A11Y.1 |
| Localization | Extract remaining literals; complete `es` or drop from `knownRegions` | L10N.1, L10N.3 |
| Auth | Enable `passkeys` + register-time path once AASA is live | SEC.2, SEC.9 |
| Notifications | `new_message` category / communication notifications | SYS.NT.3 |
| Intents | App Intents Testing framework | INT.5 |
| Ops / founder | DNS + Support 200; ASC privacy/age/screenshots; TestFlight | DIST.17, DIST.7, DIST.6, DIST.5, DIST.4, DIST.2 |

## Done-when checklist

- [x] All applicable required items scored
- [x] Every FAIL/GAP has path evidence or explicit “not found”
- [x] Readiness label matches metric rules (`IOS-PERF.6` blocker required FAIL → NOT READY)
- [x] Disclaimer present

## Disclaimer

This audit maps product evidence to Apple’s published iOS developer documentation
hub and linked guidance. It is not legal advice, not App Review, and does not
guarantee App Store approval or feature eligibility. Docs are living; re-verify
against the canonical URLs before shipping. For rejection-risk policy, use
/app-store-compliance.
