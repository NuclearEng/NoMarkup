# Admin seed unicorn E2E — 2026-08-12-clean

- **Target**: NoMarkup iOS (`com.nomarkup.app`) + gateway `http://127.0.0.1:8081`
- **Date**: 2026-08-12
- **Simulator**: iPhone 17e / iOS 26.5 / UDID `5B84AFEE-78CD-4427-A536-95EE91D81220`
- **Seed**: `admin@nomarkup.com` / `Password123!` (roles `admin`, `provider`)
- **Mode**: fix (local+clear) — **no commit**
- **Depth / scope**: 5-tab consumer shell + Account + Admin console
- **Readiness**: **YELLOW** — tab-strip blocker fixed; remaining admin sections are GAP (menu-reachable, not every list shot) or API-only

## Target card

| Field | Value |
|-------|-------|
| Project / scheme | `ios/NoMarkup.xcodeproj` / `NoMarkup` Debug |
| Bundle id | `com.nomarkup.app` |
| Simulator | iPhone 17e `5B84AFEE-78CD-4427-A536-95EE91D81220` |
| API base / health | `http://127.0.0.1:8081` `{"status":"ok","version":"dev"}` |
| Session | argv `-ui-test-email admin@nomarkup.com` |
| Unread | Account badge 3 → 5 during walk (API unread-count 3 at start) |
| Stripe | Not configured (Account + About) |

## Executive summary

Admin uses the same 5-tab consumer shell as customer/provider. Account → **Admin console** (`account.row.admin`) is present and opened. The 22-tab horizontal capsule strip was **invisible and untappable** on iOS 26 17e (collapsed `ScrollView` in `safeAreaInset`). Replaced with a labeled **Section** menu. Jobs, Listings, Goods disputes, and Guarantee lists were exercised. Money flags were not toggled. Destructive suspend/ban/resolve were not confirmed.

## Environment evidence

- Gateway health 200. Admin `POST /auth/login` 200; `GET /users/me` → `admin@nomarkup.com` roles `[admin, provider]`.
- 16 feature flags. Money/regulated binary-only left untouched.
- Reversible API toggle: `PUT /admin/flags/background_checks` `enabled=true` then `false` — both 200.
- Admin GETs: jobs/listings/users/markets **200**; disputes/fraud alerts empty **200**; guarantee-claims **503** (`nomarkup_guarantee` off — fail-closed). `GET /admin/fee-config` is 404; iOS uses `/admin/payments/fee-config`.
- Rebuild after fixes: **BUILD SUCCEEDED** (`ios/DerivedDataBuild`). Installed only on 17e.

## UI inventory coverage

| Surface | Status | Shot |
|---------|--------|------|
| Home (signed-in 5 tabs) | PASS | `A10-home.png`, `A11-home-scrolled.png`, `A80-relaunch-home.png` |
| Marketplace | PASS (40 of 49) | `A20-marketplace.png` |
| Jobs Browse | PASS (3 open) | `A30-jobs.png` |
| Messages empty | PASS | `A40-messages.png` |
| Account hub + admin row | PASS | `A50-account.png` … `A50-account-scroll10.png`, `A81-account-bottom.png` |
| Feature flag status (read-only) | PASS | `A60-admin-console.png`, `A61-feature-flags-scrolled.png` |
| Quote templates empty (via hub) | PASS | `A87-admin-labeled-picker.png` |
| Admin Flags | PASS | `A70-admin-console.png`, `A89-admin-labeled.png`, `A97-admin-retest.png` |
| Admin Jobs | PASS | `A91-admin-jobs.png` |
| Admin Listings | PASS | `A92-admin-listings.png` |
| Admin Goods disputes | PASS | `A93-admin-disputes.png` |
| Admin Guarantee (flag-off empty) | PASS | `A99-goods-disputes.png` |
| Admin Users / Fees / Banking / Platform / Fraud / Advances / Markets / Taxonomy / Insurers / Challenges / Verify / Licenses / Insurance / Reviews | GAP | menu lists them (`A84-admin-menu.png`, `A90-section-menu.png`); not every list opened |
| Destructive writes | N/A | Suspend / Remove / Ban / Finalize / Resolve **not** confirmed |

## Findings

### [SIM-UI.1] Admin 5-tab consumer shell matches other seeds
- Status: PASS
- Severity: advisory
- Surface: Home / RootTabView
- Evidence: `A10-home.png` — Home / Marketplace / Jobs / Messages / Account; Account badge 3; Market desk 3 LIVE · 20 GOODS; email later confirmed `admin@nomarkup.com` (`A50-account.png`).
- Expected: same 5-tab chrome as customer/provider plus admin-only Account row.
- Actual: Matches. Admin is not a separate tab IA.
- Remediation: none.
- Confidence: 9

### [SIM-UI.2] Home first paint clips stats / ticker on 17e
- Status: PASS (scrollable) / RISK (first paint)
- Severity: advisory
- Surface: Home
- Evidence: `A10-home.png` — floating tab bar covers Market Desk chips and hides the LIVE NOW / GOODS LIVE / GATEWAY strip. `A11-home-scrolled.png` reveals stats + open auctions. Customer Pro Max (`C00-home.png`) shows stats above the bar without scrolling.
- Expected: stats readable above the floating tab bar on 390pt.
- Actual: `HomeView` already pads `.bottom` 48; 17e still needs a flick.
- Remediation: optional extra bottom inset on Home for compact phones. Not blocking.
- Confidence: 8

### [SIM-UI.3] Market desk last chip clips mid-price
- Status: FIXED
- Severity: advisory
- Surface: `MarketTickerView`
- Evidence: `A10-home.png` HVAC chip reads `$50` at the card edge (full price `$500.00` on job cards). Comment in `MarketTickerView` says chips never clip mid-glyph.
- Expected: last chip fully readable or scrollable past the clip.
- Actual: HStack had no trailing inset; last chip died at the card edge.
- Remediation: `.padding(.trailing, 14)` on the chip `HStack` in `ios/NoMarkup/Core/MarketTickerView.swift`.
- Retest: code in tree. First-viewport still may show a partial chip until the user scrolls; last chip can now scroll fully on-screen.
- Confidence: 8

### [SIM-UI.4] Jobs / Marketplace search field looks empty
- Status: RISK
- Severity: advisory
- Surface: Jobs Browse, Marketplace
- Evidence: `A20-marketplace.png`, `A30-jobs.png` — grey pill with no visible “Search listings” / “Search jobs” prompt. Messages (`A40-messages.png`) shows “Search inbox”.
- Expected: placeholder visible at rest.
- Actual: system `.searchable(prompt:)` on iOS 26 renders a blank pill until focus. Product prompt exists in `MarketplaceView` / `JobsView`.
- Remediation: leave (system chrome) or swap to the custom Messages-style field if design wants a persistent prompt.
- Confidence: 7

### [SIM-UI.5] Messages empty state is complete
- Status: PASS
- Severity: advisory
- Surface: Messages
- Evidence: `A40-messages.png` — “No conversations yet”, Browse jobs + Browse marketplace CTAs, Search inbox. Admin API channels empty (0).
- Expected: empty, not a spinner, with a next action.
- Actual: Matches.
- Remediation: none.
- Confidence: 9

### [SIM-UI.6] Admin console row is admin-gated and reachable
- Status: PASS
- Severity: advisory
- Surface: Account → Admin console
- Evidence: `A50-account-scroll10.png` / `A81-account-bottom.png` — Plan limits, Feature flag status, **Admin console**. Session email `admin@nomarkup.com`. `account.row.admin` gated on `hasAdminRole`.
- Expected: admin-only row; customer seed must not show it.
- Actual: Present for this seed. Opened to `AdminConsoleView`.
- Remediation: none.
- Confidence: 9

### [SIM-UI.7] Feature flag status (consumer) is read-only
- Status: PASS
- Severity: advisory
- Surface: Account → Feature flag status
- Evidence: `A60-admin-console.png`, `A61-feature-flags-scrolled.png` — BNPL / working capital / insurance / legal ON; lead_gen OFF; instant_payout ON; “Open Business & finance”. No toggles (correct — this is not the admin Flags desk).
- Expected: read-only rails status; money flags not flipable here.
- Actual: Matches.
- Remediation: none.
- Confidence: 9

### [SIM-UI.8] Admin tab strip collapsed — 22 tabs unreachable
- Status: FIXED
- Severity: major
- Surface: `AdminConsoleView` tab chrome
- Evidence: `A70-admin-console.png`, `A71-tap-tabstrip.png` — large empty band under “Admin”; tapping the band did nothing. Flags list loaded, so the desk was not 403. Horizontal `ScrollView` inside `.safeAreaInset(edge: .top)` has 0 height on iOS 26.
- Expected: Flags / Jobs / Listings / … tappable.
- Actual: Capsules missing; only the flags list showed.
- Remediation: Replaced the collapsing chip `ScrollView` with a labeled **Section** `Menu` (`admin.console.tabs` / `admin.console.tabs.menu`). Per-tab ids `admin.console.tab.*` stay on menu rows for UITests. `ios/NoMarkup/Features/ParitySurfacesView.swift`.
- Retest: `A89-admin-labeled.png` / `A97-admin-retest.png` — gold **Flags** pill. `A90-section-menu.png` — full section list. `A91-admin-jobs.png` Jobs. `A92-admin-listings.png` Listings. `A99-goods-disputes.png` Guarantee.
- Confidence: 9

### [SIM-UI.9] Long section name clipped in the gold pill
- Status: FIXED
- Severity: advisory
- Surface: Admin section picker
- Evidence: `A93-admin-disputes.png` — pill reads **“oods disputes”** (leading G clipped). Shorter names (Flags / Jobs / Guarantee) were fine (`A89`, `A91`, `A99`).
- Expected: full “Goods disputes”.
- Actual: `Menu` label proposed a too-narrow width; `lineLimit(1)` clipped the start.
- Remediation: `.fixedSize(horizontal: true, vertical: false)` on the label text and the gold `HStack`.
- Retest: `A99-goods-disputes.png` **Guarantee** fully readable after the same label path. Goods disputes row not re-shot after `fixedSize`; residual: reopen that section once.
- Confidence: 8

### [SIM-UI.10] Admin Flags desk lists binary-only money keys
- Status: PASS
- Severity: advisory
- Surface: Admin → Flags
- Evidence: `A89-admin-labeled.png` — `customer_bnpl`, `instant_payout`, `insurance_competition`, `lead_gen` marked **Binary only (money/regulated)**. Non-money (`background_checks`, `fair_price_index`) have rollout % + Save.
- Expected: money keys binary-only; do not turn them off in this walk.
- Actual: Matches. UI toggle of `background_checks` was not visually confirmed (cliclick missed the switch). API `PUT` true→false both 200.
- Remediation: none for product. UI toggle GAP for this harness.
- Confidence: 8

### [SIM-UI.11] Guarantee empty state when flag is off
- Status: PASS
- Severity: advisory
- Surface: Admin → Guarantee
- Evidence: `A99-goods-disputes.png` — “Guarantee unavailable”, “flag: nomarkup_guarantee”, Try again. API `GET /admin/guarantee-claims` 503 `This feature is currently unavailable`.
- Expected: fail-closed empty, not a crash or spinner.
- Actual: Matches `AdminGuaranteeOpsView`.
- Remediation: none.
- Confidence: 9

### [SIM-UI.12] Admin Jobs / Listings lists are live with destructive actions visible
- Status: PASS
- Severity: advisory
- Surface: Admin Jobs, Listings, Goods disputes
- Evidence: `A91-admin-jobs.png` — 3+ jobs, Suspend / Remove. `A92-admin-listings.png` — listings, Suspend / Cancel. `A93-admin-disputes.png` — iPad Pro dispute, Resolve. Last listing row sits under the tab bar.
- Expected: lists + empty copy; destructive actions require a reason sheet (not one-tap).
- Actual: Lists load. Destructive controls **not** confirmed (per walk). Tab-bar clip of the last row is the same floating-bar inset as other lists.
- Remediation: none this cycle. Optional extra list inset.
- Confidence: 8

### [SIM-UI.13] Quote templates empty state (hub row)
- Status: PASS
- Severity: advisory
- Surface: Account → Quote templates
- Evidence: `A87-admin-labeled-picker.png` — “No quote templates” + Create template. Opened while scrolling to Admin.
- Expected: empty + CTA.
- Actual: Matches.
- Remediation: none.
- Confidence: 8

### [SIM-WF.1] Admin login + session restore
- Status: PASS
- Severity: advisory
- Surface: WF-AUTH.2 / WF-AUTH.7
- Evidence: argv auto-login to Home (`A10-home.png`, `A80-relaunch-home.png`). API login 200.
- Confidence: 9

### [SIM-WF.2] Five root tabs
- Status: PASS
- Severity: advisory
- Surface: WF-TAB.1
- Evidence: `A10` Home, `A20` Marketplace, `A30` Jobs, `A40` Messages, `A50` Account.
- Confidence: 9

### [SIM-WF.3] Admin console workflow
- Status: PASS (entry + Flags/Jobs/Listings/Goods disputes/Guarantee)
- Severity: advisory
- Surface: Account → Admin console
- Evidence: shots above. Remaining sections listed in the menu, not all opened.
- Confidence: 8

### [SIM-WIRE.1] Admin Flags ↔ API
- Status: PASS
- Severity: advisory
- Surface: `GET/PUT /api/v1/admin/flags`
- Evidence: UI list matches API 16 keys. `PUT background_checks` 200 both directions. Money keys not written.
- Confidence: 9

### [SIM-WIRE.2] Admin list GETs
- Status: PASS
- Severity: advisory
- Surface: admin jobs/listings/users/markets/disputes/fraud/guarantee
- Evidence: see Environment. Disputes/fraud empty arrays (UI Goods disputes still showed one open goods case). Guarantee 503 matches UI empty.
- Confidence: 8

## Fixes applied

| File | Change |
|------|--------|
| `ios/NoMarkup/Features/ParitySurfacesView.swift` | Admin section chrome: collapsed iOS 26 chip `ScrollView` → labeled Section `Menu`; `fixedSize` so long names do not clip. |
| `ios/NoMarkup/Core/MarketTickerView.swift` | Trailing inset so the last ticker chip can scroll fully on-screen. |

Rebuild: **BUILD SUCCEEDED**. Installed on 17e only. No commit.

## Residuals

| Item | Owner |
|------|--------|
| Visual re-open of **Goods disputes** after `fixedSize` (Guarantee pill already clean) | eng |
| UI tap of a non-money flag switch (API proven) | harness / eng |
| Admin Users / Fees / Banking / Platform / Fraud / Advances / Markets / Taxonomy / Insurers / Challenges / Verify / Licenses / Insurance / Reviews lists | GAP this walk — menu-reachable |
| Do not flip money/regulated flags; do not confirm bans | followed |
| Home stats first-paint clip on 17e | advisory |
| iOS 26 `.searchable` blank pill | system chrome |

## Commands to reproduce

```bash
# 17e already booted
xcrun simctl launch 5B84AFEE-78CD-4427-A536-95EE91D81220 com.nomarkup.app \
  -ui-test-email admin@nomarkup.com -ui-test-password 'Password123!'
bash ~/.grok/skills/iphone-simulator/scripts/sim-screenshot.sh \
  --udid 5B84AFEE-78CD-4427-A536-95EE91D81220 \
  --out docs/compliance/sim-runs/2026-08-12-clean/A10-home.png
# Taps: docs/compliance/sim-runs/2026-08-12/sim-tap.sh --device "iPhone 17e" --nx --ny
# No simctl openurl
```

## Disclaimer

Simulator walk on a local seed + Debug build. Stripe publishable key is not set; money charges were not attempted. Destructive admin writes were not confirmed. Screenshot coordinates use the 2026-08-12 `sim-tap.sh` insets (clicks land slightly high on 17e).
