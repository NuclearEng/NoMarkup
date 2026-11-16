# Residual admin sections — destinations + curl

- **Date**: 2026-08-12
- **Target**: Account → Admin console Section menu (Users, Fees, Banking, Fraud, Markets, Platform, Advances, Taxonomy, Insurers, Challenges, Verify, Licenses, Insurance, Reviews)
- **Gateway**: `http://127.0.0.1:8081` health `{"status":"ok","version":"dev"}`
- **Seed**: `admin@nomarkup.com` / `Password123!` (login 200)
- **Mode**: fix (local) — **no commit** · money flags not toggled · bans not confirmed

## 1. Destinations (not EmptyView)

Every Section menu row maps to a real SwiftUI host. Inline lists live in `AdminConsoleView`; ops panels live in `AdminOpsViews` / `AdminModerationOpsViews`. The console body always stamps `admin.<slug>.root` (even on the loading empty), so UITests can wait after a Section tap.

| Section | Host | `admin.<slug>.root` | iOS GET |
|---------|------|---------------------|---------|
| Users | inline `userRows` | `admin.users.root` | `/api/v1/admin/users` |
| Fees | `AdminFeesView` | `admin.fees.root` | `/api/v1/admin/payments/fee-config` (+ revenue, payments) |
| Banking | `AdminBankingView` | `admin.banking.root` | `/api/v1/admin/banking` |
| Fraud | inline `fraudRows` | `admin.fraud.root` | `/api/v1/admin/fraud/alerts` |
| Markets | `AdminMarketsOpsView` | `admin.markets.root` | `/api/v1/admin/markets` |
| Platform | `AdminPlatformMetricsView` | `admin.platform.root` | `/api/v1/admin/platform/metrics` (+ growth, subscriptions) |
| Advances | inline `advanceRows` | `admin.advances.root` | `/api/v1/admin/advances` |
| Taxonomy | `AdminTaxonomyOpsView` | `admin.taxonomy.root` | public `/api/v1/categories/tree` + `/api/v1/categories/{id}/questions`; writes `/api/v1/admin/category-questions` |
| Insurers | `AdminInsurersOpsView` | `admin.insurers.root` | `/api/v1/admin/insurers` |
| Challenges | `AdminChallengesOpsView` | `admin.challenges.root` | `/api/v1/admin/challenges` |
| Verify | `AdminVerificationOpsView` | `admin.verify.root` | `/api/v1/admin/verification/queue` |
| Licenses | `AdminLicensesOpsView` | `admin.licenses.root` | `/api/v1/admin/licenses?status=pending` |
| Insurance | `AdminInsuranceOpsView` | `admin.insurance.root` | `/api/v1/admin/insurance/claims` |
| Reviews | `AdminFlaggedReviewsOpsView` | `admin.reviews.root` | `/api/v1/admin/reviews/flagged` |

Previously missing slug ids (were `admin.ops.verification.root` / `licenses` / `insurance` / `reviews`, plus guarantee): now `admin.verify.root`, `admin.licenses.root`, `admin.insurance.root`, `admin.reviews.root`, `admin.guarantee.root`.

`ScreenshotWalkUITests` test05 waits on `admin.<slug>.root` for the residual set. Destructive controls (suspend / ban / finalize / resolve / fee save / market toggle) were **not** confirmed.

## 2. Live GET matrix

Admin Bearer. Wrong aliases included to prove iOS is **not** on them.

| Live | Path | Body |
|------|------|------|
| **200** | `GET /api/v1/admin/users` | `users=5` |
| **200** | `GET /api/v1/admin/payments/fee-config` | `fee_percentage=0.08` (iOS path) |
| **404** | `GET /api/v1/admin/fee-config` | `page not found` — not used |
| **200** | `GET /api/v1/admin/banking` | `account=null` (empty, not error) |
| **404** | `GET /api/v1/admin/platform/bank-account` | stale handler comment only — not used |
| **200** | `GET /api/v1/admin/fraud/alerts` | `alerts=0` |
| **200** | `GET /api/v1/admin/markets` | `markets=440` |
| **200** | `GET /api/v1/admin/platform/metrics` | metrics keys present |
| **200** | `GET /api/v1/admin/platform/growth` | `data_points=4` |
| **200** | `GET /api/v1/admin/advances` | `advances=0` |
| **200** | `GET /api/v1/admin/category-questions` | `questions=7` |
| **200** | `GET /api/v1/categories/tree` | `categories=74` (taxonomy picker) |
| **200** | `GET /api/v1/admin/insurers` | `insurers=6` |
| **200** | `GET /api/v1/admin/challenges` | `challenges=5` |
| **200** | `GET /api/v1/admin/verification/queue` | `documents=0` |
| **200** | `GET /api/v1/admin/licenses?status=pending` | `licenses=0` |
| **200** | `GET /api/v1/admin/insurance/claims` | `claims=0` |
| **200** | `GET /api/v1/admin/reviews/flagged` | `flags=0` |
| **200** | `GET /api/v1/admin/disputes` | `disputes=0` |
| **200** | `GET /api/v1/admin/flags` | `flags=16` (not toggled) |
| **200** | `GET /api/v1/admin/jobs` | `jobs=5` |
| **200** | `GET /api/v1/admin/listings` | `listings=20` |
| **200** | `GET /api/v1/admin/disputes/goods` | `disputes=1` |
| **503** | `GET /api/v1/admin/guarantee-claims` | flag `nomarkup_guarantee` off — UI empty, not crash |
| **500** | `GET /api/v1/admin/rum` | iOS does not call this |

No iOS path rewrite. Empty chrome (`Couldn’t load …`) is only on HTTP/decode failure. `account=null` is “No platform bank set”. Flag-off 503s already have dedicated empties (Guarantee / licenses / insurance / advances).

## 3. sim-tap.sh

`docs/compliance/sim-runs/2026-08-12/sim-tap.sh` now prefers the Simulator AX device screen / “LCD” group (osascript `entire contents`) instead of guessing title-bar insets.

| Flag | Behavior |
|------|----------|
| default | AX LCD if it looks like a phone screen (≥40% of window, portrait 1.5–2.6); else insets **32/18/8** |
| `--ax` | AX required; fail if no LCD/device-screen group |
| `--no-ax` | insets only — proven Pro Max path (do not break tab-bar `ny=0.96`) |

iPhone 17 content on one 2026-08-12 layout is AXGroup **350×760 at (437,113)**. Mid-screen rows should use default/`--ax`; Pro Max can keep `--no-ax` if AX is empty.

## Files (no commit)

| File | Change |
|------|--------|
| `ios/NoMarkup/Features/ParitySurfacesView.swift` | `SectionTab.slug`; body always `admin.<slug>.root` |
| `ios/NoMarkup/Features/AdminModerationOpsViews.swift` | `admin.verify/licenses/insurance/reviews/guarantee.root` |
| `ios/NoMarkupUITests/ScreenshotWalkUITests.swift` | wait on section roots; test05 residual walk |
| `docs/compliance/sim-runs/2026-08-12/sim-tap.sh` | AX LCD + `--ax` / `--no-ax` |
