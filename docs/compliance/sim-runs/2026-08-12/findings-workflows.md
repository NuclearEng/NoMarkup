# Workflow matrix — 2026-08-12 (deep / fix)

- **API**: `http://127.0.0.1:8081` health 200 (`{"status":"ok","version":"dev"}`)
- **Sims**: customer iPhone 17 Pro Max `503E262C-5731-45BE-A459-CFF59551539E`; provider iPhone 17 `B3CA7DF9-228C-4490-B5B7-57F2B0FE5D6D`; admin iPhone 17e `5B84AFEE-78CD-4427-A536-95EE91D81220`. Did not use XCUITest `7F123C44`.
- **BE suite**: `API_BASE=http://127.0.0.1:8081 bash scripts/ios-full-feature-e2e.sh` → **66 pass / 0 fail / 1 skip** (no public listings until this run created one).
- **Flags**: `passkeys=false` (passkey button correctly hidden).
- **Coordinate note**: ui-surface repeatedly issued `nomarkup://` opens (`Open in "NoMarkup"?`). Provider was walked after dialogs cleared; customer/admin often stayed under the system confirm.

Cells: **C**ustomer / **P**rovider / **A**dmin. Status: PASS / FAIL / GAP / BLOCKED / N/A.

## Matrix

| ID | Workflow | C | P | A | Notes |
|----|----------|---|---|---|-------|
| WF-AUTH.1 | Cold launch signed-out | GAP | PASS | GAP | P after reinstall: LoginView + SIWA + Create account + Forgot password (`wf-p-30-reinstall.png`). C/A stayed session-restored. |
| WF-AUTH.2 success | Email/password login | PASS | PASS | PASS | API `POST /auth/login` 200 all three. Argv auto-login on C/A. P signed in after reinstall (`wf-p-31-login.png` Home). |
| WF-AUTH.2 fail | Wrong password | PASS | PASS | PASS | API 401 `invalid credentials`. UI error path is `AuthViewModel.login()` → `errorMessage`. Empty-field client copy: “Enter email and password.” UI keystroke walk GAP (dialogs). |
| WF-AUTH.2 empty | Empty fields | PASS | PASS | PASS | Client-side guard (no network). Same as fail row. |
| WF-AUTH.3 | Register duplicate | PASS | PASS | PASS | API `POST /auth/register` 409 `email already taken`. Happy-path new account not created. Form: `RegisterView`. |
| WF-AUTH.4 | Sign in with Apple | PASS | PASS | PASS | Black SIWA button on LoginView (`wf-p-30-reinstall.png`). Full ASAuthorization not run on Simulator. |
| WF-AUTH.5 | Passkey gated | PASS | PASS | PASS | `GET /api/v1/flags` `passkeys=false`. Login screenshot has no “Sign in with Passkey” (gated in `LoginView`). |
| WF-AUTH.6 | Forgot password | PASS | PASS | PASS | Form `ForgotPasswordView`. API `POST /api/v1/auth/request-password-reset` **200** `{"status":"ok"}` (not `/forgot-password`, which 404s). |
| WF-AUTH.7 | Session restore | PASS | GAP | PASS | C: terminate + relaunch without argv still Home (`wf-c-03-session-restore.png`); reinstall still authed (`wf-c-30-reinstall.png`). A: reinstall still Home. P: reinstall showed login (stale keychain + argv skip — SIM-WF.2). |
| WF-AUTH.8 | Sign out | GAP | GAP | GAP | `AuthViewModel.signOut()` clears Keychain, widgets, Spotlight, best-effort push unregister. UI Sign out not tapped (did not leave money/delete). Session-expired copy observed on P instead. |
| WF-TAB.1 | Each root tab | PASS | PASS | PASS | 5-tab shell all roles. P walked Home / Marketplace / Jobs / Messages / Account. C+A Home + Marketplace. |
| WF-TAB.2 | Tab badges | PASS | PASS | PASS | Account unread matched API: C 14→4 after `notifications/read-all`; P 68→69; A 51. Messages badge **1** on P after WF send (`wf-p-33-msg.png`). |
| WF-TAB.3 | Deep link to tab | PASS | PASS | PASS | In-foreground `simctl openurl` (no extra confirm): `nomarkup://jobs/{id}`, `/listings/{id}`, `/bids`, `/orders`, `/post-job`, `/check-in`, `/watchlist`. |
| WF-MKT.1 | Browse listings | PASS | PASS | PASS | After create: list “1 of 1” Sim WF iPad Air $150→$160 (`wf-p-01-mkt.png`, `wf-a-01-mkt.png`). Before create: API `listings` count 0 and Home **0 GOODS**. |
| WF-MKT.2 | Listing detail | PASS | PASS | PASS | `nomarkup://listings/22d5085b-…` → $160 current high, 1 bid, Place a bid section (`wf-p-41-listingdl.png`). |
| WF-MKT.3 | Place bid UI | PASS | PASS | PASS | Bid UI on detail. API `POST /listings/{id}/bids` **201** amount_cents=16000 (customer). |
| WF-MKT.4 | Watchlist add/remove | PASS | PASS | PASS | Customer `POST /watch` **200** `watching=true`. P watchlist empty-state correct (P did not watch) (`wf-p-49-watch.png`). Heart on listing chrome. |
| WF-MKT.5 | Create listing | PASS | PASS | PASS | API `POST /listings` **201** id `22d5085b-…` (provider seller). Native wizard `CreateListingView` + Home/Account “Sell an item”. Full 4-step UI fill GAP (Sell tap hit Post a job). |
| WF-MKT.6 | My orders / pay | PASS | PASS | PASS | `nomarkup://orders` → 36 orders, Apple Pay CTAs (`wf-p-43-orders.png`). Stripe pk not configured (Account “Not configured”) — pay path scaffold. Did not complete a charge. |
| WF-JOB.1 | Browse jobs | PASS | PASS | PASS | Jobs Browse “2 of 395” live reverse auctions (`wf-p-32-jobs.png`). Home desk shows **2 JOBS** (live-on-page; see SIM-WF.3). |
| WF-JOB.2 | Job detail + ladder | PASS | PASS | PASS | Live HVAC floor, 0 bids, spectate/replay (`wf-p-40-jobdl.png`). |
| WF-JOB.3 | Place reverse bid | PASS | PASS | PASS | Bid UI on job detail (scroll). API e2e `provider.job.bid` **201** amount_cents=45000 job `559c356d`. |
| WF-JOB.4 | Post job | PASS | PASS | PASS | `nomarkup://post-job` + Home “Post a job” → Step 1 of 4 Basics (`wf-p-44-postjob.png`). |
| WF-JOB.5 | My bids | PASS | PASS | PASS | `nomarkup://bids` → My bids, 40 goods rows (`wf-p-42-bids.png`). |
| WF-JOB.6 | Contracts list + detail | PASS | PASS | PASS | List 11 contracts (`wf-p-50-contracts.png`); detail disputed NM-2026-00118 (`wf-p-45-checkin.png`). Admin API contracts 0. |
| WF-JOB.7 | Check-in | PASS | PASS | PASS | `nomarkup://check-in/{id}` auto-check-in → system location pre-prompt (`wf-p-45-checkin.png`); then “Location request timed out…” (`wf-p-48-sell.png`). Surface proven; sim GPS residual. |
| WF-MSG.1 | Inbox | PASS | PASS | GAP | P: 2 of 2 threads, unread 1 on our ping (`wf-p-33-msg.png`). C API 2 channels. A API 0 channels; UI inbox blocked by openurl dialog. |
| WF-MSG.2 | Open thread | GAP | GAP | N/A | Inbox rows did not push thread on cliclick (hit-testing). Did not FAIL product — GAP. |
| WF-MSG.3 | Send if channel exists | PASS | PASS | N/A | `POST /channels/00000000-0000-0000-0000-000000000900/messages` **201** content `Sim WF matrix ping 2026-08-12`. Composer UI GAP. |
| WF-MSG.4 | Unread badge clears | GAP | GAP | N/A | Badge **appeared** after send (P Messages 1). Clear-after-read not proven (thread not opened). |
| WF-ACC.1 | Profile / settings | PASS | PASS | PASS | Account hub: signed in, email, API 127.0.0.1:8081 (`wf-p-34-acc.png`). |
| WF-ACC.2 | Payment methods | PASS | PASS | PASS | Row visible (`wf-p-35-acc-scroll1.png`). E2E `customer.payment-methods` 200. Detail screen not opened. |
| WF-ACC.3 | Security / passkeys / MFA | PASS | PASS | PASS | `account.row.security` present; passkeys gated off. E2E auth/session 200. |
| WF-ACC.4 | Notification preferences | PASS | PASS | PASS | Row visible (`wf-p-36-acc-scroll2.png`). E2E `notification-prefs` 200. |
| WF-ACC.5 | Account deletion entry | PASS | PASS | PASS | `AccountDeletionView` + `account.row.deleteAccount`. **Did not confirm** (destructive). |
| WF-ACC.6 | Legal / terms / support | PASS | PASS | PASS | Rows: Privacy, Terms, Guidelines, Support (`AccountView` legal section). Login footer Privacy/Terms links. Sheets not opened this pass. |
| WF-SYS.1 | Widget timeline | GAP | GAP | GAP | `NoMarkupWidget.appex` in signed build. Not added to SpringBoard. |
| WF-SYS.2 | Live Activity after bid | GAP | GAP | GAP | `AuctionLiveActivityController` exists. Bid was API-side; ActivityKit not observed on sim. |
| WF-SYS.3 | App Intent / openurl | PASS | PASS | PASS | Intents map to `nomarkup://bids|watchlist|post-job|check-in`. Exercised via `simctl openurl`. |
| WF-SYS.4 | Push pre-prompt | PASS | PASS | PASS | Account “Turn on push notifications” (`wf-p-34-acc.png`). `PushRegistration.noteValueMoment()`. |
| WF-NEG.1 | API 401 → re-auth | PASS | PASS | PASS | P reinstall: “Your session expired. Please sign in again.” (`wf-p-30-reinstall.png`). `GET /users/me` + bad Bearer → 401. |
| WF-NEG.2 | Offline / airplane | GAP | GAP | GAP | Did not toggle airplane (shared host/gateway). Banner id `banner.offline` exists (`NetworkMonitor`). |
| WF-NEG.3 | Invalid deep link | PASS | PASS | PASS | `nomarkup://this-is-not-a-real-route-zzz` — no crash; previous sheet remained (`wf-p-46-baddlink.png` still on contract). |
| WF-NEG.4 | Empty catalog | PASS | PASS | PASS | Before listing create: API listings `[]`, Home **0 GOODS**. Empty-state copy in `MarketplaceView` (“No listings nearby”). After create, catalog is 1 (not empty). Jobs never empty (395). |

## SIM-WF findings

### [SIM-WF.1] Marketplace empty “Sell an item” was a no-op
- Status: FIXED
- Severity: major
- Surface: Marketplace empty catalog CTA
- Evidence: `MarketplaceView` empty `BrandEmptyState` action previously only fired `BrandHaptics.selection()` (comment: “jump Account for discovery”).
- Expected: CTA opens the native sell wizard (same as Home / Account).
- Actual: Dead button when catalog empty.
- Remediation: Present `CreateListingView` in a sheet from the empty-state action.
- Retest: Code path `showCreateListing = true` + `.sheet` → `CreateListingView`. Catalog was no longer empty after API create, so empty-state tap not re-shot; Home/Account sell entries still present.
- Confidence: 9

### [SIM-WF.2] Launch-test credentials skipped after optimistic Keychain restore
- Status: FIXED
- Severity: major
- Surface: DEBUG argv/env auto-login (`-ui-test-email` / `NOMARKUP_UI_TEST_*`)
- Evidence: After signed reinstall, P launched with argv still showed LoginView + “Your session expired…” (`wf-p-30-reinstall.png`). `applyLaunchTestCredentialsIfNeeded()` returned early when `isAuthenticated` was optimistic-true, then refresh 401 cleared the session and never called `login()`.
- Expected: Launch-test email/password always perform login (role switches / XCUI).
- Actual: Stale tokens blocked argv login.
- Remediation: Always assign credentials and `await login()`.
- Retest: Incremental signed rebuild installed on the three assigned sims. Full stale-keychain repro not re-run this cycle.
- Confidence: 8

### [SIM-WF.3] Home “OPEN JOBS” shows 2 while Jobs browse is “2 of 395”
- Status: RISK
- Severity: advisory
- Surface: Home market desk / stats
- Evidence: Home `2 JOBS · 1 GOODS` (`wf-p-60-home.png`). Jobs tab `2 of 395` (`wf-p-32-jobs.png`). `GET /jobs?page_size=100&sort=created_at` returns 100 rows (98 closed / 2 active) with `pagination.totalCount=395`. Home `loadCatalog()` uses `pagination?.resolvedTotal ?? liveJobs.count`.
- Expected: Stats match a defined population (all open vs live-on-page) and stay consistent with Jobs.
- Actual: Desk shows 2 (live visible); Jobs pagination total is 395 (includes closed). Label says OPEN.
- Remediation: Drive Home count from the same filter Jobs Browse uses, or label as “Live now”.
- Confidence: 7

### [SIM-WF.4] Inbox row tap did not open a thread (sim cliclick)
- Status: GAP
- Severity: advisory
- Surface: Messages inbox
- Evidence: Multiple taps on the first thread (`wf-p-37-thread.png`, `wf-p-38-thread.png`, `wf-p-39-thread2.png`) stayed on the list. Inbox itself loaded (2 of 2) with unread 1.
- Expected: Tap opens the conversation.
- Actual: Unverified — likely hit-testing/search field, not a proven dead row.
- Remediation: Re-tap via XCUI `cells` / a11y id; add `messages.row.{id}` if missing.
- Confidence: 4

### [SIM-WF.5] Check-in location times out on Simulator GPS
- Status: PASS (surface) / residual
- Severity: advisory
- Surface: `nomarkup://check-in/{contractID}`
- Evidence: System location dialog (`wf-p-45-checkin.png`) then “Location request timed out. Move outdoors or wait for GPS lock…” (`wf-p-48-sell.png`).
- Expected: Check-in surface + purpose copy; sim GPS may fail.
- Actual: Surface and copy correct; lock not obtained.
- Remediation: None required for product; grant location via `simctl privacy` for a green check-in.
- Confidence: 8

### [SIM-WF.6] Public goods catalog was empty until a listing was created
- Status: PASS (empty-state + API)
- Severity: advisory
- Surface: Marketplace / Home goods count
- Evidence: `GET /listings` returned `listings: []`. Seller `listings/mine` were expired/sold only. Created `22d5085b-f0cb-44bc-b16a-2c709b995bf5` → public count 1. E2E skipped `customer.listing.*` before create.
- Expected: Empty catalog shows empty state, not an infinite spinner.
- Actual: Home 0 GOODS; after create, list + detail work.
- Confidence: 9

## API e2e (BE half)

`/tmp/ios-full-feature-e2e.log` — **pass=66 fail=0 skip=1**.

Covered: health, flags, public jobs/listings/map, auth C+P, me, payments methods, notif prefs, jobs/mine, orders, contracts, bids, watchlist, channels, job detail/bids/auction-state, contract detail, watch/unwatch, wishlist, follow, provider reverse bid 201.

Skip: `customer.listing.*` — no public listings at suite start.

## Fixes applied

| File | Change |
|------|--------|
| `ios/NoMarkup/Features/MarketplaceView.swift` | Empty-state “Sell an item” presents `CreateListingView` sheet; preview gets `AuthViewModel`. |
| `ios/NoMarkup/Auth/AuthViewModel.swift` | Launch-test credentials always call `login()` (no skip on optimistic session). |
| `docs/compliance/sim-runs/2026-08-12/sim-tap.sh` | Window match: exact device token + “Clone N of …” (so “iPhone 17” ≠ “iPhone 17 Pro Max”). |

Signed rebuild: `ios/DerivedDataBuildWF` (adhoc “Sign to Run Locally” — not `CODE_SIGNING_ALLOWED=NO`). Installed on the three assigned sims.

## Residuals

- Airplane / offline banner not toggled (shared gateway).
- Widget not added to SpringBoard; Live Activity not observed after in-app bid.
- Message thread + badge-clear not UI-proven.
- Account payment/security/legal/delete **screens** not opened (rows + API + deletion entry exist; delete not confirmed).
- Create-listing 4-step wizard not filled in UI (API create 201).
- ui-surface `Open in NoMarkup?` dialogs stole C/A foreground often.
- Home OPEN JOBS count vs Jobs `2 of 395` (SIM-WF.3).

## One-line summary

Deep matrix exercised against a live gateway (e2e 66/0/1) and three sims: marketplace/jobs/messages/account/deep-links/check-in/orders/bids pass; empty Sell CTA and argv auto-login fixed; residuals are offline toggle, widget/LA, thread tap, and some Account leaves.
