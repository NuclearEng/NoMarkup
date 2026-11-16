# NoMarkup iOS — App Store and platform audit

**Target:** `/Users/nuclearisotope/Desktop/Personal/NoMarkup/ios` (`com.nomarkup.app`, marketing version 1.0.0, build 3)
**Date:** 2026-11-16
**Depth:** standard. **Notarization:** off.
**Registry snapshots:** App Review Guidelines 2026-10-16 (verified 2026-11-08, `asr_drift.sh` exit 0 on 2026-11-15). iOS hub and craft registries verified 2026-11-08. Under 90 days. No refresh pass.
**Stack:** Swift 6, SwiftUI, iOS 17.0 deployment, universal iPhone and iPad. Hand-maintained Xcode project. Stripe iOS SDK 24.25.0. StoreKit scaffold present and off in the shipping plist.
**SDK bar:** scored against the shipping iOS 17.0 deployment. APIs deprecated only after 17.0 are not current findings.

## Labels

| Label | Result |
| --- | --- |
| App Review readiness | **NOT READY** |
| Platform readiness | **NOT READY** |
| Device adaptation | **RIGID** |
| Accessibility conformance | **NON-CONFORMANT** |
| Craft score | **23 / 127 (18%)** of applicable required and recommended craft items passed. Not best in class. Required craft FAILs: 53. |

This is round 0. The close loop has not started. The excellence critic gate has not been run.

## Applicability profile

Flags were detected from the tree, then corrected by hand. Detector false positives set to false: `nonprofit` (Spotlight donation), `pinning` and `custom_trust` (pinned auction), `live_activity_broadcast` (chat channel id), `sirikit` (`AppIntentConfiguration`), `mac_catalyst_or_silicon` (both support keys are NO). Product flags set to true: `marketplace`, `ugc`, `multi_party_data`, `physical_goods`, `p2p`, `multiplatform`, `us_storefront`, `ip`, `beta`, `github_ci`, `marketing_materials`. Kids, EU, gambling, insurance products, crypto, and regulated-finance flags are false.

True flags: `accessibility_target`, `accounts`, `ai_evals`, `always`, `app_delegate`, `app_group`, `app_icon`, `app_intents`, `app_shortcuts`, `app_store_distribution`, `apple_intelligence`, `apple_pay`, `auto_motion`, `background_push`, `background_tasks`, `beta`, `biometrics`, `camera`, `cloudflare_backend`, `contact_required`, `controls`, `crypto_keys`, `custom_networking`, `custom_overlays`, `data_handling`, `dense_annotations`, `github_ci`, `hardware`, `has_extensions`, `has_forms`, `has_lists`, `has_onboarding`, `has_persistence`, `has_search`, `iap`, `ip`, `ipad`, `live_activities`, `live_activity_push`, `live_media`, `location`, `maps`, `marketing_materials`, `marketplace`, `metadata`, `multi_party_data`, `multi_window`, `multiplatform`, `native_ios`, `navigation_app`, `notifications`, `p2p`, `passkeys`, `passwords`, `permissions`, `photo_pick`, `photos`, `physical_goods`, `privacy`, `push`, `realtime_networking`, `recording`, `remote_images`, `sensitive_data`, `server_backend`, `sign_in_with_apple`, `sms_otp`, `spotlight_entities`, `streaks`, `stripe_payments`, `subscriptions`, `swift_packages`, `swiftui`, `third_party_login`, `third_party_sdk`, `time_limits`, `transactions`, `two_factor`, `ugc`, `uikit_interop`, `universal_links`, `url_scheme`, `us_storefront`, `user_files`, `user_generated_links`, `uses_commerce`, `uses_network`, `variable_rewards`, `visual_intelligence`, `wallet_or_apple_pay`, `web_content`, `webview_login`, `widget_configurable`, `widgets`.

## Corpus

```
CORPUS digests=29 show=2 lint=PASS pages=388260 pending=0
```

Mirror: `/Users/nuclearisotope/Library/Caches/ios-app-studio/apple-docs/docs.sqlite`. Crawl finished 2026-11-16 00:35:40 UTC, complete. Deployment target 17.0.

Digest paths:

- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/activitykit.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/appintents.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/appintentstesting.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/authenticationservices.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/avfoundation.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/combine.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/coregraphics.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/corelocation.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/corespotlight.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/cryptokit.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/developertoolssupport.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/foundation.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/imageio.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/localauthentication.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/mapkit.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/network.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/objectivec.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/passkit.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/photosui.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/safariservices.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/security.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/sensitivecontentanalysis.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/storekit.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/swiftui.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/uikit.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/uniformtypeidentifiers.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/usernotifications.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/visualintelligence.md`
- `/Users/nuclearisotope/.claude/skills/ios-app-studio/references/apple-docs/digests/widgetkit.md`

show: `/documentation/appkit`, `/documentation/xctest`.

Lint: no `active:` rows. 0 deprecated API uses at or below iOS 17.0. 14 uses are deprecated only after the deployment target and are not findings yet: `MKPlacemark` (26.0), `canOpenURL(_:)` (27.0), `foregroundColor(_:)` (27.3), `roundedBorder` (27.3). `no_digest` for local modules `nomarkup` and `stripepaymentsheet`.

## Executive summary

Scored 1450 registry items. Every applicable digest ID has a finding. Counts below use the worst status when two groups scored the same ID.

App Review is not ready. Blockers include a review API that is not provisioned, a demo password that is not in App Store Connect, privacy and support URLs that are not live, an Apple Pay purchase that does not show fee and tax before the sheet, and a privacy page that denies image screening the app actually performs. The camera purpose string does not cover verification, chat, or claims.

The highest-impact code defects are a biometric lock that allows access when Face ID cannot be evaluated, a service PaymentIntent whose amount comes from the client, and contract escrow that is marked paid when PaymentSheet returns rather than when the webhook confirms. Sign in with Apple never checks credential state, never sends the authorization code, and never revokes the Apple token on deletion.

Accessibility is non-conformant. Four Level A failures are a watchlist that says “tap the heart,” a session expiry with no warning, an MFA button whose spoken label does not contain the visible words, and sign-in fields whose labels are placeholders. Light gold is about 2.5:1. The UI audit ignores contrast.

Device adaptation is rigid. Home layout branches on `UIScreen.main.bounds.height < 880`, and the four-device matrix has not been run. Craft is not best in class.

### Top actions

1. Fail closed in `BiometricGate` when biometrics cannot be evaluated, and offer the device passcode (`FW-LOCALAUTHENTICATION.3`).
2. Price service escrow on the server, and fund it only from the signed webhook (`STRIPE-5`, `STRIPE-7`).
3. Publish the privacy policy and support pages, put the demo password only in App Store Connect, and point review at a running API. These stay human steps (`ASR-5.1.1.i`, `ASR-BYS.2`, `ASR-BYS.3`, `ASC-28`).
4. Align the camera and photo purpose strings and the privacy copy with the manifest and the sensitivity gate (`IOS-PRI.1`, `IOS-PRI.2`, `IOS-PRI.3`).
5. Show goods fee and tax before Apple Pay, and stop using the Apple Pay button to open a multi-method PaymentSheet (`ASR-4.9.info`, `ASR-4.9.branding`).

## Counts by section

| Section | PASS | FAIL | GAP | RISK | N/A |
| --- | ---: | ---: | ---: | ---: | ---: |
| Accessibility (WCAG) | 13 | 14 | 19 | 1 | 11 |
| App Review Guidelines | 152 | 15 | 45 | 7 | 18 |
| App Store Connect | 2 | 3 | 20 | 1 | 0 |
| App Store search | 0 | 0 | 22 | 0 | 0 |
| Apple marketing | 4 | 5 | 5 | 1 | 0 |
| Brand | 1 | 18 | 8 | 1 | 0 |
| Bundles and frameworks | 11 | 1 | 7 | 0 | 1 |
| Cloudflare | 2 | 0 | 18 | 4 | 0 |
| Craft | 23 | 50 | 40 | 5 | 1 |
| Device adaptation | 2 | 10 | 3 | 0 | 2 |
| Excellence rubric | 0 | 10 | 4 | 0 | 0 |
| Frameworks | 153 | 97 | 107 | 6 | 18 |
| GitHub CI | 8 | 11 | 8 | 0 | 1 |
| Go to market | 0 | 0 | 15 | 0 | 0 |
| Guidelines-linked policies | 1 | 2 | 19 | 4 | 0 |
| Hub-linked policies | 0 | 0 | 8 | 0 | 0 |
| Human Interface Guidelines | 22 | 12 | 100 | 3 | 4 |
| Idea | 0 | 0 | 6 | 0 | 0 |
| On-device ML | 0 | 0 | 2 | 0 | 1 |
| Patterns | 0 | 2 | 12 | 0 | 0 |
| Rust | 1 | 0 | 0 | 0 | 0 |
| Stripe | 5 | 4 | 8 | 5 | 0 |
| Swift | 9 | 9 | 6 | 3 | 15 |
| Technology selection | 13 | 5 | 18 | 0 | 2 |
| TestFlight | 1 | 1 | 14 | 0 | 0 |
| Xcode Cloud | 0 | 0 | 0 | 0 | 6 |
| iOS hub | 81 | 6 | 23 | 2 | 11 |

PASS rows are counts only. Each PASS in the group files cites a path. A PASS with empty evidence was rewritten as GAP in this report.

## Findings

Order inside each section: blocker FAIL, major FAIL, RISK, GAP, then advisory. Advisory items the standard-depth cap omitted are N/A in the group file and are not repeated here.

### Accessibility (WCAG)

#### [WCAG-1.3.3] Sensory Characteristics

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Instructions never rely only on shape, color, size, visual location, orientation, or sound.
- Evidence: `WatchlistView` empty state: “Tap the heart on a marketplace listing to watch it.” The instruction names only the heart shape, not the control name. Other “above/below” strings are bid-price comparisons (`ListingDetailView`, `JobDetailView`), not UI directions.
- Remediation: Change the empty state to name the control, for example “Tap Add to watchlist (heart) on a listing.”
- Source: https://www.w3.org/WAI/WCAG22/Understanding/sensory-characteristics.html
- Confidence: 8

#### [WCAG-1.3.5] Identify Input Purpose

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Fields that collect information about the user expose their purpose programmatically. On iOS that purpose is the text content type.
- Evidence: Auth, address, phone, password, and OTP fields set `.textContentType` (`LoginView` `.username` / `.password` / `.oneTimeCode`, `RegisterView` `.name` / `.emailAddress` / `.newPassword`, `PostJobView` `.fullStreetAddress`, `PropertiesView` address parts, `EmployeesView` name/email/phone). `ProfileSettingsView` display-name `TextField` (about line 75) has no `.textContentType`. `AdminModerationOpsViews` “Account holder name” (about line 1630) has none. Date of birth is a `DatePicker` (`AgeGateView`, `SecuritySettingsView`) with an accessibility label but no birthday content type.
- Remediation: Add `.textContentType(.name)` on display name and account-holder name. If the DOB control stays a date picker, keep a visible “Date of birth” label; a text birthday field would also need the birthday content type.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html
- Confidence: 8

#### [WCAG-1.4.11] Non-text Contrast

- Status: FAIL
- Severity: major
- Kind: required
- Rule: UI component boundaries, states, and meaningful graphics have at least 3:1 contrast against adjacent colors. Unmodified system controls are exempt.
- Evidence: `brandPrimaryButton` fills with literal gold `#C9A84C` (`goldFill`) and navy ink label. Computed `#C9A84C` on light paper `#F6F4EF` is about 2.08:1 and on white about 2.29:1, under 3:1, so the custom control’s edge fails on light surfaces. Pre-iOS 26 this style is custom, not an unmodified system button (`glassProminent` is iOS 26 only). Gold icons use `BrandTheme.gold` (`#B89938` on white about 2.74:1), including the home goods thumb. Hairline gold at low alpha is about 1.4:1 on card (`MarketTickerView` chip stroke); those edges are decorative where a fill already marks the control. Dark-mode gold on navy is about 8.8:1 and passes.
- Remediation: Darken the light-mode CTA fill, or add a ≥3:1 stroke against paper. Use `goldBright` for meaningful icons on light surfaces. Run the non-text ratio table in light and dark, including Increase Contrast.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- Confidence: 8

#### [WCAG-1.4.3] Contrast (Minimum)

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Text has a contrast ratio of at least 4.5:1, or 3:1 for large text (≥ 24 pt regular or ≥ 18.66 pt bold). Treat text below the title style as normal text.
- Evidence: `BrandTheme.gold` is light `#B89938` / dark `#C9A84C`. Computed `#B89938` on white is about 2.74:1 and on paper `#F6F4EF` about 2.50:1, under 4.5:1. That token is caption-sized text in light mode: `HomeView` “REVERSE AUCTION” and `sectionEyebrow`, bid-count “N bids”, `MarketTickerView` “MARKET DESK”, `ShowcaseAuctionChrome` category line. `goldBright` is the text-safe token (light `#806316`, about 4.71:1 on raised `#EDEAE3`, 5.14:1 on paper) and is used for many prices. Primary and secondary text tokens meet 4.5:1 on navy, card, and paper in the same computation. The UI test ignores “contrast failed”, so it is not evidence of a pass. No light-and-dark contrast audit was run.
- Remediation: Use `BrandTheme.goldBright` (or darker) for every text and small glyph on light surfaces. Stop ignoring contrast in `shouldIgnoreAccessibilityIssue`, and run `.contrast` in light and dark.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Confidence: 8

#### [WCAG-1.4.4] Resize Text

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Text can be resized with the platform text-size features without loss of content or functionality. On iOS that is Dynamic Type, including the accessibility sizes, which is stricter than WCAG 200%.
- Evidence: Body copy uses text styles, not `Font.custom` fixed sizes. The only `.font(.system(size:))` is the 1 pt harness probe in `RootTabView`. `lineLimit(1)` is common on content that is the control or the row fact: `MessagesView` quick-reply `Text(reply.body)`, `JobsView` category/location/countdown, `HomeView` location and category, `MarketTickerView` chips. `minimumScaleFactor` and `ViewThatFits` appear only in a few home/account spots. `dynamicTypeSize(.accessibility5)` is a preview on `SpectateTerminalView`, not a runtime cap. No accessibility-size screenshot or executed `.dynamicType` / `.textClipped` result.
- Remediation: Remove `lineLimit(1)` from primary labels, prices, locations, and quick replies, or allow them to wrap (`fixedSize(horizontal: false, vertical: true)` / `ViewThatFits`). Re-run the audit at `.accessibility5` on a narrow iPhone.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html
- Confidence: 7

#### [WCAG-2.2.1] Timing Adjustable

- Status: FAIL
- Severity: major
- Kind: required
- Rule: The user can turn off, adjust to at least 10×, or extend (warning at least 20 seconds ahead, at least 10 times) every time limit, except real-time events, essential limits, and limits over 20 hours.
- Evidence: Auction end times are real-time events (essential exception). The 60-second high-bid retract (`MyBidsView`, `Models.swift` `retractSecondsRemaining`) is shown as “Retract bid (Ns)” and is part of auction integrity; it is not a silent logout. Session expiry is not adjustable: `APIClient` posts `.noMarkupSessionExpired` after a failed refresh, and `AuthViewModel` then sets “Your session expired. Please sign in again.” There is no ≥20 s warning, no “Stay signed in” action, and no announcement before the session drops.
- Remediation: Warn at least 20 seconds before refresh failure, with a Stay signed in button and `AccessibilityNotification.Announcement`. Keep in-progress form state across re-auth. Leave auction clocks under the real-time exception, but do not silently drop a half-finished bid or checkout.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html
- Confidence: 7

#### [WCAG-2.4.6] Headings and Labels

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Headings and labels describe topic or purpose.
- Evidence: Most sampled labels name the data (`Job title`, `Bid amount in dollars`). No `accessibilityLabel` equal to “button”, “image”, “icon”, “view”, or “cell”. `AdminModerationOpsViews` banking confirm is titled “Remove platform bank account?” but the destructive button says “Delete account” and calls `deleteAccount()`, which calls `deleteAdminBanking` and reports “Platform bank account removed.” That label describes user-account deletion, not removing a payout bank.
- Remediation: Rename the button to “Remove bank account” so it matches the dialog title and the action.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html
- Confidence: 8

#### [WCAG-2.5.3] Label in Name

- Status: FAIL
- Severity: major
- Kind: required
- Rule: For components with visible text, the accessible name contains that visible text.
- Evidence: The sign-in button shows “Sign in” and is labeled “Sign in with email and password”, which contains the visible words. The MFA button shows “Verify and sign in” (`LoginView`) but `.accessibilityLabel` is “Verify authenticator code and sign in”, which does not contain the visible string. No Voice Control pass.
- Remediation: Set the MFA name to the visible string first, for example “Verify and sign in”, and add synonyms with `.accessibilityInputLabels` if needed.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html
- Confidence: 8

#### [WCAG-3.2.4] Consistent Identification

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Components with the same function are identified consistently inside this app. EN 301 549 applies this within one program, which is the stricter reading.
- Evidence: Destroying a row is “Delete” with trash (`QuoteTemplatesView`, `PropertiesView`, expenses in `BusinessFeaturesHubView`) and “Remove” with trash (`EmployeesView`, `PaymentMethodsView`). The same banking action is “Remove bank account” on the row, “Remove platform bank account?” on the dialog, and “Delete account” on the confirm button (`AdminModerationOpsViews`).
- Remediation: Pick one verb per function. Use “Remove bank account” for the payout bank, and do not reuse “Delete account” (that phrase is the user-deletion screen in `AccountDeletionView`).
- Source: https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
- Confidence: 8

#### [WCAG-3.3.2] Labels or Instructions

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Input has visible labels or instructions. A placeholder that disappears when typing fails when no persistent label remains.
- Evidence: `LoginView.credentialForm` uses `TextField("Email"` and `SecureField("Password"` outside a `Form`. Those strings are placeholders, not persistent labels, and the fields have no separate caption. `RegisterView` uses the same pattern for display name, email, and password. `PostJobView` fields inside `Section` keep the Form label and also set `accessibilityLabel`. Password rules are not shown beside the register password field before failure.
- Remediation: Put a persistent `Text` label above email and password on sign-in and registration, and state password rules before submit.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html
- Confidence: 8

#### [WCAG-3.3.3] Error Suggestion

- Status: FAIL
- Severity: major
- Kind: required
- Rule: When an error is known and a correction is known, the suggestion is given, unless it would jeopardize security.
- Evidence: Many validators suggest the fix (`PostJobView` “Enter a valid starting bid in dollars (for example 100.00).”). These do not: `APIClient+Provider.swift` “Invalid document type.” and `APIClient+RegulatedRails.swift` “Invalid tax year.” (twice). The registry check treats bare “Invalid …” as a failure.
- Remediation: Replace those strings with the accepted values, for example the document-type list and a four-digit year.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html
- Confidence: 7

#### [WCAG-4.1.3] Status Messages

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Status messages are presented by assistive technology without moving focus.
- Evidence: No `AccessibilityNotification.Announcement` and no `UIAccessibility.post` announcement anywhere under `ios/`. Status text is visual only: login `statusMessage`, bid result text in `ListingDetailView`, “Platform bank account saved” in `AdminModerationOpsViews`, and “Your session expired” in `AuthViewModel`. Loading copy is an `accessibilityLabel` on skeletons, which is not an announcement when the state changes.
- Remediation: Post `AccessibilityNotification.Announcement` for save, bid result, send failure, result counts, and session warning, without moving focus.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- Confidence: 9

#### [WCAG-3.3.4] Error Prevention (Legal, Financial, Data)

- Status: RISK
- Severity: major
- Kind: required
- Rule: Legal, financial, and data-destroying actions are reversible, checked with a chance to correct, or confirmed before they complete.
- Evidence: Account deletion requires a “DELETE” phrase, a toggle, and Face ID (`AccountDeletionView`). Cancel job, cancel listing, remove card, block user, and sign-out use `confirmationDialog`. Card charge and Apple Pay go through Stripe PaymentSheet / Apple Pay, which is a system confirm. Placing a bid (`ListingDetailView` “Place bid · $…”) submits on one tap. The amount is on the button and can be edited before that tap, but there is no review dialog. Retract is only for the current high bid and only for 60 seconds. Post-job and create-listing wizards do have a review step before submit.
- Remediation: Add a confirmation that restates the bid or buy-now amount before the charge or the binding bid. Keep the 60-second retract, but do not treat it as the only safeguard.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html
- Confidence: 6

#### [WCAG-1.1.1] Non-text Content

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: All non-text content has a text alternative that serves the equivalent purpose, and decorative images are hidden from assistive technology.
- Evidence: Labels are widespread (`LoginView` “Sign in with Passkey”, `MessagesView` “Attach photo” / “Take photo” / “Send message”, `ModeratedAsyncImage` “Sensitive media — tap to show”, decorative `accessibilityHidden(true)` on `NoMarkupApp` lock icon). The audit covers at most Login, Home, and Account, ignores some issues, and was not run here. No VoiceOver swipe pass. No `accessibilityChartDescriptor` (no Swift Charts).
- Remediation: Run `performAccessibilityAudit` for `.sufficientElementDescription` and `.elementDetection` on every screen, including sheets, and do a VoiceOver pass. Keep icon-only controls on `Label` or `.accessibilityLabel`.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html
- Confidence: 6

#### [WCAG-1.3.1] Info and Relationships

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Information, structure, and relationships conveyed visually are also programmatically determinable.
- Evidence: `Form`/`Section` and `.navigationTitle` are used widely. Header traits exist on `HomeView.sectionEyebrow`, `AgeGateView` “Verify your age”, `BrandTheme` section headers (`.accessibilityAddTraits(.isHeader)`), and selected traits on category/admin chips. No `accessibilityHeading` and no rotor. Trait audit is only the three screens above and was not executed. VoiceOver headings rotor not run.
- Remediation: Add `.accessibilityAddTraits(.isHeader)` (and heading level) on every custom eyebrow that is not a `Section` header. Run the trait/parent-child audit per screen.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html
- Confidence: 6

#### [WCAG-2.1.2] No Keyboard Trap

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: If keyboard focus can move into a component, it can move out again using only the keyboard, or the user is told how.
- Evidence: Sheets are system sheets. `interactiveDismissDisabled` is set while submitting on `UserReviewsView` and `MessagesView` propose-terms, which blocks swipe dismiss during the request. `AgeGateView` sets `.accessibilityAddTraits(.isModal)` and has Continue, not a close control. No Full Keyboard Access enter/exit pass, and no `.keyboardShortcut(.cancelAction)` on those sheets.
- Remediation: Keep a visible Cancel that stays keyboard-operable while submit is in progress. Walk every sheet, map, and Safari sheet with Full Keyboard Access.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html
- Confidence: 6

#### [WCAG-4.1.2] Name, Role, Value

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Every component’s name and role are programmatically determined, and user-settable values can be set and are notified to assistive technology. Standard controls satisfy this when used as intended.
- Evidence: Most controls are `Button`, `Toggle`, `Picker`, `TextField`, and `Stepper`. Star images in review forms are `.accessibilityElement(children: .ignore)` with a combined “Rating N of 5 stars” label, and a `Stepper` sets the value. `ModeratedAsyncImage` adds `.isButton`. The audit that checks traits and actions covers at most three screens, was not run here, and is not a VoiceOver pass of custom controls.
- Remediation: Run the trait/action audit on bid, pay, chat, and map. With VoiceOver, confirm each custom control speaks name, role, and value after a change.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html
- Confidence: 6

#### [WCAG-1.3.2] Meaningful Sequence

- Status: GAP
- Severity: major
- Kind: required
- Rule: When sequence affects meaning, the assistive-technology reading order matches the meaningful order.
- Evidence: No `accessibilitySortPriority` in the tree. Layered layouts exist (`AgeGateView` ZStack, card overlays, `HomeView` hero). No VoiceOver swipe-order notes.
- Remediation: Walk each screen with VoiceOver. Where overlays read out of order, use `.accessibilityElement(children: .contain)` and `.accessibilitySortPriority`.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/meaningful-sequence.html
- Confidence: 6

#### [WCAG-1.4.1] Use of Color

- Status: GAP
- Severity: major
- Kind: required
- Rule: Color is not the only visual means of conveying information, indicating an action, prompting a response, or distinguishing an element.
- Evidence: `StatusChipView` (`JobsView.swift`) draws a text label plus color and sets `accessibilityLabel("Status \(label)")`. `BrandGlassStatusChip` pairs “LIVE” / “GOODS” text with a dot. No `@Environment(\.accessibilityDifferentiateWithoutColor)`. No grayscale pass. Inline `Link`s are tint-distinguished.
- Remediation: Underline inline links. Read Differentiate Without Color where a series is hue-only. Capture grayscale screenshots of status chips.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- Confidence: 6

#### [WCAG-1.4.10] Reflow

- Status: GAP
- Severity: major
- Kind: required
- Rule: Content reflows without two-dimensional scrolling at 320 pt width, except parts that need a two-dimensional layout.
- Evidence: Horizontal `ScrollView`s: `MarketTickerView` chips, `MessagesView` quick replies, `ImageUploader` photo strip, `JobDetailView` badge row. Ticker chips are not also listed vertically. `brandReadableWidth` exists for iPad. No accessibility-size or Split View screenshots.
- Remediation: At `.accessibility5` on the narrowest iPhone and in iPad Split View, confirm text does not require sideways panning. Give ticker facts a vertical reading path.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- Confidence: 6

#### [WCAG-2.1.1] Keyboard

- Status: GAP
- Severity: major
- Kind: required
- Rule: All functionality is operable through the keyboard interface without specific timings, except path-dependent input. An on-screen keyboard alone does not satisfy this.
- Evidence: Swipe deletes also have a `.contextMenu` (`EmployeesView`, `PropertiesView`, `QuoteTemplatesView`, `MyBidsView`, `WishlistView`, `SavedSearchesView`, `BusinessFeaturesHubView`). Star ratings use `onTapGesture` but a `Stepper` sits on the same screen (`ContractDetailView`, `MyOrdersView`). No Full Keyboard Access walkthrough. The accessibility audit does not prove keyboard reach.
- Remediation: With Full Keyboard Access, complete sign-in, bid, pay, chat, and delete. Prefer a visible `Button` beside swipe actions, not only a context menu.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html
- Confidence: 6

#### [WCAG-2.4.11] Focus Not Obscured (Minimum)

- Status: GAP
- Severity: major
- Kind: required
- Rule: When a component receives keyboard focus, author-created content does not hide it entirely.
- Evidence: Sticky actions use `.safeAreaInset` (`PostJobView`, `CreateListingView`, `ListingDetailView`, `BrandTheme.brandTabBarClearance`). The one `.overlay(alignment: .bottom)` in `ParitySurfacesView` is a 1 pt hairline, not a bar. No `.ignoresSafeArea(.keyboard)` on forms. No Full Keyboard Access pass at the largest text size.
- Remediation: Tab through post-job, checkout, and chat at accessibility sizes and confirm the focused field is never fully under the tab bar or a dock.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- Confidence: 6

#### [WCAG-2.4.2] Page Titled

- Status: GAP
- Severity: major
- Kind: required
- Rule: Every screen has a title that describes its topic or purpose.
- Evidence: More than 100 `.navigationTitle` calls with specific names (`Jobs`, `Listing`, `Delete Account`, `Sign in`). `HomeView` title is “NoMarkup”, which is the app name on the home tab only, not every screen. `AgeGateView` has no navigation title; the visible title has `.isHeader`. No XCUI assertion that every navigation bar identifier is non-empty, and no VoiceOver screen-change pass.
- Remediation: Set a purpose title on the age gate and on any sheet that only shows the app name. Assert `navigationBars` identifiers in UI tests.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html
- Confidence: 6

#### [WCAG-2.4.3] Focus Order

- Status: GAP
- Severity: major
- Kind: required
- Rule: Focus order preserves meaning and operability, including moving into new modals and returning when they close.
- Evidence: No `AccessibilityFocusState` or `accessibilityFocused`. `AgeGateView` marks `.isModal`. System sheets are used for most modals. No VoiceOver or Full Keyboard Access order notes, and validation errors do not move focus to the first invalid field.
- Remediation: Move `@AccessibilityFocusState` to the first invalid field on submit. Confirm sheet focus moves in and returns to the trigger.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html
- Confidence: 6

#### [WCAG-2.4.7] Focus Visible

- Status: GAP
- Severity: major
- Kind: required
- Rule: Any keyboard-operable UI has a mode where the keyboard focus indicator is visible.
- Evidence: No `focusEffectDisabled` in the tree, so the system focus effect is not turned off. No Full Keyboard Access screenshots.
- Remediation: With Full Keyboard Access, confirm the ring is visible on custom gold buttons, ticker chips, and map controls. Do not disable the system focus effect.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- Confidence: 6

#### [WCAG-2.5.8] Target Size (Minimum)

- Status: GAP
- Severity: major
- Kind: required
- Rule: Pointer targets are at least 24×24 pt (WCAG). Apple’s bar is stricter: 44×44 pt hit regions, and the builder follows 44×44 pt.
- Evidence: Many controls set `.frame(minWidth: 44, minHeight: 44)` or `minHeight: 44` (messages attach/send, job actions, payment-method remove). Non-interactive 6–8 pt status dots are not targets. No XCUI frame measurement and no executed `.hitRegion` result. The audit that would include hit region was not run and does not cover every screen.
- Remediation: Assert every `button` and `link` frame is ≥44×44 pt, or ≥24×24 pt with the spacing exception documented. Pad any glyph that is only as large as the SF Symbol.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Confidence: 6

#### [WCAG-3.3.1] Error Identification

- Status: GAP
- Severity: major
- Kind: required
- Rule: When an input error is detected automatically, the item in error is identified and the error is described in text.
- Evidence: Login and MFA render `auth.errorMessage` with `.accessibilityLabel("Error: \(error)")`. Post-job and create-listing validators return specific strings (“Enter a title for the job.”, “Enter a valid starting bid in dollars (for example 100.00).”). Errors are not written into the field’s accessibility value, focus is not moved, and nothing posts an announcement. No VoiceOver submit pass.
- Remediation: Put the error on the field (`accessibilityValue` or a sibling tied with the field) and move `@AccessibilityFocusState` to the first invalid field. Announce the error (see WCAG-4.1.3).
- Source: https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html
- Confidence: 7

#### [WCAG-3.3.7] Redundant Entry

- Status: GAP
- Severity: major
- Kind: required
- Rule: Information the user already entered in the same process is auto-populated or available to select, except where re-entry is essential or required for security.
- Evidence: Post-job and create-listing keep one view’s `@State` across steps, Back does not clear it, and a review step reprints the values. Confirm-password and current-password fields are security re-entry. No UI test walks back and forward and asserts the fields are still filled. No “same as” control was found for a second address in checkout.
- Remediation: Add a UI test that fills step 1, continues, goes back, and asserts the values remain. Do not ask again for name, email, or address later in the same checkout.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html
- Confidence: 6

Advisory:

- WCAG-1.4.6 — FAIL: Contrast (Enhanced)
- WCAG-2.3.3 — FAIL: Animation from Interactions
- WCAG-2.2.6 — GAP: Timeouts
- WCAG-2.4.12 — GAP: Focus Not Obscured (Enhanced)
- WCAG-2.5.5 — GAP: Target Size (Enhanced)
- WCAG-2.5.6 — GAP: Concurrent Input Mechanisms

### App Review Guidelines

#### [ASR-2.1.a.1] Final version, metadata, and functional URLs

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Submissions must be final versions with complete metadata and fully functional URLs, and placeholder or temporary content must be removed.
- Evidence: `AppConfig.supportURL` / `privacyURL` / `productionAPIBaseURL` point at `https://no-markup.com/support`, `/privacy`, and `https://api.no-markup.com`. `docs/compliance/app-review-notes.md` (as of 2026-10-03) says those hosts did not resolve and “Do not submit while the host is down.” `docs/compliance/submission-blockers.md` rows 3–9 still list the App Store Connect record, screenshots, privacy labels, age rating, demo password, and a live review API as open. `Info.plist` `APIBaseURL` is empty.
- Remediation: Publish privacy, support, marketing, and the review API over HTTPS, then enter the App Store Connect listing before upload.
- Source: https://developer.apple.com/app-store/review/guidelines/#app-completeness
- Confidence: 8

#### [ASR-2.1.a.3] Demo account and live backend

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: If the app includes login, provide demo account info and keep backend services live; a demo mode needs prior approval and full feature parity.
- Evidence: `LoginView` requires credentials (scaffold bypass is `#if DEBUG` only). `docs/compliance/app-review-notes.md` lists `customer@nomarkup.com`, `provider@nomarkup.com`, `provider2@nomarkup.com`, and `admin@nomarkup.com`, and states the password is not in git and `https://api.no-markup.com` is not provisioned. `docs/compliance/submission-blockers.md` row 8–9: password not entered in App Store Connect; review backend not always-on.
- Remediation: Seed those accounts on a host that stays up through review and put the password only in the App Store Connect password field.
- Source: https://developer.apple.com/app-store/review/guidelines/#app-completeness
- Confidence: 9

#### [ASR-4.9.info] Material purchase information before Apple Pay

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Apps using Apple Pay must provide all material purchase information to the user prior to sale of any good or service.
- Evidence: `MarketplaceService.ChargeListingWinner` creates the PaymentIntent for `order.AmountCents + feeCents + taxCents` (`listing_charge.go`). `ListingDetailView.buyNowSection` shows `MoneyFormat.usd(cents: buyNowPriceCents)` and `buyerPaysAgreedPriceLine` (“plus disclosed fees and tax”) with no fee or tax figures. `buyNow()` receives `totalCents` on the envelope and calls `RailACheckout.presentPaymentSheet` without displaying it. `MyOrdersView.orderRow` labels Apple Pay with `order.displayAmount`, which is `amountCents` only, and `pay()` does not show `intent.totalCents` before the sheet. Service escrow does show a server fee breakdown (`ContractDetailView.feeBreakdownBlock`) before pay.
- Remediation: Before `presentPaymentSheet`, show item, fee, tax, and total from `totalCents` / `feeCents` / `taxCents`. Make the Apple Pay button amount that total, not the item price alone.
- Source: https://developer.apple.com/app-store/review/guidelines/#apple-pay
- Confidence: 9

#### [ASR-5.1.1.i] Privacy policy link and contents

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: The app must link to its privacy policy in App Store Connect and inside the app; the policy must identify data collected and all uses, state that third parties give the same or equal protection, and explain retention, deletion, and how to revoke consent.
- Evidence: In-app entry `AccountView` `account.row.privacyPolicy` opens `AppConfig.privacyURL` (`https://no-markup.com/privacy`) in `LegalWebView`. The full text at `web/src/app/(public)/privacy/page.tsx` has collection (section 2), uses (section 3), third-party equal protection (section 4), and 30-day deletion plus export (section 5). That page is not what review gets if the host is down: `LegalWebView.privacyFallback` / `LegalOfflineCopy.txt` says it “is not the full policy” and omits third-party equal protection. `app-review-notes.md` says the App Store Connect Privacy Policy URL is still a founder residual, and the zone is not provisioned.
- Remediation: Serve `https://no-markup.com/privacy` over HTTPS, point App Store Connect at that URL, and either keep the fallback equal to the full policy or block submission until the live policy loads in `LegalWebView`.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [ASR-BYS.2] Review access and demo account

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Provide App Review full access to the app, including an active demo account or fully-featured demo mode and any hardware or resources needed to review.
- Evidence: `app-review-notes.md` lists `customer@nomarkup.com`, `provider@nomarkup.com`, `provider2@nomarkup.com`, and `admin@nomarkup.com`, and states the shared password is not in App Store Connect and the review API is not provisioned. `AuthViewModel.enterScaffoldSession` is browse-only with no token. `AgeGateHost` blocks signed-in use until `GET /api/v1/me/age-status` is verified, so an unseeded 18+ DOB cannot reach report, block, chat, or pay.
- Remediation: Seed those accounts with `dob_verified_at` set on the review API and put the password only in the App Store Connect password field. Confirm report, block, chat, and Apple Pay paths on that host.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [ASR-BYS.3] Backend live during review

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Enable backend services so they are live and accessible during App Review.
- Evidence: `AppConfig.productionAPIBaseURL` path is `https://api.no-markup.com` (`AppConfig.swift`). `app-review-notes.md` says that host is not provisioned (`DEPLOY_PROVISIONED` unset). `/Users/nuclearisotope/Desktop/Personal/NoMarkup/docs/operations/provisioning-checklist.md` status is “NOT YET PROVISIONED” and deploy stays fail-closed until that flag. Release `Info.plist` `APIBaseURL` is empty, so the shipping binary uses that host.
- Remediation: Provision the review API (auth, listings, jobs, chat, report, block, image confirm, Stripe test keys) and keep it up for the review window before upload.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [ASR-PRE-04] Demo access for account features

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Provide App Review full access; for account-based features supply an active demo account or fully-featured demo mode, plus any needed hardware or resources.
- Evidence: Same gap as ASR-BYS.2. Accounts are significant (`RegisterView`, bids, escrow). Demo emails are drafted; the password is explicitly not in App Store Connect; the API those accounts would use is not provisioned; scaffold mode cannot call report or block.
- Remediation: Seed the demo accounts on the live review API and store the password only in App Store Connect.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [ASR-PRE-05] Backend live

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Backend services must be live and accessible during review.
- Evidence: Same as ASR-BYS.3. `provisioning-checklist.md` is “NOT YET PROVISIONED”. Release client targets `https://api.no-markup.com`.
- Remediation: Bring up `https://api.no-markup.com` (or the host the binary actually calls) with the review seed data before submission.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [ASR-1.5.a] Support URL and in-app contact

- Status: FAIL
- Severity: major
- Kind: required
- Rule: The app and its Support URL must include an easy way to contact the developer, and contact information must be accurate and current.
- Evidence: `AppConfig.supportURL` is `https://no-markup.com/support`. `app-review-notes.md` and `provisioning-checklist.md` say that zone is not provisioned, so the Support URL is not a working contact. The binary does include `LegalWebView` native support and `mailto:support@no-markup.com` (`account.row.support`). App Store Connect Support URL is listed as still open in the same review notes.
- Remediation: Publish `https://no-markup.com/support` with a working contact method, set that URL in App Store Connect, and monitor the mailbox.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [ASR-4.9.branding] Apple Pay branding matches the guidelines

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Apps using Apple Pay must use Apple Pay branding and user interface elements correctly, per the Apple Pay Marketing Guidelines and Human Interface Guidelines.
- Evidence: `ListingDetailView.buyNowSection` and `MyOrdersView.orderRow` use `PayWithApplePayButton` (`.buy` and `.plain`, `.payWithApplePayButtonStyle(.automatic)`). Both actions call `RailACheckout.presentPaymentSheet`. `makeConfiguration` sets `applePay` but does not limit `paymentMethodTypes`, so the official Apple Pay button opens Stripe PaymentSheet’s card / Link / Apple Pay sheet. The marketing rule is that the Apple Pay button only starts an Apple Pay transaction (https://developer.apple.com/apple-pay/marketing/). Escrow correctly uses a generic `creditcard.fill` “Pay & hold escrow” button.
- Remediation: Use a generic Pay button for PaymentSheet, or a real Apple Pay-only authorization (`PKPaymentAuthorizationController` / PaymentSheet Apple Pay only) plus a separate card button. Do not label the multi-method sheet with `PayWithApplePayButton`.
- Source: https://developer.apple.com/app-store/review/guidelines/#apple-pay
- Confidence: 8

#### [ASR-BYS.1] Review contact current

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Keep App Review contact information current so App Review can reach the developer.
- Evidence: `/Users/nuclearisotope/Desktop/Personal/NoMarkup/docs/compliance/app-review-notes.md` (as of 2026-10-03) states App Review contact is still a founder residual and must not be claimed done in App Store Connect. In-binary fallback is `LegalWebView.supportMailto` (`mailto:support@no-markup.com`) and `AppConfig.supportURL` (`https://no-markup.com/support`).
- Remediation: Put a monitored phone and email on the App Store Connect account and confirm they answer during the review window.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [ASR-BYS.4] Safety review notes

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Include detailed explanations of non-obvious features in App Review notes, with supporting documentation where appropriate.
- Evidence: `app-review-notes.md` has a paste block for the 18+ gate, report/block, widgets, and Stripe-vs-StoreKit rails, and the same file says the paste into App Store Connect is still open (“do not claim done in ASC”).
- Remediation: Paste the fenced review-notes block into App Store Connect App Review Information, including the age gate, UGC report/block path, and that `StoreKitEnabled` is false.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [ASR-PRE-02] Complete accurate metadata

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Ensure all app information and metadata is complete and accurate.
- Evidence: `app-review-notes.md` founder residual: screenshots, App Review contact, and Privacy Policy URL in the portal are still open. No App Store Connect listing (name, description, screenshots, age rating, keywords) is stored as submitted. Binary marketing version is 1.0.0, display name `NoMarkup` (`Info.plist` `CFBundleDisplayName`).
- Remediation: Complete the App Store Connect listing so name, description, screenshots, age rating (18+), and URLs match this binary.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [ASR-PRE-03] Developer contact for review

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Keep contact information updated so App Review can reach the developer.
- Evidence: Same founder residual as ASR-BYS.1 in `app-review-notes.md`: App Review contact is not claimed done in App Store Connect.
- Remediation: Enter a monitored contact email and phone in App Store Connect and watch them during review.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [ASR-PRE-06] Review notes for non-obvious features

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Include detailed explanations of non-obvious features and in-app purchases in App Review notes, with supporting documentation where appropriate.
- Evidence: Paste-ready notes exist in `app-review-notes.md` (18+ gate, UGC, `StoreKitEnabled=false`, Apple Pay for real-world goods). The file says they are not pasted into App Store Connect.
- Remediation: Paste the notes into App Store Connect and attach nothing that claims IAP is on while `Info.plist` `StoreKitEnabled` is false.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [ASR-3.1.3.d.2] One-to-few and one-to-many real-time services use IAP

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: One-to-few and one-to-many real-time services must use in-app purchase.
- Evidence: There is no group-class capacity or attendee SKU, but `PostJobView` accepts any service category and `ContractDetailView` always funds escrow with Stripe PaymentSheet. Nothing stops a customer from posting a live group session (the guideline’s own examples include fitness training and tutoring) and paying outside IAP. Offline single-provider jobs remain 3.1.3(e).
- Remediation: Keep on-site one-provider jobs on Stripe. If a category is real-time and one-to-many, block that purchase or sell it with IAP. State the split in App Review notes.
- Source: https://developer.apple.com/app-store/review/guidelines/#business
- Confidence: 6

#### [ASR-5.1.1.vii] Safari view visibility and tracking

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: SafariViewController must be used to visibly present information to users; it may not be hidden or obscured by other views or layers, and it may not be used to track users without knowledge and consent.
- Evidence: `LegalWebView.SafariView` builds `SFSafariViewController(url:configuration:)` and `AccountView` presents it with `.sheet(item: $legalSheet)`, so the controller is a SwiftUI child of a sheet, not `present(_:animated:completion:)`. Apple docs for `class SFSafariViewController` (`/documentation/safariservices/sfsafariviewcontroller`): “when you present this view controller, it must visibly present information to users. You may not hide or obscure the view controller,” and “Don’t embed an SFSafariViewController as a child view controller… Always present it modally.” No `eventAttribution` or tracking configuration is set. The sheet is user-initiated for Privacy, Terms, Guidelines, and Support, and it is not hidden, but a resizable sheet can leave the Safari UI partially covered.
- Remediation: Present `SFSafariViewController` modally full screen (or `fullScreenCover`) for legal URLs, and do not embed it in a medium detent sheet.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 7

#### [ASR-1.1.4] Sexual content and exploitation

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: Do not include overtly sexual or pornographic material, including hookup apps and apps that may include pornography or facilitate prostitution, trafficking, or exploitation.
- Evidence: Text path rejects sexual-commerce phrases in `filter.go` (`porn`, `escort service`, `sexual services`, `csam`, reason `ReasonSexualContent`). Community guidelines ban pornography, sexual services, and non-consensual intimate imagery. Photo path does not match that bar: `web/src/app/(public)/privacy/page.tsx` says “NoMarkup does not screen those images for safety.” `ImageUploader.SensitivePhotoUploadGate.refuseIfSensitive` returns without refusing when the analyzer throws, `analysisPolicy == .disabled`, the framework is missing, or the build is the simulator (`SensitivePhotoUploadDecision.shouldRefuse`).
- Remediation: Scan uploads on the server (or fail closed on the device) for sexual and exploitative imagery before `POST /api/v1/images/confirm`, and correct the privacy policy so it matches the control.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 7

#### [ASR-2.5.14] Consent and indication when recording or logging activity

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: Apps must request explicit user consent and provide a clear visual or audible indication when recording, logging, or otherwise making a record of user activity, including camera, microphone, screen recording, or other user inputs.
- Evidence: Camera uses `AVCaptureDevice.requestAccess` and the system `UIImagePickerController` (`CameraAuthorization`, `CameraImagePicker`) plus `NSCameraUsageDescription`. No microphone usage string and no `RPScreenRecorder`. In Release, `APIClient` still writes every HTTP method and path into `ClientActionLog`, `RootTabView` records tab changes, and `BrandTheme.AuditPressProbe` records primary-button presses. `NoMarkupApp` calls `ActionAuditProbe.install()`, but the swizzle is `#if DEBUG` only. The log is on-device (`ClientActionLogView`, Account request log) with no consent prompt and no ongoing recording indicator.
- Remediation: Keep the system camera prompt. In Release, record HTTP and tap diagnostics only after the user turns on the request log, and show that it is on.
- Source: https://developer.apple.com/app-store/review/guidelines/#software-requirements
- Confidence: 7

#### [ASR-2.5.19.a] No hidden or dormant features

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: Do not include hidden, dormant, or undocumented features; functionality should be clear to end users and App Review.
- Evidence: `FeatureFlags.iOSHardOffKeys` forces off BNPL, working capital, insurance, legal services, lead-gen, and instant payout, while `BusinessFeaturesHubView` and `LegalServicesView` still contain those screens and show “Not available in this App Store build.” `StoreKitManager` purchase code remains in the binary. `AppConfig.storeKitEnabled` can turn it on from `NOMARKUP_STOREKIT_ENABLED` in Release, not only DEBUG, even though `Info.plist` is false and product IDs are absent. `AccountView` shows “Feature flag status” and an admin console only when `hasAdminRole`. Draft `app-review-notes.md` describes the off posture but is not confirmed pasted into App Store Connect.
- Remediation: Paste the hard-off list and the StoreKit-off sentence into Notes for Review. Do not enable StoreKit or regulated rails in the reviewed build. Prefer compiling purchase UI out until products exist.
- Source: https://developer.apple.com/app-store/review/guidelines/#software-requirements
- Confidence: 7

#### [ASR-4.5.4.sensitive] Push does not carry secrets

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: Push Notifications should not be used to send sensitive personal or confidential information.
- Evidence: Chat alerts are redacted to title and body “New message” (`redactMessageAlert` in `services/notification/internal/service/apns.go`). Provider payout alerts are not redacted: the payment service puts the formatted dollar amount in the push body when a payout succeeds and includes the failure reason when a payout does not complete. No full card number or password was found in push copy; password reset in tests is email.
- Remediation: Keep payout and payment-failure pushes generic (“Payout update — open the app”) and leave amounts inside the app.
- Source: https://developer.apple.com/app-store/review/guidelines/#design
- Confidence: 7

#### [ASR-5.1.1.x] Optional name and email

- Status: RISK
- Severity: major
- Kind: required
- Rule: Apps may request basic contact information such as name and email only if the request is optional, features are not conditional on it, and kids limits are respected.
- Evidence: `RegisterView.submit` refuses to continue unless display name and email are non-empty (“Enter a display name.” / “Enter your email.”). Bidding, buying, and chat require that account. Sign in with Apple is also offered (`SignInWithAppleButton`). This conflicts with the literal optional-contact sentence, and is partly excused by ASR-5.1.1.v because the marketplace account is core. Not a kids audience (`AgeGateView` is 18+).
- Remediation: Keep email as the account identifier for bids and payments, and do not add a separate non-skippable name or email prompt on flows that are not the account itself. If review treats 5.1.1(x) strictly, allow Sign in with Apple Hide My Email without a forced display name.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 6

#### [ASR-1.2.a] Filter objectionable UGC

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Apps with user-generated content must include a method for filtering objectionable material from being posted.
- Evidence: Text filter `rejectProhibitedUGC` covers listings, jobs, chat (`chat.go` send and templates), reviews (`review.go`, `listing_order_reviews.go`), offers, bios, display names, disputes, and quote templates. Photo UGC is not covered the same way: `SensitivePhotoUploadGate` fails open (see ASR-1.1.4), and the privacy policy states images are not screened. `SCSensitivityAnalyzer` (`/documentation/sensitivecontentanalysis/scsensitivityanalyzer`) “successfully detects sensitive content only when `analysisPolicy` is other than `.disabled`.”
- Remediation: Apply a fail-closed image and video check on every upload context (job, listing, chat, profile, verification) before the object is public, and keep the text blocklist.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [ASR-1.2.b] Report offensive content

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: UGC apps must provide a mechanism to report offensive content and timely responses to concerns.
- Evidence: In-app report UI: `JobDetailView` `reportJob`, `ListingDetailView` `reportListing`, `ProviderDetailView.reportUser`, `MessagesView` chat `reportUser`, `UserReviewsView` flag. Gateway persists reports (`job_reports.go`, `user_reports.go`, listing reports). No moderation SLA, staffed queue, or response-time runbook in the tree, and the review API is documented as not provisioned, so timely handling is not shown.
- Remediation: Publish an ops SLA (for example first review within 24 hours) and staff the admin report queue on the host App Review will use.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 7

#### [ASR-1.2.h] NCII, IP, and bullying safeguards

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: UGC apps must safeguard against intellectual-property infringement, nonconsensual intimate imagery, and anonymous bullying, and must remediate violations after notice.
- Evidence: Bullying controls exist (block, report, accounts required). NCII is named in community guidelines, but detection is the fail-open `SensitivePhotoUploadGate` and the privacy policy says images are not screened. Terms (`web/src/app/(public)/terms/page.tsx` “User content”) say the user must have rights and that IP infringement is prohibited, and that NoMarkup may remove content. There is no DMCA or notice-and-takedown form, designated agent, or remediation SLA.
- Remediation: Add a published IP notice path and a fail-closed intimate-imagery check on upload, with a logged takedown SLA after user or Apple notice.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 7

#### [ASR-2.1.a.2] On-device testing

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Apps must be tested on-device for bugs and stability before submission.
- Evidence: `docs/compliance/submission-blockers.md` row 11 and `docs/compliance/testflight-process.md` §9 leave human device smoke unsigned. `docs/compliance/device-smoke-checklist.md` sign-off table is blank and says a device-verified claim is not allowed from simulator-only runs. Later device notes (`docs/compliance/sim-runs/2026-08-22-device-caps/REPORT.md`) are blocked, not a signed 1.0.0 pass. Marketing version in `project.pbxproj` is `1.0.0`.
- Remediation: Cold-launch the archive on iPhone and iPad against the review API and record login, browse, bid or buy, messages, and account.
- Source: https://developer.apple.com/app-store/review/guidelines/#app-completeness
- Confidence: 8

#### [ASR-2.1.a.4] Bundle integrity and obvious technical defects

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Incomplete app bundles and binaries that crash or show obvious technical problems will be rejected.
- Evidence: `project.pbxproj` has `NoMarkup` (`com.nomarkup.app`) and `NoMarkupWidget` (`com.nomarkup.app.widget`) with `IPHONEOS_DEPLOYMENT_TARGET = 17.0`. `Info.plist` has display name, usage strings, and `ITSAppUsesNonExemptEncryption` false. No crash log or signed device pass exists for marketing version 1.0.0 (`submission-blockers.md` row 11). Release login does not include the DEBUG scaffold button.
- Remediation: Archive, install on device, and attach a crash-free walk of the primary tabs before submission.
- Source: https://developer.apple.com/app-store/review/guidelines/#app-completeness
- Confidence: 7

#### [ASR-5.0] Legal compliance

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Apps must comply with all legal requirements where they are made available, and must not solicit, promote, or encourage criminal or clearly reckless behavior.
- Evidence: Content rules prohibit illegal goods (`community-guidelines` and `filter.go`). `us_storefront` is the stated market (`AppConfig` Apple Pay country comment “US marketplace MVP”). No counsel memo, storefront legal matrix, or geo-restriction config is in the tree. The product does not promote trafficking or child exploitation; those phrases are on the blocklist.
- Remediation: Record a short legal review for each storefront where the app will be available, covering marketplace, escrow, and age rules, and keep prohibited-item enforcement on.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 6

#### [ASR-5.2.2] Third-party service authorization

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: If the app uses, accesses, monetizes, or displays content from a third-party service, the developer must be specifically permitted under that service’s terms, and authorization must be available on request.
- Evidence: Shipping integrations include Stripe (`RailACheckout`, `stripe-ios`), Mapbox-class maps mentioned in the privacy policy, and optional Google and Facebook OAuth (`GoogleOAuthSession`, `FacebookOAuthSession`). `Info.plist` `GoogleIosClientID`, `FacebookAppID`, and `StripePublishableKey` are empty placeholders. `app-review-notes.md` does not attach Stripe, Google, Meta, or map-provider authorization for App Review.
- Remediation: Keep API terms acceptance on file (Stripe account, Google Cloud OAuth client, Meta app, map token) and be ready to attach them in App Review notes on request.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 6

#### [ASR-5.6] Developer code of conduct

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Treat everyone with respect in review responses, support, and communications with Apple; do not harass, discriminate, intimidate, or bully; do not trick users into purchases, force unnecessary data sharing, or charge deceptively.
- Evidence: No bait IAP: `Info.plist` `StoreKitEnabled` is false and `PlanLimitsView` states there is no upgrade button. No review-response or support-conduct playbook, and no conduct-history record, is in the tree. Pricing copy in `AccountView` discloses that goods use Apple Pay and the platform fee comes from the seller payout.
- Remediation: Write a short support and App Review reply rule that bans harassment, PII, and marketing in replies, and keep digital unlocks off while `StoreKitEnabled` is false.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 6

#### [ASR-2.1.b.2] Unreachable IAP explained in review notes

- Status: GAP
- Severity: major
- Kind: required
- Rule: If any configured in-app purchase cannot be found or reviewed in the app, explain why in the review notes.
- Evidence: Draft notes in `docs/compliance/app-review-notes.md` say `StoreKitEnabled=false` and that this binary has no IAP. `docs/compliance/submission-blockers.md` row 3 says those notes are not pasted into App Store Connect. No App Store Connect IAP catalog is in the tree.
- Remediation: Paste the no-IAP sentence into Notes for Review and confirm the portal catalog is empty.
- Source: https://developer.apple.com/app-store/review/guidelines/#app-completeness
- Confidence: 8

#### [ASR-2.2.b] TestFlight builds are for public distribution

- Status: GAP
- Severity: major
- Kind: required
- Rule: Any app submitted for beta distribution via TestFlight must be intended for public distribution and must comply with the App Review Guidelines.
- Evidence: `docs/compliance/testflight-process.md` §9 marks “First archive uploaded” and “App Store Review submit” open. No TestFlight review record is in the tree. The process text says the binary is meant for the public store after internal smoke.
- Remediation: Upload only a guideline-compliant build that is intended to ship publicly, after the review API and notes exist.
- Source: https://developer.apple.com/app-store/review/guidelines/#beta-testing
- Confidence: 7

#### [ASR-2.2.d] Significant beta updates go through TestFlight App Review

- Status: GAP
- Severity: major
- Kind: required
- Rule: Significant updates to a beta build must be submitted to TestFlight App Review before being distributed to testers.
- Evidence: `docs/compliance/testflight-process.md` §9: first archive is not uploaded. No TestFlight review history or changelog-versus-submission record is in the tree.
- Remediation: After the first upload, send significant changes through TestFlight App Review before a wide tester group.
- Source: https://developer.apple.com/app-store/review/guidelines/#beta-testing
- Confidence: 8

#### [ASR-2.3.0] Metadata matches the core experience

- Status: GAP
- Severity: major
- Kind: required
- Rule: Privacy information, description, screenshots, and previews must accurately reflect the app’s core experience and stay current.
- Evidence: Draft description and What’s New are in `docs/compliance/release-notes/1.0.0.md`. Privacy manifest is `ios/NoMarkup/PrivacyInfo.xcprivacy` (and the widget copy). `docs/compliance/asc-packaging-checklist.md` §4 and §6 and `submission-blockers.md` rows 3–5 mark nutrition labels, description, and screenshots as not entered in App Store Connect.
- Remediation: Enter the privacy table from the manifest and upload screenshots of this binary’s native tabs.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 8

#### [ASR-2.3.1.a.2] Specific Notes for Review

- Status: GAP
- Severity: major
- Kind: required
- Rule: New features and product changes must be described specifically in Notes for Review and must be reachable by the reviewer.
- Evidence: `docs/compliance/app-review-notes.md` has a specific paste block (widgets, 18+ gate, UGC report/block, Stripe rail, no IAP). `submission-blockers.md` row 3 says the notes are not in App Store Connect, and the same file says the review API is not up, so the path is not exercisable in review.
- Remediation: Paste the block only after each bullet works on the live review API.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 8

#### [ASR-2.3.14.a] Creative assets match the app and suit all audiences

- Status: GAP
- Severity: major
- Kind: required
- Rule: Creative assets used across the App Store, including the product page header and search results, must pertain to the app or brand, follow metadata rules, and be appropriate for all audiences.
- Evidence: App icon (`AppIcon-1024.png`) is the NoMarkup mark. `asc-packaging-checklist.md` §6 defers Custom Product Pages. No product-page header or search creative is in the tree.
- Remediation: If header or search assets are added, use this icon and in-app UI only.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 7

#### [ASR-2.3.14.b] Creative assets omit prices, competitor bait, and unverifiable claims

- Status: GAP
- Severity: major
- Kind: required
- Rule: Creative assets should not include inappropriate content, misleading references to other apps, unverifiable product claims, or specific or discounted pricing.
- Evidence: The app icon has no price, discount, or other-app name. No other App Store creative file is in the tree to scan. Asset bar cited by the registry: https://developer.apple.com/app-store/asset-best-practices/#asset-guidelines
- Remediation: Keep prices, “#1”, and competitor marks out of any later header art.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 7

#### [ASR-2.3.2.a] Listing media discloses extra purchases

- Status: GAP
- Severity: major
- Kind: required
- Rule: If the app includes in-app purchases, the description, screenshots, and previews must clearly indicate that featured items require additional purchases.
- Evidence: Shipping `StoreKitEnabled` is false and `PlanLimitsView` labels paid tiers read-only. The draft description says there is no in-app purchase (`release-notes/1.0.0.md`). No App Store Connect screenshot or preview set is in the tree (`app-store-screenshot-matrix.md` upload row unchecked), so listing media cannot be checked.
- Remediation: Do not feature Pro or Business as included in shots while IAP is off; if IAP stays off, keep the “no in-app purchase” line in the description.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 8

#### [ASR-2.3.3] Screenshots show the app in use

- Status: GAP
- Severity: major
- Kind: required
- Rule: Screenshots must show the app in use, not only title art, a login page, or a splash screen.
- Evidence: `docs/compliance/app-store-screenshot-matrix.md` lists real surfaces (home, marketplace, jobs, messages, account) and leaves “Uploaded to ASC Media Manager” unchecked. It says not to commit fake PNGs. No store screenshot set is in the tree.
- Remediation: Capture signed-in native UI on the required 6.9-inch iPhone and 13-inch iPad sizes.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 9

#### [ASR-2.3.4.a] Previews are screen captures of the app

- Status: GAP
- Severity: major
- Kind: required
- Rule: Previews may only use video screen captures of the app itself.
- Evidence: `app-store-screenshot-matrix.md` “App preview video” is optional and no preview file is in `ios/` or `docs/compliance/`.
- Remediation: Omit previews, or submit only a device capture of this binary.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 8

#### [ASR-2.3.6.a] Honest age-rating answers

- Status: GAP
- Severity: major
- Kind: required
- Rule: Answer age-rating questions in App Store Connect honestly so the app aligns with parental controls.
- Evidence: `docs/compliance/asc-content-rating-answers.md` drafts User-Generated Content Yes, Messaging Yes, Advertising None, and not Kids Category, matching `AgeGateView` (18+) and in-app chat/listings. `submission-blockers.md` row 6: the questionnaire is not entered in App Store Connect.
- Remediation: Enter that table without lowering UGC or chat to chase a 4+ badge.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 8

#### [ASR-2.3.7.a] Unique name and accurate keywords

- Status: GAP
- Severity: major
- Kind: required
- Rule: Choose a unique app name and keywords that describe the app, and do not stuff trademarks, popular app names, prices, or irrelevant phrases.
- Evidence: `Info.plist` `CFBundleDisplayName` is `NoMarkup`. `asc-packaging-checklist.md` §10 and `submission-blockers.md` row 3: keywords are not entered. No keyword field is in the iOS target.
- Remediation: Enter keywords for local jobs, auctions, and the marketplace only. Do not add competitor names or prices.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 8

#### [ASR-2.3.7.c] No prices or off-type copy in name, subtitle, screenshots, or previews

- Status: GAP
- Severity: major
- Kind: required
- Rule: Metadata such as app names, subtitles, screenshots, and previews must not include prices, terms, or descriptions that are not specific to that metadata type.
- Evidence: Draft What’s New and description in `release-notes/1.0.0.md` have no `$` price or discount. `app-store-screenshot-matrix.md` forbids fake StoreKit prices. No uploaded screenshot, preview, or subtitle field is in the tree to scan.
- Remediation: Keep prices out of the name, subtitle, and screenshots when the listing is created.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 7

#### [ASR-2.3.7.d] Subtitle has no other apps or unverifiable claims

- Status: GAP
- Severity: major
- Kind: required
- Rule: App subtitles must follow metadata rules and must not include inappropriate content, reference other apps, or make unverifiable product claims.
- Evidence: Proposed subtitle in `asc-packaging-checklist.md` is “Local jobs & marketplace”. It is not an Info.plist key and `submission-blockers.md` row 3 says it is not entered in App Store Connect.
- Remediation: Enter that subtitle, or another on-product line, with no “#1”, competitor names, or price.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 8

#### [ASR-2.3.8.a] Store visuals stay appropriate for a 4+ rating

- Status: GAP
- Severity: major
- Kind: required
- Rule: Icons, screenshots, and previews must adhere to a 4+ age rating even if the app is rated higher.
- Evidence: `AppIcon.appiconset/AppIcon-1024.png` is a metallic “M” with a down arrow and the word NoMarkup; no violence or sexual content. Dark and tinted slots are in `Contents.json`. No screenshot or preview set is in the tree (`app-store-screenshot-matrix.md`).
- Remediation: Keep the icon. Review every uploaded shot against the same 4+ bar.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 8

#### [ASR-2.3.9.a] Rights to metadata materials

- Status: GAP
- Severity: major
- Kind: required
- Rule: You are responsible for securing the rights to use all materials in app icons, screenshots, and previews.
- Evidence: `asc-packaging-checklist.md` records a content-rights answer of “you own or license,” and the icon is the in-repo brand master (`AppIcon.appiconset`). No third-party image license file is in `docs/compliance/`. Screenshots are not produced, so depicted UGC and faces cannot be checked.
- Remediation: Use only the owned icon and first-party UI seeded with fictional accounts.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 7

#### [ASR-2.3.9.b] Fictional accounts in screenshots and previews

- Status: GAP
- Severity: major
- Kind: required
- Rule: Display fictional account information instead of data from a real person in metadata assets.
- Evidence: Demo emails in `app-review-notes.md` are seed addresses (`customer@nomarkup.com`). No screenshot or preview set exists to inspect (`app-store-screenshot-matrix.md`).
- Remediation: Capture store media only from seed accounts, not live users.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 8

#### [ASR-2.4.2.a] Efficient power use and no hardware damage

- Status: GAP
- Severity: major
- Kind: required
- Rule: Design the app to use power efficiently and not risk damage to the device, including battery, heat, and unnecessary storage writes.
- Evidence: No in-app copy tells the user to charge under a pillow or restart into a stress pose. `ProviderInstantOffersView` uses a 15-second `Timer.publish` only while that view is shown. Widget timelines refresh at 15 minutes (`ActiveBidsProvider`). `docs/compliance/ios-instruments-culture.md` and `device-smoke-checklist.md` rows I1–I3 (Time Profiler and Allocations) are unsigned. No energy or thermal log is in `docs/compliance/`.
- Remediation: Run a Release Time Profiler and energy log on device for browse, map, and chat before submission.
- Source: https://developer.apple.com/app-store/review/guidelines/#hardware-compatibility
- Confidence: 7

#### [ASR-2.5.5] Functional on IPv6-only networks

- Status: GAP
- Severity: major
- Kind: required
- Rule: Apps must be fully functional on IPv6-only networks.
- Evidence: Release base is the hostname `AppConfig.productionAPIBaseURL` (`https://api.no-markup.com`). Release `resolveAPIBaseURL` rejects non-HTTPS overrides. IPv4 literals (`127.0.0.1`, `DevAPIBase.lanURLString`) are DEBUG or tests. No IPv6-only or NAT64 test result is in `docs/compliance/` or `ios/` tests. Review notes say the API host is not provisioned, so dual-stack behavior is unproven.
- Remediation: After DNS exists, run login and browse on an IPv6-only network.
- Source: https://developer.apple.com/app-store/review/guidelines/#software-requirements
- Confidence: 8

#### [ASR-3.0.1] Explain the business model

- Status: GAP
- Severity: major
- Kind: required
- Rule: If the app’s business model is not obvious, explain it in App Store metadata and App Review notes.
- Evidence: Draft only at `docs/compliance/app-review-notes.md` (Rail A Stripe/Apple Pay, `StoreKitEnabled=false`). No `fastlane/metadata` and no committed App Store description. The draft says the platform fee comes out of the seller payout, but `MarketplaceService.ChargeListingWinner` sets the PaymentIntent to `order.AmountCents + feeCents + taxCents` (`services/payment/internal/service/listing_charge.go`).
- Remediation: Paste corrected notes into App Store Connect (buyer charge is item + fee + tax; seller payout is separate) and ship a description that states the same. Do not leave the fee story contradictory.
- Source: https://developer.apple.com/app-store/review/guidelines/#business
- Confidence: 8

#### [ASR-4.4] Extensions comply and are disclosed

- Status: GAP
- Severity: major
- Kind: required
- Rule: Apps that host extensions must follow Apple’s extension guides, should include some functionality such as help or settings, must disclose extensions in marketing text, and must not put marketing, ads, or IAP in the extension.
- Evidence: `NoMarkupWidgetBundle` ships `ActiveBidsWidget`, `NextClosingWidget`, `AuctionLiveActivityWidget`, and iOS 18 controls. Widget entitlements are only the app group. No StoreKit or ad SDK in `ios/NoMarkupWidget`. In-app help is `AccountView` “Widgets & Live Activities” (`account.row.widgets`). There is no App Store description in the tree; disclosure lives in the unsubmitted draft `docs/compliance/app-review-notes.md`.
- Remediation: Put the widget, Live Activity, and Control Center list in the App Store description before submission. Keep ads and IAP out of the extension.
- Source: https://developer.apple.com/app-store/review/guidelines/#design
- Confidence: 8

#### [ASR-5.6.2] Accurate developer identity

- Status: GAP
- Severity: major
- Kind: required
- Rule: Representation of the developer, business, and offerings on the App Store must be accurate, truthful, relevant, and up to date so customers and Apple can contact the developer.
- Evidence: Binary identity is `NoMarkup` / `com.nomarkup.app` and support mail `support@no-markup.com`. App Store Connect seller name, support URL, and contact are not shown as filled; `app-review-notes.md` still lists them as founder residuals. Cannot confirm the portal identity matches the binary.
- Remediation: Set the legal seller name, support URL, and support email in App Store Connect to the NoMarkup entity and `support@no-markup.com`, and verify the mailbox receives mail.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 7

#### [ASR-BYS.5] Ongoing support

- Status: GAP
- Severity: major
- Kind: required
- Rule: The app must continue to function as intended and be actively supported, or it may be removed from the App Store.
- Evidence: The tree is actively maintained (native client, `NoMarkupTests`, `NoMarkupUITests`). `AccountView` row `account.row.support` opens `LegalWebView` with `fallback: .nativeSupport` and `mailto:support@no-markup.com`. No evidence the mailbox is monitored or that a post-ship on-call owns safety features. Production support host is the unprovisioned zone in `app-review-notes.md`.
- Remediation: Monitor `support@no-markup.com`, publish `https://no-markup.com/support`, and name an owner for report/block outages after release.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 7

#### [ASR-PRE-01] Test for crashes and bugs

- Status: GAP
- Severity: major
- Kind: required
- Rule: Test the app for crashes and bugs before submission.
- Evidence: Unit tests exist under `ios/NoMarkupTests` (including `AgeGateMathTests`, `APIClientTests`, `CheckoutSecretTests`) and UI tests under `ios/NoMarkupUITests`. No signed crash-free submission run or empty known-blocker list for the binary that would be uploaded.
- Remediation: Run the smoke path in the review notes on a release build against the review API and record a crash-free result before submit.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 7

#### [ASR-PRE-08] App still supported

- Status: GAP
- Severity: major
- Kind: required
- Rule: Apps that no longer function as intended or are no longer actively supported will be removed from the App Store.
- Evidence: Code is in active development. No support roster, on-call, or regression sign-off showing the binary will keep working after listing. Production host is unprovisioned, so “functions as intended” against the release API is not shown.
- Remediation: Name a maintainer, publish support, and do not submit until the release API serves the core marketplace flows.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 7

Advisory:

- ASR-2.3.4.b — GAP: Preview narration and overlays only explain the video
- ASR-2.3.5 — GAP: Category matches the app
- ASR-2.3.7.e — GAP: Keyword abuse can be modified by Apple
- ASR-5.6.4 — GAP: App quality signals
- ASR-POST-01 — GAP: Review timing and repeat violations
- ASR-POST-02 — GAP: Watch App Store Connect status
- ASR-POST-03 — GAP: Expedite requests
- ASR-POST-04 — GAP: Future release date
- ASR-POST-05 — GAP: Rejection dialogue
- ASR-POST-06 — GAP: Appeals
- ASR-POST-07 — GAP: Bug-fix submissions
- ASR-PRE-07 — GAP: Follow Apple design and brand documentation

### App Store Connect

#### [ASC-19] Step 6 / version and version localizations

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Create an iOS version whose `versionString` equals `CFBundleShortVersionString`, and do not send `whatsNew` on the first version.
- Evidence: `project.pbxproj` `MARKETING_VERSION = 1.0.0` (first public version per `asc-packaging-checklist.md` §3). `docs/compliance/release-notes/1.0.0.md` is titled as the source of truth for What’s New and says “Process: copy the paste block into ASC → Version Information → What's New at submit time” for v1.0.0. That contradicts “`whatsNew` is not allowed on the first version.” A description draft exists in the same file and is not entered (`submission-blockers.md` row 3). Not found in tree: `metadata/version/en-US.json`, a keywords string, or `copyright` on a version. Support URL `https://no-markup.com/support` is only proposed, and DNS is still open (`launch-board.md`).
- Remediation: Create version `1.0.0` with copyright, the description draft, a ≤100-byte keyword list, and `supportUrl` only after `https://no-markup.com/support` resolves. Do not paste `release-notes/1.0.0.md` into What’s New. Reserve that text for TestFlight What to Test or for 1.0.1.
- Source: https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- Confidence: 9

#### [ASC-20] Step 7 / screenshots via the App Asset Library (current)

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Upload exact-size PNG or JPEG screenshots with no alpha through the App Asset Library, including the required iPhone Dynamic Island medium group (or a large group App Store Connect scales from) and an iPad group when the app supports iPad.
- Evidence: `docs/compliance/app-store-screenshot-matrix.md` says no production screenshot set is committed, and its founder checklist requires the 6.9-inch and 13-inch sets “composited in Apple bezels” and then “Uploaded to ASC Media Manager.” `docs/compliance/asc-screenshot-frames.md` points those bezels at marketing-guideline product images. Bezel composites are not exact slot sizes and commonly include alpha, which the asset library rejects or mismatches. The app is universal (`TARGETED_DEVICE_FAMILY = "1,2"`). Not found in tree: `shots/<locale>/<PLACEMENT_GROUP>/*.png` or a screenshots-upload dry run. `launch-board.md` column 9 is open.
- Remediation: Capture raw unframed screenshots at a spec the asset library lists for `IPHONE_DYNAMIC_ISLAND_MEDIUM_PROFILE` or the large group it scales from, plus the 13-inch iPad group, with no alpha. Keep Apple bezels for marketing only. Upload at most 10 screenshots per group onto an editable version.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/migrating-to-the-app-asset-library
- Confidence: 8

#### [ASC-28] Step 11a / App Review details

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Provide review contact fields and a working demo account when features sit behind sign-in, and never store the demo password in the repo.
- Evidence: Sign-in is required for the signed-in app (`docs/compliance/app-review-notes.md` lists `customer@nomarkup.com` and the other seed roles). That file correctly says the password belongs only in the ASC password field, and `submission-blockers.md` row 8 says the password is not in App Store Connect and contact email/phone are still founder-open (`asc-packaging-checklist.md` §2). The same demo password is committed anyway: `ios/NoMarkupUITests/NoMarkupUITests.swift` defaults `NOMARKUP_UI_TEST_PASSWORD` to `Password123!` for `customer@nomarkup.com`, and `qa/scripts/qa-creds.env` sets `QA_PASSWORD=Password123!`. Not found in tree: `metadata/review.json` with the four contact fields.
- Remediation: Remove the committed demo password from UI-test defaults, `qa-creds.env`, and docs; rotate every seeded account that used it. Enter contact first name, last name, phone, and `support@no-markup.com` in App Review Information, set the demo account name to `customer@nomarkup.com`, and supply the password only from an environment variable at push time.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstorereviewdetails
- Confidence: 9

#### [ASC-35] Build numbers and versions

- Status: RISK
- Severity: major
- Kind: required
- Rule: `CFBundleShortVersionString` must equal the version being submitted, `CFBundleVersion` must be unique per upload, and either the project or Xcode may own the numbers, but not both.
- Evidence: `project.pbxproj` sets `MARKETING_VERSION = 1.0.0` and `CURRENT_PROJECT_VERSION = 3` on app and widget, and `Info.plist` maps those to `CFBundleShortVersionString` and `CFBundleVersion`. There is no `project.yml`. Not found in tree: an export plist key `manageAppVersionAndBuildNumber` = false. `testflight-process.md` §2 tells the founder to bump the build “in Xcode or project,” and §4.1 uses Organizer, whose export default is to let Xcode manage the build number. That is the dual-ownership case. No upload has yet shown a rewritten number (`launch-board.md` column 4 open).
- Remediation: Pin export `manageAppVersionAndBuildNumber` to false and bump only `CURRENT_PROJECT_VERSION` in the project. Confirm the next upload’s build string is greater than any build already processed.
- Source: https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds
- Confidence: 8

#### [ASC-10] Step 1 / bundle ID and capabilities

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Register the explicit bundle ID and each entitlement-backed capability, and give every extension its own bundle ID.
- Evidence: `ios/NoMarkup.xcodeproj/project.pbxproj` sets `PRODUCT_BUNDLE_IDENTIFIER = com.nomarkup.app` and `com.nomarkup.app.widget`, `DEVELOPMENT_TEAM = 6L6565278C`, `CODE_SIGN_STYLE = Automatic`. `ios/NoMarkup/NoMarkup.entitlements` has `com.apple.developer.applesignin`, `com.apple.developer.in-app-payments` (`merchant.com.nomarkup.app`), `aps-environment`, `com.apple.security.application-groups` (`group.com.nomarkup.app`), and `com.apple.developer.associated-domains`. `docs/compliance/submission-blockers.md` row 1 is still open and only tells the founder to create `com.nomarkup.app` with Sign in with Apple. No portal capability list is in the tree. Not found in tree: a bundle-id listing or release-plan step 1.
- Remediation: Register `com.nomarkup.app` and `com.nomarkup.app.widget`, enable Sign in with Apple, Push, Apple Pay, Associated Domains, and App Groups (including `group.com.nomarkup.app`) on the matching IDs, then confirm the portal capability list covers the entitlements before archive.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/post-v1-bundleids
- Confidence: 9

#### [ASC-11] Step 2 / certificates and profiles, or automatic signing

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Export with automatic cloud-managed signing (`-allowProvisioningUpdates` plus an API key), or create distribution certificates and App Store profiles, and never commit `.p12` or `.mobileprovision` files.
- Evidence: Release and Debug app configs in `project.pbxproj` set `CODE_SIGN_STYLE = Automatic` and `CODE_SIGN_IDENTITY = "Apple Development"` with team `6L6565278C`. `docs/compliance/submission-blockers.md` row 2 still lists the distribution certificate, App Store profile, and archive upload as founder-open. `docs/compliance/testflight-process.md` §4.2 archives only; it does not pass `-exportArchive`, `-allowProvisioningUpdates`, or `-authenticationKey*`. Not found in tree: `scripts/asc/upload_build.sh`, `ExportOptions.plist`, or a VALID build. No committed `.p12` or `.mobileprovision` turned up in the packaging search.
- Remediation: Add an export plist with `signingStyle` automatic and `method` `app-store-connect`, and export with `-allowProvisioningUpdates` and a team API key stored outside the repo. Do not rely on a logged-in Xcode account for the headless path.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/post-v1-profiles
- Confidence: 9

#### [ASC-12] Step 3 / app record (HUMAN)

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: The API cannot create an app record; a person with Account Holder, App Manager, or Admin must create it in App Store Connect with platforms, name, primary language, bundle ID, SKU, and user access.
- Evidence: `docs/compliance/testflight-process.md` §0 item 2 and `docs/compliance/launch-board.md` founder column 3 still say “Create ASC app record” is open. `docs/compliance/asc-packaging-checklist.md` §1 proposes name `NoMarkup`, bundle `com.nomarkup.app`, and SKU “e.g. `nomarkup-ios-001`” (not locked). Not found in tree: `docs/studio/human-steps.md` or a successful app lookup. Creating the record is human-only, so this cannot be PASS.
- Remediation: Have an Account Holder, Admin, or App Manager create the iOS app with name `NoMarkup`, primary language `en-US`, bundle ID `com.nomarkup.app`, and a one-time SKU such as `nomarkup-ios-001`, and record those four values as done only after the record exists.
- Source: https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app
- Confidence: 9

#### [ASC-13] Step 4a / app info localizations

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Per locale, set a 2–30 character name, an optional subtitle of at most 30 characters, and a required iOS privacy policy URL on the editable app info.
- Evidence: `docs/compliance/asc-packaging-checklist.md` §1 proposes name `NoMarkup` (8), subtitle `Local jobs & marketplace` (24), and privacy URL `https://no-markup.com/privacy`. §10.2 still marks subtitle, description, and keywords as not entered. `docs/compliance/launch-board.md` says `no-markup.com` DNS is open and the origin does not resolve. Not found in tree: `metadata/app-info/en-US.json` or a metadata-push dry run.
- Remediation: Publish `https://no-markup.com/privacy` so it returns the real policy, then set `en-US` name, subtitle, and `privacyPolicyUrl` on the editable app info (not a record already in `READY_FOR_DISTRIBUTION`).
- Source: https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appinfolocalizations-_id_
- Confidence: 9

#### [ASC-14] Step 4b / categories

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Set a primary category, and an optional secondary category, using category IDs from the API rather than display names.
- Evidence: `docs/compliance/asc-content-rating-answers.md` §3 and `asc-packaging-checklist.md` §1 propose display names Shopping and Lifestyle. `submission-blockers.md` row 3 and `launch-board.md` column 3 leave categories unentered. Not found in tree: `metadata/categories.json` or a `primaryCategory` relationship using an `appCategories` id.
- Remediation: PATCH the editable app info with real category ids (confirm `SHOPPING` and `LIFESTYLE` against the category list) and do not send a subcategory unless the category is Games or Stickers.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appinfos-_id_
- Confidence: 9

#### [ASC-15] Step 4c / age rating declaration

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Answer every age-rating frequency and boolean field so none are null, and match real features such as chat and user-generated content.
- Evidence: `docs/compliance/asc-content-rating-answers.md` §2 drafts User-Generated Content Yes, Messaging and Chat Yes, Advertising None, Gambling No, and tells the founder not to enroll Made for Kids. `launch-board.md` column 8 is still unchecked. The draft is not a null-free declaration: it omits loot box, health or wellness, social media, age assurance, graphic sexual content, and prolonged violence, and it hedges mature themes as “None (or Infrequent/Mild)”. Parental controls is written “N/A Kids”, not a boolean. Not found in tree: `metadata/age-rating.json`.
- Remediation: Expand the draft to every frequency and boolean field (`userGeneratedContent` and `messagingAndChat` true, `advertising` and `gambling` false, `kidsAgeBand` unset), resolve the mature-theme hedge from the live catalog, and enter it in App Store Connect before submit.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-ageratingdeclarations-_id_
- Confidence: 8

#### [ASC-17] Step 4e / pricing and availability

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: A price schedule (free apps use the zero customer price point) and territory availability must both exist before the first submission.
- Evidence: Packaging and `launch-board.md` founder columns 1–14 never mention a price schedule, a USA base territory, a zero price point, or availability in new territories. Not found in tree: price or availability JSON. This audit did not call App Store Connect, so the registry’s example sentence about a live availability gap was not reused as evidence.
- Remediation: Create a price schedule for a free price point with base territory USA, and set availability for the intended storefronts, including whether new territories are included.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/post-v1-apppriceschedules
- Confidence: 8

#### [ASC-18] Step 5 / app privacy nutrition label (HUMAN)

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Privacy data types are not API-settable; an Account Holder, Admin, or App Manager must answer them in App Store Connect and click Publish.
- Evidence: `ios/NoMarkup/PrivacyInfo.xcprivacy` lists linked, not-tracking types (email, name, phone, physical address, date of birth, precise and coarse location, photos, payment info, purchase history, customer support, user ID, device ID, other user content, sensitive info) and `NSPrivacyTracking` false. `docs/compliance/asc-packaging-checklist.md` §4.2 matches that inventory and marks “Type §4.2 into ASC App Privacy” as portal-only. `submission-blockers.md` row 5 is open. Not found in tree: `docs/studio/privacy-answers.md` or a human “Published” confirmation. Publishing is human-only, so this cannot be PASS.
- Remediation: Transcribe §4.2, including Device ID linked and not tracking, plus the payments SDK, into App Privacy and click Publish. Do not treat the markdown table as the label.
- Source: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy
- Confidence: 9

#### [ASC-22] Step 8 / IAP, subscriptions, review screenshot

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: In-app purchases and subscriptions need versions, localizations, prices, and a review screenshot, and the first product must be submitted with an app version.
- Evidence: `iap` and `subscriptions` flags are true because `ios/NoMarkup/Core/StoreKitManager.swift` exists. The v1 lock is the opposite: `Info.plist` `StoreKitEnabled` is false, `AppConfig.storeKitProductIDs` is empty unless an env or plist override is set (`AppConfig.swift`), and `NoMarkupTests/AppConfigTests.swift` asserts `storeKitEnabled` is false. `docs/compliance/launch-board.md` says “Do not create IAP products for v1.” Draft ids live only in docs (`asc-packaging-checklist.md` §7.2). Not found in tree: a release-plan step 8 row of N/A or DONE, or a review screenshot. The “none” outcome is the intended portal state but is not confirmed.
- Remediation: Leave App Store Connect with zero in-app purchases for this binary. When Rail B is enabled, create the subscription group and products with ids matching `storeKitProductIDs`, attach review screenshots, and submit those versions together with an app version.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/managing-in-app-purchases
- Confidence: 8

#### [ASC-23] Step 9a / export and upload the build

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Archive, then export and upload with API-key auth, `method` `app-store-connect`, and `destination` `upload`.
- Evidence: `docs/compliance/testflight-process.md` §4.1 is Xcode Organizer → Distribute App. §4.2 runs `xcodebuild archive` only and says there is no fastlane upload lane. `.github/workflows/ios-ci.yml` runs `xcodebuild test` on a simulator and does not export or upload. Not found in tree: `ExportOptions.plist` with `method` = `app-store-connect`, or an upload script printing `-authenticationKey*`. `launch-board.md` column 4 is open. Nothing in tree uses the deprecated `method` `app-store`.
- Remediation: Add ExportOptions with `method` `app-store-connect`, `destination` `upload`, `signingStyle` automatic, `teamID` `6L6565278C`, and `manageAppVersionAndBuildNumber` false, then export with an API key passed by path.
- Source: https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases
- Confidence: 9

#### [ASC-26] Step 9d / attach the build to the version

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Attach exactly one VALID build to the App Store version, and answer export compliance first if the build would otherwise be Missing Compliance.
- Evidence: No app-store version and no uploaded build are recorded. `launch-board.md` columns 4 and 14 are open. Not found in tree: a build relationship patch or a release-plan row showing an attached build. The compliance key itself is present (`ASC-25`).
- Remediation: After a VALID build exists, attach that build id to the `1.0.0` version and re-check the relationship before review submission.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversions-_id_-relationships-build
- Confidence: 9

#### [ASC-29] Step 11b / review submission

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Submit only through reviewSubmissions, dry-run first, and send `submitted: true` only after an explicit yes, refusing when no build is attached.
- Evidence: `docs/compliance/launch-board.md` says do not claim submit-ready and column 14 is “Submit for App Review when 1–13 done.” Not found in tree: `scripts/asc/asc.py`, a three-step dry-run plan, or an exit-3 refusal. No submission has been sent, which matches “do not auto-submit,” but the required dry-run gate is absent.
- Remediation: Add a submit command that prints the review submission plan and exits without sending until a person passes an explicit apply flag, and that refuses while no build is attached.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissions
- Confidence: 8

#### [ASC-16] Step 4d / content rights, EULA

- Status: GAP
- Severity: major
- Kind: required
- Rule: Set `contentRightsDeclaration` before submission to either `DOES_NOT_USE_THIRD_PARTY_CONTENT` or `USES_THIRD_PARTY_CONTENT`.
- Evidence: `docs/compliance/asc-content-rating-answers.md` §1 answers “Does the app contain third-party content?” as Yes because of user listings, photos, chat, and reviews, which maps to `USES_THIRD_PARTY_CONTENT`. `launch-board.md` column 8 still has the questionnaire open. Not found in tree: an app record showing the attribute non-null. No custom EULA resource is in the tree (Apple’s standard EULA would apply).
- Remediation: Set `contentRightsDeclaration` to `USES_THIRD_PARTY_CONTENT` before submission. Do not declare `DOES_NOT_USE_THIRD_PARTY_CONTENT`.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-apps-_id_
- Confidence: 8

#### [ASC-24] Step 9b / processing-state polling

- Status: GAP
- Severity: major
- Kind: required
- Rule: After upload, poll build `processingState` until `VALID` before TestFlight or submit, at intervals of at least 30 seconds, and use a new `CFBundleVersion` per upload.
- Evidence: `CURRENT_PROJECT_VERSION = 3` in `project.pbxproj`. `testflight-process.md` §2 says the build number must be a monotonic integer and §4.1 says “Wait for processing,” with no 30-second poll, timeout, or refusal of a non-VALID build. Not found in tree: a builds listing or a processing loop. No upload is recorded (`launch-board.md` “First archive uploaded | Open”).
- Remediation: After the first upload, poll builds at ≥30s until build `3` (or the next unused build) is `VALID` or `INVALID`/`FAILED`, and bump `CURRENT_PROJECT_VERSION` for every re-upload.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds
- Confidence: 8

#### [ASC-27] Step 10 / TestFlight (summary)

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Before App Review, distribute the processed build through TestFlight, including an internal group and, for external testers, Test Information, review details, What to Test, and beta review.
- Evidence: `docs/compliance/testflight-process.md` documents internal-before-external order and says the ASC record, first archive, and internal group are open (§9). `launch-board.md` says the app is not submit-ready and column 14 (submit) stays after TestFlight. Not found in tree: a release-plan step 10 DONE, a beta group, or a beta-review submission. They have not skipped ahead to a submitted review, but the TestFlight distribution itself is not done.
- Remediation: Upload a VALID build, enable an internal group, finish device smoke, and only then consider external beta or App Review.
- Source: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview
- Confidence: 9

#### [ASC-37] Release-plan gate

- Status: GAP
- Severity: major
- Kind: required
- Rule: Before declaring ready to submit, every release-plan row must be DONE, N/A, WARN with a recorded reason, or HUMAN and listed in human-steps; a MISSING row blocks the verdict.
- Evidence: `docs/compliance/launch-board.md` and `submission-blockers.md` explicitly say the app is not submit-ready, which avoids a false READY claim. Not found in tree: `scripts/asc/asc.py`, `docs/studio/release-plan.txt`, or `docs/studio/human-steps.md`. `.github/workflows/ios-ci.yml` does not run a release-plan gate. The open founder rows are not machine-checked.
- Remediation: Run a release-plan for `com.nomarkup.app` and block “submission ready” until every MISSING row is cleared and every HUMAN row is listed with the exact values to type.
- Source: https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/overview-of-submitting-for-review
- Confidence: 9

Advisory:

- ASC-30 — GAP: Step 11c / release and phased release
- ASC-31 — GAP: Accessibility Nutrition Labels (API-settable)
- ASC-34 — GAP: Devices (development / ad hoc only)
- ASC-8 — GAP: Webhooks instead of polling

### App Store search

#### [ASO-2] Fields / length limits

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Name is 2–30 characters, subtitle at most 30, the keyword field at most 100 UTF-8 bytes, promotional text at most 170, and any IAP display name at most 35 and description at most 55.
- Evidence: `aso_check.py` did not lint store fields (no `docs/studio/platforms.yaml`). Home-screen name only: `ios/NoMarkup/Info.plist` `CFBundleDisplayName` = `NoMarkup` (8 characters). `docs/compliance/asc-packaging-checklist.md` proposes subtitle “Local jobs & marketplace” (24 characters) and marks ASC subtitle/keywords as founder-not-entered (`[~]`). No keyword field, promo text, or IAP display name in the studio metadata.
- Remediation: Put the chosen name, subtitle, keywords, and promo text in `platforms.yaml` and run `aso_check.py` before any App Store Connect push. Do not treat the packaging-checklist proposal as entered metadata.
- Source: https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
- Confidence: 9

#### [ASO-22] Brand lint on every store field

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Every store string passes `brand_check.py` for its surface before it leaves the machine; `09-gtm.md` explains the strings but does not quote them verbatim.
- Evidence: `docs/studio/brand.json` not found. No `appStoreName` / subtitle / keywords / promo / description surfaces to pipe through `brand_check.py`. `provision.py` push path not present for this hand-maintained app. Proposed subtitle lives only in `docs/compliance/asc-packaging-checklist.md`, which is not a brand-linted store field.
- Remediation: Add `brand.json`, run `brand_check.py` on each store surface, and keep the verbatim strings in `09-launch-copy.md` rather than copied into `09-gtm.md`.
- Source: internal rule
- Confidence: 9

#### [ASO-6] Banned words and claims

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: No generic terms, pricing or ranking claims, Apple marks, other platform names, or irrelevant phrases in metadata; each keyword needs a relevance note that it matches what the app sells.
- Evidence: No name/subtitle/keyword/promo set in `platforms.yaml` and no `09-gtm.md` §5 relevance note. `aso_check.py` exit 2. Binary display name `NoMarkup` has no banned word. Research and marketing drafts are not store fields and were not scored as public copy.
- Remediation: Lint the store fields for banned words and write a per-keyword relevance note in `09-gtm.md` §5. Do not copy competitor or ranking language from pitch or investor docs into metadata.
- Source: https://developer.apple.com/app-store/search/
- Confidence: 9

#### [ASO-7] Competitor and never-public names

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: No competitor app names, company names, celebrity names, trademarks, or internal-research strings in any store field.
- Evidence: No store strings to lint. `docs/studio/brand.json` not found (`voice.neverPublic` absent). `aso_check.py` / `brand_check.py` not run. Competitor names appear only in internal research (`docs/pitch.md`, `docs/one-pager.md`, `docs/investor-faq.md`), which are not public store copy.
- Remediation: Keep competitor names in `00-market.md` / `09-gtm.md` only. Run `aso_check.py` and `brand_check.py` on every store surface before push. Do not paste research sentences into the description.
- Source: https://developer.apple.com/app-store/search/
- Confidence: 9

#### [ASO-1] Search / what App Store search uses

- Status: GAP
- Severity: major
- Kind: required
- Rule: `09-gtm.md` §5 must state the confirmed indexed fields (name, subtitle, keyword field, categories, company name) and must not present UNCONFIRMED claims (caption indexing, field weights, stemming, cross-locale keyword combination) as fact.
- Evidence: `ios/docs/studio/09-gtm.md` not found in tree. `aso_check.py --app` exit 2 (no `platforms.yaml`). No §5 indexed-field statement.
- Remediation: Write `docs/studio/09-gtm.md` §5 from the ASO-1 confirmed list only. Do not claim screenshot captions are indexed.
- Source: https://developer.apple.com/app-store/search/
- Confidence: 9

#### [ASO-10] Target keyword set and coverage

- Status: GAP
- Severity: major
- Kind: required
- Rule: A target phrase set is built from the app’s own documents, metadata covers at least `minCoverage` (default 0.6), and every candidate has `volume: "unknown"` or a real `volumeSource`. No invented search volume.
- Evidence: `docs/studio/aso-keywords.json` not found. `aso_check.py --app` exit 2 (no coverage line). No Apple Ads popularity file in tree.
- Remediation: Run `aso_research.py` against the app docs, set `volume` to `unknown` until an Apple Ads export exists, and fail the gate if coverage is under `minCoverage`. Do not write “high volume”.
- Source: https://ads.apple.com/app-store/best-practices/keywords
- Confidence: 9

#### [ASO-11] Additional localizations indexed per storefront

- Status: GAP
- Severity: major
- Kind: required
- Rule: The localizations checklist row records whether any extra storefront language is added, and that decision belongs to the user; a second locale must be real copy in that language, not English keyword overflow.
- Evidence: No `09-gtm.md` localizations row. `ios/NoMarkup/Localizable.xcstrings` `sourceLanguage` is `en` and the only localization key present is `en` (1562 strings). No es-MX or other ASC localization in `platforms.yaml`.
- Remediation: Record “English (U.S.) only, because the app and listings are not localized” or ask the user before adding a locale. Do not add a locale to gain a second keyword field.
- Source: https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations
- Confidence: 9

#### [ASO-12] Custom product pages

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: The custom-product-pages checklist row lists each planned page (audience, screenshots, promo text, assigned keywords, deep link) or says why none, and every assigned keyword already exists on the version.
- Evidence: No `09-gtm.md` §5 checklist. No custom product page plan in `docs/compliance/asc-packaging-checklist.md`. Two audiences exist in the product (job posters and goods sellers/buyers) but no page assignment is recorded.
- Remediation: Record a decision: none until launch, or one page per intent (services vs goods) whose keywords are already in the version keyword field. Deep link to that flow, not the home screen.
- Source: https://developer.apple.com/app-store/custom-product-pages/
- Confidence: 8

#### [ASO-15] Ratings and reviews prompt

- Status: GAP
- Severity: major
- Kind: required
- Rule: Use only the system review prompt (`RequestReviewAction` or `AppStore.requestReview(in:)`), never from a button, after a success moment; a write-review control may open the store page with `?action=write-review`. The checklist names the trigger and the file:line of the call.
- Evidence: No `requestReview`, `RequestReviewAction`, `SKStoreReviewController`, or `write-review` in `ios/**/*.swift`. No `review-prompt` checklist row. `NPSSurveysView` is an in-app 0–10 recommend survey (`GET /api/v1/me/nps/pending`), not an App Store rating sheet. Contract and order reviews are user-to-user (`APIClient+Contracts.swift`, `APIClient+Commerce.swift`).
- Remediation: After a completed job or confirmed pickup, call the system prompt from a non-button success path, at least a week apart, and record the trigger and file:line. Do not add a custom “rate us” sheet. Leave NPS as product feedback.
- Source: https://developer.apple.com/documentation/storekit/requestreviewaction
- Confidence: 8

#### [ASO-19] Post-launch keyword iteration (evolve E6)

- Status: GAP
- Severity: major
- Kind: required
- Rule: Before launch, the keyword-iteration checklist row names the cadence, the Analytics reports, and the replacement rule; after launch, each change records the window, the metric, and the reason.
- Evidence: No `keyword-iteration` row and no evolve `RUN.md`. App is pre-submission (`asc-packaging-checklist.md` metadata still founder `[~]`). No Analytics report IDs in tree.
- Remediation: Record the plan now: at most one keyword change per version, using App Store Discovery and Engagement plus Downloads, and Apple Ads only for term-level data. Do not read “App Store search” as organic-only.
- Source: https://developer.apple.com/documentation/analytics-reports/app-store-discovery-and-engagement
- Confidence: 9

#### [ASO-3] Keyword field / format

- Status: GAP
- Severity: major
- Kind: required
- Rule: Keyword terms are comma-separated with no spaces around commas, each term longer than two characters, with no empty terms and no special characters.
- Evidence: No App Store keyword field in tree. `aso_check.py --app ios` exit 2. `Localizable.xcstrings` and in-app saved-search “keywords” are product search, not the ASC keyword field.
- Remediation: Author a comma-separated keyword field with no spaces after commas and lint it with `aso_check.py`.
- Source: https://developer.apple.com/app-store/search/
- Confidence: 9

#### [ASO-4] Keyword field / no duplication of indexed words

- Status: GAP
- Severity: major
- Kind: required
- Rule: The keyword field does not repeat any word of the name, subtitle, primary or secondary category, or the company name, and does not duplicate terms.
- Evidence: No keyword field, subtitle, or category pair in `platforms.yaml`. Proposed categories in `docs/compliance/asc-packaging-checklist.md` (Shopping, Lifestyle) are not a linted keyword list.
- Remediation: After the name, subtitle, and categories are chosen, drop those words from the keyword field and re-run `aso_check.py`.
- Source: https://developer.apple.com/app-store/search/
- Confidence: 9

#### [ASO-5] Keyword field / singular and plural

- Status: GAP
- Severity: major
- Kind: required
- Rule: Keep one of singular or plural; do not put both forms in the keyword field, and do not keyword the plural of a name or subtitle word.
- Evidence: No keyword field in tree. `aso_check.py` not runnable on store strings (exit 2).
- Remediation: When the keyword field is written, keep a single form of each word and lint with `aso_check.py`.
- Source: https://developer.apple.com/app-store/search/
- Confidence: 9

#### [ASO-9] Category fit

- Status: GAP
- Severity: major
- Kind: required
- Rule: The primary category best describes what the app mainly does, the secondary category is different, both are indexed, and the choice is justified with Apple’s category definitions in `09-gtm.md` §5.
- Evidence: No `09-gtm.md` §5 category paragraph. No `LSApplicationCategoryType` in `ios/NoMarkup/Info.plist` or `project.pbxproj`. `docs/compliance/asc-packaging-checklist.md` proposes Shopping + Lifestyle and leaves the ASC record as founder-not-entered. `aso_check.py` did not validate category IDs.
- Remediation: Record primary and secondary categories with Apple’s definitions in `09-gtm.md` §5, put them in `platforms.yaml`, and lint. Do not repeat category words in keywords.
- Source: https://developer.apple.com/app-store/categories/
- Confidence: 9

Advisory:

- ASO-13 — GAP: In-app events
- ASO-14 — GAP: Product page optimization (A/B tests)
- ASO-16 — GAP: Discoverability outside App Store search: App Clips, Spotlight, App Intents
- ASO-17 — GAP: Screenshot captions and App Store Tags
- ASO-20 — GAP: Apple Ads keyword research (human step)
- ASO-21 — GAP: Apple Business (formerly Business Connect) and Apple Maps
- ASO-23 — GAP: Promotional text
- ASO-8 — GAP: Keyword field / no wasted bytes

### Apple marketing

#### [MKT-12] Commerce / Apple In-App Purchase name and mark

- Status: FAIL
- Severity: major
- Kind: required
- Rule: When copy names Apple's payment system, write "Apple In-App Purchase" in that title case, with no "the" before it.
- Evidence: `iap` is true because the StoreKit scaffold ships, even though `Info.plist` `StoreKitEnabled` is false. User-facing strings still name the system without the required words: `Localizable.xcstrings` "(no In-App Purchase)"; `Models+Extras.swift` `planKindLabel` returns "Paid (In-App Purchase)" when StoreKit is on; `PlanLimitsView.swift` "Paid plans (In-App Purchase)"; `AccountView.swift` "subscribe with In-App Purchase" and "App Store In-App Purchase"; `StoreKitManager.swift` "In-App Purchase is not enabled in this build." None of these lines is the exact phrase "Apple In-App Purchase". `eu_market` is false, so the EU equal-prominence clause does not apply.
- Remediation: Use "Apple In-App Purchase" wherever the system is named, including the off-state disclaimer. Keep generic lowercase "in-app purchases" only when not naming Apple's system.
- Source: https://developer.apple.com/support/payment-options-on-the-app-store-in-the-eu/
- Confidence: 9

#### [MKT-13] Apple services / names and system buttons

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Draw Apple Pay and Sign in with Apple only with the system buttons, never an Apple logo or look-alike, and show Apple Pay messaging only when the device can pay.
- Evidence: Sign-in uses the system control: `SignInWithAppleButton.swift` `SignInWithAppleButton(.signIn)` with `.signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)`. Checkout uses `PayWithApplePayButton` in `MyOrdersView.swift` (about line 237) and `ListingDetailView.swift` (about line 1273). Those pay buttons are not gated on `PKPaymentAuthorizationController.canMakePayments()`; that call exists only in `NoMarkupUITests/DeviceCapabilityUITests.swift`. The orders control is always labeled "Pay with Apple Pay" while the hint says it may open card checkout. `OAuthAccount.systemImage` returns `"apple.logo"` (`Models+Extras.swift`) and `SecuritySettingsView.swift` draws it with `Image(systemName: account.systemImage)`.
- Remediation: Show `PayWithApplePayButton` and the "Pay with Apple Pay" label only when `canMakePayments()` is true; otherwise use a non-Apple pay label. Replace `apple.logo` with a non-logo symbol (the row already says "Apple").
- Source: https://developer.apple.com/app-store/marketing/guidelines/
- Confidence: 9

#### [MKT-16] Trademarks / Apple logo, slogans, trade dress and endorsement

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Never use the Apple logo in any form, including the `apple.logo` symbol, and never suggest Apple endorses or certifies the app.
- Evidence: `Models+Extras.swift` `OAuthAccount.systemImage` case `"apple"` returns `"apple.logo"`, rendered by `SecuritySettingsView.swift` `Image(systemName: account.systemImage)`. No U+F8FF, "Think different", "There's an app for that", "Apple-approved", or "official Apple" hit in the iOS tree.
- Remediation: Delete the `apple.logo` mapping. Keep the word "Apple" as the account name.
- Source: https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html
- Confidence: 9

#### [MKT-3] Trademarks / referring to the App Store

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Write "App Store" with a capital A and S and the article "the"; never "Apple App Store", "iPhone App Store", "iTunes App Store", or "at the App Store".
- Evidence: Rendered privacy copy: `web/src/app/(public)/privacy/page.tsx` "by applicable law and the Apple App Store Review Guidelines." In-app descriptors also modify the mark ("App Store IAP", "App Store subscriptions", "App Store In-App Purchase") in `Localizable.xcstrings` and `AccountView.swift` (about lines 896 and 921). No `at the app store` or `best app store` hit.
- Remediation: Change the privacy sentence to "the App Store Review Guidelines". In user-facing strings say "Apple In-App Purchase" or "not sold in this app", not "App Store IAP" / "App Store subscriptions".
- Source: https://developer.apple.com/app-store/marketing/guidelines/
- Confidence: 9

#### [MKT-18] Marketing surfaces / accurate, verifiable claims on every marketing surface

- Status: RISK
- Severity: major
- Kind: required
- Rule: Metadata, captions, the site, and in-app marketing lines may state only claims the app can back: no unverifiable superlatives, outcome guarantees, or unsubstantiated safety, certification, or "official" claims.
- Evidence: No "#1", "best app", "world's best", or "guaranteed" in iOS user strings. `brand_check` `voice` did not run (exit 2), and there is no ship-pack to length-check (name 30, subtitle 30, keywords 100). Site metadata keywords include "verified providers" (`web/src/app/layout.tsx`) with no nearby verification condition. In-app report footers say the reports "help keep NoMarkup safe", "keep the marketplace safe", and "keep jobs safe" (`ProviderDetailView.swift`, `ListingDetailView.swift`, `JobDetailView.swift`, `Localizable.xcstrings`).
- Remediation: Drop "verified providers" from public keywords unless every listed provider has passed verification. Rephrase report footers so they do not call the marketplace or jobs safe (for example, "Reports help moderators review this job."). Add `voice.legal` and run `brand_check.py` before publish.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 7

#### [MKT-7] Messaging / Apple product names and device claims

- Status: GAP
- Severity: major
- Kind: required
- Rule: Marketing copy names only the Apple products the app runs on, lists all of them, avoids "iOS"/"smartphone"/"tablet", and includes a download call to action.
- Evidence: `TARGETED_DEVICE_FAMILY = "1,2"` (`project.pbxproj`), so iPhone and iPad are both supported, and `ios/README.md` says "iPhone + iPad". There is no `docs/studio/09-ship-pack/metadata.md`. The site default description (`web/src/app/layout.tsx`) does not name iPhone and iPad and has no "Download on the App Store" line. No false Apple Watch or Mac claim was found. Device-list and download-CTA compliance of the store listing is not in the tree.
- Remediation: Add store description copy that lists iPhone and iPad (not "iOS") and ends with "Download NoMarkup on the App Store."
- Source: https://developer.apple.com/app-store/marketing/guidelines/
- Confidence: 7

Advisory:

- MKT-5 — FAIL: Legal / trademark symbols and credit lines
- MKT-10 — GAP: Imagery / bezels, generic devices, photography and video
- MKT-17 — GAP: Product page / copy quality across name, subtitle, description, promotional text and What's New
- MKT-8 — GAP: Badges / Download on the App Store badge on the hosted site and email
- MKT-9 — GAP: Badges / Smart App Banner on the hosted site

### Brand

#### [BRAND-6] Color / accessible contrast for every brand color

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Text and glyph brand colors need at least 4.5:1, UI fills and controls at least 3:1, on system and brand backgrounds in light, dark, and increased contrast, and a High Contrast variant must not be weaker than the standard one.
- Evidence: Light accent `#B89938` / catalog (0.720, 0.600, 0.220) is 2.75:1 on white, 2.50:1 on paper `#F6F4EF`, and 2.46:1 on `#F2F2F7`, which misses both 3:1 and 4.5:1. `BrandTheme.applyGlobalChrome` sets `UITabBar` selected icon and title and `UINavigationBar.tintColor` from `UIColor(named: "AccentColor")` on the light screen `#F6F4EF`. `HomeView.swift` also paints "REVERSE AUCTION" and other labels with `BrandTheme.gold` (the same light accent). `AccentColor` has no increased-contrast appearance, and `BrandTheme.gold` does not pass a lighter-contrast override, so Increase Contrast leaves the failing pair in place. Dark accent `#C9A84C` on navy `#07080B` is 8.76:1 and passes. The separate text token `goldBright` light `#806316` is 5.65:1 on white and 4.71:1 on raised `#EDEAE3`.
- Remediation: Point light-mode tint, tab titles, and any gold text at `#806316` (or the high-contrast `#6B520F`), and add those values as AccentColor High Contrast appearances. Keep `#C9A84C` for dark fills and for navy-on-gold labels (8.76:1).
- Source: https://www.w3.org/TR/WCAG22/
- Confidence: 9

#### [BRAND-12] Visual tokens / typography, SF Symbol style and corner radii

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Type is the system font via Dynamic Type, SF Symbols use one rendering mode and weight, and corner radii come from one continuous scale.
- Evidence: No `Font.custom` in the iOS target (system styles are used). Corner radii are ad-hoc numbers outside any token: 8, 10, 12, 14, 16, 18, 20, and 22 in `RegisterView.swift`, `ContractDetailView.swift`, `HomeView.swift`, `BrandTheme.swift` (`brandCard` and skeleton bars), and many feature files. `BrandTheme.swift` sets `.symbolRenderingMode(.hierarchical)` in one empty-state helper; other symbols leave mode and weight to the call site (`.fontWeight(.semibold)` is common). `RootTabView.swift` uses `.font(.system(size: 1))` on a hidden UI-test probe.
- Remediation: Replace numeric corner radii with one `Brand.Radius` scale. Apply one symbol style helper everywhere. Keep the UI-test probe off a fixed font size or mark it as a test-only exception.
- Source: https://developer.apple.com/design/human-interface-guidelines/typography
- Confidence: 8

#### [BRAND-15] Pipeline / brand.json valid, generated artifacts current

- Status: FAIL
- Severity: major
- Kind: required
- Rule: `brand.json` validates against the brand schema, and generated color sets, tokens, and captions carry the brand hash and are regenerated after every edit.
- Evidence: `ios/docs/studio/brand.json` is not in the tree. `brand_check.py` exited 2 with "brand.json not found" and wrote no report. There is no generated `BrandTokens.swift`, `site/brand.css`, or `brand-captions.json`, and no brand hash.
- Remediation: Add a schema-valid `brand.json` for the champagne/navy palette already in `BrandTheme.swift`, generate catalog colors from it, and re-run `brand_check.py` until it exits 0.
- Source: https://developer.apple.com/design/human-interface-guidelines/color
- Confidence: 10

#### [BRAND-21] Visual tokens / spacing and corner-radius scales

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Spacing and corner radii come from one scale, and views outside the design system do not write raw numbers into padding, corner radius, or stack spacing.
- Evidence: No `brand.json` `spacing`/`radii` and no `DesignSystem/Spacing.swift`. Feature views set `VStack(spacing: 4)`, `spacing: 8`, `spacing: 12`, `.padding(14)`, `.padding(32)`, and `RoundedRectangle(cornerRadius: 10…22)` throughout `ContractDetailView.swift`, `HomeView.swift`, `OnboardingWizardView.swift`, and `BrandTheme.brandCard(padding: 16)`. `0` spacing in `NoMarkupApp.swift` is the only allowed literal.
- Remediation: Declare one spacing and radius scale and replace numeric padding, stack spacing, and corner radii outside the token file.
- Source: https://developer.apple.com/design/human-interface-guidelines/layout
- Confidence: 9

#### [BRAND-22] Visual tokens / typography roles and custom fonts

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every text role lists its Dynamic Type styles and weights, and fixed point sizes do not appear outside the design system.
- Evidence: No `typography.roles` because `brand.json` is missing. There is no `Brand.Typography` / `.brandFont(.role)`. Call sites pick `.headline`, `.caption2`, and `.fontWeight(.semibold)` independently (`SecuritySettingsView.swift`, `RegisterView.swift`, `HomeView.swift`). The only `.font(.system(size:))` is the hidden probe in `RootTabView.swift` (`.font(.system(size: 1))`). No `Font.custom` in app code.
- Remediation: Define roles (title, headline, body, caption, numeric) and route text through one helper. Remove the fixed 1 pt probe font.
- Source: https://developer.apple.com/design/human-interface-guidelines/typography
- Confidence: 8

#### [BRAND-23] Components / one canonical implementation per component

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Primary, secondary, and destructive buttons, the card, the chip, the list row, and the empty state each have one implementation, and other files only use that set.
- Evidence: `BrandTheme.swift` declares `BrandPrimaryButtonStyle`, `BrandGhostButtonStyle`, `brandCard`, `glassProminentBrandCTA`, and `BrandEmptyState`, but there is no `brand.json` `components` list and no `DesignSystem/BrandComponents.swift`. Feature screens mostly call `.buttonStyle(.bordered)`, `.borderedProminent`, `.plain`, and on iOS 26 `.glassProminent` (`ContractDetailView.swift`, `ListingDetailView.swift`, `HomeView.swift`). Card chrome is also inlined as `RoundedRectangle` backgrounds in those files. `ContentUnavailableView` is a second empty-state pattern (see BRAND-18).
- Remediation: Pick one button style per role and stop passing `.bordered` / `.plain` for primary actions. Route cards and empty states through `brandCard` and `BrandEmptyState` only.
- Source: https://developer.apple.com/design/human-interface-guidelines/buttons
- Confidence: 8

#### [BRAND-27] Surfaces / per-surface constraints and pre-publish lint

- Status: FAIL
- Severity: major
- Kind: required
- Rule: `brand.json` lists every copy surface with its length and case limits, and every generator lints that surface with `brand_check.py` before publishing.
- Evidence: No `brand.json` `surfaces`. `brand_check.py` exits 2 before any `--surface` lint. No ship-pack metadata, caption file, TestFlight note, or review-reply draft is wired to a pre-publish lint. App Store hard limits therefore are not enforced in repo.
- Remediation: Declare the App Store, notification, widget, and purpose-string surfaces in `brand.json` and make metadata and site publish scripts call `brand_check.py --surface <name> --text-file -`, stopping on exit 1.
- Source: https://developer.apple.com/app-store/product-page/
- Confidence: 9

#### [BRAND-3] Icon / one icon everywhere

- Status: FAIL
- Severity: major
- Kind: required
- Rule: The same simple icon artwork, with no text, is the app icon on every surface, including Default, Dark, and Tinted variants.
- Evidence: `AppIcon.appiconset/Contents.json` lists a 1024 universal image plus `luminosity` `dark` and `tinted` files. The default PNG is a brushed-metal tile whose glyph is a large letter M with a down arrow and the word "NoMarkup" set underneath. `NoMarkupIcon` repeats that raster (`BrandAppIcon`) on the login header and the home hero. `ios/README.md` still describes the icon as an "N", which does not match the shipping M wordmark. The site claims the same raster (`web/src/app/layout.tsx`, `web/src/components/layout/AppIcon.tsx`); pixels were not compared.
- Remediation: Remove the "NoMarkup" wordmark and rely on the monogram only. Regenerate Default, Dark, and Tinted from that artwork and point the site favicon, apple-touch icon, and `BrandAppIcon` at the same files. Correct the README.
- Source: https://developer.apple.com/design/human-interface-guidelines/app-icons
- Confidence: 9

#### [BRAND-5] Color / one accent and semantic brand colors from the asset catalog

- Status: FAIL
- Severity: major
- Kind: required
- Rule: The brand has exactly one `AccentColor` global tint, and every brand color set has Any, Dark, High Contrast, and Dark + High Contrast appearances, with no stray RGB literals in views.
- Evidence: `ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor` (`project.pbxproj`). `AccentColor.colorset/Contents.json` has only a universal color (sRGB 0.720, 0.600, 0.220) and a dark appearance (0.788, 0.659, 0.298). There is no high-contrast or dark+high-contrast appearance, and no `Brand*` color sets. The rest of the palette lives as hex in `BrandTheme.swift`, not in the catalog. Extra literals: `WidgetSharedStore.swift` `WidgetBrand` `Color(red:)`, `GoogleSignInButton.swift` and `FacebookSignInButton.swift` `Color(red:)`, and the `NoMarkupIcon` preview.
- Remediation: Add High Contrast and Dark + High Contrast colors to `AccentColor` (darken the light gold; the current light accent is 2.75:1 on white). Move semantic colors into `Brand*` color sets or keep a single token file and delete the duplicated `Color(red:)` sites outside it.
- Source: https://developer.apple.com/design/human-interface-guidelines/color
- Confidence: 9

#### [BRAND-7] Brand vs HIG / where the brand may and may not show

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Bars, sheets, and alerts keep system material and behavior; there is no brand-colored tab bar and no repeated logo, while brand color stays in content.
- Evidence: On the iOS 17 deployment path, `BrandTheme.applyGlobalChrome` builds an opaque `UITabBarAppearance` and `UINavigationBarAppearance` with `backgroundColor` set to the brand screen color, and `brandNavigationBarChrome()` calls `.toolbarBackground(BrandTheme.navy, for: .navigationBar)` when not iOS 26. The mark is shown on the login header (`LoginView.swift` `NoMarkupIcon`) and again in the home hero (`HomeView.swift`). iOS 26 skips the opaque scroll-edge assignment, but iOS 17–25 still ship the fill.
- Remediation: Delete the opaque tab and nav appearances for all OS versions and leave system scroll-edge material. Keep `NoMarkupIcon` on the sign-in screen only.
- Source: https://developer.apple.com/design/human-interface-guidelines/branding
- Confidence: 8

#### [BRAND-26] Copy / legal phrasing

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: Never say "guaranteed", never call a product or condition "safe", and never say "official", "certified", or "verified <role>" unless that check has passed.
- Evidence: No `voice.legal` list (`brand.json` missing). No user-facing "guaranteed" or "official Apple". Report copy does use "safe": `JobDetailView.swift` "Reports help keep jobs safe."; `ListingDetailView.swift` "Reports help keep the marketplace safe."; `ProviderDetailView.swift` and `Localizable.xcstrings` "Reports help keep NoMarkup safe." Site keywords say "verified providers" (`web/src/app/layout.tsx`) without a per-provider verification check. Privacy-page uses of "safety" are in the legal document, which the registry exempts.
- Remediation: Encode these bans in `voice.legal`. Rephrase the three report footers. Remove "verified providers" from public keywords, and show "Verified" only next to a passed verification flag.
- Source: https://developer.apple.com/app-store/review/guidelines/#accurate-metadata
- Confidence: 8

#### [BRAND-30] Surfaces / research and competitors never public

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: No public surface names a competitor or another platform, cites internal research, or compares the app with other platforms.
- Evidence: `brand_check` `neverPublic` did not run, so the 10-word overlap with research files was not checked. Manual search of `ios` and `web/src` found "eBay", "Thumbtack", and "Craigslist" only in comments (`ListingDetailView.swift`, `MyBidsView.swift`, `APIClient.swift`, `JobPostingForm.tsx`, `useChatRelay.ts`), not in user-facing strings. The settings option "Switching to a competitor" (`web/src/app/(dashboard)/settings/account/page.tsx`) does not name a platform. No "Like Uber" or "unlike other apps" marketing line was found.
- Remediation: Re-run `brand_check.py` once `brand.json` exists so `neverPublic` can scan every locale and research file. Keep competitor names in comments out of strings.
- Source: https://developer.apple.com/app-store/review/guidelines/#2.3.7
- Confidence: 6

#### [BRAND-1] Naming / one name system across every surface

- Status: GAP
- Severity: major
- Kind: required
- Rule: One name system (`name`, `displayName`, `shortName`, `tagline`) must match across the App Store name, `CFBundleDisplayName`, site titles, and App Shortcut phrases.
- Evidence: Bundle and widget display names are both `NoMarkup` (`Info.plist`, `NoMarkupWidget/Info.plist`). Site `applicationName` and titles contain "NoMarkup" (`web/src/app/layout.tsx`). `NoMarkupAppShortcuts.swift` phrases use `\(.applicationName)`, not a hard-coded name. `docs/studio/brand.json` is absent, so the four name fields and a metadata `App name` equality check do not exist. No conflicting "No Markup" product name was found in the bundle keys.
- Remediation: Add `brand.json` with `name` and `displayName` both `NoMarkup`, `shortName` `NoMarkup`, and the tagline, and set the App Store name to that `name` exactly.
- Source: https://developer.apple.com/design/human-interface-guidelines/app-shortcuts
- Confidence: 8

#### [BRAND-25] Copy / voice lint over every user-facing string

- Status: GAP
- Severity: major
- Kind: required
- Rule: User-facing strings follow `voice`: no banned words, a cap on exclamation marks and emoji, a reading-level ceiling, and sentence case on sentence surfaces.
- Evidence: `brand_check` `voice` did not run. A search of `ios/NoMarkup` Swift and the String Catalog found no "oops", "whoops", or "click". There is no `voice.bannedWords`, `maxExclamations`, `emoji`, or `maxGrade` to score the rest of the catalog against. Purpose strings in `Info.plist` are sentence case and end with a period.
- Remediation: Add `voice` to `brand.json` and run `brand_check.py` on the String Catalog, purpose strings, and site. Fix any row it reports.
- Source: https://developer.apple.com/design/human-interface-guidelines/writing
- Confidence: 6

#### [BRAND-8] Copy / glossary and forbidden synonyms

- Status: GAP
- Severity: major
- Kind: required
- Rule: Each concept has one user-facing term, with forbidden variants listed in `brand.json` and enforced in the UI, store, and site.
- Evidence: `docs/studio/brand.json` `glossary` is not in the tree, and `brand_check` `glossary` did not run. Services say "provider" and goods say "seller" in different flows; that split was not proven to be two names for one concept. No automated forbidden-variant list exists to fail a string against.
- Remediation: Add a glossary (job, listing, bid, provider, seller, order) with forbidden synonyms and run `brand_check.py` on the String Catalog and site.
- Source: https://developer.apple.com/app-store/product-page/
- Confidence: 6

Advisory:

- BRAND-13 — FAIL: Personality / motion and haptics
- BRAND-16 — FAIL: System surfaces / notifications, widgets, Live Activities, App Intents and Siri
- BRAND-17 — FAIL: Launch / launch screen carries color, not branding
- BRAND-18 — FAIL: In-app moments / onboarding, empty states and errors
- BRAND-19 — FAIL: Off-app surfaces / hosted website and email
- BRAND-24 — FAIL: Visual tokens / SF Symbol style per context
- BRAND-29 — FAIL: Copy / units, numbers, dates and currency
- BRAND-9 — FAIL: Copy / capitalization style
- BRAND-10 — GAP: Copy / voice spectrum and reading level
- BRAND-2 — GAP: Naming / tagline and the store listing
- BRAND-20 — GAP: Release copy / TestFlight "What to Test" and What's New
- BRAND-28 — GAP: Surfaces / cross-surface consistency

### Bundles and frameworks

#### [BNDL-10] Shared code in one module

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Code used by both the app and its extensions lives in one module, and the same source files are never compiled into two targets.
- Evidence: `project.pbxproj` file refs `B100000000000000000000C6` `WidgetSharedStore.swift` and `B100000000000000000000C7` `AuctionActivityAttributes.swift` are in the app Sources phase (`A100000000000000000000C6`, `A100000000000000000000C7`) and the widget Sources phase (`W10000000000000000000006`, `W10000000000000000000005`). Neither file calls `UIApplication.shared`. There is no local Swift package for this shared code.
- Remediation: Move `WidgetSharedStore.swift` and `AuctionActivityAttributes.swift` into one local Swift package or framework target linked by the app and the widget, and delete the duplicate Compile Sources entries.
- Source: https://developer.apple.com/documentation/xcode/swift-packages
- Confidence: 9

#### [BNDL-1] Standard bundle locations

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: The built `.app` uses the standard iOS locations.
- Evidence: No archive and no `.ipa` under `ios/`. `ios/build/Release-iphonesimulator/NoMarkup.app` has no `Info.plist` and no app executable; it contains XCTest injection (`Frameworks/XCTest*.framework`, `libXCTestSwiftSupport.dylib`, `PlugIns/NoMarkupTests.xctest`) and is not a product layout. Source embed is `project.pbxproj` “Embed Foundation Extensions” `dstSubfolderSpec = 13` for `NoMarkupWidget.appex`. That shell was not scored as the product.
- Remediation: Archive with `generic/platform=iOS` and confirm `Info.plist`, the executable, and `PrivacyInfo.xcprivacy` at the `.app` root, the widget only under `PlugIns/`, and frameworks only under `Frameworks/`.
- Source: https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle
- Confidence: 8

#### [BNDL-11] Embed what loads dynamically

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Every framework that the app or an extension loads dynamically is embedded once in the app's `Frameworks/`.
- Evidence: `otool -L` was not run on an app executable. The Xcode project links `StripePaymentSheet` on the app target and does not embed a framework inside the widget. No vendored third-party `.dylib` is in the target. The simulator shell’s `Frameworks/` entries are XCTest, not the product.
- Remediation: On the archive executable and the appex, match each `@rpath/*.framework` load command to one `NoMarkup.app/Frameworks` binary, and confirm the widget binary does not expect a nested framework.
- Source: https://developer.apple.com/documentation/xcode/creating-a-multi-platform-binary-framework-bundle
- Confidence: 7

#### [BNDL-2] No standalone dylibs

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: iOS doesn't support third-party standalone dynamic libraries (`.dylib` outside a framework bundle).
- Evidence: No vendored `.dylib` in the Xcode target sources. The only `.dylib` hits are inside the incomplete simulator shell (`libXCTestSwiftSupport.dylib`, `libXCTestBundleInject.dylib`), which is a test host, not the shipping bundle. No archive `find` was run.
- Remediation: On the archive, confirm `find` for `*.dylib` outside `Frameworks/libswift*` is empty and that `Frameworks/` and `PlugIns/` are flat code locations.
- Source: https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle
- Confidence: 7

#### [BNDL-7] Nested bundles same team

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: In a device or archive build, every nested code item is signed, and the app and its extensions carry the same Team ID.
- Evidence: `project.pbxproj` `DEVELOPMENT_TEAM = 6L6565278C` on the app and the widget. No `codesign --verify --deep` output: no `.xcarchive` and no exported `.ipa`. Simulator `CODE_SIGNING_ALLOWED=NO` builds are exempt and were not used as proof.
- Remediation: Archive a device build and run `codesign --verify --deep --strict` on the `.app`, then confirm one `TeamIdentifier` on the app and `PlugIns/NoMarkupWidget.appex`.
- Source: https://developer.apple.com/documentation/bundleresources/placing-content-in-a-bundle
- Confidence: 8

#### [BNDL-12] Static vs dynamic and launch time

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Every extra dynamic framework adds dyld work to launch, so keep the number of dynamic frameworks small.
- Evidence: `MERGED_BINARY_TYPE` not found in `project.pbxproj`. No design-doc justification and no `xctrace` App Launch trace. The known dynamic product dependency is `StripePaymentSheet`.
- Remediation: After an archive, count `Frameworks/*.framework`, record why `StripePaymentSheet` stays dynamic, and set `MERGED_BINARY_TYPE = automatic` on the app if the count is more than that one product framework.
- Source: https://developer.apple.com/documentation/xcode/reducing-your-app-s-launch-time
- Confidence: 7

#### [BNDL-22] Purpose-string hygiene

- Status: GAP
- Severity: major
- Kind: required
- Rule: Purpose strings exist only for APIs the target actually calls, sit on the target that calls them, are specific, and are localized through the String Catalog.
- Evidence: `plutil -lint` OK for `Info.plist`, `Info-Debug.plist`, widget `Info.plist`, both `.xcprivacy`, and both `.entitlements`. Purpose strings are longer than 20 characters and name the feature (`NSLocationWhenInUseUsageDescription`, photo library, camera, Face ID). The widget has no usage-string keys and does not call location, camera, or Face ID. `knownRegions` are `en` and `Base`. Purpose strings live in the plists, not in an InfoPlist String Catalog.
- Remediation: Move `*UsageDescription` values into the String Catalog (English for v1) and keep one string per API the app target calls.
- Source: https://developer.apple.com/documentation/xcode/editing-property-list-files
- Confidence: 8

#### [BNDL-26] Verify the archive

- Status: GAP
- Severity: major
- Kind: required
- Rule: BNDL checks that involve signing, entitlements, or `embedded.mobileprovision` run on an archive or exported `.ipa`.
- Evidence: `xcodebuild` archive was not run. No `ios/**/*.xcarchive`, no `.ipa`, and no `embedded.mobileprovision` on a product `.app`. `app_store_distribution` is true.
- Remediation: Archive Release for `generic/platform=iOS` and re-run BNDL-1, BNDL-2, BNDL-7, BNDL-8, and BNDL-11 against `Products/Applications/NoMarkup.app`, including `test -f embedded.mobileprovision`.
- Source: https://developer.apple.com/documentation/xcode/creating-a-multi-platform-binary-framework-bundle
- Confidence: 9

### Cloudflare

#### [CF-24] Webhooks / one hardened inbound route pattern

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: Read the raw body, verify the provider signature, dedupe on a unique event id, return 2xx quickly, and do slow work after the response; do not trust event order.
- Evidence: `HandleStripeWebhook` reads the body with `io.ReadAll` before any JSON parse (`gateway/internal/handler/webhook.go`) and `StripeWebhookValidator.ConstructEvent` calls the Stripe Go webhook constructor (`services/payment/internal/service/webhook.go`). Payment events dedupe via `RecordStripeEventStart` on the event id. Subscription `HandleSubscriptionWebhook` verifies the signature then discards the event and does not insert the event id (`services/payment/internal/grpc/subscription_server.go`, `subscription.go`). Both handlers finish work before HTTP 200. Not a Worker wait-until path.
- Remediation: Dedupe subscription deliveries on the event id the same way as the payment stripe-events table, and acknowledge Stripe before slow side effects.
- Source: https://docs.stripe.com/webhooks
- Confidence: 8

#### [CF-12] Abuse / rate limiting

- Status: RISK
- Severity: major
- Kind: required
- Rule: Rate-limit costly routes with a Workers rate-limit binding keyed by user id (not IP), and have the app treat HTTP 429 as retry later.
- Evidence: No Workers rate-limit binding. Gateway `RateLimiter.Middleware` always keys a tier plus IP via `ClientIP` first; `UserMiddleware` adds a tier plus `claims.UserID` (`gateway/internal/middleware/ratelimit.go`). `/api/v1/payments` is `TierStrict` (10 per minute). App copy: `APIClientError.friendlyMessage` case 429, “Too many requests — wait a moment” (`ios/NoMarkup/Core/APIClient.swift`).
- Remediation: Do not 429 a whole carrier NAT on the payment tier; keep the per-user bucket as the primary key for authenticated payment creates. Show the 429 string in the payment UI, not only as a generic API error.
- Source: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Confidence: 8

#### [CF-27] App client / calling the Worker from iOS

- Status: RISK
- Severity: major
- Kind: required
- Rule: The client uses `URLSession` against the HTTPS origin with no arbitrary-loads ATS exception, sends the session token and an App Attest assertion on sensitive routes, maps 401 and 429, and picks Preview versus production only via xcconfig.
- Evidence: Shipping `ios/NoMarkup/Info.plist` has no arbitrary-loads ATS key (Debug `Info-Debug.plist` sets only local networking). `APIClient` uses `URLSession`. 401 refresh is in `APIClient` and `APIClient+Auth`; 429 copy is `friendlyMessage`. No App Attest header. Base URL is `AppConfig.resolveAPIBaseURL` (env, Debug UserDefaults, plist), not an xcconfig. Release rejects non-HTTPS overrides but still honors `NOMARKUP_API_BASE_URL` when the scheme is HTTPS. No Worker origin.
- Remediation: For Release, ignore host overrides that are not the production API. Add a device assertion on payment creates only if App Attest is adopted. Keep the shipping plist free of arbitrary-loads exceptions.
- Source: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Confidence: 8

#### [CF-8] Accounts / Sign in with Apple validation in the Worker

- Status: RISK
- Severity: major
- Kind: required
- Rule: The server, not the app, verifies the SIWA identity token (signature, issuer, audience, expiry, nonce), exchanges the authorization code, stores the SIWA private key as a secret, issues its own session, and revokes tokens on deletion.
- Evidence: `verifyAppleIDToken` and `NativeAppleSignIn` in `gateway/internal/handler/oauth.go` check Apple JWKS, issuer `https://appleid.apple.com`, audience from `APPLE_CLIENT_ID` / `APPLE_NATIVE_CLIENT_ID`, RS256, expiry, and a hash of the raw nonce. A token URL constant exists for the web OAuth client. No Apple revoke URL and no SIWA server-to-server route. Not a Worker or D1 users table.
- Remediation: On account deletion, call Apple’s revoke endpoint with a server-held SIWA key, and add the server-to-server notification route with signature checks. Do not accept an identity token that skipped `verifyAppleIDToken`.
- Source: https://developers.cloudflare.com/workers/configuration/secrets/
- Confidence: 8

#### [CF-23] Review readiness / backend live during App Review

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: From submission until approval the production API, public pages, and demo account stay up; freeze deploys; watch 5xx; expose a health route.
- Evidence: Client probes `AppConfig.apiBaseURL` plus `health` and `api/v1/health` (`ios/NoMarkup/Core/APIClient.swift`). No ship-pack demo credentials, deploy-freeze window, or recorded health-check status. Production liveness was not requested over the network.
- Remediation: Put a demo account, a production health check equal to HTTP 200, and a deploy freeze in the App Review notes before submission.
- Source: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- Confidence: 7

#### [CF-26] MCP / write-confirmation protocol for real Cloudflare accounts

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Any change to a real Cloudflare account needs a per-action user confirmation; local dev and previews on test secrets do not.
- Evidence: `docs/studio/cloudflare-actions.md` not found. No production Wrangler deploy in the tree. No Cloudflare write was performed in this audit.
- Remediation: Keep production Cloudflare changes (DNS, cache rules, deploys) behind a named confirmation. Absence of a log is not proof a past console change was confirmed.
- Source: https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/
- Confidence: 7

#### [CF-5] Architecture / one Worker API in front of everything

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: The app talks to exactly one first-party HTTPS API (the Worker), which holds every secret and computes prices; the app ships no secret keys.
- Evidence: No Worker URL in the iOS client. One production API host: `AppConfig.productionAPIBaseURL`. Secret scan of `ios/` found no secret, restricted, or webhook-signing key literals (plist `StripePublishableKey` is empty). Price authority is incomplete on service payments (see STRIPE-5) and is not a Worker route table.
- Remediation: Keep secrets on the Go service. Do not PASS this item as a Worker. Fix client-supplied amounts under STRIPE-5.
- Source: https://developers.cloudflare.com/workers/configuration/secrets/
- Confidence: 8

#### [CF-6] Secrets

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Store credentials with `wrangler secret put`, never in `vars`; gitignore local env files; preview secrets stay test-mode.
- Evidence: No Worker config or `secrets.required`. `.gitignore` ignores `.env`, `.env.local`, `.env.production`, and `.env.*.local`. Webhook secret is the env name `STRIPE_WEBHOOK_SECRET` read by `StripeWebhookValidator` (`services/payment/internal/service/webhook.go`). No `.dev.vars` tracked. A Wrangler secret list was not run.
- Remediation: Keep Stripe secrets in the existing vault/env path. A Worker secret list is not applicable until a Worker exists.
- Source: https://developers.cloudflare.com/workers/configuration/secrets/
- Confidence: 8

#### [CF-1] Architecture / when to use a backend at all

- Status: GAP
- Severity: major
- Kind: required
- Rule: Add a Cloudflare Worker only for a named trigger (secrets, webhooks, shared multi-user data, AI proxy, or hosted pages) and record `cloudflare_backend` with that trigger in `01-brief.md`.
- Evidence: `docs/studio/01-brief.md` not found in tree. No `wrangler.jsonc` / `wrangler.toml`. iOS calls `AppConfig.productionAPIBaseURL` in `ios/NoMarkup/Core/AppConfig.swift` (`https://api.no-markup.com`). Triggers (Stripe, UGC, accounts) are real; the backend is the Go gateway, not a Worker.
- Remediation: Record the Go gateway as the first-party API in the studio brief, or stop treating implied `cloudflare_backend` as a Worker project. Do not add a Worker that duplicates the gateway.
- Source: https://developers.cloudflare.com/workers/platform/storage-options/
- Confidence: 9

#### [CF-10] D1 / queries, migrations, backups

- Status: GAP
- Severity: major
- Kind: required
- Rule: Query D1 only with bound parameters, keep additive SQL migrations, and record a Time Travel bookmark before remote applies.
- Evidence: No D1 migrations folder and no Worker `prepare` calls. Go uses pgx parameterized queries (payment repository). Not a D1 migration set.
- Remediation: none for D1 until a Worker exists. Keep payment SQL parameterized and migrations additive.
- Source: https://developers.cloudflare.com/d1/reference/migrations/
- Confidence: 8

#### [CF-11] R2 / uploads and downloads from the app

- Status: GAP
- Severity: major
- Kind: required
- Rule: The app never receives R2 credentials; the Worker returns a short-lived presigned URL; do not expose production buckets on the public R2 dev host.
- Evidence: No public R2 dev host or R2 access-key literal in `ios/`. Uploads: `APIClient.putPresignedUpload` (`ios/NoMarkup/Core/APIClient+Platform.swift`) after `POST /api/v1/images/upload-url`. Imaging presign TTL is `PRESIGN_EXPIRY_SECS = 900` (`engines/imaging/src/models.rs`). Storage is S3, not R2.
- Remediation: Keep credentials off the device and the 900-second TTL. An R2 binding is not required for this Go/S3 path.
- Source: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Confidence: 8

#### [CF-15] Observability / logs, errors, tracing

- Status: GAP
- Severity: major
- Kind: required
- Rule: Enable Workers Logs and source maps, log structured JSON without tokens or card data, and export if retention must exceed 7 days.
- Evidence: No Worker `observability.enabled` config. Go services use `slog` JSON. Gateway redacts the client-secret field (`gateway/internal/middleware/logging_redact.go`). Not Workers Logs.
- Remediation: none for Wrangler logs. Keep card numbers, webhook secrets, and client secrets out of `slog` fields.
- Source: https://developers.cloudflare.com/workers/observability/logs/workers-logs/
- Confidence: 8

#### [CF-16] Deploy / Previews, production deploys, gradual rollout

- Status: GAP
- Severity: major
- Kind: required
- Rule: Build deploys go to Wrangler Previews on test-mode Stripe; production `wrangler deploy` is a confirmed write; Release must not point at a Preview.
- Evidence: No Wrangler Preview config. Release API fallback is `https://api.no-markup.com` (`AppConfig.resolveAPIBaseURL`). Debug may use cleartext via `NOMARKUP_API_BASE_URL` or loopback port 8081. No Preview-versus-production xcconfig pair.
- Remediation: Keep Release archives on the production HTTPS host. Do not treat a Wrangler Preview URL as required for this Go API.
- Source: https://developers.cloudflare.com/workers/previews/
- Confidence: 8

#### [CF-17] Deploy / rollback

- Status: GAP
- Severity: major
- Kind: required
- Rule: Record the deployed Worker version id and roll back with Wrangler; migrations must stay additive because rollback does not undo bound databases.
- Evidence: `docs/studio/09-ship-pack/backend-deploy.md` not found. No Wrangler deployment list record.
- Remediation: Document the Go deploy’s previous revision and rollback command in the ship pack. A Worker version id does not exist.
- Source: https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/
- Confidence: 9

#### [CF-25] MCP / which Cloudflare MCP server and tool for each step

- Status: GAP
- Severity: major
- Kind: required
- Rule: Use the Cloudflare API MCP server; every write is preceded by a user confirmation naming account, resource, and action.
- Evidence: No `docs/studio/` tool-call log and no Cloudflare MCP server config in the iOS app. This audit did not call Cloudflare write tools.
- Remediation: If a Worker is ever managed from an agent, log each write with an explicit confirmation. Do not invent that log.
- Source: https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/
- Confidence: 8

#### [CF-3] Hosting / domain, headers and Universal Links files

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Serve public pages and the AASA file from a custom domain (not a workers.dev host), with a `_headers` file that sets `Content-Type: application/json` on `apple-app-site-association`.
- Evidence: Associated domains are `applinks:no-markup.com` and `webcredentials:no-markup.com` (`ios/NoMarkup/NoMarkup.entitlements`). AASA is `web/public/.well-known/apple-app-site-association` (app id `6L6565278C.com.nomarkup.app`). No `site/_headers` and no app code that sets `Content-Type: application/json` for that file. No workers.dev URL in the iOS client.
- Remediation: Serve the AASA as `application/json` (Next header or Cloudflare `_headers`) and confirm with a response-header check on `https://no-markup.com/.well-known/apple-app-site-association`.
- Source: https://developers.cloudflare.com/workers/static-assets/headers/
- Confidence: 8

#### [CF-9] Storage choice: D1 vs KV vs R2 vs Durable Objects

- Status: GAP
- Severity: major
- Kind: required
- Rule: Use D1 for relational data, KV only for stale-tolerant cache, R2 for blobs, and Durable Objects for strongly consistent tokens; never keep balances or idempotency records in KV.
- Evidence: No Wrangler bindings. Money, orders, and stripe event rows are PostgreSQL (`services/payment`). Rate limits use Redis (`gateway/internal/cache/redis.go`). Uploads use S3 presigns (`engines/imaging`). No KV balance path found.
- Remediation: Document Postgres / Redis / S3 as the storage map. Do not move balances into Redis keys used as a KV substitute.
- Source: https://developers.cloudflare.com/workers/platform/storage-options/
- Confidence: 8

Advisory:

- CF-18 — GAP: CI / Workers Builds
- CF-19 — GAP: Access / protecting previews and admin routes
- CF-21 — GAP: Email / transactional mail from the Worker
- CF-22 — GAP: Platform limits and plan
- CF-4 — GAP: Tooling / Wrangler vs `cf` CLI, project config

### Craft

#### [CRAFT-APP.1] Color tokens / four-variant colorsets

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Every drawn color is a semantic system color or a token backed by a colorset with Any, Dark, High Contrast, and Dark + High Contrast.
- Evidence: The only colorset is `Assets.xcassets/AccentColor.colorset/Contents.json`, which has an Any swatch and a luminosity-dark swatch and no contrast appearance. Brand colors are code tokens in `BrandTheme.adaptive` (dynamic `UIColor`), not colorset entries. Views also use raw `Color(red:)` (CRAFT-UX.18).
- Remediation: Add four-variant colorsets for screen, text, gold, and status, including High Contrast, and point `AccentColor` at the same four.
- Source: https://developer.apple.com/design/human-interface-guidelines/color
- Confidence: 9

#### [CRAFT-APP.16] Contrast thresholds / AA gate

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Body text is at least 4.5:1 and UI component graphics at least 3:1 in light, dark, and both Increase Contrast variants.
- Evidence: Computed from `BrandTheme.P`: primary text passes (dark `#E8ECF1` on `#07080B` is 16.88:1; light `#14161E` on `#F6F4EF` is about 16:1). Secondary text on screen and card also clears 4.5:1. Light interactive gold `#B89938` on paper `#F6F4EF` is 2.50:1, below 3:1 for icons and borders and below 4.5:1 if used as text. `AccentColor` has no high-contrast variant, so Increase Contrast does not fix that tint. `DeviceCapabilityUITests.shouldIgnoreAccessibilityIssue` returns true for “contrast failed”. No `contrast_scan` output and no `appearance_lint` table.
- Remediation: Darken light-mode gold used for icons and links to the text gold `#806316` or darker, add a high-contrast accent, and fail the accessibility audit on contrast.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Confidence: 8

#### [CRAFT-MOT.12] Reduce Motion

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: When Reduce Motion is on, replace movement, scale, and loops with a cross-fade or no animation, through one helper that every site uses.
- Evidence: `BrandTheme.animation(_:reduceMotion:)` returns nil when the flag is on, and `RootView` uses it for auth and offline transitions. `BrandSkeletonBar` and `BrandMoneyFlashModifier` also read `accessibilityReduceMotion`. Bypasses that always animate: `JobDetailView` `.animation(.easeOut(duration: 0.2), value: arenaLeadingAmount)`, `ListingDetailView` price animations, `AgeGateView` `.animation(.easeInOut(duration: 0.2), value: showGate)`, `SavingsView` lifetime cents, and the primary-button `.scaleEffect` press animation in `BrandTheme` (comment says ButtonStyle has no Reduce Motion environment). There is no zoom transition to fall back. No Reduce Motion UI test.
- Remediation: Route every `.animation` and press `scaleEffect` through the Reduce Motion helper, and stop the skeleton loop when the setting is on (already partially done) including the sites that do not call the helper.
- Source: https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducemotion
- Confidence: 9

#### [CRAFT-PERF.11] Swift 6 strict concurrency, zero warnings

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Build in Swift 6 with complete strict concurrency and warnings as errors, and allow concurrency escape hatches only with a justification comment that names why they are safe.
- Evidence: Target configs set `SWIFT_VERSION = 6.0` and `SWIFT_STRICT_CONCURRENCY = complete` (app, tests, UI tests, widget in `ios/NoMarkup.xcodeproj/project.pbxproj`). `SWIFT_TREAT_WARNINGS_AS_ERRORS` is not set. Escape hatches lack a `// SAFETY:` comment: `KeychainTokenStore: @unchecked Sendable`, `ClientActionLog: ObservableObject, @unchecked Sendable`, `ActivityUpdateBox: @unchecked Sendable`, `SpotlightIndex` `nonisolated(unsafe)` statics, `APIClient.tokenStore` `nonisolated(unsafe)` (nearby comment, not `// SAFETY:`), `AuthViewModel.sessionExpiredObserver` (comment explains deinit, not the `// SAFETY:` token). UITest `@preconcurrency import XCTest` and `nonisolated(unsafe)` counters are also uncommented as SAFETY. No warning-free build log was produced for this audit.
- Remediation: Set `SWIFT_TREAT_WARNINGS_AS_ERRORS = YES` on every target, fix warnings, and add a `// SAFETY:` comment on each remaining escape hatch that names the invariant.
- Source: https://developer.apple.com/documentation/swift/adoptingswift6
- Confidence: 9

#### [CRAFT-UX.17] Typography / Dynamic Type

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: User-facing text uses Dynamic Type styles or `relativeTo:` fonts, and layouts reflow so key text does not truncate at accessibility sizes.
- Evidence: Body copy uses text styles (`.footnote`, `.subheadline`, `.title`). The only `Font.system(size:)` hit is a 1 pt harness probe in `RootTabView`. `.lineLimit(1)` occurs 61 times in 28 files (prices, “Live”, names). `dynamicTypeSize` appears once; `AnyLayout` and `ViewThatFits` reflow are essentially unused (`ViewThatFits` once). `@ScaledMetric` appears 5 times. No AX5 audit is in the UI tests (contrast is ignored; Dynamic Type is not proven).
- Remediation: Remove `lineLimit(1)` from titles and prices, switch those rows to a vertical stack when `dynamicTypeSize.isAccessibilitySize`, and add an AX5 accessibility audit.
- Source: https://developer.apple.com/design/human-interface-guidelines/typography
- Confidence: 8

#### [CRAFT-UX.18] Color / semantic and contrast

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Use semantic or four-variant asset colors; do not hard-code RGB in views; do not force an app-wide appearance; do not convey meaning by color alone.
- Evidence: `Color(red:)` is used in views outside the theme file: `Auth/FacebookSignInButton.swift`, `Auth/GoogleSignInButton.swift`, and `Core/NoMarkupIcon.swift` (full-screen `Color(red: 0.027, 0.031, 0.043)`). `AccentColor.colorset` has Any and Dark only, no High Contrast. Runtime `.preferredColorScheme(.dark)` is preview-only (52 preview sites, 0 in view bodies). `BrandTheme` tokens are dynamic, but light interactive gold `#B89938` on paper `#F6F4EF` is 2.50:1 (see CRAFT-APP.16). Home’s signed-in dot is color plus the word “Live”.
- Remediation: Move the icon backdrop and third-party button colors into adaptive tokens with high-contrast variants, and add High Contrast swatches to `AccentColor`.
- Source: https://developer.apple.com/design/human-interface-guidelines/color
- Confidence: 8

#### [CRAFT-UX.27] Accessibility audit gate

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Every screen passes `performAccessibilityAudit()` in light and dark, and any ignored issue has a written justification.
- Evidence: `NoMarkupUITests/DeviceCapabilityUITests.swift` calls `auditCurrentScreen` for “Login”, “Home”, and “Account” only. `shouldIgnoreAccessibilityIssue` returns true for every issue whose description contains “contrast failed”, “contrast nearly passed”, or “potentially inaccessible text”, with a comment that contrast is advisory. That suppresses the contrast audit rather than justifying one element.
- Remediation: Run `performAccessibilityAudit()` on every screen in light and dark, and stop ignoring contrast failures.
- Source: https://developer.apple.com/documentation/xcuiautomation/xcuiapplication/performaccessibilityaudit(for:_:)
- Confidence: 9

#### [CRAFT-UX.6] Permissions just in time

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Request each permission at first use, after a primer whose only button is “Continue” or “Next”, with a specific purpose string and a Settings path on denial.
- Evidence: Push primer `NotificationPermissionCopy.prePromptConfirm` is “Enable notifications” and `prePromptNotNow` is “Not now” (`NoMarkup/Core/NotificationPermissionCopy.swift`), shown from `RootView`’s alert — two buttons, and the confirm title is not Continue/Next. `JobSiteLocationProvider.currentCoordinate` and `JobsMapView.MapLocationManager.requestWhenInUse` call `requestWhenInUseAuthorization()` with no primer view. Camera denial in `CameraImagePicker` does offer “Open Settings”. Purpose strings in `Info.plist` (`NSLocationWhenInUseUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSCameraUsageDescription`, `NSFaceIDUsageDescription`) are specific. Requests are not in `NoMarkupApp.init`.
- Remediation: Replace the push alert with a one-button Continue primer, and put the same primer in front of location and camera system prompts; keep the existing denial → Settings path.
- Source: https://developer.apple.com/design/human-interface-guidelines/privacy
- Confidence: 9

#### [CRAFT-APP.12] Charts and status / not hue alone

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Meaning carried by color is also carried by a shape, symbol, or label, and Differentiate Without Color adds that cue where color is the primary signal.
- Evidence: `accessibilityDifferentiateWithoutColor` is absent. `BrandMoneyFlashModifier` washes green (`successFill`) or bid blue solely from `isDown`, with no up/down symbol. The home presence dot is color plus the words “Live” / “Offline”, which is acceptable for that one chip.
- Remediation: Add an up/down symbol or sign next to flashing prices, and show it whenever Differentiate Without Color is on.
- Source: https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilitydifferentiatewithoutcolor
- Confidence: 8

#### [CRAFT-APP.13] Launch screen appearance

- Status: FAIL
- Severity: major
- Kind: required
- Rule: The launch screen matches the first screen’s background in light and dark, with no logo unless the logo is already the first screen.
- Evidence: `UILaunchScreen.UIColorName` is `AccentColor`. Accent gold is not `BrandTheme.navy` (paper in light, `#07080B` in dark). AccentColor’s dark variant is a brighter gold, so a dark cold launch still flashes gold before the navy home screen.
- Remediation: Add `LaunchBackground` with the same light and dark values as `BrandTheme.navy`, and set `UIColorName` to it.
- Source: https://developer.apple.com/design/human-interface-guidelines/launching
- Confidence: 9

#### [CRAFT-APP.15] Widgets / rendering modes

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Widgets set `.containerBackground(for: .widget)`, read `widgetRenderingMode`, and mark key content `.widgetAccentable()` so tinted and clear modes stay legible.
- Evidence: `ActiveBidsWidget` and `NextClosingWidget` call `.containerBackground(for: .widget)`. `widgetRenderingMode` and `widgetAccentable` are absent in `NoMarkupWidget/`. `ActiveBidsWidgetView` reads `colorSchemeContrast` only. `WidgetBrand.gold` / `navy` are fixed sRGB literals for the Live Activity shell. Tinted Home Screen mode will ignore those colors and has no accentable mask.
- Remediation: Branch on `widgetRenderingMode`, mark the bid count `.widgetAccentable()`, and drop gradients and full-color gold outside `.fullColor`.
- Source: https://developer.apple.com/design/human-interface-guidelines/widgets
- Confidence: 8

#### [CRAFT-APP.18] Verification / appearance test matrix

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every screen, including sheets and empty states, is contrast-measured in light, dark, both Increase Contrast modes, and Reduce Transparency, at default and AX5 sizes.
- Evidence: `.studio/appearance-report.md` is not in the tree. `ScreenshotWalkUITests` exists but is not the ten-capture appearance matrix. The accessibility audit covers three screens and ignores contrast.
- Remediation: Capture the five appearance states at default and AX5 for every screen and fail on any text box under its ratio.
- Source: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- Confidence: 8

#### [CRAFT-APP.2] Color tokens / declared pairs

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every foreground/background pair the app draws is declared and checked in all four variants.
- Evidence: `docs/studio/color-pairs.json` is not in the tree. Contrast ratios are comments on `BrandTheme.P` (for example text secondary light “6.54 white / 5.95 paper”). There is no lint table. Undeclared pairs include light gold `#B89938` on paper `#F6F4EF`.
- Remediation: Add `color-pairs.json` for text, secondary, gold, and status on screen, card, and raised surfaces, and fail the build when a pair misses its ratio.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Confidence: 9

#### [CRAFT-APP.3] Color tokens / no hard-coded colors

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Outside the design-system file, views do not build colors from literal components.
- Evidence: Treating `BrandTheme.swift` as the theme file, literals remain in `FacebookSignInButton.swift`, `GoogleSignInButton.swift`, `NoMarkupIcon.swift` (`Color(red: 0.027, green: 0.031, blue: 0.043).ignoresSafeArea()`), and `WidgetSharedStore.swift` `WidgetBrand` (`Color(red:)` for navy and gold). `AgeGateView` uses `Color.black.opacity(0.72)` as a scrim behind a card, not as text.
- Remediation: Replace those call sites with `BrandTheme` / `WidgetBrand` dynamic tokens, and comment any remaining scrim whose contrast was measured.
- Source: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- Confidence: 8

#### [CRAFT-APP.7] Accessibility display settings / Increase Contrast

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Increase Contrast strengthens anything drawn outside asset colors (opacity borders, gradients, shadows used as separators).
- Evidence: Solid `BrandTheme` tokens branch on `UITraitCollection.accessibilityContrast` inside `dynamicUIColor`. `colorSchemeContrast` is not read in app views (the only mention is a comment in `WidgetSharedStore.swift`). `AgeGateView` strokes `BrandTheme.gold.opacity(0.25)`. The primary button uses a gold gradient and a white 0.18 stroke that switches only on Reduce Transparency, not Increase Contrast. The skeleton gradient does not change for Increase Contrast.
- Remediation: When `colorSchemeContrast == .increased`, draw those borders and gradients opaque and thicker, using the high-contrast gold token.
- Source: https://developer.apple.com/documentation/swiftui/environmentvalues/colorschemecontrast
- Confidence: 8

#### [CRAFT-HAP.1] Semantics / documented meanings

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every haptic call site maps to a row of the semantic haptic map; do not repurpose a pattern, and do not play feedback on events the map marks none.
- Evidence: `NoMarkup/Core/BrandHaptics.swift:BrandHaptics` exposes raw `light` / `medium` / `selection` / `success` / `error` / `warning` (UIKit generators). Tab changes call `BrandHaptics.selection()` in `NoMarkup/Features/RootTabView.swift:onChange(of: selectedTab)` (map: tab switch is none). Ordinary CTAs call `medium()` / `selection()` in `NoMarkup/Features/HomeView.swift` (`home.browseJobs`, `home.instantMatch`, `home.shopGoods`, `home.postJob`, `home.sellItem`). `light()` is documented in `BrandHaptics` as “countdown urgency, ticker delta” (map: scrolling and timers are none), including `NoMarkup/Features/FeedView.swift` and `NoMarkup/Features/JobsView.swift`. No haptic-map document.
- Remediation: Replace the six style methods with one semantic event enum whose cases are only map rows, and delete tab, ticker, and ordinary-button sites.
- Source: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Confidence: 9

#### [CRAFT-HAP.12] User control

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Provide an in-app Haptic Feedback setting, default on, and honor it on every playback path.
- Evidence: `hapticsEnabled` / `settings.hapticsEnabled` is not in the tree. `BrandHaptics.light()` through `warning()` always construct a generator. The file comment only cites the system haptics switch, which does not satisfy an in-app control.
- Remediation: Add a Settings toggle defaulting on and guard every `BrandHaptics` method (and any future `sensoryFeedback` closure) on it.
- Source: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Confidence: 10

#### [CRAFT-HAP.2] Consistency

- Status: FAIL
- Severity: major
- Kind: required
- Rule: The same event plays the same feedback everywhere; views never pick raw generator styles ad hoc.
- Evidence: Generators are constructed only inside `BrandHaptics` (no `UIImpactFeedbackGenerator` in views). There is no `HapticEvent` enum. Views choose `light` vs `medium` vs `selection` themselves (274 sites). No `sensoryFeedback` modifier anywhere.
- Remediation: Add `enum HapticEvent` with a single `sensoryFeedback` mapping and allow views to pass only that case.
- Source: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Confidence: 9

#### [CRAFT-HAP.3] Testability / central service

- Status: FAIL
- Severity: major
- Kind: required
- Rule: All imperative haptics go through an injected `HapticsService` protocol, with a silent UI-test implementation and a recording unit-test double.
- Evidence: `protocol HapticsService`, `@Environment(\.haptics)`, `SilentHapticsService`, and `RecordingHapticsService` are not in the tree. Call sites use the `BrandHaptics` enum directly. `NoMarkupApp` does not inject a haptics environment.
- Remediation: Introduce the protocol, environment key, live/silent/recording implementations, and inject silent haptics when UI testing.
- Source: https://developer.apple.com/documentation/uikit/uifeedbackgenerator
- Confidence: 10

#### [CRAFT-HAP.4] Testability / haptic map coverage

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every haptic-map row that has feedback is asserted with the recording double, including at least one negative assertion that a silent path emits nothing.
- Evidence: `NoMarkupTests/` has no haptic test. `RecordingHapticsService` is not in the tree. No `#expect` on an event sequence.
- Remediation: Add a recording double and unit tests for success, error, selection, and a silent tab or routine-save path.
- Source: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Confidence: 10

#### [CRAFT-HAP.6] Restraint

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Do not play haptics on scroll, appear, navigation, tab switches, keystrokes, ordinary button taps, or timers; if haptic sites exceed half of `Button(` sites, the app is at least over-using them.
- Evidence: `RootTabView.onChange(of: selectedTab)` plays `BrandHaptics.selection()` on every tab switch (map: none). Home CTAs play haptics on ordinary taps (`HomeView.swift` lines 210–257). 274 haptic sites / 328 `Button(` sites = 0.84. `BrandHaptics.light()` is specified for ticker and countdown urgency.
- Remediation: Delete the tab `onChange` haptic and the per-button calls; keep haptics only for waited success, failure, warning, and custom selection controls.
- Source: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Confidence: 9

#### [CRAFT-MOT.1] Purpose

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every animation shows a state change, continuity, or input acknowledgement; no idle decorative loops.
- Evidence: `BrandSkeletonBar` in `BrandTheme.swift` runs `withAnimation(.linear(duration: 1.15).repeatForever(autoreverses: false))` on appear to sweep a gold gradient across placeholder bars. That is decoration, not an ongoing recording or sync state. There is no motion map. Other animations (price `numericText`, offline banner, press scale) do track state.
- Remediation: Remove the repeating shimmer; use a static placeholder that already respects Reduce Motion.
- Source: https://developer.apple.com/design/human-interface-guidelines/motion
- Confidence: 9

#### [CRAFT-MOT.2] Springs as the default curve

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Use spring tokens (`.smooth`, `.snappy`, `.bouncy`) for UI motion; avoid `.linear` and ease curves for moving UI.
- Evidence: No `Motion.swift`. Observed curves are `.easeInOut(duration: 0.2)` (`NoMarkupApp` / `RootView`), `.easeOut(duration: 0.2)` on prices (`JobDetailView`, `ListingDetailView`, `BrandTheme`), and `.linear(duration: 1.15)` on the skeleton. No `.spring(` / `.smooth` / `.snappy` usage was found.
- Remediation: Add spring tokens and replace ease and linear UI motion with `.smooth` or `.snappy`.
- Source: https://developer.apple.com/documentation/swiftui/animation/spring(duration:bounce:blendduration:)
- Confidence: 8

#### [CRAFT-PERF.1] Cold launch budget

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Cold launch to first frame is below 400 ms and never above 1 s, launch to responsive is below 1 s, and both are enforced by a launch performance test with a recorded baseline.
- Evidence: `XCTApplicationLaunchMetric` / `measure(metrics:` not found under `ios/` (NoMarkupUITests and NoMarkupTests). No `*.xcbaseline`. `UILaunchScreen` in `ios/NoMarkup/Info.plist` is a static `UIColorName` = `AccentColor` (no timed splash), but nothing records the launch metric. Apple: `class XCTApplicationLaunchMetric` — “A metric to record the application launch duration for a performance test.” (`init(waitUntilResponsive:)` records first frame, or first frame until responsive).
- Remediation: Add a Release `PerformanceTests` case `measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)]) { XCUIApplication().launch() }` with a committed baseline, and fail the run when the mean exceeds 400 ms to first frame or 1 s to responsive.
- Source: https://developer.apple.com/documentation/xctest/xctapplicationlaunchmetric
- Confidence: 9

#### [CRAFT-PERF.12] Observation

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Model types use `@Observable`, not `ObservableObject`, and non-UI properties are `@ObservationIgnored`.
- Evidence: `@Observable` and `@ObservationIgnored` not found under `ios/NoMarkup`. UI state is `ObservableObject` + `@Published` + `@StateObject` / `@EnvironmentObject` / `@ObservedObject`, including `AuthViewModel`, `FeatureFlags`, `NetworkMonitor`, `DeepLinkRouter`, `PushRegistration`, `ClientActionLog`, and the auction/chat socket clients. `NoMarkupApp` injects them with `.environmentObject`. No third-party comment requires `ObservableObject`.
- Remediation: Migrate owned models to `@Observable` held in `@State`, pass shared models with `.environment`, and mark caches, tasks, and formatters `@ObservationIgnored`.
- Source: https://developer.apple.com/documentation/swiftui/migrating-from-the-observable-object-protocol-to-the-observable-macro
- Confidence: 10

#### [CRAFT-PERF.13] View body cost

- Status: FAIL
- Severity: major
- Kind: required
- Rule: `body` does no sorting, filtering of large collections, formatter construction, I/O, or image decoding, and `GeometryReader` is not used per row.
- Evidence: `JobDetailView.sortedLadder` and `filteredLadder` sort and filter `bidEntries` on every read from the ladder section (`ios/NoMarkup/Features/JobDetailView.swift`). The same section calls `.filter` again while building the “Showing N of M” text. `TrustScoreView.dimensionRow` puts a `GeometryReader` inside `ForEach(score.dimensions)` (`ios/NoMarkup/Features/TrustScoreView.swift`). `MarketRangeBar.rangeTrack` uses `GeometryReader` for one bar, not a catalog row. `DateFormatter()` in views is in submit/export helpers (`PostJobView.preQuoteDayString`, `SalesExportView.writeTempFile`), not per row. No SwiftUI instrument trace.
- Remediation: Cache the sorted ladder when the filter or bid set changes. Replace per-row `GeometryReader` bars with a fixed track or `onGeometryChange` with a threshold. Trace the job detail and home flows for long body updates.
- Source: https://developer.apple.com/documentation/xcode/understanding-and-improving-swiftui-performance
- Confidence: 7

#### [CRAFT-PERF.4] Hitch budget

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Scrolling and navigation transitions stay within ≤5 ms/s hitch time, and every scrolling screen and the primary navigation transition have a UI performance test.
- Evidence: `scrollingAndDecelerationMetric` and `navigationTransitionMetric` not found under `ios/`. Long lists exist (`JobsView` `List` / `ForEach(jobs)`, `MarketplaceView` `List` / `ForEach(listings)`, `MessagesView` `LazyVStack` of messages). Deprecated `scrollDecelerationMetric` is also absent. No Animation Hitches trace.
- Remediation: Add Release UI tests that `measure` `XCTOSSignpostMetric.scrollingAndDecelerationMetric` on Jobs, Marketplace, and Messages, and `navigationTransitionMetric` on the primary push, and fail above 5 ms/s.
- Source: https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app
- Confidence: 9

#### [CRAFT-PERF.7] Lazy lists and identity

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Unbounded or large collections render in `List` or a lazy stack, and row identity is stable and unique.
- Evidence: Primary catalogs use `List` (`JobsView.content`, `MarketplaceView.content`, `MessagesView` inbox, `FeedView`). Home does not: `HomeView.body` is `ScrollView` + `VStack`, and `liveAuctionsSection` uses eager `ForEach(jobs)` after `loadCatalog` requests `pageSize: 100` (`ios/NoMarkup/Features/HomeView.swift` around lines 505 and 796). `JobDetailView` uses `ForEach(Array(sortedLadder.enumerated()), id: \.offset)`, which changes when the ladder reorders (`ios/NoMarkup/Features/JobDetailView.swift`). `id: \.self` hits are on small unique option lists (hours, roles, address lines), not the catalog.
- Remediation: Render the home open-auction section in a `List` or `LazyVStack`, and identify ladder rows by the bid’s persistent id, not `offset`.
- Source: https://developer.apple.com/documentation/swiftui/creating-performant-scrollable-stacks
- Confidence: 8

#### [CRAFT-PERF.8] Image downsampling

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Decode images at display size off the main thread; `AsyncImage` is acceptable only for small server-sized images.
- Evidence: Upload path downsamples: `ImageUploader.encodeJPEGDownsampled` uses `CGImageSourceCreateThumbnailAtIndex` with `kCGImageSourceThumbnailMaxPixelSize` = `maxPixelDimension` (2048), inside `Task.detached` (`ios/NoMarkup/Core/ImageUploader.swift`). Display does not. `ProfileSettingsView` and the picker preview use `AsyncImage`. `ModeratedAsyncImage` displays with `AsyncImage` and, for the sensitivity scan, `CGImageSourceCreateImageAtIndex` at full size (`cgImage(from:)`, no max pixel size, no `displayScale`). No `preparingThumbnail(of:)`. No hitch test on image screens.
- Remediation: Downsample chat, evidence, profile, and preview images to `pointSize × displayScale` (capped) before display, and stop full-size `CreateImageAtIndex` for the scan.
- Source: https://developer.apple.com/documentation/uikit/uiimage/preparingthumbnail(of:)
- Confidence: 8

#### [CRAFT-PERF.9] Structured concurrency

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Tie view-lifetime async work to `.task`, and do not use GCD, semaphores, or unjustified `Task.detached` in new code.
- Evidence: `NetworkMonitor` starts `NWPathMonitor` on `DispatchQueue(label: "com.nomarkup.network-monitor")` (`ios/NoMarkup/Core/NetworkMonitor.swift`). `ClientActionLog.record` and `clear` hop with `DispatchQueue.main.async` (`ios/NoMarkup/Core/ClientActionLog.swift`). `FeedView` starts `Task { await loadMore() }` from `.onAppear` (line 103). Image encode uses `Task.detached` with an off-main comment, which is justified. Most screens use `.task` and `Task.isCancelled`. No blanket `checkCancellation()` in large upload loops (`uploadAll` is sequential without a cancellation check).
- Remediation: Keep the path-monitor queue as a commented interop shim; replace `DispatchQueue.main.async` with `MainActor` hops; move feed pagination to `.task(id:)`; check cancellation inside `uploadAll`.
- Source: https://developer.apple.com/documentation/swift/taskgroup
- Confidence: 8

#### [CRAFT-RWD.1] Foundations / explicit, seedable schedule

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every reward decision goes through one `RewardSchedule` and a seedable generator; views do not call random APIs to decide a reward.
- Evidence: `enum RewardSchedule` is absent. `Bool.random`, `Int.random`, and `randomElement` do not decide rewards. The four `.random(in:)` hits are websocket reconnect jitter (`ChatWebSocketClient`, `SpectatorWebSocketClient`, `MarketplaceSpectatorWebSocketClient`, `AuctionWebSocketClient`). Referrals (`ReferralsView`), challenges (`AdminChallengesOpsView`), and win streaks (`ProviderWorkspaceView`) ship with no schedule type. No seeded-sequence test.
- Remediation: Add `RewardSchedule` and `SeededGenerator`, and route referral credit, challenge rewards, and streak milestones through them with a fixed-seed test.
- Source: https://www.bfskinner.org/wp-content/uploads/2015/05/Schedules_of_Reinforcement_PDF.pdf
- Confidence: 9

#### [CRAFT-RWD.11] Tuning / caps, pity timer, remote ceiling

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Each mechanic has schedule parameters, a pity timer where items are drawn, a daily cap, and a remote `RewardConfig` that can only lower rates or turn the mechanic off.
- Evidence: `RewardConfig` and `CelebrationBudget` are absent. Challenge reward values are admin-entered strings (`AdminChallengesOpsView`) with no compiled ceiling or kill switch in the client.
- Remediation: Add `RewardConfig` with compiled clamps and `enabled = false` falling back to ordinary feedback, plus a test.
- Source: https://www.bfskinner.org/wp-content/uploads/2015/05/Schedules_of_Reinforcement_PDF.pdf
- Confidence: 9

#### [CRAFT-RWD.12] Measurement / instrument the schedule

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Log reward granted, return latency, schedule changes, and opt-outs, and list the retention dashboards in the design doc.
- Evidence: `enum RewardEvent` is absent. No design-doc dashboard list. Referral redeem and streak display do not emit a schedule event.
- Remediation: Add `RewardEvent.granted` / `.optedOut` on referral redeem, challenge completion, and streak changes, with no extra personal data.
- Source: https://www.bfskinner.org/wp-content/uploads/2015/05/Schedules_of_Reinforcement_PDF.pdf
- Confidence: 9

#### [CRAFT-RWD.2] Foundations / schedule map in the design doc

- Status: FAIL
- Severity: major
- Kind: required
- Rule: The design doc has a schedule map row for every rewarded behaviour, including continuous core actions, with a metric and an off switch.
- Evidence: `docs/studio/02-design.md` is not in the tree. Referral credit, admin challenges, and provider win streaks have no map row.
- Remediation: Write the schedule map before any further reward UI, with behaviour, reinforcer, parameters, cap, metric, and off switch.
- Source: https://www.bfskinner.org/wp-content/uploads/2015/05/Schedules_of_Reinforcement_PDF.pdf
- Confidence: 9

#### [CRAFT-RWD.32] Guidance / counter-metrics and review questions

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: The design doc answers the review questions per mechanic and names a counter-metric guardrail.
- Evidence: `docs/studio/02-design.md` is not in the tree. No experiment brief names notification opt-out or refund rate as a guardrail for referrals, challenges, or streaks.
- Remediation: Answer the ten review questions for referrals, challenges, and streaks, and name one counter-metric that can stop the mechanic.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [CRAFT-RWD.7] Playbook / streaks with freezes

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Streaks include automatic freezes, keep the longest streak, and can be turned off; freezes are not sold as the only repair.
- Evidence: `ProviderWorkspaceView` shows `currentStreak`, `longestStreak`, and `totalWins` from the API (“Streaks build when you win reverse-auction jobs.”). `settings.streaksEnabled` is absent. No freeze balance, no off switch, and no missed-day test. Longest is displayed, which matches one part of the rule.
- Remediation: Add freezes and a Settings switch that hides streak UI, and keep `longest` when `current` resets.
- Source: https://www.bfskinner.org/wp-content/uploads/2015/05/Schedules_of_Reinforcement_PDF.pdf
- Confidence: 8

#### [CRAFT-UX.10] Error states

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Show plain-language errors next to the problem with a recovery action; never show raw `error.localizedDescription`.
- Evidence: `localizedDescription` occurs 361 times in 72 Swift files. User-visible assignments include `JobsMapView` `errorMessage = error.localizedDescription` and `ProfileSettingsView` `errorMessage = error.localizedDescription`. `APIClient` also returns “Something went wrong on our side. Try again shortly.” Alerts are not limited to actionable non-OK choices (the push pre-prompt is one of eight `.alert(` sites).
- Remediation: Map errors to a user-facing enum (what happened, what to do) and stop assigning `localizedDescription` to any `Text` or alert.
- Source: https://developer.apple.com/design/human-interface-guidelines/writing
- Confidence: 9

#### [CRAFT-UX.12] Undo over confirm

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Do not confirm undoable deletes; register the undo with `UndoManager`. Reserve confirmation for irreversible loss.
- Evidence: `undoManager` / `registerUndo` are absent. 29 `confirmationDialog` sites include `ListingDetailView`, `MyOrdersView`, `AccountView`, and `ContractDetailView`. `.swipeActions` / `onDelete` exist (12 hits) without an undo registration.
- Remediation: Perform single-item deletes immediately, call `undoManager?.registerUndo`, and keep `confirmationDialog` only for account deletion and other irreversible loss.
- Source: https://developer.apple.com/design/human-interface-guidelines/undo-and-redo
- Confidence: 8

#### [CRAFT-UX.13] Forms / focus and submit

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Multi-field forms use `@FocusState`, focus the first field, and advance with `.submitLabel` / `.onSubmit`.
- Evidence: `@FocusState` exists only in `LoginView`, `RegisterView`, `ForgotPasswordView`, and the `MessagesView` composer (4 files). `PostJobView` and `CreateListingView` are multi-field forms without `@FocusState`. Login does use `.submitLabel(.next)` and `.submitLabel(.go)`.
- Remediation: Add a field enum, `@FocusState`, `.focused`, `.submitLabel(.next)`, and `.onSubmit` to every form with two or more text fields, starting with post-job and create-listing.
- Source: https://developer.apple.com/design/human-interface-guidelines/text-fields
- Confidence: 8

#### [CRAFT-UX.14] Forms / content types and keyboards

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every identity, contact, or credential field sets `.textContentType` and a matching keyboard.
- Evidence: 118 `TextField`/`SecureField` sites and 43 `.textContentType` sites. `LoginView` sets `.username`, `.password`, and `.oneTimeCode`. `PostJobView` sets `.fullStreetAddress` once and leaves the rest of the form without content types.
- Remediation: Add `.textContentType` and `.keyboardType` on every email, phone, password, address, and name field; use `SecureField` for secrets.
- Source: https://developer.apple.com/documentation/uikit/uitextcontenttype
- Confidence: 8

#### [CRAFT-UX.15] Keyboard and scrolling

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Scrollable forms dismiss the keyboard interactively and do not ignore the keyboard safe area.
- Evidence: `.scrollDismissesKeyboard` appears in 7 files. `LoginView` has no `scrollDismissesKeyboard`. `ignoresSafeArea(.keyboard)` is absent (that part is clean). Many forms are not shown to use the modifier.
- Remediation: Add `.scrollDismissesKeyboard(.interactively)` to every `Form`, `List`, or `ScrollView` that contains text fields.
- Source: https://developer.apple.com/documentation/swiftui/view/scrolldismisseskeyboard(_:)
- Confidence: 7

#### [CRAFT-UX.16] Search

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Use `.searchable` with a scope prompt, debounced cancellable updates, suggestions, and `ContentUnavailableView.search`.
- Evidence: `.searchable(text:prompt:)` is used in `ProvidersView` (“Search providers”), `MarketsView` (“Search cities or regions”), and `MessagesView` (inbox and conversation). `ContentUnavailableView.search` is absent. No `.searchSuggestions`. No `Tab(role: .search)` (iOS 18 API; deployment is 17, so that part is not required to fail).
- Remediation: Add `.searchSuggestions`, a `.task(id:)` debounce, and `ContentUnavailableView.search(text:)` on each search surface.
- Source: https://developer.apple.com/design/human-interface-guidelines/search-fields
- Confidence: 8

#### [CRAFT-UX.24] Copywriting

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Buttons name the result; do not use “Submit”, “Something went wrong”, or developer terms.
- Evidence: `Button("Submit")` in `MyOrdersView`, `ContractDetailView` (three), `UserReviewsView`, `ParitySurfacesView`, and admin moderation views. `APIClient` returns “Something went wrong on our side. Try again shortly.” `ProviderWorkspaceView` footer shows “PUT /providers/me/categories replaces your membership.” to the user. Admin copy includes “POST /admin/challenges.”
- Remediation: Rename Submit to the outcome (“Send review”, “File claim”), replace the generic API string with a next step, and remove HTTP paths from user-facing footers.
- Source: https://developer.apple.com/design/human-interface-guidelines/writing
- Confidence: 9

#### [CRAFT-UX.26] Launch experience and state restoration

- Status: FAIL
- Severity: major
- Kind: required
- Rule: The launch screen matches the first screen’s background in both appearances, with no splash, and the selected tab and navigation path are restored.
- Evidence: `Info.plist` `UILaunchScreen.UIColorName` is `AccentColor` (gold, Any + Dark only). The first screen background is `BrandTheme.navy` (paper `#F6F4EF` / navy `#07080B`), not gold. `@SceneStorage` is absent, so the selected tab is not restored. No `Task.sleep` splash was found in `NoMarkupApp` or `RootView`.
- Remediation: Point `UILaunchScreen` at a `LaunchBackground` colorset equal to `BrandTheme.navy` in light and dark, and persist the tab and primary path with `@SceneStorage`.
- Source: https://developer.apple.com/design/human-interface-guidelines/launching
- Confidence: 9

#### [CRAFT-UX.3] Modality

- Status: FAIL
- Severity: major
- Kind: required
- Rule: One sheet at a time, with a title, Cancel and confirm, and interactive dismissal blocked when edits would be lost.
- Evidence: 61 `.sheet(` call sites. `interactiveDismissDisabled` appears only in `UserReviewsView` (twice, while submitting) and `MessagesView` (once). `RootTabView` presents `OnboardingWizardView` and deep-link sheets that can be dismissed with “Not now” / “Done” without a discard confirmation. Post-a-job is presented from `HomeView` (`showPostJob`) without a matching dismiss guard.
- Remediation: On every sheet that edits user content, add Cancel, a named confirm action, `.navigationTitle`, and `.interactiveDismissDisabled` plus a discard confirmation when there are unsaved changes.
- Source: https://developer.apple.com/design/human-interface-guidelines/modality
- Confidence: 8

#### [CRAFT-UX.5] Onboarding

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Onboarding is optional, three screens or fewer, skippable, shown once, and findable later; teach with tips rather than a tour.
- Evidence: `NoMarkup/Features/OnboardingWizardView.swift` `Step` has display name, phone, address, provider, and done (four setup screens plus a finish step). “Not now” dismisses it (`onboarding.notNow`) and Account can resume it. It is not gated by `@AppStorage("onboarding.completed")`. `import TipKit` / `Tips.configure` are absent, and the flow is more than one page.
- Remediation: Cut the wizard to three or fewer screens, persist a completed flag, and move the rest to just-in-time TipKit tips with a Settings replay.
- Source: https://developer.apple.com/design/human-interface-guidelines/onboarding
- Confidence: 8

#### [CRAFT-UX.8] Empty states

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every collection and search has a `ContentUnavailableView` empty state with a symbol, a reason, and a next action; search uses `ContentUnavailableView.search(text:)`.
- Evidence: `ContentUnavailableView` appears only in `JobsView`, `MessagesView`, and `MarketplaceView` (3 hits). Other collections use `BrandEmptyState` or plain `Text` (“No challenges.” in `AdminOpsViews`, “No win streaks yet.” in `ProviderWorkspaceView`). `ContentUnavailableView.search` is absent. Search screens (`ProvidersView`, `MarketsView`, `MessagesView`) have no search empty API.
- Remediation: Route every empty collection and every no-results search through `ContentUnavailableView` / `.search(text:)`, including a primary action.
- Source: https://developer.apple.com/documentation/swiftui/contentunavailableview
- Confidence: 8

#### [CRAFT-RWD.15] Apple / reward currency and incentives

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: Purchased currency does not expire; rewards are not given for ratings or as a gate; a referral reward is a bonus on a real in-app event, with terms on screen.
- Evidence: No `requestReview` on a reward path. StoreKit purchases are off, so there is no purchased-currency expiry. `ReferralsView` grants “referral credit when they sign up with your code” (signup, not a completed booking) and the on-screen terms are one footer sentence. Credit is not required to unlock search or browse. Earned and purchased balances are not separate fields because credit is not sold in this binary.
- Remediation: State the full referral terms on the screen, grant credit only after a real marketplace event (first booking or completed job), and keep any future purchased balance from expiring.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 7

#### [CRAFT-UX.22] Liquid Glass / grouping and system integration

- Status: RISK
- Severity: major
- Kind: recommended
- Rule: Group custom glass in `GlassEffectContainer`, and do not force opaque bar appearances that fight system glass.
- Evidence: `BrandTheme.applyGlobalChrome()` sets `UINavigationBar.appearance().standardAppearance`, `UITabBar.appearance().standardAppearance`, `UITableView.appearance().backgroundColor`, and search-bar appearances. On iOS 26 it omits `scrollEdgeAppearance` and uses `.toolbarBackground(.automatic)`, but the standard appearance proxies remain. There is no `GlassEffectContainer` (only one glass CTA, so grouping does not apply).
- Remediation: On iOS 26, stop assigning opaque `standardAppearance` on navigation and tab bars so scroll-edge glass stays system-drawn.
- Source: https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views
- Confidence: 8

#### [CRAFT-HAP.8] Never the only signal

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Every haptic site has a simultaneous visible state change; haptics never carry information alone.
- Evidence: Sampled sites are paired: tab haptic with the selected tab (`RootTabView`), home CTAs with navigation, `ProfileSettingsView.applyAvatarURL` success with `statusMessage = "Profile photo updated."`, and error branches that assign `errorMessage` (`ProfileSettingsView.uploadPickedPhoto`). No haptic-only branch was found, but 274 sites were not each paired, so coverage is incomplete.
- Remediation: Inventory every `BrandHaptics` call against a visible state change and delete any site whose only output is the buzz.
- Source: https://developer.apple.com/design/human-interface-guidelines/feedback
- Confidence: 6

#### [CRAFT-PERF.3] Main-thread budget

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: During scrolling and animation no main-thread span exceeds 16 ms, and discrete interactions finish main-thread work within 50 ms; non-UI work must not run on the main actor.
- Evidence: No Time Profiler trace and no `XCTOSSignpostMetric` in UITests. JSON decode lives on `actor APIClient` (`ios/NoMarkup/Core/APIClient.swift`), not a `@MainActor` type. After the await, `@MainActor` `HomeView.loadCatalog` sorts and filters a `pageSize: 100` job page (`ios/NoMarkup/Features/HomeView.swift`). `JobDetailView.sortedLadder` / `filteredLadder` sort and filter the bid ladder on the view. No measured span proves a hang or a >16 ms scroll sample.
- Remediation: Trace a scripted scroll of Jobs, Marketplace, Home, and the bid ladder. Move page sort/filter off the main actor. Fail the gate on any app span >16 ms during scroll or >100 ms anywhere.
- Source: https://developer.apple.com/documentation/xcode/improving-app-responsiveness
- Confidence: 7

#### [CRAFT-APP.10] Text over imagery and video

- Status: GAP
- Severity: major
- Kind: required
- Rule: Text over a photo, video, map, or gradient sits on a scrim or material that holds contrast for both light and dark images.
- Evidence: Listing and job prices are generally on `brandCard` surfaces, not on photos. A full overlay census of `AsyncImage` plus `Text` was not completed, and no light-image versus dark-image contrast scan was run.
- Remediation: Put a gradient scrim behind any title drawn on a photo, and scan both a near-white and a near-black sample image.
- Source: https://developer.apple.com/design/human-interface-guidelines/materials
- Confidence: 5

#### [CRAFT-APP.11] Focus and selection states

- Status: GAP
- Severity: major
- Kind: required
- Rule: Selected and focused states are visible in all four contrast variants and are not color alone; do not disable the focus effect without a replacement.
- Evidence: `focusEffectDisabled` is absent. System segmented controls get a gold `selectedSegmentTintColor` in `applyGlobalChrome`. Custom selection often relies on that tint. No four-variant screenshot of a selected row, and no `color-pairs` entry for highlight versus surface. Full Keyboard Access was not walked.
- Remediation: Add a checkmark or weight change beside tint for custom selection, and declare the highlight/surface pair at ≥ 3:1 in all four variants.
- Source: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- Confidence: 6

#### [CRAFT-APP.14] App icon appearances

- Status: GAP
- Severity: major
- Kind: required
- Rule: The icon is recognizable in default, dark, clear, and tinted appearances, with the same shapes and no black background.
- Evidence: `AppIcon.appiconset` has default, dark, and tinted 1024 images and no clear variant and no `.icon` file. The six appearance renders were not reviewed.
- Remediation: Review dark and tinted renders for a vanishing glyph, and add a clear variant in Icon Composer.
- Source: https://developer.apple.com/design/human-interface-guidelines/app-icons
- Confidence: 6

#### [CRAFT-APP.4] Images and symbols / dark variants

- Status: GAP
- Severity: major
- Kind: required
- Rule: Full-color artwork has a dark appearance or is a template, and symbols use semantic styles.
- Evidence: `BrandAppIcon.imageset` is a raster logo set; its dark appearance was not confirmed. Interface icons are SF Symbols. No dark-mode screenshot review of illustrations was done. `symbolRenderingMode(.hierarchical/.palette)` was not a dominant pattern.
- Remediation: Mark the brand logo template or add a dark image, and set symbol rendering to hierarchical with `BrandTheme` styles.
- Source: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- Confidence: 5

#### [CRAFT-APP.6] Dark palette / base and elevated backgrounds

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Sheets and popovers use a lighter elevated surface in dark mode, not the same color as the screen behind them.
- Evidence: Dark card `#14161E` is lighter than screen `#07080B`, so cards step up. `.presentationBackground(` was not found. Sheets such as the onboarding sheet do not set an elevated presentation background distinct from `BrandTheme.navy`. No dark screenshot of a sheet over its parent was taken.
- Remediation: Give sheet roots `presentationBackground` of the elevated token (dark `#14161E` or lighter) and confirm the edge is visible on the screen behind.
- Source: https://developer.apple.com/design/human-interface-guidelines/dark-mode
- Confidence: 6

#### [CRAFT-APP.8] Accessibility display settings / Reduce Transparency

- Status: GAP
- Severity: major
- Kind: required
- Rule: Custom blurs, materials, and opacity behind text fall back to an opaque surface when Reduce Transparency is on.
- Evidence: `BrandCardModifier`, hairline borders, and `brandOverlayChipBackground` branch on `accessibilityReduceTransparency` (`BrandTheme.swift`). `.opacity(0.` occurs 148 times across 37 files, and Reduce Transparency is referenced from only a handful of files. Not every translucent overlay was shown to branch.
- Remediation: Wrap remaining text-on-material and opacity overlays in the existing reduce-transparency modifier.
- Source: https://developer.apple.com/documentation/swiftui/environmentvalues/accessibilityreducetransparency
- Confidence: 6

#### [CRAFT-HAP.9] Visual and haptic sync

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Fire the haptic from the same state value as the paired animation, not from a guessed delay, and match intensity to the motion.
- Evidence: No `.sensoryFeedback(trigger:)`. Imperative `BrandHaptics` calls are not tied to `animation(_:value:)` or `symbolEffect`. No `asyncAfter` delay was found immediately around a haptic, so the guessed-timing failure was not proven either.
- Remediation: Drive success and error feedback with `.sensoryFeedback` on the same value as the visible state change.
- Source: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Confidence: 7

#### [CRAFT-MOT.16] ProMotion / 120 Hz smoothness

- Status: GAP
- Severity: major
- Kind: required
- Rule: Custom display links set `preferredFrameRateRange`, and animated blurs or layout on large containers are avoided; hitch time is measured.
- Evidence: `CADisplayLink` is absent, so the Info.plist frame-duration key is not required. No Animation Hitches trace was run. The skeleton animates `offset` of a gradient (a render property) rather than layout; button press also animates `shadow` radius indirectly via opacity. 120 Hz was not measured.
- Remediation: Record an Animation Hitches trace on home, list scroll, and a price tick, and remove the repeating skeleton offset if it hitches.
- Source: https://developer.apple.com/documentation/xcode/understanding-hitches-in-your-app
- Confidence: 6

#### [CRAFT-PERF.10] @MainActor discipline

- Status: GAP
- Severity: major
- Kind: required
- Rule: UI state is `@MainActor`, and heavy work is `nonisolated async` or on another actor so it does not run on the main actor.
- Evidence: `AuthViewModel`, `NetworkMonitor`, socket clients, and `PushRegistration` are `@MainActor`. `APIClient` is an `actor` and owns `JSONDecoder`. Image JPEG work is `nonisolated` inside `Task.detached`. `SWIFT_DEFAULT_ACTOR_ISOLATION` is not set. `HomeView.loadCatalog` still sorts the page on `@MainActor` after the await. No Time Profiler confirms the off-main path.
- Remediation: Move catalog and ladder sort/filter into a `nonisolated async` helper. Confirm with Time Profiler that decode and thumbnail work are off the main thread.
- Source: https://developer.apple.com/documentation/xcode/improving-app-responsiveness
- Confidence: 7

#### [CRAFT-PERF.2] Work before first frame

- Status: GAP
- Severity: major
- Kind: required
- Rule: `App.init`, stored properties, and the root view’s first `body` do no synchronous file I/O, decoding, networking, database migration, image decoding, or large allocations before the first frame.
- Evidence: `NoMarkupApp.init` (`ios/NoMarkup/NoMarkupApp.swift`) calls `AppConfig.persistDogfoodAPIBaseFromEnvironmentIfNeeded` (Debug `UserDefaults` write), `BrandTheme.applyGlobalChrome()` (UIKit appearance), `ImageUploader.configureCache()` / `installMemoryWarningPurge()`, and `SpotlightIndex.installActivityDonationBridge()` (method swizzle). Catalog networking is deferred to `.task` / `RootView.task`. Forbidden init greps (`Data(contentsOf:)`, `JSONDecoder().decode`, `URLSession`, `FileManager` contents) are not in `NoMarkupApp.init`. `AuthViewModel.init` does synchronous Keychain reads via `KeychainTokenStore.hasAccessToken()` before the first frame (`restoreSessionIfPossible`). No App Launch trace.
- Remediation: Move Keychain restore, chrome, cache install, and the Spotlight swizzle into a post-first-frame `.task`. Record an App Launch trace and confirm no app frame over 50 ms before first frame.
- Source: https://developer.apple.com/documentation/xcode/reducing-your-app-s-launch-time
- Confidence: 7

#### [CRAFT-PERF.6] Memory ceiling and leaks

- Status: GAP
- Severity: major
- Kind: required
- Rule: Steady-state physical footprint after the core flow stays under 150 MB, repeating a flow does not grow memory, leaks are zero, and caches are bounded.
- Evidence: `XCTMemoryMetric` not found. No Leaks trace. Bounded caches do exist: `ImageUploader.configureCache` sets `URLCache` memory 64 MB and disk 256 MB (`ios/NoMarkup/Core/ImageUploader.swift`); `SensitiveMediaScanCache` caps at 256 URLs (`ios/NoMarkup/Core/ModeratedAsyncImage.swift`). `didReceiveMemoryWarningNotification` calls `URLCache.shared.removeAllCachedResponses()`. The 150 MB ceiling and zero-leak claim are unmeasured.
- Remediation: Wrap one core flow in `XCTMemoryMetric` for five iterations and fail if the delta exceeds 1 MB. Run a Leaks trace and keep the existing cache limits.
- Source: https://developer.apple.com/documentation/xcode/reducing-your-app-s-memory-use
- Confidence: 8

#### [CRAFT-RWD.3] Playbook / continuous first, then thin

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: New behaviour is reinforced every time, then the schedule is thinned in steps; the first step is continuous.
- Evidence: `ThinningPlan` is absent. No non-continuous ratio was found to thin, and there is no per-user step counter.
- Remediation: If a variable bonus is added, start it at continuous and record the step in analytics.
- Source: https://www.bfskinner.org/wp-content/uploads/2015/05/Schedules_of_Reinforcement_PDF.pdf
- Confidence: 8

#### [CRAFT-RWD.9] Playbook / milestone celebrations

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Real milestones get a rare celebration that passes through a celebration budget and respects Reduce Motion and a celebrations setting.
- Evidence: No `CelebrationBudget` and no `settings.celebrationsEnabled`. Success haptics and the money flash are not tied to a named milestone. No full-screen confetti was found.
- Remediation: Celebrate only named milestones (first award, tenth win), behind a budget and a settings toggle.
- Source: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Confidence: 8

#### [CRAFT-UX.19] Layout / hit targets and safe areas

- Status: GAP
- Severity: major
- Kind: required
- Rule: Interactive targets are at least 44×44 pt, safe-area ignores are background-only, and layout uses leading/trailing.
- Evidence: Many controls set `.frame(minHeight: 44)` (referral rows, age-gate button). 42 `.frame(width:|height:)` literals are 43 pt or smaller, including a 6 pt status dot in `HomeView` that is `accessibilityHidden` and not a control. `.ignoresSafeArea()` on `BrandTheme` screen backgrounds is a full-bleed fill. No `padding(.left)` / `.right` hits. `performAccessibilityAudit(for: .hitRegion)` is not isolated; the only audit ignores contrast and covers three screens.
- Remediation: Audit every control under 44 pt, expand icon buttons with a 44 pt `contentShape`, and run the hit-region audit on each screen.
- Source: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Confidence: 6

#### [CRAFT-UX.25] App icon

- Status: GAP
- Severity: major
- Kind: required
- Rule: Ship a layered icon that stays legible in default, dark, and tinted appearances, without text or a baked black background.
- Evidence: `Assets.xcassets/AppIcon.appiconset/Contents.json` includes `AppIcon-1024.png`, a luminosity-dark image, and a luminosity-tinted image. There is no `.icon` Icon Composer file and no clear appearance. Pixels were not reviewed in this pass.
- Remediation: Author `AppIcon.icon` in Icon Composer, including a clear variant, and review all appearances at small size for text, photos, and a black plate.
- Source: https://developer.apple.com/design/human-interface-guidelines/app-icons
- Confidence: 7

#### [CRAFT-UX.9] Loading states

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Known-shape loads use `.redacted(reason: .placeholder)` skeletons; progress copy is specific; do not block the whole screen with a spinner for partial work.
- Evidence: `BrandCatalogSkeleton` / `BrandSkeletonBar` and `BrandLoadingScreen(kind:accessibilityLabel:)` exist (`BrandTheme.swift`) and are used with labels such as “Loading listings…”. `.redacted(reason: .placeholder)` is absent. `ProgressView(` occurs 191 times, including bare `ProgressView()` in `ContractDetailView` and `BlockedUsersView`. The skeleton shimmers (see CRAFT-MOT.1).
- Remediation: Prefer redacted real rows over a shimmer bar, and replace bare full-screen `ProgressView()` on known layouts with that skeleton plus a specific label.
- Source: https://developer.apple.com/design/human-interface-guidelines/loading
- Confidence: 8

Advisory:

- CRAFT-APP.9 — FAIL: Accessibility display settings / Smart Invert
- CRAFT-PERF.18 — FAIL: Idle and background work
- CRAFT-RWD.31 — FAIL: Guidance / stopping cues and user control
- CRAFT-HAP.20 — RISK: Significance threshold for success
- CRAFT-MOT.14 — RISK: Frequency restraint
- CRAFT-MOT.8 — RISK: Insertions and removals
- CRAFT-HAP.10 — GAP: Declarative SwiftUI API
- CRAFT-MOT.10 — GAP: SF Symbol effects
- CRAFT-MOT.11 — GAP: Numeric changes
- CRAFT-MOT.17 — GAP: Completion-driven sequencing
- CRAFT-MOT.18 — GAP: Motion, haptic, and sound coherence
- CRAFT-MOT.6 — GAP: Spatial continuity / navigation zoom
- CRAFT-MOT.7 — GAP: Spatial continuity / in-place morphs
- CRAFT-PERF.14 — GAP: Liquid Glass rendering
- CRAFT-PERF.15 — GAP: Performance test plan hygiene
- CRAFT-PERF.16 — GAP: Binary size
- CRAFT-PERF.19 — GAP: Field telemetry
- CRAFT-PERF.5 — GAP: Signposted key flows
- CRAFT-RWD.10 — GAP: Playbook / variable social feedback
- CRAFT-RWD.13 — GAP: Measurement / reproducible experiments
- CRAFT-RWD.28 — GAP: Guidance / higher-pressure mechanics
- CRAFT-RWD.29 — GAP: Guidance / do not pay people for what they already enjoy
- CRAFT-RWD.4 — GAP: Playbook / variable-ratio drops
- CRAFT-RWD.5 — GAP: Playbook / variable-interval content refresh
- CRAFT-RWD.6 — GAP: Playbook / fixed-interval daily reward
- CRAFT-RWD.8 — GAP: Playbook / collections and signalled events
- CRAFT-UX.11 — GAP: Optimistic UI
- CRAFT-UX.23 — GAP: Liquid Glass / tab bar and accessory opportunities

### Device adaptation

#### [DEV-1] Runtime detection, no model strings

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Every hardware- or performance-dependent branch reads a capability from an injected `DeviceCapabilities` service filled only by public capability APIs, and no code maps model identifiers, marketing names, or screen sizes to features or tiers.
- Evidence: `protocol DeviceCapabilities` not found. `HomeView.usesCompactHomeChrome` branches on `UIScreen.main.bounds.height < 880` and the comment names “iPhone 17e-class” versus “Pro Max” (`ios/NoMarkup/Features/HomeView.swift`). No `utsname`, `hw.machine`, or `UIDevice.current.model` hits. Views call `ProcessInfo` nowhere for capabilities, but they also never read an injected capability service.
- Remediation: Delete the height branch. Drive spacing from `horizontalSizeClass`, `ViewThatFits`, or container size. If a capability service is added, inject it; do not key it on screen height or a model id.
- Source: https://developer.apple.com/iphone-duo/prepare/
- Confidence: 9

#### [DEV-20] Size-class adaptivity

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Lay out from available space and size classes, not idiom, orientation, or a fixed height, from the smallest phone through the largest slab, including resizable split layouts.
- Evidence: `JobsView`, `MarketplaceView`, and `MessagesView` switch on `horizontalSizeClass == .regular` to `NavigationSplitView`. `HomeView` also uses `ViewThatFits`. `UIRequiresFullScreen` is false. Contradicting that, `usesCompactHomeChrome` uses `UIScreen.main.bounds.height < 880`. No `userInterfaceIdiom`, `interfaceOrientation`, or doubled safe-area inset hits. No screenshot set for iPhone SE at AX5, or for a foldable inner/outer display and Split View. `UISupportedInterfaceOrientations` on iPhone is portrait only (`Info.plist`).
- Remediation: Replace the 880 pt height check with container size or size class. Capture SE at the largest accessibility Dynamic Type and a regular-width split (iPad or foldable inner display) and fix clipping.
- Source: https://developer.apple.com/iphone-duo/prepare/
- Confidence: 8

#### [DEV-21] Test matrix

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: The gate runs UI tests and screenshots on iPhone SE (2nd generation), iPhone 15, iPhone 18 Pro, and iPhone Duo, plus each capability preset, and any device failure fails the gate.
- Evidence: No gate log or `.studio` result bundle in the iOS tree for those four simulators. `ios/README.md` documents a single destination `platform=iOS Simulator,name=iPhone 16`. Compliance notes under `docs/compliance/` record other single destinations (iPhone 16, 17, 17 Pro, and a physical iPhone 15 Pro Max). They are not this gate, and this audit did not run simulators. DEV-18 presets are absent, so they are not run either.
- Remediation: Run the UI suite on the four named simulators (Duo on the OS that provides that device type) and fail the gate if any leg fails. Do not treat a single iPhone 16 simulator pass as the matrix.
- Source: https://developer.apple.com/iphone-duo/prepare/
- Confidence: 8

#### [DEV-11] Network quality

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Observe `NWPathMonitor` and adapt: offline UI when unsatisfied, less prefetch when `isExpensive`, and no prefetch or high-resolution downloads when `isConstrained`.
- Evidence: `NetworkMonitor` (`ios/NoMarkup/Core/NetworkMonitor.swift`) uses one `NWPathMonitor` and sets `isOnline` from `path.status == .satisfied`. `RootView` shows `OfflineNetworkBanner` (“You're offline — some actions won't work until connection returns.”). `isExpensive` and `isConstrained` are never read. Apple: `var isConstrained: Bool` — “whether the path uses an interface in Low Data Mode”; `isExpensive` is the cellular/hotspot flag. Image loads (`AsyncImage`, `URLSession.shared` in `ModeratedAsyncImage.cgImage`) do not set `allowsConstrainedNetworkAccess` or `allowsExpensiveNetworkAccess`. No test asserts prefetch depth 0 when constrained.
- Remediation: Publish `isExpensive` and `isConstrained` from the existing monitor, skip nonessential image and catalog prefetch when constrained, and lower image size when expensive.
- Source: https://developer.apple.com/documentation/network/nwpath/isconstrained
- Confidence: 9

#### [DEV-16] Adaptive quality knobs

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every expensive dimension is a `QualityKnobs` value from `effectiveTier` after thermal, Low Power, and network modifiers, and views read knobs rather than the tier.
- Evidence: Applies because the app shows remote images (`AsyncImage`, `ModeratedAsyncImage`). `struct QualityKnobs` not found. Decode cap is a constant `ImageUploader.maxPixelDimension = 2048` for every device. `URLCache` is a fixed 64 MB / 256 MB. No tier, thermal, or `isConstrained` input. No unit table of T1/T2/T3 × thermal × Low Power Mode.
- Remediation: Add one pure `knobs(for:thermal:lowPower:network:)` and point image max pixel size, cache cost, and prefetch depth at it. Keep T1 ≥ T2 ≥ T3.
- Source: https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum
- Confidence: 9

#### [DEV-18] Capability mock and simulator caveats

- Status: FAIL
- Severity: major
- Kind: required
- Rule: `FixedDeviceCapabilities` presets cover each fallback, launch arguments select them, and the simulator defaults to T1 with a log when no override is set.
- Evidence: `FixedDeviceCapabilities`, `DeviceTierOverride`, `SimulateThermalState`, `SimulateLowPower`, `SimulateNoAI`, and `SimulateMaxFPS` not found. `DeviceCapabilityUITests` (`ios/NoMarkupUITests/DeviceCapabilityUITests.swift`) launches with `-ui-testing` and skips Apple Pay on the simulator; it does not inject capability presets. No `#if targetEnvironment(simulator)` default tier log.
- Remediation: Add the preset type and launch-argument parser, and run at least one UI test per preset in the gate.
- Source: https://developer.apple.com/documentation/foundation/processinfo/isiosapponmac
- Confidence: 9

#### [DEV-19] Display scale and image sizing

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Size bitmaps from the view’s `displayScale` and point size, never `UIScreen.main.scale`, and downsample at decode time, capped by the quality knob.
- Evidence: `displayScale` not found under `ios/NoMarkup`. `UIScreen.main.scale` is also absent (the only `UIScreen.main` use is `bounds.height` in `HomeView`). Remote and camera images display through `AsyncImage` / full `CGImageSourceCreateImageAtIndex` (`ModeratedAsyncImage.cgImage`). Upload downsample uses a fixed 2048 px edge, not `pointSize × displayScale`. Asset catalog has `AppIcon` and `BrandAppIcon`; slot completeness was not measured by a missing-scale audit.
- Remediation: Pass `@Environment(\.displayScale)` and the view’s point size into the thumbnail call, and cap with the DEV-16 knob.
- Source: https://developer.apple.com/documentation/uikit/uitraitcollection/displayscale
- Confidence: 8

#### [DEV-4] Memory budget, headroom, warnings

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Size memory-heavy work from `ProcessInfo.processInfo.physicalMemory`, check `os_proc_available_memory()` before each large allocation and do not cache that value, and purge caches on a memory warning.
- Evidence: `physicalMemory` and `os_proc_available_memory` not found. Memory-warning purge exists: `ImageUploader.installMemoryWarningPurge` observes `UIApplication.didReceiveMemoryWarningNotification` and calls `URLCache.shared.removeAllCachedResponses()`. The cache limit is a fixed 64 MB / 256 MB, not derived from RAM. Full-size image decode in `ModeratedAsyncImage.cgImage(from:)` is not preceded by a headroom check. Apple: `os_proc_available_memory()` returns bytes the app may allocate; “Use the returned value as advisory information only and don’t cache it.”
- Remediation: Read `physicalMemory` once in a capability type to pick the cache budget, call `os_proc_available_memory()` immediately before thumbnail and scan decodes, and keep the existing warning purge.
- Source: https://developer.apple.com/documentation/os/os_proc_available_memory
- Confidence: 9

#### [DEV-5] Thermal state and Low Power Mode

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Observe `thermalState` and Low Power Mode as live modifiers: `.serious` drops one tier, `.critical` pauses optional work, and Low Power Mode caps custom animation and defers non-urgent work. Read `thermalState` before registering.
- Evidence: `thermalStateDidChangeNotification`, `NSProcessInfoPowerStateDidChange`, and `isLowPowerModeEnabled` not found under `ios/NoMarkup`. Polling and shimmer do not change with thermal or Low Power Mode (`ProviderInstantOffersView`, `BrandSkeletonBar`). No unit or UI test drives a simulated thermal or Low Power state.
- Remediation: Read `ProcessInfo.processInfo.thermalState` and `isLowPowerModeEnabled`, then observe the two notifications, and pause prefetch, extra polling, and nonessential animation at `.critical` or in Low Power Mode.
- Source: https://developer.apple.com/documentation/foundation/processinfo/thermalstatedidchangenotification
- Confidence: 9

#### [DEV-6] Frame rate / ProMotion

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Read the max frame rate from the window scene’s screen, not `UIScreen.main`, and do not assume 120 Hz. Request custom rates with `CAFrameRateRange`. Set `CADisableMinimumFrameDurationOnPhone` only when the app has custom animation above 60 Hz.
- Evidence: `HomeView.usesCompactHomeChrome` reads `UIScreen.main.bounds.height` (`ios/NoMarkup/Features/HomeView.swift`). `maximumFramesPerSecond`, `preferredFrameRateRange`, `CADisplayLink`, and `CADisableMinimumFrameDurationOnPhone` are absent. No custom display link, Metal, or game loop, so the plist key is not required. The `UIScreen.main` hit is still the banned API. (Deprecation of `UIScreen.main` is after iOS 17 and is not scored as a deprecation finding.)
- Remediation: Remove `UIScreen.main`. If a custom animator is added later, read `windowScene.screen.maximumFramesPerSecond` and set `preferredFrameRateRange`, and add the plist key only then.
- Source: https://developer.apple.com/documentation/quartzcore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays
- Confidence: 8

#### [DEV-17] Graceful degradation UX

- Status: GAP
- Severity: major
- Kind: required
- Rule: Hide features the hardware can never run, show fixable gaps as disabled with an explanation and a route, and show a recovering state for temporary gaps. Copy never names a phone model.
- Evidence: Camera denied uses `cameraDeniedAlert` (“Camera access is turned off. Enable it in Settings, or choose a photo from your library instead.”) with Open Settings (`CameraImagePicker.swift`). Offline uses `OfflineNetworkBanner` and recovers when `isOnline` flips. Live Activities off is a silent return in `startOrUpdate` (Release does not explain Settings; in-app bid UI remains). No adaptation-plan table and no `FixedDeviceCapabilities` UI tests. User-facing strings do not say “iPhone 15 Pro” or “too old”; “This iPhone app does not restore the account.” in `AccountDeletionView` names the product, not a model requirement. The height comment in `HomeView` is not shown to the user.
- Remediation: For Live Activities off, add a one-line disabled explanation with a Settings route only where the activity is the sole progress UI. Record each capability as hide, explain, or wait, and assert those states in UI tests.
- Source: https://developer.apple.com/design/human-interface-guidelines/generative-ai
- Confidence: 7

#### [DEV-8] Camera Control

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Add Camera Control integrations only when `AVCaptureSession.supportsControls` is true, respect `maxControlsCount`, check `canAddControl`, set a controls delegate, and offer every action on screen.
- Evidence: No `AVCaptureSession`, `supportsControls`, `addControl`, or `setControlsDelegate`. Capture is `UIImagePickerController` after `CameraAuthorization.prepareToPresent()` (`ios/NoMarkup/Core/CameraImagePicker.swift`). The camera button is disabled when `isSourceTypeAvailable(.camera)` is false. There is no custom control that exists only on Camera Control hardware, and no on-screen zoom that depends on it.
- Remediation: If a custom capture session is added, gate it with `supportsControls`, `canAddControl`, and `setControlsDelegate`, and keep an on-screen control for every action. Until then, leave capture on the system picker.
- Source: https://developer.apple.com/documentation/avfoundation/avcapturesession/supportscontrols
- Confidence: 8

#### [DEV-9] Camera device discovery

- Status: GAP
- Severity: major
- Kind: required
- Rule: Find lenses with `AVCaptureDevice.DiscoverySession`, show telephoto, ultra wide, LiDAR, and ProRAW only when discovered, and handle zero devices with a placeholder.
- Evidence: `DiscoverySession` not found. No `builtInTelephotoCamera` or LiDAR toggles, so the app does not invent a lens list from the model. Zero cameras: `CameraAuthorization` returns `.unavailable` when `UIImagePickerController.isSourceTypeAvailable(.camera)` is false, and the button is disabled. The picker falls back to `.photoLibrary` only if the source disappears mid-session. There is no documented placeholder preview, and no simulator UI test asserts that placeholder.
- Remediation: Keep the system picker if lens selection stays inside it, and show an explicit no-camera placeholder instead of only a disabled button. Add `DiscoverySession` only if the app grows its own lens UI.
- Source: https://developer.apple.com/documentation/avfoundation/avcapturedevice/discoverysession/init(devicetypes:mediatype:position:)
- Confidence: 7

### Excellence rubric

#### [EXC-1] Visual hierarchy and focus

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Each screen has one primary purpose and one primary action; size, weight, and color agree on what matters.
- Evidence: `HomeView` hero (“The Market Sets The Price.”) is followed by five peer actions (`Browse open jobs` as `brandPrimaryButton`, plus instant match, shop, post, and sell). `.borderedProminent` occurs 83 times in 35 files, so many screens have more than one prominent button. No contact sheet was available; the home source is enough to show competing CTAs. Anchor: several elements at the same weight (the 4/7 boundary).
- Remediation: Keep one `.borderedProminent` / glass primary per screen and demote the other home actions to plain or bordered.
- Source: https://developer.apple.com/design/human-interface-guidelines/layout
- Confidence: 7

#### [EXC-10] Copy and voice

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Labels are specific, buttons name outcomes, and the voice does not leak jargon.
- Evidence: `Button("Submit")` on orders, contracts, and reviews. “Something went wrong on our side.” in `APIClient`. User-visible “PUT /providers/me/categories” in `ProviderWorkspaceView`. There is no `brand.json` voice file in the iOS tree to check adjectives against. Anchor: jargon reaches the UI (4).
- Remediation: Rewrite those strings as outcomes and delete API paths from the interface.
- Source: https://developer.apple.com/design/human-interface-guidelines/writing
- Confidence: 8

#### [EXC-13] Delight

- Status: FAIL
- Severity: major
- Kind: required
- Rule: One or two signature moments serve the task; they are not gimmicks and they do not hide information.
- Evidence: The distinctive pieces found are the gold money flash (`BrandMoneyFlashModifier`) and the hero line. There is no task-tied confirmation (no zoom of a bid into a receipt, no one-shot symbol effect). Haptics fire on ordinary home buttons, which works against delight-as-restraint. No reward blocker failed in a way that forces the dimension to the 4 cap (CRAFT-RWD.18 and CRAFT-RWD.19 pass). Anchor: one generic pleasant touch (7), not a signature (9).
- Remediation: Keep a single confirmation moment on bid awarded or order paid, and remove haptics from ordinary taps.
- Source: https://developer.apple.com/design/awards/
- Confidence: 6

#### [EXC-14] Accessibility grace

- Status: FAIL
- Severity: major
- Kind: required
- Rule: VoiceOver order, rotor headings, large-text layout, and Increase Contrast are designed, beyond a suppressed audit.
- Evidence: Some headers use `.accessibilityAddTraits(.isHeader)` (home hero, age gate). The audit ignores contrast (CRAFT-UX.27). AX5 reflow is missing (CRAFT-UX.17). `accessibilityRotor` was not found as a pattern. Increase Contrast does not restyle gold borders. Anchor: audits pass partly by suppression, and AX5 is unproven (4/7).
- Remediation: Stop suppressing contrast, reflow AX5 layouts, and add rotors for jobs, listings, and messages.
- Source: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Confidence: 7

#### [EXC-3] Typography

- Status: FAIL
- Severity: major
- Kind: required
- Rule: A small text-style scale, tabular numerals where values change, and layouts that still look composed at AX5.
- Evidence: Text styles are used, and `.monospacedDigit()` is common on money. `.lineLimit(1)` is used 61 times. There is no `AnyLayout` switch on `dynamicTypeSize`. AX5 screenshots were not in this pass. That matches the 7 anchor (styles used, AX5 not reflowed) more than the 9 anchor.
- Remediation: Reflow title-and-price rows at accessibility sizes and drop one-line limits on names and amounts.
- Source: https://developer.apple.com/design/human-interface-guidelines/typography
- Confidence: 7

#### [EXC-4] Color and materials

- Status: FAIL
- Severity: major
- Kind: required
- Rule: One accent marks interactive or primary elements; status colors pair with a symbol or text; glass stays on controls; light, dark, and Increase Contrast are each designed.
- Evidence: Gold is the accent and also the italic hero line, section emphasis, and many icons (`HomeView`, `BrandTheme.goldBright`). Dark and light surfaces are designed (`#07080B` / `#F6F4EF`). Increase Contrast exists for solid text tokens but not for gold borders (CRAFT-APP.7). Glass is limited to the primary CTA. Light gold on paper fails non-text contrast (CRAFT-APP.16). Anchor: one accent, overused (7).
- Remediation: Use gold only on controls and the single primary action; keep headlines in `textPrimary`.
- Source: https://developer.apple.com/design/human-interface-guidelines/color
- Confidence: 7

#### [EXC-6] Motion choreography

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Springs, source-matched navigation, interruptible gestures, and a Reduce Motion cross-fade.
- Evidence: Curves are ease and linear (CRAFT-MOT.2). No navigation zoom (CRAFT-MOT.6). Reduce Motion is partial (CRAFT-MOT.12). No motion strips were captured. That matches the 4/7 anchors (ease curves, generic push, Reduce Motion not designed everywhere). Scored from code because this pass does not use the later taste rubric; stills-only N/A was not applied.
- Remediation: Adopt spring tokens, zoom from the tapped card, and a cross-fade fallback on every moving transition.
- Source: https://developer.apple.com/design/human-interface-guidelines/motion
- Confidence: 8

#### [EXC-7] Haptics

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Haptics are semantic, sparing, synchronized with the visual change, and never the only signal.
- Evidence: No `RecordingHapticsService` log. Code shows 274 call sites, a tab-switch selection tick, and success/error/warning generators chosen ad hoc (`BrandHaptics`). That matches the 4 anchor (haptics on ordinary taps, not a mapped system). Taste-pass N/A was not used; the call-site evidence is enough to fail the sparing and semantic bars.
- Remediation: Cut haptics to the semantic map and record them with a test double.
- Source: https://developer.apple.com/design/human-interface-guidelines/playing-haptics
- Confidence: 8

#### [EXC-8] States (empty, loading, error, offline)

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Empty, loading, error, and offline states are designed, specific, and actionable.
- Evidence: `BrandEmptyState`, `BrandLoadingScreen`, and `RootView`’s `OfflineNetworkBanner` exist, with specific loading labels on some screens. Errors still surface `localizedDescription` (CRAFT-UX.10). Many lists do not use `ContentUnavailableView` (CRAFT-UX.8). Loading still includes bare `ProgressView()` and a shimmer skeleton. Anchor: between a generic empty state (7) and raw error strings (4).
- Remediation: Standardize empty and error on `ContentUnavailableView` with a retry or next action, and stop showing raw errors.
- Source: https://developer.apple.com/design/human-interface-guidelines/loading
- Confidence: 8

#### [EXC-9] Onboarding and first run

- Status: FAIL
- Severity: major
- Kind: required
- Rule: A new person reaches real value in under 30 seconds and two taps, with no sign-in, permission, or paywall before value.
- Evidence: `RootView` shows `LoginView` whenever `auth.isAuthenticated` is false, so browsing is behind a sign-in wall (scaffold browse mode is a test session, not the product path). After register, `OnboardingWizardView` is a four-step sheet. Age is a date-of-birth gate (`AgeGateView`), not a value screen. No first-run timing video was captured. The sign-in wall matches the 4 anchor.
- Remediation: Let people browse jobs and listings before an account, and ask for sign-in only when they bid, post, or message.
- Source: https://developer.apple.com/design/human-interface-guidelines/onboarding
- Confidence: 8

#### [EXC-11] Flow efficiency

- Status: GAP
- Severity: major
- Kind: required
- Rule: Core tasks meet a recorded tap and time target, with smart defaults and no dead ends.
- Evidence: No `flows.json` or `docs/studio/02-design.md` targets. Post-job, checkout, and bid flows were not timed. Apple Pay entitlement exists; whether it is the first pay method was not measured.
- Remediation: Record tap and second targets for bid, buy, and post, then measure them.
- Source: https://developer.apple.com/design/human-interface-guidelines/
- Confidence: 5

#### [EXC-12] Perceived performance

- Status: GAP
- Severity: major
- Kind: required
- Rule: Touch feedback is visible within 100 ms, content arrives skeleton-then-cache-then-fresh, and reversible actions are optimistic.
- Evidence: Primary buttons scale on press (a same-frame highlight). Catalog screens have `BrandLoadingScreen` skeletons, but many paths still use `ProgressView` and wait on the network (CRAFT-UX.11). No +80 ms motion frame was captured.
- Remediation: Capture a motion strip of a list load and a bid tap, and make reversible toggles optimistic.
- Source: https://developer.apple.com/design/human-interface-guidelines/loading
- Confidence: 6

#### [EXC-2] Layout rhythm, spacing and density

- Status: GAP
- Severity: major
- Kind: required
- Rule: Spacing comes from one 4/8 pt scale, with shared leading edges and tighter gaps inside groups than between them.
- Evidence: Pads seen in source include 16, 20, and 24, and also 14, 10, 6, and 5 (`HomeView`, `OnboardingWizardView`, `BrandCatalogSkeleton` spacing 14 and 10). No spacing token enum is enforced. Gaps were not measured on device.
- Remediation: Introduce one spacing scale and replace off-scale pads, then measure five gaps per primary screen.
- Source: https://developer.apple.com/design/human-interface-guidelines/layout
- Confidence: 6

#### [EXC-5] Iconography and imagery

- Status: GAP
- Severity: major
- Kind: required
- Rule: SF Symbols share one weight and rendering mode; photos share one aspect and a designed placeholder.
- Evidence: Symbols are SF Symbols. Rendering mode is not standardized. Photo aspect ratios and failed-image placeholders were not reviewed from screenshots. `ModeratedAsyncImage` exists for remote UGC.
- Remediation: Pick one symbol rendering mode per context and one card aspect ratio with a symbol placeholder.
- Source: https://developer.apple.com/design/human-interface-guidelines/sf-symbols
- Confidence: 5

### Frameworks

#### [FW-ACTIVITYKIT.11] End when the event ends

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Always end the Live Activity when the event ends, include a final ContentState, and plan for the 8 hour system limit.
- Evidence: ios/NoMarkup/Core/AuctionLiveActivityController.swift outcome path ends with final content and dismissalPolicy `.after(now+15min)`. ActivityUpdateBox.endImmediate() at line 341 calls `activity.end(nil, dismissalPolicy: .immediate)` on sign-out, withdraw, and sweep, so those ends have no final ContentState. Auctions can run longer than 8 hours and there is no restart strategy. Attributes are compiled into both targets.
- Remediation: Pass a final ContentState on every end, including endImmediate, and restart any auction that will exceed 8 hours.
- Source: https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- Confidence: 9

#### [FW-LOCALAUTHENTICATION.3] Fallback

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Biometrics supplement your authentication; they must never be the only way in. Handle every failure (no hardware, not enrolled, no passcode, user cancel, user fallback, lockout, invalidated context) by falling back to your own scheme (password, passkey, magic link). `localizedCancelTitle` can name that fallback, for example "Use Password".
- Evidence: `BiometricGate.authenticate` sets `localizedCancelTitle = "Cancel"`. The `evaluatePolicy` reply discards the error (`success, _`) and maps no `LAError.Code`. When `canEvaluatePolicy` is false, the function returns `true` (allow), including when the user turned the lock on. `NoMarkupApp.biometricLockOverlay` offers only an Unlock button that calls `authenticate` again. There is no password or passkey path and no sign-out from the overlay. `.deviceOwnerAuthentication` can show the system passcode sheet, but cancel or a discarded error leaves the overlay as the only way back in.
- Remediation: Map `LAError` codes. Set `localizedCancelTitle` to “Use Password”. On cancel, lockout, or not enrolled, leave the lock via the existing password or passkey session, or sign out to `LoginView`. If the user enabled the lock and policy cannot be evaluated, do not return true.
- Source: https://developer.apple.com/documentation/localauthentication/logging-a-user-into-your-app-with-face-id-or-touch-id
- Confidence: 9

#### [FW-SIWA.11] Revoke tokens on account deletion

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Account deletion calls the server, which revokes Sign in with Apple tokens with POST https://appleid.apple.com/auth/revoke.
- Evidence: No POST to https://appleid.apple.com/auth/revoke. AccountDeletionView and the user-service deletion path delete app refresh tokens and rewrite the email to a deleted.local address. The native flow never stores an Apple refresh token that could be revoked.
- Remediation: On account deletion, call the revoke endpoint with the stored Apple refresh token and the server client secret.
- Source: https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens
- Confidence: 9

#### [FW-SIWA.6] Verify identity token and authorization code

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: The app sends the identity token and the authorization code plus the user identifier to the server, and the server verifies the token and exchanges the code.
- Evidence: ios/NoMarkup/Auth/AuthViewModel.swift handleSignInWithApple at line 650 sends the identity token, an in-memory full name, and the raw nonce via exchangeAppleIdentityToken. It does not read credential.authorizationCode or credential.user. ios/NoMarkup/Core/APIClient.swift signInWithApple body keys are identity_token, full_name, and nonce only. gateway/internal/handler/oauth.go verifyAppleIDToken checks the Apple JWKS, issuer https://appleid.apple.com, audience from the configured client ids, RS256, expiry, and subject. Accounts are keyed by the subject claim. The web path exchanges the code at the Apple token endpoint. The native path never sends the authorization code. The rule requires both tokens.
- Remediation: Post the identity token, the authorization code, and the Apple user id. Exchange the code at the Apple token endpoint and keep the refresh token for revoke.
- Source: https://developer.apple.com/documentation/signinwithapple/verifying-a-user
- Confidence: 9

#### [FW-STOREKIT.3] Unfinished and current entitlements

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: At launch, also iterate `Transaction.unfinished` and `Transaction.currentEntitlements`.
- Evidence: StoreKitManager.refreshEntitlementsFromStore iterates Transaction.currentEntitlements on the enabled path. Transaction.unfinished is never iterated. apple_docs.sh show Transaction.unfinished (iOS 15.0+): `static var unfinished: Transaction.Transactions { get }`. Discussion: use the unfinished sequence to find the transactions the app needs to process. A transaction stays unfinished until finish() is called.
- Remediation: In the same launch task, iterate Transaction.unfinished, verify, grant or revoke, then finish().
- Source: https://developer.apple.com/documentation/storekit/supporting-offer-codes-in-your-app
- Confidence: 9

#### [FW-UIKIT.1] Scenes / scene-based life cycle is mandatory

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: A SwiftUI app must ship `UIApplicationSceneManifest`. A delegate must not create a window, and must not implement `applicationDidBecomeActive`, `applicationWillResignActive`, `applicationDidEnterBackground`, or `applicationWillEnterForeground`, because UIKit does not call them under the scene life cycle.
- Evidence: `Info.plist` has `UIApplicationSceneManifest` with `UIApplicationSupportsMultipleScenes` true. `didFinishLaunching` returns true and does not create a `UIWindow`. `PushRegistration.swift` implements `applicationDidBecomeActive` and reconciles the badge there.
- Remediation: Remove `applicationDidBecomeActive`. Reconcile the badge from `scenePhase`.
- Source: https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle
- Confidence: 9

#### [FW-USERNOTIFICATIONS.5] Delegate at launch

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Assign the notification center delegate and call `setNotificationCategories(_:)` at launch, before the launch method returns.
- Evidence: ios/NoMarkup/Core/PushRegistration.swift NoMarkupAppDelegate.application(_:didFinishLaunchingWithOptions:) returns true immediately and assigns the delegate inside `Task { @MainActor in PushRegistration.shared.configure() }` at lines 404–411. configure() sets UNUserNotificationCenter.current().delegate and setNotificationCategories. That work is not synchronous before return, so a notification action that launches the app can arrive before the delegate exists.
- Remediation: Set the delegate and categories synchronously in didFinishLaunchingWithOptions before returning true.
- Source: https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types
- Confidence: 9

#### [FW-USERNOTIFICATIONS.9] Register every launch

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Call `registerForRemoteNotifications()` on every launch, forward the token each time, and implement the failure callback.
- Evidence: PushRegistration.registerForRemoteNotifications() runs only from syncIfAuthorized (authenticated and already authorized, provisional, or ephemeral), noteValueMoment, and confirmPrePrompt. It is not called on a signed-out launch. didFailToRegister exists and stores lastError. The token is uploaded when a session exists. aps-environment is development. deviceID uses identifierForVendor for the push row, which is separate from purchases. apple_docs.sh show registerForRemoteNotifications(): `func registerForRemoteNotifications()` (iOS 8.0+). On success the delegate receives the device token to forward to the server.
- Remediation: Call registerForRemoteNotifications() at the end of every launch, including signed-out launches, and forward whatever token APNs returns.
- Source: https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns
- Confidence: 9

#### [FW-XCODE-A.1] Toolchain baseline

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Build with Xcode 27.2, which ships Swift 6.4 and the iOS 27.2 SDK, and do not pass `-ld_classic`.
- Evidence: `.github/workflows/ios-ci.yml` sets `XCODE_MAJOR: "26"` and `xcode-select`s the highest Xcode 26.x on `macos-15`. Local `xcodebuild -version` is Xcode 27.2 (Build 27B52) at `/Applications/Xcode.app`. No `ld_classic` in the pbxproj.
- Remediation: Pin CI to Xcode 27.2 and select `/Applications/Xcode.app/Contents/Developer`.
- Source: https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes
- Confidence: 9

#### [FW-XCODE-A.20] Icon Composer app icon wiring

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Ship the app icon as an Icon Composer `.icon` file whose name equals `ASSETCATALOG_COMPILER_APPICON_NAME`.
- Evidence: `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` on the app target. No `.icon` file exists under `ios/`. The icon is only `AppIcon.appiconset`.
- Remediation: Add `AppIcon.icon` (1024 canvas, at most four groups) to the app target so it replaces the catalog set, and keep fallback images generated from it.
- Source: https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer
- Confidence: 9

#### [FW-ACCESSIBILITY.1] Audits / coverage of states, not just screens

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Run `performAccessibilityAudit` on every reachable state (empty, populated, sheet, error, search, settings), and record a manual VoiceOver pass.
- Evidence: `DeviceCapabilityUITests` calls `performAccessibilityAudit` once, and the handler ignores status-bar, keyboard, and home-indicator issues. It does not relaunch empty versus seeded, and it does not audit a sheet or a validation error. No dated VoiceOver walkthrough is in the tree. CI does not run `NoMarkupUITests`.
- Remediation: Audit empty, populated, add/edit sheet, validation error, search, and settings as separate launches, and record a VoiceOver pass of the main tasks.
- Source: https://developer.apple.com/documentation/accessibility/performing-accessibility-audits-for-your-app
- Confidence: 8

#### [FW-ACCESSIBILITY.5] Interaction model / grouping, custom actions, adjustable, and modal

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Combine title/value pairs into one element, expose secondary buttons as accessibility actions, make carousels adjustable, and mark custom full-screen overlays modal.
- Evidence: Many views call `accessibilityElement(children:)`. `accessibilityAction(named:)` count is 0, so per-row secondary buttons are not rotor actions. `accessibilityAddTraits(.isModal)` count is 0. No VoiceOver walkthrough notes confirm one-swipe rows.
- Remediation: Add `.accessibilityAction(named:)` for secondary row buttons and `.accessibilityAddTraits(.isModal)` on custom full-screen overlays.
- Source: https://developer.apple.com/documentation/accessibility/delivering-an-exceptional-accessibility-experience
- Confidence: 8

#### [FW-ACTIVITYKIT.12] Reconcile on launch

- Status: FAIL
- Severity: major
- Kind: required
- Rule: On every launch, enumerate `Activity.activities`, and observe `activityUpdates`, `activityStateUpdates`, and `contentUpdates`.
- Evidence: ios/NoMarkup/NoMarkupApp.swift sweeps at launch and ends activities whose endsAt is past, using `.activities`. No activityUpdates, activityStateUpdates, or contentUpdates observers.
- Remediation: Subscribe to activityUpdates and per-activity state and content updates, and rebind the token sender after launch.
- Source: https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- Confidence: 9

#### [FW-ACTIVITYKIT.14] Live Activity push payload

- Status: FAIL
- Severity: major
- Kind: required
- Rule: ActivityKit pushes use `apns-push-type: liveactivity` and a content-state the system decodes with default JSON strategies.
- Evidence: services/notification/internal/service/apns.go sets apns-push-type liveactivity and topic bundleID plus `.push-type.liveactivity`. ContentState keys leadingBidCents, endsAt, and optional outcome match the Swift type. services/notification/internal/service/service.go buildLiveActivityContentState sets endsAt to Unix seconds (tests expect 1700003600). Apple’s Live Activity push article: set content-state fields to match ContentState and do not use custom JSON encoding strategies, because the system decodes with its default strategies and custom strategies fail the update. Default JSONDecoder Date decoding is seconds since 2001-01-01, not Unix 1970. The article documents seconds since 1970 for the aps timestamp field, not for content-state dates. No iOS test decodes the server fixture with JSONDecoder().
- Remediation: Send endsAt as a Foundation default JSON date (seconds since 2001-01-01) and add a fixture test that decodes the server payload into ContentState.
- Source: https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications
- Confidence: 8

#### [FW-ACTIVITYKIT.16] Priority budget

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Priority 10 counts against the hourly budget. Send routine updates at priority 5 and reserve 10 for immediate changes.
- Evidence: services/notification/internal/service/apns.go sendLiveActivity hardcodes apns-priority "10" at line 244. apns_test.go expects 10. No NSSupportsLiveActivitiesFrequentUpdates and no frequentPushesEnabled. Alert pushes mix priority via apnsPriority; live activities do not. Apple: an omitted priority defaults to 10 and counts against the budget; consider priority 5 first and mix 5 and 10.
- Remediation: Send routine bid updates at apns-priority 5 and reserve 10 for outcome and closing alerts.
- Source: https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications
- Confidence: 9

#### [FW-ACTIVITYKIT.6] Enablement and errors

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Show start UI only when `areActivitiesEnabled` is true, observe `activityEnablementUpdates`, and catch request, update, and end errors.
- Evidence: ios/NoMarkup/Core/AuctionLiveActivityController.swift calls Activity.request inside do/catch and guards areActivitiesEnabled. activityEnablementUpdates is not observed, so the start UI does not react when the person turns Live Activities off.
- Remediation: Observe activityEnablementUpdates and hide the start control when activities are disabled.
- Source: https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- Confidence: 9

#### [FW-APPINTENTS.20] Spotlight / indexed entities

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Make user-facing entities `IndexedEntity` and index them into a named `CSSearchableIndex(name:)`; the default index is only for prototyping.
- Evidence: ios/NoMarkup/Core/SpotlightIndex.swift lines 81 and 95 call `CSSearchableIndex.default().indexAppEntities`. Deletes at lines 107–126 also use the default index. No `CSSearchableIndex(name:)`. JobEntity and ListingEntity are IndexedEntity (`@available(iOS 18)`). No IndexedEntityQuery. apple_docs.sh show CSSearchableIndex/default(): `class func default() -> Self` (iOS 9.0+). Discussion: “The default index doesn’t protect data or support batch updates, so use it only during prototyping or testing. In your production code, create named indexes using init(name:) or init(name:protectionClass:).” indexAppEntities(_:priority:) is `func indexAppEntities(_ appEntities: [some IndexedEntity], priority: Int = 0) async throws` (iOS 18.0+).
- Remediation: Index with `CSSearchableIndex(name:)` or init(name:protectionClass:) and implement IndexedEntityQuery reindex methods.
- Source: https://developer.apple.com/documentation/appintents/making-app-entities-available-in-spotlight
- Confidence: 9

#### [FW-APPINTENTS.21] Spotlight / open from results

- Status: FAIL
- Severity: major
- Kind: required
- Rule: For every entity type donated to Spotlight, provide an `OpenIntent` whose `target` is that entity.
- Evidence: ListingEntity is IndexedEntity and OpenListingIntent.target is ListingEntity. JobEntity is IndexedEntity and has no OpenIntent. ShowInAppSearchResultsIntent is implemented on SearchNoMarkupIntent with schema `.system.search` (iOS 18).
- Remediation: Add an OpenIntent whose target type is JobEntity and route it to the job detail scene.
- Source: https://developer.apple.com/documentation/appintents/making-app-entities-available-in-spotlight
- Confidence: 9

#### [FW-APPINTENTS.33] Testing / AppIntentsTesting integration tests

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Cover the intents with AppIntentsTesting integration tests in a UI testing target signed with the same team.
- Evidence: ios/NoMarkupTests/NotificationDeepLinkTests.swift exercises AppIntent.perform() in-process in the unit-test target NoMarkupTests, not a UI-test target. No `import AppIntentsTesting` and no IntentDefinitions(bundleIdentifier:). An in-tree comment states AppIntentsTesting is absent from the installed iPhoneOS 26.5 SDK.
- Remediation: Add a UI-test target that launches the app and uses IntentDefinitions once the SDK provides AppIntentsTesting. Keep isDiscoverable=false helpers inside #if DEBUG.
- Source: https://developer.apple.com/documentation/appintentstesting/testing-your-app-intents-code
- Confidence: 8

#### [FW-APPINTENTS.4] Parameters / parameter summary

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every intent with parameters implements `static var parameterSummary` using localized natural language that embeds parameter key paths.
- Evidence: ios/NoMarkup/Intents/CheckInToJobIntent.swift:parameterSummary is present. ios/NoMarkup/Intents/SearchNoMarkupIntent.swift:SearchCatalogIntent `@Parameter query` has no parameterSummary. OpenListingIntent target and NextClosingConfigurationIntent parameters also lack parameterSummary.
- Remediation: Add `static var parameterSummary` with a localized Summary that embeds each parameter key path on SearchCatalogIntent, OpenListingIntent, and NextClosingConfigurationIntent.
- Source: https://developer.apple.com/documentation/appintents/adding-parameters-to-an-app-intent
- Confidence: 9

#### [FW-AUTHSVC-A.1] Sign in with Apple — request and credential handling

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Start Sign in with Apple from the system button, request only the scopes you use, and on success create the account from the stable `user` identifier, storing it in the Keychain. Name and email arrive only on the first authorization, so persist them then. Handle cancel without an error alert.
- Evidence: `SignInWithAppleButton` uses SwiftUI `SignInWithAppleButton` with `requestedScopes = [.fullName, .email]`. Entitlement `com.apple.developer.applesignin` = `[Default]`. `AuthViewModel.handleSignInWithApple` returns on `ASAuthorizationError.canceled` without an alert and forwards `credential.fullName` only when Apple includes it. `credential.user` is not written to `KeychainTokenStore` (accounts are only the two session tokens). `apple_docs.sh show` `SignInWithAppleButton`: SwiftUI struct, iOS 14+.
- Remediation: Persist `ASAuthorizationAppleIDCredential.user` (and the first-authorization name and email) in the keychain.
- Source: https://developer.apple.com/documentation/authenticationservices/implementing-user-authentication-with-sign-in-with-apple
- Confidence: 9

#### [FW-AUTHSVC-A.2] Sign in with Apple — credential state at launch

- Status: FAIL
- Severity: major
- Kind: required
- Rule: At launch (and on `ASAuthorizationAppleIDProvider.credentialRevokedNotification`), call `getCredentialState(forUserID:)` for the stored user ID; if `.revoked` or `.notFound`, sign the person out and show the login UI.
- Evidence: `getCredentialState` and `credentialRevokedNotification` are not in the tree. A revoked Apple ID can remain signed in through the refresh token. `apple_docs.sh show` of the symbol path was blocked by a local command hook because the path contains “credential”. Search hit: `getCredentialState(forUserID:completion:)` instance method, AuthenticationServices, iOS 13.0+, “Returns the credential state for the given user in a completion handler.” `ASAuthorizationAppleIDProvider.CredentialState` is the result enumeration.
- Remediation: Store the Apple user id, and at launch and on `credentialRevokedNotification` call `getCredentialState(forUserID:)`. Sign out on `.revoked` and `.notFound`.
- Source: https://developer.apple.com/documentation/authenticationservices/implementing-user-authentication-with-sign-in-with-apple
- Confidence: 9

#### [FW-AUTHSVC-B.3] Passkeys / combined sign-in and no-credential path

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Offer every credential type in one sheet: pass the passkey assertion request together with `ASAuthorizationPasswordProvider().createRequest()` and, if offered, `ASAuthorizationAppleIDProvider().createRequest()`, all in the same `ASAuthorizationController`. If an assertion returns an error because there are no credentials on the device, steer the person to account creation instead of showing a dead-end error.
- Evidence: `PasskeyAuth` builds an `ASAuthorizationController` with only the passkey request. Errors surface `error.localizedDescription`. There is no branch that routes “no credentials” to sign-up.
- Remediation: Put passkey, password, and Apple ID requests on one controller, and send the no-credential error to account creation.
- Source: https://developer.apple.com/documentation/authenticationservices/supporting-passkeys
- Confidence: 8

#### [FW-LOCALAUTHENTICATION.4] Prompt text

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Give `localizedReason` a clear, localized reason for the authentication. Don't include the app name: the system already shows it.
- Evidence: `NoMarkupApp.unlockWithBiometrics` reason is the hardcoded string “Unlock NoMarkup to view your account and bids.” Account deletion uses “Confirm account deletion with \(biometryDisplayName).” Payment-method removal uses “Confirm removing a saved payment method with \(biometryDisplayName).” None use `String(localized:)`. `apple_docs.sh show` `localizedReason`: “It should not contain the app name, because that appears elsewhere in the authentication dialog.”
- Remediation: Pass `String(localized:)` reasons that do not contain “NoMarkup”.
- Source: https://developer.apple.com/documentation/localauthentication/logging-a-user-into-your-app-with-face-id-or-touch-id
- Confidence: 9

#### [FW-PASSKIT.3] System button and canMakePayments

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Start payment with the system Apple Pay button, and hide it or show Set Up when the device cannot make payments.
- Evidence: ios/NoMarkup/Features/ListingDetailView.swift line 1273 shows PayWithApplePayButton(.buy). ios/NoMarkup/Features/MyOrdersView.swift line 237 shows PayWithApplePayButton(.plain). Neither is gated. Product UI does not call canMakePayments() or canMakePayments(usingNetworks:), and it has no set-up button. DeviceCapabilityUITests reads canMakePayments() and does not gate the UI. Scaffold mode uses a disabled custom Pay label, not a drawn Apple Pay mark. apple_docs.sh show canMakePayments(): `class func canMakePayments() -> Bool` (iOS 10.0+). It is true when the hardware and parental controls allow payments. PayWithApplePayButton (iOS 16.0+): `@MainActor struct PayWithApplePayButton<Fallback>`. Discussion: the SwiftUI equivalent of PKPaymentButton.
- Remediation: Show PayWithApplePayButton only when canMakePayments() is true. Otherwise show the set-up style or hide the button.
- Source: https://developer.apple.com/documentation/passkit/offering-apple-pay-in-your-app
- Confidence: 9

#### [FW-PHOTOKIT.1] Picker vs. library access

- Status: FAIL
- Severity: major
- Kind: required
- Rule: When the app only needs photos the person chooses, use the system Photos picker. An app that only picks photos does not declare `NSPhotoLibraryUsageDescription`. Use `UIImagePickerController` only for camera capture with the system camera UI, never for library picking.
- Evidence: Library selection uses `PhotosPicker` (`ProfileSettingsView`, `VerificationDocumentsView`, `MessagesView`, `ImageUploader`, `ContractDetailView`). No `PHPhotoLibrary.requestAuthorization`. `Info.plist` and `Info-Debug.plist` still declare `NSPhotoLibraryUsageDescription` (“NoMarkup needs access to your photos…”). `CameraImagePicker.makeUIViewController` sets `sourceType` to `.photoLibrary` when `.camera` is unavailable. `apple_docs.sh show` `PhotosPicker`: `@MainActor @preconcurrency struct PhotosPicker<Label> where Label : View`, iOS 16+, out-of-process picker.
- Remediation: Remove `NSPhotoLibraryUsageDescription`. Keep `PhotosPicker` for the library. If the camera is unavailable, stay on `PhotosPicker` instead of `UIImagePickerController` `.photoLibrary`.
- Source: https://developer.apple.com/documentation/photokit/selecting-photos-and-videos-in-ios
- Confidence: 9

#### [FW-SECURITY.2] Keychain / accessibility class

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Set `kSecAttrAccessible` explicitly on every item and use the most restrictive class that works. Default to `kSecAttrAccessibleWhenUnlocked`. Use `kSecAttrAccessibleAfterFirstUnlock(ThisDeviceOnly)` only when background code (BGTask, push, location relaunch) must read the item while the device is locked.
- Evidence: Device `SecItemAdd` sets `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (`KeychainTokenStore.save`, lines 41–42). Simulator sets `kSecAttrAccessibleAfterFirstUnlock`. The comment cites `errSecInteractionNotAllowed` and backup behavior, not a locked-device reader. No `BGTaskScheduler`, `beginBackgroundTask`, silent push, or background location reads these items. `apple_docs.sh show` `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: `let kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly: CFString` — “The data in the keychain item cannot be accessed after a restart until the device has been unlocked once by the user.” Discussion: after first unlock the item stays readable until the next restart; recommended for background apps; items do not migrate. `kSecAttrAccessibleWhenUnlocked`: accessible only while unlocked; recommended for foreground apps; migrates with encrypted backups; default if unset.
- Remediation: Store tokens as `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` unless a named background reader must use them while locked, and comment that reader. Set the class on the update path as well.
- Source: https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility
- Confidence: 9

#### [FW-SIWA.12] Server-to-server notifications

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Register one HTTPS endpoint and process email-disabled, email-enabled, consent-revoked, and account-delete events.
- Evidence: No Apple server-to-server notification route. No JWS validation of those events.
- Remediation: Add the endpoint, verify the JWS, and sign the user out on consent-revoked and account-delete.
- Source: https://developer.apple.com/documentation/signinwithapple/processing-changes-for-sign-in-with-apple-accounts
- Confidence: 8

#### [FW-SIWA.2] Credential state on foreground

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Store the credential user identifier and refresh credential state when the scene becomes active.
- Evidence: No getCredentialState or credentialState(forUserID:) in ios/. The Apple user identifier is not written to the Keychain. No scenePhase refresh. apple_docs.sh show getCredentialState(forUserID:completion:) (iOS 13.0+) and `func credentialState(forUserID userID: String) async throws -> ASAuthorizationAppleIDProvider.CredentialState`. userID is the opaque string from the credential user property.
- Remediation: Save the credential user id at first sign-in and call credentialState when the scene becomes active.
- Source: https://developer.apple.com/documentation/authenticationservices/asauthorizationappleidprovider/getcredentialstate(foruserid:completion:)
- Confidence: 9

#### [FW-SIWA.3] Revocation notification

- Status: FAIL
- Severity: major
- Kind: required
- Rule: While the app runs, observe `credentialRevokedNotification` and sign out when it fires.
- Evidence: No observer for credentialRevokedNotification. apple_docs.sh show: `class let credentialRevokedNotification: NSNotification.Name`. Discussion: the user’s credentials have been revoked and they should be signed out.
- Remediation: Add a notification observer that runs the same sign-out as a revoked credential state.
- Source: https://developer.apple.com/documentation/authenticationservices/asauthorizationappleidprovider/credentialrevokednotification
- Confidence: 9

#### [FW-SIWA.4] Revoked means signed out

- Status: FAIL
- Severity: major
- Kind: required
- Rule: When the credential state is revoked, delete the stored Apple user id, the app session, and user-scoped caches, and invalidate the server session.
- Evidence: AuthViewModel sign-out clears the app session and widgets. It is not tied to Apple credential state, and there is no stored Apple user id to delete.
- Remediation: On a revoked state, delete the Apple user id, the session, and caches, and invalidate the server session.
- Source: https://developer.apple.com/documentation/authenticationservices/implementing-user-authentication-with-sign-in-with-apple
- Confidence: 8

#### [FW-SIWA.5] Single-use nonce

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Set a single-use random nonce on the request and have the server compare it with the identity token, then invalidate it.
- Evidence: ios/NoMarkup/Auth/SignInWithAppleButton.swift sets request.nonce to the SHA-256 hex of a client-generated raw value. The gateway compares the hash of the raw value to the token claim. The native handler rejects an empty value. The value is not stored server-side and invalidated after one use. request.state is unset. No replay test. The web Apple callback passes an empty value.
- Remediation: Issue the value from the server, store it once, reject reuse, set request.state, and require it on the web callback.
- Source: https://developer.apple.com/documentation/authenticationservices/asauthorizationopenidrequest/nonce
- Confidence: 8

#### [FW-SIWA.7] Refresh token validation

- Status: FAIL
- Severity: major
- Kind: required
- Rule: The authorization code is short-lived and single-use. Validate the refresh token periodically and handle invalid_grant.
- Evidence: The web token response’s Apple refresh token is not persisted. Only the app’s own refresh cookie is. No daily refresh-token grant against Apple. No invalid_grant handling for Apple tokens. The native path never exchanges the authorization code, so there is no Apple refresh token to validate.
- Remediation: Persist the Apple refresh token on the server and validate it on a daily job, signing the user out on invalid_grant.
- Source: https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens
- Confidence: 8

#### [FW-SIWA.9] Persist name and email immediately

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Apple returns the full name and the email only on the first authorization. Persist them before they are lost.
- Evidence: AuthViewModel builds fullName in memory and sends it in the same request as the token. It does not write the name or the credential email to disk before the network call. A failed request drops the only copy.
- Remediation: Write the name and email to the account record locally before calling the network, then send them.
- Source: https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple
- Confidence: 9

#### [FW-STOREKIT.32] StoreKit configuration file

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every IAP app keeps a StoreKit configuration file in the repo, and the Run scheme selects it.
- Evidence: No Products.storekit in the tree. No StoreKitConfigurationFileReference in the pbxproj or scheme. docs/compliance/storekit-scaffold.md lists the file as an unchecked optional. That doc was not edited.
- Remediation: Add Products.storekit mirroring the product ids and select it in the Run scheme.
- Source: https://developer.apple.com/documentation/storekit/getting-started-with-in-app-purchases-using-storekit-views
- Confidence: 9

#### [FW-STOREKIT.33] Xcode StoreKit test matrix

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Before release, run and record the StoreKit Testing in Xcode scenarios, including purchase, cancel, interrupted purchase, Ask to Buy, and restore.
- Evidence: No SKTestSession and no import StoreKitTest. No recorded Xcode matrix for purchase, cancel, interrupted purchase, Ask to Buy, restore, or renewal.
- Remediation: Add StoreKitTest coverage for purchase, cancel, pending, restore, and renewal, and keep the run log.
- Source: https://developer.apple.com/documentation/storekit/testing-in-app-purchases-in-xcode
- Confidence: 8

#### [FW-STOREKIT.4] One handle function

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Route purchase results, updates, unfinished, and currentEntitlements through one handle function that accepts only verified transactions, honors revocationDate and expirationDate, and finishes.
- Evidence: StoreKitManager has no single handle(VerificationResult). revocationDate removes access and still finishes. expirationDate and isUpgraded are not checked. The subscriptions flag is true. unfinished is not fed into any handler.
- Remediation: Add one handle used by purchase, updates, unfinished, and currentEntitlements, and treat a past expirationDate or isUpgraded as inactive.
- Source: https://developer.apple.com/documentation/storekit/getting-started-with-in-app-purchases-using-storekit-views
- Confidence: 8

#### [FW-STOREKIT.7] PurchaseResult cases

- Status: FAIL
- Severity: major
- Kind: required
- Rule: On `.pending`, show a non-blocking waiting state. On `.userCancelled`, show no error.
- Evidence: StoreKitManager purchase switch sets lastErrorMessage to "Purchase is pending approval (Ask to Buy / SCA)." on `.pending` and returns false, which surfaces an error instead of a quiet waiting state. `.userCancelled` returns false with no error. `@unknown default` sets an error string.
- Remediation: On pending, set a non-error waiting state and leave the rest of the app usable. Keep userCancelled silent.
- Source: https://developer.apple.com/documentation/storekit/testing-ask-to-buy-in-xcode
- Confidence: 9

#### [FW-STOREKIT.8] Entitlements not a stored Bool

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Derive subscription access from `Transaction.currentEntitlements`. Don't derive it from a stored Bool alone.
- Evidence: StoreKitManager.restoreLocalEntitlementFlag() in init always reads UserDefaults keys nomarkup.storekit.localEntitlement.active and productIDs, including when StoreKit is off. hasActiveLocalSubscription is localEntitlementActive or a non-empty product id set. PlanLimitsView shows "Local entitlement active" only inside the storeKitOn branch. The entitlement source is still the stored flag.
- Remediation: When the flag is on, set access only from verified currentEntitlements. Do not restore the UserDefaults bool as an entitlement.
- Source: https://developer.apple.com/documentation/storekit/supporting-monthly-subscriptions-with-a-12-month-commitment
- Confidence: 9

#### [FW-SWIFT.1] State modeling / one enum, not scattered flags

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Model mutually exclusive screen states as one enum with associated values, and switch on it, instead of combining `isLoading` with an optional error.
- Evidence: `JobsView` holds `@State private var isLoading` and `@State private var errorMessage: String?` and renders `if isLoading && jobs.isEmpty` else `if let errorMessage` (`NoMarkup/Features/JobsView.swift`). `MarketplaceView.load` uses the same pair plus `isLoadingMore` and `loadMoreError`. `AuthViewModel` publishes `isLoading`, `errorMessage`, and `statusMessage` together (`NoMarkup/Auth/AuthViewModel.swift`). No `enum LoadState` in `NoMarkup/Features`.
- Remediation: Introduce `enum LoadState<Value> { case idle, loading, loaded(Value), failed(String) }` for catalog screens and switch in the view. Keep auth field errors separate from session load state.
- Source: https://developer.apple.com/documentation/swift/maintaining-state-in-your-apps
- Confidence: 9

#### [FW-SWIFTUI.1] Data flow / observation granularity

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Always use the `@Observable` macro. Never conform to `Observable` by hand. Pass the model object into leaf views so only the leaf re-renders.
- Evidence: Zero `@Observable` types. About twelve `ObservableObject` types, including auth and flags created as `@StateObject` in `NoMarkupApp`. Views observe the whole object through `@EnvironmentObject`.
- Remediation: Migrate those models to `@Observable` and read each property in the leaf that displays it.
- Source: https://developer.apple.com/documentation/swiftui/managing-model-data-in-your-app
- Confidence: 8

#### [FW-SWIFTUI.11] Scenes / life-cycle events

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Handle foreground and background with `scenePhase`. Do not implement app-delegate foreground and background callbacks. A delegate adaptor is only for APIs that still need it, and it must not create a window.
- Evidence: `RootView` observes `scenePhase` (badge reconcile on active, re-lock on background). `NoMarkupApp` uses `UIApplicationDelegateAdaptor` for push. `PushRegistration.NoMarkupAppDelegate.applicationDidBecomeActive` still implements the app-level callback, which UIKit does not call under the scene life cycle.
- Remediation: Delete `applicationDidBecomeActive` and keep badge reconciliation in the `scenePhase == .active` handler.
- Source: https://developer.apple.com/documentation/swiftui/migrating-to-the-swiftui-life-cycle
- Confidence: 9

#### [FW-SWIFTUI.17] Privacy / screen capture

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: On screens that show sensitive data, observe `isSceneCaptured` and redact fields and high-risk actions while capture is active.
- Evidence: `sensitive_data` is true (payment, government ID, address, date of birth). No `isSceneCaptured` or `sceneCaptureState` in app sources. Background re-lock covers the app switcher only when the biometric gate is enabled, which is a different signal.
- Remediation: Redact payment and identity fields and disable payout or reveal actions while `isSceneCaptured` is true.
- Source: https://developer.apple.com/documentation/swiftui/protecting-sensitive-content-when-screen-sharing
- Confidence: 8

#### [FW-SWIFTUI.4] Data flow / @State scope

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Declare every `@State` private and set its initial value in the declaration, not with `_x = State(initialValue:)` in a view initializer.
- Evidence: `SpectateTerminalView.init` assigns `_title`, `_leadingCents`, and `_endsAtISO` from `State(initialValue:)` and builds an `ISO8601DateFormatter` in `init`.
- Remediation: Give those properties their initial values in the property declaration, or pass plain values in and format outside `init`.
- Source: https://developer.apple.com/documentation/swiftui/managing-user-interface-state
- Confidence: 8

#### [FW-SWIFTUI.5] Views / cheap initializers

- Status: FAIL
- Severity: major
- Kind: required
- Rule: View initializers do no fetching, decoding, sorting, or formatter construction. The system may reinitialize a view at any time.
- Evidence: `SpectateTerminalView.init` constructs `ISO8601DateFormatter`. That is work the rule forbids inside `init`.
- Remediation: Use `date.formatted` or a shared formatter created outside the view initializer.
- Source: https://developer.apple.com/documentation/swiftui/declaring-a-custom-view
- Confidence: 8

#### [FW-SWIFTUI.7] Navigation / value-based paths

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Path elements are lightweight `Hashable` identifiers, not model types. Place `navigationDestination(for:)` inside the stack, not inside a lazy row.
- Evidence: `navigationDestination(for: JobSummary.self)`, `ListingSummary.self`, and `ChatChannelSummary.self` in Home, Jobs, JobDrafts, Marketplace, Feed, MyListings, Watchlist, ListingDetail, and Messages. Those are model summaries used as the path payload. Login uses an `AuthRoute` enum, which matches the rule.
- Remediation: Push stable IDs or a `Route` enum and resolve the model in the destination.
- Source: https://developer.apple.com/documentation/swiftui/understanding-the-navigation-stack
- Confidence: 8

#### [FW-SWIFTUI.8] Navigation / observing and restoring the path

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Observe the path binding to restore navigation. Persist a `Codable` path per scene and restore it on connect.
- Evidence: No `NavigationPath.codable` save, no `@SceneStorage` of a path, and no relaunch UI test that asserts a detail is still visible. Destination views are not shown to bookkeep navigation in `onAppear`, but restoration is absent.
- Remediation: Store a `Codable` route array in `@SceneStorage` and restore it when the scene connects.
- Source: https://developer.apple.com/documentation/swiftui/understanding-the-navigation-stack
- Confidence: 7

#### [FW-TESTING.1] Framework choice / division of labor

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Write new unit and integration tests with Swift Testing. Keep XCTest for UI tests and performance tests. Do not mix the APIs in the same test.
- Evidence: `NoMarkupTests` imports XCTest only. Every unit test is an `XCTestCase` with `XCTAssert*`. No `import Testing`, `@Test`, or `#expect`. UI tests correctly stay on XCTest. Mirror overview: “Consider using Swift Testing for new unit test development… Continue to use XCTest for user interface tests and performance tests.”
- Remediation: Migrate `NoMarkupTests` to `@Suite` / `@Test` / `#expect`, and leave `NoMarkupUITests` on XCTest.
- Source: https://developer.apple.com/documentation/testing/migratingfromxctest
- Confidence: 9

#### [FW-TESTING.3] Expectations / #expect versus #require

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Never force-unwrap or `try!` in tests. Use `#expect` for continuing checks and `try #require` for preconditions.
- Evidence: `AppConfigTests` force-unwraps `URL(string:)!`. The suite is still XCTest, so `#expect` / `#require` are absent. One crash from a force-unwrap aborts the test process.
- Remediation: After moving to Swift Testing, unwrap with `try #require` and write `#expect` as a plain Boolean expression.
- Source: https://developer.apple.com/documentation/testing/expectations
- Confidence: 8

#### [FW-TESTING.6] Isolation / parallel-by-default

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Tests run in parallel in one process and must not share mutable globals, singletons, `UserDefaults.standard`, or on-disk stores.
- Evidence: Tests use `DeepLinkRouter.shared`, `ClientActionLog.shared`, and `URLCache.shared`. Fixtures are not built in a per-test `init()` of a Swift Testing suite. No `.serialized` justification is documented.
- Remediation: Give each test a fresh fixture and stop writing through process-wide singletons.
- Source: https://developer.apple.com/documentation/testing/parallelization
- Confidence: 8

#### [FW-UIKIT.2] Scenes / supporting multiple windows

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Activity types used to open or restore windows must be listed in `NSUserActivityTypes`, or no window is created. Per-window state stays per scene.
- Evidence: `ListingDetailView` donates `com.nomarkup.app.viewListing` and `JobDetailView` donates `com.nomarkup.app.viewJob` via `.userActivity`. `Info.plist` has no `NSUserActivityTypes`. Multiple scenes are enabled.
- Remediation: Add both activity types to `NSUserActivityTypes` in `Info.plist`.
- Source: https://developer.apple.com/documentation/uikit/specifying-the-scenes-your-app-supports
- Confidence: 9

#### [FW-UIKIT.3] Multitasking / resizable windows and orientation

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Lay out from the size the scene is given, never from the screen. Set a minimum size with `UISceneSizeRestrictions` instead of breaking below it.
- Evidence: `HomeView` uses `UIScreen.main.bounds.height < 880` to pick compact chrome. No `sizeRestrictions` or `isInteractivelyResizing` handling. The app is universal (`TARGETED_DEVICE_FAMILY = 1,2`).
- Remediation: Replace the screen-height check with `horizontalSizeClass` or container geometry, and set `windowScene.sizeRestrictions?.minimumSize` if the layout has a floor.
- Source: https://developer.apple.com/documentation/uikit/multitasking-on-ipad-mac-and-apple-vision-pro
- Confidence: 9

#### [FW-UIKIT.4] Life cycle / resign active and background

- Status: FAIL
- Severity: major
- Kind: required
- Rule: On inactive, save data and pause work. On background, free recreatable memory and hide sensitive information before the app-switcher snapshot. On active, refresh without blocking.
- Evidence: `scenePhase` `.active` reconciles the badge. `.background` re-locks only when `BiometricGate.requireForSensitiveActions` is true, so sensitive screens are not covered by default. The image cache is not trimmed on background (B.43). No app-switcher screenshot proves the card is redacted.
- Remediation: Apply a privacy cover whenever `scenePhase != .active` on payment and identity screens, and purge the image cache on `.background`.
- Source: https://developer.apple.com/documentation/uikit/preparing-your-ui-to-run-in-the-background
- Confidence: 8

#### [FW-UIKIT.7] Files / data protection classes

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Write personal files with `.completeFileProtection` when they are used only in the foreground, or `.completeFileProtectionUnlessOpen` when a background writer must keep the file open.
- Evidence: `user_files` is true. Six `data.write(to:options: .atomic)` sites (account, contract, sales, calendar, provider invoices, business hub) do not pass `.completeFileProtection`. No `fileProtectionKey` is set on those URLs. The files land in `temporaryDirectory`.
- Remediation: Pass `[.atomic, .completeFileProtection]` on each export of personal data.
- Source: https://developer.apple.com/documentation/uikit/encrypting-your-app-s-files
- Confidence: 8

#### [FW-USERNOTIFICATIONS.17] APNs request headers

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every APNs request sets apns-push-type, a matching apns-priority, a unique apns-id, and an explicit apns-expiration, and token auth is an ES256 JWT refreshed between 20 and 60 minutes.
- Evidence: services/notification/internal/service/apns.go sets apns-push-type and apns-priority on alert and liveactivity requests. bearerJWT is ES256 with kid and iss equal to the team id, cached and refreshed at 50 minutes. The key is read from APNS_AUTH_KEY_PATH or APNS_AUTH_KEY_P8 and is not committed. apns-id and apns-expiration are absent on both request builders. The token column is variable-length hex, not a fixed width.
- Remediation: Set a UUID apns-id and an explicit apns-expiration on every APNs request and log the id.
- Source: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
- Confidence: 9

#### [FW-USERNOTIFICATIONS.6] Handle every action

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every registered action is handled in `didReceive`, and the completion handler is always called after the work.
- Evidence: ios/NoMarkup/Core/PushRegistration.swift didReceive at lines 324–349 calls completionHandler() immediately, then starts a MainActor task that deep-links and reconciles the badge. Categories bid_outbid, bid_awarded, auction_closing_soon, contract_created, and new_message share VIEW and DISMISS identifiers. Reuse of one action across categories is correct. shouldDeepLink handles the default action and VIEW. DISMISS does not navigate. customDismissAction is not set. The completion handler returns before the deep link and badge work finish.
- Remediation: Await routing and badge reconciliation, then call the completion handler.
- Source: https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types
- Confidence: 8

#### [FW-WIDGETKIT.6] Snapshot and placeholder

- Status: FAIL
- Severity: major
- Kind: required
- Rule: `getSnapshot` must return quickly, and when `context.isPreview` is true it must use bundled sample data. `placeholder` returns a generic entry with no personal content.
- Evidence: ios/NoMarkupWidget/ActiveBidsWidget.swift placeholder returns an honest empty entry (count 0). getSnapshot ignores context.isPreview and calls makeEntry(), which loads the app-group snapshot of real bid titles and amounts.
- Remediation: Branch getSnapshot on context.isPreview and return bundled sample data for the gallery.
- Source: https://developer.apple.com/documentation/widgetkit/creating-a-widget-extension
- Confidence: 9

#### [FW-XCODE-A.21] Asset-catalog app icon (fallback path)

- Status: FAIL
- Severity: major
- Kind: required
- Rule: An asset-catalog AppIcon needs a 1024 universal image, a dark variant with a transparent background, and a tinted variant that is grayscale.
- Evidence: `AppIcon.appiconset/Contents.json` has universal 1024 Any, Dark, and Tinted slots. `sips` on the dark file reports `hasAlpha: no`. The tinted file’s color space is RGB, not grayscale.
- Remediation: Re-export the dark icon with alpha and the tinted icon as grayscale, both 1024×1024.
- Source: https://developer.apple.com/documentation/xcode/configuring-your-app-icon
- Confidence: 9

#### [FW-XCODE-A.23] Asset catalogs and generated asset symbols

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Put images and colors in asset catalogs and reference them with generated symbols, not string literals.
- Evidence: `ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS = YES` and `ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor`. `NoMarkupIcon.swift` still calls `Image("BrandAppIcon")`.
- Remediation: Replace string asset names with the generated symbol (`Image(.brandAppIcon)` or the catalog’s symbol name).
- Source: https://developer.apple.com/documentation/xcode/adding-images-to-your-xcode-project
- Confidence: 8

#### [FW-XCODE-A.3] Warnings as errors and diagnostic groups

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Treat all warnings as errors in every target with `SWIFT_TREAT_WARNINGS_AS_ERRORS` and `GCC_TREAT_WARNINGS_AS_ERRORS`.
- Evidence: Neither key is set in `project.pbxproj` for the app, widget, `NoMarkupTests`, or `NoMarkupUITests`. No `SWIFT_WARNINGS_AS_WARNINGS_GROUPS` exception is recorded.
- Remediation: Set both flags to YES on every target. Keep a named group as a warning only with a dated comment.
- Source: https://developer.apple.com/documentation/xcode/build-settings-reference
- Confidence: 9

#### [FW-XCODE-A.30] Test targets and frameworks

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Ship a unit-test target and a UI-test target, write unit tests in Swift Testing, and set `continueAfterFailure = false` with `XCTContext.runActivity` on multi-step UI tests.
- Evidence: Targets `NoMarkupTests` and `NoMarkupUITests` exist. `NoMarkupTests` is entirely `XCTestCase` (`XCTAssert*`); there is no `@Test`, `#expect`, or `import Testing`. UI tests use fixed `RunLoop` delays in `settle()` and `XCTContext.runActivity` is absent. `continueAfterFailure = false` is set in `NoMarkupUITests` but left true in `TabAudit` and `DeviceCapability`.
- Remediation: Move unit tests to Swift Testing. Replace `settle()` delays with `waitForExistence(timeout:)`. Set `continueAfterFailure = false` on every UI test case and wrap multi-step flows in `runActivity`.
- Source: https://developer.apple.com/documentation/xcode/adding-tests-to-your-xcode-project
- Confidence: 9

#### [FW-XCODE-A.31] Test plan: runtime issues as failures

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: A committed test plan sets Main Thread Checker and Thread Performance Checker to fail the test, and does not downgrade target-app crashes.
- Evidence: No `.xctestplan` in the repo. `NoMarkup.xcscheme` has `shouldAutocreateTestPlan = YES`, so the plan is not a reviewed file. CI does not pass `-testPlan`.
- Remediation: Commit a shared test plan referenced by the scheme, with both checkers set to failure.
- Source: https://developer.apple.com/documentation/xcode/diagnosing-performance-issues-early
- Confidence: 9

#### [FW-XCODE-A.32] Sanitizer runs

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Run the suite once per release candidate with Address Sanitizer and, separately, Thread Sanitizer.
- Evidence: `.github/workflows/ios-ci.yml` runs `xcodebuild test -only-testing:NoMarkupTests` with no `-enableAddressSanitizer` or `-enableThreadSanitizer`. No sanitizer job log is in the tree.
- Remediation: Add separate CI jobs for ASan and TSan (TSan on the simulator) and keep them out of performance runs.
- Source: https://developer.apple.com/documentation/xcode/diagnosing-memory-thread-and-crash-issues-early
- Confidence: 9

#### [FW-XCODE-A.35] Performance and launch tests

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Add `measure(metrics:)` tests, including `XCTApplicationLaunchMetric`, with baselines, and opt launch tests into every UI configuration.
- Evidence: No `measure(metrics:)`, `XCTApplicationLaunchMetric`, or `runsForEachTargetApplicationUIConfiguration` under `ios/`. No `xcbaselines` directory.
- Remediation: Add a UI-test launch metric and one hot-path metric, store baselines, and run them in a Release configuration without sanitizers.
- Source: https://developer.apple.com/documentation/xcode/adding-tests-to-your-xcode-project
- Confidence: 9

#### [FW-XCODE-A.38] Deterministic CI builds with packages

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Commit `Package.resolved` and pass `-disableAutomaticPackageResolution` in CI.
- Evidence: `ios/NoMarkup.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` is tracked and pins `stripe-ios` 24.25.0. It is not in `.gitignore`. `ios-ci.yml` does not pass `-disableAutomaticPackageResolution` or `-onlyUsePackageVersionsFromResolvedFile`.
- Remediation: Add `-disableAutomaticPackageResolution` to the CI `xcodebuild` invocation.
- Source: https://developer.apple.com/documentation/xcode/building-swift-packages-or-apps-that-use-them-in-continuous-integration-workflows
- Confidence: 9

#### [FW-XCODE-A.46] Swift runtime traps

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Handle optionals and casts explicitly. Allow `!`, `as!`, and `try!` only for programmer invariants that carry an adjacent comment.
- Evidence: Force-unwraps without an `// invariant:` comment include `AppConfig` URL literals, OAuth `URLComponents` results, legal `mailto` URLs, `APIClient+Contracts` `instId!`, and `PushRegistration` `token!`. No `try!` or `as!` in app sources.
- Remediation: Replace each unwrap with `guard let` or add an `// invariant:` comment only where the value is a compile-time literal.
- Source: https://developer.apple.com/documentation/xcode/addressing-crashes-from-swift-runtime-errors
- Confidence: 8

#### [FW-XCODE-A.5] Settings source of truth, layering and xcconfig

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Keep build settings in `project.yml` or `.xcconfig` files, never as hand edits to `project.pbxproj`, and extend list settings with `$(inherited)`.
- Evidence: No `project.yml` and no `.xcconfig` under `ios/`. Settings live only in the hand-maintained `project.pbxproj`. `xcodegen generate` cannot be the drift check.
- Remediation: Move settings into checked-in xcconfig files (or adopt a generator) and include `$(inherited)` on `OTHER_SWIFT_FLAGS` and `OTHER_LDFLAGS`.
- Source: https://developer.apple.com/documentation/xcode/adding-a-build-configuration-file-to-your-project
- Confidence: 9

#### [FW-XCODE-B.22] Dependencies / reproducible package resolution

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Commit `Package.resolved`, do not gitignore it, and make CI resolve only from that file. Share schemes.
- Evidence: `Package.resolved` is tracked and not gitignored. `NoMarkup.xcscheme` is shared. CI does not pass `-disableAutomaticPackageResolution`, so resolution is not locked to the pin.
- Remediation: Add `-disableAutomaticPackageResolution` to the iOS CI `xcodebuild` command.
- Source: https://developer.apple.com/documentation/xcode/making-dependencies-available-to-xcode-cloud
- Confidence: 9

#### [FW-XCODE-B.26] Testing / test plans

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Commit `.xctestplan` files for a fast plan, a full plan, and a performance plan, and name the plan on the `xcodebuild` command line.
- Evidence: No `.xctestplan`. The scheme autocreates a test plan. CI runs `-only-testing:NoMarkupTests` with no `-testPlan`, so UI tests are excluded.
- Remediation: Commit Unit, Full, and Performance plans, mark Unit as default, and pass `-testPlan` in CI.
- Source: https://developer.apple.com/documentation/xcode/organizing-tests-to-improve-feedback
- Confidence: 9

#### [FW-XCODE-B.28] Testing / deterministic location

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Unit tests inject coordinates. UI tests set `XCUIDevice.shared.location` to an `XCUILocation` before launch. Tests do not construct `CLLocationManager`.
- Evidence: Location features exist (`JobSiteLocationProvider`, map manager). No `XCUILocation(` in UI tests. No injected location-provider protocol is used by the tests. UI tests that would need a location do not set one.
- Remediation: Inject a location provider for unit tests and set `XCUIDevice.shared.location = XCUILocation(...)` before launch in location UI tests.
- Source: https://developer.apple.com/documentation/xcode/simulating-location-in-tests
- Confidence: 8

#### [FW-XCODE-B.29] Testing / testability seams

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Hide network, clock, location, and StoreKit behind injected protocols. Tests must not hit shared mutable singletons.
- Evidence: Unit tests touch `DeepLinkRouter.shared`, `ClientActionLog.shared`, and `URLCache.shared`. Production logic reads those singletons rather than injected clients. No offline test-plan environment is defined.
- Remediation: Inject the shared services as parameters with production defaults, and point tests at stubs.
- Source: https://developer.apple.com/documentation/xcode/updating-your-existing-codebase-to-accommodate-unit-tests
- Confidence: 8

#### [FW-XCODE-B.39] Sanitizers / Address Sanitizer and UBSan configuration

- Status: FAIL
- Severity: major
- Kind: required
- Rule: The full test plan has a Diagnostics configuration that runs unit and UI tests with Address Sanitizer and the Main Thread Checker.
- Evidence: No `.xctestplan` and no CI `-enableAddressSanitizer YES`. No xcresult with zero ASan issues.
- Remediation: Add a Diagnostics test-plan configuration with Address Sanitizer and the Main Thread Checker, and keep it out of performance runs.
- Source: https://developer.apple.com/documentation/xcode/use-of-deallocated-memory
- Confidence: 9

#### [FW-XCODE-B.40] Sanitizers / Thread Sanitizer

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Run concurrency-heavy tests in a separate Thread Sanitizer configuration. TSan cannot be combined with ASan.
- Evidence: CI has no `-enableThreadSanitizer YES` job and no TSan configuration. Swift 6 strict concurrency is on (A.2), which does not replace the required TSan run.
- Remediation: Add a simulator-only TSan configuration and fix any `@unchecked Sendable` hits before release.
- Source: https://developer.apple.com/documentation/xcode/swift-access-races
- Confidence: 9

#### [FW-XCODE-B.42] Crashes / avoiding Swift runtime traps

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Production paths that handle external data never use `!`, `try!`, `as!`, or unchecked subscripts unless the value is provably non-nil and commented.
- Evidence: Same unwraps as A.46, including `PushRegistration` `token!` and `APIClient+Contracts` `instId!` on values that come from the network or the system, not from literals.
- Remediation: Replace those unwraps with `guard let` and a logged failure.
- Source: https://developer.apple.com/documentation/xcode/sigtrap_sigill
- Confidence: 8

#### [FW-XCODE-B.43] Memory / warnings, jetsam, and suspension footprint

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Purge recreatable caches on memory warnings and again when entering the background.
- Evidence: `ImageUploader.installMemoryWarningPurge` observes `didReceiveMemoryWarningNotification` and is installed from `NoMarkupApp.init`. The `scenePhase` `.background` branch only re-locks when `BiometricGate.requireForSensitiveActions` is set. It does not trim the image cache.
- Remediation: Call the same cache purge from the `.background` scene-phase branch.
- Source: https://developer.apple.com/documentation/xcode/responding-to-low-memory-warnings
- Confidence: 8

#### [FW-XCODE-B.53] iPhone Duo / bars, toolbar items, reserved regions

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Declare toolbars on the navigation container, give every toolbar item a title and an icon, and keep custom bars out of the hierarchy. Custom full-bleed views read `reservedRegions`.
- Evidence: `HomeView` branches on `UIScreen.main.bounds.height < 880` for compact chrome, which is a screen-size assumption rather than the scene’s size. No `reservedRegions(` and no Duo pose screenshots. Tab items use filled symbols (see SWIFTUI.15) rather than title-and-icon toolbar items prepared for a vertical bar.
- Remediation: Remove the `UIScreen.main.bounds` height branch, give toolbar items both a title and an SF Symbol, and inset full-bleed media with `reservedRegions`.
- Source: https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo
- Confidence: 8

#### [FW-XCODE-B.7] Localization / plurals

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every string that interpolates a count uses plural variants. Do not hand-roll plurals with `count == 1` or a literal digit in the one-variant.
- Evidence: Hand-rolled plurals include `Models.swift` “1 provider notified”, completed-job copy in `Models+Extras`, `MessagesView` match/matches, `ClientActionLogView` row/rows, and `VerificationDocumentsView` re-uploads. About 67 catalog keys with `%lld` or `%d` lack `variations.plural`.
- Remediation: Replace ternaries with catalog plural variants (one/other, using `%lld`, never a hard-coded “1”).
- Source: https://developer.apple.com/documentation/xcode/localizing-strings-that-contain-plurals
- Confidence: 8

#### [FW-XCODE-B.8] Localization / dates, numbers, currency

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Format user-visible dates, numbers, and currency with `formatted()` or `FormatStyle`, not fixed `dateFormat` patterns.
- Evidence: User-visible `yyyy-MM-dd` `dateFormat` assignments are in `PostJobView`, `PropertiesView`, and `PropertyDetailView`. Filename stamps `yyyyMMdd-HHmmss` on account, calendar, and export paths are machine names and are not this finding.
- Remediation: Replace those three user-visible formats with `date.formatted(date:time:)`.
- Source: https://developer.apple.com/documentation/xcode/preparing-dates-numbers-with-formatters
- Confidence: 8

#### [FW-XCTEST.1] Async / UI-test waiting

- Status: FAIL
- Severity: major
- Kind: required
- Rule: In UI tests, wait for UI conditions with `waitForExistence(timeout:)`, never with `sleep`.
- Evidence: `NoMarkupUITests.settle()`, and the same helper in `TabAudit`, `ScreenshotWalk`, and `DeviceCapability`, spin `RunLoop.current.run(until:)` for a fixed delay instead of waiting on an element. Declaration from the mirror: `func waitForExistence(timeout: TimeInterval) -> Bool` (XCUIAutomation). The XCTest framework overview says to keep XCTest for UI tests and not to mix it with Swift Testing in the same test.
- Remediation: Replace each `settle()` with `XCTAssertTrue(element.waitForExistence(timeout: 5))` before the interaction.
- Source: https://developer.apple.com/documentation/xctest/asynchronous-tests-and-expectations
- Confidence: 9

#### [FW-WIDGETKIT.7] Privacy on Lock Screen

- Status: RISK
- Severity: major
- Kind: required
- Rule: Widgets are visible on the Lock Screen and during Always On. Mark sensitive views with `.privacySensitive()`.
- Evidence: No `.privacySensitive()` in the widget target. Accessory families show auction titles and bid amounts. The sensitive_data flag is government-ID collection, which is not in the widget. Whether a bid amount must be redacted is policy-gray.
- Remediation: Mark bid amount and title views `.privacySensitive()`, or document that auction prices are public catalog data.
- Source: https://developer.apple.com/documentation/widgetkit/creating-a-widget-extension
- Confidence: 7

#### [FW-XCODE-A.33] Priority inversions and main-thread I/O

- Status: RISK
- Severity: major
- Kind: required
- Rule: Do not block a thread on asynchronous work, and do not do synchronous file or network I/O on the main thread.
- Evidence: No `DispatchSemaphore` or `DispatchGroup.wait` in app sources. `LegalOfflineCopy.bundled` calls `String(contentsOf:)` on the bundled legal text from a main-actor path. A separate PDF read is `nonisolated`. No Thread Performance Checker xcresult exists (see A.31).
- Remediation: Read the legal copy off the main actor (or at build time into a static string) and record a Thread Performance Checker run with zero issues.
- Source: https://developer.apple.com/documentation/xcode/diagnosing-performance-issues-early
- Confidence: 7

#### [FW-XCODE-A.42] Location energy efficiency

- Status: RISK
- Severity: major
- Kind: required
- Rule: Request location only as often and as precisely as the feature needs, and stop updates immediately. Prefer `CLLocationUpdate` and do not use Best accuracy except for navigation-grade features.
- Evidence: `JobSiteLocationProvider` sets `kCLLocationAccuracyBest` and calls one-shot `requestLocation()`, not `startUpdatingLocation`. `JobsMapView`’s `MapLocationManager` uses `kCLLocationAccuracyHundredMeters` and `requestWhenInUseAuthorization`. No `CLLocationUpdate.liveUpdates`, no background location session, and no Always authorization.
- Remediation: Drop job-site accuracy below Best unless the feature is navigation-grade, and migrate one-shot reads to `CLLocationUpdate` with cancellation when the view disappears.
- Source: https://developer.apple.com/documentation/xcode/accessing-the-device-s-location-efficiently
- Confidence: 8

#### [FW-ACTIVITYKIT.2] 4 KB content budget

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Combined static and dynamic data, including every update and push payload, must not exceed 4 KB.
- Evidence: ios/NoMarkup/Core/AuctionActivityAttributes.swift ContentState is leadingBidCents Int64, endsAt Date, and optional outcome String. Attributes are auctionID, title, and kind strings. No Data, URLSession, or CLLocation. No unit test asserts the encoded payload is under 4096 bytes.
- Remediation: Add a test that encodes attributes plus ContentState and asserts the byte count is under 4096.
- Source: https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- Confidence: 8

#### [FW-AUTHSVC-A.4] Passkeys — associated domain

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Passkeys (and password AutoFill) for your service need the Associated Domains capability with `webcredentials:<domain>` and an `apple-app-site-association` file at `https://<domain>/.well-known/` listing the app's App ID under `webcredentials`. The relying-party ID in code must be that domain.
- Evidence: `NoMarkup.entitlements` has `webcredentials:no-markup.com`. `PasskeyAuth` uses `options.rpId` or fallback `no-markup.com`. Gateway `passkeyRPIDDefault = "no-markup.com"`. In-repo AASA lists `6L6565278C.com.nomarkup.app` under `webcredentials.apps`. The check requires a live fetch of `https://no-markup.com/.well-known/apple-app-site-association`. That fetch was not performed (network limited to Apple documentation). Serving, content type, and redirects are unverified. This is incomplete evidence, not a proven mismatch.
- Remediation: Confirm the live file is `application/json`, is not redirected, and lists `6L6565278C.com.nomarkup.app`.
- Source: https://developer.apple.com/documentation/authenticationservices/connecting-to-a-service-with-passkeys
- Confidence: 6

#### [FW-AUTHSVC-B.1] Passkeys / associated domain prerequisite

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Passkey registration and assertion requests fail unless the app has an associated domain with the `webcredentials` service for the relying party and an AASA file that lists the app's App ID under `webcredentials.apps`.
- Evidence: Same client artifacts as FW-AUTHSVC-A.4: entitlement `webcredentials:no-markup.com`, RP id `no-markup.com`, in-repo AASA app id `6L6565278C.com.nomarkup.app`. Live curl was not run, so the served file is unverified.
- Remediation: Serve that AASA at `https://no-markup.com/.well-known/apple-app-site-association` with no redirect.
- Source: https://developer.apple.com/documentation/authenticationservices/supporting-passkeys
- Confidence: 6

#### [FW-SIWA.1] Entitlement

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Enable Sign in with Apple so the entitlements contain `com.apple.developer.applesignin` with the value Default.
- Evidence: ios/NoMarkup/NoMarkup.entitlements sets com.apple.developer.applesignin to Default. SignInWithAppleButton is in the auth UI. No in-repo record of whether this App ID is the primary ID or a member of a grouped primary. The entitlement value itself matches Default.
- Remediation: Record the primary App ID versus grouped-ID relationship used for this bundle.
- Source: https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.applesignin
- Confidence: 7

#### [FW-SIWA.8] Client secret stays on the server

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: The client secret for the token and revoke endpoints is a JWT the server signs: ES256, key id, team id, issued-at, expiry at most 15777000 seconds, audience https://appleid.apple.com, and subject equal to the client id.
- Evidence: No Sign in with Apple key file in the app. gateway/internal/handler/oauth.go sets the OAuth client secret from the APPLE_CLIENT_SECRET environment variable. The repo does not build the ES256 JWT or show a rotation schedule. Missing construction is not a key-in-the-binary failure.
- Remediation: Generate the client secret JWT on the server with expiry within six months and rotate it before expiry. Keep the signing key out of the app.
- Source: https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret
- Confidence: 8

#### [FW-SWIFTUI.2] Data flow / environment injection

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Every `@Environment(Model.self)` read has a matching `.environment(model)` on an ancestor, including every `#Preview`.
- Evidence: No `@Environment(Model.self)` reads. Injection is `.environmentObject` of `auth`, `flags`, `PushRegistration.shared`, `DeepLinkRouter.shared`, and `NetworkMonitor.shared` on `WindowGroup`. Previews were not proven to supply every `EnvironmentObject` the viewed hierarchy reads, so a canvas crash is unverified rather than demonstrated.
- Remediation: When models move to `@Observable`, inject `.environment(model)` at `WindowGroup` and in every preview. Until then, audit each `#Preview` for the `EnvironmentObject`s it reads.
- Source: https://developer.apple.com/documentation/swiftui/managing-model-data-in-your-app
- Confidence: 7

#### [FW-XCODE-A.15] Associated domains format and alternate mode

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Associated-domain entries are `service:fully-qualified-domain` with no path, query, or trailing slash, and the domain serves an AASA file over HTTPS with no redirect. Alternate `mode=` must not ship.
- Evidence: Entitlement entries are `applinks:no-markup.com` and `webcredentials:no-markup.com` with no `mode=`. `curl` to `https://no-markup.com/.well-known/apple-app-site-association` failed with DNS error (curl 6, could not resolve host), so the 200 and JSON body are unverified.
- Remediation: Re-fetch the AASA from a resolver that can reach the host and confirm a 200, no redirect, and the team-prefixed app ID.
- Source: https://developer.apple.com/documentation/xcode/configuring-an-associated-domain
- Confidence: 6

#### [FW-XCODE-B.18] Associated domains / entitlement and AASA file

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Entitlement entries match `service:domain` and each domain serves `apple-app-site-association` over HTTPS with no redirect and the team-prefixed app ID.
- Evidence: Entitlement entries match `applinks:no-markup.com` and `webcredentials:no-markup.com`. The AASA fetch failed with DNS error (curl 6), so status, redirects, and `appIDs` are unverified. No `?mode=developer` is present.
- Remediation: Fetch the AASA from a working resolver and confirm 200, no redirect, and `6L6565278C.com.nomarkup.app`.
- Source: https://developer.apple.com/documentation/xcode/supporting-associated-domains
- Confidence: 6

#### [FW-XCODE-B.3] Privacy manifest / third-party SDKs and packages

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Every embedded SDK that uses a required-reason API ships its own privacy manifest, and listed SDKs are signed.
- Evidence: `stripe-ios` 24.25.0 is the only Swift package. Stripe, StripeCore, StripePaymentSheet, Stripe3DS2, and StripeFinancialConnections privacy manifests exist in unrelated DerivedData checkouts, not in a NoMarkup archive. `ios/build/Release-iphonesimulator/NoMarkup.app` is a stub with no `Frameworks` and cannot prove the signed bundle. No vendored `.a` or `.xcframework`.
- Remediation: Archive the app and confirm one valid `PrivacyInfo.xcprivacy` per embedded Stripe framework, with signatures intact.
- Source: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- Confidence: 6

#### [FW-ACCESSIBILITY.2] Manual testing / system settings matrix

- Status: GAP
- Severity: major
- Kind: required
- Rule: Complete the main tasks with each display and text setting on, one at a time, and record PASS or FAIL.
- Evidence: `HomeView` reads `accessibilityReduceTransparency`. No conformance statement lists Invert Colors, Increase Contrast, Grayscale, Reduce Motion, Full Keyboard Access, Differentiate Without Color, Button Shapes, On/Off Labels, Bold Text, or the largest Dynamic Type size. No `accessibilityIgnoresInvertColors` on photos.
- Remediation: Fill the settings matrix and apply `accessibilityIgnoresInvertColors` on listing and job photos.
- Source: https://developer.apple.com/documentation/accessibility/testing-system-accessibility-features-in-your-app
- Confidence: 7

#### [FW-ACTIVITYKIT.4] Limited Dynamic Island width

- Status: GAP
- Severity: major
- Kind: required
- Rule: Compact and minimal presentations may render at reduced width. Read `@Environment(\.isDynamicIslandLimitedInWidth)`.
- Evidence: AuctionLiveActivityWidget does not read isDynamicIslandLimitedInWidth. Compact trailing uses a frame maxWidth of about 56 pt with no limited-width branch. apple_docs.sh show: `var isDynamicIslandLimitedInWidth: Bool { get }` is iOS 27.0+. Discussion: adapt views to the reduced width, or provide a compact leading presentation and an empty trailing view. Deployment target is iOS 17.0. An in-tree note cites iPhoneOS 26.5. The symbol is not on the shipping SDK.
- Remediation: When building with an SDK that declares the symbol, branch compact content on isDynamicIslandLimitedInWidth.
- Source: https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- Confidence: 8

#### [FW-ACTIVITYKIT.8] Stale date

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Give each `ActivityContent` a `staleDate`, and have the views read `context.isStale`.
- Evidence: AuctionLiveActivityController sets staleDate to endsAt. Views do not read context.isStale. No activityStateUpdates observer refreshes a stale activity.
- Remediation: Render an outdated marker when context.isStale is true, and refresh from activityStateUpdates.
- Source: https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- Confidence: 8

#### [FW-APPINTENTS.10] Entity queries

- Status: GAP
- Severity: major
- Kind: required
- Rule: Every entity has a `static let defaultQuery` that conforms to `EntityQuery` and implements `entities(for:)` for ID lookup.
- Evidence: JobEntity and ListingEntity declare defaultQuery with entities(for:) and suggestedEntities() reading the widget snapshot, with no network. EntityStringQuery (`entities(matching:)`) and EnumerableEntityQuery or EntityPropertyQuery are not implemented, so Shortcuts has no name search or automatic Find intent.
- Remediation: Add EntityStringQuery.entities(matching:) for JobEntity and ListingEntity, backed by the same snapshot or a local index.
- Source: https://developer.apple.com/documentation/appintents/acceleratingappinteractionswithappintents
- Confidence: 8

#### [FW-APPINTENTS.12] Runtime / foreground vs background modes

- Status: GAP
- Severity: major
- Kind: required
- Rule: Design intents to run in the background whenever possible, and declare `supportedModes` only where foreground UI is needed.
- Evidence: OpenMyBidsIntent, OpenWatchlistIntent, OpenPostJobIntent, CheckInToJobIntent, SearchCatalogIntent, and OpenListingIntent each set `openAppWhenRun = true`. No `supportedModes`. No `continueInForeground` call, so that sub-check does not fail. Open and search intents are foreground by design; check-in only deep-links.
- Remediation: Drop `openAppWhenRun` on any action that can finish without UI, and declare `supportedModes` only for intents that must present a scene.
- Source: https://developer.apple.com/documentation/appintents/configuring-the-runtime-behavior-of-your-app-intents
- Confidence: 8

#### [FW-APPINTENTS.14] Runtime / routing to scenes

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Intents that bring the app to the foreground should configure the UI through scene code, not by mutating views from `perform()`.
- Evidence: Info.plist key UIApplicationSupportsMultipleScenes is true. No TargetContentProvidingIntent, UISceneAppIntent, or `.onAppIntentExecution`. Open intents call DeepLinkRouter from perform() rather than scene routing.
- Remediation: Adopt TargetContentProvidingIntent or URLRepresentableIntent and handle it with `.onAppIntentExecution` so a cold launch lands on the entity.
- Source: https://developer.apple.com/documentation/appintents/directing-app-intents-to-your-apps-scenes
- Confidence: 8

#### [FW-APPINTENTS.24] Transferable entities

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Entities that Siri or Shortcuts may pass to other apps conform to `Transferable`.
- Evidence: No transferRepresentation and no `extension …: Transferable` on JobEntity, ListingEntity, or AuctionEntity.
- Remediation: Add Transferable with IntentValueRepresentation or a text ProxyRepresentation, plus an export and import test.
- Source: https://developer.apple.com/documentation/appintents/apple-intelligence-and-siri-ai
- Confidence: 8

#### [FW-APPINTENTS.25] App schemas / adoption

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: When an action or content type genuinely matches a system domain, adopt the schema with `@AppIntent(schema:)`.
- Evidence: Search uses `.system.search` (ShowInAppSearchResultsIntent) and visual intelligence uses the semanticContentSearch schema. Those match the behavior and are not a partial message or mail use-case group. No xcodebuild log was captured to show the absence of schema warnings.
- Remediation: Record an xcodebuild log filtered for schema and use-case warnings on the shipping scheme.
- Source: https://developer.apple.com/documentation/appintents/making-actions-and-content-discoverable-by-apple-intelligence
- Confidence: 6

#### [FW-APPINTENTS.34] Testing / layered manual verification

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Beyond code tests, verify Shortcuts, Spotlight on a physical device, and Siri, including a voice-only path, in every supported language.
- Evidence: docs/app-intents-verification.md is not in the tree. No recorded Shortcuts, device Spotlight, Siri, or voice-only checklist.
- Remediation: Add a per-release checklist with pass or fail for Shortcuts, device Spotlight, Siri, and voice-only.
- Source: https://developer.apple.com/documentation/appintents/verifying-your-app-intents-implementation
- Confidence: 8

#### [FW-APPINTENTS.8] AppEntity / shape, properties, size limit

- Status: GAP
- Severity: major
- Kind: required
- Rule: Define entities as lightweight standalone structs that copy the subset of model data people use outside the app, and expose properties with `@Property`.
- Evidence: JobEntity, ListingEntity, and AuctionEntity are small structs with String and Int fields and no Data blobs, so the 10 MB crash condition is not met. Title and other user-facing fields are stored properties without `@Property`, so the system does not introspect them.
- Remediation: Mark user-facing entity fields with `@Property` or `@ComputedProperty` so Shortcuts and Spotlight see them.
- Source: https://developer.apple.com/documentation/appintents/defining-app-entities-for-your-custom-data-types
- Confidence: 7

#### [FW-AUTHSVC-B.4] Passkeys / AutoFill-assisted requests

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Support passkeys in the QuickType bar. Mark the username field with `.textContentType(.username)` and start `performAutoFillAssistedRequests()` on an assertion controller when the sign-in screen appears. Cancel it when the screen goes away.
- Evidence: `LoginView` username field has `.textContentType(.username)`. No `performAutoFillAssistedRequests()` and no `controller.cancel()` on disappear.
- Remediation: Start an assertion controller with `performAutoFillAssistedRequests()` when LoginView appears and cancel it on disappear.
- Source: https://developer.apple.com/documentation/authenticationservices/supporting-passkeys
- Confidence: 9

#### [FW-AUTHSVC-B.5] Passkeys / reset and revocation

- Status: GAP
- Severity: major
- Kind: required
- Rule: To change or reset a passkey, create a new registration with the same user ID. That overwrites the passkey on the person's devices. Replace the old public key on the server and discard it.
- Evidence: `gateway/internal/handler/passkey.go` inserts credentials and updates the sign count. No delete, replace, or reset endpoint. No client `createCredentialRegistrationRequest` that reuses an existing user id to overwrite a passkey.
- Remediation: Add a reset that re-registers with the same user id and replaces the stored public key so the old credential cannot assert.
- Source: https://developer.apple.com/documentation/authenticationservices/supporting-passkeys
- Confidence: 8

#### [FW-CORELOCATION.4] Availability

- Status: GAP
- Severity: major
- Kind: required
- Rule: Before using a service, check that it's available (`CLLocationManager.locationServicesEnabled()`, and so on). Disable features in advance instead of relying on error callbacks. Design a usable experience without location, for example manual city entry.
- Evidence: No `locationServicesEnabled()` (or heading/significant-change availability check) before `requestLocation`. `LocationPurposeCopy` says the person can pick a city manually. No city-picker symbol was found. The map can browse without a coordinate. Job check-in requires GPS (`kCLLocationAccuracyBest`) by design and surfaces an error instead of a manual path.
- Remediation: Check `locationServicesEnabled()` before requesting a fix, and ship the manual city choice the purpose string describes.
- Source: https://developer.apple.com/documentation/corelocation/configuring-your-app-to-use-location-services
- Confidence: 7

#### [FW-CORELOCATION.5] Accuracy / reduced accuracy by default

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: If approximate location is enough, set `NSLocationDefaultAccuracyReduced = true` and handle `accuracyAuthorization == .reducedAccuracy` everywhere. Request precise location temporarily and in context only for the feature that needs it.
- Evidence: No `NSLocationDefaultAccuracyReduced` and no `accuracyAuthorization` handling. Map uses `kCLLocationAccuracyHundredMeters`. Check-in uses `kCLLocationAccuracyBest` for job-site confirmation, which is a precise use. City suggestion and the 25-mile pickup map could stay reduced.
- Remediation: Default the map to reduced accuracy and call `requestTemporaryFullAccuracyAuthorization(withPurposeKey:)` only from job check-in, with a temporary-usage dictionary entry.
- Source: https://developer.apple.com/documentation/corelocation/getting-the-current-location-of-a-device
- Confidence: 7

#### [FW-CORELOCATION.7] Live updates (Swift concurrency)

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: On iOS 17+, receive locations by iterating `CLLocationUpdate.liveUpdates(_:)` in a Task, and check both the location and the diagnostic flags in the loop. Tie the loop to view lifetime (`.task`).
- Evidence: Location still uses `CLLocationManagerDelegate` and `requestLocation()`. No `CLLocationUpdate.liveUpdates`. One-shot `requestLocation()` satisfies FW-CORELOCATION.6. Deployment is iOS 17, so `liveUpdates` is available.
- Remediation: Move the map and check-in one-shot reads to `for try await update in CLLocationUpdate.liveUpdates()` inside the feature `.task`, and break after the first location.
- Source: https://developer.apple.com/documentation/corelocation/configuring-your-app-to-use-location-services
- Confidence: 8

#### [FW-CORELOCATION.8] CLServiceSession / explicit authorization control

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: On iOS 18+, declare the authorization a feature needs by creating and holding a `CLServiceSession` (`.whenInUse` or `.always`) for as long as the feature runs.
- Evidence: No `CLServiceSession`. When In Use is requested with `requestWhenInUseAuthorization` on iOS 17 deployment. The session API is iOS 18+.
- Remediation: When the deployment target is iOS 18 or the code is version-gated, hold a `.whenInUse` `CLServiceSession` for the map and check-in features.
- Source: https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background
- Confidence: 8

#### [FW-LOCALAUTHENTICATION.6] Bind biometrics to a secret

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: When biometrics protect data or credentials rather than only gating UI, put the secret in a keychain item whose `SecAccessControl` requires `.userPresence` with `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`. Don't store a `Bool isUnlocked` returned by `evaluatePolicy` next to an unprotected secret.
- Evidence: `isBiometricallyUnlocked` is in-memory UI state. Tokens are read from `KeychainTokenStore` with no `kSecAttrAccessControl` and no `kSecUseAuthenticationContext`. The preference Bool is in UserDefaults and is not the secret.
- Remediation: Protect the refresh token (or the payment-authorizing item) with `SecAccessControl` `.userPresence`, and pass the same `LAContext` as `kSecUseAuthenticationContext`.
- Source: https://developer.apple.com/documentation/localauthentication/accessing-keychain-items-with-face-id-or-touch-id
- Confidence: 8

#### [FW-NETWORK.5] Pre-submission privacy audit

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Before each release, export the App Privacy Report NDJSON and confirm every `networkActivity` domain and every `access` category is expected and matches the privacy manifest and the App Privacy answers.
- Evidence: No exported App Privacy Report NDJSON and no reconciled domain list in the iOS tree.
- Remediation: Export a device report after a full session and reconcile domains and access categories to the privacy manifest.
- Source: https://developer.apple.com/documentation/network/inspecting-app-activity-data
- Confidence: 7

#### [FW-PASSKIT.4] Itemized payment request

- Status: GAP
- Severity: major
- Kind: required
- Rule: Build the payment request with itemized summary items ending in the total, 3-D Secure, and only the contact fields that are needed.
- Evidence: No app-built PKPaymentRequest, paymentSummaryItems, or PKPaymentAuthorizationResult. Stripe PaymentSheet and a server PaymentIntent own the sheet. The app handles completed, canceled, and failed. Itemization and field errors live inside the provider sheet and were not verified from app code. Using a provider is not by itself a contradiction.
- Remediation: Confirm the PaymentIntent line items in the server request, and surface field errors from the sheet result.
- Source: https://developer.apple.com/documentation/passkit/offering-apple-pay-in-your-app
- Confidence: 7

#### [FW-PHOTOKIT.2] Picker / loading selections

- Status: GAP
- Severity: major
- Kind: required
- Rule: A `PhotosPickerItem` is only a placeholder. Load its data asynchronously with `loadTransferable(type:)`. Handle failure with a retry message. For large files, videos, or multi-selection, load a `FileRepresentation`-based `Transferable`. Don't load everything as in-memory `Data`. Downsample images for display.
- Evidence: `ImageUploader.prepareJPEG` calls `loadTransferable(type: Data.self)` and then ImageIO downsample (`encodeJPEGDownsampled`, `kCGImageSourceShouldCache` false, EXIF transform) off the main actor. Errors are thrown and surfaced. Pickers use `matching: .images`, so `FileRepresentation` is not required for video. Full image bytes still enter memory as `Data` before the thumbnail.
- Remediation: Load a `FileRepresentation` (or an ImageIO source from a file URL) and downsample without holding the full photo as `Data`.
- Source: https://developer.apple.com/documentation/photokit/bringing-photos-picker-to-your-swiftui-app
- Confidence: 8

#### [FW-SECURITY.3] Keychain / user presence

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: For high-value secrets (banking credentials, keys that authorize payments or account changes), require user presence at read time by attaching a `SecAccessControl` (`kSecAttrAccessControl`) created with `SecAccessControlCreateWithFlags`.
- Evidence: `KeychainTokenStore` has no `SecAccessControlCreateWithFlags` or `kSecAttrAccessControl`. `BiometricGate` gates UI only; tokens remain readable after the device is unlocked.
- Remediation: Attach `.userPresence` with `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` on payment-authorizing secrets, and do not also set `kSecAttrAccessible` on that query.
- Source: https://developer.apple.com/documentation/security/restricting-keychain-item-accessibility
- Confidence: 8

#### [FW-SECURITY.4] Keychain / status handling and upsert

- Status: GAP
- Severity: major
- Kind: required
- Rule: Check the `OSStatus` of every `SecItem*` call. Treat `errSecItemNotFound` as the first-run path. On `errSecDuplicateItem`, call `SecItemUpdate` rather than adding duplicates.
- Evidence: `KeychainTokenStore.save` checks `SecItemCopyMatching`, updates on `errSecSuccess`, adds on `errSecItemNotFound`, and throws `KeychainError.unhandled` otherwise. No `errSecDuplicateItem` branch. `ios/NoMarkupTests/APIClientTests.swift:testSaveOverwritesExistingValue` covers the copy-then-update path. Delete and read compare status to `errSecSuccess` / `errSecItemNotFound`.
- Remediation: If `SecItemAdd` returns `errSecDuplicateItem`, call `SecItemUpdate` for that account.
- Source: https://developer.apple.com/documentation/security/updating-and-deleting-keychain-items
- Confidence: 8

#### [FW-SECURITY.5] Keychain / logout and account deletion

- Status: GAP
- Severity: major
- Kind: required
- Rule: On logout, delete the user's keychain items with `SecItemDelete`, treating `errSecItemNotFound` as success. On account deletion, also remove shared web credentials by calling `SecAddSharedWebCredential(domain, account, nil, …)`. Don't remove shared web credentials on a simple logout.
- Evidence: `AuthViewModel.signOut` calls `KeychainTokenStore.clearSession`, which `SecItemDelete`s both tokens and treats `errSecItemNotFound` as success. Account deletion calls `auth.signOut` after `DELETE /api/v1/users/me`. `SecAddSharedWebCredential` is not in the tree. The app never calls the add API, so the deletion half is incomplete rather than a contradictory logout wipe.
- Remediation: On account deletion only, call `SecAddSharedWebCredential` with a nil password for the website account if shared web credentials were ever written.
- Source: https://developer.apple.com/documentation/security/updating-and-deleting-keychain-items
- Confidence: 7

#### [FW-SIWA.13] Private Email Relay

- Status: GAP
- Severity: major
- Kind: required
- Rule: Before emailing people who chose Hide My Email, register every outbound domain and authenticate it with SPF and DKIM.
- Evidence: No evidence that outbound domains are registered. No validator test for privaterelay.appleid.com, private.icloud.com, or icloud.com. No proof a validator rejects them. No DNS SPF or DKIM record in the repo.
- Remediation: Register the sending domains and accept relay addresses in the mail validator.
- Source: https://developer.apple.com/documentation/signinwithapple/communicating-using-the-private-email-relay-service
- Confidence: 6

#### [FW-STOREKIT.14] Manage subscriptions

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Subscription apps provide an in-app path to the App Store manage-subscriptions sheet.
- Evidence: No showManageSubscriptions and no manage-subscriptions URL in ios/.
- Remediation: Add a Settings button that presents AppStore.showManageSubscriptions.
- Source: https://developer.apple.com/documentation/storekit/testing-in-app-purchases-in-xcode
- Confidence: 8

#### [FW-STOREKIT.23] Billing retry and grace

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Read subscription status and renewal info to detect billing retry and the billing grace period.
- Evidence: No SubscriptionInfo.Status, grace period, or billing-retry UI, and no link to the Apple billing page.
- Remediation: Read renewal state and, during billing retry, deep-link to the Apple billing page while keeping grace-period access.
- Source: https://developer.apple.com/documentation/storekit/reducing-involuntary-subscriber-churn
- Confidence: 8

#### [FW-STOREKIT.30] Review prompt timing

- Status: GAP
- Severity: major
- Kind: required
- Rule: Request reviews with `requestReview` after a completed flow, not at launch and not from a direct button tap.
- Evidence: No requestReview, SKStoreReviewController, or write-review URL in ios/. The app also does not ask at launch. The required review API is absent.
- Remediation: Call requestReview after a completed job or fulfilled order, at most once per version, and add a separate write-review link for an explicit button.
- Source: https://developer.apple.com/documentation/storekit/requesting-app-store-reviews
- Confidence: 8

#### [FW-STOREKIT.31] Retryable errors

- Status: GAP
- Severity: major
- Kind: required
- Rule: Catch StoreKit errors and show a retryable, non-technical message. Never force-try StoreKit calls.
- Evidence: StoreKitManager sets lastErrorMessage from error.localizedDescription, shown in red on PlanLimitsView. No dedicated Retry control. No force-try on StoreKit.
- Remediation: Map network error codes to a short retryable message and a Retry button.
- Source: https://developer.apple.com/documentation/storekit/handling-errors
- Confidence: 8

#### [FW-STOREKIT.34] Sandbox device test

- Status: GAP
- Severity: major
- Kind: required
- Rule: After products exist in App Store Connect, test on a device with a Sandbox Apple Account and confirm the sandbox environment banner.
- Evidence: No sandbox test note. StoreKit is default off, and this tree does not show live App Store Connect products.
- Remediation: After products exist, disable the scheme StoreKit file and record a sandbox purchase sheet.
- Source: https://developer.apple.com/documentation/storekit/testing-purchases-made-outside-your-app
- Confidence: 7

#### [FW-STOREKIT.36] App Store Server Notifications V2

- Status: GAP
- Severity: major
- Kind: required
- Rule: Apps with a backend that tracks entitlements enable App Store Server Notifications V2 and answer 200.
- Evidence: No V2 notification route. The client posts the signed transaction to POST /api/v1/iap/app-store/verify, which is expected to return 503 until verification is configured. That is fail-closed, not a grant, and it is not a notification endpoint.
- Remediation: Add an HTTPS V2 endpoint that returns 200 and handles refund, revoke, renewal failure, and subscribe events.
- Source: https://developer.apple.com/documentation/storekit/enabling-app-store-server-notifications
- Confidence: 8

#### [FW-STOREKIT.40] Subscription status

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Prefer `Product.SubscriptionInfo.Status` or `subscriptionStatusTask` over hand-computed dates.
- Evidence: No subscriptionStatusTask and no Product.SubscriptionInfo.Status in ios/.
- Remediation: Drive the paywall status from subscriptionStatusTask and recompute when Transaction.updates fires.
- Source: https://developer.apple.com/documentation/storekit/handling-subscriptions-billing
- Confidence: 8

#### [FW-SWIFTUI.12] Lists / container choice

- Status: GAP
- Severity: major
- Kind: required
- Rule: Never wrap a `List` in a `ScrollView`. Lazy stacks must sit inside a `ScrollView`.
- Evidence: Lists are used widely. A multiline search did not prove every `List` is outside a `ScrollView`, and did not prove every `LazyVStack` is inside one. No confirmed zero-height nesting was isolated.
- Remediation: Re-run a structured search (or a SwiftSyntax pass) for `ScrollView` ancestors of `List` and fix any hit.
- Source: https://developer.apple.com/documentation/swiftui/picking-container-views-for-your-content
- Confidence: 6

#### [FW-SWIFTUI.16] Navigation / titles

- Status: GAP
- Severity: major
- Kind: required
- Rule: Every navigation root and every pushed destination sets `.navigationTitle`.
- Evidence: Many screens set `navigationTitle`. A complete pairing of every `NavigationStack` root and every `navigationDestination` target was not finished, and no UI test asserts the back-button label equals the parent title.
- Remediation: Audit each destination view for `.navigationTitle` and add a UI test that reads `navigationBars.buttons.element(boundBy: 0).label`.
- Source: https://developer.apple.com/documentation/swiftui/wishlist-planning-travel-in-a-swiftui-app
- Confidence: 6

#### [FW-TESTING.7] Isolation / main actor

- Status: GAP
- Severity: major
- Kind: required
- Rule: Tests that touch `@MainActor` models or UI types declare `@MainActor` on the suite or the test.
- Evidence: Some XCTest types are `@MainActor` (`CheckoutSecretTests`, parts of `AppConfigTests` and `NotificationDeepLinkTests`). The suite is not Swift Testing, and no unit-test build log shows zero isolation errors. Coverage of every main-actor type is incomplete.
- Remediation: Annotate every suite that touches main-actor models with `@MainActor` and confirm a strict-concurrency test build is clean.
- Source: https://developer.apple.com/documentation/testing/migratingfromxctest
- Confidence: 7

#### [FW-UIKIT.5] Background / finishing critical work

- Status: GAP
- Severity: major
- Kind: required
- Rule: For work that may outlast the roughly five seconds before suspension, call `beginBackgroundTask` before starting it and `endBackgroundTask` on completion and in the expiration handler.
- Evidence: No `beginBackgroundTask` in app sources. Uploads and exports exist (image upload, file exports). It is not shown whether any of them are still in flight at suspension, so a missing bracket is unproven rather than a confirmed watchdog kill.
- Remediation: Bracket any upload that must finish after the user leaves the app, and end the task in the expiration handler.
- Source: https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time
- Confidence: 7

#### [FW-USERNOTIFICATIONS.10] Payload size and custom keys

- Status: GAP
- Severity: major
- Kind: required
- Rule: Remote payloads are uncompressed JSON of at most 4 KB, and custom keys are peers of `aps`.
- Evidence: Server payloads are small JSON. action_url and type sit beside aps. Chat body is redacted to "New message" before send. The 4096 constant in apns.go is a response-body read limit, not an assertion that the request body is at most 4096 bytes. No fixture measures payload size.
- Remediation: Add a test that the encoded alert and liveactivity bodies are at most 4096 bytes.
- Source: https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
- Confidence: 7

#### [FW-USERNOTIFICATIONS.11] Grouping and interruption level

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use `thread-id`, an `interruption-level` that matches real urgency, and `relevance-score`.
- Evidence: services/notification apns_test.go covers thread-id and interruption-level (active, or passive for promo; not time-sensitive or critical). No relevance-score. No loc-key. The server sends English strings.
- Remediation: Add relevance-score and either loc-key strings in the app or a preferred-language lookup before send.
- Source: https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
- Confidence: 8

#### [FW-USERNOTIFICATIONS.8] Foreground presentation

- Status: GAP
- Severity: major
- Kind: required
- Rule: Implement `willPresent` so a notification that arrives in the foreground is handled deliberately.
- Evidence: PushRegistration.willPresent returns banner, sound, and badge for bid, auction, and message types, and banner plus badge without sound for promo. It does not suppress the banner when the destination screen is already open.
- Remediation: If the visible screen is the notification’s destination, return an empty option set and update that screen instead.
- Source: https://developer.apple.com/documentation/usernotifications/handling-notifications-and-notification-related-actions
- Confidence: 8

#### [FW-WIDGETKIT.11] Accented rendering and Liquid Glass

- Status: GAP
- Severity: major
- Kind: required
- Rule: Support every rendering mode that applies to each family. Read `widgetRenderingMode` and branch the layout.
- Evidence: Home-screen widgets use solid WidgetBrand colors and Text, not Image or LinearGradient. WidgetSharedStore.WidgetBrand.background is a solid dynamic color. Live Activity uses SF Symbols only. No widgetRenderingMode or widgetAccentable branch and no accented preview. apple_docs.sh show widgetRenderingMode: `var widgetRenderingMode: WidgetRenderingMode { get set }` (iOS 16.0+); discussion says to modify the widget’s appearance based on the mode. The images-or-gradients predicate is not met, so this is incomplete support rather than a contradicted image path.
- Remediation: Branch on widgetRenderingMode for accessory and accented families and add an accented-mode preview.
- Source: https://developer.apple.com/documentation/widgetkit/optimizing-your-widget-for-accented-rendering-mode-and-liquid-glass
- Confidence: 7

#### [FW-WIDGETKIT.5] Reload from the app

- Status: GAP
- Severity: major
- Kind: required
- Rule: When app data a widget shows changes, call `WidgetCenter.shared.reloadTimelines(ofKind:)`. Call `reloadAllTimelines()` for global changes such as sign-out.
- Evidence: ios/NoMarkup/Core/WidgetSharedStore.swift save and clear call reloadTimelines(ofKind:) for activeBidsWidgetKind and the next-closing kind. AuthViewModel sign-out calls WidgetSharedStore.clear(), which reloads both kinds. reloadAllTimelines() is not called. The kinds that exist are reloaded; the named global API is missing.
- Remediation: Call WidgetCenter.shared.reloadAllTimelines() from the sign-out path in addition to the per-kind reloads.
- Source: https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date
- Confidence: 8

#### [FW-XCODE-A.24] App size and update size

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Keep the thinned download small, and do not adopt On-Demand Resources, which are deprecated in Xcode 27.
- Evidence: No `NSBundleResourceRequest` or `ENABLE_ON_DEMAND_RESOURCES` in the tree. No thinned IPA listing (`unzip -lv`) exists, so the largest payload entries are unverified.
- Remediation: Archive, export a thinned IPA, and review the twenty largest entries against the size budget.
- Source: https://developer.apple.com/documentation/xcode/doing-advanced-optimization-to-further-reduce-your-app-s-size
- Confidence: 7

#### [FW-XCODE-A.25] String Catalog extraction settings and command-line export

- Status: GAP
- Severity: major
- Kind: required
- Rule: Use String Catalogs with `LOCALIZATION_PREFERS_STRING_CATALOGS`, `SWIFT_EMIT_LOC_STRINGS`, and `LOCALIZED_STRING_SWIFTUI_SUPPORT`, and prove extraction with `xcodebuild -exportLocalizations`.
- Evidence: `LOCALIZATION_PREFERS_STRING_CATALOGS = YES` and `SWIFT_EMIT_LOC_STRINGS = YES` on app and widget. `Localizable.xcstrings` is a Copy Bundle Resources member for both. `LOCALIZED_STRING_SWIFTUI_SUPPORT` is unset. No `xcodebuild -exportLocalizations` log is in the tree. `knownRegions` are `en` and `Base`.
- Remediation: Set `LOCALIZED_STRING_SWIFTUI_SUPPORT = YES` and run `-exportLocalizations` for `en`.
- Source: https://developer.apple.com/documentation/xcode/exporting-localizations
- Confidence: 8

#### [FW-XCODE-A.44] Detecting tracking domains

- Status: GAP
- Severity: major
- Kind: required
- Rule: Profile every feature with the Instruments Network template and declare or remove any domain that may profile users.
- Evidence: `PrivacyInfo.xcprivacy` sets `NSPrivacyTracking` false and has no `NSPrivacyTrackingDomains`. No ATT usage string. No Instruments Network trace or `xctrace` export is in the tree. Stripe is a third-party SDK, so the profile still has to be run.
- Remediation: Record a Network-template trace of the purchase, sign-in, and listing flows and reconcile any Points of Interest faults with the manifest.
- Source: https://developer.apple.com/documentation/xcode/detecting-when-your-app-contacts-domains-that-may-be-profiling-users
- Confidence: 7

#### [FW-XCODE-A.45] Crash symbolication and archive retention

- Status: GAP
- Severity: major
- Kind: required
- Rule: Keep the `.xcarchive` for every distributed build and confirm each binary’s UUID matches its dSYM.
- Evidence: Release sets `DEBUG_INFORMATION_FORMAT = dwarf-with-dsym`. No archive is retained under a versioned releases path, and no `dwarfdump --uuid` comparison is recorded. `ios/build/Release-iphonesimulator/NoMarkup.app` is an incomplete simulator stub, not a distributed archive.
- Remediation: Archive with `xcodebuild archive`, store the xcarchive by build number, and match `dwarfdump --uuid` for the app and the widget.
- Source: https://developer.apple.com/documentation/xcode/adding-identifiable-symbol-names-to-a-crash-report
- Confidence: 7

#### [FW-XCODE-A.51] Archive, validate, export, upload

- Status: GAP
- Severity: major
- Kind: required
- Rule: Distribute from an archive, validate it, and beta-test the release build through TestFlight before App Store submission.
- Evidence: No `xcodebuild archive` or `-exportArchive` log, no `ExportOptions.plist`, and no TestFlight processing record in this audit. CI runs unit tests only.
- Remediation: Add an archive-and-export step and record a processed TestFlight build before review submission.
- Source: https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases
- Confidence: 7

#### [FW-XCODE-B.19] Code signing / signature format and nested code

- Status: GAP
- Severity: major
- Kind: required
- Rule: Distributed builds use CodeDirectory version 20400 or later, and `codesign --verify --deep --strict` succeeds with no entitlements on nested frameworks.
- Evidence: `CODE_SIGN_STYLE = Automatic`. No archive exists to run `codesign -dv` or `--verify --deep --strict`. The simulator stub under `ios/build` is not a signed distribution build.
- Remediation: Archive and record CodeDirectory v=20400 or later, plus a clean deep verify, including Stripe frameworks.
- Source: https://developer.apple.com/documentation/xcode/using-the-latest-code-signature-format
- Confidence: 7

#### [FW-XCODE-B.24] In-app purchase / local StoreKit testing

- Status: GAP
- Severity: major
- Kind: required
- Rule: Apps with in-app purchases keep a `.storekit` configuration and automate purchase cases with `SKTestSession`.
- Evidence: `StoreKitEnabled` is false and `AppConfig.storeKitEnabled` defaults false. A StoreKit 2 scaffold exists (`StoreKitManager.swift`, `PlanLimitsView.swift`) and must stay off. No `.storekit` file and no `SKTestSession`. The product decision forbids selling digital unlocks in this binary, so a live configuration would contradict that decision. The registry still applies when the `in_app_purchase` flag is true because the scaffold is present.
- Remediation: Keep the scaffold off. If the flag stays true, add a local `.storekit` file used only by tests and cover failure and Ask to Buy with `SKTestSession`, without enabling purchases in Release.
- Source: https://developer.apple.com/documentation/xcode/setting-up-storekit-testing-in-xcode
- Confidence: 7

#### [FW-XCODE-B.27] Testing / results, targeting, flakiness

- Status: GAP
- Severity: major
- Kind: required
- Rule: Every CI test run writes a result bundle, and new tests are proven stable with repeated iterations. Known failures are marked, not commented out.
- Evidence: CI passes `-resultBundlePath ios/TestResults/NoMarkupTests.xcresult` and uploads it only on failure, so a green run’s bundle is not retained for the auditor. No `-test-iterations` or `-run-tests-until-failure` step. No commented-out `@Test` or `func test` was required to call this a product contradiction.
- Remediation: Always upload the xcresult summary, and run new tests with `-test-iterations` until failure.
- Source: https://developer.apple.com/documentation/xcode/running-tests-and-interpreting-results
- Confidence: 8

#### [FW-XCODE-B.30] Testing / release-build conditions

- Status: GAP
- Severity: major
- Kind: required
- Rule: Test a Release build on a device launched from the Home Screen, and record the Debug-versus-Release settings diff plus a migration test.
- Evidence: No Release `xcodebuild test` log, no device checklist, and no schema-migration fixture test. Debug and Release differ in optimization, debug format, and testability (A.4), which is the intended split, but it was not recorded as a reviewed diff.
- Remediation: Diff Debug and Release settings, run the full plan in Release, and test a fresh install and an update on a device without the debugger.
- Source: https://developer.apple.com/documentation/xcode/testing-a-release-build
- Confidence: 7

#### [FW-XCODE-B.41] Crashes / symbolication readiness

- Status: GAP
- Severity: major
- Kind: required
- Rule: Release uses `dwarf-with-dsym`, and each archive binary’s UUID matches its dSYM.
- Evidence: Release `DEBUG_INFORMATION_FORMAT = dwarf-with-dsym` in `project.pbxproj`. No archive `dwarfdump --uuid` comparison for the app, widget, or Stripe frameworks.
- Remediation: After archive, compare UUIDs for `NoMarkup`, `NoMarkupWidget`, and each embedded framework, and keep the dSYMs.
- Source: https://developer.apple.com/documentation/xcode/locating-a-missing-debug-symbol-file
- Confidence: 7

#### [FW-XCODE-B.44] Terminations / background tasks and shared-file locks

- Status: GAP
- Severity: major
- Kind: required
- Rule: Pair every `beginBackgroundTask` with `endBackgroundTask`, release App Group file locks before suspension, and collect exit reasons with MetricKit.
- Evidence: No `beginBackgroundTask` or `endBackgroundTask` (counts match at zero). The app group is used for `UserDefaults`, not a shared SQLite or SwiftData store, so a file-lock kill is not shown. No `MXMetricManager` reads `applicationExitMetrics`. Background-task and background-push flags are true, so the field collection is still missing.
- Remediation: If any upload must finish after backgrounding, bracket it with `beginBackgroundTask` and `endBackgroundTask` including the expiration handler, and subscribe to MetricKit exit metrics.
- Source: https://developer.apple.com/documentation/xcode/reduce-terminations-in-your-app
- Confidence: 7

Advisory:

- FW-MAPKIT.9 — FAIL: Deep links into Apple Maps
- FW-SECURITY.20 — FAIL: One-time codes / domain-bound SMS
- FW-SWIFT.4 — FAIL: Shared resources / singletons
- FW-SWIFTUI.15 — FAIL: Tabs / declaration and roles
- FW-SWIFTUI.18 — FAIL: Localization / translator context
- FW-SWIFTUI.21 — FAIL: Previews / deterministic data
- FW-SWIFTUI.3 — FAIL: Data flow / custom environment values
- FW-TESTING.10 — FAIL: Organization / suites and tags
- FW-TESTING.4 — FAIL: Errors / asserting throws
- FW-UIKIT.8 — FAIL: Interop / Observation in hosted UIKit views
- FW-XCODE-A.26 — FAIL: Localizer context and generated string symbols
- FW-XCODE-A.43 — FAIL: CPU efficiency, QoS and wakeups
- FW-XCODE-A.49 — FAIL: Preview macros
- FW-XCODE-B.15 — FAIL: Asset catalogs / accent color
- FW-XCODE-B.47 — FAIL: Energy / networking and Bluetooth
- FW-XCODE-B.48 — FAIL: Energy / CPU scheduling and QoS
- FW-XCODE-B.6 — FAIL: Localization / string API hygiene
- FW-XCTEST.3 — FAIL: Reporting / activities for multi-step UI tests
- FW-APPINTENTS.36 — RISK: Project structure / shared intents module
- FW-XCODE-A.39 — RISK: Scheme runtime configuration for tests
- FW-XCODE-B.36 — RISK: Project file format / generated projects
- FW-ACCESSIBILITY.3 — GAP: Assistive Access
- FW-ACTIVITYKIT.21 — GAP: Supplemental families
- FW-ACTIVITYKIT.22 — GAP: Lock Screen tint and margins
- FW-ACTIVITYKIT.9 — GAP: Relevance score
- FW-APPINTENTS.19 — GAP: App Shortcuts / in-app discovery and appearance
- FW-APPINTENTS.22 — GAP: Donations
- FW-AUTHSVC-A.3 — GAP: Existing-credential flow
- FW-AUTHSVC-B.8 — GAP: iCloud Keychain verification codes (TOTP)
- FW-AUTHSVC-B.9 — GAP: Account Authentication Modification extension
- FW-AVFOUNDATION.18 — GAP: Capture / Camera Control (AVCaptureControl)
- FW-AVFOUNDATION.19 — GAP: Capture / Lock Screen and Camera Control launch
- FW-AVFOUNDATION.24 — GAP: Capture / outer-display accessory (iPhone Duo)
- FW-AVKIT.7 — GAP: Capture / camera while multitasking (iPad)
- FW-CRYPTOKIT.5 — GAP: Quantum-secure cryptography
- FW-LOCALAUTHENTICATION.5 — GAP: Face ID UX
- FW-MAPKIT.6 — GAP: Annotation density and reuse
- FW-SIWA.10 — GAP: realUserStatus
- FW-SIWA.14 — GAP: Link an existing account
- FW-SIWA.15 — GAP: Managed Apple Account email
- FW-STOREKIT.12 — GAP: StoreKit views
- FW-STOREKIT.15 — GAP: Refund request sheet
- FW-STOREKIT.24 — GAP: Price increase status
- FW-STOREKIT.35 — GAP: Xcode versus sandbox
- FW-STOREKIT.37 — GAP: Cross-platform subscription
- FW-STOREKIT.9 — GAP: Account token
- FW-SWIFTUI.13 — GAP: Lists / profile on device
- FW-TESTING.11 — GAP: Diagnostics / attachments
- FW-TESTING.5 — GAP: Parameterized tests
- FW-UIKIT.9 — GAP: Interop / trait changes
- FW-USERNOTIFICATIONS.18 — GAP: Push console verification
- FW-USERNOTIFICATIONS.7 — GAP: Locked-device handlers
- FW-WIDGETKIT.13 — GAP: Accessory rendering
- FW-WIDGETKIT.16 — GAP: StandBy and CarPlay
- FW-WIDGETKIT.32 — GAP: Previews
- FW-XCODE-A.34 — GAP: Code coverage
- FW-XCODE-A.37 — GAP: VoiceOver UI testing
- FW-XCODE-A.41 — GAP: Field metrics (hang rate, hitch rate, battery)
- FW-XCODE-A.50 — GAP: Development assets
- FW-XCODE-A.7 — GAP: Build performance (explicit modules, compilation caching)
- FW-XCODE-B.10 — GAP: Localization / pseudolanguage and non-localized-string testing
- FW-XCODE-B.23 — GAP: TestFlight / tester notes
- FW-XCODE-B.31 — GAP: Testing / beta OS
- FW-XCODE-B.33 — GAP: Build / incremental build speed
- FW-XCODE-B.37 — GAP: Devices / headless device and simulator automation
- FW-XCODE-B.45 — GAP: Disk / write efficiency
- FW-XCODE-B.49 — GAP: Launch / binary loading and post-launch work
- FW-XCODE-B.50 — GAP: Rendering / screen-update efficiency

### GitHub CI

#### [GH-1] Repository / creation (private by default)

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Every studio app gets its own private GitHub repository (`private: true`); never create a public repo without an explicit `--public`.
- Evidence: `gh api -H 'X-GitHub-Api-Version: 2026-03-10' /repos/NuclearEng/NoMarkup` → `private: false`, `visibility: public`, `default_branch: main`. `git config --get remote.origin.url` is `https://github.com/NuclearEng/NoMarkup.git`. No `docs/studio/ci.md` records an explicit public exception. The iOS project is in this repo (`ios/NoMarkup.xcodeproj/project.pbxproj` is tracked).
- Remediation: Set NuclearEng/NoMarkup to private before any signing material is added, or record an explicit public-repo decision and keep unreleased signing keys out of the tree. Do not rely on a per-app studio repo that this monorepo does not use.
- Source: https://docs.github.com/en/rest/repos/repos
- Confidence: 10

#### [GH-17] Secrets and variables / storage, scope, limits

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: App Store Connect credentials live as environment secrets on `testflight` (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64`); non-secrets such as `DEVELOPMENT_TEAM` live as variables; the `.p8` is never committed.
- Evidence: `GET /repos/NuclearEng/NoMarkup/actions/secrets` returned 0 names; none of `ASC_KEY_ID`, `ASC_ISSUER_ID`, or `ASC_KEY_P8_BASE64` are present. `GET /repos/NuclearEng/NoMarkup/actions/variables` returned 0 names (`DEVELOPMENT_TEAM` and `BUILD_NUMBER_OFFSET` absent). `GET /repos/NuclearEng/NoMarkup/environments/testflight` → 404. Environments list is only `github-pages`. `rg` of `.github` found no `BEGIN PRIVATE KEY` or `AuthKey_` material and no `ASC_KEY` references. `git ls-files` matched 0 signing-material paths. The repo is public, so the Free-plan private-environment limit does not apply.
- Remediation: Create the `testflight` environment and set `ASC_KEY_ID`, `ASC_ISSUER_ID`, and `ASC_KEY_P8_BASE64` there (names only; do not commit the key). Set `DEVELOPMENT_TEAM` and `BUILD_NUMBER_OFFSET` as variables. Point only the tag release job at that environment.
- Source: https://docs.github.com/en/actions/reference/security/secrets
- Confidence: 9

#### [GH-3] Repository / .gitignore for Xcode, SwiftPM, XcodeGen

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Ignore Xcode user data, build products, `.xcresult`, signing material (`*.p8`, `*.p12`, `*.cer`, `*.mobileprovision`, `private_keys/`), and `.env*`, and do not ignore the `.xcodeproj` or `Package.resolved`.
- Evidence: `git check-ignore` exit 1 (not ignored) for `ios/NoMarkup.xcodeproj/project.pbxproj` and `.../swiftpm/Package.resolved` (both tracked). Exit 0 for `ios/build/x`, `DerivedData/x`, `ios/**/xcuserdata`, `*.xcuserstate`, `.env.local`. Exit 1 for `x.p8`, `x.p12`, `x.cer`, `x.mobileprovision`, `x.xcresult`, `x.xcarchive`, `x.ipa`, `x.dSYM`, `.studio/x`, `private_keys/k`, `.env.staging`, and `ios/TestResults/NoMarkupTests.xcresult`. `.gitignore` covers `*.pem`, `*.key`, `keys/`, and the iOS build/userdata paths (lines 26–32 and 84–90) but not Apple signing extensions or result bundles. `git ls-files` matched 0 tracked signing/xcresult/`.studio` paths.
- Remediation: Add ignore rules for `*.p8`, `*.p12`, `*.cer`, `*.mobileprovision`, `private_keys/`, `*.xcresult`, `*.xcarchive`, `*.ipa`, `*.dSYM`, `.studio/`, and `.env*`, without ignoring `ios/NoMarkup.xcodeproj/` or `Package.resolved`.
- Source: https://github.com/github/gitignore/blob/main/Swift.gitignore
- Confidence: 9

#### [GH-7] Actions / build + test job running the studio gate (verified locally)

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: On pull request and push to main, tags, and workflow_dispatch, the gate job checks out with `persist-credentials: false`, selects Xcode, and runs the studio gate, which fails on any warning, test failure, or zero tests.
- Evidence: There is no `.github/workflows/ios.yml` and no `ci/studio/scripts/gate.sh` (this is not a studio-vendored gate). The iOS workflow is `.github/workflows/ios-ci.yml`: job `ios-test` name `iOS Unit Tests` runs `xcodebuild test -only-testing:NoMarkupTests` on `platform=iOS Simulator,name=iPhone 16` (lines 123–132). UI tests are commented out (lines 143–160). Triggers are `push` and `pull_request` to `main` with `paths: ios/**` plus `workflow_dispatch`; there is no `v*` tag trigger. `project.pbxproj` has no `SWIFT_TREAT_WARNINGS_AS_ERRORS` or `GCC_TREAT_WARNINGS_AS_ERRORS`. Checkout at line 64 does not set `persist-credentials: false`.
- Remediation: Make the iOS job fail on warnings and on test failure, run the unit suite and the UI smoke that should gate merge, and do not treat a path-filtered `NoMarkupTests`-only `xcodebuild test` as the full gate. Upload the xcresult on every attempt (GH-8).
- Source: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- Confidence: 9

#### [GH-9] Actions / archive and TestFlight upload on tag

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: A release job runs only for `refs/tags/v*`, needs the gate, uses the `testflight` environment, archives with the App Store Connect API key, and exports with `manageAppVersionAndBuildNumber` false and destination `upload`.
- Evidence: `.github/workflows/ios-ci.yml` has no `startsWith(github.ref, 'refs/tags/v')`, no `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY_P8_BASE64`, and no `manageAppVersionAndBuildNumber` or `destination` upload export. `rg` of `.github` found no `exportArchive` or `altool`. `.github/workflows/deploy.yml` tag push `v*` deploys backend images, not the iOS archive. `docs/compliance/submission-blockers.md` row 2 and `docs/compliance/ios-developer-audit-2026-10-03.md` record founder-local archive; `ios-ci.yml` is unit tests only. `CURRENT_PROJECT_VERSION = 3` and `MARKETING_VERSION = 1.0.0` in `project.pbxproj`.
- Remediation: Add a tag-only iOS release job that needs the test job, reads ASC credentials from the `testflight` environment, archives with `-allowProvisioningUpdates` and the API key, exports `method` `app-store-connect` / `destination` `upload` / `manageAppVersionAndBuildNumber` false, and deletes the key in an `if: always()` step. Keep `BUILD_NUMBER_OFFSET` above any existing upload (`CURRENT_PROJECT_VERSION` is 3).
- Source: https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications
- Confidence: 9

#### [GH-15] Actions / untrusted input, triggers and checkout credentials

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Do not interpolate untrusted `github.event` values into `run:`, do not use `pull_request_target`, and set `persist-credentials: false` on checkout when no step pushes.
- Evidence: `.github/workflows/ios-ci.yml` `run:` blocks (Xcode select and `xcodebuild test`) contain no `${{`. `rg pull_request_target` under `.github` returned no hits. The checkout at line 64 has no `persist-credentials: false` (default remains true) and no later step pushes. Cache and artifact `with:` values use `runner.os`, `hashFiles`, and `github.run_id` only.
- Remediation: Set `persist-credentials: false` on the iOS checkout step. Keep `${{ }}` out of `run:` scripts.
- Source: https://docs.github.com/en/actions/reference/security/secure-use
- Confidence: 8

#### [GH-2] Repository / settings and security features

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Set `default_workflow_permissions` to `read` and `can_approve_pull_request_reviews` to false, and enable Dependabot alerts and automated security updates.
- Evidence: `GET /repos/NuclearEng/NoMarkup/actions/permissions/workflow` → `default_workflow_permissions: read`, `can_approve_pull_request_reviews: false`. `GET /repos/NuclearEng/NoMarkup/vulnerability-alerts` → 404 `Vulnerability alerts are disabled.` `GET /repos/NuclearEng/NoMarkup/automated-security-fixes` → `enabled: false`. `delete_branch_on_merge` and `allow_auto_merge` are false (optional). No `use_squash_pr_title_as_default` or `has_downloads` callers in `scripts/` (`scripts/ci_setup.sh` is not in the tree).
- Remediation: Enable Dependabot vulnerability alerts and automated security fixes on NuclearEng/NoMarkup. Keep the workflow token default at `read`.
- Source: https://docs.github.com/en/rest/actions/permissions
- Confidence: 9

#### [GH-21] Environments / testflight protection

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: The `testflight` environment allows only tag `v*` via a custom deployment branch policy, so other branches cannot read the App Store Connect key.
- Evidence: `GET /repos/NuclearEng/NoMarkup/environments` lists only `github-pages`. `GET /repos/NuclearEng/NoMarkup/environments/testflight` → 404. `GET .../environments/testflight/deployment-branch-policies` is not found. No workflow job sets `environment: testflight`. `.github/workflows/deploy.yml` uses `environment: production`, which is also absent from the environments list.
- Remediation: Create `testflight` with `custom_branch_policies: true` and a deployment branch policy `name: v*`, `type: tag`. Do not attach the ASC key to `github-pages` or to an unrestricted environment.
- Source: https://docs.github.com/en/rest/deployments/environments
- Confidence: 9

#### [GH-22] Checks and statuses

- Status: FAIL
- Severity: major
- Kind: required
- Rule: The required status-check context is the job name `Build + test (simulator)`, and that same string is in the ruleset.
- Evidence: `.github/workflows/ios-ci.yml` line 55 names the job `iOS Unit Tests`, not `Build + test (simulator)`. `GET /repos/NuclearEng/NoMarkup/rules/branches/main` returned no `required_status_checks` rule, so neither name is required. The workflow header (lines 13–17) warns that requiring `iOS Unit Tests` without a non-iOS no-op leaves unrelated PRs waiting.
- Remediation: After adding the no-op twin, require the real job name `iOS Unit Tests` (or rename the job and the ruleset together). Do not require the studio string `Build + test (simulator)`, which this workflow never reports.
- Source: https://docs.github.com/en/rest/checks/runs
- Confidence: 9

#### [GH-5] Branch rules / rulesets or classic protection

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Protect `main` with an active ruleset for deletion, non-fast-forward, pull request, and required status checks whose context equals the job name, or record that the plan does not allow rulesets.
- Evidence: `GET /repos/NuclearEng/NoMarkup/rules/branches/main` → `[]`. `GET /repos/NuclearEng/NoMarkup/rulesets` → empty. `GET /repos/NuclearEng/NoMarkup/branches/main/protection` → 404 `Branch not protected`. The repo is public, so GitHub Free can use branch protection. `docs/studio/ci.md` is not in the tree. `docs/conventions.md` and `docs/launch-checklist.md` record QA-10 as open Founder-Action: `Security Gate` is not a required check. `.github/workflows/ios-ci.yml` lines 13–17 say not to require `iOS Unit Tests` without a no-op twin.
- Remediation: Add an active ruleset on `main` for deletion, non-fast-forward, pull request, and a required check whose context matches the real iOS job name, plus a same-name no-op on non-iOS paths so the path filter does not hang unrelated PRs. Do not record a plan limitation this public repo does not have.
- Source: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- Confidence: 9

#### [GH-8] Actions / xcresult and log artifacts

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Upload `.xcresult`, logs, and gate output with a SHA-pinned `actions/upload-artifact`, `if: always()`, a name unique per attempt, `retention-days: 14`, and `if-no-files-found: warn`, and do not set `include-hidden-files: true`.
- Evidence: `.github/workflows/ios-ci.yml` lines 134–141: `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` (# v4.6.2), `if: failure()` not `if: always()`, `name: ios-test-results-${{ github.run_id }}` (no `github.run_attempt`), `path: ios/TestResults/`, `if-no-files-found: ignore`, `retention-days: 14`. No `include-hidden-files: true` under `.github/workflows/`. The result path is not a hidden `.studio/` directory. A failing test does upload; a cancelled run does not, and a re-run can collide on the same artifact name.
- Remediation: Change the upload step to `if: always()`, set `if-no-files-found: warn`, and name the artifact `ios-test-results-${{ github.run_id }}-${{ github.run_attempt }}`. Keep the SHA pin.
- Source: https://github.com/actions/upload-artifact
- Confidence: 9

#### [GH-14] Dependabot / version updates for Actions and SwiftPM

- Status: GAP
- Severity: major
- Kind: required
- Rule: Commit `dependabot.yml` version 2 with a weekly `github-actions` update, and add a `swift` update only where a `Package.swift` exists; Xcode project packages need a manual review cadence.
- Evidence: `.github/dependabot.yml` lines 113–120: `package-ecosystem: github-actions`, `directory: /`, `interval: weekly`. `find` of `Package.swift` outside build dirs returned 0 files, so a `swift` entry is correctly absent. The only iOS package is `XCRemoteSwiftPackageReference "stripe-ios"` at `https://github.com/stripe/stripe-ios` revision `dfc152145ced35e248e6fda5a8d6eb620bfcd74f` version 24.25.0 in `ios/NoMarkup.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`. No `resolvePackageDependencies` cadence or Dependabot-equivalent review note was found for that pin.
- Remediation: Keep the weekly `github-actions` block. Add a documented cadence that runs `xcodebuild -resolvePackageDependencies` for `ios/NoMarkup.xcodeproj` scheme `NoMarkup` and opens a PR when `stripe-ios` moves. Do not add `package-ecosystem: swift` at `/` while there is no `Package.swift`.
- Source: https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference
- Confidence: 8

#### [GH-16] REST / API version header 2026-03-10 and its breaking changes

- Status: GAP
- Severity: major
- Kind: required
- Rule: Every REST call the studio makes sends `X-GitHub-Api-Version: 2026-03-10` and does not read removed fields (`rate`, `merge_commit_sha`, `has_downloads`).
- Evidence: `scripts/ci_setup.sh` is not in the tree. `rg` of `scripts/` and `.github` found no `gh api`, `api.github.com`, `merge_commit_sha`, or `X-GitHub-Api-Version` request lines. There is no in-repo client to prove the header, and none that contradicts it.
- Remediation: Any future GitHub REST helper must send `X-GitHub-Api-Version: 2026-03-10` and `Accept: application/vnd.github+json`, and must read `resources.core` rather than `rate`.
- Source: https://docs.github.com/en/rest/about-the-rest-api/breaking-changes
- Confidence: 7

#### [GH-19] Signing on GitHub-hosted macOS runners

- Status: GAP
- Severity: major
- Kind: required
- Rule: Prefer cloud-managed automatic signing with the API key; if a certificate secret is used, import it into a `$RUNNER_TEMP` keychain and delete that keychain in an `if: always()` step.
- Evidence: `.github/workflows/ios-ci.yml` line 120 says the simulator destination needs no signing identity. The file has no `security import`, `set-key-partition-list`, or `delete-keychain`. No certificate secret names exist on the repo (GH-17). `CODE_SIGN_STYLE = Automatic` is set in `ios/NoMarkup.xcodeproj/project.pbxproj` (line 1281 and the other targets) but CI never archives, so there is no log of cloud-managed signing either.
- Remediation: When the tag archive job is added, use `CODE_SIGN_STYLE=Automatic` and `-allowProvisioningUpdates` with the API key. Do not `security import` a `.p12` into the workspace. If manual signing is required later, confine the keychain to `$RUNNER_TEMP` and delete it with `if: always()`.
- Source: https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications
- Confidence: 8

#### [GH-26] GitHub MCP server / toolsets

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: When the agent uses the GitHub MCP server, enable only `context`, `repos`, `pull_requests`, `actions`, and `dependabot` (not `all`).
- Evidence: No project `.mcp.json`. `~/.claude.json` has no `api.githubcopilot.com` entry; sampled `mcpServers` values are `{}`. The marketplace template `/Users/nuclearisotope/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/github/.mcp.json` sets URL `https://api.githubcopilot.com/mcp/` and an env-var Authorization header, and does not set `X-MCP-Toolsets` or `GITHUB_TOOLSETS`. This session's MCP servers are appstore-connect, cursor, and tasks, not GitHub.
- Remediation: If GitHub MCP is enabled, set `X-MCP-Toolsets` to `context,repos,pull_requests,actions,dependabot` and do not use `all`.
- Source: https://github.com/github/github-mcp-server/blob/main/README.md
- Confidence: 7

#### [GH-27] GitHub MCP server / read-only by default, lockdown, auth

- Status: GAP
- Severity: major
- Kind: required
- Rule: Run the GitHub MCP server read-only by default (`X-MCP-Readonly: true`, `GITHUB_READ_ONLY=1`, or a `/readonly` URL), and do not commit a PAT literal.
- Evidence: The check paths do not contain `X-MCP-Readonly`, `GITHUB_READ_ONLY`, or a `/readonly` URL. The only GitHub MCP manifest is the marketplace template above, which has neither a read-only header nor a literal `ghp_` / `github_pat_` (it uses `${GITHUB_PERSONAL_ACCESS_TOKEN}`). No project `.mcp.json`. GitHub MCP is not connected in this session, so a writable server is not running. The `gh` token used for read-only API calls on this machine reported scopes `gist, read:org, repo, workflow`, which is broader than the registry's MCP minimum; that token was not found committed in the MCP config.
- Remediation: When GitHub MCP is added, set read-only (and lockdown for public content) and give it a dedicated PAT with `repo` and `read:org` only. Do not commit the token.
- Source: https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md
- Confidence: 7

Advisory:

- GH-13 — GAP: Actions / workflow dependency lockfile (opportunity)
- GH-24 — GAP: Code scanning (opportunity)
- GH-25 — GAP: Actions REST / runs, dispatch, artifacts for agents

### Go to market

#### [GTM-1] Evidence / every quantitative claim is sourced or labelled

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Every number, percentage, price, or count in `00-market.md` and `09-gtm.md` carries a same-line `[src:]` tag, URL, `[src: calc]`, `[src: proposal]`, a studio-doc pointer, or `ASSUMPTION` with a rationale.
- Evidence: Both studio docs not found. `claims_check.py` on those paths exit 2 (usage; files missing). `docs/studio/market/sources.md` not found. Unsourced counts exist in research docs (`docs/investor-faq.md`, `docs/pitch.md`, `docs/one-pager.md`) and must not be copied in as facts.
- Remediation: Create the studio docs and `market/sources.md`. Cite each numeric line. Do not paste investor-faq or pitch figures without a source tag or `ASSUMPTION`.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 9

#### [GTM-3] Evidence / no fabricated statistics

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: An unverified number is not written as a fact; TAM/SAM/SOM shows its formula or is `ASSUMPTION`; the doc has a “Could not verify” list; subagent research stays unverified until the quote and URL are in `sources.md`.
- Evidence: No `00-market.md` §TAM/SAM/SOM and no “Could not verify” list. `docs/investor-faq.md` “TAM” states market-size and take-rate figures, and other FAQ answers state rates and shares, with no formula, no `ASSUMPTION` label, and no source quote. Those lines are research, not a studio market section, and are not verified here.
- Remediation: Do not copy those figures into `00-market.md` as facts. Put them under “Could not verify” until a primary quote is in `sources.md`, or show the formula as `[src: calc]` / `ASSUMPTION`.
- Source: internal rule
- Confidence: 9

#### [GTM-4] Apple constraints / payment rail before pricing

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Before modelling prices, classify every sellable item on the STRIPE-1 table: physical goods and offline services use the card processor, not IAP; digital unlocks use IAP and Apple’s commission and price points. The rail table lives in `00-market.md`.
- Evidence: No rail table and no `econ.py` run. Binary posture matches the locked decision but is not the required table: `ios/NoMarkup/Info.plist` `StoreKitEnabled` false; `AppConfig.storeKitEnabled` defaults false (`AppConfigTests.testStoreKitEnabledDefaultsFalse`); Apple Pay merchant `merchant.com.nomarkup.app` (entitlement, context); Stripe PaymentSheet for real-world checkout. Digital Pro/Business is not sold in this binary. Fee prose in `README.md` and `docs/investor-faq.md` is not a rail table and was not modelled with a cited Apple or Stripe percentage.
- Remediation: Add the rail table (jobs, goods pickup, guarantee, lead-gen, instant payout, and any future digital tier) before any pricing option. Model card rails at cited Stripe rates. Keep StoreKit off until a digital item is actually sold in the app, and then use IAP price points only.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [GTM-5] Unit economics / processor and platform fees in the waterfall

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Each pricing option has an `econ.py` waterfall from guest price through card fee, platform fee, payout fees, seller payout, and platform net, using cited Stripe and Connect rates, with refunds modelled and card fees lost on refund unless the processor says otherwise.
- Evidence: No `econ.py` output in `00-market.md`. No cited Stripe or Connect S-entries. `DefaultFeeConfig` and the README fee table are gross platform rates, not a processor-net waterfall.
- Remediation: Run `econ.py` per option only after the user picks a fee (GTM-7). Cite current stripe.com/pricing and stripe.com/connect/pricing. Do not show take gross of Stripe fees.
- Source: https://stripe.com/pricing
- Confidence: 9

#### [GTM-7] Decisions / pricing and GTM belong to the user

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Research offers two or three options and questions; no fee percentage, cancellation policy, launch geography, or launch side is decided until `00-market.md` §Decisions records the user’s answer and date, or “PENDING (user)”.
- Evidence: `00-market.md` §Decisions not found. No PENDING record. Operational defaults exist and disagree with other prose, so none of them is a dated user answer: `DefaultFeeConfig()` sets `FeePercentage` 0.08 and `GuaranteePercentage` 0.02 while the comment above the function says a 5% take rate (`services/payment/internal/domain/types.go`); `database/cmd/seed/main.go` inserts `0.0800` under a comment that says 5%; `README.md` “Fees” states seller-side rates; `docs/investor-faq.md` “How do you make money?” states a different goods commission and a services placement fee. Launch geography is King County in `docs/launch-checklist.md` and `README.md`, and Austin in `docs/one-pager.md`, `docs/pitch.md`, and `docs/demo-script.md`. This audit does not pick a fee or a city.
- Remediation: Add §Decisions with “PENDING (user)” for fee percentage, cancellation policy, launch geography, and which side launches first. Do not copy a rate or a city from README, the seed, or the investor FAQ into the brief as final.
- Source: internal rule
- Confidence: 8

#### [GTM-10] ASO / name, subtitle and keywords within Apple's limits

- Status: GAP
- Severity: major
- Kind: required
- Rule: Name, subtitle, and keyword field stay inside Apple’s limits, keywords do not repeat indexed words or competitor names, and `aso_check.py` exits 0; category choice is justified from Apple’s definitions.
- Evidence: Same gap as ASO-2 through ASO-9: `aso_check.py --app ios` exit 2; no `09-gtm.md` §ASO. Display name `NoMarkup` is within 30 characters and is not a full metadata lint.
- Remediation: Propose two or three name/subtitle options for the user, then run `aso_check.py` and file the chosen set in `09-ship-pack/metadata.md`.
- Source: https://developer.apple.com/app-store/search/
- Confidence: 9

#### [GTM-11] Timing / launch considers seasonality

- Status: GAP
- Severity: major
- Kind: required
- Rule: The launch date is chosen against the category’s demand season in the launch market, with cited evidence, and supply recruiting plus App Review lead time land before the season opens; if demand is not seasonal, the section says so with the reason.
- Evidence: No `00-market.md` §Seasonality and no `09-gtm.md` timeline. Demand is location-bound (local pickup, home services and goods). No cited weather, regulator season, or operator season page. `docs/launch-checklist.md` has no season work-back.
- Remediation: Either cite seasonality for home services in the chosen metro and work back from season start, or write that goods pickup is not seasonal and services weather effects are `ASSUMPTION` until sourced. Include App Review lead time.
- Source: internal rule
- Confidence: 8

#### [GTM-12] Regulation / regulatory and insurance cost drivers

- Status: GAP
- Severity: major
- Kind: required
- Rule: Licensing, insurance, tax, and safety rules that change cost or supply are listed from primary sources, marked “not legal advice”, and mapped to RISK items in `01-brief.md`; otherwise §Regulatory says none applies, with the reason. A legal item is never marked PASS.
- Evidence: No `00-market.md` §Regulatory and no `01-brief.md` RISK map. The product collects provider licenses, has a 1099-NEC summary path (`README.md` Business Suite), holds escrow, and has per-job insurance and legal-services flags (insurance competition and legal services described as flag-off). Corrected applicability flags `insurance`, `financial`, and `regulated` are false, so this audit does not reclassify the app as an insurance or securities product. No primary-source cite and no “not legal advice” statement.
- Remediation: Write §Regulatory as “not legal advice”. Either cite primary sources for license, tax, and escrow drivers and map each to a brief RISK for counsel, or state which of those do not change v1 cost and why. Do not mark the legal question PASS.
- Source: internal rule
- Confidence: 8

#### [GTM-13] Evolve / metrics tracked, experiments only with approval

- Status: GAP
- Severity: major
- Kind: required
- Rule: Each KPI has a formula, a data source the app can see without third-party tracking, and a sourced or `ASSUMPTION` target; any price or fee experiment is `needs_approval: true` and is shown to the buyer before payment.
- Evidence: No `09-gtm.md` §KPIs or §Experiment backlog. No `docs/evolve/pending-approval/` pricing brief. In-app NPS and contract reviews are product feedback, not this KPI table.
- Remediation: Define KPIs from data the app already stores (completed pickups, fill rate, proceeds). Do not set a target of shares or “viral”. Mark every fee experiment `needs_approval: true` and wait for the user.
- Source: internal rule
- Confidence: 9

#### [GTM-15] Evidence / diffusion is not demand

- Status: GAP
- Severity: major
- Kind: required
- Rule: Share, view, impression, or viral counts may be cited only as diffusion, and must not be the sole support for the segment, the TAM, a price, or a KPI target. Listing copy is not written to chase arousal or conflict.
- Evidence: No `00-market.md` or `09-gtm.md` lines to check for a diffusion label. `docs/investor-faq.md` TAM is unsupported market-size prose, not a labelled diffusion count, and is already barred by GTM-3 from being copied as demand. No KPI whose target is shares. No store listing copy exists to judge against arousal.
- Remediation: If a later source only reports spread, label it diffusion and put demand under “Could not verify” or next to a want metric (downloads, proceeds, ratings, or the IDEA-2 set). Do not add a viral KPI.
- Source: https://doi.org/10.1016/j.tics.2025.06.014
- Confidence: 8

#### [GTM-2] Evidence / source quality and access dates

- Status: GAP
- Severity: major
- Kind: required
- Rule: Every `S<n>` entry has a URL, an access date, the publisher, and a verbatim quote; competitor fees come from the competitor’s own pages or are labelled `third-party`.
- Evidence: `docs/studio/market/sources.md` not found. No S-entries. Competitor fee comparisons in `README.md` and `services/payment/internal/domain/types.go` (`DefaultFeeConfig` comment) have no access date or verbatim quote.
- Remediation: Fetch competitor pricing, help, and terms pages into numbered S-entries with YYYY-MM-DD access dates. Label anything not on the competitor’s domain as `third-party` and do not use it as the sole pricing basis.
- Source: internal rule
- Confidence: 9

#### [GTM-6] Unit economics / fixed costs, break-even and sensitivity

- Status: GAP
- Severity: major
- Kind: required
- Rule: Monthly fixed costs include the cited Apple Developer Program fee, domain, hosting, Connect active-account fees, and known insurance or counsel cost; the doc shows contribution margin, break-even transactions per month, and a sensitivity table.
- Evidence: No `monthly_fixed_total`, `break_even_bookings_per_month`, or sensitivity table. `docs/operations/provisioning-checklist.md` and `docs/operations/capital-light-production.md` do not replace `econ.py` output.
- Remediation: Have `econ.py` print the three required figures for each option the user is asked to choose. Cite the 99 USD/year Apple Developer Program fee from Apple’s programs page. Label unknown counsel or insurance as `ASSUMPTION`.
- Source: https://developer.apple.com/programs/
- Confidence: 9

#### [GTM-8] Competition / competitor table is complete and current

- Status: GAP
- Severity: major
- Kind: required
- Rule: The competitor table has at least three direct or adjacent players plus local incumbents, with model, buyer fee, seller fee, geography, strengths, weaknesses, and an S-citation on every cell (or “not published” with the page checked).
- Evidence: No competitor table in `00-market.md`. Narrative comparisons in `docs/investor-faq.md`, `docs/pitch.md`, and `docs/one-pager.md` name several national products and omit the required columns and S-citations. No local King County or Austin incumbent table.
- Remediation: Build the table from each competitor’s own fee and terms pages. Include local incumbents for the launch geography once GTM-7 is answered. Do not treat FAQ prose as the table.
- Source: internal rule
- Confidence: 9

#### [GTM-9] Marketplaces / both sides, liquidity and cold start

- Status: GAP
- Severity: major
- Kind: required
- Rule: A two-sided marketplace writes segments for both sides, and `09-gtm.md` §Liquidity names the side recruited first, one launch geography, and a liquidity metric with a formula and a sourced or `ASSUMPTION` target.
- Evidence: Marketplace flag is true (services reverse auction and goods forward auction). No `09-gtm.md` §Liquidity. `docs/investor-faq.md` discusses a single-metro cold start and seller-side incentives but has no liquidity formula. Launch place is not a single recorded decision (King County vs Austin; see GTM-7). `docs/planning/best-in-class-features.md` “time-to-first-bid” is a product metric, not the GTM liquidity section.
- Remediation: After the user picks geography and first side, write §Liquidity with one metro and a formula (for example share of searches with a bookable result, or fill rate) labelled `ASSUMPTION` or sourced. Do not plan a national launch.
- Source: internal rule
- Confidence: 8

Advisory:

- GTM-14 — GAP: Freshness / re-verify before deciding

### Guidelines-linked policies

#### [ASRL-4] Account deletion / Sign in with Apple

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Apps that create accounts with Sign in with Apple use the Sign in with Apple REST API to revoke user tokens when the account is deleted.
- Evidence: Sign in with Apple is a login path. Deletion calls requestAccountDeletion. No /auth/revoke call was found next to the Apple token endpoints.
- Remediation: Revoke the stored Apple token on deletion and register the server-to-server notifications URL.
- Source: https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion
- Confidence: 7

#### [ASRL-5] Purpose strings / wording

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Each `NS*UsageDescription` names the specific feature or outcome the data enables and gives a concrete example of use.
- Evidence: NSPhotoLibraryUsageDescription says NoMarkup needs access so the person can set a profile picture, add portfolio images, and attach photos to jobs, listings, and claims.
- Remediation: Rewrite the photo string as one active sentence about the outcome, such as attaching a photo to a listing.
- Source: https://developer.apple.com/help/app-review/guideline-reference/5-1-1-purpose-strings
- Confidence: 8

#### [ASRL-20] Subscriptions / required sign-up screen elements and price prominence

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: The subscription sign-up screen must show (1) the subscription name, its duration, and the content or services provided; (2) the full renewal price, clearly and prominently, localized in the available currencies; (3) a way for current subscribers to sign in or restore purchases.
- Evidence: StoreKitEnabled is false. No restorePurchases and no subscriptionStorePolicyDestination in the iOS tree.
- Remediation: Do not submit a subscription sign-up until the billed amount, restore, Terms of Use, and Privacy Policy are on that screen.
- Source: https://developer.apple.com/app-store/subscriptions/
- Confidence: 7

#### [ASRL-11] In-App Purchase / review readiness in sandbox

- Status: RISK
- Severity: major
- Kind: required
- Rule: App Review tests IAPs in the sandbox.
- Evidence: No Product.products(for:) store is on the shipping path. Paid Apps agreement status and Review Notes are not in the tree.
- Remediation: Fetch products from StoreKit and test them in sandbox before submitting any IAP.
- Source: https://developer.apple.com/help/app-review/before-submitting-for-review/configure-in-app-purchases
- Confidence: 6

#### [ASRL-27] Apple Pay / marketing, mark usage and set-up prompts

- Status: RISK
- Severity: major
- Kind: required
- Rule: Use the Apple Pay mark only when the message is about paying with Apple Pay, never in general product or company promotion.
- Evidence: Checkout uses PayWithApplePayButton. Orders uses .plain and both call sites can disable the button. canMakePayments is in DeviceCapabilityUITests, not in the checkout views. No set-up button.
- Remediation: Gate the button with canMakePayments and use the set-up type when Apple Pay is not configured.
- Source: https://developer.apple.com/apple-pay/marketing/
- Confidence: 7

#### [ASRL-3] Account deletion / auto-renewable subscribers

- Status: RISK
- Severity: major
- Kind: required
- Rule: Before deleting the account of someone with an active auto-renewable subscription, tell them that billing continues through Apple and ask them to cancel first.
- Evidence: The subscriptions flag is true because the StoreKit scaffold exists, and StoreKitEnabled is false. Deletion has no manageSubscriptionsSheet and no apps.apple.com/account/subscriptions link.
- Remediation: If an Apple auto-renewable is ever active, warn that Apple billing continues and offer manage-subscriptions beside immediate deletion.
- Source: https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion
- Confidence: 6

#### [ASRL-14] Review preparation / required documentation and legal-entity submissions

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Attach the documentation that certain apps need in App Store Connect (App Review Information › Attachments / Notes): kids apps with third-party ads need a link to the ad service's documented Kids-category practices, including human review of ad creatives; apps that work with medical hardware need regulatory clearance for each location where they're sold; apps that show third-party trademarks or copyrighted content, or that stream or download third-party content, need proof of authorization; apps for licensed services (real-money gaming, lotteries, raffles, VPN) need the license.
- Evidence: AccountView and LegalWebView link https://no-markup.com/privacy and https://no-markup.com/support, plus mailto:support@no-markup.com. No review attachment pack and no recorded HTTP 200.
- Remediation: Confirm both URLs return 200 with current contact details.
- Source: https://developer.apple.com/distribute/app-review/
- Confidence: 6

#### [ASRL-6] Purpose strings / localization and third-party SDKs

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: (a) An app that supports several localizations provides localized purpose strings for each, and tests that the right text appears in the permission request.
- Evidence: knownRegions are en and Base only. No nm -u scan of the app or stripe-ios for protected-API symbols.
- Remediation: Scan the binary and embedded frameworks and add any missing purpose string or unlink the API.
- Source: https://developer.apple.com/help/app-review/guideline-reference/5-1-1-purpose-strings
- Confidence: 6

#### [ASRL-10] Device compatibility / where an iPhone app actually runs

- Status: GAP
- Severity: major
- Kind: required
- Rule: An iPhone app with no dependency on iPhone-only capabilities can be downloaded onto iPad (compatibility mode), Apple silicon Macs and Apple Vision Pro.
- Evidence: Universal binary, UIRequiresFullScreen false, no UIRequiredDeviceCapabilities in the plist slice. No Mac or Vision compatibility notes.
- Remediation: Test compatibility modes and record availability limits.
- Source: https://developer.apple.com/help/app-review/before-submitting-for-review/test-compatible-devices
- Confidence: 7

#### [ASRL-15] Age rating / questionnaire, override and Kids category

- Status: GAP
- Severity: major
- Kind: required
- Rule: Answer the age rating questionnaire, which covers content descriptors with frequency plus in-app controls and capabilities.
- Evidence: AgeGateView enforces 18+. No age-rating questionnaire export.
- Remediation: Match the store questionnaire to UGC, chat, and the 18+ gate.
- Source: https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/
- Confidence: 6

#### [ASRL-16] Accessibility Nutrition Labels / when you may claim support

- Status: GAP
- Severity: major
- Kind: required
- Rule: Claim support for a feature (VoiceOver, Voice Control, Larger Text, Dark Interface, Differentiate Without Color Alone, Sufficient Contrast, Reduced Motion, Captions, Audio Descriptions) on a device only if people can complete every common task with it on that device.
- Evidence: An accessibility audit test exists. No common-task nutrition-label matrix.
- Remediation: Do not claim a feature until every common task passes with it on.
- Source: https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels
- Confidence: 7

#### [ASRL-17] Product page metadata / limits and keyword hygiene

- Status: GAP
- Severity: major
- Kind: required
- Rule: App name ≤ 30 characters.
- Evidence: No fastlane metadata lint. The name NoMarkup is short, which does not prove keywords or promo text.
- Remediation: Lint name, promo text, keywords, and description.
- Source: https://developer.apple.com/app-store/product-page/
- Confidence: 6

#### [ASRL-2] Account deletion / scope, timing and transparency

- Status: GAP
- Severity: major
- Kind: required
- Rule: (a) Automatically created ("guest") accounts also get a deletion option.
- Evidence: AccountDeletionView states a typical 30-day grace and signs the person out. No test shows listings, chat, or reviews removed for other people. The entry is not region-gated.
- Remediation: Confirm the deletion job removes shared UGC and media.
- Source: https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion
- Confidence: 6

#### [ASRL-26] Trademarks / Apple names in app name, metadata and copy

- Status: GAP
- Severity: major
- Kind: required
- Rule: Use Apple word marks only in referential phrases ("for iPhone", "works with", "compatible with"), never as part of your app, company, product or domain name, and never in a way that implies endorsement.
- Evidence: No store name or subtitle file to scan. In-app Apple Pay and Face ID wording is referential. The app name is not an Apple mark.
- Remediation: Lint metadata for iPhone, iOS, and App Store phrases.
- Source: https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html
- Confidence: 6

#### [ASRL-30] iCloud Backup / what to back up

- Status: GAP
- Severity: major
- Kind: required
- Rule: Store purgeable, re-creatable data (thumbnails, caches) in `tmp` or `Library/Caches`, which iCloud Backup excludes, and delete it when you no longer need it.
- Evidence: Exports use temporaryDirectory. No isExcludedFromBackup. Image cache location was not mapped.
- Remediation: Keep caches in Caches or tmp and keep user files out of Caches.
- Source: https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup
- Confidence: 6

#### [ASRL-7] Screenshots / majority-in-use rule

- Status: GAP
- Severity: major
- Kind: required
- Rule: For each device type, more than half of the screenshots must show the app in use.
- Evidence: No screenshot manifest with in-use tags. ScreenshotWalkUITests captures screens.
- Remediation: Make more than half of each device’s screenshots show the app in use.
- Source: https://developer.apple.com/help/app-review/guideline-reference/2-3-3-screenshots
- Confidence: 6

#### [ASRL-8] Copycats / authentic metadata and developer info

- Status: GAP
- Severity: major
- Kind: required
- Rule: Don't put references to popular app names or trademarked terms in any metadata field, and don't use protected material without permission.
- Evidence: The product name is NoMarkup. No metadata denylist run and no curl of the support URL.
- Remediation: Keep the support URL current.
- Source: https://developer.apple.com/help/app-review/guideline-reference/4-1-prevent-copycat-rejection
- Confidence: 6

Advisory:

- ASRL-12 — GAP: Review process / when to reply and when to resubmit
- ASRL-13 — GAP: Review process / Bug Fix Submissions, expedites and appeals
- ASRL-18 — GAP: Categories / primary category and Kids bands
- ASRL-21 — GAP: Subscriptions / group and level design
- ASRL-24 — GAP: Marketing / App Store badge usage
- ASRL-25 — GAP: Marketing / Apple product images and screen content
- ASRL-33 — GAP: Featuring nominations / lead time
- ASRL-9 — GAP: App Store Improvements / removal of outdated apps

### Hub-linked policies

#### [HUBL-10] Foundation Models / agentic tool loops and transcript edits

- Status: GAP
- Severity: major
- Kind: required
- Rule: With the tool calling mode `required`, the model can only call tools and loops.
- Evidence: No LanguageModelSession and no toolCallingMode.
- Remediation: If tools are added, give the loop an exit.
- Source: https://developer.apple.com/videos/play/wwdc2026/242/
- Confidence: 6

#### [HUBL-11] Evaluations framework / quality gates for AI features

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Gate every shipped AI feature with an `Evaluation` run through Swift Testing.
- Evidence: No Evaluations import and no sample set.
- Remediation: Gate a real model feature with a small evaluation.
- Source: https://developer.apple.com/videos/play/wwdc2026/298/
- Confidence: 6

#### [HUBL-3] SwiftUI lazy stacks / subview shape and onAppear

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: In leaf views that a `ForEach` creates many times inside `LazyVStack`/`LazyHStack`, don't resolve to a dynamic number of subviews (for example a body that is `if detailLevel > x { … }` and so produces zero or one view).
- Evidence: Lazy stack row bodies were not audited for a changing subview count or onAppear work.
- Remediation: Filter before ForEach and keep per-row setup off onAppear.
- Source: https://developer.apple.com/videos/play/wwdc2026/321/
- Confidence: 5

Advisory:

- HUBL-18 — GAP: Foundation Models / Spotlight-grounded search UI
- HUBL-4 — GAP: SwiftUI 2027 data flow / AsyncImage caching and lazy @State
- HUBL-6 — GAP: App Intents / in-app search schema and complete schema sets
- HUBL-7 — GAP: App Intents / RelevantEntities for content the system hasn't seen
- HUBL-9 — GAP: Foundation Models / Instruments traces contain prompts

### Human Interface Guidelines

#### [HIG-managing-accounts.2] Managing accounts / Deleting accounts

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: If deletion can be scheduled, also offer immediate deletion.
- Evidence: AccountDeletionView schedules a 30-day grace and website restore and has no immediate-delete control. Server Apple URLs are /auth/authorize, /auth/token, and /auth/keys. No /auth/revoke in the deletion path.
- Remediation: Offer immediate deletion beside the schedule, and revoke the Sign in with Apple token when the account is deleted.
- Source: https://developer.apple.com/design/human-interface-guidelines/managing-accounts
- Confidence: 8

#### [HIG-privacy.1] Privacy / pre-alert (priming) screens

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: A custom screen shown before a permission alert (camera, microphone, location, contacts, calendar, tracking) has exactly one button, titled "Continue" or "Next", and that button opens the system alert.
- Evidence: ios/NoMarkup/Features/JobsMapView.swift alert "Location for nearby jobs" has Continue and "Not now" (role .cancel). ParitySurfacesView.swift repeats that pair for "Location for nearby listings".
- Remediation: Remove Not now so the primer only continues into the system location alert.
- Source: https://developer.apple.com/design/human-interface-guidelines/privacy
- Confidence: 9

#### [HIG-alerts.3] Alerts / buttons

- Status: FAIL
- Severity: major
- Kind: required
- Rule: The cancel button is always titled "Cancel" and is never the default.
- Evidence: JobsMapView, ParitySurfacesView, the notification pre-prompt, and ContractDetailView use Button("Not now", role: .cancel).
- Remediation: Title every cancel-role button Cancel.
- Source: https://developer.apple.com/design/human-interface-guidelines/alerts
- Confidence: 8

#### [HIG-always-on.1] Always On / iPhone Lock Screen surfaces

- Status: FAIL
- Severity: major
- Kind: required
- Rule: In the reduced-luminance state, redact sensitive personal data (balances, health data), keep the key value legible and dim secondary text, images and fills, keep the layout the same (switch interactive parts to an unavailable look rather than removing them), update infrequently and subtly, and ease motion to rest rather than stopping it abruptly.
- Evidence: The auction Live Activity shows bid state with no isLuminanceReduced and no privacySensitive under ios/NoMarkupWidget.
- Remediation: Dim secondary text when luminance is reduced and mark bid amounts privacy-sensitive.
- Source: https://developer.apple.com/design/human-interface-guidelines/always-on
- Confidence: 8

#### [HIG-apple-pay.1] Apple Pay / offering and buttons

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Never hide or disable the button; explain missing selections after the tap.
- Evidence: ListingDetailView PayWithApplePayButton(.buy) is disabled while a bid or bond is posting. MyOrdersView PayWithApplePayButton(.plain) is disabled when isBusy and uses the plain type. Both use minHeight 44 and automatic style.
- Remediation: Leave the system button enabled, use a commerce type on orders, and explain a missing selection after the tap.
- Source: https://developer.apple.com/design/human-interface-guidelines/apple-pay
- Confidence: 9

#### [HIG-color.1] Color / system and semantic colors

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every custom color has light, dark and increased-contrast variants, even if the app ships one appearance (Liquid Glass adapts in both).
- Evidence: AccentColor.colorset has Any and Dark slots and no contrast:high. Facebook and Google sign-in buttons and widget brand colors use Color(red:).
- Remediation: Add increased-contrast appearances for accent and brand colors.
- Source: https://developer.apple.com/design/human-interface-guidelines/color
- Confidence: 7

#### [HIG-live-activities.2] Live Activities / Anatomy + Presentation + Specifications

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Minimal shows live data (for example remaining time), not just a logo.
- Evidence: AuctionLiveActivityWidget minimal region is only Image(systemName: "timer"). Compact and expanded regions show Text(timerInterval:). Lock Screen sets widgetURL.
- Remediation: Show remaining time in the minimal presentation.
- Source: https://developer.apple.com/design/human-interface-guidelines/live-activities
- Confidence: 9

#### [HIG-notifications.2] Notifications / Notification actions + Badging + Best practices (foreground)

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Don't add an action that only opens the app.
- Evidence: PushRegistration registers UNNotificationAction title "View" with options [.foreground] and "Dismiss" with .destructive. No action icon and no hiddenPreviewsBodyPlaceholder. Category options are [].
- Remediation: Drop the open-only View action or name a specific task, add an SF Symbol, and set a hidden-preview placeholder.
- Source: https://developer.apple.com/design/human-interface-guidelines/notifications
- Confidence: 8

#### [HIG-privacy.2] Privacy / purpose string style

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Each usage-description (purpose) string is one brief, complete, active-voice sentence in sentence case that ends with a period and says specifically how and why the data is used.
- Evidence: The photo purpose string is a feature list. The location string covers city suggestion and job-site check-in in one sentence. Camera and Face ID strings name one outcome each.
- Remediation: Make the photo string one specific sentence. Explain location in the primer for the action about to run.
- Source: https://developer.apple.com/design/human-interface-guidelines/privacy
- Confidence: 8

#### [HIG-typography.2] Typography / large text sizes

- Status: FAIL
- Severity: major
- Kind: required
- Rule: At the largest accessibility sizes, show as much useful text as at the largest standard size.
- Evidence: lineLimit(1) is on primary rows in JobsView, HomeView, and widgets. The only dynamicTypeSize switch found is a SpectateTerminalView preview.
- Remediation: At accessibility sizes, remove the one-line cap or stack glyph, title, and time.
- Source: https://developer.apple.com/design/human-interface-guidelines/typography
- Confidence: 7

#### [HIG-widgets.4] Widgets / rendering modes, Lock Screen, StandBy, Always-On

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Accented (Home Screen tinted and clear): split views into accent and primary groups with `widgetAccentable()`.
- Evidence: NextClosingWidget and ActiveBidsWidget set containerBackground and read colorSchemeContrast. No widgetAccentable, widgetRenderingMode, or removable-background handling.
- Remediation: Split accent and primary groups, use vibrant Lock Screen colors, and allow the container background to be removed.
- Source: https://developer.apple.com/design/human-interface-guidelines/widgets
- Confidence: 8

#### [HIG-apple-in-app-purchase.2] Apple In-App Purchase / subscription sign-up

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: The in-app subscription sign-up screen shows, for each option: a short distinguishing name, duration, what's provided each period, and the billing amount localized for the storefront (as the most prominent price; per-period breakdowns subordinate).
- Evidence: Info.plist StoreKitEnabled is false. PlanLimitsView is read-only with no purchase CTA. No sign-up screen shows duration, displayPrice, restore, or terms.
- Remediation: Keep the store off, or add a SubscriptionStoreView with restore, terms, privacy, and the billed amount as the largest price before enabling it.
- Source: https://developer.apple.com/design/human-interface-guidelines/apple-in-app-purchase
- Confidence: 7

#### [HIG-apple-in-app-purchase.1] Apple In-App Purchase / store presentation

- Status: RISK
- Severity: major
- Kind: required
- Rule: Let people experience the app before asking them to buy.
- Evidence: PlanLimitsView is a read-only comparison while the store is off. AppStore.canMakePayments is not consulted.
- Remediation: When the store is enabled, hide it when payments are restricted and show product.displayPrice only.
- Source: https://developer.apple.com/design/human-interface-guidelines/apple-in-app-purchase
- Confidence: 6

#### [HIG-live-activities.1] Live Activities / Best practices + Starting, updating, and ending

- Status: RISK
- Severity: major
- Kind: required
- Rule: Use a Live Activity only for a task or event with a defined start and end that lasts 8 hours or less.
- Evidence: AuctionLiveActivityController starts a countdown activity and can end with dismissalPolicy .after(15*60) or .immediate. Bid amounts are on the Lock Screen without redaction. Duration is not capped at 8 hours in the widget.
- Remediation: Redact the bid, end at auction close, and give an in-app stop control.
- Source: https://developer.apple.com/design/human-interface-guidelines/live-activities
- Confidence: 6

#### [HIG-generative-ai.2] Generative AI / Privacy + Models and datasets

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Prefer on-device models (private, fast, offline).
- Evidence: ListingVisualIntelligence.swift matches labels on device and says copy never claims Apple Intelligence. No LanguageModelSession, opt-out, or availability UI.
- Remediation: State that matching stays on device. If a server model is added, disclose what leaves the device and offer an opt-out.
- Source: https://developer.apple.com/design/human-interface-guidelines/generative-ai
- Confidence: 7

#### [HIG-voiceover.1] VoiceOver / descriptions

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Give every key element and custom control a descriptive label, and keep labels current as content changes.
- Evidence: accessibilityLabel is used on checkout, deletion, and Live Activity timers. DeviceCapabilityUITests calls performAccessibilityAudit(for: .all). No complete key-element or decorative-image inventory.
- Remediation: Label every icon-only control, hide decorative images, and keep labels current as bids change.
- Source: https://developer.apple.com/design/human-interface-guidelines/voiceover
- Confidence: 6

#### [HIG-accessibility.2] Accessibility / Vision / contrast

- Status: GAP
- Severity: major
- Kind: required
- Rule: Foreground text and icons meet WCAG AA contrast against their background: 4.5:1 for text up to 17 pt, 3:1 for text 18 pt and larger or bold text.
- Evidence: BrandTheme documents ratios, and DeviceCapabilityUITests runs performAccessibilityAudit(for: .all). No stored light/dark contrast result. AccentColor has no high-contrast slot.
- Remediation: Add high-contrast slots and keep a passing contrast audit.
- Source: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Confidence: 6

#### [HIG-accessibility.3] Accessibility / Mobility / control spacing

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Control size is 44×44 pt by default (28×28 pt minimum), and spacing is treated as part of size: about 12 pt of padding around bezeled elements and about 24 pt around the visible edges of unbezeled elements, so adjacent targets aren't mis-tapped.
- Evidence: Many controls set minHeight 44. No hit-region audit or measured gap between adjacent icons.
- Remediation: Run a hit-region audit and separate adjacent icon buttons.
- Source: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Confidence: 6

#### [HIG-accessibility.4] Accessibility / Mobility / gestures

- Status: GAP
- Severity: major
- Kind: required
- Rule: Frequent interactions use the simplest gesture possible (no custom multifinger gestures).
- Evidence: Some lists pair swipeActions with contextMenu. MyOrdersView stars use onTapGesture and also a Stepper. The gesture table is incomplete.
- Remediation: Give every gesture a visible button or menu path.
- Source: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Confidence: 6

#### [HIG-accessibility.5] Accessibility / Cognitive / timing

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Minimize time-boxed interface elements.
- Evidence: No VoiceOver gate next to toast timers. Auto-dismiss inventory is incomplete.
- Remediation: Keep timed banners up while VoiceOver is running.
- Source: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Confidence: 5

#### [HIG-accessibility.8] Accessibility / Mobility & Speech / assistive technologies

- Status: GAP
- Severity: major
- Kind: required
- Rule: The app works with Voice Control, Switch Control, Full Keyboard Access and AssistiveTouch: every interactive element has a label that matches its visible text (so it can be spoken), and the app doesn't override system-defined keyboard shortcuts.
- Evidence: Labels exist. No full button-label dump and no finished keyboard-shortcut audit.
- Remediation: Dump labels in a UI test and do not rebind system shortcuts.
- Source: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Confidence: 6

#### [HIG-action-sheets.1] Action sheets / usage

- Status: GAP
- Severity: major
- Kind: required
- Rule: Offer choices related to an action the person initiated (for example Delete Draft / Save Draft when cancelling an edit) with an action sheet (`confirmationDialog`), not an alert and not a menu.
- Evidence: confirmationDialog is used for deletes and orders. Some two-choice flows remain alerts. Counts were not finished.
- Remediation: Use confirmationDialog for multi-choice actions and mark destructive roles.
- Source: https://developer.apple.com/design/human-interface-guidelines/action-sheets
- Confidence: 6

#### [HIG-alerts.1] Alerts / when to use

- Status: GAP
- Severity: major
- Kind: required
- Rule: Use alerts sparingly, only for essential, actionable information.
- Evidence: Sampled alerts are actionable. The notification pre-prompt is not at launch. Not every alert was classified.
- Remediation: Replace informational OK alerts with inline status.
- Source: https://developer.apple.com/design/human-interface-guidelines/alerts
- Confidence: 5

#### [HIG-alerts.2] Alerts / content

- Status: GAP
- Severity: major
- Kind: required
- Rule: The alert title clearly says what happened, in what context, and why, in no more than two lines.
- Evidence: Sampled titles are specific, including location, chat, bid bond, and block. No large-text screenshot proves they do not scroll.
- Remediation: Keep titles to two lines.
- Source: https://developer.apple.com/design/human-interface-guidelines/alerts
- Confidence: 6

#### [HIG-app-icons.1] App icons / layers, specs, appearances

- Status: GAP
- Severity: major
- Kind: required
- Rule: Build layers for Icon Composer as square, unmasked 1024×1024 px artwork (the system masks corners; premasked layers break specular highlights).
- Evidence: AppIcon.appiconset has 1024, dark, and tinted PNGs. No .icon bundle and no clear appearance.
- Remediation: Ship unmasked layers for default, dark, clear, and tinted with the same glyph.
- Source: https://developer.apple.com/design/human-interface-guidelines/app-icons
- Confidence: 6

#### [HIG-apple-in-app-purchase.3] Apple In-App Purchase / managing subscriptions and refunds

- Status: GAP
- Severity: major
- Kind: required
- Rule: Show a subscription summary (including the next renewal date) near a clearly visible manage option, preferably the system subscription-management UI, and always make cancelling easy to find (retention offers allowed, but no obstacles).
- Evidence: manageSubscriptionsSheet and refundRequestSheet are absent. AppConfig.manageSubscriptionURL points at the website.
- Remediation: Add the system manage-subscriptions and refund actions on the account screen before selling auto-renewables.
- Source: https://developer.apple.com/design/human-interface-guidelines/apple-in-app-purchase
- Confidence: 7

#### [HIG-apple-pay.2] Apple Pay / checkout and payment sheet

- Status: GAP
- Severity: major
- Kind: required
- Rule: Collect required options (size, color, pickup location, per-item shipping) and optional data (gift message) before the payment sheet; don't require an account before purchase (offer registration on the confirmation page, prefilled).
- Evidence: RailACheckout sets merchantDisplayName to AppConfig.appDisplayName. There is no PKPaymentRequest or summary-item list in the app. Stripe PaymentSheet presents the sheet.
- Remediation: Confirm the sheet total uses the statement merchant name and collect pickup choices before the sheet.
- Source: https://developer.apple.com/design/human-interface-guidelines/apple-pay
- Confidence: 6

#### [HIG-apple-pay.3] Apple Pay / errors, interruptions, naming

- Status: GAP
- Severity: major
- Kind: required
- Rule: Validate available data before authorization and report problems with the correct `PKPaymentError` code and a specific, field-referencing noun-phrase message in sentence case with no ending punctuation, 128 characters or fewer ("Zip code doesn’t match city", not "Address is invalid").
- Evidence: No PKPaymentError construction. Cancel throws CheckoutError.canceled.
- Remediation: Map sheet failures to a short field-specific message and cancel an in-progress order when the sheet is dismissed.
- Source: https://developer.apple.com/design/human-interface-guidelines/apple-pay
- Confidence: 6

#### [HIG-buttons.1] Buttons / style, role, press state

- Status: GAP
- Severity: major
- Kind: required
- Rule: Use a prominent style for the most likely action and keep prominent buttons to one or two per view.
- Evidence: Star ratings use onTapGesture. Prominent-button counts and custom press states were not finished.
- Remediation: Show a pressed state and keep one or two prominent buttons per view.
- Source: https://developer.apple.com/design/human-interface-guidelines/buttons
- Confidence: 6

#### [HIG-color.2] Color / Liquid Glass color

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Apply color sparingly to Liquid Glass and to its symbols and text: reserve it for status indicators and primary actions, and to emphasize a primary action tint the background (prominent style) rather than the symbol or text.
- Evidence: .tint(BrandTheme.accent) is on navigation chrome. Liquid Glass tint counts were not measured on this iOS 17 target.
- Remediation: Tint only the primary action.
- Source: https://developer.apple.com/design/human-interface-guidelines/color
- Confidence: 5

#### [HIG-color.3] Color / meaning, pickers, wide color

- Status: GAP
- Severity: major
- Kind: required
- Rule: One color means one thing: if the brand color marks interactivity, don't use it on noninteractive text.
- Evidence: Status uses words plus color. No ColorPicker and no grayscale screenshot.
- Remediation: Do not use color as the only status signal.
- Source: https://developer.apple.com/design/human-interface-guidelines/color
- Confidence: 6

#### [HIG-context-menus.1] Context menus / content and behavior

- Status: GAP
- Severity: major
- Kind: required
- Rule: Context menus hold a small number of the most relevant item-specific commands (no advanced or rare ones), in about three or fewer separated groups, with at most one submenu level and an intuitive submenu title.
- Evidence: contextMenu exists on rows. Item counts and destructive order were not tabulated.
- Remediation: Cap menus, put Delete last, and repeat each command in the main UI.
- Source: https://developer.apple.com/design/human-interface-guidelines/context-menus
- Confidence: 6

#### [HIG-controls.1] Controls / ControlWidget design

- Status: GAP
- Severity: major
- Kind: required
- Rule: Offer controls for actions that are most useful without opening the app (starting a Live Activity is ideal).
- Evidence: PostJobControlWidget and CheckInControlWidget are ControlWidgetButtons with openAppWhenRun and OpenURLIntent to nomarkup://post-job and nomarkup://check-in. No authenticationPolicy, privacySensitive, or ControlCenter reload. WidgetKit allows a button that opens a specific view.
- Remediation: Add a verb hint, redact sensitive Lock Screen text, and reload controls after state changes.
- Source: https://developer.apple.com/design/human-interface-guidelines/controls
- Confidence: 7

#### [HIG-designing-for-ios.1] Designing for iOS / ergonomics and platform capabilities

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Limit onscreen controls to the primary task and keep secondary actions discoverable with minimal interaction.
- Evidence: swipeActions exist. A full edge-swipe and reachability pass was not done.
- Remediation: Keep the system back swipe and place frequent actions low or in the toolbar.
- Source: https://developer.apple.com/design/human-interface-guidelines/designing-for-ios
- Confidence: 6

#### [HIG-designing-for-iphone-duo.1] iPhone Duo / consistent experience across displays and poses

- Status: GAP
- Severity: major
- Kind: required
- Rule: Keep the same functionality and element state on the outer and inner displays and in every pose; controls may overflow or move but stay reachable.
- Evidence: NavigationSplitView adapts list-detail on regular width. No Duo fold test.
- Remediation: Assert the same primary actions and preserved state folded and unfolded.
- Source: https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo
- Confidence: 6

#### [HIG-designing-for-iphone-duo.2] iPhone Duo / reserved regions and arrangement views

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Custom components avoid reserved regions (outer camera, inner camera when active, and the folding region when partially open) using the `ReservedRegion` API; system alerts, menus, sheets and split views adapt automatically.
- Evidence: ReservedRegion and ArrangementView are absent. Deployment is iOS 17.
- Remediation: Keep custom full-bleed content out of the fold when those APIs are in the SDK you build with.
- Source: https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo
- Confidence: 7

#### [HIG-designing-for-iphone-duo.3] iPhone Duo / vertical controls

- Status: GAP
- Severity: major
- Kind: required
- Rule: Don't override the system's vertical placement of toolbars, tab bars and navigation controls along the side.
- Evidence: Tab items use Label with a title and symbol. No visibilityPriority or overflow menu API.
- Remediation: Let the system overflow low-priority toolbar items.
- Source: https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo
- Confidence: 6

#### [HIG-entering-data.1] Entering data / minimizing input

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Don't ask for information the system can provide (settings, or with permission location, contacts, calendar).
- Evidence: Location primers allow a manual city. Content types are set on auth fields. Formatters were not checked on every numeric field.
- Remediation: Validate currency with a formatter as the person types.
- Source: https://developer.apple.com/design/human-interface-guidelines/entering-data
- Confidence: 6

#### [HIG-feedback.1] Feedback / matching feedback to significance

- Status: GAP
- Severity: major
- Kind: required
- Rule: Match delivery to importance: status lives passively near the items it describes (for example a toolbar status line "Updated just now · 3 unread"); alerts are reserved for critical, actionable information; warn only before unexpected, irreversible data loss, never when loss is the expected result.
- Evidence: Inline errors and alerts both exist. The importance map is incomplete. No audio channel.
- Remediation: Reserve alerts for irreversible or payment-critical outcomes.
- Source: https://developer.apple.com/design/human-interface-guidelines/feedback
- Confidence: 5

#### [HIG-generative-ai.1] Generative AI / Best practices + Transparency + Outputs

- Status: GAP
- Severity: major
- Kind: required
- Rule: Keep people in control of generated content.
- Evidence: Visual search is on-device label match, not generated prose. No AI label, Edit, Undo, or Retry on a generated result.
- Remediation: Label results as on-device matches. Add undo and retry only if generation is added.
- Source: https://developer.apple.com/design/human-interface-guidelines/generative-ai
- Confidence: 7

#### [HIG-generative-ai.3] Generative AI / Inputs + Outputs + Continuous improvement

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Guide input with diverse example prompts or curated suggestions, and state known limitations up front.
- Evidence: No Evaluation suite and no limitation copy. ai_evals is implied by the visual-intelligence flag only.
- Remediation: Do not claim model quality unless a generative feature and an eval set exist.
- Source: https://developer.apple.com/design/human-interface-guidelines/generative-ai
- Confidence: 6

#### [HIG-gestures.1] Gestures / Best practices + Custom gestures

- Status: GAP
- Severity: major
- Kind: required
- Rule: Standard gestures keep their standard meanings: tap activates or selects, swipe reveals actions, dismisses or scrolls, drag moves, touch-and-hold reveals more, double tap zooms, pinch zooms, rotate rotates.
- Evidence: swipeActions and buttons are the common path. Star taps are standard taps.
- Remediation: Do not invent a gesture for a standard action.
- Source: https://developer.apple.com/design/human-interface-guidelines/gestures
- Confidence: 6

#### [HIG-gestures.2] Gestures / Custom gestures + iOS, iPadOS

- Status: GAP
- Severity: major
- Kind: required
- Rule: Don't define gestures that conflict with system UI gestures: screen-edge swipes for Home, Control Center and Notification Center, and the system back swipe.
- Evidence: UndoManager is not referenced. No edge-swipe override was found.
- Remediation: Register edits with UndoManager.
- Source: https://developer.apple.com/design/human-interface-guidelines/gestures
- Confidence: 7

#### [HIG-images.1] Images / Resolution + Formats + Best practices

- Status: GAP
- Severity: major
- Kind: required
- Rule: iOS bitmap assets need @2x and @3x variants (iPhone has no @1x).
- Evidence: The app icon PNG is 1024. @2x/@3x and color profiles were not fully inventoried.
- Remediation: Ship scale variants and an sRGB or Display P3 profile.
- Source: https://developer.apple.com/design/human-interface-guidelines/images
- Confidence: 5

#### [HIG-inclusion.1] Inclusion / Welcoming language + Gender identity + Avoiding stereotypes + Languages

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Copy addresses people as "you" or "your", never "the user" or "the player".
- Evidence: Purpose strings use you and your. Idiom and gender pass is unfinished.
- Remediation: Address the person as you.
- Source: https://developer.apple.com/design/human-interface-guidelines/inclusion
- Confidence: 5

#### [HIG-layout.1] Layout / Visual hierarchy + Adaptability + Guides and safe areas

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Put the most important content at the top and leading edge.
- Evidence: JobsMapView uses a top safeAreaInset. Alignment and bar treatment were not screenshot-checked.
- Remediation: Put primary content at the top and leading edge.
- Source: https://developer.apple.com/design/human-interface-guidelines/layout
- Confidence: 5

#### [HIG-lists-and-tables.1] Lists and tables / Best practices + Content + iOS

- Status: GAP
- Severity: major
- Kind: required
- Rule: Use lists for text-heavy rows and collections or grids for image-heavy or variably sized items.
- Evidence: Jobs and messages use lists. Marketplace image layout versus a grid was not fully compared.
- Remediation: Use lists for text and grids for images.
- Source: https://developer.apple.com/design/human-interface-guidelines/lists-and-tables
- Confidence: 5

#### [HIG-loading.1] Loading / Best practices + Showing progress

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Show something immediately (placeholders, then real content), let people keep using other parts of the app while content loads, and when a load is unavoidably long, show useful content such as tips.
- Evidence: ProgressView covers buy-now and deletion. Background Assets is not used.
- Remediation: Show placeholder content immediately.
- Source: https://developer.apple.com/design/human-interface-guidelines/loading
- Confidence: 5

#### [HIG-managing-notifications.1] Managing notifications / Integrating with Focus + Best practices

- Status: GAP
- Severity: major
- Kind: required
- Rule: Give every non-communication notification an honest interruption level.
- Evidence: Client categories do not set interruptionLevel.
- Remediation: Set passive, active, or time-sensitive per category and keep promotions out of time-sensitive.
- Source: https://developer.apple.com/design/human-interface-guidelines/managing-notifications
- Confidence: 6

#### [HIG-maps.2] Maps / Best practices (Apple logo and legal link) + Place cards

- Status: GAP
- Severity: major
- Kind: required
- Rule: Keep the Apple Maps logo and legal link visible.
- Evidence: SwiftUI Map with Annotation pins. Filters are a top inset. No proof the Legal link stays visible.
- Remediation: Keep the Legal mark clear of cards.
- Source: https://developer.apple.com/design/human-interface-guidelines/maps
- Confidence: 6

#### [HIG-modality.1] Modality / Best practices

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: A modal task stays short and simple, never an "app within the app".
- Evidence: Sheets use presentationDetents. Whether each task could be inline was not judged.
- Remediation: Keep modality for tasks the person must finish or abandon.
- Source: https://developer.apple.com/design/human-interface-guidelines/modality
- Confidence: 5

#### [HIG-popovers.1] Popovers / compact width and behavior

- Status: GAP
- Severity: major
- Kind: required
- Rule: Don't show popovers in compact width (iPhone).
- Evidence: No popover adaptation audit.
- Remediation: On iPhone, present popovers as sheets.
- Source: https://developer.apple.com/design/human-interface-guidelines/popovers
- Confidence: 5

#### [HIG-privacy.4] Privacy / data minimization and system protections

- Status: GAP
- Severity: major
- Kind: required
- Rule: Request only the data a feature needs, and choose the most specific access level (limited photos, approximate location, add-only calendar, contact picker instead of full Contacts).
- Evidence: Purpose strings exist only for location, photos, camera, and Face ID. No tracking string.
- Remediation: Ask at the moment of use and only for that action.
- Source: https://developer.apple.com/design/human-interface-guidelines/privacy
- Confidence: 6

#### [HIG-progress-indicators.1] Progress / determinate, honest, cancellable

- Status: GAP
- Severity: major
- Kind: required
- Rule: Prefer determinate progress, and switch from indeterminate to determinate as soon as the duration is known.
- Evidence: Payment and buy-now show ProgressView with labels such as Processing payment. Many spinners have no cancel.
- Remediation: Caption long work and offer Cancel when it is safe.
- Source: https://developer.apple.com/design/human-interface-guidelines/progress-indicators
- Confidence: 5

#### [HIG-pull-down-buttons.1] Pull-down buttons / menu content (iOS)

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: A pull-down menu holds commands directly related to the button's purpose (Add → which item, Sort → which attribute).
- Evidence: Menus exist. Pull-down grouping was not scored one by one.
- Remediation: Hide unavailable items.
- Source: https://developer.apple.com/design/human-interface-guidelines/pull-down-buttons
- Confidence: 5

#### [HIG-scroll-views.1] Scroll views / nesting, paging and zoom

- Status: GAP
- Severity: major
- Kind: required
- Rule: Never nest a scroll view inside another with the same axis.
- Evidence: Lists and the map scroll. Nested scroll views were not measured.
- Remediation: Use one primary scroll view per screen.
- Source: https://developer.apple.com/design/human-interface-guidelines/scroll-views
- Confidence: 5

#### [HIG-search-fields.1] Search fields / iOS placement

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Choose the search entry point from the layout.
- Evidence: searchable is used. Scope and clear-history were not confirmed.
- Remediation: Show the current scope and let people clear history.
- Source: https://developer.apple.com/design/human-interface-guidelines/search-fields
- Confidence: 5

#### [HIG-segmented-controls.1] Segmented controls / count, content, purpose

- Status: GAP
- Severity: major
- Kind: required
- Rule: On iPhone, use no more than about 5 segments.
- Evidence: Segmented controls were not inventoried.
- Remediation: Keep segments few, equal, and short.
- Source: https://developer.apple.com/design/human-interface-guidelines/segmented-controls
- Confidence: 5

#### [HIG-sheets.1] Sheets / dismissal buttons (iOS)

- Status: GAP
- Severity: major
- Kind: required
- Rule: In a single-view sheet, put Cancel (or Close) on the leading edge of the top toolbar and Done on the trailing edge.
- Evidence: Many sheets. A deep-link sheet uses Close. Not every sheet shows leading Cancel and trailing Done.
- Remediation: Pair Done with Cancel or Close.
- Source: https://developer.apple.com/design/human-interface-guidelines/sheets
- Confidence: 6

#### [HIG-sheets.3] Sheets / swipe to dismiss and unsaved changes

- Status: GAP
- Severity: major
- Kind: required
- Rule: Support the vertical swipe that dismisses a sheet.
- Evidence: interactiveDismissDisabled is set while some forms submit. Other unsaved sheets do not confirm.
- Remediation: Confirm unsaved dismissal with an action sheet.
- Source: https://developer.apple.com/design/human-interface-guidelines/sheets
- Confidence: 6

#### [HIG-sheets.4] Sheets / alternatives and stacking

- Status: GAP
- Severity: major
- Kind: required
- Rule: Show only one sheet at a time from the main interface.
- Evidence: Detents exist. Nested sheet order was not fully traced. Contract detail avoids one stacked dialog.
- Remediation: Show one sheet at a time.
- Source: https://developer.apple.com/design/human-interface-guidelines/sheets
- Confidence: 5

#### [HIG-sign-in-with-apple.1] Sign in with Apple / when to ask and what to collect

- Status: GAP
- Severity: major
- Kind: required
- Rule: Ask people to sign in only in exchange for clear value, and as late as possible: let them explore first, and in commerce, after the purchase (guest checkout, then create the account on the confirmation page).
- Evidence: Browse-only mode exists. Posting and buying still need an account. The Apple button does not ask for a password. Relay-email handling was not shown.
- Remediation: Do not ask for a personal email after Hide My Email.
- Source: https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple
- Confidence: 6

#### [HIG-siri.1] Siri / intents, terms, responses

- Status: GAP
- Severity: major
- Kind: required
- Rule: Expose the app's most popular actions and content as App Intents and entities, in familiar terms (a song is "song", not "media asset").
- Evidence: JobEntity and ListingEntity use the words Job and listing. Shortcuts open the app. Spoken dialogs that carry the result were not found.
- Remediation: Return a spoken result and skip ads in dialogue.
- Source: https://developer.apple.com/design/human-interface-guidelines/siri
- Confidence: 6

#### [HIG-sliders.1] Sliders / direction, volume, precision

- Status: GAP
- Severity: major
- Kind: required
- Rule: The minimum is on the leading side and the maximum on the trailing side (bottom to top for vertical sliders).
- Evidence: No slider value-label audit.
- Remediation: Show the current value beside any slider.
- Source: https://developer.apple.com/design/human-interface-guidelines/sliders
- Confidence: 5

#### [HIG-text-fields.1] Text fields / purpose, label, size, validation timing

- Status: GAP
- Severity: major
- Kind: required
- Rule: Use text fields for small pieces of information, and a text view for long text.
- Evidence: Account deletion and auth forms use labeled fields. Placeholder-only fields were not fully ruled out.
- Remediation: Keep a persistent label and validate email on blur.
- Source: https://developer.apple.com/design/human-interface-guidelines/text-fields
- Confidence: 6

#### [HIG-toolbars.2] Toolbars / standard Back and Close

- Status: GAP
- Severity: major
- Kind: required
- Rule: Use the system Back and Close buttons.
- Evidence: brandNavigationBarChrome is applied. System Back and edge swipe were not proven on every stack.
- Remediation: Use the system Back and Close controls.
- Source: https://developer.apple.com/design/human-interface-guidelines/toolbars
- Confidence: 6

#### [HIG-undo-and-redo.1] Undo / shake, naming, visibility (iOS)

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Support system undo (shake to undo on iPhone, three-finger swipe, ⌘Z) through `UndoManager`, and never redefine those gestures.
- Evidence: UndoManager is absent, so shake-to-undo has no action names.
- Remediation: Name each undo action.
- Source: https://developer.apple.com/design/human-interface-guidelines/undo-and-redo
- Confidence: 7

#### [HIG-voiceover.2] VoiceOver / navigation structure

- Status: GAP
- Severity: major
- Kind: required
- Rule: Give each screen a unique, succinct title, and mark section headings so the rotor can navigate them.
- Evidence: navigationTitle is set, including Delete Account. accessibilityHeading was not found in the scored search.
- Remediation: Mark headings and announce bid or message changes.
- Source: https://developer.apple.com/design/human-interface-guidelines/voiceover
- Confidence: 6

#### [HIG-widgets.3] Widgets / margins, text, color

- Status: GAP
- Severity: major
- Kind: required
- Rule: Use the standard 16 pt widget margin, or 11 pt for tight groupings.
- Evidence: Widgets use system text styles including caption2 and containerBackground. ContainerRelativeShape was not found. lineLimit(1) clips titles. The 16 pt margin is not set explicitly.
- Remediation: Keep text at 11 pt or larger, use ContainerRelativeShape, and do not rely on color alone.
- Source: https://developer.apple.com/design/human-interface-guidelines/widgets
- Confidence: 6

#### [HIG-writing.1] Writing / errors, empty states, flows

- Status: GAP
- Severity: major
- Kind: required
- Rule: Error messages appear next to the problem, don't blame, say how to fix it ("Choose a password with at least 8 characters", not "Invalid password"), and avoid "oops" and "we" ("Unable to load content", not "We're having trouble…").
- Evidence: BrandEmptyState includes a next action. A full oops and click sweep was not finished. Some errors use localizedDescription.
- Remediation: Say how to fix the error and use tap, not click.
- Source: https://developer.apple.com/design/human-interface-guidelines/writing
- Confidence: 5

Advisory:

- HIG-action-button.1 — FAIL: Action button / App Shortcuts
- HIG-accessibility.9 — GAP: Accessibility / Cognitive / Assistive Access
- HIG-action-button.2 — GAP: Action button / iOS
- HIG-activity-views.1 — GAP: Activity views / sharing
- HIG-app-icons.2 — GAP: App icons / alternate icons
- HIG-app-shortcuts.2 — GAP: App Shortcuts / responses and discoverability
- HIG-apple-in-app-purchase.4 — GAP: Apple In-App Purchase / offer codes and Family Sharing
- HIG-boxes.1 — GAP: Boxes / grouping (SwiftUI `GroupBox`)
- HIG-branding.1 — GAP: Branding / restraint
- HIG-buttons.2 — GAP: Buttons / iOS in-button activity
- HIG-camera-control.1 — GAP: Camera Control / capture controls
- HIG-camera-control.2 — GAP: Camera Control / launch from anywhere
- HIG-collections.1 — GAP: Collections / layout and changes
- HIG-disclosure-controls.1 — GAP: Disclosure controls / iOS
- HIG-edit-menus.1 — GAP: Edit menus / iOS
- HIG-gauges.1 — GAP: Gauges / Best practices
- HIG-home-screen-quick-actions.1 — GAP: Home Screen quick actions / Best practices
- HIG-icons.1 — GAP: Icons / Standard icons
- HIG-icons.2 — GAP: Icons / Best practices
- HIG-image-views.1 — GAP: Image views / Best practices + Content
- HIG-keyboards.1 — GAP: Keyboards / Best practices + Custom keyboard shortcuts
- HIG-labels.1 — GAP: Labels / Best practices
- HIG-lists-and-tables.2 — GAP: Lists and tables / Style
- HIG-live-activities.3 — GAP: Live Activities / Best practices + Choosing colors + Offering interactivity
- HIG-materials.1 — GAP: Materials / Standard materials + iOS, iPadOS
- HIG-menus.1 — GAP: Menus / Labels + Icons + Organization + Submenus + Toggled items
- HIG-menus.2 — GAP: Menus / iOS, iPadOS
- HIG-offering-help.1 — GAP: Offering help / Best practices + Creating tips
- HIG-page-controls.1 — GAP: Page controls / Best practices + Customizing indicators + iOS
- HIG-pickers.1 — GAP: Pickers / Best practices + iOS, iPadOS
- HIG-pop-up-buttons.1 — GAP: Pop-up buttons / mutually exclusive choice
- HIG-printing.1 — GAP: Printing / discoverability (iOS)
- HIG-privacy.3 — GAP: Privacy / location button
- HIG-progress-indicators.2 — GAP: Progress / refresh control (iOS)
- HIG-scroll-views.3 — GAP: Scroll views / automatic scrolling
- HIG-searching.2 — GAP: Searching / Spotlight and Quick Look
- HIG-sheets.2 — GAP: Sheets / detents and grabber (iPhone)
- HIG-snippets.1 — GAP: Snippets / size, labels, legibility
- HIG-steppers.1 — GAP: Steppers / visible value
- HIG-tab-bars.2 — GAP: Tab bars / icons and color (iOS, Liquid Glass)
- HIG-text-fields.2 — GAP: Text fields / Clear button and end images (iOS)
- HIG-text-views.1 — GAP: Text views / legibility and selectable text
- HIG-toggles.1 — GAP: Toggles / switch vs button toggle (iOS)
- HIG-toolbars.1 — GAP: Toolbars / titles
- HIG-toolbars.3 — GAP: Toolbars / actions, primary action, grouping

### Idea

#### [IDEA-1] Idea / a noticed gap

- Status: GAP
- Severity: major
- Kind: required
- Rule: `00-market.md` §The idea, Noticed, names a gap the builder has seen and where they saw it. A category with no observed gap does not pass.
- Evidence: `idea_check.py /Users/nuclearisotope/Desktop/Personal/NoMarkup/ios --stage G0` printed `idea FAIL no docs/studio/00-market.md` (exit 1). Same for the monorepo root. `docs/pitch.md` §The Problem and `docs/one-pager.md` describe static local listings and DM haggling, but there is no Noticed line in the required section.
- Remediation: Paste `idea_check.py --template` into `00-market.md` and write Noticed with the gap and the place it was seen, before TAM or a feature list. Do not pass on the pitch alone.
- Source: http://paulgraham.com/startupideas.html
- Confidence: 9

#### [IDEA-2] Idea / depth for a narrow set

- Status: GAP
- Severity: major
- Kind: required
- Rule: Who wants it now names a small set of people who would use a crude version this week, and Instead names what they do today. A crowd that might use it someday does not pass.
- Evidence: No Who wants it now or Instead lines. `idea_check.py --stage G0` exit 1. Pitch and one-pager speak to homeowners and contractors as broad categories, and the investor FAQ uses large market sizes, which is the failure mode (a crowd, not this week’s set).
- Remediation: Name the narrow set and the current substitute (what they do this week) in those two lines. Do not use a TAM count as the set.
- Source: http://paulgraham.com/startupideas.html
- Confidence: 9

#### [IDEA-3] Idea / organic, or a reason the builder can see it

- Status: GAP
- Severity: major
- Kind: required
- Rule: If the builder is not the user, Noticed must say how they saw the gap: they did the job, or they sat with someone who does.
- Evidence: No Noticed line. Pitch and one-pager do not record that observation. `idea_check.py --stage G0` exit 1.
- Remediation: Add that observation to Noticed, or record doing the job under Manual (IDEA-5). Do not leave the first user unnamed.
- Source: http://paulgraham.com/organic.html
- Confidence: 9

#### [IDEA-4] Idea / the tedious work stays in scope

- Status: GAP
- Severity: major
- Kind: required
- Rule: Schleps names the tedious work on the path (payments, fraud, regulation, sales, or a partner’s broken process) as v1 scope or an explicit later item the user accepted. It is not a reason to switch ideas. Price and legal stay user decisions.
- Evidence: No Schleps line. `idea_check.py --stage G0` exit 1. The product already contains escrow, fraud heuristics, license capture, and disputes, but that work is not named in the required line and is not tied to a user-accepted later list.
- Remediation: Write Schleps for payments, fraud, disputes, and licensing. Point legal and price items at GTM-7 and GTM-12 instead of treating them as decided.
- Source: http://paulgraham.com/schlep.html
- Confidence: 8

#### [IDEA-5] Idea / the whole job, with hand work allowed

- Status: GAP
- Severity: major
- Kind: required
- Rule: v1 does the whole job for the set in Who wants it now. Manual names hand work for the first users. `01-brief.md` lists that job as v1 and lists automation of the Manual line as out of scope.
- Evidence: No Manual line and no `docs/studio/01-brief.md`. `idea_check.py --stage G0` exit 1. `docs/compliance/v1-ios-product-cut.md` is an iOS scope cut, not the brief’s Manual / out-of-scope pair. Investor FAQ says local pickup only and no shipping in v1, which is a product cut, not the required hand-work line.
- Remediation: In `01-brief.md`, list the narrow job as v1 and list automation of recruiting, setup, and support as out of scope until those users are on the crude version.
- Source: http://paulgraham.com/ds.html
- Confidence: 9

#### [IDEA-6] Idea / niche on purpose, or a next group of the same shape

- Status: GAP
- Severity: major
- Kind: required
- Rule: Next group is either “niche on purpose” or the next set with the same job. A narrow start is not described as a giant market. Features for the next group stay out of v1.
- Evidence: No Next group line. `idea_check.py --stage G0` exit 1. `docs/investor-faq.md` TAM and `docs/one-pager.md` talk about a large services and goods market and an Austin pilot without the required next-group line. v1 feature breadth is not gated by that line.
- Remediation: Choose “niche on purpose” or name the next group, and keep that group’s features out of v1. Point growth targets at GTM-13 after the user decides. Do not describe a single-metro tool as a giant market.
- Source: http://paulgraham.com/startupideas.html
- Confidence: 9

### On-device ML

#### [ML-1] Choose and record the on-device ML runtime

- Status: GAP
- Severity: major
- Kind: required
- Rule: Choose the on-device ML runtime in the order Foundation Models, then Core AI or Core ML, then MLX Swift, and record the reason in the design doc.
- Evidence: `Applies_when: on_device_ml | uses_ai`. `on_device_ml` is false. `uses_ai` aliases to `apple_intelligence`, which is implied by Visual Intelligence only. No `import MLX`, `import CoreAI`, or `import CoreML`. No design-doc row naming the feature, runtime, rejected alternatives, and device reach. The shipped path is system Visual Intelligence plus string match on the local snapshot, not a bundled model.
- Remediation: Add one design-doc row: feature visual search of listings; runtime system Visual Intelligence (`SemanticContentDescriptor.labels`); rejected Foundation Models / Core AI / MLX (no generative or custom-model task, no weight download); reach iOS 26 devices with the framework, otherwise the feature is absent. Do not ship a weight file for this.
- Source: https://developer.apple.com/documentation/foundationmodels/running-a-core-ai-model-in-a-foundation-models-session
- Confidence: 8

#### [ML-2] Availability and fallback chain

- Status: GAP
- Severity: major
- Kind: required
- Rule: Every AI feature has an explicit fallback chain, computed at runtime and re-checked on foreground, and never presents MLX as Apple Intelligence.
- Evidence: No `SystemLanguageModel.default.availability`, `resolveBackend`, or `FixedDeviceCapabilities` tests. Visual Intelligence is omitted below iOS 26 and returns `[]` when labels or the snapshot are empty (`ListingVisualSearchQuery.values`). Nothing re-checks model availability on foreground because no model is loaded. No “Apple Intelligence” string on a model path (`IOS-AI.18`). The required chain (system model, then open weights, then hide with a reason) is not implemented because there is no LLM feature — the registry still applies via `uses_ai`.
- Remediation: If no language-model feature is added, record the chain as “Visual Intelligence on iOS 26 with the framework, otherwise the camera search entry is absent; no server LLM.” If a model feature is added, implement `resolveBackend` and the four `FixedDeviceCapabilities` cases in the registry check.
- Source: https://developer.apple.com/documentation/foundationmodels
- Confidence: 8

### Patterns

#### [PAT-12] Modern onboarding

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: When an account is first needed, offer Sign in with Apple first, then a one-time skippable passkey, and ask age with Declared Age Range instead of a birthday, falling back to two explicit age buttons.
- Evidence: `SignInWithAppleButton` exists (`NoMarkup/Auth/SignInWithAppleButton.swift`). Passkeys exist (`PasskeyAuth.swift`) but are not a one-time post-sign-in offer in an onboarding state machine. `requestAgeRange` / `DeclaredAgeRange` are absent. `AgeGateView` collects a `DatePicker` “Date of birth” and submits it to the server. Unauthenticated users hit `LoginView` before any browsing (a sign-in wall).
- Remediation: Browse before account; put Sign in with Apple first; offer a passkey once; replace the birthdate wheel with `requestAgeRange(ageGates: 18)` and a two-button self-attest fallback.
- Source: https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple
- Confidence: 9

#### [PAT-14] Skeleton loading

- Status: FAIL
- Severity: major
- Kind: recommended
- Rule: Known-shape lists show a static placeholder in that shape, with a specific VoiceOver label, and no shimmer.
- Evidence: `BrandCatalogSkeleton` draws `BrandSkeletonBar` rows, and several screens pass a specific label to `BrandLoadingScreen`. `BrandSkeletonBar.onAppear` runs a `repeatForever` linear gold shimmer, which this pattern forbids. `.redacted(reason: .placeholder)` is unused. Many other screens still use a bare `ProgressView()` (`ContractDetailView`, `BlockedUsersView`).
- Remediation: Delete the shimmer, redact real row shapes, and give every list load one specific “Loading …” label.
- Source: https://developer.apple.com/design/human-interface-guidelines/loading
- Confidence: 8

#### [PAT-4] Comparison sheet with honest badges

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Options for one choice are rows in a sheet with the same facts, and any badge is a rule the app can state.
- Evidence: No `ComparisonRow` and no sheet of grouped offers with a code-backed “Lowest price” badge. Bids are per-job lists, not a comparison sheet with identical columns.
- Remediation: For choosing among bids or delivery options, present one sheet of rows (name, timing, price) and derive badges from the data (`id == cheapest.id`).
- Source: https://developer.apple.com/design/human-interface-guidelines/sheets
- Confidence: 7

#### [PAT-5] Commit bar

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: A decision sheet ends with a payment row and one full-width button whose label names the commitment and the price, placed below the scroll view.
- Evidence: No `CommitBar`. Checkout goes through Stripe (`RailACheckout`, `PaymentMethodsView`) rather than a sheet bar labelled with the amount. `safeAreaInset` is used (16 hits), including the offline banner, not a commit bar.
- Remediation: On the bid or buy sheet, pin one button under the scroll content, labelled with the action and the live total, above a payment-method row.
- Source: https://developer.apple.com/design/human-interface-guidelines/buttons
- Confidence: 7

Advisory:

- PAT-1 — GAP: One-question home with context chips
- PAT-10 — GAP: Help that starts from recent orders
- PAT-11 — GAP: Inbox filters
- PAT-13 — GAP: One coach mark at a time
- PAT-2 — GAP: Recents one tap away
- PAT-3 — GAP: Category tiles
- PAT-6 — GAP: Meeting-point confirmation
- PAT-7 — GAP: Rebook / reorder from activity
- PAT-8 — GAP: Booking reassurance cards
- PAT-9 — GAP: Account tiles and checkup progress card

### Stripe

#### [STRIPE-5] Server-side intents / PaymentIntent or Checkout Session created in the Worker

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: The server creates the PaymentIntent with amount and currency taken from the stored order, never from the client body.
- Evidence: Goods charges use `order.AmountCents` plus server fee and tax (`ChargeListingWinner` in `services/payment/internal/service/listing_charge.go`, idempotency key prefixed `listing-charge:` plus the order id). Service `CreatePayment` (`services/payment/internal/service/service.go`) accepts `input.AmountCents` from `createPaymentRequest` (`gateway/internal/handler/payment.go`) and rejects only an amount above `contract.AmountCents` (and a cumulative over-cap). A client may post one cent on a larger one-shot contract. iOS sends `contract.amountCents` (`ContractDetailView.payAndHoldEscrow`) but the server does not require equality. Currency is hard-coded to USD in `StripeService.CreatePaymentIntent`.
- Remediation: For a one-shot contract, set the PaymentIntent amount only from the contract or milestone row and ignore the client amount. Keep the goods path on the order amount.
- Source: https://docs.stripe.com/payments/accept-a-payment?payment-ui=mobile&platform=ios
- Confidence: 9

#### [STRIPE-7] Fulfilment from webhooks, not client callbacks

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Ship, book, or credit only from the payment-succeeded webhook (or the Checkout equivalent); the app’s completed callback may only show a pending state and then read server status.
- Evidence: The payment-succeeded event is handled in `dispatchWebhookEvent` (`services/payment/internal/service/webhook.go`). Listing tests state that attaching a PaymentIntent does not fund escrow. Service pay does the opposite: `ContractDetailView.payAndHoldEscrow` calls `processContractPayment` immediately after `presentPaymentSheet` returns (which resumes only on completed). `ProcessPayment` captures the PaymentIntent and moves the row to escrow (`services/payment/internal/service/service.go`) without waiting for the webhook. `MyOrdersView.pay` and `ListingDetailView.buyNow` set a “Payment complete — funds are held in escrow” string on sheet success before a reload.
- Remediation: After the sheet completes, show a confirming state and read order or payment status. Move service escrow to the verified payment-succeeded webhook (capture may stay server-side, but not as a client success signal). Keep goods settlement on the verified webhook.
- Source: https://docs.stripe.com/payments/accept-a-payment?payment-ui=mobile&platform=ios
- Confidence: 9

#### [STRIPE-11] SCA / 3D Secure

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Use PaymentIntents, SetupIntents, or Checkout so PaymentSheet can run 3DS; every flow needs the return URL and URL callback; off-session authentication failures must bring the customer back to the app.
- Evidence: No legacy Charges create call in the payment service. PaymentIntents enable automatic payment methods. The return URL is set (STRIPE-6) but the Stripe URL callback is absent, so a bank redirect cannot re-enter the app. No sandbox log for the authentication-required, 3DS-required, 3DS-then-decline, or no-authentication test cards. `ErrAuthenticationRequired` exists in `charge_outcome.go` for off-session, and the recurring path can fall back to a client secret, but the URL callback is still missing.
- Remediation: Wire the Stripe URL callback, then record a sandbox run of the four documented 3DS test cards through PaymentSheet on a service payment and a goods payment.
- Source: https://docs.stripe.com/payments/3d-secure/authentication-flow
- Confidence: 8

#### [STRIPE-6] iOS SDK / PaymentSheet integration

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Use StripePaymentSheet via SwiftPM, set the merchant display name and a custom-scheme return URL, present PaymentSheet, switch on every result, and route incoming URLs to the Stripe URL callback.
- Evidence: SPM pin `stripe-ios` 24.25.0 product `StripePaymentSheet` (`ios/NoMarkup.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`, `project.pbxproj`). `RailACheckout.makeConfiguration` sets `merchantDisplayName`, return URL `nomarkup://stripe-redirect`, and delayed payment methods off. `CFBundleURLSchemes` includes `nomarkup` (`Info.plist`). `present` switches completed, canceled, and failed. `NoMarkupApp.onOpenURL` only calls `deepLinks.handle`; `DeepLinkRouter` returns nil for the stripe-redirect host. No Stripe URL-callback call in the iOS tree. Presentation is `sheet.present(from:)`, not `PaymentSheet.PaymentButton`. `NSCameraUsageDescription` exists but does not mention card scanning.
- Remediation: In `onOpenURL`, pass the URL to the Stripe URL callback before deep-link routing, and keep `nomarkup://stripe-redirect` as the return URL.
- Source: https://docs.stripe.com/payments/accept-a-payment?payment-ui=mobile&platform=ios
- Confidence: 9

#### [STRIPE-1] App Store gate / payment rail per item (blocker)

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: Stripe PaymentSheet or Apple Pay may appear only for real-world goods and services, person-to-person services, tips, and the listed web-side cases; digital unlocks use StoreKit 2, and no Stripe flow may unlock in-app functionality outside the US link-out rows.
- Evidence: Goods and service escrow use `RailACheckout.presentPaymentSheet` (`ios/NoMarkup/Core/RailACheckout.swift`) from `ListingDetailView.buyNow`, `MyOrdersView.pay`, and `ContractDetailView.payAndHoldEscrow`. `Info.plist` `StoreKitEnabled` is false; `PlanLimitsView` says paid digital tiers are not sold and there is no web checkout. `AppConfig.manageSubscriptionURL` has no call site. Tips are a completed-job gratuity with a zero platform fee (`PaymentService.ChargeContractTip`). Counter-evidence: `createListingPromotion` / `confirmListingPromotion` (`ios/NoMarkup/Core/APIClient+Commerce.swift`, compiled only for DEBUG) charge Stripe to set `is_promoted` (in-app placement). Gateway `promoted_listings.go` documents the same boost. Web Stripe Billing still exists for digital tiers (`subscription.go`) on accounts the app can use.
- Remediation: Keep promotion and Pro/Business purchase out of the Release binary. Delete or StoreKit-gate the promote endpoints before removing the DEBUG compile gate. Do not unlock paid caps in the app from a Stripe subscription unless the same items are sold with StoreKit.
- Source: https://docs.stripe.com/mobile/digital-goods/checkout
- Confidence: 8

#### [STRIPE-8] Webhooks / signing-secret verification and delivery behavior

- Status: RISK
- Severity: blocker
- Kind: required
- Rule: Verify every event with the raw body, the Stripe signature header, and the endpoint secret; use the v1 scheme and a non-zero timestamp tolerance; dedupe by event id; respond quickly; do not trust event order.
- Evidence: The Stripe Go v82 webhook constructor uses a default tolerance of 300 seconds (`webhook/client.go` in the module cache), not zero. The payment path rejects bad signatures (`webhook_test.go`) and dedupes the event id. The subscription path calls the same validator, then applies invoice-paid and subscription lifecycle updates without a unique event-id insert (`subscription_server.go`). Work runs before the HTTP 200. No zero-tolerance assignment in the payment service.
- Remediation: Persist the subscription event id with a unique constraint and return 200 on duplicates. Keep the 300-second tolerance.
- Source: https://docs.stripe.com/webhooks
- Confidence: 8

#### [STRIPE-13] Subscriptions for real-world services / test clocks

- Status: RISK
- Severity: major
- Kind: required
- Rule: Stripe Billing is only for real-world services and the web-side enterprise case; subscriptions to app content use StoreKit, and renewals are exercised with test clocks.
- Evidence: `SubscriptionService.HandleSubscriptionWebhook` sets status active on invoice paid and handles subscription updated, subscription deleted, and invoice payment failed (`services/payment/internal/service/subscription.go`). Tiers carry bid caps and feature flags (in-app capability). iOS does not start that purchase (`StoreKitEnabled` false; no test-clock log in tree). The audit profile says web digital tiers stay outside the iOS purchase UI.
- Remediation: Do not let a Stripe active subscription raise in-app limits unless the same subscription is an App Store product. If Billing remains web-only, keep it off the iOS purchase surface and add test-clock runs for trial end, renewal, and renewal failure.
- Source: https://docs.stripe.com/billing/testing/test-clocks
- Confidence: 7

#### [STRIPE-21] Fraud / card-testing protection on the intent endpoint

- Status: RISK
- Severity: major
- Kind: required
- Rule: PaymentIntent creation requires a session, an App Attest assertion where supported, per-user rate limits, and a server amount cap; do not expose an unauthenticated create-any-amount endpoint.
- Evidence: `CreatePayment` requires gateway claims and checks the caller is the contract customer. `/api/v1/payments` is `TierStrict` plus a per-user key (CF-12). There is no App Attest assertion. The service amount is client-chosen up to the contract total (STRIPE-5), so an authenticated caller can open a one-cent PaymentIntent. No test that fifty rapid creates return 429. Goods amounts come from the order row. Radar’s default rules are not visible in the repo.
- Remediation: Reject service creates whose amount is not the server contract or milestone amount, and keep the strict per-user limiter on that route. App Attest is optional only if the session and amount checks are closed.
- Source: https://docs.stripe.com/disputes/prevention/card-testing
- Confidence: 8

#### [STRIPE-9] Idempotency keys on every Stripe write

- Status: RISK
- Severity: major
- Kind: required
- Rule: Every Stripe write uses an idempotency key derived from the business operation or a stored UUID, with no personal data in the key.
- Evidence: `TestStripeMutatingCalls_SendDeterministicIdempotencyKey` covers PaymentIntent create and capture, transfer, refund, and payout. `stripeIdempotencyKey` hashes its parts so an email is not sent raw. `AccountLink` create intentionally has no key (`GetOnboardingLink`). If the client omits the idempotency header, `CreatePayment` mints a random UUID (`service.go`) and the gateway does the same (`payment.go`). iOS `idempotencyHeader` stores a process-memory UUID per operation (`APIClient.swift`), so a cold restart mints a new Stripe key. Goods charges use a key prefixed with the listing-charge scope and the order id.
- Remediation: Derive service PaymentIntent keys from the contract or milestone id on the server, and ignore a missing client header instead of minting a random key. Leave AccountLink un-keyed only if a retry must mint a fresh link.
- Source: https://docs.stripe.com/api/idempotent_requests
- Confidence: 8

#### [STRIPE-12] Test mode only during the build

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Until go-live, every Stripe call uses sandbox keys; the Release publishable key comes from the server or a per-configuration xcconfig, never a hard-coded live key.
- Evidence: No live-mode publishable, restricted, or secret key string in the tree. Committed `StripePublishableKey` is empty, so a store build has no key unless `NOMARKUP_STRIPE_PUBLISHABLE_KEY` is injected outside the repo. The server does not return the publishable key with the PaymentIntent (`STPAPIClient` is set only from `AppConfig`). No Debug versus Release xcconfig split. Whether the deployed payment service is in live mode was not checked (no live Stripe calls).
- Remediation: Ship a test publishable key in Debug and a live publishable key only in the Release archive via an uncommitted xcconfig or a server field. Fail checkout when the key mode does not match the build configuration.
- Source: https://docs.stripe.com/sandboxes
- Confidence: 7

#### [STRIPE-20] MCP / live-mode protocol (human confirmation)

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Any live-mode Stripe read or write needs a per-call confirmation naming account, mode, method, and effect; sandbox calls do not, after the brief is approved.
- Evidence: `docs/studio/stripe-actions.md` not found. No live Stripe call was made in this audit. Whether the deployed account is live was not checked.
- Remediation: Before swapping in the live publishable key and the live webhook secret, run the go-live checklist with the account owner present, including one low-value purchase and refund.
- Source: https://docs.stripe.com/mcp
- Confidence: 7

#### [STRIPE-14] Refunds and cancellations

- Status: GAP
- Severity: major
- Kind: required
- Rule: Refund only from the server or Dashboard, with an idempotency key and business-rule checks, and handle the refund-failed event.
- Evidence: No refund-create call under `ios/`. `StripeService.CreateRefund` requires an idempotency key. `PaymentService.CreateRefund` is the gRPC path (actor tests in `escrow_actor_test.go`). The webhook switch handles charge-refunded only; the refund-failed event is not a case in `dispatchWebhookEvent`.
- Remediation: Subscribe to the refund-failed event and alert when a refund does not return to the original method. Keep refund creation on the payment service.
- Source: https://docs.stripe.com/refunds
- Confidence: 8

#### [STRIPE-18] MCP / connecting and authenticating the Stripe MCP server

- Status: GAP
- Severity: major
- Kind: required
- Rule: Connect Stripe MCP with OAuth limited to sandboxes during the build, or an agent key via an env reference; do not paste a secret key into MCP config.
- Evidence: No MCP config for Stripe and no OAuth-grant record in the repo. This audit made no Stripe API calls. The secret-key scan did not find an MCP config embedding a Stripe secret.
- Remediation: If Stripe MCP is added, use OAuth sandbox-only until go-live, and reference an agent key from the environment rather than inlining it.
- Source: https://docs.stripe.com/mcp
- Confidence: 7

#### [STRIPE-19] MCP / tool map: which Stripe MCP tool does what (read vs write)

- Status: GAP
- Severity: major
- Kind: required
- Rule: Use Stripe MCP for setup and lookup, not runtime charges; sandbox writes are allowed after the brief, and live writes need a per-call confirmation. Mirror created ids into a studio objects note.
- Evidence: `docs/studio/stripe-objects.md` not found. No tool-call log. Runtime charges go through the Go payment service, not MCP.
- Remediation: Keep price and webhook setup in the payment service’s own config. If MCP creates live prices, log the confirmation and the object ids.
- Source: https://docs.stripe.com/mcp
- Confidence: 8

#### [STRIPE-22] Privacy and review disclosure for Stripe

- Status: GAP
- Severity: major
- Kind: required
- Rule: The privacy policy names Stripe and the data shared; App Privacy declares purchases and financial info; review notes explain the real-world rail; the Stripe SDK privacy manifest is in the resolved package.
- Evidence: The privacy page names Stripe and payment data (`web/src/app/(public)/privacy/page.tsx`). App `PrivacyInfo.xcprivacy` includes payment info and purchase history (linked, not tracking). No App Review notes file under `ios/`. The Stripe package privacy manifest was not vendored in the repo (SPM pin only, version 24.25.0).
- Remediation: Add review notes that jobs and local goods use PaymentSheet and Apple Pay under guideline 3.1.3(e), digital tiers are not sold in this binary, and attach a sandbox buyer. Confirm the Stripe 24.25.0 privacy manifest is copied into the archive.
- Source: https://docs.stripe.com/payments/3d-secure/authentication-flow
- Confidence: 7

Advisory:

- STRIPE-15 — GAP: Receipts and confirmations
- STRIPE-23 — GAP: Agent tooling / Stripe agent plugin, skills and docs-as-Markdown

### Swift

#### [SWIFT-5] Global and static mutable state

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Every global or static `var` is a `Sendable` `let`, isolated to a global actor, or held in an `actor` or `Mutex`; `nonisolated(unsafe)` is allowed only when a named lock guards every access.
- Evidence: Shipping `nonisolated(unsafe)` stored state with no lock named in the declaration comment: `AppConfig.didLogInsecureBase` (`NoMarkup/Core/AppConfig.swift`, read/written with no lock); `ActionAuditProbe.installed` (`NoMarkup/Core/ActionAuditProbe.swift`, DEBUG, no lock); `AuthViewModel.sessionExpiredObserver` (`NoMarkup/Auth/AuthViewModel.swift`, comment cites `deinit`, not a lock). `SpotlightIndex` (`NoMarkup/Core/SpotlightIndex.swift`) locks `lastDonationKey` with `donationLock` but writes `bridgeInstalled` outside that lock, and the declarations do not name the lock in a `// SAFETY:` comment. `static let shared` on `@MainActor` types (`NetworkMonitor`, `PushRegistration`, `DeepLinkRouter`, `StoreKitManager`) and on `actor APIClient` / `actor SensitiveMediaScanCache` is isolated. `ClientActionLog.shared` is a non-`@MainActor` class (SWIFT-6).
- Remediation: Replace the flags with `@MainActor` storage or `OSAllocatedUnfairLock`/`Mutex` (iOS 18, behind `#available` on this 17.0 target). Document the lock on `SpotlightIndex` and take it around `bridgeInstalled`. Isolate `AuthViewModel.sessionExpiredObserver` to the main actor and remove the observer from an explicit `stop()` instead of `nonisolated(unsafe)` in `deinit`.
- Source: https://github.com/swiftlang/swift-evolution/blob/main/proposals/0412-strict-concurrency-for-global-variables.md
- Confidence: 9

#### [SWIFT-1] Studio concurrency profile / app target

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every app target uses Swift 6, default actor isolation `MainActor`, and approachable concurrency (`NonisolatedNonsendingByDefault` and `InferIsolatedConformances`).
- Evidence: `ios/NoMarkup.xcodeproj/project.pbxproj` project Debug/Release and targets NoMarkup, NoMarkupWidget, NoMarkupTests, and NoMarkupUITests set `SWIFT_VERSION = 6.0`; native targets also set `SWIFT_STRICT_CONCURRENCY = complete`. The same file has no `SWIFT_DEFAULT_ACTOR_ISOLATION`, `SWIFT_APPROACHABLE_CONCURRENCY`, `SWIFT_UPCOMING_FEATURE_NONISOLATED_NONSENDING_BY_DEFAULT`, or `SWIFT_UPCOMING_FEATURE_INFER_ISOLATED_CONFORMANCES`. No `OTHER_SWIFT_FLAGS` and no xcconfig.
- Remediation: On the app and widget targets set `SWIFT_VERSION = 6.0`, `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`, and `SWIFT_APPROACHABLE_CONCURRENCY = YES`. Leave networking/parsing types explicit `nonisolated` (SWIFT-2) before flipping the default.
- Source: https://github.com/swiftlang/swift-evolution/blob/main/proposals/0466-control-default-actor-isolation.md
- Confidence: 9

#### [SWIFT-12] Unstructured tasks are owned, named and never silently throwing

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Every `Task { }` outside `.task` is stored and cancelled, or marked `// fire-and-forget:`; a throwing unstructured task handles its error; long-lived tasks use `Task(name:)`.
- Evidence: Scan of `NoMarkup/` and `NoMarkupWidget/`: about 441 `Task { }` sites are not assigned, 17 are stored (`searchTask`, websocket `receiveTask` / `pingTask` / `reconnectTask`, `StoreKitManager.updatesTask`, `JobSiteLocationProvider.timeoutTask`), zero `// fire-and-forget:` comments, and zero `Task(name:)`. Button and `onChange` sites such as `JobsView` `Task { await load(reset: true) }` are unstructured. `Task.detached` in `ImageUploader`, `ModeratedAsyncImage`, `MessagesView`, and `VerificationDocumentsView` has a nearby off-main comment only on the uploader path.
- Remediation: Keep UI work in `.task` / `.refreshable` where the view already has one (`JobsView.listRoot`). Store and cancel debounce and poll tasks (some chat and socket tasks already do). Name long-lived tasks. Do not introduce `Task { try await ... }` whose value is discarded.
- Source: https://docs.swift.org/compiler/documentation/diagnostics/no-use-throwing-unstructured-task
- Confidence: 8

#### [SWIFT-13] Cooperative cancellation and protected cleanup

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Cancellation is cooperative; `CancellationError` is filtered before user-facing error handling, and a cancelled operation does not show an error alert.
- Evidence: `JobsView.listRoot` uses `.task(id: segment) { await load(reset: true) }`, and `load` assigns `errorMessage = error.localizedDescription` with no `catch is CancellationError` (`NoMarkup/Features/JobsView.swift`). `MarketplaceView.load` does the same (`NoMarkup/Features/MarketplaceView.swift`). Only three `CancellationError` filters exist: `MessagesView` server search, `TrustScoreView`, and `ModeratedAsyncImage`. Many loops do poll `Task.isCancelled` (chat, job detail, sockets). `withTaskCancellationShield` is absent, which is correct on an iOS 17 deployment (the API is iOS 27). `StoreKitManager.listenForTransactions` writes `lastErrorMessage` from a cancelled `for await` without filtering cancellation.
- Remediation: In shared load helpers, `catch is CancellationError { return }` before assigning `errorMessage` / `loadMoreError`. Apply the same filter in `StoreKitManager`.
- Source: https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency
- Confidence: 8

#### [SWIFT-6] Sendable conformance ladder / avoiding `@unchecked Sendable`

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Prefer a value type, global-actor isolation, an actor, or a `final class` of `let` `Sendable` properties; `@unchecked Sendable` only with a `// SAFETY:` comment and real internal synchronization, never on a view model.
- Evidence: Three app hits, none with `// SAFETY:`: `final class KeychainTokenStore: @unchecked Sendable` (`NoMarkup/Core/KeychainTokenStore.swift`) stores only `let service: String` and has no lock, so a checked `Sendable` conformance fits; `final class ClientActionLog: ObservableObject, @unchecked Sendable` (`NoMarkup/Core/ClientActionLog.swift`) is an observable model whose `NSLock` covers `record` but not `clear()` or `debugSummary()`; `private struct ActivityUpdateBox: @unchecked Sendable` (`NoMarkup/Core/AuctionLiveActivityController.swift`) boxes a non-Sendable `Activity` to cross isolation. Test-only `RequestLog` in `NoMarkupTests/APIClientTests.swift` is the same pattern.
- Remediation: Mark `KeychainTokenStore` checked `Sendable`. Isolate `ClientActionLog` to `@MainActor` and drop `@unchecked`. Keep `Activity` updates on the main actor instead of an unchecked box, or document a real lock if the box must cross actors.
- Source: https://www.swift.org/migration/documentation/swift-6-concurrency-migration-guide/commonproblems
- Confidence: 9

#### [SWIFT-8] Protocol conformance isolation

- Status: RISK
- Severity: major
- Kind: recommended
- Rule: Conform a `@MainActor` type to a nonisolated protocol with an isolated conformance (`extension VM: @MainActor Describes`), or mark the protocol `@MainActor`; `@preconcurrency` conformances are only for unmigrated SDK protocols and must be commented.
- Evidence: No `extension T: @MainActor` and no `: @preconcurrency Protocol` in app sources. Delegate requirements are `nonisolated` and hop (SWIFT-9), which matches off-main callbacks. `PasskeyAuth.presentationAnchor(for:)` (`NoMarkup/Auth/PasskeyAuth.swift`) is `nonisolated` and reads `UIApplication` windows via `MainActor.assumeIsolated` with no comment citing the delivery thread. That is the registry failure mode for a nonisolated witness touching isolated state.
- Remediation: If AuthenticationServices calls `presentationAnchor` on the main thread, cite that in a comment and keep `assumeIsolated` (SWIFT-10). Otherwise hop without assuming isolation, or use an isolated conformance once the SDK requirement is main-actor.
- Source: https://github.com/swiftlang/swift-evolution/blob/main/proposals/0470-isolated-conformances.md
- Confidence: 6

#### [SWIFT-3] `@concurrent` / opt-in parallelism

- Status: GAP
- Severity: major
- Kind: required
- Rule: With `NonisolatedNonsendingByDefault`, mark every CPU-heavy or blocking async function `@concurrent` or keep it on an `actor`, so a view-model caller does not run it on the main actor.
- Evidence: Zero `@concurrent` in `NoMarkup/` and `NoMarkupWidget/`. Approachable concurrency is off (SWIFT-1), so the caller-actor rule is not in effect. Off-main work that does exist is `Task.detached` inside `ImageUploader.prepareJPEG(from:)` (`NoMarkup/Core/ImageUploader.swift`) and `ModeratedAsyncImage.cgImage(from:)` (`NoMarkup/Core/ModeratedAsyncImage.swift`), plus JSON decoding on `actor APIClient` (`NoMarkup/Core/APIClient.swift`). Those async wrappers are neither `@concurrent` nor themselves actors. No Time Profiler trace.
- Remediation: After enabling SWIFT-1, mark the JPEG/decode async wrappers `@concurrent` (keep the synchronous `nonisolated` helpers) and confirm they stay off the main thread.
- Source: https://github.com/swiftlang/swift-evolution/blob/main/proposals/0461-async-function-isolation.md
- Confidence: 7

#### [SWIFT-9] Unmigrated dependencies and dynamic isolation crashes

- Status: GAP
- Severity: major
- Kind: required
- Rule: For every delegate from an unmigrated module, implement the witness `nonisolated` and hop with `Task { @MainActor in }` when the callback can be off the main thread; `@preconcurrency import` needs a comment naming the module and version.
- Evidence: Location callbacks in `JobSiteLocationProvider` and `MapLocationManager`, `PasskeyAuth` authorization completions, and `PushRegistration` `UNUserNotificationCenterDelegate` methods are `nonisolated` and hop with `Task { @MainActor in }`. `NoMarkupAppDelegate` is not `@MainActor` and also hops. The only `@preconcurrency import` is `NoMarkupUITests/DeviceCapabilityUITests.swift` (`@preconcurrency import XCTest`) with no dependency/version comment. No `-disable-dynamic-actor-isolation` in the project. No Thread Sanitizer or `swift_task_checkIsolated` run was recorded.
- Remediation: Add the version comment on the XCTest import or drop `@preconcurrency` if the compiler no longer requires it. Run the location and notification callbacks under Thread Sanitizer once.
- Source: https://www.swift.org/migration/documentation/swift-6-concurrency-migration-guide/incrementaladoption
- Confidence: 7

Advisory:

- SWIFT-10 — FAIL: Dynamic isolation tools are migration aids, not architecture
- SWIFT-14 — FAIL: Bounded fan-out
- SWIFT-18 — FAIL: Adopt Swift 7 upcoming features now
- SWIFT-19 — FAIL: Narrow, explained warning exceptions
- SWIFT-27 — RISK: API design / case conventions and acronyms
- SWIFT-28 — RISK: API design / clarity, needless words, roles not types
- SWIFT-15 — GAP: Synchronous start when ordering matters
- SWIFT-16 — GAP: Observation outside SwiftUI
- SWIFT-25 — GAP: Closure capture ownership
- SWIFT-7 — GAP: `sending` and region-based isolation

### Technology selection

#### [TECH-13] Sign in with Apple and account deletion

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: If the app needs accounts, offer Sign in with Apple.
- Evidence: Offer and deletion exist: `NoMarkup.entitlements` `com.apple.developer.applesignin` = `[Default]`; `ios/NoMarkup/Auth/SignInWithAppleButton.swift` `SignInWithAppleButton(.signIn)` used from `LoginView`; `AccountDeletionView` calls `APIClient.requestAccountDeletion`; `AccountView` row `account.row.deleteAccount`. Google and Facebook use `ASWebAuthenticationSession` (`GoogleOAuthSession.swift`, `FacebookOAuthSession.swift`), not a Facebook SDK, beside the SIWA button. `ASAuthorizationAppleIDProvider` and `getCredentialState` are not found in tree. Apple’s page says the user identifier is checked later with `getCredentialState(forUserID:completion:)`. The check requires that symbol whenever the entitlement is present.
- Remediation: On launch, resolve the stored Apple user id with `ASAuthorizationAppleIDProvider().getCredentialState(forUserID:)` and sign the session out when the state is revoked or not found.
- Source: https://developer.apple.com/documentation/authenticationservices/implementing-user-authentication-with-sign-in-with-apple
- Confidence: 9

#### [TECH-5] Availability and authorization check

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Every adopted technology is guarded at runtime by its documented availability or authorization check before first use.
- Evidence: Sign in with Apple is adopted (`ios/NoMarkup/Auth/SignInWithAppleButton.swift` `SignInWithAppleButton`) and `getCredentialState` / `ASAuthorizationAppleIDProvider` are not found in tree. Apple: `getCredentialState(forUserID:completion:)` is how the credential state is checked later. Apple Pay buttons are drawn without a device check: `ListingDetailView.swift` `PayWithApplePayButton(.buy)` and `MyOrdersView.swift` `PayWithApplePayButton(.plain)`. `PKPaymentAuthorizationController.canMakePayments()` appears only in `ios/NoMarkupUITests/DeviceCapabilityUITests.swift`, not in app sources. `canMakePayments()` “Returns whether the user can make payments.” Guards that do exist: `BiometricGate.canEvaluatePolicy(.deviceOwnerAuthentication)`, `AuctionLiveActivityController` `ActivityAuthorizationInfo().areActivitiesEnabled`, `JobSiteLocationProvider.requestWhenInUseAuthorization` with `LocationError.permissionDenied`, `PushRegistration.confirmPrePrompt` (not at launch).
- Remediation: At launch, call `ASAuthorizationAppleIDProvider().getCredentialState(forUserID:)` for the stored Apple user id and sign out on `.revoked` or `.notFound`. Hide `PayWithApplePayButton` unless `PKPaymentAuthorizationController.canMakePayments()` is true, and keep `PaymentSheet` as the card path.
- Source: https://developer.apple.com/documentation/healthkit/setting-up-healthkit
- Confidence: 9

#### [TECH-12] Apple Pay for physical goods

- Status: FAIL
- Severity: major
- Kind: required
- Rule: When the app sells physical goods or real-world services, offer Apple Pay through PassKit with the system `PKPaymentButton` (or the SwiftUI equivalent).
- Evidence: Merchant id is present: `NoMarkup.entitlements` `com.apple.developer.in-app-payments` = `merchant.com.nomarkup.app`. Row 10b is also present: `RailACheckout.swift` `configuration.applePay = .init(merchantId:merchantCountryCode:)` when `AppConfig.applePayMerchantId` is non-empty. The app still draws the system button itself: `ListingDetailView.swift` `PayWithApplePayButton(.buy)` calls `buyNow()`, and `MyOrdersView.swift` `PayWithApplePayButton(.plain)`. `canMakePayments` is not in app sources (only `NoMarkupUITests/DeviceCapabilityUITests.swift`). No `Text("Apple Pay")` homemade label. `PayWithApplePayButton` is the SwiftUI `PKPaymentButton`. The row-10b exception applies only when the app does not draw that button.
- Remediation: Either drop `PayWithApplePayButton` and let `PaymentSheet` render Apple Pay after `configuration.applePay`, or keep the button and gate it with `PKPaymentAuthorizationController.canMakePayments()`.
- Source: https://developer.apple.com/documentation/passkit
- Confidence: 9

#### [TECH-28] Apple ecosystem first

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Anything non-Apple ships only under a recorded exception: one row in the `02-design.md` table `## Technology exceptions` that names the dependency, the need, why Apple can't meet it, the SDK's privacy-manifest status, and its signature status.
- Evidence: `Package.resolved` remote pin `stripe-ios` 24.25.0 with no `## Technology exceptions` table (`docs/studio/02-design.md` not found). `ios/NoMarkup/Info.plist` `LSApplicationQueriesSchemes` = `comgooglemaps`. `DirectionsHelper.directionsURLCandidates` puts `comgooglemaps://` first, and `openDirections` opens it when `canOpenURL` succeeds (`JobDetailView.swift` and `ContractDetailView.swift`). `MKMapItem.openInMaps(launchOptions:)` exists as `openInAppleMaps` and is not the default.
- Remediation: Add the exceptions row for `stripe-ios` / `StripePaymentSheet` (marketplace payouts, privacy manifest, signature). Make `openDirections` call `openInAppleMaps` first. Drop `comgooglemaps` unless a separate exception row names that scheme.
- Source: https://developer.apple.com/technologies/
- Confidence: 9

#### [TECH-11] StoreKit 2 for digital goods

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: All digital unlocks, consumables, and subscriptions use StoreKit 2.
- Evidence: `ios/NoMarkup/Info.plist` `StoreKitEnabled` false. `AppConfig.storeKitEnabled` reads that key and defaults false (`AppConfigTests.testStoreKitEnabledDefaultsFalse`). `StoreKitManager.startIfEnabled()` returns unless the flag is true, and behind the flag the file has `Transaction.updates`, `finish()`, and `currentEntitlements`. `PlanLimitsView` with the flag false is read-only (no Subscribe button and no web purchase path). `*.storekit` not found in tree. `StoreKitManager` also writes `UserDefaults.standard` keys `nomarkup.storekit.localEntitlement.*`, and the file says that local flag is not a server grant. `stripe-ios` is the physical-goods sheet (`RailACheckout`), not a digital-goods checkout.
- Remediation: Keep `StoreKitEnabled` false until a `.storekit` test file exists and the only grant path is a verified `Transaction` plus `finish()`. Remove the UserDefaults entitlement as an access grant. Do not add a web purchase link for Pro/Business in this binary.
- Source: https://developer.apple.com/documentation/storekit/transaction
- Confidence: 8

#### [TECH-1] Decision table is canonical

- Status: GAP
- Severity: major
- Kind: required
- Rule: Every product need in the brief maps to a row of the decision table, and the builder uses that row's technology.
- Evidence: `docs/studio/02-design.md` Technology choices table not found in tree. Imports that match decision-table rows exist in app code (`MapKit`, `CoreLocation`, `AuthenticationServices`, `PassKit`, `StoreKit`, `ActivityKit`, `WidgetKit`, `AppIntents`, `UserNotifications`, `LocalAuthentication`) plus `StripePaymentSheet`.
- Remediation: Add `docs/studio/02-design.md` with a Technology choices row per adopted need, each citing a decision-table number or an `OBS-` note and an Apple source URL.
- Source: https://developer.apple.com/technologies/
- Confidence: 8

#### [TECH-2] First-party first

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Adopt a third-party SDK only when no first-party row fits or a written requirement rules the first-party option out.
- Evidence: `ios/NoMarkup.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` pins remote `stripe-ios` 24.25.0 (`dfc152145ced35e248e6fda5a8d6eb620bfcd74f`). `project.pbxproj` `repositoryURL` `https://github.com/stripe/stripe-ios`, product `StripePaymentSheet`. Decision-table row 10b is the marketplace PSP path, so this pin is not a duplicate of rows 1–5, 7, 9, 13–14, 16–17, 21, or 28. The design-doc exception, privacy-manifest status, and signature record are not found in tree.
- Remediation: Record `stripe-ios` / `StripePaymentSheet` in `## Technology exceptions` with the row-10b need, why Apple Pay is not a payout rail, the SDK privacy manifest, and the signature check.
- Source: https://developer.apple.com/technologies/
- Confidence: 8

#### [TECH-20] Notifications and push

- Status: GAP
- Severity: major
- Kind: required
- Rule: The app works fully with notifications denied.
- Evidence: `PushRegistration.init` does not call `requestAuthorization`. `syncIfAuthorized` registers only when status is already authorized, provisional, or ephemeral. `confirmPrePrompt` requests after a value moment or settings. `NoMarkup.entitlements` `aps-environment` = `development`. `UIApplication.shared.registerForRemoteNotifications` is in `PushRegistration.swift`. No UI test named for a notifications-denied path. No Push Notifications Console delivery log in tree. No `UIBackgroundModes` (alert pushes, not silent).
- Remediation: Add a UI test that signs in with notifications denied and still reaches jobs, listings, and orders. Log one Push Notifications Console test send against the development environment before shipping, and confirm the archive export rewrites `aps-environment` to production.
- Source: https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications
- Confidence: 8

#### [TECH-27] Multi-party data

- Status: GAP
- Severity: major
- Kind: required
- Rule: When the brief needs per-pair private data (bookings, messages, reviews before publication, payouts) or transactional shared inventory (seats, slots, stock), put that data behind a first-party Worker API with D1 (CF-5, CF-9, CF-10).
- Evidence: Data ownership table not found in tree (`docs/studio/02-design.md` absent). `publicCloudDatabase`, `CKContainer`, and `CKShare` not found in `ios/`. Jobs, messages, and orders go through `APIClient` to the monorepo Go API. That is not CloudKit, and CloudKit cannot secure those pair records. It is also not the D1 mapping the PASS line requires. No authorization-test evidence for a Worker `batch()` was scored here.
- Remediation: Add a Data ownership table that maps jobs, messages, orders, bids, and listings to the Go/PostgreSQL API with caller-scoped reads and transactional inventory updates. Do not move that data to CloudKit.
- Source: https://developer.apple.com/documentation/cloudkit/ckdatabase/scope/public
- Confidence: 8

#### [TECH-29] Ecosystem opportunities checklist

- Status: GAP
- Severity: major
- Kind: required
- Rule: At G2 the design doc gets a `## Apple ecosystem opportunities` table with one row for every item TECH-30…TECH-46.
- Evidence: `docs/studio/02-design.md` not found in tree, so the opportunities table is not found. This is a shipping 1.0.0 client (`MARKETING_VERSION = 1.0.0`), not a studio draft that has not reached G2. See Skill issues for the registry’s pre-G2 sentence.
- Remediation: Add `## Apple ecosystem opportunities` with one row per TECH-30…TECH-46, each Decision `adopt`, `later`, `not applicable`, or `human`, and a reason tied to jobs, listings, orders, or messages.
- Source: https://developer.apple.com/technologies/
- Confidence: 8

#### [TECH-4] Record the decision

- Status: GAP
- Severity: major
- Kind: required
- Rule: The design doc records each technology choice at G2: the need, technology, entitlement, purpose-string text, runtime check, fallback UX, review area, min iOS, and the alternatives considered.
- Evidence: `rg` for `Technology choices` in `docs/studio/02-design.md` — file not found in tree.
- Remediation: Add `## Technology choices` with non-empty Runtime check and Fallback cells for each adopted row, including the iOS 17 deployment target.
- Source: https://developer.apple.com/technologies/
- Confidence: 9

#### [TECH-7] SwiftData default

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use SwiftData for app-owned structured data.
- Evidence: `ModelContainer` / `import SwiftData` / `import CoreData` / `import RealmSwift` / `import GRDB` not found in `ios/`. App-owned structured state is the Go API via `APIClient` plus `UserDefaults` (`BiometricGate`, `WidgetSharedStore`, `StoreKitManager` local flag). No TECH-2 exception row is recorded. No forbidden local store is present.
- Remediation: Record the persistence choice: server-owned marketplace records stay on the API; any on-device structured model uses one `ModelContainer` with a caught failure, or a written exception that names why SwiftData does not hold that data.
- Source: https://developer.apple.com/documentation/swiftdata
- Confidence: 8

Advisory:

- TECH-35 — FAIL: MapKit directions
- TECH-25 — GAP: TestFlight and consoles
- TECH-30 — GAP: Wallet passes
- TECH-34 — GAP: Look Around and place cards
- TECH-37 — GAP: Sign in with Apple, passkeys, Declared Age Range
- TECH-38 — GAP: Translation
- TECH-39 — GAP: Foundation Models
- TECH-40 — GAP: CloudKit for user-owned data
- TECH-41 — GAP: Tap to Pay on iPhone
- TECH-42 — GAP: Apple Business Connect
- TECH-44 — GAP: App Clips

### TestFlight

#### [TF-6] Beta App Review details

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Beta App Review needs contact first name, last name, phone, and email, plus a demo account when sign-in is required, and the password must come from the environment, never the repo or the notes.
- Evidence: Sign-in gates the app (`app-review-notes.md`). Not found in tree: `metadata/testflight/beta-review.json` with the four contact fields or a non-empty `demoAccountName`. The What to Test template says to use the vault and not commit the password, but `ios/NoMarkupUITests/NoMarkupUITests.swift` and `qa/scripts/qa-creds.env` commit `Password123!` for the same seed accounts named as demo accounts. `submission-blockers.md` row 8 leaves the ASC password field and review contact unset.
- Remediation: Add beta-review contact fields and `demoAccountName` `customer@nomarkup.com` with `demoAccountRequired` true. Purge `Password123!` from the repo, rotate those accounts, and inject the password only from the environment at save time. Do not put it in `notes`.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-betaappreviewdetails-_id_
- Confidence: 9

#### [TF-2] External testing prerequisites

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Create an internal group before any external group, and have a beta description, feedback email, beta-review contact, What to Test, and an approved Beta App Review before external testing.
- Evidence: `testflight-process.md` §5 correctly orders internal first and external only after device smoke. The internal group is still open (`launch-board.md` column 5). Not found in tree: `metadata/testflight/en-US.json` (`description`, `feedbackEmail`) or `metadata/testflight/beta-review.json`. What to Test is only a paste template in §6, not a build localization. No external group is documented as already created.
- Remediation: Do not create an external group until the internal group has a smoked build and Test Information, beta-review contact, and What to Test are saved on the app and build.
- Source: https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers
- Confidence: 9

#### [TF-5] Test Information (beta app localization)

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Each locale needs a non-empty beta `description` and `feedbackEmail` before external testing.
- Evidence: Not found in tree: `metadata/testflight/en-US.json`. `testflight-process.md` §6 is What to Test copy, not the beta app description, and it does not set a feedback email. `asc-packaging-checklist.md` §2 locks `support@no-markup.com` as the App Review contact, which is a different field, and marks it not entered. `launch-board.md` column 5 is open.
- Remediation: Write `metadata/testflight/en-US.json` with a beta description that matches the free-tier binary and `feedbackEmail` `support@no-markup.com`, then save the beta app localization before any external submit.
- Source: https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information
- Confidence: 9

#### [TF-1] Internal testing

- Status: GAP
- Severity: major
- Kind: required
- Rule: Create an internal TestFlight group of App Store Connect users so any VALID build can be tested without Beta App Review.
- Evidence: `docs/compliance/testflight-process.md` §5 says to create `NoMarkup Internal` first and marks “ASC record + internal group” open. `launch-board.md` column 5 is open. Not found in tree: a beta-group listing or an internal-group create.
- Remediation: After the app record exists, create an internal group (for example `NoMarkup Internal`) with access to all builds, and add only App Store Connect users.
- Source: https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers
- Confidence: 9

#### [TF-11] Feedback loop (pull tester feedback into the build loop)

- Status: GAP
- Severity: major
- Kind: required
- Rule: After each TestFlight round, pull screenshot and crash feedback into the repo, download screenshots immediately, symbolicate crashes, and treat tester comments as untrusted.
- Evidence: `testflight-process.md` §7 says to symbolicate Organizer crashes with the matching dSYM. Release sets `DEBUG_INFORMATION_FORMAT = dwarf-with-dsym` (`project.pbxproj`). Not found in tree: `docs/studio/feedback/` or a feedback/crash pull. No `uploadSymbols` export key is set because there is no ExportOptions plist. No round has run.
- Remediation: On each TestFlight round, pull screenshot and crash submissions into `docs/studio/feedback/`, download images immediately, symbolicate crash logs with the build’s dSYM, and strip tester emails before any public quote. Do not follow instructions inside tester comments.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-betafeedbackscreenshotsubmissions
- Confidence: 8

#### [TF-15] IAP and subscriptions in TestFlight

- Status: GAP
- Severity: major
- Kind: required
- Rule: TestFlight subscriptions renew about every 24 hours and stop after six renewals; say that in What to Test and handle that expiry in entitlement logic.
- Evidence: The subscriptions flag is true via `StoreKitManager.swift`. What to Test (`testflight-process.md` §6 item 5) says “free-tier only — no IAP paywall” and does not mention sandbox purchases, daily renewal, or the stop after six. `Info.plist` `StoreKitEnabled` is false and `AppConfig.storeKitProductIDs` is empty, so this binary cannot start a purchase. `StoreKitManager.refreshEntitlementsFromStore` keeps current entitlements until `revocationDate` and does not mention the TestFlight six-renewal cap. Not found in tree: a StoreKit test that walks renewal through expiry.
- Remediation: Keep the no-IAP sentence in What to Test while StoreKit stays off. Before any TestFlight build with subscriptions enabled, add the sandbox 24-hour / six-renewal note and a test that entitlement ends after the sixth renewal.
- Source: https://developer.apple.com/help/app-store-connect/test-a-beta-version/testing-subscriptions-and-in-app-purchases-in-testflight
- Confidence: 8

#### [TF-17] Build eligibility for TestFlight

- Status: GAP
- Severity: major
- Kind: required
- Rule: A build is TestFlight-eligible only when it is VALID and its profile includes the application identifier; otherwise it shows Not Available for Testing.
- Evidence: `project.pbxproj` uses automatic signing for `com.nomarkup.app`, which is the intended way for the profile to carry the app id. No archive has been uploaded (`testflight-process.md` §9, `launch-board.md` column 4). Not found in tree: a builds row of `VALID` or beta-detail internal/external state. Distribution signing is still founder-open (`submission-blockers.md` row 2), so eligibility is unproven.
- Remediation: Export with automatic signing so the App Store profile includes `com.nomarkup.app`, then confirm the processed build is VALID and not “Not Available for Testing” before adding it to a group.
- Source: https://developer.apple.com/help/app-store-connect/reference/app-uploads/app-build-statuses
- Confidence: 8

#### [TF-3] Groups and testers API

- Status: GAP
- Severity: major
- Kind: required
- Rule: Add testers with one create per new email, skip people who are already members, and do not expect a delete to free a seat before the build expires.
- Evidence: `testflight-process.md` §5 says “Add testers (Apple IDs that are ASC users for internal)” with no dry-run, no skip-if-member behavior, and no note that deleted testers still count until expiry. Not found in tree: an add-testers plan.
- Remediation: When the internal group exists, invite testers by email with a plan that skips current members, and do not delete testers to free seats before their builds expire.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betatesters
- Confidence: 8

#### [TF-4] Public link and tester criteria

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: A public link belongs only on an external group and should carry a tester limit of 1–10,000.
- Evidence: `testflight-process.md` defines internal and external email groups only. It never enables a public link or a tester limit. Not found in tree: a public-link dry-run. No unlimited public link is posted, and no internal group is given a public link, but the limit is also not decided.
- Remediation: Leave public links off until an external group exists. If one is enabled, set a limit well under 10,000, and never enable it on the internal group.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-betagroups-_id_
- Confidence: 8

#### [TF-7] What to Test

- Status: GAP
- Severity: major
- Kind: required
- Rule: Each build needs per-locale What to Test text describing what changed, what to try, and known issues.
- Evidence: `docs/compliance/testflight-process.md` §6 holds a paste template for “NoMarkup iOS 1.0.0 ({BUILD})” covering login, browse, free-tier plan limits, and a device matrix. It is not attached to a build. Not found in tree: a beta build localization or a what-to-test dry-run. No build has been uploaded (`launch-board.md` column 4).
- Remediation: On the first VALID build, set `en-US` What to Test from §6, including the known “API must be up” issue, and replace it on every later build instead of leaving the previous text.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betabuildlocalizations
- Confidence: 8

#### [TF-8] Submit for Beta App Review and notify testers

- Status: GAP
- Severity: major
- Kind: required
- Rule: Submit an external build for Beta App Review and notify testers, either with auto-notify or an explicit notify call, within the six-submissions-per-day limit.
- Evidence: `testflight-process.md` §5 says an external group may need Beta App Review and that external testing waits on internal smoke. No build exists to submit. Not found in tree: a beta-review submission, a `betaReviewState`, or `autoNotifyEnabled`. Nothing shows a seventh submission or a notify that already failed.
- Remediation: After Test Information is complete, submit one external build and turn auto-notify on, or notify testers after approval. Do not submit more than six builds in 24 hours.
- Source: https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betaappreviewsubmissions
- Confidence: 8

Advisory:

- TF-10 — GAP: Build expiry and stopping a test
- TF-12 — GAP: Feedback enablement per group
- TF-13 — GAP: Feedback webhooks
- TF-16 — GAP: Tester engagement and metrics

### iOS hub

#### [IOS-PRI.1] Pathway / Prioritize privacy

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Access user or device data only with the user’s informed consent obtained in accordance with applicable law; be transparent about use.
- Evidence: Inventory is real (`ios/NoMarkup/PrivacyInfo.xcprivacy` `NSPrivacyCollectedDataTypes`, `NSPrivacyTracking` false; no ad/ATT SDK). Consent UX exists (`LoginView` / `RegisterView` Privacy links; `LocationPurposeCopy` pre-prompts; `PhotosPicker` selection). The statement does not match behavior: `web/src/app/(public)/privacy/page.tsx` (photos bullet) says “NoMarkup does not screen those images for safety,” while `SensitivePhotoUploadGate.refuseIfSensitive` (`ios/NoMarkup/Core/ImageUploader.swift`) refuses uploads `SCSensitivityAnalyzer` flags and `ModeratedAsyncImage` (`ios/NoMarkup/Core/ModeratedAsyncImage.swift`) hides flagged UGC. `LegalOfflineCopy.privacySummary` (`ios/NoMarkup/LegalOfflineCopy.txt` PRIVACY) omits name, date of birth, government-ID uploads, precise check-in location, chat, and purchase history that the manifest declares. Collected-data list on the policy page also does not name government-ID / license images (`VerificationDocumentsView`, `ProviderDocumentType.driversLicense`).
- Remediation: Rewrite the privacy policy and `LegalOfflineCopy` PRIVACY section to match `PrivacyInfo.xcprivacy`, including on-device sensitive-content analysis (upload refusal and hide-until-tap), verification documents, precise job-site location, and chat. Do not tell users images are not screened.
- Source: https://developer.apple.com/ios/get-started/
- Confidence: 8

#### [IOS-PRI.2] Pathway / Privacy statement

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: If you collect data, offer a privacy statement that explains what you collect and how you use that information.
- Evidence: Link exists: `AppConfig.privacyURL` = `https://no-markup.com/privacy` (`ios/NoMarkup/Core/AppConfig.swift`), opened from `AccountView` (`account.row.privacyPolicy`), `LoginView`, `RegisterView`, and `AccountDeletionView` via `LegalWebView`. Page source `web/src/app/(public)/privacy/page.tsx` names Stripe, OAuth (Google, Apple, Facebook), and location, but the same page states images are not screened, which contradicts `SensitivePhotoUploadGate` / `SCSensitivityAnalyzer`. When the host fails, `LegalWebView.probeHostThenPresent` shows `LegalOfflineCopy.privacySummary`, which says it “is not the full policy.” `docs/compliance/app-review-notes.md` (as of 2026-10-03) says the production host is not live and the portal Privacy Policy URL is still founder/ops; `docs/planning/in-scope-five.md` records origin-check 0/3 (no public DNS). Live HTTP 200 was not probed (network limited to Apple URLs).
- Remediation: Correct the screening sentence and government-ID omission, ship `https://no-markup.com/privacy` so it returns the full policy, and make the offline summary list the same categories as the manifest.
- Source: https://developer.apple.com/ios/get-started/
- Confidence: 8

#### [IOS-PRI.3] Protecting the user’s privacy / purpose strings

- Status: FAIL
- Severity: blocker
- Kind: required
- Rule: Provide accurate `NS*UsageDescription` purpose strings for each protected resource; strings must match actual use.
- Evidence: `ios/NoMarkup/Info.plist` (Release) and `Info-Debug.plist`: `NSLocationWhenInUseUsageDescription` matches market picker + job-site check-in (`LocationPurposeCopy.systemWhenInUseUsageDescription`, `JobSiteLocationProvider.requestWhenInUseAuthorization`, `MapLocationManager.requestWhenInUse`). `NSFaceIDUsageDescription` matches `BiometricGate` (app lock in `NoMarkupApp.unlockWithBiometrics`, deletion in `AccountDeletionView`, payment methods in `PaymentMethodsView`). No `NSMicrophoneUsageDescription` or `NSUserTrackingUsageDescription`, and no mic/ATT calls. `NSCameraUsageDescription` says the camera is only “for jobs, listings, or your profile,” but `CameraImagePicker` is also presented from `VerificationDocumentsView` (driver’s license / verification documents; hint “photograph your document”), `MessagesView` (chat attach), and `ContractDetailView` (completion / guarantee-claim photos). `NSPhotoLibraryUsageDescription` lists profile, portfolio, jobs, listings, and claims, and does not mention chat or government-ID documents. Library picks go through `PhotosPicker` (`ImageUploader`, `MessagesView`, `VerificationDocumentsView`, `ProfileSettingsView`, `ContractDetailView`), which does not request full-library access. `PhotosPicker` declaration (apple_docs show `/documentation/photosui/photospicker`): `@MainActor @preconcurrency struct PhotosPicker<Label> where Label : View` — “A view that displays a Photos picker for choosing assets from the photo library” (iOS 16.0+).
- Remediation: Rewrite `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` so each names every actual capture/pick path, including verification documents, messages, and claims, and do not describe full photo-library access when the binary only uses `PhotosPicker` plus the camera.
- Source: https://developer.apple.com/documentation/uikit/protecting-the-user-s-privacy
- Confidence: 9

#### [IOS-A11Y.3] Accessibility / Reduce Motion & transparency

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Respect Reduce Motion, Increase Contrast, Reduce Transparency (including Liquid Glass adaptations).
- Evidence: Increase Contrast is handled in `BrandTheme.dynamicUIColor` (`accessibilityContrast == .high`). Reduce Motion gates large/continuous motion: `BrandTheme.animation`, `BrandSkeletonBar` (shimmer skipped), `LivePulseDot` (solid dot), root auth and offline transitions in `RootView`. Declaration of `EnvironmentValues.accessibilityReduceMotion`: if true, “UI should avoid large animations, especially those that simulate the third dimension.” Reduce Transparency is incomplete. Declaration of `accessibilityReduceTransparency`: if true, “UI (mainly window) backgrounds should not be semi-transparent; they should be opaque.” `BrandGlassCardBackground` and `BrandOverlayChipModifier` swap to opaque fills, but these stay `.ultraThinMaterial` with no environment read: `MarketTickerView.tickerChip`, `HomeListingCard` thumbnail well, and `ListingDetailView` bid-bar `.background(.ultraThinMaterial)` (the bar behind Bid). Short ungated `.animation` / `withAnimation` remain on `AgeGateView`, `PostJobView`, `CreateListingView`, and price `contentTransition`s; those are small, not the fail.
- Remediation: When `accessibilityReduceTransparency` is true, use `BrandTheme.surfaceRaised` (or another opaque token) instead of `.ultraThinMaterial` on the ticker chips, listing thumb well, and the listing bid bar. Match `BrandGlassCardBackground`.
- Source: https://developer.apple.com/ios/
- Confidence: 8

#### [IOS-DES.23] Resizable layout (iPhone Duo / iPhone Mirroring)

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Apps built with the iOS 27 SDK and later resize dynamically on iPhone Duo; size from the view/window, not the screen, orientation, or idiom.
- Evidence: `HomeView.usesCompactHomeChrome` is `UIScreen.main.bounds.height < 880` and drives hero spacing and bottom padding. That read is the device screen, not the window, and it does not update from a size-class or geometry change. `JobsView` / `MarketplaceView` / `MessagesView` correctly use `@Environment(\.horizontalSizeClass)` (regular is not treated as “is iPad” in code). No `statusBarOrientation` / `interfaceOrientation` layout reads. `UIDevice.current.identifierForVendor` in `PushRegistration` and `AuthViewModel` is an id, not layout. Declaration (`/documentation/uikit/uiscreen/main`): `class var main: UIScreen { get }`, deprecated iOS 2.0–26.0, “Use `screen` instead” (`UIWindowScene.screen`). Deprecation is after the iOS 17 deployment target, so it is not a deprecation-lint finding; it is still the layout defect this rule names.
- Remediation: Replace `usesCompactHomeChrome` with the window’s size (`containerRelativeFrame`, `onGeometryChange`, or vertical size class) and update it when the scene resizes. Do not read `UIScreen.main.bounds` for layout.
- Source: https://developer.apple.com/iphone-duo/prepare/
- Confidence: 9

#### [IOS-DIST.17] Support URL & marketing site

- Status: FAIL
- Severity: major
- Kind: required
- Rule: Provide working Support URL and marketing presence expected for store listing quality.
- Evidence: `AppConfig.supportURL` is `https://no-markup.com/support`. Account uses `LegalWebView` with native-support fallback (`LegalWebView.nativeSupportPage`: mailto `support@no-markup.com`, report-abuse mail, account/privacy pointer). Page source `web/src/app/(public)/support/page.tsx` has a contact path. The store URL is not shown to return HTTP 200. `docs/compliance/app-review-notes.md` (2026-10-03) says production is not live and portal URLs are still founder/ops. `docs/planning/in-scope-five.md` origin-check: 0/3, no public DNS. `DEPLOY_PROVISIONED` is not set (project rule and that doc). Live HTTP was not probed.
- Remediation: Publish `https://no-markup.com/support` (and the marketing home) so both return HTTP 200 with a real contact path, then put that Support URL in App Store Connect. Keep the in-app mailto fallback.
- Source: https://developer.apple.com/ios/submit/
- Confidence: 7

#### [IOS-DIST.19] iPhone Duo screenshots & assets

- Status: RISK
- Severity: major
- Kind: required
- Rule: Submit iPhone Duo screenshots in App Store Connect (required for submissions starting April 2027; product page shows a badge when provided) and check assets with the App Store Connect preview tool.
- Evidence: `docs/compliance/app-store-screenshot-matrix.md` required sizes are 6.9″ iPhone and 13″ iPad only. No iPhone Duo size, device, or bezel is listed. Pixel status: no production screenshot set. Documented archive pin is Xcode 26.5 (`testflight-process.md`), not Xcode 27.1, which the rule ties to optimized iPhone Duo layout. This machine’s `xcodebuild -version` is Xcode 27.2, so the SDK can be selected, but the screenshot plan does not use it. Today is 2026-11-15; Duo screenshots are not an upload rejection until April 2027. A 1.0.0 submission that slips past that date would ship without them.
- Remediation: Add an iPhone Duo capture row to the matrix, shoot it with Xcode 27.1 or later, and check the set in the App Store Connect preview tool before any submission on or after April 2027.
- Source: https://developer.apple.com/iphone-duo/prepare/
- Confidence: 8

#### [IOS-DIST.6] Age ratings

- Status: RISK
- Severity: major
- Kind: required
- Rule: Age rating questionnaire must reflect actual content; system updated for more granular ratings on modern OS. Social media capability questions are required for new submissions and updates starting September 2026 (apps with social feeds show a Social Media content descriptor). Starting November 16, 2026 the questionnaire adds Shared Location and Dating and Relationships declarations, which all apps must complete by January 12, 2027; Dating and Relationships apps have a minimum 18+ rating.
- Evidence: Draft `docs/compliance/asc-content-rating-answers.md` (as of 2026-08-02) answers UGC Yes, Messaging and Chat Yes, unrestricted web No, gambling No, and 18+ not Kids Category, which matches jobs/listings/chat/reviews and `AgeGateView`. It does not record the social-media capability question required for submissions since September 2026. The app has messaging, profiles, and UGC discovery (`app-store-review-2026-08-21.md` sets `social` true). It also does not declare Shared Location, and the app stores job-site GPS (`JobSiteLocationProvider`, precise location in `PrivacyInfo.xcprivacy`) and coarse market location. Dating and Relationships is not a product feature (applicability `kids`/`dating` not set; no dating flow found). Founder checklist in that doc is unchecked; answers are not shown as entered in App Store Connect. Audit date 2026-11-15 is the day before the Shared Location / Dating questions are added; they block updates after 2027-01-12 if missing.
- Remediation: Before submit, add explicit Social Media (Yes, because of chat and UGC discovery), Shared Location (Yes, job-site check-in and market location), and Dating and Relationships (No) answers, then paste the updated table into App Store Connect. Do not file the August draft unchanged.
- Source: https://developer.apple.com/ios/submit/
- Confidence: 7

#### [IOS-DES.20] Minimum visual quality

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: UI should not ship with placeholder/lorem, broken constraints, or overlapping controls on supported devices.
- Evidence: No “lorem” / “ipsum” in `ios/NoMarkup/**/*.swift`. Production copy is real (`HomeView` hero “The Market Sets The Price.”). `BrandTheme.brandTabBarClearance` default 112pt records a prior overlap (“80pt still left Continue / last rows over the Jobs tab icon on Pro Max”). `docs/compliance/device-smoke-checklist.md` rows M-SE, M-PM, M-IPAD, M-AX5, and M-17 are unchecked, and the doc says not to claim the matrix signed. This audit did not run the app on SE or iPad, so overlapping or clipped primary CTAs are unverified.
- Remediation: Execute and sign the device-smoke matrix (SE, Pro Max, 13" iPad, AX5, iOS 17) and fix any control that still sits under the floating tab bar.
- Source: https://developer.apple.com/ios/get-started/
- Confidence: 8

#### [IOS-DIST.7] App privacy details (nutrition label)

- Status: GAP
- Severity: blocker
- Kind: required
- Rule: Enter all necessary privacy practices including third-party partners’ code; required to submit new apps and updates.
- Evidence: First-party types in `ios/NoMarkup/PrivacyInfo.xcprivacy` match the packaging table in `docs/compliance/asc-packaging-checklist.md` §4.2 (email, name, phone, address, DOB, precise and coarse location, photos, payment info, purchase history, customer support, user ID, device ID via `UIDevice.identifierForVendor` in `PushRegistration`, other user content, sensitive info; tracking false). Checklist marks “Type §4.2 into ASC App Privacy” as founder/portal `[~]`. It also says omit Product Interaction “until analytics ships.” The only third-party binary SDK is stripe-ios 24.25.0; its privacy manifest is not in this workspace, so partner-collected types were not compared to the label. No crash/analytics SDK is linked in the iOS target (checklist: no Sentry in iOS SPM).
- Remediation: Read the pinned stripe-ios privacy manifests, add any extra collected types (for example product interaction) to the app label and manifest, then enter the combined label in App Store Connect.
- Source: https://developer.apple.com/app-store/app-privacy-details/
- Confidence: 7

#### [IOS-A11Y.2] Accessibility / Dynamic Type

- Status: GAP
- Severity: major
- Kind: required
- Rule: Support Dynamic Type so text scales with user settings without truncation of critical content.
- Evidence: Semantic fonts and `@ScaledMetric` (`HomeListingCard.thumbSize`); prices use `.fixedSize(horizontal: false, vertical: true)` on the live-floor hero. Remaining truncation: `HomeView.statCell` `lineLimit(1)` + `minimumScaleFactor(0.75)` on “LIVE NOW” / “GOODS LIVE”; `TrustScoreView` and `SavingsView` `minimumScaleFactor(0.5)`; many `lineLimit(1)` on locations and eyebrows; `HomeJobCard` title `lineLimit(2)`. Only canvas check found is `#Preview("Job spectate AX5")` with `.dynamicTypeSize(.accessibility5)`, not a device pass. `device-smoke-checklist.md` row M-AX5 is unsigned. `accessibility-nutrition-claims.md` still says do not claim Larger Text.
- Remediation: Let stat labels, prices, and primary titles wrap at AX5 (drop `minimumScaleFactor` below ~0.85 on user-facing money and titles). Sign M-AX5 on SE before any Larger Text claim.
- Source: https://developer.apple.com/ios/get-started/
- Confidence: 8

#### [IOS-AI.2] Foundation Models framework

- Status: GAP
- Severity: major
- Kind: opportunity
- Rule: Use the Foundation Models native Swift API for on-device (and eligible Private Cloud Compute) Apple Foundation Models, or other providers conforming to the Language Model protocol.
- Evidence: No `import FoundationModels`, `LanguageModelSession`, or `SystemLanguageModel` under `ios/`. `foundation_models` is false. The only on-device intelligence hook is Visual Intelligence (`ListingVisualIntelligence.swift`), not a language-model session. Apple: `SystemLanguageModel.Availability` is “the availability status for a specific system language model” with `.available` and `.unavailable` (https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.enum) — unused, so there is also no crash path.
- Remediation: Optional. If drafting a job or listing description, add a `LanguageModelSession` behind `SystemLanguageModel.default.availability == .available` and keep the existing `TextField` as the fallback. Do not add “Apple Intelligence” marketing with that change.
- Source: https://developer.apple.com/documentation/FoundationModels
- Confidence: 9

#### [IOS-AI.5] Evaluations framework

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use the Evaluations framework to verify AI features behave correctly across dynamic conditions — beyond unit tests alone.
- Evidence: `ai_evals` is implied by `apple_intelligence`, which is implied by `visual_intelligence`. No Evaluations framework import, eval dataset, or CI hill-climb. The only check is `AppIntentsTestingFrameworkTests.testVisualIntelligenceQueryCompilesWhenFrameworkPresent`, which compares `ListingVisualSearchQuery` to `ListingVisualSearchMatcher` on a decoded `labels` payload. No prompt/agent eval suite (there is no language-model feature).
- Remediation: If Visual Intelligence stays the only AI surface, add a small labeled-fixture set (hit, miss, empty labels, diacritics) and run it in the existing XCTest target. Adopt the Evaluations framework only if a Foundation Models feature ships.
- Source: https://developer.apple.com/ios/whats-new/
- Confidence: 8

#### [IOS-DIST.18] Cross-skill handoff

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Distribution readiness is incomplete without App Review Guidelines compliance for rejection-risk areas (IAP, UGC, legal).
- Evidence: `/app-store-compliance` output is on disk: `docs/compliance/app-store-review-2026-08-21.md` (submission readiness NOT READY; guidelines snapshot 2026-06-08). Later notes (`app-review-notes.md`, 2026-10-03) still say the binary is not submitted. No ASR report after the 2026-08-24 private-relay domain change, the September 2026 social-media age questions, or the 2026-10-05 iPhone Duo note. This finding does not rescore ASR IDs.
- Remediation: Re-run `/app-store-compliance` against the current guidelines before the first upload, and do not treat the August 2026 NOT READY report as current.
- Source: https://developer.apple.com/app-store/review/guidelines/
- Confidence: 8

#### [IOS-DIST.4] TestFlight

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use TestFlight for internal/external beta feedback including screenshots with context and crash details before wide release.
- Evidence: `docs/compliance/testflight-process.md` (updated 2026-08-02) describes archive, export compliance, and an internal group, and marks “Archive with Xcode 26+ and upload” and “Create Internal TestFlight group” as unchecked founder steps. No ASC build, tester group, or crash export is in the repo.
- Remediation: Upload one Xcode 26+ archive and enable an internal TestFlight group before a wide release; keep the process doc’s tester steps.
- Source: https://developer.apple.com/testflight/
- Confidence: 8

#### [IOS-DIST.5] Product page / metadata

- Status: GAP
- Severity: major
- Kind: required
- Rule: App name, icon, description, screenshots, previews, and keywords must be accurate and ready; update subtitle/promotional text thoughtfully.
- Evidence: Display name `NoMarkup` and `CFBundleDisplayName` in `Info.plist`; icon set `ios/NoMarkup/Assets.xcassets/AppIcon.appiconset`. Subtitle “Local jobs & marketplace”, categories, and description are proposals in `docs/compliance/asc-packaging-checklist.md` §1, not an ASC export. No `fastlane/metadata`. `docs/compliance/app-store-screenshot-matrix.md` (updated 2026-08-22): “no production screenshot set committed”; 6.9″ and 13″ capture boxes are unchecked. Harness `ScreenshotWalkUITests.swift` exists. `app-review-notes.md` says screenshots are still founder/ops.
- Remediation: Enter the proposed name, subtitle, description, and keywords in App Store Connect and upload a current 6.9″ iPhone plus 13″ iPad set from the matrix (native UI only).
- Source: https://developer.apple.com/ios/submit/
- Confidence: 9

#### [IOS-DIST.8] Accessibility Nutrition Label

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Share accurate accessibility support (VoiceOver, Voice Control, Larger Text, Captions, etc.) for product page labels; optional detail URL.
- Evidence: `docs/compliance/asc-packaging-checklist.md` §6: “Accessibility nutrition claims | docs; claim only after human AX pass,” portal still `[~]`. No App Store Connect accessibility-nutrition answer table is in the repo. Nothing in-tree overclaims VoiceOver or Voice Control on the product page because the label has not been entered.
- Remediation: After an accessibility pass, enter only the features that pass, and leave the rest undeclared.
- Source: https://developer.apple.com/ios/submit/
- Confidence: 8

#### [IOS-INT.5] App Intents Testing

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Validate App Intents integration through system pathways (App Intents Testing framework) without relying only on UI automation.
- Evidence: `ios/NoMarkupTests/NotificationDeepLinkTests.swift:AppIntentsTestingFrameworkTests` calls in-process `SearchNoMarkupIntent.perform()` and `OpenListingIntent.perform()` and asserts `DeepLinkRouter` routes. The `canImport(AppIntentsTesting)` branch only constructs `IntentDefinitions` and the file states that module is absent from the iPhoneOS 26.5 SDK (expected with Xcode 27). No CI job runs the system App Intents Testing pathway. `IntentAuthGuard` unit tests exist in the same file.
- Remediation: When the build SDK includes `AppIntentsTesting`, run `IntentDefinitions(bundleIdentifier: "com.nomarkup.app")` (or the current `makeIntent().run()` API) in CI for search, open-listing, post-job, and check-in, including the signed-out error.
- Source: https://developer.apple.com/ios/whats-new/
- Confidence: 8

#### [IOS-PRI.7] Privacy Manifest / required reason APIs

- Status: GAP
- Severity: major
- Kind: required
- Rule: Declare Required Reason APIs and tracked domains in privacy manifests as required by Apple platform rules.
- Evidence: App `ios/NoMarkup/PrivacyInfo.xcprivacy` and widget `ios/NoMarkupWidget/PrivacyInfo.xcprivacy` are in the Copy Bundle Resources phases. Both set `NSPrivacyTracking` false and empty `NSPrivacyTrackingDomains`. App `NSPrivacyAccessedAPICategoryUserDefaults` reasons `CA92.1` and `1C8F.1` match `UserDefaults.standard` (`BiometricGate.preferenceKey`, Debug `AppConfig.dogfoodAPIBaseDefaultsKey`, `StoreKitManager`) and `UserDefaults(suiteName: "group.com.nomarkup.app")` in `WidgetSharedStore`. Widget manifest has `1C8F.1` only; widget Swift calls `WidgetSharedStore.load()` and does not use `UserDefaults.standard`. No app hits for file-timestamp, boot-time, disk-space, or active-keyboard APIs (`ImageUploader` uses `resourceValues(forKeys: [.fileSizeKey])` only). Pinned `stripe-ios` 24.25.0 (`ios/NoMarkup.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` revision `dfc152145ced35e248e6fda5a8d6eb620bfcd74f`) has no checkout under this repo, so that SDK’s `PrivacyInfo.xcprivacy` was not verified.
- Remediation: Resolve the pinned stripe-ios checkout, confirm each linked Stripe target embeds a privacy manifest, and add any Required Reason categories or collected types the SDK declares that the app manifest does not.
- Source: https://developer.apple.com/documentation/bundleresources/privacy_manifest_files
- Confidence: 7

#### [IOS-SEC.14] Sign in with Apple private relay domain

- Status: GAP
- Severity: major
- Kind: required
- Rule: New Sign in with Apple private relay addresses are issued on `private.icloud.com`; existing `privaterelay.appleid.com` addresses keep working. Account systems, email validation, and allowlists must accept both domains.
- Evidence: SIWA is on (`SignInWithAppleButtonView`, entitlement `com.apple.developer.applesignin`). No email-domain allowlist in the user service or iOS client restricts mail to `privaterelay.appleid.com`. The only `privaterelay.appleid.com` hit is a sample payload in `docs/compliance/ios-api-integration-notes.md`. `private.icloud.com` is not in the repo. Chat `emailRegex` (`services/chat/internal/service/service.go`) matches any address (contact-info detection, not an allowlist). No Apple Private Email Relay / sending-domain registration for either host is in the tree (SendGrid remains a founder residual in `docs/operations/prod-launch-todo.md`).
- Remediation: Confirm account create/update accepts `@private.icloud.com` and `@privaterelay.appleid.com` with a test, and register the outbound mail domain for both relay hosts in the Apple developer private-email configuration before SIWA users on the new domain are mailed.
- Source: https://developer.apple.com/documentation/signinwithapple/communicating-using-the-private-email-relay-service/
- Confidence: 7

#### [IOS-SEC.2] Passkeys

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Adopt passkeys as a secure alternative to passwords for sign-in; passkeys are phishing-resistant and synced via iCloud Keychain.
- Evidence: Client is implemented: `PasskeyAuth.signInWithPasskey` / `registerPasskey` use `ASAuthorizationPlatformPublicKeyCredentialProvider` (assertion and registration) and `APIClient+Auth` `/api/v1/auth/passkeys/*`. `LoginView.passkeyButton` and `RegisterView` post-register offer render only when `PasskeyAuth.isEnabled` (`featureFlagKey` `passkeys`) is true; `AppConfigTests` requires an absent flag to hide the UI. `docs/compliance/app-review-notes.md` says “Passkeys stay off until no-markup.com resolves.” Default shipping UX is password + Sign in with Apple, not a passkey path. Associated-domain anchor is present but the host is not shown live (`IOS-SEC.9`).
- Remediation: After `webcredentials:no-markup.com` and the AASA file answer on the live host, turn the server `passkeys` flag on so `login.passkey` and the post-register offer are shown.
- Source: https://developer.apple.com/passkeys
- Confidence: 8

#### [IOS-SEC.9] Associated domains

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Universal Links / webcredentials / applinks correctly configured for passkeys and deep links.
- Evidence: `NoMarkup.entitlements` `com.apple.developer.associated-domains` contains `applinks:no-markup.com` and `webcredentials:no-markup.com`. In-repo AASA `web/public/.well-known/apple-app-site-association` lists `6L6565278C.com.nomarkup.app` for applinks components and `webcredentials.apps` (team matches `DEVELOPMENT_TEAM` `6L6565278C`). `NoMarkupApp.onOpenURL` calls `DeepLinkRouter.handle`. Live `https://no-markup.com/.well-known/apple-app-site-association` was not fetched; `docs/planning/in-scope-five.md` origin-check is 0/3 with no public DNS, and review notes keep passkeys off until the host resolves.
- Remediation: Serve that AASA file at `https://no-markup.com/.well-known/apple-app-site-association` with the applinks and webcredentials entries, then verify a Universal Link and a passkey on device.
- Source: https://developer.apple.com/documentation/authenticationservices
- Confidence: 8

#### [IOS-SYS.NT.3] Notification design, actions, interruption level

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Follow HIG for managing notifications: clear title/body, useful actions, appropriate interruption levels.
- Evidence: `PushRegistration.registerNotificationCategories` registers `UNNotificationCategory` with View (foreground) and, for `bid_outbid` and `new_message`, destructive Dismiss. `shouldDeepLink` opens only the default tap and VIEW. `apns.go:apnsInterruptionLevel` is `passive` for promotional and `active` otherwise; comment states time-sensitive is not sent because there is no time-sensitive entitlement. `apns-priority` is 5 vs 10. `thread-id` groups by entity. Chat is `new_message` with View/Dismiss only. No `INSendMessageIntent` / communication-notification path (grep of `ios/` and notification service). Apple: `UNNotificationCategory` “defines a type of notification” and “action buttons” via `setNotificationCategories` (https://developer.apple.com/documentation/usernotifications/unnotificationcategory).
- Remediation: Keep active/passive as they are. For person-to-person chat, adopt communication notifications (sender intent, no message body on the lock screen — body is already redacted) or document that View-only is the chosen HIG subset.
- Source: https://developer.apple.com/design/human-interface-guidelines/managing-notifications
- Confidence: 8

#### [IOS-SYS.NT.4] APNs infrastructure and console validation

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use APNs correctly; validate with Push Notifications Console; monitor delivery metrics.
- Evidence: Token auth and host switch in `services/notification/internal/service/apns.go:newAPNsProvider` (`api.sandbox.push.apple.com` vs `api.push.apple.com` from `APNsConfig.Production`). `SendMultiple` returns 410 Unregistered and 400 BadDeviceToken for `pruneStaleDeviceTokens`. Metric `notification_apns_sends_total` in `metrics.go`. Client: `PushRegistration.didReceiveDeviceToken` posts the hex token; sign-out calls `unregisterPushDevice`. Committed `ios/NoMarkup/NoMarkup.entitlements` `aps-environment` is `development` (comment says archive export rewrites production). `docs/compliance/testflight-process.md` Push Notifications Console box is unchecked (“This box is not signed”). No ops record of a console delivery log.
- Remediation: After a real upload, send one sandbox and one production alert from the Push Notifications Console and record that `notification_apns_sends_total` moved. Confirm the archived binary’s `aps-environment` is `production`.
- Source: https://developer.apple.com/notifications/push-notifications-console/
- Confidence: 8

#### [IOS-TEST.2] Testing / TestFlight

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Use TestFlight for real-device feedback before release when distributing on App Store.
- Evidence: `docs/compliance/testflight-process.md` documents Xcode 26 archive, internal group, “What to Test”, and crash symbolication. The same doc’s founder list is still open: no ASC app record, no uploaded build, no internal group. No fastlane or TestFlight API config in-repo. `app_store_distribution` is true, so the check applies.
- Remediation: After the ASC app record exists, upload an Xcode 26 archive and enable an internal TestFlight group before any external or production release. Do not mark the process shipped from the doc alone.
- Source: https://developer.apple.com/testflight/
- Confidence: 9

#### [IOS-TEST.3] Testing / device matrix

- Status: GAP
- Severity: major
- Kind: recommended
- Rule: Validate on representative devices/OS versions in support matrix (including smaller phones and current OS).
- Evidence: `docs/compliance/device-smoke-checklist.md` defines M-SE (iPhone SE 3rd gen), M-PM, M-IPAD 13", M-AX5, and M-17 (iOS 17.0 floor). Every Pass cell is empty. The honesty rule says prior Pro Max runs do not sign SE, iPad, iOS 17, or AX5. `ios/README.md` still shows an iPhone 16 simulator example. This audit did not execute the matrix.
- Remediation: Run and sign each required row on the current Xcode 26 simulators (and one physical phone) before calling the support matrix verified.
- Source: https://developer.apple.com/ios/get-started/
- Confidence: 9

Advisory:

- IOS-AI.10 — GAP: Genmoji in custom text
- IOS-AI.11 — GAP: Visual Intelligence catalog match
- IOS-AI.17 — GAP: fm CLI and eval scripts
- IOS-AI.3 — GAP: Multimodal Foundation Models prompts
- IOS-DES.14 — GAP: Design resources

## Pre-submit checklist

- ASR-PRE-01 — GAP (major): Test for crashes and bugs. Unit tests exist under `ios/NoMarkupTests` (including `AgeGateMathTests`, `APIClientTests`, `CheckoutSecretTests`) and UI tests under `ios/NoMarkupUITests`. No signed crash-free submission run or empty known-blocker list for the binary that would be uploaded.
- ASR-PRE-02 — FAIL (major): Complete accurate metadata. `app-review-notes.md` founder residual: screenshots, App Review contact, and Privacy Policy URL in the portal are still open. No App Store Connect listing (name, description, screenshots, age rating, keywords) is stored as submitted. Binary marketing version is 1.0.0, display name `NoMarkup` (`Info.plist` `CFBundleDisplayName`).
- ASR-PRE-03 — FAIL (major): Developer contact for review. Same founder residual as ASR-BYS.1 in `app-review-notes.md`: App Review contact is not claimed done in App Store Connect.
- ASR-PRE-04 — FAIL (blocker): Demo access for account features. Same gap as ASR-BYS.2. Accounts are significant (`RegisterView`, bids, escrow). Demo emails are drafted; the password is explicitly not in App Store Connect; the API those accounts would use is not provisioned; scaffold mode cannot call report or block.
- ASR-PRE-05 — FAIL (blocker): Backend live. Same as ASR-BYS.3. `provisioning-checklist.md` is “NOT YET PROVISIONED”. Release client targets `https://api.no-markup.com`.
- ASR-PRE-06 — FAIL (major): Review notes for non-obvious features. Paste-ready notes exist in `app-review-notes.md` (18+ gate, UGC, `StoreKitEnabled=false`, Apple Pay for real-world goods). The file says they are not pasted into App Store Connect.
- ASR-PRE-07 — GAP (advisory): Follow Apple design and brand documentation. `ios/README.md` states the client is native SwiftUI and limits `SFSafariViewController` to legal and support HTML. No completed checklist against HIG, Apple Pay marketing guidelines, and trademark guidelines is in the tree. Apple Pay button copy exists (`ListingDetailView` “Buy now with Apple Pay”) without a marketing-guideline sign-off.
- ASR-PRE-08 — GAP (major): App still supported. Code is in active development. No support roster, on-call, or regression sign-off showing the binary will keep working after listing. Production host is unprovisioned, so “functions as intended” against the release API is not shown.

## Human steps

These are not PASS. Only a person or Apple can close them.

1. Provision `https://api.no-markup.com` so review can sign in and complete a job and a goods purchase (`ASR-BYS.3`, `ASR-PRE-05`, `ASR-2.1.a.1`).
2. Enter the demo-account password only in App Store Connect. Do not commit it (`ASR-BYS.2`, `ASR-PRE-04`, `ASC-28`, `TF-6`).
3. Publish the privacy policy at `https://no-markup.com/privacy` and support at `https://no-markup.com/support`, and have counsel review the policy (`ASR-5.1.1.i`, `ASR-1.5.a`, `IOS-PRI.1`, `IOS-DIST.17`).
4. Fill App Review contact, notes, and the What’s New paste for 1.0.0 (`ASR-PRE-02`, `ASR-PRE-03`, `ASR-PRE-06`, `ASC-19`).
5. Upload the screenshot sets, including the 6.9-inch and 13-inch sizes (`ASC-20`).
6. Answer the current age-rating questions. Shared Location is yes because job-site check-in stores precise location. Dating is no (`IOS-DIST.6`).
7. Enter the privacy nutrition label in App Store Connect. The API cannot set it.
8. Run VoiceOver, Voice Control, and Switch Control on device. Automated audits do not replace that pass.
9. Run the device matrix on a small phone, a mid-tier phone, a Pro, and iPhone Duo, and sign the smoke checklist (`DEV-21`).
10. Decide price, fees, launch markets, and promotions. This audit does not set them (`GTM-7`).
11. Decide whether the public GitHub repository stays public, and whether `main` gets branch protection (`GH-1`, `GH-5`). This audit does not change GitHub settings.
12. If TestFlight upload is automated, store `ASC_KEY_ID`, `ASC_ISSUER_ID`, and `ASC_KEY_P8_BASE64` as secrets (`GH-17`, `GH-9`).

## Out-of-registry observations

- **OBS-1.** `stripe_payments` implies `cloudflare_backend` in the flag table. This iOS client calls the Go API at `https://api.no-markup.com`. No Worker URL is in the app. Cloudflare artifact checks are gaps for that reason.
- **OBS-2.** `apple_intelligence` is implied by Visual Intelligence label matching, which then implies `ai_evals`. The app has no `LanguageModelSession`. Foundation Models items were scored because the flag was true, and recorded as gaps.
- **OBS-3.** Several registries tell the auditor to read `project.yml` and `docs/studio/`. This app is a hand-maintained `project.pbxproj` with no studio scaffold. Those checks were scored against the project that exists, not passed for a missing generator.
- **OBS-4.** `brand_check.py` exited 2 because `brand.json` is missing, so the built-in never-public word list did not run.
- **OBS-5.** `apple_docs.sh show` of `getCredentialState(forUserID:completion:)` was blocked by a local command hook because the path contains “credential”. The symbol was confirmed from search output instead.

## Registry coverage

Digest applicable items: 1450. Scored IDs: 1450. Applicable IDs with no finding: 0.

`ASR-4.8.equiv.email_privacy` is PASS (blocker, required). Evidence: `SignInWithAppleButton` presents Apple’s Hide My Email sheet, and `AuthViewModel.handleSignInWithApple` does not replace that sheet or require a real email afterwards (`ios/NoMarkup/Auth/SignInWithAppleButton.swift`, `ios/NoMarkup/Auth/AuthViewModel.swift`).

Standard depth capped full advisory write-ups at 15 per registry file. Omitted advisories are N/A stubs in the group files and are excluded from the FAIL and GAP lists above.

Groups run: `asr-safety-legal`, `asr-performance`, `asr-business-design`, `ios-design-quality`, `ios-privacy-dist`, `ios-system-ai-media`, `a11y-wcag`, `craft-hap-ux-mot`, `craft-perf-device`, `tech-bundles`, `hig-fw-hig`, `hig-fw-xcode`, `hig-fw-system`, `hig-fw-platform`, `swift-lang`, `brand-mkt`, `integrations`, `market`, `asc-tf`, `ci`. `rust-ml` and `game` were skipped: `rust_core` and `game` are false. The Rust core in `engines/` is not linked into the iOS target.

## Disclaimer

This maps product evidence to Apple's published guidelines and documentation. It is not legal advice and not App Review, and does not guarantee approval. Re-verify against the canonical URLs before submission.
