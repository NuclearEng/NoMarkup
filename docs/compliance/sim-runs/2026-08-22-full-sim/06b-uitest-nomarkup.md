# NoMarkupUITests + TabAudit — 2026-08-22 full-sim (17 Pro Max)

- **Target**: `ios/NoMarkup.xcodeproj` scheme `NoMarkup`
- **Simulator**: iPhone 17 Pro Max `503E262C-5731-45BE-A459-CFF59551539E` / iOS 26.5 (exclusive; 17 Pro left to test07)
- **Xcode**: 26.5 (17F42) · `DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer`
- **API**: `http://127.0.0.1:8081` health `{"status":"ok","version":"dev"}`
- **Catalog at run**: `GET /api/v1/listings` **total=23** (Austin 78701); `GET /api/v1/jobs` **totalCount=3**
- **Credentials**: seed `customer@` / `provider@` / `provider2@` / `admin@nomarkup.com` · `Password123!`
- **Derived data**: `ios/DerivedDataFullSimB` (did **not** touch `DerivedDataFullSim`)
- **Logs**: `ios/DerivedDataFullSimB/logs/`
- **xcresult**: `ios/DerivedDataFullSimB/results/<method>.xcresult`
- **Screenshots**: `docs/compliance/sim-runs/2026-08-22-full-sim/uitest-b/`
- **Mode**: fix · serial one `-only-testing` per `xcodebuild` · max 2 retries/method
- **No commit**

## Verdict

| Claim | Status |
|-------|--------|
| Assigned NoMarkupUITests methods XCTest-green | **11/12 PASS** |
| `testMarketplaceOpenFirstListing` found a listing | **PASS** (not empty) |
| `TabAuditUITests/testTabsCustomerAndProviderAudit` | **PASS** (166.6 s) |
| `testCatalogAllPersonasRequestLogAndRows` | **FAIL** after 2 retries |
| Live goods catalog (`GET /api/v1/listings`) | **23 rows** — not a data GAP |
| Hard money submit / seed mutation | **not in this suite** |

**XCTest 12/13 assigned methods PASS on final attempt. Catalog = FAIL (harness), not empty-API.**

---

## Pass / fail per test method

Final attempt only (catalog shows all three runs).

| # | Method | Duration | XCTest | Notes |
|---|--------|---------:|--------|-------|
| 1 | `testColdLaunchShowsLoginOrTabs` | 9.547 s | **PASS** | `login.email` or `root.tabview` within 15 s |
| 2 | `testLoginWithEnvCredentials` | 15.467 s | **PASS** | DEBUG auto-login / form → tab shell |
| 3 | `testSignedInTabNavigation` | 42.982 s | **PASS** | Home → Marketplace → Jobs → Messages → Account |
| 4 | `testHomeHeroAndMarketDesk` | 30.122 s | **PASS** | `home.hero` / `home.browseJobs` / desk |
| 5 | `testJobsBrowseSettles` | 45.361 s | **PASS** | `jobs.list` (API 3 open jobs) |
| 6 | `testAccountHubLinks` | 201.079 s | **PASS** | Key hub rows; shell intact |
| 7 | `testAccountCriticalMoneyRows` | 97.146 s | **PASS** | Payment methods + seller payouts |
| 8 | `testMarketplaceOpenFirstListing` | 37.886 s | **PASS** | `marketplace.list`; opened cell; `BackButton` |
| 9 | `testRoleShellCustomer` | 29.569 s | **PASS** | Home + Account |
| 10 | `testRoleShellProvider` | 75.030 s | **PASS** | Jobs + Account + workspace row |
| 11 | `testRoleShellAdmin` | 66.151 s | **PASS** | Home + Marketplace + Account |
| 12 | `testCatalogAllPersonasRequestLogAndRows` | 560.116 s (retry 2) | **FAIL** | See catalog retries |
| 13 | `TabAuditUITests/testTabsCustomerAndProviderAudit` | 166.568 s | **PASS** | Listing + job + provider bid UI; no FAIL findings |

**XCTSkip:** 0 (credentials present).

---

## Catalog retries (`testCatalogAllPersonasRequestLogAndRows`)

Customer seed only — never reached provider/admin.

| Attempt | Duration | Failure |
|--------:|----------|---------|
| 0 | 81.759 s | `customer: catalog row account.row.planLimits not tappable` |
| 1 | 202.055 s | `customer: catalog row account.row.providerWorkspace not tappable` |
| 2 | 560.116 s | `customer request log row` (`account.row.requestLog`) |

Retry 2 **did** tap (customer): profile, orders, contracts, myBids, planLimits, notifications, providerWorkspace, instantOffers, paymentMethods. `legalServices` / `insuranceQuote` expected-hidden. Then `assertRequestLogHasHttpHops` could not hittable-scroll `account.row.requestLog`. **Retry cap (2) — no third run.**

### Harness fixes landed in `ios/NoMarkupUITests/NoMarkupUITests.swift`

1. **`scrollTo` honors `maxSwipes`** — was hard-capped at 6 short 0.58→0.30 drags; Plan limits lives in the Subscriptions section at the bottom of Account.
2. **`hasBackButton`** — iOS 26 back controls include the previous title (`Notifications`, `Plan limits`) and exceed 120 pt. Now `minX < 90 && width < 220 && height < 64`.
3. **`popToRoot("Account")`** — stop when `account.row.profile` is on-screen; otherwise tap the leading nav button even if the width heuristic missed.
4. **Catalog row recovery** — if a row is not tappable, `goBack` + scroll toward top + retry (unblocked workspace on retry 2).
5. **`assertRequestLogHasHttpHops`** — same `popToRoot` + recovery (source only; **not** re-run after retry 2).

These are harness, not product. The Account rows exist (`AccountView` identifiers `account.row.planLimits` / `providerWorkspace` / `requestLog`).

---

## Marketplace was not empty

`GET /api/v1/listings` → 23 active goods (IKEA KALLAX, Makita, Patagonia, … pickup ZIP 78701). Seattle/Cupertino `lat/lng/radius_km=40` still return 0; the iOS browse center is **unset**, so the app lists without geo filter.

`testMarketplaceOpenFirstListing` settled `marketplace.list`, tapped cells, found `BackButton`. TabAudit: `Marketplace settle: marketplace.list`, opened first listing, watchlist add, place-bid UI. **Not a selector GAP. Not an API-empty GAP.**

---

## TabAudit findings (`uitest-b/tab-audit-findings.txt`)

All PASS / INFO; **zero FAIL lines**.

- Home: hero, browseJobs, market desk, DESK LIVE
- Marketplace: list, first listing, watchlist, place-bid UI
- Jobs: list, first job (customer dual-role sees bid chrome)
- Messages: thread + composer
- Tab cycle without crash
- Provider: jobs list, place-bid UI (amount field not submitted)

Named shots `01-10-customer-signed-in.png` … `22-66-provider-home.png` in `uitest-b/`.

---

## xcresult paths

| Method | Path |
|--------|------|
| Per-method | `ios/DerivedDataFullSimB/results/<method>.xcresult` |
| Catalog (final fail) | `ios/DerivedDataFullSimB/results/testCatalogAllPersonasRequestLogAndRows.xcresult` |
| TabAudit | `ios/DerivedDataFullSimB/results/testTabsCustomerAndProviderAudit.xcresult` |
| xctestrun | `ios/DerivedDataFullSimB/Build/Products/NoMarkup_NoMarkup_iphonesimulator26.5-arm64.xctestrun` (env pinned to `127.0.0.1:8081`) |

---

## Findings (SIM-TEST.N)

### [SIM-TEST.1] Assigned smoke methods green on 17 Pro Max

- Status: **PASS**
- Severity: advisory
- Surface: cold launch, login, tabs, Home, Jobs, Account hub, money rows, marketplace first listing, three role shells
- Evidence: per-method `TEST EXECUTE SUCCEEDED`; marketplace log `marketplace.list` + `BackButton`; jobs `jobs.list`; API 23 listings / 3 jobs
- Confidence: 10

### [SIM-TEST.2] TabAudit customer + provider walk

- Status: **PASS**
- Severity: advisory
- Surface: Home / Marketplace / Jobs / Messages + provider bid chrome
- Evidence: 166.568 s, findings file all PASS, listing + job opened, provider place-bid UI, no hard FAIL
- Confidence: 10

### [SIM-TEST.3] Catalog-all-personas dies on Account lazy-list / back-chrome

- Status: **FAIL** (XCTest) / **GAP** (full 4-persona request-log proof)
- Severity: major for the catalog method; not a missing product row
- Surface: `account.row.planLimits` → `providerWorkspace` → `requestLog` after deep Account pushes
- Evidence: three serial runs; retry 2 tapped 9 customer catalog rows then failed request log. API/AccountView identifiers present.
- Expected: 4 personas × catalog rows + `requestLog.httpCount > 0`
- Actual: customer catalog rows mostly walked on retry 2; request log not hittable; provider/admin never started
- Remediation: harness recovery for request log is in tree but unverified (retry cap). Next run should start from retry-2 source.
- Confidence: 8

### [SIM-TEST.4] First `xcodebuild test-without-building` missed products

- Status: **HARNESS** (fixed)
- Severity: minor
- Surface: copied xctestrun out of `Build/Products` so `__TESTROOT__` was wrong
- Evidence: `Missing test product at …/DerivedDataFullSimB/Debug-iphonesimulator/NoMarkupUITests-Runner.app`
- Remediation: patch env on the original xctestrun in `Build/Products/`
- Confidence: 10

---

## Commands (serial)

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
export NOMARKUP_API_BASE_URL=http://127.0.0.1:8081
cd ios
xcodebuild test-without-building \
  -xctestrun DerivedDataFullSimB/Build/Products/NoMarkup_NoMarkup_iphonesimulator26.5-arm64.xctestrun \
  -destination 'platform=iOS Simulator,id=503E262C-5731-45BE-A459-CFF59551539E' \
  -derivedDataPath DerivedDataFullSimB \
  -only-testing:NoMarkupUITests/NoMarkupUITests/<method> \
  -resultBundlePath DerivedDataFullSimB/results/<method>.xcresult \
  -parallel-testing-enabled NO -enableCodeCoverage NO \
  -test-timeouts-enabled YES -default-test-execution-time-allowance 3600
```

TabAudit: `-only-testing:NoMarkupUITests/TabAuditUITests/testTabsCustomerAndProviderAudit`.

---

## Disclaimer

XCTest Passed ≠ every Account row walked. Catalog FAIL is a lazy-List / back-button harness hole after a long customer hub walk, **not** an empty marketplace. Live listings were opened. No commit. 17 Pro / `DerivedDataFullSim` untouched.
