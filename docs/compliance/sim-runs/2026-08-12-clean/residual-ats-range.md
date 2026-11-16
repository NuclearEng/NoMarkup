# Residual close — ATS Debug LAN + market-range honesty (2026-08-12-clean)

Not committed. Closes two leftovers from the clean sim run.

## A. Physical-device Debug LAN HTTP

Shipping `ios/NoMarkup/Info.plist` stays ATS-clean (`NSAppTransportSecurity` absent). Archive lint still fails if that dict reappears **in the Release plist only**.

Debug target now uses `ios/NoMarkup/Info-Debug.plist` — same keys as shipping, plus:

- `NSAppTransportSecurity` → `NSAllowsLocalNetworking=true` (no `NSAllowsArbitraryLoads`)
- `APIBaseURL` empty (no secrets, no committed LAN URL)

`INFOPLIST_FILE`: Debug `NoMarkup/Info-Debug.plist` · Release `NoMarkup/Info.plist`.

Device Debug can load `http://192.168.x.x:8081` (scheme env / `DevAPIBase` stamp). Release remains default HTTPS-only.

`scripts/ios-archive-lint.sh` lints the shipping plist only (does not grep all plists). It also checks the Debug/Release `INFOPLIST_FILE` split and that Info-Debug allows local networking with an empty `APIBaseURL`.

## B. SIM-UI.P8 market-range honesty

Home live-floor card already used `MarketRangeMath.reverseAuctionBand` (e.g. $250 start → $150–$250).

Job detail used a category-sample p25–p75 of other jobs’ starting bids (e.g. $287.50–$362.50 · 2 jobs) **above** this job’s $250 ceiling — a typical band the reverse-auction bidder cannot reach.

**Fix:** `MarketRangeMath.reachableInReverseAuction` hides a sample when `high > startingBid`. Job detail then falls through to the same reverse-auction band as Home. Real market/range + FPI index data are unchanged.

## Verify

```bash
bash scripts/ios-archive-lint.sh
```
