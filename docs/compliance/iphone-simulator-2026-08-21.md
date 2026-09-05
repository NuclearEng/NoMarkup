# IphoneSimulator Run Report — Account hub + request-log substrate

- **Target**: `ios/NoMarkup.xcodeproj` / `NoMarkup` (`com.nomarkup.app`)
- **Date**: 2026-08-21
- **Simulator**: iPhone 17 Pro `7F123C44-2F2C-442B-90A6-92DE8E548510` / iOS 26.5
- **Physical device**: Tanner’s iPhone 15 Pro Max (paired); Debug install earlier this session
- **API base / backend**: `http://127.0.0.1:8081` health 200
- **Mode**: fix
- **Depth / scope**: Account tab, all seed personas + determinism substrate (iOS + web)
- **Readiness**: **YELLOW** — no login/auth blockers; inner workflow enforcement (plan limits on bid path) and full XCUITest sweep still GAP; request-log substrate **shipped**

## Target card

See `docs/compliance/sim-runs/2026-08-21-account-audit/00-target-card.md`.

Personas (live `/users/me`):

| Email | Roles |
|-------|--------|
| customer@nomarkup.com | customer, **provider** (dual-role seed) |
| provider@nomarkup.com | provider |
| admin@nomarkup.com | admin, provider |

## Executive summary

1. Account inventory: 50+ destinations (`00-inventory.md`).
2. Wiring: live GETs 200 for catalog hops; admin APIs 403 for non-admin (`01-wiring.md`).
3. Security: admin row gated; delete/export/sign-out confirms; insurance quote **hidden** behind iOS hard-off flags.
4. UI: loading/empty/error patched on workspace, analytics, instant offers, verification, delete, team, quotes, docs, blotter.
5. Perf: all Account `NavigationLink`s use `LazyView`; tap→idle 0.37–0.82s on Debug sim (`05-perf.md`).
6. Plan limits seed was identical 3/1/5/Off — **FIXED** by migration `131` (live curl now 10 / 50 bids, analytics on for Pro).
7. **Determinism substrate:** documented catalog + client request log (iOS Account row, web Settings) joined on `X-Request-ID`.

## Findings (rolled up)

| ID | Status | Note |
|----|--------|------|
| SIM-SEC.1–9 | PASS | Admin 403, delete confirm, GDPR export, Keychain, no IAP CTA |
| SIM-SEC.10 | FIXED | Insurance quote row only if insurance flags on |
| SIM-WIRE.52 | FIXED | `pro_customer` / `pro_provider` limits backfilled |
| SIM-WIRE.54 | GAP | Admin job-reports 404 until gateway process restarted onto this branch |
| SIM-PERF.1–4 | PASS | LazyView, timings, no setInterval |
| SIM-PERF.5 | GAP | Full 53-row XCUITest sweep hit Simulator hub flake |
| SIM-UI.* | FIXED | Empty/error/loading on listed destinations |
| Plan-limit **enforcement** | GAP | Display + GetUsage only; bid path does not cap at 3 |

## Fixes applied this run

- `AccountView` insurance row flag-gated; **Request log** row added.
- iOS `ClientActionLog` + `X-Request-ID` on `APIClient` hops.
- Web `client-action-log` + Settings → Request log; `api.ts` records every hop.
- `database/migrations/131_backfill_subscription_tier_limits` applied on local DB.
- Seed INSERT now sets 019 limit columns.
- Loading/empty/error patches from UI agent (workspace, analytics, instant offers, etc.).

## How to audit a tap (new)

1. iOS: Account → Request log. Web: `/settings/request-log`.
2. Perform the step in `docs/workflows/catalog.yaml`.
3. Newest row: method, path, status, duration ms, request id.
4. Gateway slog `request_id` = that id.

Catalog + join rules: `docs/workflows/README.md`.

## Residuals

- Founder: ASC IAP, live Stripe Apple Pay sheet, APNs, `no-markup.com` DNS.
- Eng: plan-limit enforcement on bid/category/portfolio; catalog.yaml ↔ Chi route contract test; restart local gateway for job-reports.
- Infra: Simulator Instruments hub flake on full Account sweep.

## Commands to reproduce

```bash
curl -sS http://127.0.0.1:8081/api/v1/subscriptions/tiers
# iOS
xcodebuild test -project ios/NoMarkup.xcodeproj -scheme NoMarkup \
  -destination 'platform=iOS Simulator,id=7F123C44-2F2C-442B-90A6-92DE8E548510' \
  -only-testing:NoMarkupTests/ClientActionLogTests
# web
cd web && npx vitest run tests/unit/lib/client-action-log.test.ts
```

## Disclaimer

YELLOW is not production-ready. Request log is **local** (device/browser ring buffer), not a server activity table. Do not treat a screenshot of Plan limits as proof the bid cap is enforced.
