# IphoneSimulator Run Report

- **Target**: NoMarkup iOS (`ios/NoMarkup.xcodeproj`)
- **Date**: 2026-08-12
- **Simulator**: iPhone 17 Pro (`7F123C44…`, XCUITest) · iPhone 17 Pro Max (`503E262C…`, customer) · iPhone 17 (`B3CA7DF9…`, provider) · iPhone 17e (`5B84AFEE…`, admin) / iOS 26.5
- **Scheme**: NoMarkup · bundle `com.nomarkup.app` · Debug signed “Sign to Run Locally”
- **API base / backend**: `http://127.0.0.1:8081` · `GET /health` **200** (`{"status":"ok","version":"dev"}`)
- **Mode**: fix
- **Depth / scope**: deep / full (customer + provider + admin)
- **Readiness**: **YELLOW**

## Target card

| Field | Value |
|-------|--------|
| Project / scheme | `ios/NoMarkup.xcodeproj` / NoMarkup |
| Bundle id | `com.nomarkup.app` |
| Simulator | 4× iOS 26.5 (Pro / Pro Max / 17 / 17e) |
| API base | `http://127.0.0.1:8081` |
| Backend health | up (stale `.dev/bin/gateway` PID 38191 since Wed) |
| Mode | fix |
| Depth / scope | deep / full · 3 seed profiles |

## Executive summary

Customer, provider, and admin all signed in on dedicated simulators against a live gateway. Cold launch shows Sign in with `API: 127.0.0.1:8081`. After a signed rebuild, argv auto-login (`-ui-test-email` / `-ui-test-password`) reaches the 5-tab shell on every role.

Home desk was lying: it labeled **393 OPEN JOBS** while Search page-1 was closed-only and the ticker said “Waiting for open floor…”. Fixed by newest-first sort, live-status counts, and a seeded live HVAC job (`e217067d-…`, $185). Retest shot `C11-home-fixed.png` / `C11-home-final.png`: **2 JOBS · 1 GOODS**, ticker **HVAC $185.00**.

Provider Marketplace shows a live goods lot (“Sim WF used iPad Air”, $160, 1 bid). Account badges differ by role (customer 4, provider 68, admin 51).

Open majors that keep this **YELLOW**: running gateway is older than `router.go` (`GET …/work-evidence` and `PUT …/methods/{id}/default` are **404** on the live binary); ScreenshotWalk lost the tab bar mid-Account sweep (**29 unique WALK-SKIPs**, GAP not PASS). All six section agents finished.

## Environment evidence

| Step | Result |
|------|--------|
| Xcode | 26.5 (17F42) |
| Unsigned skill build (`CODE_SIGNING_ALLOWED=NO`) | Keychain **-34018** on auto-login — `01-customer-autologin.png` |
| Signed Debug install + argv creds | Customer Home — `01-customer-argv-login.png` |
| Seed login | customer / provider / admin / provider2 → **HTTP 200** |
| Gateway process | `.dev/bin/gateway` PID 38191 (stale vs current tree) |
| Skill script | `sim-build-launch.sh` no longer forces unsigned builds |

## UI inventory coverage

Inventory: [`docs/compliance/sim-runs/2026-08-12/inventory.md`](./sim-runs/2026-08-12/inventory.md)  
UI walk: [`docs/compliance/sim-runs/2026-08-12/findings-ui.md`](./sim-runs/2026-08-12/findings-ui.md)

| Surface | customer | provider | admin | Evidence |
|---------|----------|----------|-------|----------|
| Cold Sign in | PASS | — | — | `00-launch.png` |
| Home (signed in) | PASS | PASS | PASS | `C11-home-final.png`, `A11-home-fixed.png`, `P11-home.png` |
| Market desk + stats | PASS (after fix) | PASS | PASS | 2 jobs / 1 good / LIVE |
| Marketplace | PASS (1 live lot) | PASS | GAP (not re-shot after listing seed) | `P11-home-final.png` is Marketplace |
| Jobs browse / detail | PASS (deep link + seed job) | PASS (OS confirm overlay) | PASS | `C32-job-detail.png` family / `P31-job-detail.png` |
| Messages | PASS (inbox chrome) | GAP | GAP | `C40-messages.png` |
| Account hub | GAP (`nomarkup://account` not routed) | GAP | GAP | OS confirm only |
| Deep link `javascript:` / `file:` | PASS (no crash) | — | — | `C-neg-javascript.png`, `C-neg-file.png` |
| SIWA / passkey / Face ID / Apple Pay sheet | residual | residual | residual | Simulator / hardware |

## Findings

### UI

### [SIM-UI.1] Unsigned Debug cannot persist session
- Status: FIXED
- Severity: blocker
- Surface: Login / Keychain
- Evidence: `01-customer-autologin.png` “Keychain error (-34018)” after `CODE_SIGNING_ALLOWED=NO`
- Expected: Tokens save; Home appears
- Actual: Login succeeded at API, Keychain add failed
- Remediation: Signed simulator build; skill `sim-build-launch.sh` no longer disables signing
- Retest: `01-customer-argv-login.png` signed-in Home
- Confidence: 10

### [SIM-UI.2] Home desk showed 393 OPEN JOBS with empty ticker
- Status: FIXED
- Severity: major
- Surface: Home market desk / stats
- Evidence: `C11-home.png` 393 / “Waiting for open floor…”; Search default order is oldest closed jobs
- Expected: Counts and chips match live auctions
- Actual: Now newest-first + live-status `jobTotal`/`listingTotal`; ticker from priced `deskJobs`
- Retest: `C11-home-fixed.png` **2 JOBS · 1 GOODS**, HVAC $185 chip
- Confidence: 9

### [SIM-UI.3] Jobs browse listed closed auctions as the open floor
- Status: FIXED
- Severity: major
- Surface: Jobs tab Browse
- Evidence: `JobsView` used unsorted Search; first 40 rows were `closed`
- Expected: Browse = open reverse auctions
- Actual: `sort=created_at&sort_dir=desc` + `isOpenBrowseStatus`
- Confidence: 8

### [SIM-UI.4] Marketplace empty CTA did nothing
- Status: FIXED
- Severity: major
- Surface: Marketplace empty “Sell an item”
- Evidence: action was a no-op comment; now presents `CreateListingView` sheet
- Confidence: 8

### [SIM-UI.5] `nomarkup://account` is not a typed route
- Status: FIXED
- Severity: advisory
- Surface: Deep link
- Evidence: `openurl nomarkup://account` previously → system sheet then stayed on Home (`C50-account.png`)
- Expected: Account tab
- Actual: Added `DeepLinkRoute.account` + `RootTabView` tab switch (`/account`, `/me`, `/profile`)
- Remediation: Rebuild to pick up route (code landed this run)
- Confidence: 8

### Workflows

Full matrix: [`docs/compliance/sim-runs/2026-08-12/findings-workflows.md`](./sim-runs/2026-08-12/findings-workflows.md).  
API suite: `scripts/ios-full-feature-e2e.sh` → **66 pass / 0 fail / 1 skip**.

| ID | Status | Notes |
|----|--------|-------|
| WF-AUTH.1 | PASS / GAP | Provider cold Sign in shot; C/A often session-restored |
| WF-AUTH.2 | PASS | Seed login 200 all roles; 401 invalid; empty-field client guard |
| WF-AUTH.3 | PASS | Duplicate register 409 |
| WF-AUTH.4–5 | PASS (button) | SIWA present; passkey hidden (`passkeys=false`) |
| WF-AUTH.6 | PASS | `POST /auth/request-password-reset` 200 |
| WF-AUTH.7 | PASS | Session restore after terminate; argv always `login()` after SIM-WF.2 |
| WF-AUTH.8 | GAP | Sign-out code path not UI-tapped |
| WF-TAB.1–2 | PASS | 5 tabs; badges match unread API |
| WF-TAB.3 | PASS | In-foreground `openurl` to jobs/listings/bids/orders/post-job/check-in/watchlist |
| WF-MKT.1–6 | PASS | Created listing `22d5085b-…`; customer watch + bid $160 **201**; orders list 36 |
| WF-JOB.1–6 | PASS | Live HVAC floor; provider reverse bid **201** (e2e); post-job wizard; 11 contracts |
| WF-JOB.7 | PASS + residual | Check-in surface + location prompt; sim GPS timed out |
| WF-MSG.1 / .3 | PASS | Inbox + `POST …/messages` **201**; thread tap GAP (cliclick) |
| WF-ACC.1–6 | PASS | Hub + money/legal/delete **entry** (no confirm) |
| WF-SYS.1–2 | GAP | Widget / Live Activity not added to SpringBoard |
| WF-NEG.1 / .3–4 | PASS | 401 → session expired; bad scheme no crash; empty catalog before listing seed |
| WF-NEG.2 | GAP | Airplane not toggled (shared gateway) |

**SIM-WF.1 FIXED** empty Sell CTA. **SIM-WF.2 FIXED** launch-test login skipped after stale Keychain.

### Wiring

See [`docs/compliance/sim-runs/2026-08-12/findings-wiring.md`](./sim-runs/2026-08-12/findings-wiring.md).

- Primary FE paths match `router.go` and live 200s (auth, jobs, listings, channels, notifications, contracts, orders, flags, calendar).
- **SIM-WIRE.31 FAIL**: `GET /api/v1/contracts/{id}/work-evidence` → chi **404** on stale gateway; source has the route.
- **SIM-WIRE.17 FIXED** on client (Set default + Idempotency-Key); live PUT still 404 until gateway rebuild.

### Security

See [`docs/compliance/sim-runs/2026-08-12/findings-security.md`](./sim-runs/2026-08-12/findings-security.md) — SIM-SEC.1–10 **GREEN** after two fixes.

- Tokens in Keychain (`AfterFirstUnlockThisDeviceOnly`); DEBUG auto-login `#if DEBUG` only.
- Deep-link schemes allowlisted (`nomarkup` / `https` / `http`); `javascript:` / `file:` rejected (`DeepLinkRouter.isAllowedIncomingURL`).
- **SIM-SEC.2 FIXED:** `NSAllowsLocalNetworking` removed from the shared shipping `Info.plist` (`scripts/ios-archive-lint.sh` green). Simulator loopback HTTP still works. **Physical-device LAN `http://192.168.x.x:8081` will fail ATS** until you use an HTTPS tunnel / staging — do not put the exception back in this plist.
- Release API base remains `https://api.no-markup.com`.

### Performance

See [`docs/compliance/sim-runs/2026-08-12/findings-perf.md`](./sim-runs/2026-08-12/findings-perf.md).

- Cold launch → chrome ~1.5 s Debug.
- Tab switch no multi-second blank.
- Jobs `List` paginated (40).
- **SIM-PERF.5 FIXED**: contract completion photos go through `ImageUploader` downsample off-main.

### XCUITest

See [`docs/compliance/sim-runs/2026-08-12/findings-uitest.md`](./sim-runs/2026-08-12/findings-uitest.md). Destination: iPhone 17 Pro `7F123C44`. Soft-skips are **GAP**, not PASS.

| Suite | Pass | Fail | Skip | Soft-skip (GAP) |
|-------|-----:|-----:|-----:|----------------:|
| Unit (`NoMarkupTests` + WorkEvidence) | **120** | 0 | 0 | 0 |
| UI after TabAudit fix | **20** | 0 | 0 | 29 unique walk skips |

- **SIM-TEST.2 FIXED:** `WorkEvidenceTests.swift` was on disk but not in the unit target — 6 cases now run.
- **SIM-TEST.4 FIXED:** TabAudit treated seed price **`$500.00`** as HTTP 500. Predicate now matches `server error` / `HTTP 500` only. Retest 152.8s **TEST SUCCEEDED**.
- **SIM-TEST.5–.6 GAP (major):** `test02CustomerAccountWalk` lost the tab bar after Following; 23 later Account rows soft-skipped. XCTest still marked the case Passed — **do not claim those destinations were walked**.

## Fixes applied

| Change | File | Retest |
|--------|------|--------|
| Newest-first job fetch + live counts | `APIClient.swift`, `HomeView.swift`, `JobsView.swift` | `C11-home-fixed.png` 2/1 + HVAC chip |
| Honest empty-desk copy | `MarketTickerView.swift` | “No live auctions right now” when 0/0 |
| Seed live HVAC job | `POST /api/v1/jobs` `e217067d-…` | Search newest-first `active live 18500` |
| Signed sim builds | skill `sim-build-launch.sh` | argv login Home |
| Deep-link scheme allowlist | `DeepLinkRouter.swift`, `NotificationsView.swift` | `javascript:` / `file:` no crash; compile isolation |
| Set-default card | `APIClient+Extras.swift`, `Models+Extras.swift`, `PaymentMethodsView.swift` | Compiles; live PUT blocked on stale GW |
| Marketplace Sell sheet | `MarketplaceView.swift` | Empty CTA opens wizard |
| Launch-test argv skipped after stale Keychain | `AuthViewModel.swift` | Always `login()` when test email/password present |
| GPS timeout started behind the permission sheet | `JobSiteLocationProvider.swift` | Clock starts after Allow |
| Job detail last section under floating tab bar | `JobDetailView.swift` | 28pt bottom safe-area inset |
| WorkEvidence unit tests not in target | `project.pbxproj` | 6/6 pass |
| TabAudit `$500.00` ≠ HTTP 500 | `TabAuditUITests.swift` | retest **TEST SUCCEEDED** |
| Completion photo downsample | `ImageUploader.swift`, `ContractDetailView.swift` | Unit tests added |

## Residuals

| Item | Owner |
|------|--------|
| Rebuild/restart `.dev/bin/gateway` so `work-evidence`, set-default PM, public RUM exist | eng |
| ScreenshotWalk tab-bar loss after Following (29 unique WALK-SKIPs) | eng — keep `root.tabview` after Account NavigationLinks |
| WorkEvidenceTests + TabAudit `$500` predicate | done this run (not committed) |
| SIWA / passkey / Apple Pay / Face ID / real APNs | device / founder |
| Checkr live / StoreKit flag / off-session | founder / flags |
| Physical-device Debug LAN HTTP (`192.168.x.x:8081`) | founder / eng — use HTTPS tunnel; ATS exception stripped from shipping plist |
| Rotate `Password123!` seed history | founder (SEC-17) |
| Full Account-row mutation walk (delete account, Stripe sheet, camera) | manual residual |
| Public Search has no `status_filter` in proto | eng (client filters live for now) |

## Commands to reproduce

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
curl -sf http://127.0.0.1:8081/health
bash ~/.grok/skills/iphone-simulator/scripts/sim-boot.sh --udid 503E262C-5731-45BE-A459-CFF59551539E
xcodebuild -project ios/NoMarkup.xcodeproj -scheme NoMarkup -configuration Debug \
  -destination 'platform=iOS Simulator,id=7F123C44-2F2C-442B-90A6-92DE8E548510' \
  -derivedDataPath /tmp/iphone-sim-derived-signed build
# Install + argv login (do NOT use CODE_SIGNING_ALLOWED=NO)
SIMCTL_CHILD_NOMARKUP_API_BASE_URL=http://127.0.0.1:8081 \
  xcrun simctl launch --terminate-running-process 503E262C-5731-45BE-A459-CFF59551539E com.nomarkup.app \
  -ui-test-email customer@nomarkup.com -ui-test-password 'Password123!'
```

## Disclaimer

This report is simulator + local-gateway dogfood. It does not prove App Store Review, production TLS, physical Apple Pay, or a rebuilt gateway. Soft-empty XCUITest skips are not PASS. Readiness is **YELLOW** until the live gateway binary matches `router.go` and the Account-hub walk keeps the tab bar.
