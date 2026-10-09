# Gap hunt 2 — 2026-08-22 full-sim (`--fix`)

**Agent:** iphone-sim product-gap hunter  
**Mode:** fix. **No commit. No money submit.**  
**Ground truth:** static Swift + live `GET /health` **200** + prior shots in this folder.  
**Sims:** did **not** occupy reserved devices. Unit retest used **iPhone 17e** clone `5B84AFEE-78CD-4427-A536-95EE91D81220` (`/tmp/NoMarkupGapHunt2DD`).

| Device | UDID | Occupied by |
|--------|------|-------------|
| iPhone 17 Pro | `7F123C44-2F2C-442B-90A6-92DE8E548510` | `DerivedDataFullSim` |
| iPhone 17 Pro Max | `503E262C-5731-45BE-A459-CFF59551539E` | `DerivedDataFullSimB` |
| iPhone 17 | `B3CA7DF9-228C-4490-B5B7-57F2B0FE5D6D` | `DerivedDataFullSimC` |

Visual retest of this cycle’s diffs is **BLOCKED** until those xcodebuild runs finish. IDs, empty copy, and Keychain-skip logic are source-verified + unit-tested.

API: `GET http://127.0.0.1:8081/health` → **200** `{"status":"ok","version":"dev"}`. Sample catalog (curl, not a money submit): listing `00000000-0000-4000-a000-00000000a012` “Makita 18V LXT drill/driver kit”; job `00000000-0000-0000-0000-000000000103` “Review SaaS vendor contract before signing”.

---

## Hunt scope

1. Dead buttons / missing empty/error on Messages extras, Finish setup, Job/listing report + replay sheets.
2. Duplicate `accessibilityIdentifier` for request log after the Session move (must appear once).
3. `AuthViewModel` harness-without-credentials now skips Keychain restore — any DEBUG path that still restores?
4. Crash paths (force unwrap) on Account destinations skipped in test07.

---

## Findings

### [SIM-UI.26] Listing Report sat under the tab bar and had no id
- Status: FIXED
- Severity: major
- Surface: `ListingDetailView` last List section (`Report listing` / `Open on web`)
- Evidence: Inventory `00-inventory.md` §5 “Report listing sheet” a11y ids blank. `jobDetail.report` existed (`JobDetailView.swift`) with `.brandTabBarClearance()`. Listing report button had **no** identifier; listing list had **no** tab-bar clearance. Unsigned / seller / closed listings hide the sticky bid dock, so Report is the last row under the floating iOS 26 tab bar (same fold Jobs already documented).
- Expected: Stable `listingDetail.report`; last row hittable above the tab bar.
- Actual: Label-only control; hittable area could be covered when the bid dock is hidden.
- Remediation: `listingDetail.report`, `listingDetail.openWeb`, `.brandTabBarClearance()` before the sticky bid inset.
- Retest: static `ListingDetailView.swift` Report section. Simulator listing walk not re-run (reserved sims occupied).
- Confidence: 8

### [SIM-UI.27] Job / listing / chat report + replay sheets had no settle ids
- Status: FIXED
- Severity: advisory
- Surface: `JobReportSheet`, `ListingReportSheet`, `ChatReportUserSheet`, `ProposeTermsSheet`, `AuctionReplayView`
- Evidence: Inventory listed `jobDetail.report` / `auctionReplay.job` / `auctionReplay.listing` only. Sheet Cancel / Submit / reason / details unlabeled. Replay loading/error/empty reused the same root id (`auctionReplay.job` / `.listing`) so XCUITest could not tell empty from loaded.
- Expected: Open-only UITest can assert root, Cancel, loading/error/empty without submitting a report.
- Actual: Replay root existed; sheet chrome and replay branches did not.
- Remediation:
  - `jobReport.{root,reason,details,submit,cancel,status}`
  - `listingReport.{root,reason,details,submit,cancel,status}`
  - `chatReport.{root,reason,details,submit,cancel,status}`
  - `proposeTerms.{root,submit,cancel}`
  - `auctionReplay.loading` / `.error` / `.empty` (root id unchanged)
- Retest: static. Did **not** tap Submit report (founder / not money, still a mutation).
- Confidence: 9

### [SIM-UI.28] Messages extras: unlabeled actions + empty Share was a dead submit
- Status: FIXED
- Severity: major
- Surface: `ChatThreadView` overflow menu, share-contact alert, report sheet, composer attach, thread empty/error
- Evidence: Inbox already had `messages.{loading,error,empty,searchEmpty,list}` (08-gap-hunt SIM-UI.19). Thread extras in inventory §13 were “still missing”. Share confirm allowed **Share** with both phone and email empty (`disabled` only `isSharingContact`). Report sheet `if let target = counterpartyUserID` presented a **blank sheet** if the optional was nil (race after `currentUserID` loads). Camera correctly `.disabled` when `isSourceTypeAvailable(.camera)` is false (sim N/A).
- Expected: Menu/report/block/share/PDF have ids; Share requires a field; missing counterparty shows empty, not a blank modal; thread load/error/empty settle.
- Actual: Labels only; empty Share POSTed; empty report sheet possible.
- Remediation: `messages.{actions,shareContact,report,block,proposeTerms,openWeb,attachPhoto,camera,attachPDF}` + `messages.thread.{signIn,loading,error,empty,searchEmpty}` + `messages.report.empty`. Share disabled unless phone or email is non-empty; `shareContact()` guards the same. Report sheet else-branch `BrandEmptyState` “Can’t report”.
- Retest: static. Camera remains **sim N/A**. Share/report **not submitted**.
- Confidence: 8

### [SIM-UI.29] Finish setup wizard had no field / empty ids
- Status: FIXED
- Severity: advisory
- Surface: `OnboardingWizardView` (Account `account.finishSetup` + post-register sheet)
- Evidence: Inventory §1: “wizard itself unlabeled root”. Loading/error/sign-in `BrandEmptyState` already existed; Continue / Skip / Not now / fields were label-only. `testAccountHubLinks` only taps the banner and dismisses.
- Expected: XCUITest can open the wizard, walk fields, tap Not now / Skip, assert load/error — no OTP submit.
- Actual: Banner id only.
- Remediation: `onboarding.{root,signIn,loading,error,notNow,displayName,phone,otp,sendOTP,verifyOTP,continue,skip,done,addProperty}`.
- Retest: static. OTP send **not** tapped (founder).
- Confidence: 9

### [SIM-UI.30] Request log empty / loading had no settle ids
- Status: FIXED
- Severity: advisory
- Surface: `ClientActionLogView`
- Evidence: `requestLog.root` / `.httpCount` / `.clear` existed. Empty “No requests yet” and server-load spinner were unlabeled, so a 200-empty merge could not settle except by title.
- Expected: Same loading/empty pattern as catalogs.
- Actual: Title-only.
- Remediation: `requestLog.empty`, `requestLog.loading`.
- Retest: static `ClientActionLogView.swift`.
- Confidence: 9

### [SIM-UI.31] `account.row.requestLog` after Session move
- Status: PASS
- Severity: advisory
- Surface: Account hub Session section
- Evidence: `rg accessibilityIdentifier\("account.row.requestLog"\)` → **one** hit, `AccountView.swift:238` (Session, between Verify and Sign out). Destination ids are `requestLog.*` (not a second row). Harness overlay is `debug.requestLog.latest` (`RootTabView` `UITestRequestLogProbe`, `LaunchTestAuth.isHarness` only) — different identifier, 1pt AX probe, not a duplicate Account row. `accountRowIDs` was missing the `"Request log"` label map (label-based `visitAccountRow` could not resolve it); added so the dict stays in sync with `allAccountNavigationRowIDs` (still one id).
- Expected: Exactly one Account row identifier after the move.
- Actual: Match. No leftover Diagnostics duplicate.
- Remediation: label-map sync only.
- Confidence: 10

### [SIM-TEST.1] Harness-without-credentials Keychain restore
- Status: FIXED
- Severity: major
- Surface: `AuthViewModel.init` / `LaunchTestAuth`
- Evidence: Skip already ran when `isActive || isHarness`. `isHarness` only accepted `NOMARKUP_UI_TESTING == "1"` (not `true`/`yes`). Skip was not unit-tested. `restoreSessionIfPossible()` still runs for DEBUG dogfood (no harness flags) — **intentional**. `#Preview` `AuthViewModel()` also restores (preview process, not the app). No other `restoreSessionIfPossible` call site. `applyLaunchTestCredentialsIfNeeded()` does not restore; it logs in or returns false.
- Expected: XCUITest with `-ui-testing` and no email/password never adopts a leftover dogfood session (`testAccessibilityAuditLoginScreen`).
- Actual: `== "1"` only; `true` would have restored.
- Remediation: `LaunchTestAuth.shouldSkipKeychainRestore(environment:arguments:)` (injectable). Truthy flags `1` / `true` / `yes`. Init uses that helper. Unit: `AppConfigTests.testHarnessWithoutCredentialsSkipsKeychainRestore` **PASS** on iPhone 17e clone (0.001s).
- Retest: `xcodebuild test -only-testing:NoMarkupTests/AppConfigTests` → `testHarnessWithoutCredentialsSkipsKeychainRestore` passed.
- Confidence: 9

### [SIM-UI.32] Force-unwrap crash paths on Account destinations skipped in test07
- Status: PASS
- Severity: advisory
- Surface: Account rows after Session (providers → legal → delete/plan/flags) that test07 historically missed when swipe cap was 6
- Evidence: `rg 'try!|as!|fatalError|preconditionFailure|\.first!|\.last!' ios/NoMarkup` → **none** in product Features. Remaining `URL(string:)!` are compile-time constants (`https://no-markup.com`, `mailto:support@…`). Destinations that test07 screenshots skipped (Following, Feed, Properties, Blocked users, Referrals, NPS, Savings, Markets, Fair price, Trust tiers, Terms acceptance, Plan limits, Delete account) all have loading / error / empty `BrandEmptyState` — no IUO unwrap on empty seed. `LazyView` defers destination init (thread-stack, not unwrap).
- Expected: Opening a skipped row does not crash on empty seed / 401.
- Actual: Fail-soft empties. test07 recover (`test07ProviderMoneyHubWalk-46-prov-hub-recover-login-form.png`) is SIM-UI.10 session expiry, not a force unwrap.
- Remediation: none. Row ids still exercised by `visitAllAccountRowsByID` (maxSwipes 24).
- Confidence: 8

---

## Fixes applied (no commit)

| File | Change |
|------|--------|
| `ios/NoMarkup/Features/ListingDetailView.swift` | `listingDetail.report` / `.openWeb`; tab-bar clearance; `listingReport.*` sheet ids |
| `ios/NoMarkup/Features/JobDetailView.swift` | `jobReport.*` sheet ids |
| `ios/NoMarkup/Features/AuctionReplayView.swift` | `auctionReplay.{loading,error,empty}` |
| `ios/NoMarkup/Features/MessagesView.swift` | extras ids; empty Share disabled; empty report sheet; thread settle ids |
| `ios/NoMarkup/Features/OnboardingWizardView.swift` | `onboarding.*` root/fields/skip/continue/empty |
| `ios/NoMarkup/Features/ClientActionLogView.swift` | `requestLog.empty` / `.loading` |
| `ios/NoMarkup/Auth/AuthViewModel.swift` | injectable `shouldSkipKeychainRestore`; truthy `1/true/yes` |
| `ios/NoMarkupTests/AppConfigTests.swift` | harness-without-credentials skip test |
| `ios/NoMarkupUITests/ScreenshotWalkUITests.swift` | `"Request log"` → `account.row.requestLog` in label map |

Product UITest rebuild / install: **not** run on reserved FullSim devices. Unit: AppConfigTests **PASS** (`/tmp/NoMarkupGapHunt2DD`, iPhone 17e clone).

---

## Residuals (not this cycle)

- Visual listing report / replay / Finish setup / Messages extras on a live sim — **BLOCKED** (reserved devices).
- Camera attach **sim N/A** (`messages.camera` disabled when source unavailable).
- Report / share / OTP / propose-terms **submit** = founder (mutations). Open + Cancel only.
- SIM-UI.10 session expiry during long Account walks (`02-ui.md` / test07 recover shot).
- Provider-money Account rows visible to customer-only (SIM-UI.20 RISK, unchanged).
- Request log Clear is device-local (SIM-WIRE.6 RISK, unchanged).
- DEBUG dogfood (no `-ui-testing`) **still restores Keychain** — intentional; only harness/scaffold/env-login skip.
