# Gap hunt — 2026-08-22 full-sim (`--fix`)

**Agent:** iphone-sim product-gap hunter  
**Mode:** fix. **No commit. No money submit.**  
**Ground truth:** static Swift + live `GET /health` **200** + prior shots in `ui/` + `02-ui.md` / `01-wiring.md`.  
**Sims:** did **not** occupy reserved devices.

| Device | UDID | Occupied by |
|--------|------|-------------|
| iPhone 17 Pro | `7F123C44-2F2C-442B-90A6-92DE8E548510` | `test08AdminAccountAndConsole` · `DerivedDataFullSim` |
| iPhone 17 Pro Max | `503E262C-5731-45BE-A459-CFF59551539E` | `testCatalogAllPersonasRequestLogAndRows` · `DerivedDataFullSimB` |
| iPhone 17 | `B3CA7DF9-228C-4490-B5B7-57F2B0FE5D6D` | `testTabsCustomerAndProviderAudit` · `DerivedDataFullSimC` |

Visual retest of this cycle’s diffs is **BLOCKED** until those xcodebuild runs finish. IDs and empty copy are source-verified.

---

## Hunt scope

1. Missing a11y ids listed as *(none)* (MFA code, login legal, forgot-password, marketplace map root).
2. Jobs Mine / marketplace search / Home post-job + sell: dead buttons, missing loading/empty/error.
3. Customer seeing provider-only money rows without role enable.
4. Request log / activity wiring.
5. Crash paths (force unwrap, missing empty state).

---

## Findings

### [SIM-UI.12] MFA challenge had no stable identifiers
- Status: FIXED
- Severity: major
- Surface: `LoginView` `mfaForm` (inventory §1)
- Evidence: `ios/NoMarkup/Auth/LoginView.swift` pre-fix — code field labeled “Authenticator code”; submit labeled “Verify authenticator code and sign in”; no `accessibilityIdentifier`. Inventory: **no stable id**.
- Expected: XCUITest can type the 6-digit code and tap verify without relying on labels.
- Actual: VoiceOver/UITest could reach the field by label only.
- Remediation: `login.mfaCode`, `login.mfaSubmit`, `login.mfaBack`, `login.mfaError`, `login.mfaStatus`.
- Retest: static — identifiers present at `LoginView.swift:210–257`. Simulator MFA not exercised (seed logins have no `mfa_required`).
- Confidence: 9

### [SIM-UI.13] Login legal links had no identifiers
- Status: FIXED
- Severity: advisory
- Surface: Login footer Privacy / Terms (`00-inventory.md` §2 “*(none)*”)
- Evidence: `Link("Privacy")` / `Link("Terms")` with no ids.
- Expected: Stable ids for legal hops from the signed-out shell.
- Actual: Tappable Safari links, untestable by id.
- Remediation: `login.privacy`, `login.terms` + 44pt min height.
- Retest: static `LoginView.swift:414–421`.
- Confidence: 9

### [SIM-UI.14] Marketplace map root identifier
- Status: PASS
- Severity: advisory
- Surface: `MarketplaceMapView`
- Evidence: `ParitySurfacesView.swift:579` and `:623` already `marketplace.map.root`; refresh `marketplace.map.refresh`. Added `marketplace.map.myLocation` on the location toolbar control.
- Expected: Map root id as inventory delta noted.
- Actual: Already shipped; location control was the leftover *(none)*.
- Remediation: `marketplace.map.myLocation`.
- Confidence: 9

### [SIM-UI.15] Forgot password + register fields missing ids
- Status: FIXED
- Severity: advisory
- Surface: `ForgotPasswordView` (inventory *(none)*), `RegisterView` password/role
- Evidence: Inventory listed forgot-password *(none)*. Root/email/send existed; token, new password, confirm, update, “I already have a token” did not. Register password/confirm/role/error/sign-in had labels only.
- Expected: Every user-reachable control has a stable id.
- Actual: Partial coverage.
- Remediation: `forgotPassword.{haveToken,token,newPassword,confirmPassword,update,error,signIn}`; `register.{password,confirmPassword,role,error,signIn}`.
- Retest: static. Existing `testForgotPasswordScreenOpens` still uses `forgotPassword.root` / `.email` / `.send` (send never tapped).
- Confidence: 9

### [SIM-UI.16] Jobs Mine empty treated dual-role as provider-only
- Status: FIXED
- Severity: major
- Surface: Jobs tab → Mine (`JobsView.swift`)
- Evidence: `GET /api/v1/jobs/mine` is `ListCustomerJobs` (`gateway/internal/handler/job.go:864–874`) — jobs **this user posted**, not awarded provider work. Empty branch was `if viewerHasProviderRole` → **No awarded work**. Seed `customer@` is `customer`+`provider` (`03-workflows.md` SIM-WF.2). With 0 posted jobs a dual-role user would see provider copy and no Post CTA. Customer-only empty had **no** Post a job action (Marketplace empty has Sell).
- Expected: Dual-role / customer empty = “No jobs yet” + Post a job. Provider-only = browse CTA, not a lie about awarded work.
- Actual: Any provider bit flipped the empty to awarded-work copy; customer empty had no CTA.
- Remediation: Track `viewerHasCustomerRole`. Provider-only (`hasProvider && !hasCustomer`) keeps **No awarded work** + Browse (UITest title preserved) with honest body copy. Everyone else gets **No jobs yet** + Post a job sheet. Browse empty also gets Post a job (parity with Marketplace Sell).
- Retest: static. `testJobsMineSegment` still accepts “No jobs yet” / “No awarded work” / `jobs.list` / `jobs.mine.empty`. Visual Mine list for `customer@` was already populated (`ui/32-jobs-mine.png` 5 of 5) so empty CTA is un-shot this cycle.
- Confidence: 8

### [SIM-UI.17] Marketplace search empty reused catalog-empty copy
- Status: FIXED
- Severity: major
- Surface: Marketplace `marketplace.search`
- Evidence: `MarketplaceView.swift` empty branch always titled **No listings nearby** + Sell. Live catalog `totalCount=0` (`02-ui.md` SIM-UI.2, `20-marketplace.png`). Typing “Makita” (`testMarketplaceSearchAndMap`) would still say nearby, not “no match”.
- Expected: Active `q` / category filter → search-miss copy. Bare empty catalog → nearby + Sell.
- Actual: Same empty for both.
- Remediation: `hasSearchQuery` → **No matching listings** (id stays `marketplace.empty`). Sell CTA kept. UITest emptyTitles include the new title.
- Retest: static. xcodebuild search walk not re-run (sim occupied).
- Confidence: 8

### [SIM-UI.18] Jobs Mine loading/error/list had no settle ids
- Status: FIXED
- Severity: advisory
- Surface: Jobs Mine
- Evidence: Browse had `jobs.loading` / `jobs.error` / `jobs.list`. Mine loading/error/list did not. `testJobsMineSegment` waits on `loadingID: jobs.loading` and `settledIDs: jobs.list, jobs.empty, jobs.error, jobs.mine.empty` — populated Mine relied on `app.cells`.
- Expected: Same loading/error/list ids on both segments.
- Actual: Mine loading was label-only (“Loading your jobs…”).
- Remediation: Mine loading → `jobs.loading`; error → `jobs.error`; list → `jobs.list`; scaffold/401 empties → `jobs.mine.empty`.
- Retest: static.
- Confidence: 8

### [SIM-UI.19] Messages loading/empty/error had no ids
- Status: FIXED
- Severity: advisory
- Surface: Messages inbox
- Evidence: Inventory only `messages.row.{id}`. Empty/error/loading unlabeled. `ui/40-messages.png` is a populated inbox (not the empty path).
- Expected: Settle ids like other catalogs.
- Actual: Customer2 empty (`test04`) could only match title text.
- Remediation: `messages.loading`, `messages.error`, `messages.empty`, `messages.searchEmpty`, `messages.list`.
- Retest: static.
- Confidence: 8

### [SIM-UI.20] Customer hub shows provider money rows (enabled, not hidden)
- Status: RISK
- Severity: advisory
- Surface: Account hub `account.row.*`
- Evidence: `AccountView.swift` — provider workspace, instant offers, seller payouts, seller analytics, business & finance, team, quote templates, verification documents, sales export, challenges are **enabled** for any signed-in user. Only unsigned/scaffold `.disabled`. Admin console **is** hidden behind `hasAdminRole`. Destinations fail-soft (`ProviderInstantOffersView` / `ProviderWorkspaceView` / `SellerPayoutsView` / `EmployeesView`: “Provider role required”). Profile can `enableRole("provider")`. Seed `customer@` is dual-role so the 02-ui walk seeing Instant offers is **in role**. `customer2@` (customer-only) would still see the rows.
- Expected: Product choice: hide vs disable vs dest-gate.
- Actual: Dest-gate, not hide. Not a money leak (writes still 403 / dest empty). Discoverability of “enable provider” vs a customer-only hub.
- Remediation: none this cycle (hiding would churn `allAccountNavigationRowIDs` + persona walks). If product wants a customer-only hub, gate the same rows on `hasProviderRole` the way Admin is gated.
- Confidence: 8

### [SIM-WIRE.4] Request log server merge
- Status: PASS
- Severity: advisory
- Surface: `account.row.requestLog` → `ClientActionLogView`
- Evidence: Already wired in this run’s `01-wiring.md` SIM-WIRE.3: `GET /api/v1/me/activity` on appear/refresh, fail-soft 401/404, merge by request id. Live 200 `{events}`. Shot `ui/71-request-log.png` (116 HTTP hops).
- Expected: Not local-only.
- Actual: Match. Not still broken.
- Remediation: none for wiring.
- Confidence: 10

### [SIM-WIRE.5] Request log empty-200 copy blamed 404
- Status: FIXED
- Severity: advisory
- Surface: `ClientActionLogView` server note
- Evidence: `loadServerActivity` success with `rows.isEmpty` said “No server activity (endpoint may be 404).” A 200 empty list is not a 404 (404 already returns `[]` in `fetchMeActivity`).
- Expected: Empty-success copy without a false 404 hint.
- Actual: Misleading note on a healthy empty inbox.
- Remediation: “No server activity for this account. Local hops still appear.”
- Retest: static `ClientActionLogView.swift:148–149`.
- Confidence: 9

### [SIM-WIRE.6] Request log Clear is local-only
- Status: RISK
- Severity: advisory
- Surface: `requestLog.clear`
- Evidence: `log.clear()` wipes on-device hops. Merged **server** rows stay. Button `.disabled(log.events.isEmpty)` — if only server rows exist, Clear is dead. SIM-UI.9 duplicate Clear toolbar was already id-fixed (`ToolbarItem(id: "requestLog.clear")`).
- Expected: Clear either says “this device” or also drops the merged server snapshot.
- Actual: Local-only; server note still counts merged rows.
- Remediation: not changed (would hide audit trail). Optional: disable label “Clear this device”.
- Confidence: 8

### [SIM-UI.21] Home post-job + sell sheets are live, not dead
- Status: PASS
- Severity: advisory
- Surface: `home.postJob` / `home.instantMatch` / `home.sellItem`
- Evidence: `HomeView.swift` sheets present `PostJobView` / `CreateListingView`. Unsigned/scaffold → BrandEmptyState “Sign in required” (`PostJobView.swift:86–101`, `CreateListingView.swift:54–69`). Continue pin already FIXED in `02-ui.md` SIM-UI.6 (`ui/94-post-job-continue-pinned.png`). Added `postJob.close` / `createListing.close` on Home, Jobs empty CTA sheet, Marketplace empty Sell sheet.
- Expected: CTA opens wizard with loading/error/success; no silent no-op.
- Actual: Match. Jobs Browse empty now uses the same Post sheet.
- Confidence: 9

### [SIM-UI.22] Jobs Mine search is browse-only (not a dead button)
- Status: PASS
- Severity: advisory
- Surface: `jobs.search` on Mine
- Evidence: `BrandCatalogSearchField(..., enabled: segment == .browse)` prompt **Search is browse-only**. Intentional (`gap-close-chrome.md` 2026-08-12).
- Expected: Mine does not pretend to filter `/jobs/mine` client-side.
- Actual: Field visible, dimmed, submit no-ops. Not a crash.
- Confidence: 9

### [SIM-UI.23] No product crash paths in hunted files
- Status: PASS
- Severity: advisory
- Surface: `ios/NoMarkup` Auth + Jobs + Marketplace + Account + Home + Messages
- Evidence: `rg fatalError|preconditionFailure|try!` → none under `ios/NoMarkup`. Catalog surfaces have loading/error/empty (Jobs, Marketplace, Messages, Home jobs strip, Post/Sell unsigned).
- Expected: No force-unwrap crash on empty seed / 401 / 0 listings.
- Actual: Empty/error paths exist. Remaining founder residuals are session expiry (`02-ui.md` SIM-UI.10) and public `status=open` returning closed jobs (iOS drains).
- Confidence: 8

### [SIM-UI.24] Trust score root id
- Status: FIXED
- Severity: advisory
- Surface: `TrustScoreView` (inventory §4 *(none)*)
- Evidence: Nested from job/provider detail; no root id.
- Expected: Stable root for XCUITest.
- Actual: Unlabeled.
- Remediation: `trustScore.root`.
- Retest: static.
- Confidence: 8

### [SIM-UI.25] Autocomplete typeahead fails closed with no error
- Status: GAP
- Severity: advisory
- Surface: Marketplace search suggestions
- Evidence: `scheduleAutocomplete` catch `{ suggestions = [] }` — soft-fail. After debounce, empty suggestions + empty listings → search-miss empty (SIM-UI.17), not “Couldn’t search”.
- Expected: Optional inline “Suggestions unavailable”.
- Actual: Fail-soft is acceptable; list `Try again` still covers `fetchListings` hard fail.
- Remediation: none this cycle.
- Confidence: 7

---

## Fixes applied (no commit)

| File | Change |
|------|--------|
| `ios/NoMarkup/Auth/LoginView.swift` | MFA + legal a11y ids |
| `ios/NoMarkup/Auth/RegisterView.swift` | password / confirm / role / error / sign-in ids |
| `ios/NoMarkup/Auth/ForgotPasswordView.swift` | token form + have-token ids |
| `ios/NoMarkup/Features/JobsView.swift` | dual-role Mine empty; Post a job CTA on Browse + customer Mine; Mine loading/error/list ids |
| `ios/NoMarkup/Features/MarketplaceView.swift` | search-miss empty copy; Sell sheet Close id |
| `ios/NoMarkup/Features/MessagesView.swift` | loading/error/empty/list ids |
| `ios/NoMarkup/Features/HomeView.swift` | sheet Close ids |
| `ios/NoMarkup/Features/ParitySurfacesView.swift` | `marketplace.map.myLocation` |
| `ios/NoMarkup/Features/ClientActionLogView.swift` | empty-200 server note |
| `ios/NoMarkup/Features/TrustScoreView.swift` | `trustScore.root` |
| `ios/NoMarkupUITests/NoMarkupUITests.swift` | emptyTitles include search-miss copy |
| `ios/NoMarkupUITests/TabAuditUITests.swift` | same |
| `ios/NoMarkupUITests/ScreenshotWalkUITests.swift` | same |

Rebuild / install: **not run** (all three reserved sims + DerivedDataFullSim{,B,C} occupied).

---

## Residuals (not this cycle)

- SIM-UI.10 session expiry during long Account walks (`02-ui.md`).
- Public `GET /jobs?status=open` still returns closed rows; iOS `loadOpenBrowse` drains.
- Goods catalog `total=0` — first listing still N/A (`SIM-WF.4`).
- Provider-money Account rows stay visible to customer-only (SIM-UI.20 RISK).
- Request log Clear is device-local (SIM-WIRE.6 RISK).
- Floating tab bar still covers fold rows on long lists (`02-ui.md`).
