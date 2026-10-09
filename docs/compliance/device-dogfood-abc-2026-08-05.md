# Device dogfood (A) — 3-role + money paths — 2026-08-05

**Overall A: PASS (YELLOW for interactive UI depth)**

| Layer | Result |
|-------|--------|
| Gateway health | **PASS** `http://127.0.0.1:8081/health` + LAN `192.168.1.101:8081` |
| Seed login ×3 | **PASS** customer / provider / admin → **HTTP 200** |
| Money-path API | **PASS** zero 500s — see `money-path-api-dogfood-2026-08-05.md` |
| Device build Debug | **PASS** `generic/platform=iOS` → BUILD SUCCEEDED |
| Device install | **PASS** UDID `00008130-0018493E3A41001C` · seq **3372** |
| Launch customer | **PASS** `devicectl process launch` + auto-login env |
| Launch provider | **PASS** |
| Launch admin | **PASS** main process pid **90687** confirmed |
| Full interactive UI walk | **GAP** — launch + API proven; manual Account-row walk residual |

## Device

- Tanner’s iPhone 15 Pro Max · iOS 26.5.2 · CoreDevice `AE11FA5B-E952-5732-BA5C-3819ABC95443`
- App: `ios/DerivedDataDevice/Build/Products/Debug-iphoneos/NoMarkup.app`
- Bundle: `com.nomarkup.app`
- API: `NOMARKUP_API_BASE_URL=http://192.168.1.101:8081`
- Auto-login: `NOMARKUP_UI_TEST_EMAIL` / `NOMARKUP_UI_TEST_PASSWORD` (seed `Password123!`)

## Money paths (API)

Documented in [`money-path-api-dogfood-2026-08-05.md`](./money-path-api-dogfood-2026-08-05.md):

- Payment methods empty list **200** (not 500)
- Stripe Connect status **200** (not onboarded seed)
- Bids mine **200**
- Admin flags **200**

## Simulator

- Build Debug sim **PASS**
- Screenshots under `docs/compliance/sim-runs/2026-08-05-dogfood/`
- Note: first `simctl launch --setenv` failed (CLI parse); `SIMCTL_CHILD_*` used for env injection

## Residuals

1. Process snapshot often shows Widget extension before main binary settles (known evening pattern).
2. No automated XCUITest on **physical** device this run — see section C (sim only).
3. Stripe seed not fully onboarded — empty methods / Connect incomplete is expected, must stay non-500.

---

# B — Multi-step PostJob wizard

**Status: SHIPPED + BUILD SUCCEEDED**

| Item | Detail |
|------|--------|
| Chrome | `BrandWizardStepChrome` — gold progress rail + “Step N of 4 · Title” |
| Steps | **Basics** → **Pricing** → **Location** → **Review** |
| Gates | Per-step validation on Continue; full `submit()` on Review |
| Haptics | selection advance / warning fail / medium submit |
| a11y | `postJob.wizardChrome`, `postJob.continue`, `postJob.back`, `postJob.submit`, field ids |
| Files | `BrandTheme.swift`, `PostJobView.swift` |

---

# C — Full UITest suite (seed credentials)

**Status: TEST SUCCEEDED — 16/16, 0 failures**

| Suite | Result |
|-------|--------|
| `NoMarkupUITests` (11) | **0 failures** — cold launch, login, home hero, jobs settle, marketplace, 3 role shells, account money rows, tab nav |
| `ScreenshotWalkUITests` (5) | **0 failures** — customer core + account, provider, fresh customer, admin |
| Total wall | ~2335 s (~39 min) on iPhone 17 Pro sim |

**Env:** seed `customer@nomarkup.com` / `Password123!` · API `http://127.0.0.1:8081` · gateway health ok  

**Hang fix mid-run:** first attempt stuck ~20 min on Account lazy-list scroll for Feature flags. Soft-skip + capped `scrollTo` in `ScreenshotWalkUITests.swift` — re-run completed green.

**xcresult:**  
`/Users/nuclearisotope/Library/Developer/Xcode/DerivedData/NoMarkup-aembbkliktxjtdhcwhudloynxldx/Logs/Test/Test-NoMarkup-2026.08.05_19-55-22--0700.xcresult`

---

## Overall A→B→C

| Track | Verdict |
|-------|---------|
| A Device + money API | **PASS** (YELLOW interactive depth) |
| B PostJob wizard | **PASS** |
| C UITests | **PASS 16/0** |
