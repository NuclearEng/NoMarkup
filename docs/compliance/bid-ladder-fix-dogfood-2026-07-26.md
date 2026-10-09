# Bid ladder fix + dual-profile dogfood — 2026-07-26

## Bug

**Symptom (iOS):** Bid ladder shows  
`Could not decode response: The data couldn’t be read because it isn’t in the correct format.`

**Root cause:** `GET /api/v1/jobs/{id}/bids` returns:

```json
"trust_score": { "overall_score": 0.785, "tier": "trusted" }
```

or `null`. iOS modeled `trustScore` as `Double?`, so `JSONDecoder` failed the **entire** ladder when any row had an object.

## Fix

- `Models.swift`: `ProviderTrustScore` object; custom `JobBidEntry` decode accepts object | number | null
- Ignores `review_summary` variance
- `JobDetailView`: display `Trust · {tier or %}` via `displayTrust`

**Swift decode of live sample:** `DECODE_OK count=8` (1 row with trust object, 7 null).

## Customer dogfood (`customer@nomarkup.com`)

| Surface | HTTP | Notes |
|---------|------|--------|
| Login | 200 | |
| users/me | 200 | roles include customer |
| jobs public / mine | 200 | |
| **jobs/{id}/bids ladder** | **200** | **8 bids** on BidRace job |
| orders / contracts / notifications | 200 | |
| watchlist / saved-searches / channels | 200 | |
| listings + listing bids | 200 | |
| create offer | 201 | amount 8700¢ |

## Provider dogfood (`provider@nomarkup.com`)

| Surface | HTTP | Notes |
|---------|------|--------|
| Login | 200 | |
| bids/mine | 200 | |
| listings/bids/mine | 200 | winning listing bid present |
| seller-analytics | 200 | |
| jobs/{id}/bids (non-owner) | **403** | expected authz |
| place job bid | 422 | no open auctions in catalog |

## Device

- Installed build with fix; launched as customer with auto-login env.
- To switch provider: re-launch with `provider@nomarkup.com` env credentials.

## Residual (not ladder bugs)

- Listing auction bid may require **bid bond** (402) — business rule  
- No open service jobs for provider re-bid in seed  
- Apple Pay needs Stripe publishable key  
