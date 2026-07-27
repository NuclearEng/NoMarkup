# iOS ↔ Web feature matrix

**Date:** 2026-07-26 (updated after native create / escrow / watchlist pass)  
**Scope:** Native iOS app (`ios/NoMarkup`) vs product web (`web/`, zone `no-markup.com`).  
**Honesty rule:** status is measured against shipped native code + gateway routes, not roadmaps.

Legend:

| Status | Meaning |
|--------|---------|
| **live** | Native UI + gateway API (or local-only chrome) usable end-to-end in-app |
| **partial** | Native surface exists but subset of web (read-only, missing mutations, etc.) |
| **web-handoff** | Explicit SFSafariViewController / `LegalWebView` to production web URL |
| **not started** | No native entry; user must use web outside this shell |
| **out of scope** | Intentionally not in consumer iOS v1 |

---

## Matrix

| Web surface | Primary web path(s) | Gateway (if relevant) | iOS status | Notes |
|-------------|---------------------|------------------------|------------|--------|
| Home / marketing shell | `/` | — | **partial** | Product home (hero, live cards, native post/sell sheets) — not full marketing site |
| Auth — email/password | `/login` | `POST /api/v1/auth/login`, refresh | **live** | Keychain; **401 → refresh → retry**; cold restore via refresh token |
| Auth — Sign in with Apple | web OAuth + native | `POST /api/v1/auth/apple/native` | **live** | AuthenticationServices |
| Auth — register / MFA / reset | `/register`, MFA, forgot | auth routes | **not started** | Use web |
| Account session chrome | `/settings/*` | JWT claims | **partial** | Account tab + export/delete/watchlist/orders/bids/notifs; no full settings hub |
| **Post job (create)** | `/jobs/new` | `POST /api/v1/jobs` | **live** | `PostJobView` native form (Home + Account) |
| Browse jobs | `/jobs` | `GET /api/v1/jobs` | **live** | `JobsView` browse + search |
| My jobs | mine | `GET /api/v1/jobs/mine` | **live** | Jobs segment “Mine” |
| Job detail + reverse auction | `/jobs/{id}` | bids place/list | **live** | Bid + ladder + **Award** for owner (`POST …/bids/{bidID}/award`) |
| **Sell item (create listing)** | `/sell` | `POST /api/v1/listings` | **live** | `CreateListingView` native form |
| Marketplace browse | `/marketplace` | `GET /api/v1/listings` | **live** | `MarketplaceView` |
| Listing detail + bid / buy-now | `/marketplace/{id}` | bids, buy-now, report | **live** | Bid + buy-now + Apple Pay + report + **watch toggle** |
| My listing bids | — | `GET /api/v1/listings/bids/mine` | **live** | `MyBidsView` → Goods |
| My service bids | — | `GET /api/v1/bids/mine` | **live** | `MyBidsView` → Services |
| **Watchlist** | `/me/watchlist` | watch POST/DELETE, list | **live** | Heart on listing detail + `WatchlistView` |
| Orders (goods) | `/orders` | pay, confirm-pickup, seller-confirm | **live** | Pay + **buyer confirm pickup** + **seller confirm** |
| Messages inbox | `/messages` | channels | **live** | REST; no WebSocket |
| Chat thread send | `/messages/{id}` | messages GET/POST | **live** | Plain-text; no media |
| Notifications | bell | list, read, read-all, unread-count | **live** | Mark read / mark all / Account badge |
| Legal — privacy / terms / guidelines | `/privacy`, … | — | **web-handoff** | Safari (content pages; intentional) |
| Support | `/support` | — | **web-handoff** | Safari |
| Account data export | settings | `GET …/export` | **live** | Download + **share sheet** |
| Account deletion | settings | `DELETE /users/me` | **live** | `AccountDeletionView` |
| Feature flags | — | `GET /api/v1/flags` | **partial** | Fetch + hard-offs for regulated rails |
| Contracts / milestones UI | `/contracts` | contract service | **partial** | Award creates contract server-side; no full native contract workspace |
| Disputes | disputes UI | disputes APIs | **not started** | Use web |
| Reviews write | provider profiles | reviews APIs | **not started** | Use web |
| Seller analytics | sell dashboard | seller-analytics | **not started** | Use web |
| Best offer / counter | offers | offers APIs | **not started** | Use web |
| Saved searches | marketplace | saved-searches | **not started** | Watchlist only |
| Admin surfaces | `/admin/*` | admin | **out of scope** | Consumer app |
| StoreKit digital IAP | — | — | **out of scope** | Rail A physical GMV only |
| Maps / geo browse | Mapbox web | PostGIS map | **not started** | No Mapbox SDK yet |
| Push (APNs) | — | `POST /notifications/devices` | **not started** | Device register API exists; no APNs client |
| Photo upload / imaging | S3 presign | images API | **not started** | Create forms send empty `photo_urls` |

---

## Brand / design tokens

| Token area | Web | iOS |
|------------|-----|-----|
| Navy / gold terminal | `globals.css` brand + dark shell | `BrandTheme` navy / gold / elevated |
| App icon | champagne metal M↓ | AppIcon + `NoMarkupIcon` |
| Bid / trust chips | HSL tokens | `bidActive` / `bidWinning` / `warning` |

---

## Next slices (remaining)

1. **APNs** device registration + push handling  
2. **Maps** (MapKit first; Mapbox later if needed)  
3. **Contracts list / milestones** after award  
4. **Disputes + reviews write**  
5. **Best offer / saved searches**  
6. **Register / MFA / password reset** native  
7. **Photo upload** for jobs/listings  
8. Chat **WebSocket** realtime  

---

## Acceptance (this pass)

- [x] Native post job + create listing (no Safari for primary create)  
- [x] Notifications mark-read / mark-all / unread badge  
- [x] Orders confirm pickup + seller confirm  
- [x] Export share sheet  
- [x] Watchlist + listing heart  
- [x] Job owner award bid  
- [x] Token refresh on 401 + cold restore  
- [x] `xcodebuild` **BUILD SUCCEEDED** (iOS Simulator generic)  
- [x] Matrix updated honestly (admin/IAP/maps/APNs remain open or out of scope)  
