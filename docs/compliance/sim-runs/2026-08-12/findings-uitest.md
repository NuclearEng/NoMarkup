# SIM-TEST findings — 2026-08-12

- **Target**: NoMarkup (`ios/NoMarkup.xcodeproj`, scheme NoMarkup)
- **Simulator**: iPhone 17 Pro `7F123C44-2F2C-442B-90A6-92DE8E548510` / iOS 26.5 (23F77)
- **API**: `http://127.0.0.1:8081` health 200
- **Derived data**: `/tmp/iphone-sim-test-dd`
- **Result bundles**:
  - Unit: `/tmp/iphone-sim-2026-08-12-unit.xcresult`
  - UI: `/tmp/iphone-sim-2026-08-12-ui.xcresult` (copy: `/tmp/iphone-sim-2026-08-12.xcresult`)
  - Retest: `/tmp/iphone-sim-2026-08-12-retest.xcresult`
- **Logs**: `/tmp/iphone-sim-2026-08-12-unit.log`, `/tmp/iphone-sim-2026-08-12-ui.log`, `/tmp/iphone-sim-2026-08-12-retest.log`
- **Attachments**: `docs/compliance/sim-runs/2026-08-12/xcuitest-attachments/`
- **Mode**: fix · **Depth**: deep

## One-line section summary

Unit 120/120 after wiring WorkEvidence; UI 20/20 after fixing a `$500`≠HTTP-500 false positive; 29 unique walk soft-skips remain GAP (tab-bar lost mid-Account sweep).

## Exact counts

| Suite | Pass | Fail | XCTSkip | Soft-skip (GAP) | Notes |
|-------|-----:|-----:|--------:|----------------:|-------|
| NoMarkupTests (first run) | 114 | 0 | 0 | 0 | 18 classes, `** TEST SUCCEEDED **` |
| WorkEvidenceTests (wired + retest) | 6 | 0 | 0 | 0 | Was not in `pbxproj` |
| **Unit combined** | **120** | **0** | **0** | **0** | |
| NoMarkupUITests (11) | 11 | 0 | 0 | 0 | Smoke + roles |
| ScreenshotWalkUITests (8) | 8 | 0 | 0 | 29 unique / 53 log lines | Soft-skips ≠ PASS |
| TabAuditUITests (first) | 0 | 1 | 0 | 1 WARN | `$500.00` matched as HTTP 500 |
| TabAuditUITests (retest) | 1 | 0 | 0 | 1 WARN `home.browseJobs` | Predicate fixed |
| **UI after fix** | **20** | **0** | **0** | **see SIM-TEST.5–.9** | `** TEST SUCCEEDED **` on retest |

No `XCTSkipIf` fired (seed credentials present).

---

### [SIM-TEST.1] Unit harness is green (114 → 120)
- Status: PASS
- Severity: advisory
- Surface: NoMarkupTests on iPhone 17 Pro
- Evidence: `xcrun xcresulttool get test-results summary --path /tmp/iphone-sim-2026-08-12-unit.xcresult` → `passedTests: 114`, `failedTests: 0`, `skippedTests: 0`, `result: Passed`. Suites: APIClientAuthRetryTests (4), AppConfigTests (11), AppIntentsAuthGuardTests (14), AppIntentsEntityTests (5), ChatMediaURLTests (3), CreateJobScheduleTests (5), DateFormattingTests (5), DeepLinkOrdersRouteTests (8), ImageUploaderTests (10), KeychainTokenStoreTests (4), ListingPromotionTests (4), LocalizedPluralsTests (8), MoneyFormatTests (5), NotificationActionBranchTests (2), NotificationDeepLinkTests (12), ProviderBackgroundCheckDecodingTests (3), SoftTravelETATests (7), WidgetSharedStoreTests (4). Retest added WorkEvidenceTests (6).
- Expected: All compiled unit tests run and pass.
- Actual: 114/114 first pass; 6 additional after target membership.
- Remediation: n/a
- Confidence: 10

### [SIM-TEST.2] WorkEvidenceTests.swift existed but was not in the test target
- Status: FIXED
- Severity: advisory
- Surface: `ios/NoMarkupTests/WorkEvidenceTests.swift` / `project.pbxproj`
- Evidence: First-run suite list omitted WorkEvidenceTests. `grep WorkEvidenceTests ios/NoMarkup.xcodeproj/project.pbxproj` was empty. File defines 6 cases (`testDecodesNotReadyPack`, `testDecodesReadyPackWithSessionAndPhoto`, `testOpenSessionIsInProgress`, `testRejectsNonAllowlistedPhotoHost`, `testBlockedCopyNamesBothRequirements`, `testListLabels`).
- Expected: Every file under `NoMarkupTests/` is compiled into the target.
- Actual: Orphan file on disk; 0 cases executed.
- Remediation: Added `T1000000000000000000000C/1C` fileRef + Sources membership.
- Retest: `xcodebuild test … -only-testing:NoMarkupTests/WorkEvidenceTests` → 6 passed (0.000–0.008s). `/tmp/iphone-sim-2026-08-12-retest.xcresult` `passedTests: 7` (6 unit + TabAudit).
- Confidence: 10

### [SIM-TEST.3] UI suite first run: 19 pass / 1 fail / 0 skip
- Status: FAIL
- Severity: major
- Surface: NoMarkupUITests full target
- Evidence: `/tmp/iphone-sim-2026-08-12-ui.xcresult` summary `passedTests: 19`, `failedTests: 1`, `skippedTests: 0`. Sole failure: `TabAuditUITests/testTabsCustomerAndProviderAudit()` (155.080s). All 11 `NoMarkupUITests` + all 8 `ScreenshotWalkUITests` passed as XCTest cases. Superseded by SIM-TEST.4.
- Expected: 20/20 hard assertions green (soft-skips tracked separately).
- Actual: TabAudit hard-failed; walk/smoke green at XCTest layer.
- Remediation: See SIM-TEST.4.
- Confidence: 10

### [SIM-TEST.4] TabAudit false-positive: `$500.00` treated as HTTP 500
- Status: FIXED
- Severity: major
- Surface: TabAudit `noteAPIErrorIfPresent("jobs")` / Jobs list
- Evidence: Failure text: `XCTAssertTrue failed - Hard fails: FAIL jobs shows API error: LIVE REVERSE AUCTION, · Ends in 2d, E2E provider bid target 1786581555, $500.00, Starting, Bid down, Status Active, Plumbing, Austin, TX, 1 bid, Ends in 2d`. Screenshot: `docs/compliance/sim-runs/2026-08-12/xcuitest-attachments/09-ERR-jobs-api-false-positive.png`. Predicate was `label CONTAINS[c] "500"`. Seed job start price is `$500.00`. After predicate change, findings no longer include that FAIL (`tab-audit-findings.txt`).
- Expected: Only real API/server-error chrome flags FAIL.
- Actual: Healthy jobs list with `$500.00` tripped the harness.
- Remediation: Match `server error` / `HTTP 500` / `internal server` only (`TabAuditUITests.swift` `noteAPIErrorIfPresent`).
- Retest: `-only-testing:NoMarkupUITests/TabAuditUITests` → passed (152.800s). Findings: `Jobs settle: jobs.list`, `PASS opened first job`, `PASS provider place-bid UI`, no FAIL lines. `** TEST SUCCEEDED **`.
- Confidence: 10

### [SIM-TEST.5] Screenshot walk lost tab bar mid-Account sweep
- Status: GAP
- Severity: major
- Surface: ScreenshotWalk `test02CustomerAccountWalk` after Following
- Evidence: 24× `WALK-SKIP tab-Account — no tab bar control found` in `/tmp/iphone-sim-2026-08-12-ui.log` starting 18:18:04 (immediately before `account-following-feed`). `test06` logged `WALK-SKIP cust-mid-sweep-recovery — tab shell lost before account.row.following; cold relaunch once` at 19:10:46. Soft-skip dump: `docs/compliance/sim-runs/2026-08-12/xcuitest-attachments/walk-skips-summary.txt`. XCTest still marked test02/test06 **Passed**.
- Expected: After each Account destination, `popToRoot("Account")` can retap the tab bar.
- Actual: Tab chrome gone after Following / Following feed; remaining rows soft-skipped until test06 cold-relaunched.
- Remediation: Product: keep `root.tabview` after Account NavigationLinks (especially Following). Harness already recovers once in test06.
- Confidence: 8

### [SIM-TEST.6] Account rows soft-skipped after tab-bar loss (cascade)
- Status: GAP
- Severity: major
- Surface: Account hub rows in `test02CustomerAccountWalk`
- Evidence: Unique WALK-SKIPs (each 1×, all `not found/hittable`): following-feed, properties, wishlist, blocked-users, referrals, feedback-surveys, trust-tiers, savings, markets, terms-acceptance, privacy, terms, community, support, delete-screen-only, plan-limits, feature-flags, recurring-jobs, positions-blotter, insurance-quote, payments-history, fair-price, marketplace-map. These are the rows *after* Following in the ordered walk. test06 recovered the shell and only then skipped `account.row.admin` (role-gated).
- Expected: Every `account.row.*` that exists for the customer seed is opened, or a single justified skip.
- Actual: Cascade skips because `openTab("Account")` could not find the tab bar — not independent missing rows.
- Remediation: Same as SIM-TEST.5; do not treat XCTest Passed as coverage of these destinations.
- Confidence: 8

### [SIM-TEST.7] Admin console horizontal tabs not hittable
- Status: GAP
- Severity: advisory
- Surface: `test05AdminSessionWalk` admin console capsule strip
- Evidence: `WALK-SKIP admin-console-tab-{disputes,users,fraud,jobs} — tab control not on-screen after horizontal swipe` (18:54:34–47). test05 still passed (console root + no crash asserted). test08 opened console and snapped Flags/Disputes/Users without hard-fail.
- Expected: Disputes / Users / Fraud / Jobs tabs tappable after horizontal swipe of `admin.console.tabs`.
- Actual: Geometry/`safeTap` missed off-screen capsules; recorded skip instead of fail.
- Remediation: Tighten `tapAdminConsoleTab` (id-only, larger swipe) or expose always-hittable tab ids.
- Confidence: 7

### [SIM-TEST.8] Customer Account sweep skips Admin console (role-gated)
- Status: GAP
- Severity: advisory
- Surface: `test06CustomerAccountRowIDSweep` / `account.row.admin`
- Evidence: `WALK-SKIP cust-row-admin — Account row id 'account.row.admin' not found/hittable`. Inventory: admin row is role-gated. Admin seed covered by test05/test08 (hard assert console opens).
- Expected: Customer seed does not show Admin console; admin seed does.
- Actual: Soft-skip on customer (correct product), not a hard assertion of absence.
- Remediation: Optional: assert `account.row.admin` **absent** for customer instead of skip.
- Confidence: 9

### [SIM-TEST.9] TabAudit WARN: home.browseJobs not in AX tree
- Status: GAP
- Severity: advisory
- Surface: Home hero CTA
- Evidence: Post-fix `tab-audit-findings.txt`: `PASS home.hero`, `WARN missing home.browseJobs`, `PASS home.marketDesk`. Identifier exists at `HomeView.swift:190` on “Browse open jobs”. `testHomeHeroAndMarketDesk` passed via hero id / copy fallback.
- Expected: `home.browseJobs` visible with `home.hero`.
- Actual: Nested identifier not found by TabAudit `byID` at check time (below-fold / AX flattening).
- Remediation: Confirm on a follow-up Home screenshot; do not fail product on this WARN alone.
- Confidence: 6

### [SIM-TEST.10] App would not compile for UI tests (two product breaks)
- Status: FIXED
- Severity: blocker
- Surface: Build of NoMarkup for UI test install
- Evidence:
  1. `NotificationsView.swift:427` `call to main actor-isolated static method 'isAllowedIncomingURL' in a synchronous nonisolated context` (`/tmp/iphone-sim-2026-08-12-ui.log` first attempt).
  2. `APIClient+Extras.swift:516` `cannot find type 'SetDefaultPaymentMethodResponse' in scope` (second attempt). Gateway returns `{ "is_default": true }` (`gateway/internal/handler/payment.go:363-365`).
- Expected: Debug app compiles so XCUITest can launch.
- Actual: UI tests cancelled (`Testing cancelled because the build failed`).
- Remediation: `nonisolated static func isAllowedIncomingURL` in `DeepLinkRouter.swift`; added `SetDefaultPaymentMethodResponse` in `Models+Extras.swift`.
- Retest: Subsequent `xcodebuild test-without-building` launched 20 UI cases; unit+UI retest `** TEST SUCCEEDED **`.
- Confidence: 10

### [SIM-TEST.11] Credentialed login / tab shell / catalog settle
- Status: PASS
- Severity: advisory
- Surface: Login, 5-tab shell, marketplace, jobs, roles
- Evidence: `testColdLaunchShowsLoginOrTabs` 7.4s; `testLoginWithEnvCredentials` 11.6s; `testSignedInTabNavigation` 31.9s; `testHomeHeroAndMarketDesk` 24.0s; `testJobsBrowseSettles` 34.7s; `testMarketplaceOpenFirstListing` 35.1s; `testAccountHubLinks` 185s; `testAccountCriticalMoneyRows` 71.9s; `testRoleShell{Customer,Provider,Admin}` 49–60s. `test01CustomerCoreWalk` 150.6s opened marketplace list, listing bid UI, jobs list, messages composer. TabAudit retest: marketplace.list, jobs.list, messages composer, provider place-bid UI.
- Expected: Seed accounts reach `root.tabview`; catalogs settle; first listing/job open.
- Actual: Exercised successfully. No XCTSkip.
- Remediation: n/a
- Confidence: 9

### [SIM-TEST.12] Final harness health after fix loop
- Status: PASS
- Severity: advisory
- Surface: xcodebuild unit + UI
- Evidence: Unit 120/120 (114+6). UI 20/20 after TabAudit retest. Residual is soft-skip GAP (SIM-TEST.5–.9), not open FAIL. Backend health 200 throughout. Destination stayed on `7F123C44…` (no reserved sims used).
- Expected: No open blocker FAIL; soft-skips labeled GAP.
- Actual: Matches.
- Remediation: n/a
- Confidence: 10

## Fixes applied

| File | Change | Retest |
|------|--------|--------|
| `ios/NoMarkup/Core/DeepLinkRouter.swift` | `nonisolated` on `isAllowedIncomingURL` | App compiled; UI launched |
| `ios/NoMarkup/Core/Models+Extras.swift` | `SetDefaultPaymentMethodResponse` (`isDefault`) | App compiled |
| `ios/NoMarkupUITests/TabAuditUITests.swift` | Stop matching substring `500` | TabAudit passed 152.8s |
| `ios/NoMarkup.xcodeproj/project.pbxproj` | Add `WorkEvidenceTests.swift` to NoMarkupTests | 6/6 passed |

No commit (per constraints).

## Residuals

- **SIM-TEST.5/6** — Account tab chrome lost after Following (product + harness). Owner: eng.
- **SIM-TEST.7** — Admin capsule tabs not hittable. Owner: eng / harness.
- **SIM-TEST.8** — Customer admin row skip (expected). Owner: none.
- **SIM-TEST.9** — `home.browseJobs` WARN. Owner: eng (advisory).

## Commands to reproduce

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
xcodebuild test -project ios/NoMarkup.xcodeproj -scheme NoMarkup \
  -destination 'platform=iOS Simulator,id=7F123C44-2F2C-442B-90A6-92DE8E548510' \
  -derivedDataPath /tmp/iphone-sim-test-dd \
  -only-testing:NoMarkupTests \
  -resultBundlePath /tmp/iphone-sim-2026-08-12-unit.xcresult

xcodebuild test -project ios/NoMarkup.xcodeproj -scheme NoMarkup \
  -destination 'platform=iOS Simulator,id=7F123C44-2F2C-442B-90A6-92DE8E548510' \
  -derivedDataPath /tmp/iphone-sim-test-dd \
  -only-testing:NoMarkupUITests \
  -parallel-testing-enabled NO \
  -resultBundlePath /tmp/iphone-sim-2026-08-12-ui.xcresult \
  NOMARKUP_API_BASE_URL=http://127.0.0.1:8081
```
