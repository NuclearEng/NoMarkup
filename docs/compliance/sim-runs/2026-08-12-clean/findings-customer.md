# Customer clean-catalog E2E — 2026-08-12

- **Seed**: `customer@nomarkup.com` / `Password123!` (QA Tester, roles Customer + Provider)
- **Simulator**: iPhone 17 Pro Max `503E262C-5731-45BE-A459-CFF59551539E`
- **API**: `http://127.0.0.1:8081` health 200 (`{"status":"ok","version":"dev"}`)
- **Catalog (live)**: 3 open jobs, ~40–50 public listings, 2 contracts, 0 message channels
- **Drive**: tab bar + `tap-lcd.sh` (bezel-corrected). Did **not** use `simctl openurl`.
- **Mode**: fix local+clear UI bugs. **No commit.**

## Walk coverage

| Surface | Status | Shot |
|---------|--------|------|
| Home LIVE NOW / desk / CTAs | PASS | `C10-home.png` |
| Browse open jobs → Jobs list | PASS | `C12-jobs.png` |
| First live job detail + bid/closed copy | PASS (clip FAIL) | `C13-job-detail.png`, `C13b-job-bid.png` |
| Marketplace list | PASS (clip + count RISK) | `C20-marketplace.png` |
| Listing detail + Watch | PASS | `C21-listing.png`, `C21b-watch.png`, `C21d-watch-done.png` |
| Listing Bid UI | PASS (submit GAP) | `C22c-bid-form.png` |
| Ended listing still showing bid form | FAIL → FIXED | `C21d-watch-done.png` |
| Messages empty + Browse jobs CTA | PASS | `C40-messages.png`, `C40b-browse-jobs-cta.png` |
| Account hub (full scroll) | PASS (clip FAIL) | `C50-account.png` … `C50-scroll8.png` |
| Profile | PASS | `C51b-profile.png` |
| Security | PASS | `C51b-security.png` |
| Post a job step 1/4 | PASS (Continue clip FAIL) | `C53-post-job.png` |
| Orders | PASS | `C53-orders.png` |
| Contracts (2 seed) | PASS | `C52-orders.png` |
| My bids (40 goods) | PASS (retract FAIL → FIXED) | `C56-bids.png` |
| Watchlist (DJI sold) | PASS | `C56-watchlist.png` |
| Payment methods empty | PASS | `C59-payment-methods.png` |
| Notifications inbox (8) | PASS | `C59-notifications-inbox.png` |
| Notification preferences | PASS | `C57-notifications.png` |
| Following empty + tab bar on pop | PASS | `C57-following.png`, `C57-following-back.png` |
| Sign out | N/A (not required) | — |
| Session expiry mid-walk | PASS (copy + argv re-login) | `C53-bids.png`, `C54-relogin.png` |

## Findings

### [SIM-UI.1] Home desk, LIVE NOW, and CTAs
- Status: PASS
- Severity: advisory
- Surface: Home
- Evidence: `C10-home.png` — MARKET DESK **3 LIVE · 20 GOODS**; chips LEGAL… $250 / LEGAL… $400 / HVAC $500 2×; stats **3 LIVE NOW · 20 GOODS LIVE · LIVE GATEWAY**; CTAs Browse open jobs / I need help now / Shop goods / Post a job / Sell an item. Account badge 1.
- Expected: Signed-in Home with live desk + five CTAs.
- Actual: Matches. Desk chips truncate both Legal labels to `LEGAL…`.
- Remediation: none required; optional longer chip (city or shortened title) so the two legal jobs are distinguishable.
- Confidence: 9

### [SIM-UI.2] Browse open jobs switches to Jobs tab
- Status: PASS
- Severity: advisory
- Surface: Home `home.browseJobs`
- Evidence: Tap gold CTA (`tap-lcd` ny=0.489) → `C12-jobs.png` Browse / Mine, **3 open**.
- Expected: Jobs tab with open reverse auctions.
- Actual: Matches. Seed has 3 active jobs (API `totalCount=3`).
- Remediation: none.
- Confidence: 9

### [SIM-UI.3] Jobs Location + Job detail bid/closed copy sit under the floating tab bar
- Status: FIXED
- Severity: major
- Surface: Jobs list Location section; JobDetailView last sections; Post a job Continue; Account last rows
- Evidence:
  - `C12-jobs.png` / `C13c-job-back.png` — Location purpose copy under the tab capsule.
  - `C13-job-detail.png` — “Place a bid (dollars)” helper under the capsule; “Dollars only — for example 125.00” peeks through.
  - `C13b-job-bid.png` — “You own this job. Close bidding…” + Status/Active under the capsule.
  - `C53-post-job.png` — gold **Continue** under the tab bar.
  - `C50-account.png` — Profile settings row under the capsule.
- Expected: Last list/form section fully readable above the iOS 26 floating tab bar.
- Actual: Prior 28pt `safeAreaInset` was too short (~80pt capsule + home indicator).
- Remediation: `brandTabBarClearance()` (80pt) on JobDetail, Jobs list, Account hub, PostJob form, Marketplace list, My bids, Notifications.
- Retest: code change only this cycle (no signed rebuild). Visual retest after next install.
- Confidence: 9

### [SIM-UI.4] First live job bid / owner copy
- Status: PASS
- Severity: advisory
- Surface: JobDetailView — One-hour business law consultation
- Evidence: `C13-job-detail.png` LIVE · sealed reverse, $250.00 STARTING BID, 0 bids, Ends in 2d. `C13b-job-bid.png` Place reverse bid disabled; “Provider role required.”; “You own this job.”; Close bidding / Cancel job.
- Expected: Bid UI + closed/owner copy visible (above tab bar after SIM-UI.3).
- Actual: Copy is correct for customer-owned live job. Closed-auction copy N/A (job still Active).
- Remediation: none (clip tracked in SIM-UI.3).
- Confidence: 9

### [SIM-UI.5] Marketplace first listing, Watch, Bid UI
- Status: PASS
- Severity: advisory
- Surface: Marketplace / ListingDetail
- Evidence:
  - `C20-marketplace.png` — 40 of 44; first DJI Mavic 3 Pro $2,350, LIVE, 1m.
  - `C21-listing.png` — $2,350 current high, started $1,800, min next ~$2,351, Spectate/Replay, sticky Bid dock.
  - `C21b-watch.png` — heart filled gold; “Stay ahead on bids” pre-prompt (Not now).
  - `C22c-bid-form.png` (Tom Ford, live 6m) — $0.00 + Max + authorization disclosure + disabled Place bid + ladder (Mike $780 Winning).
- Expected: Open listing, Watch, Bid UI without firing Stripe PaymentSheet.
- Actual: Watch works. Bid form present; Place bid stays disabled at $0.00. Hardware keyboard did not type `781.00` (sim HID GAP) — did not submit a bid.
- Remediation: none for product; sim keyboard is harness-only.
- Confidence: 8

### [SIM-UI.6] Ended listing still offered a dollar bid form
- Status: FIXED
- Severity: major
- Surface: ListingDetailView `placeBidSection`
- Evidence: `C21d-watch-done.png` — clock chip **Ended**, status chip still **Active**, Place a bid (dollars) + $0.00 still shown. Sticky dock correctly hid (`showStickyBidDock` already gates ended/past `auctionEndsAt`).
- Expected: Closed copy; no new-bid fields after end.
- Actual: Inline section was ungated.
- Remediation: `auctionAcceptsBids` + “This auction has ended. New bids are closed.”
- Retest: code path only; DJI already sold (`C56-watchlist.png`).
- Confidence: 9

### [SIM-UI.7] Messages empty state (no `messages.row.*`)
- Status: PASS
- Severity: advisory
- Surface: Messages
- Evidence: `C40-messages.png` — “No conversations yet”; Browse jobs / Browse marketplace. API `GET /channels` totalCount 0. `C40b-browse-jobs-cta.png` — Browse jobs CTA switches to Jobs (3 open).
- Expected: Empty + working CTAs when no channel exists. Send only if a thread exists.
- Actual: Matches. No thread to open or message to send (seed has 0 channels).
- Remediation: none (seed).
- Confidence: 9

### [SIM-UI.8] Account destinations + Following tab bar
- Status: PASS
- Severity: advisory
- Surface: Account hub
- Evidence: Profile `C51b-profile.png` (QA Tester, Customer+Provider); Security `C51b-security.png` (age verified, Face ID, Enable MFA); Post a job step 1 `C53-post-job.png`; Orders `C53-orders.png` (9 orders, Apple Pay, did not charge); My bids `C56-bids.png` (40 goods); Watchlist `C56-watchlist.png` (DJI Sold/Ended 1 of 1); Payment methods `C59-payment-methods.png` (empty + Add card); Notifications `C59-notifications-inbox.png` (8 unread); Following `C57-following.png` empty + tab bar visible; pop `C57-following-back.png` tab bar remains.
- Expected: Each row pushes a real screen; Following pop keeps the 5-tab shell.
- Actual: Matches. Sign out not taken.
- Remediation: none.
- Confidence: 9

### [SIM-UI.9] Retract bid showed tens of thousands of seconds
- Status: FIXED
- Severity: major
- Surface: My bids goods rows
- Evidence: `C56-bids.png` — “Retract bid (35,391s)” on Bowflex / Pottery Barn (created Aug 13 6:37 AM while sim clock is Aug 12 8:47 PM). `canRetract` treated a **future** `created_at` as inside the 60s window (`elapsed` negative ⇒ `elapsed < 60`).
- Expected: Retract only for 0…60s after placement; no hours-long label.
- Actual: Future-dated seed timestamps opened a ~10h retract affordance.
- Remediation: require `elapsed >= 0` in `MyListingBidEntry.canRetract` / `retractSecondsRemaining` and the Job/listing detail twins (already present in tree after this pass).
- Retest: code-level; next My bids open should hide Retract on those rows.
- Confidence: 8

### [SIM-UI.10] Home GOODS LIVE 20 vs Marketplace 40 of 44
- Status: RISK
- Severity: advisory
- Surface: Home stats vs Marketplace pagination
- Evidence: Home `C10-home.png` **20 GOODS LIVE**; Marketplace `C20-marketplace.png` **40 of 44** (later 40 of 43 after DJI ended). Public listings API `totalCount` ~50.
- Expected: Same defined population, or labels that say so.
- Actual: Desk uses a smaller live slice than the Marketplace page total.
- Remediation: Drive Home from the same filter Marketplace uses, or label Home as “on desk” / nearby.
- Confidence: 7

### [SIM-UI.11] Access token expired mid-walk (~16 min)
- Status: PASS
- Severity: advisory
- Surface: Session / login
- Evidence: `C53-bids.png` LoginView “Your session expired. Please sign in again.” email prefilled. Argv relaunch `C54-relogin.png` restored Home.
- Expected: 15-min access token + clear re-auth copy.
- Actual: Matches policy. Did not stay signed out.
- Remediation: none.
- Confidence: 9

## Fixes applied (not committed)

| File | Change |
|------|--------|
| `ios/NoMarkup/Core/BrandTheme.swift` | `brandTabBarClearance(80)` |
| `ios/NoMarkup/Features/JobDetailView.swift` | use clearance (was 28pt) |
| `ios/NoMarkup/Features/AccountView.swift` | use clearance (was 28pt) |
| `ios/NoMarkup/Features/JobsView.swift` | clearance on browse list |
| `ios/NoMarkup/Features/PostJobView.swift` | clearance so Continue sits above tab bar |
| `ios/NoMarkup/Features/MarketplaceView.swift` | clearance on catalog list |
| `ios/NoMarkup/Features/MyBidsView.swift` | clearance |
| `ios/NoMarkup/Features/NotificationsView.swift` | clearance |
| `ios/NoMarkup/Features/ListingDetailView.swift` | close bid form when auction ended |
| `ios/NoMarkup/Features/NotificationPreferencesView.swift` | title “Notification preferences” |
| `ios/NoMarkup/Core/Models.swift` | retract window rejects future `created_at` (already in tree) |

## Residuals

- Visual retest of tab-bar clearance needs a signed rebuild/install (not done this cycle).
- Listing bid **submit** not exercised (sim hardware keyboard did not type dollars).
- No customer message thread on this seed.
- Sign out not taken (per brief).
- Home 20 vs Marketplace 40 goods count (SIM-UI.10) not changed.

## Readiness

**YELLOW** — no blockers; major clip + ended-bid-form + retract-window are fixed in source but not visually re-shot on a new build.
