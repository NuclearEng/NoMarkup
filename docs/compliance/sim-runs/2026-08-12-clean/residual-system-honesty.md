# Residual system honesty — 2026-08-12-clean

Code-honest close for widget snapshot, Live Activity, browse-only, StoreKit, and Checkr. **No commit.** Hardware/sim limits are documented, not faked.

## 1. Widget snapshot (Home / My Bids / placeholders)

**Before:** `RootView` wrote `WidgetSharedStore` on signed-in launch. `MyBidsView` wrote the visible rail after fetch. `HomeView` did not. WidgetKit `placeholder` painted fake inventory (“Kitchen remodel”, count `3`; “Vintage amp — local pickup”, `$240`).

**Now:**

| Path | Behavior |
|------|----------|
| Cold launch / sign-in | `WidgetBidSnapshotSync.refreshFromAPI()` (same as before, extracted) |
| Home first paint + pull-to-refresh | Same sync when `isAuthenticated && !isScaffoldSession` |
| My Bids Goods / Services | `applyGoods` / `applyServices` — one rail, other rail kept |
| Bid / retract / Live Activity | Still `recordActiveAuction` / `removeAuction` |
| Sign-out | `WidgetSharedStore.clear()` (unchanged) |

Placeholders and empty timeline copy are **“No active bids”** with count `0` / amount `—`. Gallery and first paint no longer look like a live auction.

**Residual:** Widget not pinned on SpringBoard in this sim pass (device/operator). Timeline is empty-honest until the user adds the widget. Service `GET /bids/mine` still has no `auction_ends_at`; job Next Closing rows only appear from a Live Activity / bid-path `recordActiveAuction`.

## 2. Live Activity

`AuctionLiveActivityController.startOrUpdate` is still called on job and listing bid. It already no-ops when `ActivityAuthorizationInfo().areActivitiesEnabled` is false.

**Sim enable:** All listed iPhones were **Shutdown**. `simctl` has no Live Activity privacy/UI subcommand (`help` + `help ui` checked). There is no supported `defaults` / `simctl spawn` switch to force ActivityKit on. Residual is **hardware / Simulator Settings → Face ID & Passcode → Live Activities** (and a Dynamic Island device). `NSSupportsLiveActivities` is already `true` in app + widget Info.plists.

**Honesty:**

- No-op path sets DEBUG-only `debugUnavailableReason = "Live Activity unavailable"`.
- Job / listing bid success appends that one line in **DEBUG only**.
- Release stays a silent no-op.
- Push-token hex is never logged (register and drop).

## 3. Browse without signing in (`enterScaffoldSession`)

Login CTA **Browse without signing in** still calls `enterScaffoldSession()` (local chrome, no tokens).

**Public (still live):** Home catalog, Jobs **Browse**, Marketplace list/detail, Providers, Markets, Fair price index, Marketplace map, Trust tiers, Plan limits (read-only), Feature flag status, legal/support links.

**Account-only rows now `.disabled` in scaffold / signed-out** (look disabled, not tappable-into-401):

Post a job, Sell an item, Orders, Contracts, My bids, My listings, Watchlist, Saved searches, Seller analytics, Legal services, Notifications, Delete Account — plus the rows that were already gated (profile, workspace, security, drafts, finance, team, etc.).

Destinations that can still be reached from Home sheets keep their existing **Sign in required** empty states (`PostJobView`, `CreateListingView`). Messages / Jobs Mine already empty-state. `AccountDeletionView` shows a sign-in row and disables submit.

**Not claimed:** A signed rebuild + LCD walk of browse-only was not run in this pass (sims shutdown).

## 4. StoreKit / Checkr

**StoreKit:** `AppConfig.storeKitEnabled` remains **false**. `PlanLimitsView` still hides Subscribe / Restore. Off-state banner is now **“In-App Purchase unavailable”** (`planLimits.iapUnavailable`) — not a dead tap.

**Checkr:** `VerificationCenterView` reads `FeatureFlags.background_checks`. Flag **off** → empty copy “Background checks unavailable… never invents a PASS” (`verification.backgroundCheck.unavailable`). No Request / Refresh / status badge. Flag **on** → existing server status only (`Clear` / `Pending` / … — never “Pass”). Load is skipped when the flag is off.

## Files

- `ios/NoMarkup/NoMarkupApp.swift` — `WidgetBidSnapshotSync`
- `ios/NoMarkup/Features/HomeView.swift` — refresh store after catalog
- `ios/NoMarkup/Features/MyBidsView.swift` — shared apply helpers
- `ios/NoMarkupWidget/ActiveBidsWidget.swift`, `NextClosingWidget.swift` — honest placeholders
- `ios/NoMarkup/Core/AuctionLiveActivityController.swift` — DEBUG no-op reason; no token logs
- `ios/NoMarkup/Features/JobDetailView.swift`, `ListingDetailView.swift` — DEBUG one-liner
- `ios/NoMarkup/Features/AccountView.swift` — remaining account-only rows disabled
- `ios/NoMarkup/Features/VerificationCenterView.swift` — flag-off empty state
- `ios/NoMarkup/Features/PlanLimitsView.swift` — IAP unavailable copy
- `ios/NoMarkup/Features/LegalServicesView.swift`, `AccountDeletionView.swift` — scaffold gates
- `ios/NoMarkupTests/WidgetSharedStoreTests.swift` — applyGoods / applyServices
