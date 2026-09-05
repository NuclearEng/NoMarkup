# Gap-close residuals — 2026-08-12-clean walk leftovers

Verify + finish pass. **No commit.** Tab-bar clearance, closed-listing bid gate, and retract `elapsed >= 0` were left as-is.

| Item | Status | File:line |
|------|--------|-----------|
| 1. Jobs Mine empty copy | **FIXED** | [`ios/NoMarkup/Features/JobsView.swift:348`](../../../ios/NoMarkup/Features/JobsView.swift) — provider Mine is “No awarded work” + browse-the-open-floor CTA (not customer “No jobs yet” / post-a-job). Customer-only empty copy unchanged. |
| 2. Home GOODS count | **FIXED** (already in tree; tightened) | [`ios/NoMarkup/Features/HomeView.swift:829`](../../../ios/NoMarkup/Features/HomeView.swift) — `listingTotal` binds to `pagination.resolvedTotal` (same catalog total Marketplace prints). Listings fetch `pageSize` now 100 to match Jobs. `liveOrPaginationTotal` remains the fallback if meta is missing. |
| 3. List vs detail bid counts | **FIXED** | Decoder was using nested `/bids` trail length on detail (`listing.bidCount = response.bids.count` / `bidEntries.count`) vs list `bid_count`. Shared [`CatalogBidCount`](../../../ios/NoMarkup/Core/Models.swift) + `resolvedBidCount` on list rows and detail chips. Snap-on-style 1-vs-7 was `bid_count`/`bidder_count` vs 7 outbid trail rows. |
| 4. Sign out confirm | **N/A** (already present) | [`ios/NoMarkup/Features/AccountView.swift:229`](../../../ios/NoMarkup/Features/AccountView.swift) + `confirmationDialog` at [`:890`](../../../ios/NoMarkup/Features/AccountView.swift) — “Sign out of this device?” |
| 5. Reverse-bid hint $400 / $250 | **N/A** (already present) | [`ios/NoMarkup/Features/JobDetailView.swift:2064`](../../../ios/NoMarkup/Features/JobDetailView.swift) — example is `reverseBidExampleDollars` at 80% of the real ceiling (start / leading / own bid). $250 start → `200.00`, not `400.00`. |

## Not rebuilt

Signed sim install was not run this pass. Visual recapture of Mine empty, Home GOODS, and list/detail bid chips needs the next install.

## Left alone (per brief)

- `brandTabBarClearance(80)`
- Listing `auctionAcceptsBids` / ended bid form gate
- Retract window `elapsed >= 0`
