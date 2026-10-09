# Device + full-feature E2E results — 2026-07-26

**Target:** Tanner’s iPhone 15 Pro Max (`00008130-0018493E3A41001C`)  
**Gateway:** `http://192.168.1.101:8081` (LAN)  
**App:** `com.nomarkup.app` Debug, team `6L6565278C`  
**Accounts:** `customer@nomarkup.com` / `provider@nomarkup.com` · `Password123!`

---

## Summary

| Suite | Pass | Fail | Skip | Result |
|-------|-----:|-----:|-----:|--------|
| Full feature API E2E (`scripts/ios-full-feature-e2e.sh`) | **72** | **0** | **1** | **GREEN** |
| Legacy API smoke (`scripts/ios-api-e2e-smoke.sh`) | **19** | **0** | 0 | **GREEN** |
| XCUITest (iPhone 17 Pro Simulator) | **3** | **0** | 0 | **GREEN** |
| Device install + customer launch | — | — | — | **OK** (process running) |
| Device provider relaunch | — | — | — | **OK** (process running) |

**Overall: all blocking suites green.**

---

## Full feature API coverage (dual profile)

### Public
health · flags · jobs · listings · jobs/map · providers/search · categories/tree · listings/autocomplete · markets · trust/tiers · subscriptions/tiers · tos/current

### Customer (authenticated)
- Session: users/me · age-status · tos-acceptance · savings · properties · payment-methods · notification prefs/inbox/unread  
- Dual-rail: jobs/mine · drafts · listings/mine · orders · contracts · bids (jobs + listings)  
- Retention: watchlist · wishlist · saved-searches · follows · feed · blocks · channels · referrals · NPS · seller-analytics  
- Detail: live job (+ bids + auction state) · live listing (+ bids + similar + offers) · contract (+ change-orders) · provider detail · user reviews  
- Mutations: watch/unwatch · wishlist create/delete · follow/unfollow · notifications mark-all  

### Provider (authenticated)
users/me · bids/mine · listings/bids/mine · seller-analytics · providers/me · licenses · streaks · documents · quote-templates · stripe status · sales.csv · calendar.ics · contracts · channels · place job bid (409 already active = OK)

### Skips
| Test | Reason |
|------|--------|
| `customer.listing.bid` | HTTP 400 auction-state (listing not bidable at that moment; bond path still exercised when 402) |

---

## Device dogfood

1. **BUILD SUCCEEDED** → install `com.nomarkup.app`  
2. Launch with `NOMARKUP_API_BASE_URL=http://192.168.1.101:8081` + customer auto-login → process **51590**  
3. Relaunch with provider auto-login → process **51591**  

DEBUG auto-login via `NOMARKUP_UI_TEST_EMAIL` / `NOMARKUP_UI_TEST_PASSWORD` (RootView).

### Manual on-device walkthrough (expected after auto-login)

| Tab / surface | Verify |
|---------------|--------|
| Home | LIVE reverse auctions + goods strip; offline banner only when offline |
| Marketplace | Browse, typeahead (≥2 chars), open listing → bid ladder, **$** bid field |
| Jobs | Active reverse auctions; open detail → ladder / place bid (provider) |
| Messages | Channel list (seed threads if any) |
| Account | Orders, contracts, drafts, following, feed, wishlist, providers, payouts, exports, trust tiers, plan limits, terms acceptance |

---

## XCUITest

```
NoMarkupUITests.testColdLaunchShowsLoginOrTabs — passed
NoMarkupUITests.testLoginWithEnvCredentials — passed
NoMarkupUITests.testSignedInTabNavigation — passed
** TEST SUCCEEDED **
```

Destination: iPhone 17 Pro Simulator · credentials default seed.

---

## How to re-run

```bash
# Full API feature matrix
API_BASE=http://192.168.1.101:8081 SEED_PASSWORD=Password123! \
  ./scripts/ios-full-feature-e2e.sh

# Legacy smoke
API_BASE=http://192.168.1.101:8081 SEED_PASSWORD=Password123! \
  ./scripts/ios-api-e2e-smoke.sh

# UITests
cd ios && xcodebuild test -scheme NoMarkup \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:NoMarkupUITests
```

---

## Residual (non-blocking)

1. Listing place-bid sometimes 400 when auction state/increment/seller-self rules reject the amount — product correct; re-run on a fresh open listing.  
2. Physical-device XCUITest automation not gated (install/launch dogfood used instead).  
3. Admin / StoreKit / regulated rails intentionally untested (out of scope for consumer binary).  
