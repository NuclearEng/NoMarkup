# Screenshot walk UITest — 2026-08-05

**Suite:** `NoMarkupUITests/ScreenshotWalkUITests`  
**Result:** **TEST SUCCEEDED**  
**Destination:** iPhone 17 Pro Simulator (`7F123C44-2F2C-442B-90A6-92DE8E548510`) · iOS 26.5 (23F77)  
**Gateway:** `http://127.0.0.1:8081` → health **200** `{"status":"ok","version":"dev"}`  
**Credentials:** seed accounts · `Password123!` (real login form; no DEBUG auto-login env)  
**Result bundle:** `/tmp/NoMarkupScreenshotWalk.xcresult`  
**Derived data:** `/tmp/NoMarkupWalkDD`  
**Build log:** `/tmp/NoMarkupScreenshotWalk-build.log`

---

## Scoreboard

| Metric | Value |
|--------|------:|
| **Passed** | **5** |
| **Failed** | **0** |
| **XCTest skipped** | **0** |
| **Unexpected failures** | **0** |
| Wall time (tests only) | ~1897 s (~31.6 min) |
| Screenshots (`NN-surface-state`) | **107** |
| Soft walk-skips (attachment, non-fatal) | **4 events / 3 unique surfaces** |

```
Test Suite 'ScreenshotWalkUITests' passed
  Executed 5 tests, with 0 failures (0 unexpected) in 1896.982 seconds
** TEST SUCCEEDED **
```

---

## Per-test results

| Test | Duration | Result |
|------|----------|--------|
| `test01CustomerCoreWalk` | 1m 48s (108.4s) | **Passed** |
| `test02CustomerAccountWalk` | 15m (928.8s) | **Passed** |
| `test03ProviderWalk` | 10m (650.9s) | **Passed** |
| `test04FreshCustomerStatesWalk` | 1m 52s (112.6s) | **Passed** |
| `test05AdminSessionWalk` | 1m 36s (96.2s) | **Passed** |

---

## Soft walk-skips (non-fatal)

Optional surfaces record a skip reason instead of hard-failing. Only login + tab shell are hard assertions.

**Attachment:** `walk-skips` (from `test02CustomerAccountWalk` tearDown)

```
tab-Account: no tab bar control found
account-plan-limits: Account row 'Plan limits' not found/hittable
tab-Account: no tab bar control found
account-feature-flags: Account row 'Feature flag status' not found/hittable
```

| Surface | Reason | Notes |
|---------|--------|-------|
| `tab-Account` | no tab bar control found | Seen twice during customer account deep-dive (likely after push where tab bar is not the recovery path). Navigation recovered via other means; suite still green. |
| `account-plan-limits` | Account row 'Plan limits' not found/hittable | Customer Account list — row missing or not scrolled into a hittable state for this seed role. |
| `account-feature-flags` | Account row 'Feature flag status' not found/hittable | Customer Account list — **Feature flag status** is admin-oriented; not expected for customer seed. Admin walk **did** open it (`107-admin-feature-flag-status`). |

Provider walk successfully hit plan limits + feature flags (`85-provider-plan-limits`, `86-provider-feature-flags`).

---

## Coverage map (screenshot IDs)

### Customer core (`01`–`14`)
Auth login · Home top/mid · Marketplace list · Listing detail · Notification preprompt · Watchlist on · Place-a-bid UI (open only) · Jobs list · Job detail · Job bids · Messages list/thread/composer

### Customer account (`15`–`62`)
Account root (top/mid/bottom) · Profile · Security · Verification · Post job form · Job drafts · Sell item · My bids/orders/contracts/listings · Watchlist · Saved searches · Seller analytics/payouts/business finance/sales export/calendar · Team · Challenges · Legal · Quote templates · Verification docs · **Payment methods** (open only) · Notifications/prefs · Providers · Following/feed · Properties · Wishlist · Blocked · Referrals · Feedback surveys · Trust tiers · Savings · Markets · Terms acceptance · Privacy · Terms · Community · Support · Delete account screen (open only)

### Provider (`63`–`91`)
Provider login · Workspace · Instant offers · Security · Verification · Quote templates · Seller analytics/payouts/business finance/exports · Team · Challenges · Verification docs · My listings/bids/contracts · **Payment methods** · Notifications · Trust tiers · Plan limits · Feature flags · Marketplace + listing · Job bid UI · Messages

### Fresh empty states (`92`–`101`)
provider2: instant offers / quote templates / watchlist / my listings empty · seller payouts  
customer2: messages / my bids / orders empty · watchlist / properties empty

### Admin (`102`–`107`)
Admin login · Home · Account root (top/mid/bottom) · Feature flag status

Money / payment surfaces were **opened only** (no PaymentSheet submit, no bid placement, no payout mutation).

---

## Environment / how re-run

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
# Gateway must be up: curl -s http://127.0.0.1:8081/health
xcrun simctl boot "iPhone 17 Pro"  # or UDID 7F123C44-2F2C-442B-90A6-92DE8E548510
cd ios
caffeinate -i xcodebuild test -scheme NoMarkup \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:NoMarkupUITests/ScreenshotWalkUITests \
  -derivedDataPath /tmp/NoMarkupWalkDD \
  -resultBundlePath /tmp/NoMarkupScreenshotWalk.xcresult
```

Export attachments:

```bash
xcrun xcresulttool export attachments \
  --path /tmp/NoMarkupScreenshotWalk.xcresult \
  --output-path /tmp/NoMarkupWalkAttachments
```

---

## Verdict

| Claim | Status |
|-------|--------|
| Full `ScreenshotWalkUITests` suite green on iPhone 17 Pro sim | **YES** |
| Gateway reachable during run | **YES** |
| Real login UI exercised (seed password) | **YES** |
| Money screens opened without submit | **YES** (by design) |
| Zero soft skips | **NO** — 3 unique soft skips (customer plan-limits, customer feature-flags, transient tab-Account) |
| Every Account row for every role | **Almost** — customer Plan limits / Feature flag status soft-skipped; admin Feature flag status covered |

**Overall: TEST SUCCEEDED · 5/5 passed · 0 failed.** Soft skips documented above; not test failures.
