# iOS ↔ Web feature matrix

**Date:** 2026-07-26 (full consumer feature pass)  
**Scope:** Native iOS app (`ios/NoMarkup`) vs product web (`web/`, zone `no-markup.com`).  
**Honesty rule:** status is measured against shipped native code + gateway routes.

Legend:

| Status | Meaning |
|--------|---------|
| **live** | Native UI + gateway API usable end-to-end in-app |
| **partial** | Native surface exists but subset of web |
| **web-handoff** | Safari to production web (intentional for long-form legal content) |
| **out of scope** | Intentionally not in consumer iOS (App Store / compliance cut) |

---

## Matrix

| Web surface | Gateway | iOS status | Notes |
|-------------|---------|------------|--------|
| Home / product shell | — | **live** | LIVE auction cards, offline banner |
| Auth email/password | login, refresh | **live** | Keychain + single-flight refresh + session expiry |
| Auth Sign in with Apple | apple/native | **live** | AuthenticationServices |
| Auth register / forgot / MFA | register, reset, mfa/verify | **live** | |
| Change password | auth/change-password | **live** | `SecuritySettingsView` |
| Age status | me/age-status | **live** | Display verified badge |
| Account / profile | users/me | **live** | Profile edit + enable provider role |
| Post job | POST /jobs | **live** | + photos; `auction_type=live` |
| Browse / mine jobs | jobs | **live** | LIVE reverse-auction rows |
| Job detail + reverse bid + award | bids, award | **live** | Dollar bids + ladder + owner close/cancel |
| Jobs map | GET /jobs/map | **live** | MapKit |
| Providers directory + profile | providers/search, providers/{id} | **live** | `ProvidersView` / `ProviderDetailView` |
| Block / unblock / report user | users/{id}/block, report | **live** | Provider detail + `BlockedUsersView` |
| Properties (service addresses) | /properties | **live** | `PropertiesView` CRUD list |
| Sell listing | POST /listings | **live** | Dollar prices + photos |
| Marketplace browse / detail | listings, bids, buy-now | **live** | Bid ladder, bond, retract, offers, cancel listing |
| My listings | listings/mine | **live** | |
| My bids | bids/mine | **live** | + withdraw |
| Watchlist | me/watchlist | **live** | |
| Wishlist / price alerts | me/wishlist | **live** | `WishlistView` |
| Saved searches | me/saved-searches | **live** | |
| Seller analytics | me/seller-analytics | **live** | |
| Seller payouts (Stripe Connect) | providers/me/stripe/* | **live** | `SellerPayoutsView` |
| Payment methods | payments/methods | **live** | Manage/delete cards |
| Orders + escrow | orders/* | **live** | Pay, pickup, dispute, no-show |
| Messages | channels/* | **live** | Poll + mark read |
| Notifications inbox | notifications | **live** | Mark read + badge |
| Notification preferences | notifications/preferences | **live** | `NotificationPreferencesView` |
| APNs | notifications/devices | **live** | |
| Referrals | me/referrals/* | **live** | Share + redeem |
| Contracts + reviews + disputes | contracts/* | **live** | Full lifecycle |
| Photo upload | images/* | **live** | |
| Legal / support | — | **web-handoff** | Safari for long-form legal |
| Data export / delete | export, DELETE me | **live** | |
| Feature flags | flags | **live** | + iOS hard-offs |
| Offline / retries | — | **live** | NetworkMonitor + transport backoff |
| Admin | /admin/* | **out of scope** | Never in consumer binary |
| StoreKit IAP | — | **out of scope** | Free-tier digital; Rail A Stripe only |
| Regulated rails | BNPL, insurance, advances, legal, instant payout | **out of scope** | Hard-off flags |
| Full provider Business OS | team, tax, expenses | **out of scope** | Web / future |
| Google/Facebook OAuth | oauth | **not started** | SIWA + email cover v1 |
| Chat / auction WebSocket | /ws/* | **partial** | REST polling substitutes |

---

## Architecture

```
iOS SwiftUI → URLSession → Go gateway → Postgres / services
Keychain JWT · APNs · MapKit · Stripe PaymentSheet (Rail A)
```

---

## Intentionally remaining (non-blocking)

1. Native Google/Facebook OAuth  
2. Full WebSocket auction/chat (polling OK for v1)  
3. Provider Business OS (employees, tax, expenses)  
4. Admin console (web-only)  
5. StoreKit digital subscriptions (compliance cut)  
6. Regulated financial rails (flag-off until licenses)  
