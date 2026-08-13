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

## Closed this residual pass

| Residual | Close |
|----------|--------|
| 0 message threads after wipe | `make seed` creates customer↔provider contract channel; GET /channels **1** |
| Empty inbox copy claimed bid opens a thread | Award / contract / explicit message only |
| Device Debug LAN HTTP vs shipping ATS | Debug `Info-Debug.plist` + `NSAllowsLocalNetworking`; Release plist still clean |
| Category sample above starting bid | Hide / fall back to reverse-auction band |
| Widget placeholder fake inventory | “No active bids”; Home refresh writes `WidgetBidSnapshotSync` |
| Live Activity silent on sim | DEBUG line only; `simctl` cannot enable LA |
| Browse-without-sign-in Account rows looked live | Scaffold disables money/account mutations |
| StoreKit / Checkr honesty | IAP banner “unavailable”; BGC flag-off never “Pass” |
| Admin remaining 14 sections | Real destinations + `admin.<slug>.root` + live 200 GETs |
| sim-tap missed AX screen | Prefers Simulator LCD AX frame |

## Still residual (cannot close in this repo)

| Item | Owner |
|------|--------|
| Widget not pinned on SpringBoard | device (user adds widget) |
| Live Activity on Lock Screen | user toggle on a Dynamic Island sim |
| SIWA / Face ID / Apple Pay sheet / real APNs | hardware + Apple / Stripe keys |
| Checkr **live** invitations | `CHECKR_API_KEY` + `background_checks` flag |
| StoreKit IAP on | `StoreKitEnabled` stays false (3.1.1 free-tier) |
| Off-session goods charge | `MARKETPLACE_OFFSESSION_*` founder env |
| Rotate `Password123!` git history | founder SEC-17 |
