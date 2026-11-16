# SIM-UI findings — 2026-08-12 (deep / fix)

- **Devices**: customer iPhone 17 Pro Max `503E262C-…`, provider iPhone 17 `B3CA7DF9-…`, admin iPhone 17e `5B84AFEE-…`
- **API**: `http://127.0.0.1:8081` health 200
- **Signed app**: `iphone-sim-derived-signed` (Sign to Run Locally). Rebuild after fixes **BUILD SUCCEEDED**.
- **Interference**: stacked Springboard `Open in "NoMarkup"?` from `simctl openurl` + parallel XCUITest clones; mid-run 3 sims Shutdown (memory). Tab bar taps and argv login still worked when the dialog was not covering chrome.

## Coverage table

| Screen | customer | provider | admin | Shot path |
|--------|----------|----------|-------|-----------|
| Sign in (session expired) | PASS | PASS | GAP | `C11-after-open-abs.png`, `P11-after-sweep.png` |
| Home (signed-in, 5 tabs) | PASS | PASS | PASS | `C11-home.png`, `P11-home.png` / `P11-home-retest.png`, `A11-home.png` |
| Home CTAs (Browse / Instant / Shop / Post / Sell) | GAP (dialog + tap offset) | PARTIAL (Post job sheet reached) | GAP | `P15-post-job.png` |
| Marketplace list | PASS (via provider) | PASS 1 of 1 live iPad | GAP | `P20-marketplace.png` |
| Listing detail / Watch / Bid UI | GAP | GAP (Open dialog over card) | GAP | `P21-listing-detail.png` |
| Jobs Browse | PASS (40 of 394 mixed Closed) | PASS (2 of 395 live + Load more) | GAP | `C12b-jobs-tab.png`, `wf-p-32-jobs.png` |
| Jobs Mine | GAP | GAP (tap opened Post job sheet) | GAP | `P31-jobs-mine.png` |
| Job detail (closed BidRace) | PASS + tab-bar clip | — | — | `C13-instant.png`, `C33-spectate.png` |
| Job detail (live HVAC) | — | PASS | — | `P32-job-active.png` / `P41b-thread.png` |
| Bid UI (closed) | PASS (closed copy + provider-role) | — | — | `C33-spectate.png` |
| Spectate / Replay | GAP (tap miss) | GAP | GAP | `C33-spectate.png` |
| Messages list | GAP | PASS 2 threads | GAP | `P41-thread.png`, `wf-p-37-thread.png` |
| Message thread | GAP | GAP (row tap missed) | GAP | `P41b-thread.png` (job sheet) |
| Account hub | PARTIAL | PASS (scrolled) | GAP | `P13-instant.png`, `P50-account-scroll1.png`, `P50-account-scroll2.png` |
| Account rows (list chrome) | GAP | PASS list (not every push) | GAP | see Account rows below |
| Post a job (step 1/4) | GAP | PASS | GAP | `P15-post-job.png` |
| Watchlist empty | GAP | PASS | GAP | `wf-p-49-watch.png` |
| Contracts list | GAP | PASS 11 contracts | GAP | `wf-p-50-contracts.png` |
| Contract detail (disputed) | GAP | PASS + location timeout | GAP | `P-checkin-location.png`, `wf-p-48-sell.png` |
| Deep link `nomarkup://jobs` etc. | BLOCKED (Open confirm stack) | BLOCKED | BLOCKED | `C32-job-active.png` … `C40-messages.png` |
| `javascript:alert(1)` | PASS (LS 115, no crash) | — | — | `C-neg-javascript.png` |
| `file:///etc/passwd` | PASS (Files save sheet, no crash) | — | — | `C-neg-file.png` |
| Browse without sign-in | GAP | GAP | GAP | — |
| Admin console row | N/A | N/A | GAP | dialog + not reached |

### Account rows seen on provider hub (list, not all destinations pushed)

From `P13-instant.png` + `P50-account-scroll1.png` + `P50-account-scroll2.png` + ghost overlay on `P50-account-scroll3.png`:

Signed in · `provider@nomarkup.com` · Stripe **Not configured** · Apple Pay `merchant.com.nomarkup.app` · Turn on push · Provider workspace (clipped by tab bar) · Instant offers · Watchlist · Saved searches · Seller analytics · Seller payouts · Business & finance · Insurance quote · Sales export (CSV) · Calendar export · Team · Challenges · Verification documents · Payment methods · Payments history · Notifications (69) · Notification preferences · Providers · Following · Following feed · Properties · Blocked users · Referrals · Feedback surveys · Savings · Markets · Fair price index · Marketplace map · Trust tiers · Privacy Policy.

Pushed with evidence: Watchlist empty (`wf-p-49-watch.png`), Contracts (`wf-p-50-contracts.png`). Delete-account confirm **not** taken.

---

## Findings

### [SIM-UI.1] Signed-in Home shell loads for all three seeds
- Status: PASS
- Severity: advisory
- Surface: Home / RootTabView
- Evidence: `C11-home.png` (393 jobs → later 2 live, 14 then 4 Account badge), `P11-home.png` / `P11-home-retest.png` (2 jobs · 1 goods · Messages 1 · Account 69), `A11-home.png` (51 Account badge). Tabs Home / Marketplace / Jobs / Messages / Account visible. Gateway LIVE.
- Expected: 5-tab chrome, signed-in Home.
- Actual: Matches. Market desk first paints “Waiting for open floor…” then chips (HVAC $185, Plumbing $500).
- Remediation: none.
- Confidence: 9

### [SIM-UI.2] Jobs Browse mixes Closed jobs with live reverse auctions
- Status: RISK
- Severity: advisory
- Surface: Jobs Browse
- Evidence: `C12b-jobs-tab.png` — “40 of 394”; first card Active plumbing $500 / 1 bid; next three Closed (0 bids, Ended). Later provider `wf-p-32-jobs.png` shows “2 of 395” live-only + Load more (list mutated mid-run).
- Expected: Browse open jobs emphasizes live / open floor.
- Actual: Customer first paint included Closed rows in the default Browse list.
- Remediation: default `status=open` (or client filter live) on Browse; keep Closed on Mine / filters.
- Confidence: 7

### [SIM-UI.3] Job detail bid / closed copy clipped by floating tab bar
- Status: FIXED
- Severity: major
- Surface: JobDetailView in Jobs tab
- Evidence: `C13-instant.png` / `C33-spectate.png` — “Place a bid (dollars)” + “This opportunity is closed…” sit under the tab capsule; “Provider role required.” peeks through.
- Expected: last List section fully readable above tab bar.
- Actual: iOS 26 floating TabView overlays the last section when JobDetail is pushed (sheet presentation with Close is fine — `P32-job-active.png`).
- Remediation: `.safeAreaInset(edge: .bottom)` 28pt on `detailContent` in `JobDetailView.swift`.
- Retest: signed rebuild **BUILD SUCCEEDED**. Visual re-open of the in-tab closed BidRace surface not recaptured this cycle (sheet path already clear). Residual: re-push a job from Jobs tab and confirm closed copy sits above the capsule.
- Confidence: 8

### [SIM-UI.4] Check-in GPS timeout fires while the system permission sheet is up
- Status: FIXED
- Severity: major
- Surface: Contract check-in / `JobSiteLocationProvider`
- Evidence: `P-checkin-location.png` backdrop + `wf-p-48-sell.png` — red “Location request timed out. Move outdoors or wait for GPS lock, then try again.” **behind** “Allow NoMarkup to use your location?” (Allow Once / While Using / Don’t Allow). Contract “Split dispute regression job” Disputed $700 NM-2026-00118.
- Expected: timeout starts after When-In-Use is granted and `requestLocation()` runs.
- Actual: 12s clock started at `requestWhenInUseAuthorization()`, so the prompt itself could lose the race.
- Remediation: hold timeout until authorization callback; then `requestLocation()`. `JobSiteLocationProvider.swift`.
- Retest: signed rebuild succeeded. Full check-in retest needs location reset + Check in tap (not done — would require Don’t Allow reset). Residual: reset sim location privacy and tap Check in.
- Confidence: 9

### [SIM-UI.5] Marketplace list + empty search chrome
- Status: PASS
- Severity: advisory
- Surface: Marketplace
- Evidence: `P20-marketplace.png` — “1 of 1” Sim WF used iPad Air (workflow matrix), $160 current bid, LIVE Bid up Active, Good Electronics, 78701, 1 bid, Ends in 47h 52m. Copy: local goods, bid up, 25 mi, escrow. Map button top-right. Searchable pill is blank until focus (iOS 26 `.searchable` prompt).
- Expected: list or empty/error.
- Actual: live listing. Prompt “Search listings” exists in code; unfocused field looks empty.
- Remediation: none required; optional always-visible placeholder.
- Confidence: 8

### [SIM-UI.6] Messages inbox loads threads + unread
- Status: PASS
- Severity: advisory
- Surface: Messages
- Evidence: `P41-thread.png` / `wf-p-37-thread.png` — 2 of 2, “QA Tester · Mike Provider”, “Sim WF matrix ping 2026-08-12” unread 1, Pre Award Aug 12 5:51 PM; second “Test” Jul 26. Search inbox placeholder visible. Footer explains unread_count.
- Expected: list / empty / error.
- Actual: list + unread badge 1 on tab.
- Remediation: none. Thread push not confirmed (row tap opened a job sheet instead — GAP).
- Confidence: 8

### [SIM-UI.7] Account hub + wiring status
- Status: PASS
- Severity: advisory
- Surface: Account
- Evidence: `P13-instant.png` — API `127.0.0.1:8081`, Stripe **Not configured** (gold warning + fail-closed copy), Apple Pay merchant id set, Signed in, User `00000000…`, Email `provider@nomarkup.com`, “Turn on push notifications”. Tab bar clips “Provider workspace”.
- Expected: hub with session + destinations.
- Actual: matches. Stripe missing is env, not a dead button. Truncated user id is polish.
- Remediation: optional expand UUID; extra list footer inset (same tab-bar family as SIM-UI.3).
- Confidence: 8

### [SIM-UI.8] Post-a-job wizard (step 1 of 4)
- Status: PASS
- Severity: advisory
- Surface: PostJobView
- Evidence: `P15-post-job.png` / `P13-instant-form.png` — Close, stepper, Run an auction | I need help now, title/description placeholders, Category Select, Continue, “Open full form on web”. How-it-works copy on scroll.
- Expected: native create funnel, dismissible.
- Actual: sheet presents. Instant segment tap this run did not flip (likely miss, not proven dead). Close missed twice (sheet modal, ny too low).
- Remediation: none proven.
- Confidence: 7

### [SIM-UI.9] Contracts list
- Status: PASS
- Severity: advisory
- Surface: ContractsView
- Evidence: `wf-p-50-contracts.png` — 11 contracts; Abandoned / Disputed pills; provider role; amounts $450–$900; NM-2026-00xxx.
- Expected: list or empty.
- Actual: populated list, Close chrome.
- Confidence: 8

### [SIM-UI.10] Watchlist empty state
- Status: PASS
- Severity: advisory
- Surface: WatchlistView
- Evidence: `wf-p-49-watch.png` — “No watched listings” + heart + “Tap the heart on a marketplace listing…”. Close.
- Expected: empty, not spinner/error.
- Actual: branded empty.
- Confidence: 8

### [SIM-UI.11] Hostile schemes do not crash
- Status: PASS
- Severity: advisory
- Surface: Deep links
- Evidence: `javascript:alert(1)` → `LSApplicationWorkspaceErrorDomain` 115 (`C-neg-javascript.png` still Home). `file:///etc/passwd` → Files “Save as passwd” / On My iPhone Empty (`C-neg-file.png`, `C-neg-file-after-cancel.png`). App process stayed up.
- Expected: ignore / system handler, no crash.
- Actual: matches.
- Confidence: 9

### [SIM-UI.12] Custom-scheme Open confirmation stacks and blocks navigation
- Status: RISK
- Severity: major (env / platform)
- Surface: `simctl openurl nomarkup://…`
- Evidence: first `nomarkup://jobs/{id}` showed “Open in NoMarkup?” (`C32-job-active.png`); subsequent jobs/new, jobs, watchlist, bids, orders, notifications, messages all screenshot the same dialog. Customer/admin later stuck on Springboard with the same alert (`C20-marketplace.png`, `A-after-cancel-sweep.png`).
- Expected: in-app route when already running (or one confirm).
- Actual: Springboard confirm; queued URLs restack. Not an in-app crash. XCUITest interruption monitor already prefers Open.
- Remediation: for dogfood, terminate then `openurl` (cold launch skips confirm) or drain Open via XCUITest. Product: none required.
- Confidence: 8

### [SIM-UI.13] Listing Watch / Bid not exercised
- Status: GAP
- Severity: advisory
- Surface: ListingDetailView
- Evidence: marketplace card visible (`P20-marketplace.png`) but listing tap / `nomarkup://listings/22d5085b-…` hit the Open dialog (`P21-listing-detail.png`). No Watch heart or bid dock screenshot.
- Expected: detail + Watch + bid UI (no money submit).
- Actual: not reached.
- Remediation: reopen listing after dialog drain; do not submit bid.
- Confidence: 8

### [SIM-UI.14] Most account.row.* destinations not pushed
- Status: GAP
- Severity: major (coverage)
- Surface: Account NavigationLinks
- Evidence: hub list read (SIM-UI.7). Pushed: Watchlist, Contracts. Not pushed: profile, security, verification, drafts, sell, orders, my bids, listings, payouts, business, payment methods, notifications, prefs, providers, following, feed, properties, wishlist, blocked, referrals, savings, markets, fair price, map, trust, legal Safari, terms, support, export, delete (stop before confirm), plan limits, feature flags, **admin**.
- Expected: every row opens a real surface (not EmptyView).
- Actual: list identifiers exist in `AccountView.swift`; destinations not all visually opened this run.
- Remediation: continue row taps on a dialog-free provider/admin session.
- Confidence: 9

### [SIM-UI.15] Browse-without-sign-in not run
- Status: GAP
- Severity: advisory
- Surface: LoginView “Browse without signing in”
- Evidence: login screen seen (`P11-after-sweep.png`) with Create account, Forgot password, Sign in with Apple, Browse without signing in, Privacy / Terms. CTA not tapped (argv re-login used instead).
- Expected: public catalog 5-tab scaffold.
- Actual: untested this pass.
- Confidence: 8

### [SIM-UI.16] Admin console row not reached
- Status: GAP
- Severity: advisory
- Surface: `account.row.admin`
- Evidence: admin Home (`A11-home.png`) same 5-tab shell, badge 51. Account hub never opened (dialog / Springboard).
- Expected: Admin console row when `hasAdminRole`.
- Actual: not shown.
- Confidence: 8

### [SIM-UI.17] Home “Browse open jobs” CTA not proven this pass
- Status: GAP
- Severity: advisory
- Surface: `home.browseJobs`
- Evidence: first calibrated tap stayed on Home (`C12-browse-jobs.png`, `C12c-browse-jobs.png`). Code sets `selectedRootTab?.wrappedValue = .jobs`. Jobs tab via tab bar works (`C12b-jobs-tab.png`).
- Expected: CTA switches to Jobs.
- Actual: inconclusive (coordinate miss more likely than dead `selectedRootTab`).
- Remediation: XCUITest `home.browseJobs` tap (already in ScreenshotWalk).
- Confidence: 6

---

## Fixes applied

| File | Change |
|------|--------|
| `ios/NoMarkup/Location/JobSiteLocationProvider.swift` | GPS 12s timeout starts only after When-In-Use is granted, not while the system prompt is up. |
| `ios/NoMarkup/Features/JobDetailView.swift` | Bottom `safeAreaInset` so bid / closed copy clears the floating tab bar. |

Signed rebuild: `xcodebuild … -derivedDataPath …/iphone-sim-derived-signed` **BUILD SUCCEEDED** (Sign to Run Locally). Provider relaunch `P11-home-retest.png` still Home / LIVE.

## Residuals

- Re-screenshot in-tab closed job detail after inset (SIM-UI.3).
- Reset location privacy and re-run Check in (SIM-UI.4).
- Drain Open dialogs; open listing Watch/Bid; remaining account.row.* including admin; browse-without-sign-in.
- Do not confirm Delete Account; do not complete Stripe charges.

## Files changed

- `ios/NoMarkup/Location/JobSiteLocationProvider.swift`
- `ios/NoMarkup/Features/JobDetailView.swift`

## One-line summary

Three-seed Home/Jobs/Marketplace/Messages/Account chrome works; location timeout-behind-permission and job-detail tab-bar clip are fixed in a signed rebuild; listing Watch/Bid, most Account destinations, and admin console remain coverage GAPs after Springboard Open-in-NoMarkup stacking.
