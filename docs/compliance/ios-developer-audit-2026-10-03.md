# iOS Developer Documentation Audit

- **Target**: `/Users/nuclearisotope/Projects/Personal/NoMarkup` (native SwiftUI app `ios/NoMarkup`, bundle `com.nomarkup.app`, widget `com.nomarkup.app.widget`)
- **Date**: 2026-10-03
- **Hub snapshot**: 2026-07-26 — https://developer.apple.com/ios/
- **Snapshot age**: 69 days (under the 90-day refresh threshold). No hub refetch. Registries were not rewritten.
- **Platform / stack**: Native iOS, SwiftUI. UIKit is Safari, camera, share sheet, and bar appearance only. Deployment target 17.0. `TARGETED_DEVICE_FAMILY` `1,2`.
- **Target SDK bar**: ios27 (modernization). Submit floor is the iOS 26 SDK (`IOS-DIST.1`), which this tree builds with Xcode 26.5. Those are different bars.
- **Platform readiness**: **AT RISK**
- **Commit scored**: `ecedf67d` on `fix/security-audit-2026-04-23`
- **Related**: App Store policy audit is a separate report: `docs/compliance/app-store-review-2026-10-03.md` (**NOT READY**). This file does not rescore `ASR-*` items.
- **Method**: Seven read-only section agents, one registry each. The Design and Quality agents treated `permissions` and `app_store_distribution` as false. The profile sets both true. Orchestrator rescored `IOS-DES.8`, `IOS-DES.14`, `IOS-A11Y.6`, and `IOS-TEST.2`. Orchestrator DNS on 2026-10-03 (`getaddrinfo` errno 8) is the evidence for `IOS-PRI.2` and `IOS-DIST.17`. The section agents did not re-probe DNS.

Readiness is **AT RISK**, not **NOT READY**. There is no blocker FAIL on a required item. There is a major FAIL on required `IOS-DIST.17`, and RISK on privacy items `IOS-PRI.2` and `IOS-SEC.9`. `IOS-DIST.7` is a blocker-severity GAP (App Store Connect cannot accept a submission without the privacy label). A GAP is not a FAIL, so it does not upgrade the label to NOT READY. Required and recommended majors also have GAPs, so the label is not READY.

## Goal (audit)

Map the iOS binary to Apple’s iOS developer documentation hub so the team knows what blocks a quality submission, what to modernize, and what to leave off until DNS and flags exist.

## Applicability profile

| Flag | Value | Evidence |
|---|---|---|
| always, native_ios, swiftui | true | `ios/NoMarkup.xcodeproj`, SwiftUI screens |
| custom_chrome, app_icon | true | `BrandTheme.applyGlobalChrome()`, `AppIcon.appiconset` |
| accounts, passwords, third_party_login | true | Login, Keychain, Sign in with Apple, Google, Facebook |
| sensitive_data, permissions | true | Account, phone, location, photos, camera, Face ID purpose strings |
| widgets, live_activities, notifications, push | true | Widget extension, `AuctionActivityAttributes`, `PushRegistration` |
| app_intents, siri | true | `SearchNoMarkupIntent`, `NoMarkupAppShortcuts` |
| accessibility_target | true | Accessibility modifiers and `docs/compliance/accessibility-nutrition-claims.md` |
| camera | true | `CameraImagePicker`, `NSCameraUsageDescription` |
| app_store_distribution | true | Intended App Store binary; ASC drafts under `docs/compliance/` |
| subscription_or_iap | true (pointer) | `StoreKitProductIDs` present; `StoreKitEnabled` false. No purchase UI scored as a platform feature |
| ipad | true | `TARGETED_DEVICE_FAMILY = "1,2"` |
| localization | true | Leftover `es` units in string catalogs. `knownRegions` is still `en` + `Base` (`project.pbxproj`) |
| uikit (primary), cross_platform, web_only | false | Native SwiftUI |
| tracking, analytics_sdks | false | No IDFA. Only SPM pin is stripe-ios 24.25.0. `ClientActionLog` stays on device |
| apple_intelligence, on_device_ml, cloud_llm | false | No Foundation Models, Core ML, or iOS LLM client |
| game, metal, media_playback | false | No Metal game, no `AVPlayer` |
| health, mac_catalyst_or_silicon, watch_companion | false | No HealthKit, Mac, or watch target |

## Executive summary

| Metric | Count |
|---|---|
| Registry items | 151 |
| Scored PASS / FAIL / GAP / RISK | 110 |
| PASS | 80 |
| Blocker FAIL | 0 |
| Major FAIL | 1 |
| Advisory FAIL | 1 |
| RISK | 2 |
| GAP | 26 |
| N/A | 41 |
| Platform readiness | **AT RISK** |

GAP severity: 1 blocker (`IOS-DIST.7`), 21 major, 4 advisory.

### Top 5 actions

1. Publish `https://no-markup.com/support` and `https://no-markup.com/privacy`. On 2026-10-03, `no-markup.com`, `www.no-markup.com`, and `api.no-markup.com` do not resolve (`IOS-DIST.17`, `IOS-PRI.2`).
2. Enter the App Privacy nutrition label in App Store Connect so it matches the app and widget manifests plus Stripe’s product-interaction row (`IOS-DIST.7`).
3. Sign the device matrix (SE, Pro Max, 13″ iPad, AX5 text, iOS 17 floor). Do not claim Larger Text while prices and titles use `lineLimit(1)` (`IOS-DIST.2`, `IOS-A11Y.2`, `IOS-TEST.3`, `IOS-DIST.8`).
4. Archive with Xcode 26.5 and open an internal TestFlight group. Process docs exist. No upload does (`IOS-DIST.4`, `IOS-TEST.2`).
5. Remove user-facing `FR-` tokens, “Positions blotter”, “Request log”, and “DESK LIVE”. Leave the `passkeys` flag off until `webcredentials:no-markup.com` resolves (`IOS-DES.16`, `IOS-SEC.2`, `IOS-SEC.9`).

Also before a wide release: send Live Activity price updates with `leading_bid_cents` and `ends_at` (`IOS-SYS.LA.2`), and call `clearBadge()` inside `signOut` (`IOS-SYS.NT.5`). Product page screenshots, subtitle, description, and the age-rating questionnaire are still drafts (`IOS-DIST.5`, `IOS-DIST.6`).

### Modernization highlights

Liquid Glass is on some bid CTAs only. The app icon has light, dark, and tinted art, and no clear / Icon Composer slot. Foundation Models and a full Visual Intelligence catalog are optional. The iOS 27 SDK is a follow-up (`IOS-TEST.4`). It is not the submit floor.

### Policy themes (other report)

Listing-promotion checkout, UGC filter and block holes, What’s New fee language, and NPS / chat lock-screen text are scored in `docs/compliance/app-store-review-2026-10-03.md`. They are not repeated as `IOS-*` findings.

## Findings

Ordered major FAIL, advisory FAIL, privacy RISK, then GAP (blocker, required major, other major, advisory). PASS is a count plus an ID index in Registry coverage.

### Distribution

### [IOS-DIST.17] Support URL and marketing site
- Status: FAIL
- Severity: major
- Kind: required
- Rule: Provide a working Support URL and the marketing presence expected for store listing quality.
- Evidence: `AppConfig.supportURL` is `https://no-markup.com/support` (`ios/NoMarkup/Core/AppConfig.swift`). Account opens it through `LegalWebView`, which falls back to mailto `support@no-markup.com`. The in-repo page is `web/src/app/(public)/support/page.tsx`. Orchestrator DNS on 2026-10-03: `no-markup.com`, `www.no-markup.com`, and `api.no-markup.com` return `getaddrinfo` errno 8. The section agent did not re-probe.
- Remediation: Publish the hyphenated zone so `/support` returns a contact path, then enter that URL in App Store Connect. Do not submit while the host does not resolve. Keep the in-app mailto.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 9

### [IOS-DIST.7] App privacy details (nutrition label)
- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Enter all necessary privacy practices, including third-party partners’ code. Required to submit new apps and updates.
- Evidence: Manifests are in the targets: `ios/NoMarkup/PrivacyInfo.xcprivacy` and `ios/NoMarkupWidget/PrivacyInfo.xcprivacy` (`NSPrivacyTracking` false; UserDefaults reasons; linked non-tracking types). The only third-party SDK is stripe-ios 24.25.0 (`Package.resolved`). Roll-up is `docs/compliance/asc-packaging-checklist.md` §4.2. App Store Connect entry is still founder-only (`docs/compliance/submission-blockers.md` row 5). Name and phone purposes drift: the manifest adds Account Management; §4.2 lists App Functionality only.
- Remediation: Type the roll-up into App Store Connect App Privacy, including Stripe, and align name and phone purposes with the manifest. Submit cannot proceed without the portal label.
- Doc: https://developer.apple.com/app-store/app-privacy-details/
- Confidence: 8

### [IOS-DIST.2] Latest-OS device testing
- Status: GAP
- Severity: major
- Kind: required
- Rule: Build and test with current Xcode supporting the latest SDKs, and make sure the app works on devices running the latest OS.
- Evidence: Dogfood notes cite Xcode 26.5 (`docs/compliance/device-test-run-2026-07-26.md`). `docs/compliance/device-smoke-checklist.md` rows M-SE, M-PM, M-IPAD, M-AX5, M-17, and Overall are unsigned. CI (`.github/workflows/ios-ci.yml`) runs `NoMarkupTests` on the iPhone 16 simulator.
- Remediation: Human-sign the latest shipping iOS on SE, Pro Max, and 13″ iPad, plus one iOS 17.0 floor run.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 8

### [IOS-DIST.5] Product page metadata
- Status: GAP
- Severity: major
- Kind: required
- Rule: App name, icon, description, screenshots, previews, and keywords must be accurate and ready.
- Evidence: Icon and display name exist (`AppIcon.appiconset`, `Info.plist` `NoMarkup`). Subtitle, categories, and description are a plan in `docs/compliance/asc-packaging-checklist.md` §1. `docs/compliance/app-store-screenshot-matrix.md` says there is no production screenshot set. No `fastlane/metadata`.
- Remediation: Enter name, subtitle, description, and keywords in App Store Connect. Capture and upload the 6.9″ iPhone and 13″ iPad sets from the matrix.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 9

### [IOS-DIST.6] Age ratings
- Status: GAP
- Severity: major
- Kind: required
- Rule: The age-rating questionnaire must reflect actual content.
- Evidence: Draft only: `docs/compliance/asc-content-rating-answers.md` (UGC, messaging, 18+ `AgeGateView`, not Kids). Founder checklist unchecked. No App Store Connect export in the repo.
- Remediation: Paste the draft into App Store Connect Age Rating. Keep UGC honest.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 9

### [IOS-DIST.4] TestFlight
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use TestFlight for internal and external beta feedback before a wide release.
- Evidence: `docs/compliance/testflight-process.md` records the process. The App Store Connect record, first archive, and internal group are still open. `ios-ci.yml` runs unit tests, not an upload. `docs/compliance/submission-blockers.md` row 2 is open.
- Remediation: Create the App ID and App Store Connect record, archive with Xcode 26.5, upload, and enable an internal group.
- Doc: https://developer.apple.com/testflight/
- Confidence: 9

### [IOS-DIST.8] Accessibility Nutrition Label
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Share accurate accessibility support on the product page.
- Evidence: `docs/compliance/accessibility-nutrition-claims.md` withholds Larger Text, Dark Interface, Reduced Motion, and Voice Control. VoiceOver is “claim only after” an unsigned device pass. Nothing has been entered in App Store Connect, so there is no overclaim on the store page yet.
- Remediation: Sign VoiceOver on the app, widgets, and Live Activity, then declare VoiceOver only. Do not declare Larger Text until `IOS-A11Y.2` is closed.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 8

### Design

### [IOS-DES.16] Requirement IDs and trading jargon in user-facing labels
- Status: FAIL
- Severity: advisory
- Kind: recommended
- Rule: Name features in user language. Do not leave internal codenames in the UI.
- Evidence: User-visible strings: `OnboardingWizardView.swift` address step “(FR-1.3)”; `NotificationPreferencesView.swift` footer “(FR-17.3)”; `ContractDetailView.swift` review footer “(FR-6.2)”; `PropertiesView.swift` footer “PRD FR-19.2”. Account row “Positions blotter” and “Request log” (`AccountView.swift`, `ClientActionLogView.swift`). Home shows “DESK LIVE” / “DESK OFFLINE” plus `AppConfig.apiBaseHostDisplay`, and `revisionFooter` prints version and a short git SHA (`HomeView.swift`, `AppConfig.revisionFooterLabel`).
- Remediation: Delete the `FR-` / `PRD` tokens. Rename “Positions blotter” to the hint’s language (“Open bids and watchlist”). Gate “Request log”, “DESK LIVE”, the API host, and the git SHA behind a debug or admin build.
- Doc: https://developer.apple.com/ios/whats-new/
- Confidence: 9

### [IOS-DES.4] Liquid Glass only on some CTAs
- Status: GAP
- Severity: major
- Kind: opportunity
- Rule: Adopt Liquid Glass for controls that hug content. System bars should use system materials when targeting the current SDK.
- Evidence: `GlassProminentBrandCTAStyle` uses `.glassProminent` under `#available(iOS 26.0, *)` (`BrandTheme.swift`). Call sites are bid and submit. Home primary actions still use `brandPrimaryButton()`. `applyGlobalChrome()` calls `configureWithOpaqueBackground()` on the tab bar. `glassEffect` / `scrollEdgeEffect` were not found. Deployment target is 17.0.
- Remediation: Keep cards and lists opaque. On iOS 26+, use system glass for floating controls over scrolling content, including home post and sell, and stop forcing an opaque tab-bar `standardAppearance` where the system scroll-edge material should show.
- Doc: https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass
- Confidence: 8

### [IOS-DES.6] App icon has no clear or layered slot
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Ship an app icon with the current light, dark, tinted, and clear (Liquid Glass layered) appearances when those slots apply.
- Evidence: `AppIcon.appiconset/Contents.json` declares universal 1024, luminosity dark, and luminosity tinted. No `clear` appearance and no Icon Composer `.icon`. SF Symbols are used for tab and toolbar actions.
- Remediation: Add an iOS 26+ layered icon with a clear appearance, or add a `clear` luminosity image. Keep the existing dark and tinted art.
- Doc: https://developer.apple.com/design/
- Confidence: 8

### [IOS-DES.14] App Store marketing templates
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: Prefer official Apple design resources when producing App Store marketing and iconography.
- Evidence: Orchestrator rescore. `app_store_distribution` is true. `docs/compliance/app-store-screenshot-matrix.md` records no production screenshot set. The Design agent had marked this N/A.
- Remediation: Capture store screenshots from the current device templates in that matrix before upload.
- Doc: https://developer.apple.com/design/resources/
- Confidence: 8

### [IOS-DES.8] Personal-data permission timing
- Status: PASS
- Severity: major
- Kind: required
- Rule: When using personal data or motion sensors, request access in context and respect the user’s choice.
- Evidence: Orchestrator rescore. `permissions` is true. `NoMarkupApp.swift` does not request location, camera, or notifications at launch. Map pre-prompt is `JobsMapView.swift`. Camera uses `CameraAuthorization.prepareToPresent()`. Push uses a value-moment pre-prompt in `PushRegistration.swift`. Denied states open Settings or offer a library fallback. The Design agent had marked this N/A.
- Remediation: None.
- Doc: https://developer.apple.com/design/human-interface-guidelines/designing-for-ios
- Confidence: 9

### Privacy and security

### [IOS-PRI.2] Privacy statement
- Status: RISK
- Severity: blocker
- Kind: required
- Rule: If you collect data, offer a privacy statement that explains what you collect and how you use it.
- Evidence: The policy text is `web/src/app/(public)/privacy/page.tsx`. The app link is `AppConfig.privacyURL` → `https://no-markup.com/privacy`, opened by `LegalWebView.swift`, which shows “Can't load page” when DNS fails and does not bundle the policy. Orchestrator DNS on 2026-10-03: `no-markup.com` does not resolve. The section agent did not re-probe (its confidence was 7).
- Remediation: Ship an in-app copy of the policy, or serve this document at the public URL before release. A dead host cannot be the only privacy statement.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 9

### [IOS-SEC.9] Associated domains
- Status: RISK
- Severity: major
- Kind: recommended
- Rule: Universal Links and `webcredentials` must be configured for passkeys and deep links.
- Evidence: `NoMarkup.entitlements` has `applinks:no-markup.com` and `webcredentials:no-markup.com`. In-repo AASA is `web/public/.well-known/apple-app-site-association` (team `6L6565278C.com.nomarkup.app`). `DeepLinkRouter.swift` handles the paths. Live AASA cannot be fetched while the host does not resolve (same DNS probe as `IOS-PRI.2`).
- Remediation: After DNS exists, verify `https://no-markup.com/.well-known/apple-app-site-association`, then enable the `passkeys` flag.
- Doc: https://developer.apple.com/documentation/authenticationservices
- Confidence: 8

### [IOS-SEC.2] Passkeys
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Adopt passkeys as a phishing-resistant alternative to passwords.
- Evidence: Register and assert exist in `ios/NoMarkup/Auth/PasskeyAuth.swift`. `PasskeyAuth.isEnabled` is false when the `passkeys` flag is absent (`FeatureFlags.swift`). The server flag is seeded disabled (`database/migrations/118_passkey_credentials.up.sql`).
- Remediation: Turn the flag on only after `webcredentials` is live. Until then, new accounts use a password plus Sign in with Apple.
- Doc: https://developer.apple.com/passkeys
- Confidence: 9

### System experiences

### [IOS-SYS.NT.5] Accurate, clearable badges
- Status: GAP
- Severity: major
- Kind: required
- Rule: Badge counts must stay accurate and clearable.
- Evidence: `PushRegistration.reconcileBadgeFromServer` sets the icon from server unread and clears on 401. Mark-all-read clears in `NotificationsView.swift`. `AuthViewModel.signOut` calls `PushRegistration.shared.resetSessionState()` and does not call `clearBadge()`. `RootTabView` clears only while that shell is on screen.
- Remediation: Call `clearBadge()` in `signOut` before the signed-in view is torn down.
- Doc: https://developer.apple.com/notifications/
- Confidence: 8

### [IOS-SYS.LA.2] Live Activity glance content
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Live Activity content must stay timely at a glance.
- Evidence: Lock Screen and Dynamic Island layouts are in `ios/NoMarkupWidget/AuctionLiveActivityWidget.swift`. `buildLiveActivityContentState` returns false for non-end events unless both `leading_bid_cents` and `ends_at` are present (`services/notification/internal/service/service.go`). Outbid and closing payloads often omit those fields (`listing_scheduler.go`). The countdown can tick locally. The leading amount stays stale while the app is suspended.
- Remediation: Copy the amount and auction end time into the notification data map so the content-state update is real.
- Doc: https://developer.apple.com/design/human-interface-guidelines/live-activities/
- Confidence: 9

### [IOS-SYS.NT.3] Notification actions and interruption levels
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Follow the notification HIG: clear title and body, useful actions, appropriate interruption levels.
- Evidence: Categories and View actions are registered in `PushRegistration.swift`. `apns.go` uses time-sensitive for outbid and closing-soon. `NoMarkup.entitlements` has no `com.apple.developer.usernotifications.time-sensitive`. `new_message` is not a communication notification.
- Remediation: Add the Time Sensitive Notifications capability. For chat, adopt communication notifications, or keep the current action and do not claim People or Focus treatment.
- Doc: https://developer.apple.com/design/human-interface-guidelines/managing-notifications
- Confidence: 8

### [IOS-SYS.NT.4] APNs provider and Push Console
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use APNs correctly, validate with Push Notifications Console, and monitor delivery.
- Evidence: Token auth, sandbox versus production host, and stale-token pruning are in `services/notification/internal/service/apns.go`. Metrics cover pruned tokens and cooldown skips. No ops doc uses the Push Notifications Console. The committed entitlement `aps-environment` is `development`.
- Remediation: Add a Push Console check to the release checklist and a send success or failure counter. Confirm the archived binary’s `aps-environment` is production.
- Doc: https://developer.apple.com/notifications/push-notifications-console/
- Confidence: 8

### [IOS-INT.2] Entity schemas and Spotlight index
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Entity schemas should contribute content to the Spotlight semantic index, with deletion when content goes away.
- Evidence: `JobEntity` and `ListingEntity` conform to `IndexedEntity` (`NoMarkupAppShortcuts.swift`). Nothing calls `CSSearchableIndex.indexAppEntities`. Detail views donate `NSUserActivity`. `SpotlightIndex.deleteAll` runs on sign-out.
- Remediation: Donate and delete app entities with `indexAppEntities` when a job or listing is shown or removed, using the same identifiers as `SpotlightIndex`.
- Doc: https://developer.apple.com/ios/whats-new/
- Confidence: 9

### [IOS-INT.6] Shortcuts parameter summaries
- Status: GAP
- Severity: advisory
- Kind: recommended
- Rule: App Intent results and parameter summaries should be meaningful in Shortcuts.
- Evidence: `CheckInToJobIntent` has `parameterSummary` and a dialog. `OpenWatchlistIntent.perform` and `OpenPostJobIntent.perform` return `.result()` with no dialog and no value.
- Remediation: Return a short dialog from the watchlist and post-job intents.
- Doc: https://developer.apple.com/design/human-interface-guidelines/app-shortcuts
- Confidence: 9

### Intelligence

### [IOS-AI.1] App Intents without Foundation Models
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: Integrate actions into system intelligence via App Intents, and add Foundation Models where that helps.
- Evidence: App Intents ship (`NoMarkupAppShortcuts.swift`, `SearchNoMarkupIntent.swift`, post, bids, watchlist, check-in). No `import FoundationModels` under `ios/NoMarkup`. No iOS cloud LLM client. User-facing copy does not say “Apple Intelligence” (`IOS-AI.18` PASS).
- Remediation: Optional. If drafting job or listing copy, add a Foundation Models session with an availability check and a normal form fallback. Do not block ship on it.
- Doc: https://developer.apple.com/apple-intelligence/
- Confidence: 8

### [IOS-AI.11] Visual Intelligence handoff is not a catalog search
- Status: GAP
- Severity: advisory
- Kind: opportunity
- Rule: Visual Intelligence can surface matching app content when people search the world or the screen.
- Evidence: `ListingVisualIntelligence.swift` opens marketplace search from semantic labels. Inline matching uses `ListingEntityQuery.suggestedEntities()` (the bid snapshot). The file states there is no on-device catalog image index. `pixelBuffer` is unused.
- Remediation: Optional. Keep the open-in-app handoff. If inline results should include goods the person is not already bidding on, query a public listing index. Do not claim image search.
- Doc: https://developer.apple.com/documentation/VisualIntelligence/
- Confidence: 8

### Quality

### [IOS-A11Y.2] Dynamic Type without truncating critical text
- Status: GAP
- Severity: major
- Kind: required
- Rule: Support Dynamic Type so text scales without truncating critical content.
- Evidence: Body copy uses text styles and `@ScaledMetric`. Critical rows still use `lineLimit(1)` plus `minimumScaleFactor` (prices and titles in `MarketplaceView.swift`, `HomeView.swift`, `AccountView.swift`). `DeviceCapabilityUITests.shouldIgnoreAccessibilityIssue` ignores “dynamic type font sizes are partially unsupported” and “text clipped”. `docs/compliance/device-smoke-checklist.md` row M-AX5 is unsigned.
- Remediation: Stop waiving Dynamic Type and clip findings. Let prices, titles, and primary chips wrap at AX5. Sign the SE AX5 row before claiming Larger Text.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 8

### [IOS-A11Y.6] Accessibility Nutrition Label accuracy
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Be prepared to declare VoiceOver, Voice Control, Larger Text, and captions accurately in App Store Connect.
- Evidence: Orchestrator rescore. `app_store_distribution` is true. `docs/compliance/accessibility-nutrition-claims.md` withholds Larger Text, Dark Interface, Reduced Motion, and Voice Control. App Store Connect has not been filled. The Quality agent had marked this N/A. Overlaps `IOS-DIST.8`. Both IDs stay.
- Remediation: Declare only features whose device passes are signed. Do not claim Larger Text until `IOS-A11Y.2` is closed.
- Doc: https://developer.apple.com/ios/submit/
- Confidence: 8

### [IOS-L10N.1] Foundation strings, dates, and currency
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Prepare strings, dates, times, currencies, and numbers via Foundation.
- Evidence: `Localizable.xcstrings` has 1555 keys (source `en`). Money uses `Decimal.formatted(.currency(code: "USD"))`. Some sentences are still concatenated in English (`MarketRangeBar.disclaimerText`, `ProviderWorkspaceView` “Portfolio saved (…)”). The app catalog has 15 `es` translations of 1555 keys.
- Remediation: Move composed sentences into catalog strings with positional arguments. Do not treat the 15 Spanish strings as a shipped locale.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 8

### [IOS-L10N.3] Localized resources in the Xcode project
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Localize resources and add them to the Xcode project correctly.
- Evidence: Widget catalog has 31 translated `es` units of 35 keys. The app catalog has 15. `knownRegions` is `en` and `Base` only, with the comment that incomplete `es` was removed (`project.pbxproj`). `ios/README.md` says v1 ships English only. Those Spanish strings do not ship. The app icon is a graphic “N”.
- Remediation: Delete the leftover `es` units so the tree matches the English-only decision, or add `es` to `knownRegions` only after the app catalog and screenshots are complete.
- Doc: https://developer.apple.com/documentation/xcode/localization
- Confidence: 9

### [IOS-TEST.1] Automated tests for critical paths
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Maintain automated tests for critical paths.
- Evidence: `ios/NoMarkupTests` covers money, dates, API base, deep links, image downsample, plurals, and widget snapshots. CI runs that target. `NoMarkupUITests` exist and are commented out of CI. No unit target covers PaymentSheet or checkout.
- Remediation: Keep the unit-test CI gate. Add a hosted test or a CI-stable UI smoke for sign-in and the buy-now pay path, or document why those stay manual.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 8

### [IOS-TEST.2] TestFlight before App Store release
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use TestFlight for real-device feedback before release when distributing on the App Store.
- Evidence: Orchestrator rescore. `app_store_distribution` is true. `docs/compliance/testflight-process.md` exists. No archive, upload, or internal group is recorded. The Quality agent had marked this N/A. Overlaps `IOS-DIST.4`. Both IDs stay.
- Remediation: Upload an Xcode 26.5 archive to an internal TestFlight group before a wide release.
- Doc: https://developer.apple.com/testflight/
- Confidence: 9

### [IOS-TEST.3] Device and OS matrix
- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Validate on representative devices and OS versions, including smaller phones and the current OS.
- Evidence: `docs/compliance/device-smoke-checklist.md` lists SE, Pro Max, 13″ iPad, AX5, and the iOS 17 floor. `ios/README.md` says the human device pass is pending. Every sign-off cell is empty.
- Remediation: Execute and sign M-SE, M-PM, M-IPAD, M-AX5, and M-17.
- Doc: https://developer.apple.com/ios/get-started/
- Confidence: 9

### [IOS-TEST.4] Current Xcode for the ios27 bar
- Status: GAP
- Severity: advisory
- Kind: recommended
- Rule: Develop with a current Xcode that supports the target SDK.
- Evidence: CI and local builds use Xcode 26 (`XCODE_MAJOR: "26"`, `Xcode-26.5.0`, simulator SDK 26.5). `LastUpgradeCheck` is 1640. That meets the iOS 26 submit floor (`IOS-DIST.1` PASS). It is not the iOS 27 modernization bar for this audit.
- Remediation: When an Xcode that ships the iOS 27 SDK is the dogfood pin, move CI to it and re-run the unit-test job. Do not treat this GAP as a submit blocker under `IOS-DIST.1`.
- Doc: https://developer.apple.com/ios/resources/
- Confidence: 8

## Out-of-registry observations

None scored. Local UI-action logging (`ActionAuditProbe`) is covered by the App Store report, not by an `IOS-*` item.

## Registry coverage

Counts after the four rescores. N/A is excluded from PASS.

| Section | Registry | PASS+FAIL+GAP+RISK | PASS | FAIL | GAP | RISK | N/A |
|---|---:|---:|---:|---:|---:|---:|---:|
| Design | 22 | 18 | 14 | 1 | 3 | 0 | 4 |
| Privacy & security | 24 | 19 | 16 | 0 | 1 | 2 | 5 |
| System experiences | 26 | 25 | 19 | 0 | 6 | 0 | 1 |
| Intelligence | 18 | 5 | 3 | 0 | 2 | 0 | 13 |
| Quality | 27 | 23 | 15 | 0 | 8 | 0 | 4 |
| Games & media | 16 | 2 | 2 | 0 | 0 | 0 | 14 |
| Distribution | 18 | 18 | 11 | 1 | 6 | 0 | 0 |
| Total | 151 | 110 | 80 | 2 | 26 | 2 | 41 |

80 + 2 + 26 + 2 + 41 = 151.

PASS index (one path each; full schema omitted):

- Design: `IOS-DES.1` HomeView hero; `IOS-DES.2` JobsView filters; `IOS-DES.3` BrandTheme adaptive colors; `IOS-DES.5` RootTabView; `IOS-DES.7` PropertiesView context menu; `IOS-DES.8` (rescore) launch does not prompt; `IOS-DES.9` brandNavigationBarChrome; `IOS-DES.10` system tabs; `IOS-DES.11` catalog search; `IOS-DES.12` NavigationSplitView; `IOS-DES.15` onboarding SF Symbols; `IOS-DES.17` List catalogs; `IOS-DES.19` CLAUDE.md §4; `IOS-DES.20` no lorem.
- Privacy: `IOS-PRI.1` LoginView; `IOS-PRI.3` Info.plist purpose strings; `IOS-PRI.4` contextual prompts; `IOS-PRI.6` stripe-ios only; `IOS-PRI.7` PrivacyInfo.xcprivacy; `IOS-PRI.8` PhotosPicker; `IOS-PRI.11` AccountDeletionView; `IOS-SEC.1` KeychainTokenStore; `IOS-SEC.3` password AutoFill; `IOS-SEC.4` keychain tokens; `IOS-SEC.5` Release ATS; `IOS-SEC.6` Sign in with Apple; `IOS-SEC.7` BiometricGate; `IOS-SEC.8` CryptoKit; `IOS-SEC.10` ClientActionLog; `IOS-SEC.13` AfterFirstUnlockThisDeviceOnly.
- System: `IOS-SYS.LA.1` AuctionActivityAttributes; `IOS-SYS.LA.3` per-activity liveactivity push; `IOS-SYS.LA.4` start on bid; `IOS-SYS.WD.1`–`WD.5` Active Bids and Next Closing; `IOS-SYS.NT.1` promo caps; `IOS-SYS.NT.2` value-moment prompt; `IOS-SYS.NT.6` default sound omitted for promo; `IOS-INT.1` system.search; `IOS-INT.3` schema intent; `IOS-INT.4` appEntityIdentifier; `IOS-INT.5` AppIntents tests; `IOS-INT.7` post and check-in intents; `IOS-INT.8` no legacy SiriKit; `IOS-SYS.MISC.2` Control Center controls; `IOS-SYS.MISC.3` no UIBackgroundModes.
- Intelligence: `IOS-AI.9` stock TextField; `IOS-AI.10` plain Text bubbles; `IOS-AI.18` no “Apple Intelligence” user string.
- Quality: `IOS-A11Y.1` labels; `IOS-A11Y.3` Reduce Motion; `IOS-A11Y.4` context menus; `IOS-A11Y.7` status words; `IOS-L10N.2` leading alignment, no RTL locale; `IOS-L10N.4` initials avatar; `IOS-L10N.5` string catalogs; `IOS-PERF.1` instruments culture doc (sign-off boxes empty); `IOS-PERF.2` deferred session restore; `IOS-PERF.3` URLCache limits; `IOS-PERF.4` List; `IOS-PERF.5` WebSocket with bounded HTTP fallback; `IOS-PERF.6` actor APIClient; `IOS-MP.1` iPhone+iPad; `IOS-MP.2` shared WidgetSharedStore.
- Games: `IOS-MED.5` CameraImagePicker; `IOS-MED.6` JPEG stills, no RAW claim.
- Distribution: `IOS-DIST.1` iOS 26 SDK floor; `IOS-DIST.3` review notes plus the App Store report; `IOS-DIST.9` no UIRequiredDeviceCapabilities; `IOS-DIST.10` Mac and visionOS opted out; `IOS-DIST.11` one bundle; `IOS-DIST.12` free tier, StoreKit off; `IOS-DIST.13` In-App Events deferred; `IOS-DIST.14` custom product pages deferred; `IOS-DIST.15` encryption exempt; `IOS-DIST.16` 1.0.0 (3); `IOS-DIST.18` cross-link to the App Store report.

N/A index: `IOS-DES.13`, `IOS-DES.18`, `IOS-DES.21`, `IOS-DES.22`; `IOS-PRI.5`, `IOS-PRI.9`, `IOS-PRI.10`, `IOS-SEC.11`, `IOS-SEC.12`; `IOS-SYS.MISC.1`; `IOS-AI.2`–`IOS-AI.8`, `IOS-AI.12`–`IOS-AI.17`; `IOS-A11Y.5`, `IOS-MP.3`, `IOS-MP.4`, `IOS-MP.5`; `IOS-GAME.1`–`IOS-GAME.9`, `IOS-MED.1`–`IOS-MED.4`, `IOS-MED.7`.

`IOS-PERF.1` PASS is a written budget in `docs/compliance/ios-instruments-culture.md`. The sign-off boxes in that doc are empty. It is not a measured Instruments trace.

## Done-when checklist

- [x] All applicable required items scored
- [x] Every FAIL, GAP, and RISK has path evidence or an explicit absence
- [x] Readiness label matches the metric rules (AT RISK: major FAIL on required `IOS-DIST.17`, plus privacy RISK; zero required blocker FAILs)
- [x] Disclaimer present

## Disclaimer

This audit maps product evidence to Apple’s published iOS developer documentation hub and linked guidance. It is not legal advice, not App Review, and does not guarantee App Store approval or feature eligibility. Docs are living; re-verify against the canonical URLs before shipping. For rejection-risk policy, use the App Store report at `docs/compliance/app-store-review-2026-10-03.md`.

## Phase 5 — Remediation plan (not implemented)

Readiness is AT RISK. This plan is text only. No product code was changed.

### Design / Liquid Glass

1. On iOS 26+, extend glass to floating post and sell controls and drop the opaque tab-bar appearance where the system scroll edge should show (`IOS-DES.4`).
2. Add a clear / Icon Composer icon slot beside the existing light, dark, and tinted art (`IOS-DES.6`).
3. Strip `FR-` tokens, “Positions blotter”, “Request log”, “DESK LIVE”, the API host, and the git SHA from release UI (`IOS-DES.16`).

### Privacy / auth

1. Serve privacy and support on `no-markup.com`, or bundle the privacy policy in the binary (`IOS-PRI.2`, `IOS-DIST.17`).
2. After DNS, fetch the live AASA and only then enable `passkeys` (`IOS-SEC.9`, `IOS-SEC.2`). Leave `FeatureFlags.iOSHardOffKeys` in place. Do not add StoreKit purchase UI.

### System surfaces

1. Put `leading_bid_cents` and `ends_at` on Live Activity update payloads (`IOS-SYS.LA.2`).
2. Add the time-sensitive notification entitlement if those interruption levels stay (`IOS-SYS.NT.3`).
3. Call `clearBadge()` from `signOut` (`IOS-SYS.NT.5`).
4. Donate Spotlight entities with `indexAppEntities` (`IOS-INT.2`).
5. Confirm the archived `aps-environment` is production and add a Push Console check (`IOS-SYS.NT.4`).

### Intelligence

Optional only. Foundation Models and a public-catalog Visual Intelligence index are not submit blockers (`IOS-AI.1`, `IOS-AI.11`). Do not add “Apple Intelligence” copy.

### Accessibility / localization

1. Let critical prices and titles wrap at AX5, and stop ignoring those XCUI findings (`IOS-A11Y.2`).
2. Delete leftover `es` catalog units, or finish Spanish and add it to `knownRegions` (`IOS-L10N.1`, `IOS-L10N.3`).
3. Fill the accessibility nutrition label only for signed claims (`IOS-A11Y.6`, `IOS-DIST.8`).

### Performance

`IOS-PERF.1` passed on a written budget. Sign the empty Instruments boxes in `docs/compliance/ios-instruments-culture.md` when a trace exists. That does not change the PASS.

### Distribution metadata

1. Support URL, screenshots, subtitle, description, and age rating (`IOS-DIST.17`, `IOS-DIST.5`, `IOS-DIST.6`, `IOS-DES.14`).
2. App Privacy label matching the manifests and Stripe (`IOS-DIST.7`).
3. Internal TestFlight group from an Xcode 26.5 archive (`IOS-DIST.4`, `IOS-TEST.2`).
4. Sign SE, Pro Max, iPad, AX5, and iOS 17 (`IOS-DIST.2`, `IOS-TEST.3`).
5. Keep the submit archive on the iOS 26 SDK. Move to the iOS 27 SDK when that Xcode is the pin (`IOS-TEST.4`). That move is modernization, not `IOS-DIST.1`.
