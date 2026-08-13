# Gap-close — Admin remaining sections + ScreenshotWalk Section menu

- **Date**: 2026-08-12
- **Target**: iOS admin console + `ScreenshotWalkUITests` (SIM-TEST.7 / .8)
- **Gateway**: `http://127.0.0.1:8081` health `{"status":"ok","version":"dev"}`
- **Seed**: `admin@nomarkup.com` / `Password123!` (login 200)
- **Mode**: fix (local) — **no commit** · money flags not toggled

## 1. Remaining admin sections — live GET 200s

iOS `APIClient+Admin` already uses the mounted paths. Wrong aliases 404 (documented, not used):

| Section | iOS path | Live | Body |
|---------|----------|------|------|
| Users | `GET /api/v1/admin/users` | **200** | `users=5` |
| Fees | `GET /api/v1/admin/payments/fee-config` | **200** | flat fee % / cents |
| Fees (wrong) | `GET /api/v1/admin/fee-config` | **404** `page not found` | — |
| Banking | `GET /api/v1/admin/banking` | **200** | `account=null` (empty, not error) |
| Banking (wrong) | `GET /api/v1/admin/platform/bank-account` | **404** | stale handler comment only |
| Fraud | `GET /api/v1/admin/fraud/alerts` | **200** | `alerts=0` |
| Markets | `GET /api/v1/admin/markets` | **200** | `markets=440` |
| Platform | `GET /api/v1/admin/platform/metrics` | **200** | metrics keys present |
| Platform growth | `GET /api/v1/admin/platform/growth` | **200** | data_points + rates |

No iOS path rewrite. Fees/Banking/Platform/Markets are ops panels (`AdminFeesView` / `AdminBankingView` / `AdminPlatformMetricsView` / `AdminMarketsOpsView`). Users/Fraud stay inline lists. Empty-error chrome (`Couldn’t load fees/banking/metrics/admin data`) is only on HTTP/decode failure — these GETs decode (optional fields + convertFromSnakeCase). Banking `account=null` shows “No platform bank set”, not the error empty.

Also confirmed (not the residual list): disputes 200 empty, jobs 200 (5), flags 200 (16), payments 200, revenue 200.

## 2. ScreenshotWalk `tapAdminConsoleTab` (SIM-TEST.7)

Capsule `ScrollView` is gone. Helper now:

1. Wait for `admin.console.tabs` **or** `admin.console.tabs.menu`
2. No-op success if the gold pill already shows that section
3. Open the labeled **Section** menu
4. Tap `admin.console.tab.<slug>` / `menuItems[label]` (never swipe the strip)
5. Label fallback skips the floating tab-bar (`Jobs` etc.)

`test05` walks Disputes / Users / Fraud / Jobs **and** Fees / Banking / Markets / Platform. `test08` walks Disputes / Users / Fraud / Jobs. Skip copy is `section menu row not found` (no “horizontal swipe”).

TabAudit has no admin capsule path — unchanged.

## 3. Customer `account.row.admin` (SIM-TEST.8)

`test06` now `XCTAssertFalse(byID("account.row.admin").exists, …)` after Account root. Sweep skips that id so it does not WALK-SKIP. Product still gates the row on `hasAdminRole`.

## 4. `popToRoot` tab-bar

Already popped Back when `tabBars` missing (SIM-TEST.5/6). Hardened: labeled `Back` (nav bar, then any `Back`) if geometry `hasBackButton` is false. Same labeled fallback on the post-`openTab` unwind.

## Product (tiny)

`AdminConsoleView` inline list (Flags / Disputes / Users / Fraud / …) now has `admin.<slug>.root` so a later walk can wait on Users/Fraud without ops-panel ids.

## Files

| File | Change |
|------|--------|
| `ios/NoMarkupUITests/ScreenshotWalkUITests.swift` | Section menu tap; test05/08; customer admin assert; popToRoot Back fallback |
| `ios/NoMarkup/Features/ParitySurfacesView.swift` | `admin.<slug>.root` on the inline list |

No `APIClient+Admin` path edits. No TabAudit edits. No commit.
