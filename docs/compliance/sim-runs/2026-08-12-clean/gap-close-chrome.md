# Gap close — iOS chrome (2026-08-12 clean walks)

Targeted follow-up to the admin 17e / customer Pro Max walks. **No commit.**

## 1. Compact Home clip (`A10-home.png`)

- **Gap:** On iPhone 17e (~390×844) the floating tab capsule covered Market Desk chips and hid **LIVE NOW / GOODS LIVE / GATEWAY**. Pro Max (`C10-home.png`) already cleared those strips.
- **Change:** `HomeView` applies `brandTabBarClearance()` (80pt) so the last section is not painted under the capsule. On short phones (`UIScreen` height &lt; 880) hero padding, type, and stack spacing tighten so desk + stats sit above the tab bar on first paint. Pro Max layout is unchanged.
- **Not reverted:** LIVE NOW / desk / sell-sheet / tab-bar-visible work.

## 2. Jobs / Marketplace search pill blank until focus (`A20` / `A30`)

- **Gap:** iOS 26 `.searchable(prompt:)` on List surfaces rendered an empty grey capsule. Messages empty-state still showed “Search inbox”.
- **Change:** Replaced Jobs Browse + Marketplace system searchable with `BrandCatalogSearchField` (magnifying glass + always-visible prompt: “Search jobs” / “Search listings”). Submit still reloads (`jobs.search` / `marketplace.search`). Mine stays visible but disabled (“Search is browse-only”). Messages `.searchable` is untouched.

## 3. `home.browseJobs` AX (`TabAudit` WARN)

- **Gap:** Identifier lived on the gold CTA but sat inside the `home.hero` card, which flattened children. TabAudit found `home.hero` and missed `home.browseJobs`.
- **Change:** `home.hero` is now only the brand + copy block (`children: .contain`). CTA stack is a sibling. `home.browseJobs` remains on the Browse open jobs button. Outer card also uses `children: .contain` so the other `home.*` CTA ids stay in the tree.

## Files

- `ios/NoMarkup/Features/HomeView.swift`
- `ios/NoMarkup/Features/JobsView.swift`
- `ios/NoMarkup/Features/MarketplaceView.swift`
- `ios/NoMarkup/Core/BrandTheme.swift` (`BrandCatalogSearchField`)
