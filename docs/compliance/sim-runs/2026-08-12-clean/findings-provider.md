# Provider unicorn walk — 2026-08-12-clean

- **Sim**: iPhone 17 `B3CA7DF9-228C-4490-B5B7-57F2B0FE5D6D` (provider@nomarkup.com)
- **API**: `http://127.0.0.1:8081` health 200 `{"status":"ok","version":"dev"}`
- **Catalog**: 3 active jobs, 49 public listings (`listings.pagination.totalCount=49`; Marketplace UI “40 of 43”), 2 contracts, 0 chat channels
- **Bid placed**: reverse $185.00 on `00000000-…0104` (LLC legal consult, starting $250) — 201 path, UI “Bid placed: $185.00.”
- **Tap calibration**: `sim-tap.sh` insets (32/18/8) miss the AX device screen on this window. Working frame is AXGroup **pos=437,113 size=350x760**. Tab-bar taps still hit with the old helper; mid-screen rows need the AX frame.
- **No** `simctl openurl` (OS confirm sheets).
- **Did not commit.**

## Coverage

| Surface | Status | Shot |
|---------|--------|------|
| Home signed-in (hero, CTAs, desk, LIVE NOW / GOODS LIVE / GATEWAY) | PASS | `P10-home.png`, `P10-home-stats.png`, `P10-home-scrolled.png` |
| Jobs Browse — 3 open reverse auctions | PASS | `P30-jobs.png` |
| Jobs Mine — empty (provider is not a poster) | PASS | `P31-jobs-mine.png` |
| Job detail — live sealed legal $250 | PASS | `P31-job-detail.png` |
| Place-bid UI | PASS | `P32-job-detail-scrolled.png`, `P33-bid-ui.png`, `P33-bid-typed.png` |
| Submit reverse bid $185 | PASS | `P34-bid-after.png`, `P34-bid-success.png` |
| Marketplace list | PASS | `P20-marketplace.png` |
| Listing detail — Snap-on socket $390 forward | PASS | `P21-listing-detail.png` |
| Messages inbox (empty, 0 channels) | PASS | `P40-messages.png`, `P40-messages-refresh.png` |
| Message thread | N/A | Clean seed has no channels |
| Account hub | PASS | `P50-account.png` + scrolls |
| Provider workspace | PASS | `P51-workspace.png` |
| Instant offers | PASS | `P52-instant-offers.png` |
| Seller payouts | PASS | `P55-seller-payouts.png` |
| Payment methods | PASS | `P57-payment-methods.png` |
| Contracts (2) | PASS | `P58-contracts.png` |
| My bids Goods + Services | PASS | `P54-my-bids.png`, `P54-my-bids-services.png` |
| Verification documents | PASS | `P56-verification-docs.png` |
| Verify email & phone | GAP | Fat-fingered Sign out (`P53-verification.png` is LoginView) |
| Tab bar stays on every pushed Account destination | PASS | workspace / offers / payouts / pay / contracts / bids / vdocs |
| Sign out (unintended) | FAIL → FIXED | No confirm; argv relaunch restored session (`P50-relogin.png`) |

Tab bar (Home / Marketplace / Jobs / Messages / Account) stayed on every in-tab push. Account badge 1 → 2 → 3 during the walk; Notifications row later showed **4**.

## Findings

### [SIM-UI.P1] Home GOODS LIVE / Market Desk print the listings page size (20), not the floor
- Status: FIXED
- Severity: major
- Surface: Home stats + Market Desk
- Evidence: `P10-home.png` / `P10-home-stats.png` — **3 LIVE · 20 GOODS** and **20 GOODS LIVE**. `GET /listings?page_size=20` returns 20 rows, `pagination.totalCount=49`. Marketplace list later showed “40 of 43”. `HomeView.loadCatalog()` set `listingTotal = liveListings.count` after `pageSize: 20`.
- Expected: GOODS LIVE / desk goods count match the live catalog (≈49 / Marketplace total), not `pageSize`.
- Actual: Stat cloned the first page.
- Remediation: `liveOrPaginationTotal` — when every row on the page is live, use `pagination.resolvedTotal`; mixed pages still use the live-status count (preserves the old 2-vs-395 closed-page case).
- Retest: Code in `HomeView.swift`. Visual recapture needs a signed rebuild (not run this pass).
- Confidence: 9

### [SIM-UI.P2] Reverse-bid hint example is above the starting bid
- Status: FIXED
- Severity: major
- Surface: Job detail place-bid
- Evidence: `P32-job-detail-scrolled.png` / `P33-bid-ui.png` — “at or below the starting bid ($250.00). Example: 400.00 — not 40000.” After submit (`P34-bid-success.png`) the lower-bid hint still said “if your bid is $450, try 425.00” while current bid is **$185**.
- Expected: Example is a legal reverse amount (≤ start / < current).
- Actual: Hardcoded 400 / 450 copy.
- Remediation: `bidHint` builds the example from 80% of the ceiling (`reverseBidExampleDollars`).
- Retest: Code in `JobDetailView.swift`. Not rebuilt on sim.
- Confidence: 9

### [SIM-UI.P3] Goods “Retract bid (31,279s)” on bids placed hours ago
- Status: FIXED
- Severity: major
- Surface: My bids → Goods
- Evidence: `P54-my-bids.png` — Roland TR-8S / tuxedo / Nano Puff / Sonos all show **Retract bid (31,279s)** (and similar). Comment in `MyListingBidEntry` is eBay-style **60s**. `canRetract` used `now.timeIntervalSince(created) < 60`, which is true when `created_at` parses in the future (clock / TZ), opening an 8+ hour window. Remaining = `60 - (negative elapsed)`.
- Expected: Retract only within 60s of placement; no raw multi-hour countdown.
- Actual: Retract CTA on every winning seed bid with a five-digit second count.
- Remediation: Require `elapsed >= 0` and remaining in `1…60` in `MyListingBidEntry` and `ListingDetailView`.
- Retest: Code only this pass.
- Confidence: 8

### [SIM-UI.P4] Services My bids titles are truncated job UUIDs
- Status: FIXED
- Severity: major
- Surface: My bids → Services
- Evidence: `P54-my-bids-services.png` — four rows titled **Job · 00000000…** including our $185 Active bid. `GET /api/v1/bids/mine` is a flat proto row (`job_id`, no title). `MyJobBidRow.displayTitle` printed `Job · \(jobId.prefix(8))…`.
- Expected: Job title (e.g. “One-hour business law consultation for new LLC”).
- Actual: UUID stub.
- Remediation: Prefer `title` / `jobTitle` when present; otherwise hydrate from `GET /jobs/{id}` after fetch (cap 20). Fallback label is “Service bid”, not a UUID.
- Retest: Code in `Models.swift` + `MyBidsView.swift`. Not rebuilt on sim.
- Confidence: 8

### [SIM-UI.P5] Sign out has no confirmation and sits under Verify
- Status: FIXED
- Severity: major
- Surface: Account → Session
- Evidence: Tap aimed at “Verify email & phone” (`P50-account-back.png`) dumped the session to LoginView (`P53-verification.png`). `Button("Sign out")` called `auth.signOut()` immediately. Email was prefilled; argv `-ui-test-email` / `-ui-test-password` restored Home (`P50-relogin.png`).
- Expected: Destructive confirm. Verify / Security must not sign the user out.
- Actual: One tap, signed out. Core provider walk interrupted.
- Remediation: `confirmationDialog` — “Sign out of this device?” / Sign out / Cancel.
- Retest: Code in `AccountView.swift`. Dialog not recaptured (would require another sign-out).
- Confidence: 9

### [SIM-UI.P6] Jobs / Marketplace `.searchable` field has no visible placeholder
- Status: RISK
- Severity: advisory
- Surface: Jobs Browse, Marketplace
- Evidence: `P30-jobs.png`, `P20-marketplace.png` — empty gray capsule. Code sets `prompt: "Search jobs"`. Messages uses a custom field and **does** show “Search inbox” (`P40-messages.png`).
- Expected: Visible “Search jobs” / listing search prompt.
- Actual: Blank chip on iOS 26 searchable chrome.
- Remediation: Custom search field (Messages pattern) or inspect iOS 26 searchable styling. Not changed this pass (platform chrome).
- Confidence: 6

### [SIM-UI.P7] Marketplace list bid count disagrees with listing detail
- Status: RISK
- Severity: advisory
- Surface: Marketplace list vs detail
- Evidence: `P20-marketplace.png` Snap-on card **1 bid**; `P21-listing-detail.png` **7 bids** / $390 current high / 1 live. Timers ticked 2m → 1m between shots so the auction is live.
- Expected: List `bid_count` matches detail.
- Actual: Off by 6 on first paint.
- Remediation: Confirm list payload `bid_count` vs ladder length; refresh list on appear.
- Confidence: 6

### [SIM-UI.P8] Home typical band vs job-detail category sample disagree
- Status: RISK
- Severity: advisory
- Surface: Home open-floor card vs JobDetail
- Evidence: Home card (`P10-home-scrolled.png`) “Typical reverse-auction band: $150.00 – $250.00”. Detail (`P31-job-detail.png`) “CATEGORY SAMPLE (ESTIMATE) $287.50 – $362.50 · 2 jobs” — **above** the $250 starting bid.
- Expected: One defined market-range source.
- Actual: Home heuristic from starting bid; detail uses category sample that sits above the cap.
- Remediation: Same `MarketRange` source, or hide the sample when it exceeds starting bid.
- Confidence: 7

### [SIM-UI.P9] Jobs Mine empty-state is customer copy on a provider seed
- Status: RISK
- Severity: advisory
- Surface: Jobs → Mine
- Evidence: `P31-jobs-mine.png` — “No jobs yet / Jobs you post as a customer show up here.”
- Expected: Provider-aware empty (point at Browse / Instant / workspace).
- Actual: Customer poster copy. Correct that this provider has no owned jobs.
- Remediation: Role-specific empty state.
- Confidence: 7

### [SIM-WF.P1] Provider reverse bid on a live sealed job
- Status: PASS
- Severity: advisory
- Surface: Jobs → legal consult → Place reverse bid
- Evidence: Typed 185 (`P33-bid-typed.png`, “Will submit $185.00”). Submit → “Your current bid $185.00”, “Bid placed: $185.00.”, Bids received 0→1 (`P34-bid-after.png`). Push pre-prompt then system notification alert (`P34-bid-success.png` mid-sheet). `GET /bids/mine` returns the $185 row `94647f0f-…` on job `…0104`. Services My bids shows Active $185 (`P54-my-bids-services.png`). Desk after relaunch: LEGAL $250 **1×** (`P50-relogin.png`).
- Expected: Provider can bid strictly below starting on a live reverse auction.
- Actual: Matches.
- Confidence: 10

### [SIM-WF.P2] Messages empty after a successful bid
- Status: PASS (empty) / RISK (copy)
- Severity: advisory
- Surface: Messages
- Evidence: `P40-messages.png` — “No conversations yet / Your threads open when you bid…”. Pull-refresh unchanged. `GET /channels` → `channels: []`. Two contracts exist (`P58-contracts.png`) with no threads.
- Expected: Empty inbox on a clean seed is fine. Copy that promises a thread on bid is overstated.
- Actual: 0 channels after bid + 2 contracts.
- Remediation: Soften copy to award / contract / explicit message, not “when you bid”.
- Confidence: 8

### [SIM-WF.P3] Tab bar remains on Account destinations
- Status: PASS
- Severity: advisory
- Surface: Account stack
- Evidence: Workspace, Instant offers, Seller payouts, Payment methods, Verification docs, Contracts, My bids — tab capsule visible on every shot. `.keepRootTabBarVisible()` + 28pt bottom inset.
- Expected: 5-tab chrome stays.
- Actual: Matches.
- Confidence: 9

## API probes (provider)

| Call | Result |
|------|--------|
| `GET /health` | 200 ok |
| `GET /jobs?page_size=20` | 3 active (legal $250, legal $400, HVAC $500 / 2 bids) |
| `GET /listings?page_size=1` | pagination total **49** |
| `POST /auth/login` provider | 200 access_token |
| `GET /channels` | 0 |
| `GET /contracts` | 2 (Kitchen Sink active, Ceiling Fan completed) |
| `GET /bids/mine` | 4 service bids including new $185 on `…0104` |

## Fixes applied (not committed, not rebuilt on sim)

| File | Change |
|------|--------|
| `ios/NoMarkup/Features/HomeView.swift` | GOODS/LIVE stats use pagination total when the page is all-live |
| `ios/NoMarkup/Features/JobDetailView.swift` | Reverse-bid example dollars derived from the real ceiling |
| `ios/NoMarkup/Core/Models.swift` | 60s retract requires elapsed ∈ [0, 60); job bid title fields |
| `ios/NoMarkup/Features/ListingDetailView.swift` | Same retract window clamp |
| `ios/NoMarkup/Features/MyBidsView.swift` | Hydrate service bid titles from `GET /jobs/{id}` |
| `ios/NoMarkup/Features/AccountView.swift` | Sign-out confirmation dialog |

## Residuals

- Signed rebuild not installed — FIXED items are compile-level only this pass.
- Home CTAs (Browse / Instant / Shop / Post / Sell) not individually tapped (Jobs/Marketplace reached via tab).
- Spectate / Replay / listing Watch / Add card / Upload document / Create Stripe not driven (surfaces visible).
- Verify email & phone screen not opened (sign-out interrupt).
- Widget / Live Activity not observed.
- `sim-tap.sh` still uses title-bar insets; iPhone 17 AX screen is 350×760 at (437,113).
