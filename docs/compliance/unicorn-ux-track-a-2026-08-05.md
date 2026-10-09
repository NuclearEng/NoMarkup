# Unicorn UX Track A — closeout (2026-08-05)

**Intent:** Institutional product feel — Bloomberg desk density + Robinhood number thrills — dual auction rails (services reverse + goods forward), champagne gold / navy SSOT, native HIG.

**Status:** **GREEN for loading/empty/haptics/money primitives + primary surfaces.** Residual polish remains on deep secondary forms (fine).

---

## 1. Brand system expansions (`BrandTheme` + `BrandHaptics`)

| Primitive | Role |
|-----------|------|
| `BrandSkeletonBar` | Gold shimmer pulse; reduce-motion static; phase starts off-screen |
| `BrandCatalogSkeleton` | Catalog card desk (Home / Marketplace / Jobs) |
| `BrandDetailSkeleton` | Job / listing / contract detail hero + ladder placeholders |
| `BrandInboxSkeleton` | Message list rows (avatar + lines) |
| `BrandFormSkeleton` | Settings / payment / profile forms |
| **`BrandLoadingScreen`** | Drop-in for naked `ProgressView("Loading…")` — `.catalog` / `.detail` / `.inbox` / `.form` |
| `BrandPriceText` | Mono price + numeric transition + optional flash |
| `BrandLoadMoreFooter` | Brand load-more + retry |
| `BrandInlineErrorCard` | Section errors with haptic retry |
| `BrandEmptyState` | Gold seal empty; **primary = medium haptic**, secondary = selection |
| `DollarAmountField` | Live “Will submit $X.XX” + numeric content transition |
| `BrandHaptics` | `@MainActor` light / medium / selection / success / error / warning |
| `brandMoneyFlash` | Green (bid down / savings) or blue (bid up) wash |

---

## 2. iOS surface coverage

### Loading — no more naked catalog spinners
**~45 feature files** converted from `ProgressView("Loading…")` → `BrandLoadingScreen`:

Jobs (browse + mine), Marketplace (already skeleton), Messages inbox + thread, Home catalog sections, Job/Listing/Contract detail, MyBids/Orders/Listings, Providers, Feed, Watchlist/Wishlist, Notifications, Contracts, Payments, Seller payouts, Plan limits, Profile, Trust, Savings, Onboarding, …  

Button-inline `ProgressView()` kept (CTA busy state).

### Haptics map
| Moment | Feedback |
|--------|----------|
| Tab change | selection (`RootTabView`) |
| Jobs Browse/Mine | selection |
| Home primary CTAs | medium / selection |
| Empty-state primary | medium |
| Place / lower bid | medium + success / error |
| Leading bid tick | light + money flash |
| Listing high bid tick | light + **blue** flash (`isDown: false`) |
| Card saved | success |
| Auth sign-in success/fail | success / error (AuthViewModel) |
| Seller Connect create / open | medium / selection |

### Money desk
- Job rows: LIVE pulse (`LivePulseDot`), mono prices, numeric transition  
- Listing rows: same LIVE + mono + transition  
- Job arena leading: green flash on reverse ticks  
- Listing hero / dock / winning row: blue flash on climb  
- Place bid CTA: glass prominent + dollar confirmation  

### Auth
- Login hero matches showcase: serif tagline, gold-bright **Markup**, italic “Not The Markup.”  
- Sign in / MFA use `brandPrimaryButton()` + medium haptic  

---

## 3. Web parity (same session)

| Area | Change |
|------|--------|
| `Skeleton` | Champagne gold shimmer; stronger `price` variant; `motion-reduce:hidden` |
| Listing browse skeleton | card + price variants |
| Jobs search / landing / ticker / bids / listing detail | gold skeletons |
| EmptyState | all action buttons/links `min-h-[44px]` |
| Money typography | mono + `tabular-nums` across BidCard, JobCard, ListingCard, ticker, savings, market range, rails |

**Web typecheck:** `npm run typecheck` — **pass** (tsc --noEmit).

---

## 4. Verification

| Gate | Result |
|------|--------|
| iOS `xcodebuild` Debug sim (iPhone 17 Pro) | **BUILD SUCCEEDED** |
| Web `tsc --noEmit` | **pass** |
| BrandHaptics MainActor isolation | fixed (no UIKit isolation warnings from haptics) |

---

## 5. What’s still not “100% unicorn” (honest residual)

1. **Deep secondary forms** (employees, quote templates, calendar export, NPS) — loaders brand-aligned; not every field has micro-interaction polish.  
2. **Optimistic bid ladder** on slow networks — WS path exists; further optimistic UI is product iteration.  
3. **Custom fonts on iOS** — system serif/mono approximate showcase Instrument/Syne/Outfit (SSOT-acceptable).  
4. **Web RUM / field LCP** — not this track.  
5. **Device dogfood** of this pass — rebuild on hardware recommended before calling UI 100/100.

---

## 6. Agent-team wave 2 (same day)

Five parallel agents + orchestrator integrate:

| Agent | Outcome |
|-------|---------|
| **Messages / chat** | Send medium→success/error haptics; gold send disc when armed; peer-message + inbox-unread light haptic (debounced); empty inbox → Browse jobs/marketplace; empty thread → focus composer |
| **PostJob + CreateListing** | Submit/success/validation haptics; brand section “How it works”; glass gold CTAs; teaching success + View job/listing; market-voice copy |
| **Commerce secondary** | Feed / watchlist / my listings / my bids / orders / contracts / savings / providers / wishlist / notifications — LIVE pulse, mono prices, savings green hero, pay success haptic |
| **UITest / ScreenshotWalk** | Stable a11y ids (`home.*`, `jobs.*`, `marketplace.*`, payment/seller roots); catalog settle waits; critical money Account rows; build-for-testing green |
| **Web funnels** | JobPostingForm + ListingPostingForm + LegalIntakeForm: mono money, 44px CTAs, error banners, skeletons; typecheck pass |

### Wave 2 verification
| Gate | Result |
|------|--------|
| iOS `xcodebuild` Debug sim | **BUILD SUCCEEDED** (orchestrator after merge) |
| Web `npm run typecheck` | **pass** |
| UITest `build-for-testing` | **SUCCEEDED** (agent report) |

### New a11y ids (automation)
`home.hero`, `home.browseJobs`, `home.instantMatch`, `home.shopGoods`, `home.postJob`, `home.sellItem`, `home.marketDesk`, `home.stats`, `jobs.segment`, `jobs.filters`, `jobs.map`, `jobs.loading|list|empty|error`, `marketplace.loading|list|empty|error`, `paymentMethods.root`, `sellerPayouts.root`.

### Run smoke UITests
```bash
export DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer
xcodebuild test -scheme NoMarkup \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:NoMarkupUITests/NoMarkupUITests/testHomeHeroAndMarketDesk \
  -only-testing:NoMarkupUITests/NoMarkupUITests/testJobsBrowseSettles \
  -only-testing:NoMarkupUITests/NoMarkupUITests/testAccountCriticalMoneyRows \
  -only-testing:NoMarkupUITests/ScreenshotWalkUITests/test01CustomerCoreWalk
```

---

## 7. A → B → C execution (same day)

| Track | Result | Evidence |
|-------|--------|----------|
| **A** Device 3-role + money | **PASS** | Install + launch ×3; money API 0×500 — `device-dogfood-abc-2026-08-05.md` |
| **B** PostJob 4-step wizard | **PASS** | `BrandWizardStepChrome` + Basics/Pricing/Location/Review |
| **C** Full UITests seed | **PASS 16/0** | `TEST SUCCEEDED` ~39 min sim |

See [`device-dogfood-abc-2026-08-05.md`](./device-dogfood-abc-2026-08-05.md).

## 8. How to continue

1. Interactive device UI walk (Account money rows by hand).  
2. CreateListing multi-step wizard (mirror PostJob).  
3. Lightsail / production when founder resumes.

---

## 8. North-star scorecard delta

| Signal | Before Track A | After wave 2 |
|--------|----------------|--------------|
| Catalog first paint | Spinner gray | Gold skeleton desk |
| Bid price tick | Static number | Flash + haptic + numericText |
| Empty / error | Mixed | Brand seal + haptic CTA |
| Auth first impression | Flat gold | Showcase tagline hierarchy |
| Web money columns | Mixed fonts | Mono terminal board |
| Chat send | Mute | Gold armed send + haptics + debounced arrival |
| Post / sell funnel | Functional | Teaching success + validation thrills |
| Secondary commerce lists | Mixed | LIVE + mono money desk |
| Automation | Partial | Catalog settle + money Account ids |

**Product feel:** solid MVP dark shell → **terminal-grade dual-rail marketplace** with institutional feedback loops.
