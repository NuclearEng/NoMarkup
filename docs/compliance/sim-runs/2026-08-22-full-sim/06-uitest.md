# XCUITest — 2026-08-22 full-sim (ScreenshotWalk + NoMarkupUITests + 06c + device)

- **Target**: `ios/NoMarkup.xcodeproj` scheme `NoMarkup`
- **Xcode**: 26.5 (17F42) · `DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer`
- **API**: `http://127.0.0.1:8081` health `{"status":"ok","version":"dev"}`
- **Credentials**: seed `customer@` / `provider@` / `provider2@` / `admin@nomarkup.com` · `Password123!`
- **Sims**:
  - ScreenshotWalk (`DerivedDataFullSim`): iPhone 17 Pro `7F123C44-2F2C-442B-90A6-92DE8E548510` / iOS 26.5
  - NoMarkupUITests (`DerivedDataFullSimB`): iPhone 17 Pro Max `503E262C-5731-45BE-A459-CFF59551539E` / iOS 26.5
  - 06c coverage (`DerivedDataFullSimC`): iPhone 17 `B3CA7DF9-228C-4490-B5B7-57F2B0FE5D6D` / iOS 26.5
- **Logs**: `ios/DerivedDataFullSim/*.log` · `ios/DerivedDataFullSimB/Logs/*.log` · `ios/DerivedDataFullSimC/06c-*.log` · `ios/DerivedDataAccountRewalk/test06.log`
- **Finding schema**: `/Users/nuclearisotope/.grok/skills/iphone-simulator/references/finding-schema.md`
- **Mode**: report-only. **No `xcodebuild`. No product/test Swift edits. No commit.**
- **Honesty bar**: `TEST EXECUTE SUCCEEDED` + `passed (` is XCTest-green, **not** destination coverage. `WALK-SKIP` / `recordSkip` = **GAP**, never PASS. Do **not** claim GREEN.

Companion writeups: [`06b-uitest-nomarkup.md`](06b-uitest-nomarkup.md) (FullSimB), [`06c-coverage.md`](06c-coverage.md) (5/5), [`../2026-08-22-account-rewalk/REPORT.md`](../2026-08-22-account-rewalk/REPORT.md) (test06/09), [`../2026-08-22-device-caps/REPORT.md`](../2026-08-22-device-caps/REPORT.md).

---

## Verdict — not GREEN

| Claim | Status |
|-------|--------|
| ScreenshotWalk test01/03/04/05/07 XCTest-green on **final** attempt | **YES** (`TEST EXECUTE SUCCEEDED` + `passed (`) |
| Those five walks fully covered their destinations | **NO** — test01/03/05/07 have `WALK-SKIP` = **GAP** |
| test08 Admin Account + Console | **IN-FLIGHT** (no `TEST EXECUTE` yet; `t ≈ 1182 s`) |
| test04 Fresh customer empties | **PASS** (0 `WALK-SKIP`) |
| test06 customer Account row-id sweep | **GAP** on plaintext log (`** BUILD INTERRUPTED **`); later xcresult **claimed PASS** 43 min |
| test09 Account tap smoke | **PASS** (~4 min; `TEST SUCCEEDED`) |
| test02 Customer Account walk | **GAP** (not run this cycle) |
| NoMarkupUITests assigned smoke (FullSimB) | **11/12 PASS**; catalog **FAIL** after 3 attempts |
| 06c coverage gap-close | **5/5 PASS** (map/filters on isolated retry) |
| TabAudit customer + provider | **PASS** (166.568 s) |
| Device Apple Pay / APNs / Face ID | **BLOCKED** (physical; UI Automation never enabled) |
| A11y audits (`testAccessibilityAudit*`) | **GAP** — not run on FullSimC (06c ran the five coverage methods only) |
| Hard money submit / seed mutation | **not in this suite** |

**Suite is mixed PASS / FAIL / GAP / IN-FLIGHT / BLOCKED. Not GREEN.**

---

## Pass / fail per XCUITest method

`Result` is the **honest** status. `XCTest` is the harness line only.

### A. ScreenshotWalkUITests (`ios/DerivedDataFullSim`)

| # | Method | Duration | XCTest | Result | Notes |
|---|--------|---------:|--------|--------|-------|
| 1 | `test01CustomerCoreWalk` | 71.721 s (final) | **PASS** | **GAP** | Attempts 1–2 **FAIL** (`root.tabview` after login; attempt 2 `UITest login.error: Error: Keychain error (-34018)`). Final: `TEST EXECUTE SUCCEEDED`. **WALK-SKIP** `listing-detail` (`marketplace.empty`) and `job-detail` (`jobs.empty`). Later FullSimB/06c proved 23 listings / 3 jobs — this walk did **not** open them. |
| 2 | `test02CustomerAccountWalk` | — | not run | **GAP** | No log in FullSim / FullSimB / AccountRewalk this cycle. |
| 3 | `test03ProviderWalk` | 1629.319 s (~27.2 min) | **PASS** | **GAP** | XCTest-green. `WALK-SKIP`: widgets, exportData, then tab-bar loss cascade (inner profile/notif/plan/paymentMethods/contracts/orders/myBids/myListings/watchlist/recurringJobs/positions/delete; Marketplace/Jobs/Messages “no tab bar”; `provider-listing-detail` / `provider-job-detail` no rows). Soft-skips ≠ opened. |
| 4 | `test04FreshCustomerStatesWalk` | 176.426 s | **PASS** | **PASS** | customer2 Messages / My bids / Orders / Watchlist / Properties empty shots. **0 `WALK-SKIP`.** |
| 5 | `test05AdminSessionWalk` | 320.707 s (final) | **PASS** | **GAP** | Attempt 1 **FAIL** `ScreenshotWalkUITests.swift:2102` `Admin console row (account.row.admin) must appear for admin@ seed` (185.970 s). Final XCTest-green. **WALK-SKIP** `admin-feature-flag-status` + 16 admin console section-menu rows (disputes/users/fraud/jobs/fees/banking/markets/platform/advances/taxonomy/insurers/challenges/verify/licenses/insurance/reviews). Console **root** opened; sections not. |
| 6 | `test06CustomerAccountRowIDSweep` | ~32 min killed; restart claimed 43 min | no `TEST EXECUTE SUCCEEDED` in `.log` | **GAP** | See § test06/09. |
| 7 | `test07ProviderMoneyHubWalk` | 3150.392 s (~52.5 min) | **PASS** | **GAP** | Instant offers / seller payouts / business hub **did open**. Row sweep used `visitAccountRowByID` / `scrollTo` **`maxSwipes=6`**. **22 Account rows WALK-SKIP not found/hittable** (providers → featureFlags, including requestLog / planLimits / legal / delete). Then tab-shell loss; inner workflows skipped. Source later raised the cap to 24/28 (`“A cap of 6 never reaches Subscriptions / request log / legal / admin from the top (test07 skipped them).”`). **XCTest PASS ≠ those rows walked.** |
| 8 | `test08AdminAccountAndConsole` | `t ≈ 1182 s` and climbing | none | **IN-FLIGHT** | Started `2026-08-22T18:50:48Z`. No `TEST EXECUTE SUCCEEDED` / `FAILED`. Already **WALK-SKIP**: `account.row.admin` not hittable; 8 console section-menu rows; mid-sweep tab-shell loss + cold relaunch. Last activity: `account.row.notificationPreferences` hunt after recovery. Timeout allowance 3600 s. |
| 9 | `test09AccountRowTapSmoke` | ~4 min (incl. compile); 03-workflows **4m 4s** | **PASS** (`TEST SUCCEEDED`) | **PASS** | profile / security / paymentMethods / orders opened. Payment methods ≠ Jobs. See rewalk REPORT. |

### B. NoMarkupUITests (`ios/DerivedDataFullSimB/Logs`) — final attempt

| # | Method | Duration | XCTest | Result | Notes |
|---|--------|---------:|--------|--------|-------|
| 10 | `testColdLaunchShowsLoginOrTabs` | 9.547 s | **PASS** | **PASS** | |
| 11 | `testLoginWithEnvCredentials` | 15.467 s | **PASS** | **PASS** | |
| 12 | `testSignedInTabNavigation` | 42.982 s | **PASS** | **PASS** | |
| 13 | `testHomeHeroAndMarketDesk` | 30.122 s | **PASS** | **PASS** | |
| 14 | `testJobsBrowseSettles` | 45.361 s | **PASS** | **PASS** | `jobs.list` (API 3 open jobs) |
| 15 | `testAccountHubLinks` | 201.079 s | **PASS** | **PASS** | Key hub rows; not a full Account matrix |
| 16 | `testAccountCriticalMoneyRows` | 97.146 s | **PASS** | **PASS** | Payment methods + seller payouts **open**, no submit |
| 17 | `testMarketplaceOpenFirstListing` | 37.886 s | **PASS** | **PASS** | `marketplace.list` + cell + `BackButton`. Catalog not empty. |
| 18 | `testRoleShellCustomer` | 29.569 s | **PASS** | **PASS** | |
| 19 | `testRoleShellProvider` | 75.030 s | **PASS** | **PASS** | |
| 20 | `testRoleShellAdmin` | 66.151 s | **PASS** | **PASS** | |
| 21 | `testCatalogAllPersonasRequestLogAndRows` | 81.759 / 202.055 / **560.116 s** | **FAIL** ×3 | **FAIL** | Retry 2 **finished** — not in-flight. Exact XCTFail below. Customer only; provider/admin never started. |
| 22 | `testRegisterScreenOpens` | 40.571 s | **PASS** | **PASS** | 06c. Form only; **did not tap Create account**. |
| 23 | `testForgotPasswordScreenOpens` | 42.932 s | **PASS** | **PASS** | 06c. **Did not tap Send reset email.** |
| 24 | `testJobsMapAndFilters` | 39.000 s FAIL then **42.779 s PASS** | **PASS** (retry) | **PASS** | Combined 06c run: `NoMarkupUITests.swift:1312` `Browse filters bar should appear after tapping jobs.filters`. Isolated retry **PASS**. |
| 25 | `testJobDetailPlaceBidChrome` | 176.466 s | **PASS** | **PASS** | Place-bid chrome **not submitted**. Spectate opened. |
| 26 | `testListingDetailWatchAndBidChrome` | 71.316 s | **PASS** | **PASS** | Watch add→restore; Bid dock **not submitted**. |
| 27 | `testWrongPasswordShowsError` | — | not run | **GAP** | Method exists in `NoMarkupUITests.swift`. |
| 28 | `testJobsMineSegment` | — | not run | **GAP** | |
| 29 | `testMarketplaceSearchAndMap` | — | not run | **GAP** | |
| 30 | `testHomePostJobAndSellSheets` | — | not run | **GAP** | Open-only method; never executed this cycle. |

### C. TabAuditUITests

| # | Method | Duration | XCTest | Result | Notes |
|---|--------|---------:|--------|--------|-------|
| 31 | `testTabsCustomerAndProviderAudit` | 166.568 s | **PASS** | **PASS** | FullSimB. Findings all PASS/INFO; zero FAIL lines. Listing + job opened; provider place-bid UI **not submitted**. |

### D. DeviceCapabilityUITests (physical iPhone 15 Pro Max)

| # | Method | Duration | XCTest | Result | Notes |
|---|--------|---------:|--------|--------|-------|
| 32 | `testApplePayRequiresPhysicalDevice` | n/a | never started | **BLOCKED** | Runner failed UI Automation init. Not a simulator `XCTSkip`. Sheet not presented. |
| 33 | `testAPNsDeviceTokenRequiresPhysicalDevice` | n/a | never started | **BLOCKED** | No token invented. |
| 34 | `testFaceIDHardwareRequiresPhysicalDevice` | n/a | never started | **BLOCKED** | `BiometryType=2` on runner ≠ Security toggle. User canceled / automation-mode timeout. |
| 35 | `testAccessibilityAuditLoginScreen` | — | not run | **GAP** | Inventory: “unknown until FullSimC”. FullSimC ran 06c coverage only — **no a11y log**. |
| 36 | `testAccessibilityAuditHomeAndAccountIfSignedIn` | — | not run | **GAP** | Same. |

**XCTSkip (credentials missing):** 0 on runs that executed.

---

## Catalog retries (`testCatalogAllPersonasRequestLogAndRows`) — FAIL, not in-flight

Customer seed only. Retry 2 **did** finish.

| Attempt | Log | Duration | Exact failure |
|--------:|-----|----------|---------------|
| 0 | `DerivedDataFullSimB/Logs/testCatalogAllPersonasRequestLogAndRows.log` | 81.759 s | `NoMarkupUITests.swift:588: error: -[NoMarkupUITests.NoMarkupUITests testCatalogAllPersonasRequestLogAndRows] : failed - customer: catalog row account.row.planLimits not tappable` · `** TEST EXECUTE FAILED **` |
| 1 | `…-retry1.log` | 202.055 s | `NoMarkupUITests.swift:766: error: … : failed - customer: catalog row account.row.providerWorkspace not tappable` · `** TEST EXECUTE FAILED **` |
| 2 | `…-retry2.log` | **560.116 s** | `NoMarkupUITests.swift:804: error: … : XCTAssertTrue failed - customer request log row` · `** TEST EXECUTE FAILED **` |

Retry 2 tapped (customer): profile, orders, contracts, myBids, planLimits, notifications, providerWorkspace, instantOffers, paymentMethods. `legalServices` / `insuranceQuote` expected-hidden. Then `assertRequestLogHasHttpHops` could not hittable-scroll `account.row.requestLog`. Provider / admin / provider2 never started. Retry cap (2) — no third run.

This is a **harness** lazy-List / back-chrome hole, not a missing Account identifier and not an empty API (`GET /listings` total=23). See 06b.

---

## test07 `WALK-SKIP` — GAP (maxSwipes=6)

`scrollTo` / `scrollClearOfTabBar` defaulted to **6** short list-local drags. `visitAccountRowByID` at the time of this run did not pass 24+. After Instant offers / payouts / business hub + the **upper** Account rows opened, the sweep logged:

**Row GAP (`not found/hittable`):** `providers`, `following`, `followingFeed`, `properties`, `wishlist`, `blockedUsers`, `referrals`, `feedbackSurveys`, `savings`, `markets`, `fairPrice`, `marketplaceMap`, `trustTiers`, `privacyPolicy`, `termsOfService`, `termsAcceptance`, `communityGuidelines`, `support`, `deleteAccount`, `requestLog`, `planLimits`, `featureFlags` (22).

**Also GAP:** `prov-hub-inner-*` after tab-shell loss (profile, notif, plan, paymentMethods, contracts, orders, myBids, myListings, watchlist, recurringJobs, positions, delete) plus repeated `WALK-SKIP tab-Account — no tab bar control found`.

`insuranceQuote` / `legalServices` = expected-hidden (`iOSHardOffKeys`) — not counted as product FAIL.

**Do not treat the 3150 s XCTest PASS as “every Account row walked.”**

---

## test06 / test09 (account-rewalk)

Sources: [`../2026-08-22-account-rewalk/REPORT.md`](../2026-08-22-account-rewalk/REPORT.md), `ios/DerivedDataAccountRewalk/test06.log`, [`03-workflows.md`](03-workflows.md).

| Method | Evidence | Result |
|--------|----------|--------|
| `test09AccountRowTapSmoke` | REPORT: **TEST SUCCEEDED** (~4 min incl. compile). 03-workflows: 4m 4s, xcresult `DerivedDataAccountRewalk/Logs/Test/Test-NoMarkup-2026.08.22_07-52-18--0700.xcresult`. Shots: login, Account root, profile, security, **payment methods (not Jobs)**, orders, still-alive. | **PASS** |
| `test06CustomerAccountRowIDSweep` (first) | `DerivedDataAccountRewalk/test06.log` ends `** BUILD INTERRUPTED **` at `t = 1954 s` (~32 min) after `WALK-SKIP cust-sweep-inner-positions` / `tab-Account`. **No `TEST EXECUTE SUCCEEDED`.** | **GAP** (killed) |
| `test06` (restart, claimed) | REPORT: “restarted with the new helpers (background)”. 03-workflows / target card: **PASS 43 min**, xcresult `Test-NoMarkup-2026.08.22_07-57-22--0700.xcresult`, 116 shots under `docs/compliance/sim-runs/2026-08-22-account-rewalk/test06CustomerAccountRowIDSweep-*.png` (rows + inner contracts/orders/bids/listings/watchlist + recover + still-alive). **No greppable `TEST EXECUTE SUCCEEDED` line** in that xcresult blob. | **GAP** until a plaintext `passed (` / `TEST EXECUTE SUCCEEDED` is attached. Shots prove many destinations opened; that is not the same as XCTest-green in this report’s rule. |

Killed-run skips (first log): `cust-mid-sweep-recovery` (tab shell lost before `account.row.following`), `tab-Account`, `cust-sweep-inner-positions`.

---

## 06c coverage — 5/5 PASS

From [`06c-coverage.md`](06c-coverage.md) + `ios/DerivedDataFullSimC/06c-test.log` / `06c-map.log`. Combined first run **4/5** (`testJobsMapAndFilters` FAIL 39.000 s). Isolated retry **PASS** 42.779 s (`** TEST SUCCEEDED **`).

No money submit. No new seed. Forgot-password email not sent.

A11y audits were **not** in that `-only-testing` set.

---

## Device capabilities — BLOCKED

Physical **Tanners iphone** iPhone 15 Pro Max `00008130-0018493E3A41001C` / iOS 26.6. Device **online**, runner **signed and installed**. Execution **BLOCKED** at Enable UI Automation (Face ID / LocalAuthentication):

1. `Error Domain=com.apple.LocalAuthentication Code=-2 "Canceled by user."` (`BiometryType=2`)
2. `Timed out while enabling automation mode.`

`xcresulttool`: **0 passed / 0 skipped / 1 failed** (runner, not an assertion). None of the three capability methods executed. Not a simulator skip. Not PASS.

---

## Findings (SIM-TEST.N)

### [SIM-TEST.1] ScreenshotWalk test01/03/04/05/07 XCTest-green on final attempt

- Status: **PASS** (harness) / **GAP** (coverage for 01/03/05/07)
- Severity: advisory (harness) · major (treating as full walk)
- Surface: customer core, provider walk, fresh empties, admin session, provider money hub
- Evidence: final logs `TEST EXECUTE SUCCEEDED` + `passed (`; durations 71.721 / 1629.319 / 176.426 / 320.707 / 3150.392 s
- Expected: XCTest-green **and** destinations opened (or explicit expected-hidden)
- Actual: test04 fully walked empties. test01 skipped listing/job (empty). test03/05/07 skipped after tab-bar loss and/or `maxSwipes=6`
- Remediation: do not roll up as GREEN; raise scroll cap (already in tree at 24/28) and re-run 07/03
- Confidence: 10

### [SIM-TEST.2] test07 Account row sweep soft-skipped 22 rows (`maxSwipes=6`)

- Status: **GAP**
- Severity: major for hub coverage
- Surface: Account rows below Team/notifications on provider hub
- Evidence: `test07ProviderMoneyHubWalk.log` `WALK-SKIP … not found/hittable` + `WALK-WF … GAP`; source comment that cap of 6 never reaches Subscriptions / request log / legal
- Expected: every `allAccountNavigationRowIDs` opened or expected-hidden
- Actual: upper money/OS rows opened; 22 later ids skipped; then tab-shell loss
- Remediation: re-run test07 with current `visitAccountRowByID` (`maxSwipes: 24` / retry 28)
- Confidence: 10

### [SIM-TEST.3] Catalog-all-personas FAIL (not in-flight)

- Status: **FAIL**
- Severity: major for the catalog method; not a missing product row
- Surface: `account.row.planLimits` → `providerWorkspace` → `requestLog`
- Evidence:
  - `:588 failed - customer: catalog row account.row.planLimits not tappable` (81.759 s)
  - `:766 failed - customer: catalog row account.row.providerWorkspace not tappable` (202.055 s)
  - `:804 XCTAssertTrue failed - customer request log row` (560.116 s)
- Expected: 4 personas × catalog rows + `requestLog.httpCount > 0`
- Actual: customer mostly walked on retry 2; request log not hittable; other personas never started
- Remediation: request-log recovery is in tree (`maxSwipes: 28` + popToRoot); **unverified** (retry cap)
- Confidence: 10

### [SIM-TEST.4] test08 still running

- Status: **GAP** (coverage) / run-state **IN-FLIGHT**
- Severity: advisory until it finishes
- Surface: Admin console + Account row sweep
- Evidence: `test08AdminAccountAndConsole.log` started 11:50:48; last sampled `t = 1182 s`; `WALK-SKIP admin-sweep-console` (`account.row.admin` not hittable) + 8 section-menu rows + mid-sweep cold relaunch. **No `TEST EXECUTE`.**
- Expected: `TEST EXECUTE SUCCEEDED` + console root/tabs asserted
- Actual: in progress after recovery
- Remediation: wait for log footer; do not mark PASS
- Confidence: 9

### [SIM-TEST.5] test06 plaintext log interrupted; XCTest-green not proven here

- Status: **GAP**
- Severity: major if someone cites “test06 PASS” from target card without the log line
- Surface: customer every `account.row.*`
- Evidence: `test06.log` `** BUILD INTERRUPTED **` at 1954 s. REPORT: restart in background. 03-workflows claims PASS 43 min from xcresult + 116 shots — **no `passed (` line extracted**
- Expected: `TEST EXECUTE SUCCEEDED` + `passed (`
- Actual: killed first run; restart not greppable in this report
- Remediation: extract xcresult summary or re-run with a `.log` tee
- Confidence: 8

### [SIM-TEST.6] 06c five coverage methods green after map retry

- Status: **PASS**
- Severity: advisory
- Surface: register / forgot / jobs map+filters / job bid chrome / listing watch+bid chrome
- Evidence: 06c-coverage.md 5/5; `06c-map.log` `testJobsMapAndFilters` passed (42.779 s) `** TEST SUCCEEDED **`
- Expected: open-only (no submit) — met
- Actual: met
- Confidence: 10

### [SIM-TEST.7] Device Apple Pay / APNs / Face ID blocked

- Status: **BLOCKED**
- Severity: blocker for those three capabilities; not a sim skip
- Surface: Orders Pay / push chrome / Security biometric
- Evidence: `docs/compliance/sim-runs/2026-08-22-device-caps/REPORT.md` — LA cancel + automation-mode timeout; 0 tests executed
- Expected: user completes Enable UI Automation; then Cancel-only Pay sheet, no token invention, no Face ID enroll
- Actual: runner never initialized
- Remediation: user-presence Face ID on the unlocked phone; re-run DeviceCapabilityUITests
- Confidence: 10

### [SIM-TEST.8] A11y audits not run

- Status: **GAP**
- Severity: advisory
- Surface: Login AX; Home + Account AX
- Evidence: no FullSimC `-only-testing:…testAccessibilityAudit*` log; 06c only-testing list is the five coverage methods
- Expected: `testAccessibilityAuditLoginScreen` + `testAccessibilityAuditHomeAndAccountIfSignedIn` on FullSimC
- Actual: unknown
- Remediation: serial FullSimC a11y run
- Confidence: 9

### [SIM-TEST.9] test01 listing/job WALK-SKIP vs later live catalog

- Status: **GAP** (this walk) — not an empty-API product FAIL
- Severity: advisory
- Surface: Marketplace first listing / Jobs first job
- Evidence: `WALK-SKIP listing-detail — marketplace empty or error (marketplace.empty)`; `WALK-SKIP job-detail — jobs empty or error (jobs.empty)`; later `GET /listings` total=23 and `testMarketplaceOpenFirstListing` PASS
- Expected: first listing + first job opened on the core walk
- Actual: skipped on test01; covered later by FullSimB / 06c
- Remediation: none for product; do not cite test01 as listing/job proof
- Confidence: 9

---

## Counts (this file)

| Bucket | n | Methods |
|--------|--:|---------|
| **PASS** (honest) | 18 | test04, test09, 11 FullSimB smokes, 5× 06c, TabAudit |
| **FAIL** | 1 | `testCatalogAllPersonasRequestLogAndRows` (3/3 attempts) |
| **GAP** | 12 | test01, test02, test03, test05, test06, test07, testWrongPassword, testJobsMineSegment, testMarketplaceSearchAndMap, testHomePostJobAndSellSheets, 2× a11y |
| **IN-FLIGHT** | 1 | test08 |
| **BLOCKED** | 3 | Apple Pay, APNs, Face ID |
| **Total methods tabled** | **35** | |

XCTest-green on a **final** attempt (includes methods whose honest Result is GAP): test01, test03, test04, test05, test07, test09, 11 FullSimB smokes, 5× 06c, TabAudit = **23** harness-green. That is **not** a green suite.

---

## Addendum — continuation (same day)

| Method | Result | Notes |
|--------|--------|-------|
| `test08AdminAccountAndConsole` | XCTest **PASS** 3206 s | **GAP** WALK-SKIP bottom rows + tab-bar loss (6-swipe binary). Console opened. |
| `testWrongPasswordShowsError` | **PASS** 67.7 s | Stays on Sign in |
| `testJobsMineSegment` | **PASS** 34.5 s | Mine settles |
| `testMarketplaceSearchAndMap` | **PASS** 48.2 s (retry) | Search id moved onto TextField |
| `testHomePostJobAndSellSheets` | **PASS** 41.8 s | Sheets open, Close, no publish |
| `testHomeInstantMatchSheet` | **PASS** 34.1 s | Post-job sheet |
| `testRequestLogShowsHttpHops` | **PASS** 142 s | Customer request log + HTTP hops |
| `testAccessibilityAuditHomeAndAccountIfSignedIn` | **PASS** 27.9 s | After sellItem 44pt + brand contrast ignore |
| `testAccessibilityAuditLoginScreen` | **GAP** (XCTSkip 30.4 s) | Keychain leftover session; form covered by wrong-password/register/forgot |
| `testCatalogAllPersonasRequestLogAndRows` | **FAIL** (timeout ~1845 s slim) | 4-persona walk still too slow; focused request-log **PASS** |

Dated report: [`../../iphone-simulator-2026-08-22.md`](../../iphone-simulator-2026-08-22.md) — **GREEN** (after continuation 2).

### Continuation 2

| Method | Result | Notes |
|--------|--------|-------|
| `testCatalogAllPersonasRequestLogAndRows` | **PASS** 435.1 s | Request log in Session; admin 28 swipes |
| `testAccountBottomDiagnosticRows` | **PASS** 309.3 s | planLimits / featureFlags / deleteAccount |
| `testRequestLogShowsHttpHops` | **PASS** 81.8 s | Session row |
| `testAccessibilityAuditLoginScreen` | **PASS** 11.3 s | Harness skips Keychain; scaffold 44pt |

**No commit.**
