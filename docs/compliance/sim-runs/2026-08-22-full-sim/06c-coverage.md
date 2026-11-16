# XCUITest coverage gap close — 2026-08-22 (`06c`)

Smoke methods added to `ios/NoMarkupUITests/NoMarkupUITests.swift` for surfaces listed as **Untested** in [`00-inventory.md`](00-inventory.md) §13. Not a 40-minute ScreenshotWalk.

**No commit. No money submit. No new seed account. Forgot-password email was not sent.**

| Field | Value |
|--------|--------|
| Sim | iPhone 17 `B3CA7DF9-228C-4490-B5B7-57F2B0FE5D6D` / iOS 26.5 (Pro occupied by test07 / `DerivedDataFullSim`; Pro Max left for ui-surface) |
| Xcode | `DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer` |
| DerivedData | `ios/DerivedDataFullSimC` (not `DerivedDataFullSim`) |
| API | `http://127.0.0.1:8081` health 200 · live catalog `GET /jobs?status=open` n=3 · `GET /listings` totalCount=23 |
| Seed | `customer@` / `provider@nomarkup.com` · `Password123!` |
| xcresult | `ios/DerivedDataFullSimC/06c-coverage.xcresult` (4/5) then `06c-map.xcresult` (filters/map retry **PASS**) |

## Results

| Method | Result | Time | What opened |
|--------|--------|------|-------------|
| `testRegisterScreenOpens` | **PASS** | 40.6 s | Sign in → Create account. Form only. **Did not tap Create account submit.** |
| `testForgotPasswordScreenOpens` | **PASS** | 42.9 s | Sign in → Forgot password. Email prefilled. **Did not tap Send reset email.** |
| `testJobsMapAndFilters` | **PASS** (retry) | 42.8 s | Jobs Browse → filters bar (Category / schedule / min bid / Apply) → Jobs map (`3 jobs · 25 km`, pin “AC Unit Not Cooling Properly $500”). |
| `testJobDetailPlaceBidChrome` | **PASS** | 176.5 s | Provider · first open job “Review SaaS vendor contract”. Place-bid dollars chrome **not submitted**. Spectate terminal opened (LIVE STREAM). |
| `testListingDetailWatchAndBidChrome` | **PASS** | 71.3 s | Customer · Makita 18V listing. Watch toolbar (add then restore remove). Place-bid dock **Bid disabled / empty**. Spectate opened. Messages composer focused, **not sent**. |

First combined run after `firstMatch`: register / forgot / job bid / listing **PASS**; map/filters **FAIL** — tap hit the SwiftUI wrapper `Other` for `jobs.filters` so the bar never toggled. Test now taps `app.buttons["jobs.filters"]`. Isolated retry **PASS**.

## Shots (this folder)

| File | Surface |
|------|---------|
| `testRegisterScreenOpens-login-before-register.png` | Sign in after sign-out |
| `testRegisterScreenOpens-register-screen.png` | Join NoMarkup / empty form / role picker |
| `testForgotPasswordScreenOpens-login-before-forgot.png` | Sign in |
| `testForgotPasswordScreenOpens-forgot-password-screen.png` | Reset password / Send reset email **untapped** |
| `testJobsMapAndFilters-jobs-browse.png` | Jobs list (3 open) |
| `testJobsMapAndFilters-jobs-filters.png` | Filters bar expanded |
| `testJobsMapAndFilters-jobs-map.png` | MapKit jobs map + pin |
| `testJobDetailPlaceBidChrome-job-place-bid-chrome.png` | Place a bid (dollars) $0.00, no submit |
| `testJobDetailPlaceBidChrome-spectate-open.png` | Spectate LIVE / STREAM $400 lowest |
| `testListingDetailWatchAndBidChrome-listing-detail.png` | Listing hero |
| `testListingDetailWatchAndBidChrome-listing-watch-chrome.png` | Heart toolbar |
| `testListingDetailWatchAndBidChrome-listing-place-bid-chrome.png` | Forward-auction bid dock, Bid greyed |
| `testListingDetailWatchAndBidChrome-spectate-open.png` | Listing spectate |
| `testListingDetailWatchAndBidChrome-messages-composer.png` | Thread + Message field focused |

## a11y ids added (smallest)

| ID | View |
|----|------|
| `login.register` / `login.forgotPassword` | `LoginView` links |
| `register.root` / `.displayName` / `.email` / `.submit` | `RegisterView` (submit **never tapped**) |
| `forgotPassword.root` / `.email` / `.send` | `ForgotPasswordView` (send **never tapped**) |
| `jobs.filters.bar` | Browse filters panel |
| `jobs.map.root` | `JobsMapView` |
| `jobDetail.placeBid` | Job bid section |
| `listingDetail.watch` / `listingDetail.placeBid` | Listing toolbar + bid section |
| `messages.composer` | Thread `Message` field |
| `spectate.root` | `SpectateTerminalView` |

Harness: `byID` now prefers `app.buttons[id].firstMatch` then `.any` firstMatch — SwiftUI stamps the same identifier on a wrapper Other **and** the inner Button (`jobs.filters`, `listingDetail.spectate`, section headers). `exists`/`frame` on the ambiguous query threw `Multiple matching elements`.

Sign-out confirm (`tapSignOutConfirm`) added so register/forgot can leave auto-login.

## Still untested vs inventory (honest)

Not claimed PASS: MFA / SIWA / Google / Facebook / passkey login; DEBUG scaffold; bid **submit** / buy-now / bond / award / escrow pay; camera / location system sheets (map used default US camera; location pre-prompt not shown); widgets / App Intents; admin mutations; Jobs Mine segment; marketplace search / tab map.

Watch toggle was add→remove (undoable). Composer focus only.

## Command (for rerun)

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
xcodebuild test \
  -project ios/NoMarkup.xcodeproj -scheme NoMarkup \
  -destination 'platform=iOS Simulator,id=B3CA7DF9-228C-4490-B5B7-57F2B0FE5D6D' \
  -derivedDataPath ios/DerivedDataFullSimC \
  -only-testing:NoMarkupUITests/NoMarkupUITests/testRegisterScreenOpens \
  -only-testing:NoMarkupUITests/NoMarkupUITests/testForgotPasswordScreenOpens \
  -only-testing:NoMarkupUITests/NoMarkupUITests/testJobsMapAndFilters \
  -only-testing:NoMarkupUITests/NoMarkupUITests/testJobDetailPlaceBidChrome \
  -only-testing:NoMarkupUITests/NoMarkupUITests/testListingDetailWatchAndBidChrome \
  -parallel-testing-enabled NO
```
