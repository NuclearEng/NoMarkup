# iOS ↔ Web feature matrix

**Date:** 2026-07-26 (agent-team consumer E2E pass 2)  
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
| Auth email/password + logout | login, refresh, logout | **live** | Server logout on sign-out |
| Auth SIWA / register / forgot / MFA | apple/native, register, reset, mfa | **live** | + **Enable MFA** in Security |
| Change password / age status | change-password, age-status | **live** | `SecuritySettingsView` |
| Account / profile | users/me | **live** | + enable provider role |
| Post job / sell listing | POST jobs/listings | **live** | Photos + dollar money fields |
| Jobs browse/map/detail | jobs, map, bids, award | **live** | Reverse auction + owner close/cancel |
| Marketplace detail | listings, bids, bond, offers | **live** | + **similar listings** |
| Providers directory + profile | providers/* | **live** | Follow/unfollow + reviews |
| **Following / social feed** | me/follows, me/feed | **live** | `FollowingView`, `FeedView` |
| **User reviews** | users/{id}/reviews | **live** | `UserReviewsView` |
| Block / report | users block/report | **live** | |
| Properties | /properties | **live** | |
| Watchlist / wishlist / saved searches | me/* | **live** | |
| Seller analytics / payouts | seller-analytics, stripe | **live** | |
| Payment methods | payments/methods | **live** | |
| Orders escrow | orders/* | **live** | |
| Messages | channels/* | **live** | Poll + mark-read |
| Notifications + prefs + APNs | notifications/* | **live** | |
| Referrals + history | me/referrals | **live** | Share, redeem, history rows |
| **NPS feedback** | me/nps/* | **live** | `NPSSurveysView` |
| **Markets** | markets | **live** | `MarketsView` |
| **Savings** | users/me/savings | **live** | `SavingsView` |
| **Provider workspace lite** | providers/me/* | **live** | Bio, availability, streaks, licenses (not full OS) |
| Contracts lifecycle | contracts/* | **live** | Accept/start/complete/review/dispute |
| **Contract change orders / tip / guarantee / reports** | change-orders, tip, guarantee, noshow | **live** | `ContractDetailView` advanced |
| Photo upload | images/* | **live** | |
| Legal / support | — | **web-handoff** | Safari |
| Data export / delete | export, DELETE me | **live** | |
| Feature flags / offline | flags | **live** | Hard-offs + NetworkMonitor |
| Admin | /admin/* | **out of scope** | |
| StoreKit IAP | — | **out of scope** | Free-tier digital only |
| Regulated rails | BNPL, insurance, advances, legal, instant payout | **out of scope** | Hard-off |
| Full provider Business OS | team, tax, expenses, WC | **out of scope** | Lite workspace only |
| Google/Facebook OAuth | oauth | **not started** | SIWA + email |
| Chat / auction WebSocket | /ws/* | **partial** | REST polling |

---

## Architecture

```
iOS SwiftUI → URLSession → Go gateway → Postgres / services
Keychain JWT · APNs · MapKit · Stripe PaymentSheet (Rail A)
```

---

## Agent-team E2E batches shipped

1. Network/session harden + dollar bids + LIVE auction chrome  
2. Account hub: providers, properties, wishlist, blocks, referrals, security, prefs, cards, payouts  
3. Social (follows/feed/reviews/similar) · Contracts advanced · Provider workspace lite · Growth (NPS/markets/savings/MFA enable)  

---

## Intentionally remaining (non-blocking)

1. Native Google/Facebook OAuth  
2. Full WebSocket auction/chat  
3. Provider Business OS (employees, tax, expenses, advances)  
4. Admin console  
5. StoreKit digital subscriptions  
6. Regulated financial rails  
