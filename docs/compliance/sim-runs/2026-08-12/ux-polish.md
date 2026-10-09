# UX polish — iOS chrome (2026-08-12)

Chrome + VoiceOver only. Does not revert 74c11ef4 (honest desk, sell sheet, tab inset, set-default).

## Files changed

| File | What |
|------|------|
| `ios/NoMarkup/Features/HomeView.swift` | Stats label honesty; CTA VoiceOver |
| `ios/NoMarkup/Core/MarketTickerView.swift` | Desk count says LIVE, not JOBS |
| `ios/NoMarkup/Features/JobsView.swift` | Closed-only pages drain; empty + Load more |
| `ios/NoMarkup/Features/MessagesView.swift` | `messages.row.{id}` on thread rows |
| `ios/NoMarkup/Features/AccountView.swift` | Tab-bar inset; `account.row.signOut` |
| `ios/NoMarkup/Features/MarketplaceView.swift` | Listing card LIVE / bid / countdown chrome |
| `ios/NoMarkupUITests/ScreenshotWalkUITests.swift` | Sign-out id map |
| `ios/NoMarkupUITests/NoMarkupUITests.swift` | Sign-out id map |

## Before / after

### Home — stats honesty
- **Before:** Stats cell labeled `JOBS` while the value was live-status count (catalog mix implied). Market desk suffix `JOBS` same lie.
- **After:** Cell label `LIVE NOW`; desk suffix `LIVE`; VoiceOver “N live now”. Matches Jobs Browse open-floor language.

### Jobs Browse — closed rows
- **Before:** Client filter dropped Closed cards, but a closed-first page painted empty with no Load more (or looked like a dead floor).
- **After:** Drain up to 8 pages until an open row lands. If only Closed remain and `hasNext`, list stays up with “Open floor” + Load more (`jobs.browse.drainEmpty`). True empty only when no next page. Header is `N open`, not `N of mixed catalog`.

### Messages — XCUI thread rows
- **Before:** Inbox rows had no stable id; XCUI could not open a thread by identifier.
- **After:** Each row `messages.row.{channel.id}` (stack + split).

### Account — inset + ids
- **Before:** Last hub rows sat under the iOS 26 floating tab capsule (SIM-UI.7 / same family as JobDetail). Sign out had no `account.row.*`.
- **After:** `.safeAreaInset(edge: .bottom)` 28pt (JobDetailView pattern). Sign out: `account.row.signOut` + label/hint. Existing NavigationLink `account.row.*` ids unchanged.

### Marketplace listing cards
- **Before:** LIVE, Bid up, status, condition, category, bids, and countdown shared two wrapping HStacks; countdown competed with title/meta.
- **After:** Dedicated chrome row: glass `LIVE`/`GOODS` chip + Bid up + bid count + live countdown chip (Home listing-card pattern). Title/price on the next row. Combined VoiceOver summary.

### VoiceOver — icon-only / CTAs
- **Before:** Home sell / view-all / marketplace chevrons were unlabeled or decorative-in-label; Account Sign out relied on button title only.
- **After:** Home sell, view-all, browse-marketplace labeled + hinted; decorative chevrons `accessibilityHidden`. Messages attach/camera/PDF/send and conversation menu already labeled (spot-check held). Sign out explicit label + hint.

## Not changed
- 74c11ef4 desk/sell-sheet/tab-inset/set-default behavior
- Brand tokens / new design system
- Gateway browse `status=` (still client filter + drain)
