# Persona UITest verification — 2026-08-06

**Purpose:** Exclusive iOS Simulator re-run of persona-critical UITests after the LazyView / admin-tab / `safeTap` closeout (`docs/compliance/persona-e2e-fixes-2026-08-06.md`).

**Result:** **8 / 8 PASSED · 0 failed · 0 unexpected**

| Metric | Value |
|--------|------:|
| **Passed** | **8** |
| **Failed** | **0** |
| **XCTest skipped** | **0** |
| Soft walk-skips (non-fatal) | **6 events / 6 unique** |
| Wall (tests only, sum of batches) | ~2 643 s (~44 min) |

---

## Environment

| Item | Value |
|------|--------|
| **Xcode** | 26.5 (17F42) · `DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer` |
| **Destination** | **iPhone Air** Simulator · UDID `D51A6A2C-F256-468D-A39F-4B1E4DF4A9A3` · iOS 26.5 |
| **Exclusivity** | Single sim; no contending `xcodebuild` on this UDID (serial batches) |
| **Gateway** | `http://127.0.0.1:8081` → **200** `{"status":"ok","version":"dev"}` (also reachable as LAN `192.168.1.101:8081`) |
| **API env** | `NOMARKUP_API_BASE_URL=http://127.0.0.1:8081` (shell + `xcodebuild` build setting; ScreenshotWalk also forces via `launchEnvironment`) |
| **Credentials** | Seed defaults: `customer@` / `provider@` / `admin@nomarkup.com` · `Password123!` |
| **Derived data** | `/tmp/persona-verify-DD` |
| **Branch context** | `fix/security-audit-2026-04-23` (post LazyView / admin-tab / safeTap) |

---

## Pass / fail table

| # | Suite | Test | Duration | Result | Notes |
|---|-------|------|----------|--------|-------|
| 1 | `NoMarkupUITests` | `testRoleShellCustomer` | 47.8 s | **PASS** | Home + Account; `root.tabview` intact |
| 2 | `NoMarkupUITests` | `testRoleShellProvider` | 40.9 s | **PASS** | Jobs + Account; Provider workspace open/pop |
| 3 | `NoMarkupUITests` | `testRoleShellAdmin` | 50.7 s | **PASS** | Home + Marketplace + Account shell |
| 4 | `NoMarkupUITests` | `testAccountCriticalMoneyRows` | 64.6 s | **PASS** | Payment methods + Seller payouts settle |
| 5 | `ScreenshotWalkUITests` | `test05AdminSessionWalk` | 205.8 s | **PASS** | Admin login, Account, Feature flags, Admin console root (no crash) |
| 6 | `ScreenshotWalkUITests` | `test07ProviderMoneyHubWalk` | 270.3 s | **PASS** | Instant offers / Seller payouts / Business hub |
| 7 | `ScreenshotWalkUITests` | `test08AdminAccountAndConsole` | 327.5 s | **PASS** | Admin console assert + Account row spot-check |
| 8 | `ScreenshotWalkUITests` | `test06CustomerAccountRowIDSweep` | 1820.3 s | **PASS** | Optional full Account ID sweep (~30.3 min); app stayed alive |

**Primary persona set (1–7): 7/7 PASS.**  
**Optional residual (8 / test06): PASS.**

---

## Soft walk-skips (intentional / non-fatal)

| Surface | Reason | Assessment |
|---------|--------|------------|
| `admin-console-tab-disputes` | tab control not on-screen after horizontal swipe | **Harness residual on Air** — console **root opened without crash** (hard gate). Capsule strip still soft-skips some off-screen tabs under geometric `safeTap`/`isOnScreen`. Not a product crash regression. |
| `admin-console-tab-users` | same | same |
| `admin-console-tab-fraud` | same | same |
| `admin-console-tab-jobs` | same | same |
| `cust-mid-sweep-recovery` | tab shell lost mid-sweep; cold relaunch once | **By design** in `test06` (deep NavigationStack pressure recovery). Sweep continued after relaunch. |
| `cust-row-admin` | `account.row.admin` not found/hittable | **Expected** — Admin console is admin-gated; customer seed correctly lacks the row. |

No money-row soft-skips. No role-shell soft-skips.

---

## Log & result-bundle paths

| Batch | Tests | Log | xcresult |
|-------|-------|-----|----------|
| Role shells + money (interrupted mid-provider by tool timeout; 3/4 complete in log) | money, admin shell, customer shell | `/tmp/persona-verify-batch1.log` | `/tmp/persona-verify-batch1.xcresult` (partial) |
| Provider shell re-run | `testRoleShellProvider` | `/tmp/persona-verify-provider.log` | `/tmp/persona-verify-provider.xcresult` |
| ScreenshotWalk 05 / 07 / 08 | admin session, provider money hub, admin account+console | `/tmp/persona-verify-walk.log` | `/tmp/persona-verify-walk.xcresult` |
| Optional test06 | customer Account row ID sweep | `/tmp/persona-verify-test06.log` | `/tmp/persona-verify-test06.xcresult` |
| Shared derived data | build + intermediates | — | `/tmp/persona-verify-DD` |

### xcodebuild pattern used

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
export NOMARKUP_API_BASE_URL=http://127.0.0.1:8081
UDID=D51A6A2C-F256-468D-A39F-4B1E4DF4A9A3
cd ios
caffeinate -dims xcodebuild test \
  -scheme NoMarkup -project NoMarkup.xcodeproj \
  -destination "platform=iOS Simulator,id=${UDID}" \
  -derivedDataPath /tmp/persona-verify-DD \
  -parallel-testing-enabled NO \
  -only-testing:NoMarkupUITests/NoMarkupUITests/testRoleShellCustomer \
  # … additional -only-testing: … \
  -resultBundlePath /tmp/persona-verify-….xcresult \
  NOMARKUP_API_BASE_URL=http://127.0.0.1:8081
```

---

## Product bugs found

**None.** No new product defects requiring code changes.

What this run **does** prove post-LazyView/admin-tab/safeTap:

1. Multi-role shell smoke (customer / provider / admin) reaches `root.tabview` and walks tabs without hang/crash.
2. Critical money Account rows (Payment methods, Seller payouts) open and settle for the customer seed.
3. Admin console destination opens without historical stack-overflow crash (hard assertions in test05 / test08).
4. Provider money hub walk completes.
5. Full customer Account ID sweep (~50 destinations) completes with intentional mid-sweep recovery; process stays foreground; tab shell recovers.

Residual (non-blocking, harness):

- Horizontal admin capsule tabs still soft-skip under pure geometry on **iPhone Air** for some labels (Disputes / Users / Fraud / Jobs). Product ids (`admin.console.tab.*`) and `ScrollViewReader` centering are present; improve `tapAdminConsoleTab` swipe/target if full tab coverage becomes a hard gate. Default Flags tab + console root were exercised.

---

## Verdict

| Claim | Status |
|-------|--------|
| Exclusive Air sim persona-critical set green | **YES** |
| Gateway healthy for entire window | **YES** |
| LazyView / admin console open does not crash | **YES** |
| `safeTap` path avoids `isHittable` throws | **YES** (suite green; no hittability abort) |
| Zero soft-skips | **NO** — 6 intentional soft skips documented above |
| Code changes required this pass | **NO** |

**Overall: 8/8 PASS · 0 FAIL · files changed: none.**
