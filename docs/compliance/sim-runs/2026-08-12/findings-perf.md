# SIM-PERF findings — 2026-08-12

- **Target**: NoMarkup iOS (`ios/NoMarkup.xcodeproj`, scheme `NoMarkup`, bundle `com.nomarkup.app`)
- **Date**: 2026-08-12
- **Simulator**: iPhone 17 Pro Max `503E262C-5731-45BE-A459-CFF59551539E` (customer; XCUITest `7F123C44` not used)
- **Configuration**: Debug (installed dogfood build for launch/tabs/scroll; unit retest compiled Debug)
- **API**: `http://127.0.0.1:8081` — `GET /health` 200 in 9 ms (`{"status":"ok","version":"dev"}`)
- **Catalog**: `GET /api/v1/jobs?page=1&page_size=1` → `totalCount` 393 (UI later showed 394–395 as other sim agents posted)
- **Mode**: fix
- **Depth**: deep
- **Readiness**: GREEN (no open blocker/major FAIL after decode fix)

## Target card

| Field | Value |
|-------|-------|
| Project / scheme | `ios/NoMarkup.xcodeproj` / NoMarkup |
| Bundle id | `com.nomarkup.app` |
| Simulator | iPhone 17 Pro Max 503E262C (Booted) |
| API base | http://127.0.0.1:8081 |
| Backend health | up |
| Mode | fix |
| Depth / scope | deep / SIM-PERF.1–6 |

## Summary

| ID | Status | Severity | Title |
|----|--------|----------|-------|
| SIM-PERF.1 | PASS | — | Cold launch → interactive chrome ~1.5 s (Debug) |
| SIM-PERF.2 | PASS | — | Tab switch: no multi-second blank |
| SIM-PERF.3 | PASS | — | Jobs list lazy + paginated (40 of ~393) |
| SIM-PERF.4 | PASS | — | No sub-second full-list REST when WS connected |
| SIM-PERF.5 | FIXED | major | Completion-photo decode bypassed ImageIO cap |
| SIM-PERF.6 | PASS | — | Instruments culture documented; no new 30 min trace |

## Findings

### [SIM-PERF.1] Cold launch → interactive chrome
- Status: PASS
- Severity: advisory
- Surface: Debug launch → Home tab chrome
- Evidence:
  - `xcrun simctl launch 503E262C-5731-45BE-A459-CFF59551539E com.nomarkup.app` returned in **0.223 s** (`com.nomarkup.app: 87636`).
  - Timed screenshots from `t0` (launch invoke):
    - `perf-01-launch-0400ms.png` (actual ~0.58 s) — gold launch screen only.
    - `perf-01-launch-0800ms.png` (actual ~1.00 s) — still gold splash.
    - `perf-01-launch-1200ms.png` (actual ~1.54 s) — **Home chrome + 5-tab bar + hero CTAs** (catalog still “Waiting for open floor…”).
    - `perf-01-launch-1600ms.png` / `perf-01-launch-2000ms.png` — market desk + 394 jobs populated.
  - First interactive chrome (tappable tabs + Browse/Post) is between **1.00 s (splash) and 1.54 s (chrome)**.
- Expected: < 2.0 s to interactive chrome (sim; Debug looser).
- Actual: ~1.5 s Debug. Network fill of desk/stats finishes by ~1.85 s; that is data, not chrome.
- Remediation: none. Release Time Profiler would be tighter; Debug noted as required.
- Confidence: 8

### [SIM-PERF.2] Tab switch no multi-second blank
- Status: PASS
- Severity: advisory
- Surface: Root `TabView` (Home / Marketplace / Jobs / Messages / Account)
- Evidence:
  - Native `TabView` in `ios/NoMarkup/Features/RootTabView.swift` (lines 28–56) keeps siblings mounted.
  - Cycle via `sim-tap.sh` on 503E262C. Immediate frames after each tap show fully painted chrome of the previous/current tab — never a blank scaffold for seconds.
  - `perf-02-tab-jobs-350ms.png` — Jobs list + Jobs tab selected.
  - `perf-02-tab-home-350ms.png` — Home hero + desk after return tap.
  - `perf-02-tab-marketplace-immediate.png` / `perf-02-tab-messages-immediate.png` / `perf-02-tab-account-immediate.png` — Marketplace empty-state, Messages inbox, Account session all painted (no spinner-only stall).
- Expected: no multi-second blank on tab change.
- Actual: chrome present on every captured frame (~0.3–0.8 s after host click, including cliclick latency).
- Remediation: none.
- Confidence: 8

### [SIM-PERF.3] Long list scroll (393 jobs)
- Status: PASS
- Severity: advisory
- Surface: Jobs browse (`JobsView`)
- Evidence:
  - API seed: `totalCount` **393** (`GET /api/v1/jobs?page=1&page_size=1`). UI header **40 of 394/395** after other agents posted.
  - Code: SwiftUI `List` + `ForEach(jobs)` (`JobsView.swift` 248–259) — lazy rows. `pageSize = 40` (`JobsView.swift` 458) with explicit “Load more”, not a 393-row dump.
  - `perf-00-before-relaunch.png` / `perf-03-jobs-list-top.png` — first page, 40 of 395, rows painted.
  - `perf-03-jobs-list-scrolled.png` — three host swipes; list advanced to BidRace rows, no torn/blank frames, tab chrome intact.
  - Rows are text/chips only (no per-row `AsyncImage`) — `JobRowView` (`JobsView.swift` 530+).
- Expected: no multi-frame freezes on seed data; lazy list.
- Actual: paginated lazy `List`; scroll stayed painted.
- Remediation: none.
- Confidence: 9

### [SIM-PERF.4] Polling — no sub-second full-list REST when WS connected
- Status: PASS
- Severity: advisory
- Surface: Chat thread, job/listing live auction, badges, notifications
- Evidence: repo grep of `Timer.publish` / `Task.sleep` / `poll` in `ios/NoMarkup`:
  | Path | WS connected | WS down | Full job/listing list? |
  |------|--------------|---------|------------------------|
  | `MessagesView` thread | **15 s** reconcile (`pollReconcileNanoseconds`) | 2.5 s | No — one channel |
  | Messages inbox | none (appear + pull-to-refresh only) | — | No |
  | `JobDetailView.pollLiveAuctionStateLoop` | **15 s** | 1.5–10 s | No — `auction/state` + events |
  | `JobDetailView.pollBidLadderLoop` | 10 s | 10 s | No — `fetchJobBids` |
  | `ListingDetailView.pollBidLadderLoop` | **15 s** | 3 s | No — listing ladder |
  | `NotificationsView` | 30 s while visible | — | No — inbox page |
  | `ProviderInstantOffersView` | 30 s + 15 s countdown Timer | — | No — offers |
  | `RootTabView.refreshUnreadBadges` | on appear / tab change | — | No — channels page 40 + unread count |
  | Home | appear + pull-to-refresh only | — | `fetchJobs` pageSize **8** |
- Fastest REST poll is **1.5 s** (job live state when WS is **down**). Connected hybrid paths are 10–15 s. No `Timer.publish` under 15 s except Instant Offers countdown UI.
- 1 s sleeps in auction/chat WS lifecycle loops are keep-alive, not REST.
- Expected: no sub-second full-list REST while WS is live.
- Actual: none found; inbox and browse lists do not auto-poll.
- Remediation: none.
- Confidence: 9

### [SIM-PERF.5] Image downsample / cache bounds (ImageUploader)
- Status: FIXED
- Severity: major
- Surface: `ImageUploader` + contract completion photo upload
- Evidence:
  - **Already bounded (PASS):** `maxPixelDimension = 2048`, ImageIO thumbnail encode off-main, 10 MB cap, `URLCache` 64 MB / 256 MB + memory-warning purge (`ImageUploader.swift` 23–101, 290–335; `NoMarkupApp.swift` 16–18).
  - **FAIL (pre-fix):** `ContractDetailView.uploadPickedPhoto` / `uploadCameraPhoto` decoded with `UIImage(data:)` + `jpegData(compressionQuality: 0.85)` on **MainActor** — unbounded bitmap, bypassed ImageIO.
  - **Fix:** public `ImageUploader.jpegDataDownsampled(from:)` (`ImageUploader.swift` 216–227) used by both completion paths (`ContractDetailView.swift` 3042–3063).
- Expected: every upload decode path downsamples; no unbounded MainActor `UIImage(data:)`.
- Actual (after): only ImageIO downsample path remains (`rg 'UIImage\(data:' ios` → 0 hits).
- Remediation: applied (see Fixes).
- Retest: `xcodebuild test -only-testing:NoMarkupTests/ImageUploaderTests` on iPhone 17 `B3CA7DF9` → **TEST SUCCEEDED**. `testJpegDataDownsampledCapsLongestEdge` passed (1.231 s) — 4000×2500 JPEG longest edge ≤ 2048.
- Confidence: 9

### [SIM-PERF.6] Instruments culture
- Status: PASS
- Severity: advisory
- Surface: `docs/compliance/ios-instruments-culture.md`
- Evidence: culture doc present (updated 2026-08-05). Required templates: Time Profiler + Allocations, Release, physical device preferred. Sign-off table I1–I5 still unchecked for an ASC Release pass — that is a pre-ship ritual, not a sim Debug FAIL.
- Expected: documented culture; optional short capture if cheap.
- Actual: doc exists. No 30-minute Instruments / `xctrace` this run (user constraint; Debug sim screenshots + code proof suffice).
- Remediation: none for this sim run. Founder/eng: run Release Time Profiler + Allocations on device before claiming IOS-PERF.1 ship sign-off.
- Confidence: 8

## Fixes applied

1. **`ImageUploader.jpegDataDownsampled`** — shared off-main ImageIO downsample for non-imaging PUT paths.
2. **`ContractDetailView` completion photos** — library + camera now use that API (no MainActor full-res decode).
3. **`ImageUploaderTests.testJpegDataDownsampledCapsLongestEdge`** — 4000×2500 → ≤2048 px.

## Residuals

- Launch numbers are **Debug**, not Release. Culture sign-off I1–I3 still need a device/Release Instruments pass before ASC (founder/eng).
- `LivePulseDot` uses `TimelineView` every 0.8 s on visible live rows — cheap opacity tick, not a list REST poll.
- Seed list is **paged at 40**, not 393 rows in memory; that is the intended bound.

## Commands to reproduce

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
UDID=503E262C-5731-45BE-A459-CFF59551539E
curl -sf http://127.0.0.1:8081/health
xcrun simctl terminate "$UDID" com.nomarkup.app
# timestamp + launch + screenshots as in this run
xcrun simctl launch "$UDID" com.nomarkup.app
xcrun simctl io "$UDID" screenshot docs/compliance/sim-runs/2026-08-12/perf-retest.png

xcodebuild test -project ios/NoMarkup.xcodeproj -scheme NoMarkup \
  -destination 'platform=iOS Simulator,id=B3CA7DF9-228C-4490-B5B7-57F2B0FE5D6D' \
  -only-testing:NoMarkupTests/ImageUploaderTests \
  -derivedDataPath /tmp/nomarkup-imageuploader-test
```

## Disclaimer

Measurements are Simulator + Debug. They are not a Release device Instruments sign-off.
