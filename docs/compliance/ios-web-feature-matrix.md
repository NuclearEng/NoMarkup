# iOS ↔ Web feature matrix

**Date:** 2026-07-26 (hardening pass: network + session + seller mine)  
**Scope:** Native iOS app (`ios/NoMarkup`) vs product web (`web/`, zone `no-markup.com`).  
**Honesty rule:** status is measured against shipped native code + gateway routes.

Legend:

| Status | Meaning |
|--------|---------|
| **live** | Native UI + gateway API usable end-to-end in-app |
| **partial** | Native surface exists but subset of web |
| **web-handoff** | Safari to production web (intentional for long-form legal content) |
| **out of scope** | Intentionally not in consumer iOS |

---

## Matrix

| Web surface | Gateway | iOS status | Notes |
|-------------|---------|------------|--------|
| Home / product shell | — | **live** | Hero, live cards, native post/sell + offline banner |
| Auth email/password | login, refresh | **live** | Keychain + single-flight refresh + 401 retry + session-expired → login |
| Auth Sign in with Apple | apple/native | **live** | AuthenticationServices |
| **Auth register** | register | **live** | `RegisterView` |
| **Auth forgot / reset password** | request/reset password | **live** | `ForgotPasswordView` |
| **Auth MFA verify** | mfa/verify | **live** | Challenge on login → TOTP |
| Account chrome / profile | users/me | **live** | Profile settings, export, delete, **enable provider role** |
| Post job | POST /jobs | **live** | `PostJobView` + photos |
| Browse / mine jobs | jobs | **live** | |
| Job detail + reverse bid + award | bids, award | **live** | Owner award + **withdraw own bid** |
| **Jobs map** | GET /jobs/map | **live** | MapKit `JobsMapView` |
| Sell listing | POST /listings | **live** | `CreateListingView` + photos |
| Marketplace browse / detail | listings, bids, buy-now | **live** | + watch + best offer + **bid bond SetupIntent** + **60s retract** |
| **My listings (seller)** | listings/mine | **live** | `MyListingsView` + status filter |
| My bids (goods + services) | bids/mine, DELETE bids | **live** | + **withdraw service bid** |
| Watchlist | watch, me/watchlist | **live** | |
| Browse pagination | jobs/listings page | **live** | **Load more** on Jobs + Marketplace |
| **Saved searches** | me/saved-searches | **live** | `SavedSearchesView` |
| **Seller analytics** | me/seller-analytics | **live** | `SellerAnalyticsView` |
| Orders + escrow + dispute/no-show | orders/* | **live** | pay, confirm pickup, seller confirm, dispute, no-show |
| Messages + send | channels/messages, channels/{id}/read | **live** | REST + 5s poll + **mark channel read** |
| Job live auction state | jobs/{id}/auction/state | **partial** | 10s poll while active (ignore 404) |
| Notifications mark-read | notifications | **live** | mark one / all / badge |
| **APNs device register** | notifications/devices | **live** | `PushRegistration` + aps-environment |
| Legal / support content | — | **web-handoff** | Safari (policy pages) |
| Data export + share | export | **live** | Share sheet |
| Account deletion | DELETE me | **live** | |
| Feature flags | flags | **live** | Fetch + regulated hard-offs |
| **Contracts workspace** | contracts, milestones | **live** | list/detail accept/start/complete/approve/cancel/dispute/review/milestones |
| **Reviews write** | contracts/{id}/reviews | **live** | On completed contract |
| **Disputes open** | contracts/{id}/disputes | **live** | Contract detail |
| **Photo upload** | images/upload-url, confirm | **live** | `ImageUploader` on create job/listing |
| **Offline / network resilience** | — | **live** | `NetworkMonitor` banner + transport retries (GET/DELETE + no-response mutations) + friendly errors |
| Admin | /admin/* | **out of scope** | Consumer app |
| StoreKit digital IAP | — | **out of scope** | Rail A GMV only |
| Regulated rails (BNPL, insurance, advances, legal, instant payout) | flags | **out of scope** | Hard-off on iOS |
| Full provider business OS (team, tax, expenses) | providers/me/* | **out of scope** | Web / future |
| Chat WebSocket | /ws/chat | **partial** | Polling substitutes realtime |
| Auction spectator WS | /ws/auction/* | **not started** | REST auction state sufficient for v1 |
| Google/Facebook OAuth | oauth | **not started** | SIWA + email cover v1 |

---

## Architecture (native client)

```
iOS SwiftUI → URLSession → Go gateway → Postgres / services
Local: Keychain (JWT, AfterFirstUnlockThisDeviceOnly), no Firebase DB
Push: APNs → POST /notifications/devices
Maps: MapKit + GET /jobs/map
Network: NWPathMonitor banner + transport backoff (0.4s / 1.0s, max 2 retries)
Session: single-flight refresh; definitive 401 → .noMarkupSessionExpired → LoginView
```

---

## Acceptance (E2E consumer)

- [x] Register, login, MFA, password reset  
- [x] Dual-rail catalog create/browse/bid  
- [x] Watchlist, offers, saved searches, seller analytics  
- [x] Orders escrow + dispute/no-show  
- [x] Contracts lifecycle + reviews  
- [x] Map explore, photos on create, push register, profile  
- [x] Notifications mark-read + badge  
- [x] My listings + enable provider role + listing bid bond confirm  
- [x] Offline banner + transport retries + session expiry handoff  
- [x] Dual-profile API dogfood **37/37** on LAN gateway (`192.168.1.101:8081`)  
- [x] **BUILD SUCCEEDED** (iOS Simulator)  
- [x] Admin / StoreKit / regulated rails explicitly out of scope  

---

## Intentionally remaining (non-blocking for consumer E2E)

1. Native Google/Facebook OAuth  
2. Full WebSocket auction/chat (polling OK)  
3. Provider OS (employees, tax, WC)  
4. Mapbox polish (MapKit ships)  
5. Admin console  
