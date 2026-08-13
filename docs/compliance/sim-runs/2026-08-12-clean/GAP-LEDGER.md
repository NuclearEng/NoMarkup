# Gap close-out — 2026-08-12-clean

After wipe + re-seed + agent teams.

## Closed (engineering)

| Gap | Close |
|-----|--------|
| Stale gateway 404 work-evidence / RUM | Rebuilt `.dev/bin/gateway` |
| Set-default 501 | Restarted payment service; PUT **200** |
| Admin chip strip invisible | Section menu in `ParitySurfacesView` |
| Tab bar lost after Following | `keepRootTabBarVisible` + LazyView |
| Home 20 GOODS vs 49 lots | `listingTotal` = pagination total |
| Public jobs ignore `status=` | `SearchJobsRequest.status_filter` + iOS `status=open` |
| Search pill blank on iOS 26 | `BrandCatalogSearchField` |
| Compact Home clip | `brandTabBarClearance` + tighter 17e hero |
| Closed listing still bidable | `placeBidSection` gated |
| Retract (35,391s) | `elapsed >= 0` |
| Bid hint $400 on $250 start | 80% of ceiling |
| Jobs Mine customer copy on provider | “No awarded work” |
| List vs detail bid counts | `CatalogBidCount.resolvedBidCount` |
| UITest admin capsule skips | Section menu picker |
| Customer `account.row.admin` skip | Assert absent |

## Verify shot

`C00-home-verify.png` / `A00-home-verify.png`: **3 LIVE NOW · 35 GOODS LIVE · LIVE**; HVAC $500 fully readable; LEGAL $250 1× after provider bid.

`GET /jobs?status=open` → 3 active; `status=closed` → 0.

## Still residual (not product FAIL)

| Item | Owner |
|------|--------|
| Widget / Live Activity not on SpringBoard | device |
| SIWA / Face ID / Apple Pay / APNs | device / founder |
| Checkr / StoreKit / off-session | flags / founder |
| ATS: no LAN HTTP on physical device | use HTTPS tunnel |
| Customer 0 message threads on this seed | empty-state PASS |
| Not every admin section list opened | menu-reachable; Fees/Users/Banking/Fraud/Markets/Platform APIs 200 |
