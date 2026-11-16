# SIM-PERF — full simulator run (2026-08-22)

- **Target**: `ios/NoMarkup.xcodeproj` scheme `NoMarkup` · bundle `com.nomarkup.app`
- **Date**: 2026-08-22
- **Simulator**: iPhone 17 Pro Max `503E262C-5731-45BE-A459-CFF59551539E` / iOS 26.5 (23F77) — **ui-surface device**. Concurrent `xcodebuild build-for-testing` on Simulator A (`7F123C44`) did **not** lock this UDID. No `xcodebuild` on `503E262C` at launch time.
- **Configuration**: Debug (fresh `xcodebuild` + `simctl install` from `ios/DerivedDataPerf`)
- **API**: `http://127.0.0.1:8081` — `GET /health` 200 `{"status":"ok","version":"dev"}`
- **Catalog**: `GET /api/v1/jobs?page=1&page_size=1` → `totalCount` **3**; listings `totalCount` **0**. UI Mine list later showed **5 of 5** (customer’s posted jobs, including closed).
- **Mode**: fix · **Depth**: deep / full
- **Do not commit.**

Measurements are Simulator + Debug. They are not a Release device Instruments sign-off. No hours-long Instruments / `xctrace` this run.

---

## Target card

| Field | Value |
|-------|-------|
| Project / scheme | `ios/NoMarkup.xcodeproj` / NoMarkup |
| Bundle id | `com.nomarkup.app` |
| Simulator | iPhone 17 Pro Max `503E262C` iOS 26.5 (Booted) |
| API base | http://127.0.0.1:8081 |
| Backend health | up |
| Mode | fix |
| Depth / scope | deep / SIM-PERF.1–6 |

---

## Verdict

| ID | Check | Status |
|----|-------|--------|
| SIM-PERF.1 | Cold launch → interactive chrome &lt; 2.0 s (Debug sim) | **PASS** |
| SIM-PERF.2 | Tab switch no multi-second blank; Account `NavigationLink` + `LazyView` | **PASS** |
| SIM-PERF.3 | Catalog lists lazy + paginated (no eager 1000-row dump) | **PASS** |
| SIM-PERF.4 | No `Timer.publish` / `setInterval` REST polling | **PASS** |
| SIM-PERF.5 | Image downsample bounds still hold (`UIImage(data:)` MainActor = 0) | **PASS** |
| SIM-PERF.6 | Instruments culture documented; no 30 min trace (user constraint) | **PASS** |

**Open product FAIL:** none. No `Timer` polling an API (convert out of scope; nothing to convert).

**Readiness:** **GREEN** for this sim Debug gate. Culture I1–I3 (Release device Time Profiler + Allocations) remain founder/eng, not this run.

---

## Findings

### [SIM-PERF.1] Cold launch → interactive chrome
- Status: PASS
- Severity: advisory
- Surface: Debug launch after `xcodebuild` + `simctl install`
- Evidence:
  - `xcodebuild -project ios/NoMarkup.xcodeproj -scheme NoMarkup -destination 'platform=iOS Simulator,id=503E262C-…' -configuration Debug -derivedDataPath ios/DerivedDataPerf build` → **BUILD SUCCEEDED**.
  - `xcrun simctl install` then `simctl launch 503E262C-5731-45BE-A459-CFF59551539E com.nomarkup.app` returned in **0.265 s** (`com.nomarkup.app: 19938`).
  - Timed screenshots from `t0` (launch invoke), log `perf-launch-log.txt`:

    | Shot | requested | captured | What |
    |------|-----------|----------|------|
    | `perf-01-launch-0400ms.png` | 0.405 s | 0.861 s | Gold launch screen (splash) |
    | `perf-01-launch-0800ms.png` | 0.861 s | 1.115 s | Gold splash only |
    | `perf-01-launch-1200ms.png` | 1.210 s | 1.490 s | **Sign in chrome** — email/password, Sign in, Sign in with Apple, Browse without signing in, Privacy/Terms. API `127.0.0.1:8081` |
    | `perf-01-launch-1600ms.png` | 1.610 s | 1.865 s | Same Sign in, contrast settled |
    | `perf-01-launch-2000ms.png` / `3000ms` | 2.01 / 3.01 s | 2.22 / 3.20 s | Stable Sign in |

  - First interactive chrome (tappable Sign in + Browse) is between **1.12 s (still splash) and 1.21–1.49 s (Sign in painted)**.
  - Session later restored (`customer@nomarkup.com` on Account at 10:09). That is Keychain restore *after* first paint, not a hang on first chrome.
- Expected: &lt; 2.0 s to interactive chrome (sim; Debug looser).
- Actual: **~1.2–1.5 s Debug**.
- Remediation: none. Release Time Profiler would be tighter.
- Confidence: 9

### [SIM-PERF.2] Tab switch + Account `LazyView`
- Status: PASS
- Severity: blocker (historical `Thread stack size exceeded` on Account)
- Surface: Root `TabView` (`RootTabView.swift` 28–56) · Account hub list
- Evidence — tabs:
  - Native `TabView` keeps sibling tabs mounted. Cycle via `sim-tap.sh --no-ax` on `503E262C` (~350 ms after click, including host cliclick).
  - `perf-02-tab-marketplace-immediate.png` — Marketplace empty-state + search + map, 5-tab bar (a 10:07 composite also showed Account chrome dissolving — **not a blank scaffold**).
  - `perf-02-tab-jobs-350ms.png` — Jobs Mine list **5 of 5** rows + Browse/Mine + map, Jobs tab selected.
  - `perf-02-tab-messages-350ms.png` — thread fully painted, **Live** WS glyph, composer, Messages selected.
  - `perf-02-tab-account-350ms.png` — Account hub (Finish setup, market wiring, Session signed in `customer@nomarkup.com`), Account selected.
  - `perf-02-tab-home-350ms.png` — Home stats + how-it-works, Home selected.
  - No multi-second blank / spinner-only stall on any captured frame.
- Evidence — Account lazy destinations:
  - `LazyView` (`ios/NoMarkup/Core/LazyView.swift` 9–21) stores `() -> Content` and only calls `build()` in `body`.
  - `AccountView.swift`: **50 `NavigationLink {` / 50 `LazyView {`**. Zero `NavigationLink` blocks without `LazyView` in the next 5 lines (python scan).
  - Legal/support rows remain **Buttons** (Safari sheets), not `NavigationLink`.
  - Nested hubs also defer: `BusinessFeaturesHubView`, `ProvidersView`, `FollowingView`, `ContractsView`, `JobsView` detail, `MyBidsView` detail.
- Expected: tab chrome instantly; tapping Account does not initialize ~50 destinations.
- Actual: painted tabs in the first screenshot after each tap; Account is a cheap `List` of labels.
- Remediation: none.
- Confidence: 9

**Advisory (not FAIL):** single-child destinations still omit `LazyView` (cannot re-create the 50-row stack overflow):

- `MarketplaceView.swift:125–127` — `NavigationLink { MarketplaceMapView() }` (Jobs map **does** wrap `LazyView`; this sibling does not).
- `HomeView.swift:83–88` — `navigationDestination` to `JobDetailView` / `ListingDetailView` (two destinations, not a hub list).
- `ProviderInstantOffersView.swift:61–62, 193–194, 286–287` — `ProfileSettingsView` / `ProviderWorkspaceView` / `JobDetailView` (already under Account `LazyView`).
- `ParitySurfacesView.swift:216, 255, 300, 393` — blotter / watch / `CategoryPickerView`.

### [SIM-PERF.3] Long lists are lazy + paginated
- Status: PASS
- Severity: advisory
- Surface: Jobs browse, Marketplace, Messages thread, Home desk
- Evidence:
  - **Jobs browse:** SwiftUI `List` + `ForEach(jobs)` (`JobsView.swift` 274–293). `pageSize = 40` (`JobsView.swift` 506) with explicit “Load more”, not a full-catalog dump. This seed: API `totalCount` **3** open; Mine UI **5 of 5** (`perf-02-tab-jobs-350ms.png`). Rows are text/chips (`JobRowView`) — no per-row `AsyncImage`.
  - **Marketplace:** `List` + `ForEach(listings)` (`MarketplaceView.swift` 172 / 211), `pageSize = 40` (`MarketplaceView.swift` 392). Seed `totalCount` **0** → empty state (`perf-02-tab-marketplace-immediate.png`), not an eager VStack of lots.
  - **Messages thread:** `ScrollView` + **`LazyVStack`** + `ForEach(displayedMessages)` (`MessagesView.swift` 1060–1063). Inbox fetch `pageSize` 40 (search 100).
  - **Home:** `ScrollView` + `VStack` is a **dashboard**, not a catalog: live cards `prefix(8)` jobs / `prefix(3)` listings (`HomeView.swift` 822–823); ticker chips `deskJobs.prefix(6)` (`HomeView.swift` 286). Fetch `pageSize: 100` is for stats/ticker, not 100 stacked rows.
  - No `VStack { ForEach(huge) }` catalog pattern. Remaining `ScrollView`s are forms (login/register/onboarding) or skeleton loaders.
- Expected: no eager 1000-row list; pagination + SwiftUI `List`/`LazyVStack`.
- Actual: catalogs page at 40; Home caps visible cards; thread is lazy.
- Remediation: none.
- Confidence: 9

### [SIM-PERF.4] No Timer / setInterval REST polling
- Status: PASS
- Severity: major (project forbids API polling via `Timer` / `setInterval`; WS/SSE instead)
- Surface: `ios/NoMarkup` (not Stripe checkout copies under DerivedData)
- Evidence: python walk of `ios/NoMarkup/**/*.swift` for `Timer.publish` / `Timer.scheduledTimer` / `setInterval`:

  | Path | Mechanism | Cadence | REST? | While visible only? |
  |------|-----------|---------|-------|---------------------|
  | `ProviderInstantOffersView.swift:110` | `Timer.publish(every: 15, on: .main)` | **15 s** | **No** — countdown `tick` for expiry filter (`activeOffers` reads `tick`) | Yes (`onReceive` on the view) |
  | `ProviderInstantOffersView.swift:102–108` | `Task.sleep` loop | **30 s** (`refreshInterval`) | Yes — `GET /provider/offers` | Yes (`.task` cancels on disappear) |
  | `NotificationsView.swift:138–149` | `Task.sleep` | **30 s** | Yes — inbox page | Yes; skips unless `scenePhase == .active`; comment: no `Timer.scheduledTimer` |
  | `MessagesView.swift:795–814` | `Task.sleep` hybrid | **15 s** if WS live (`pollReconcileNanoseconds`); **2.5 s** if WS down (`pollFallbackNanoseconds:475`) | One channel, not full inbox list | Yes |
  | `JobDetailView.pollLiveAuctionStateLoop:2779` | `Task.sleep` hybrid | **15 s** WS live; **5 s** WS down (`liveAuctionFallbackPollNanoseconds:2771`); else 10 s | `auction/state` + events | Yes |
  | `JobDetailView.pollBidLadderLoop:2998` | `Task.sleep` | **10 s** | `fetchJobBids` | Yes |
  | `ListingDetailView.pollBidLadderLoop:2618` | `Task.sleep` hybrid | **15 s** WS live; **5 s** WS down | listing ladder | Yes |
  | `SpectateTerminalView.runLifecycle:293` | `Task.sleep` | **4 s** | spectator snapshot | Yes |
  | WS clients (`Auction` / `Chat` / `Spectator` / `MarketplaceSpectator`) | `Task.sleep` ping | keep-alive | **No REST** | connection lifetime |
  | `TimelineView(.periodic)` (Home / Job / Listing / Marketplace / MyBids / ticker 0.8 s) | SwiftUI clock | 1 s / 0.8 s | **No** — countdown / pulse opacity | Yes |

- **Zero** `setInterval` in iOS (web-only API). **Zero** `Timer.scheduledTimer` in `ios/NoMarkup`.
- **The only `Timer.publish` is Instant Offers 15 s UI tick — it does not hit the network.** REST polls are `Task.sleep` loops cancelled on disappear, hybrid with WebSocket (15 s reconcile when connected). Fastest REST poll is **2.5 s** (chat thread **when WS is down**). Not sub-second. Not `Timer`.
- Browse lists (Jobs / Marketplace / Home / Messages inbox) do **not** auto-poll; appear + pull-to-refresh.
- Expected: no `Timer` / `setInterval` API polling; no sub-second full-list REST while WS is live.
- Actual: none. Convert of Instant Offers `Timer.publish` → `TimelineView` is cosmetic, out of scope.
- Remediation: none (no FAIL at file:line).
- Confidence: 10

### [SIM-PERF.5] Image downsample / cache bounds
- Status: PASS (prior FIXED 2026-08-12 still holds)
- Severity: major if regressed
- Surface: `ImageUploader` + contract completion photos
- Evidence: `rg 'UIImage\(data:' ios/NoMarkup` → **0 call sites**. Remaining mention is a comment at `ContractDetailView.swift:3089` (“do not `UIImage(data:)` on MainActor”). Completion paths still go through `ImageUploader.jpegDataDownsampled`. `maxPixelDimension = 2048`, ImageIO off-main, 10 MB cap.
- Expected: no unbounded MainActor full-res decode.
- Actual: still bounded.
- Remediation: none this run.
- Confidence: 9

### [SIM-PERF.6] Instruments culture
- Status: PASS
- Severity: advisory
- Surface: `docs/compliance/ios-instruments-culture.md`
- Evidence: culture doc present. Required templates Time Profiler + Allocations, Release, physical device preferred. Sign-off table I1–I5 still unchecked for an ASC Release pass — pre-ship ritual, not a sim Debug FAIL.
- Expected: documented culture; no 30 min Instruments this run (user: “Do not run Instruments for hours”).
- Actual: doc exists. Cold launch + tab screenshots + static poll/list proof suffice for this gate.
- Remediation: none for this sim run. Founder/eng: run Release Time Profiler + Allocations on device before claiming IOS-PERF.1 ship sign-off.
- Confidence: 8

---

## Screenshots / artifacts

| File | What |
|------|------|
| `perf-01-launch-0400ms.png` / `0800ms.png` | Gold splash |
| `perf-01-launch-1200ms.png` | First interactive Sign in (~1.2–1.5 s) |
| `perf-01-launch-1600ms.png` … `3000ms.png` | Stable Sign in |
| `perf-02-pre-browse.png` / `after-browse-tap.png` | Home + 5-tab bar (session restored) |
| `perf-02-tab-marketplace-immediate.png` | Marketplace empty / tab selected |
| `perf-02-tab-jobs-350ms.png` | Jobs Mine 5 of 5, lazy `List` |
| `perf-02-tab-messages-350ms.png` | Thread + Live WS |
| `perf-02-tab-account-350ms.png` | Account hub, `customer@` |
| `perf-02-tab-home-350ms.png` | Home return, no blank |
| `perf-launch-log.txt` / `perf-tab-log.txt` | Timestamps |

---

## Residuals

- Launch / tab numbers are **Debug sim**, not Release device Instruments (culture I1–I3 still founder/eng).
- Instant Offers 15 s `Timer.publish` is a countdown tick, not REST. Optional later: `TimelineView` (cosmetic).
- `MarketplaceView` map `NavigationLink` still omits `LazyView` (single destination). Jobs map wraps it.
- This seed is thin (3 open jobs / 0 listings). Architecture (pageSize 40 + `List`) is the bound; a 393-row seed was proven 2026-08-12.
- Tab frames include host cliclick latency (~0.35 s wait after tap). Perceived switch is faster than that.

## Commands to reproduce

```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
UDID=503E262C-5731-45BE-A459-CFF59551539E
OUT=docs/compliance/sim-runs/2026-08-22-full-sim
curl -sf http://127.0.0.1:8081/health

xcodebuild -project ios/NoMarkup.xcodeproj -scheme NoMarkup \
  -destination "platform=iOS Simulator,id=$UDID" \
  -configuration Debug -derivedDataPath ios/DerivedDataPerf build

xcrun simctl install "$UDID" ios/DerivedDataPerf/Build/Products/Debug-iphonesimulator/NoMarkup.app
xcrun simctl terminate "$UDID" com.nomarkup.app
xcrun simctl launch "$UDID" com.nomarkup.app
xcrun simctl io "$UDID" screenshot "$OUT/perf-retest.png"

docs/compliance/sim-runs/2026-08-12/sim-tap.sh --device "iPhone 17 Pro Max" --no-ax --nx 0.50 --ny 0.96
```

## Disclaimer

Simulator Debug + `simctl` screenshot timestamps. Not a Release Time Profiler / Allocations sign-off.
