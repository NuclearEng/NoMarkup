# iOS ↔ Web feature matrix

**Date:** 2026-07-26  
**Scope:** Native iOS app (`ios/NoMarkup`) vs product web (`web/`, zone `no-markup.com`).  
**Honesty rule:** this is **not** 100% parity. Status is measured against shipped native code + gateway routes, not roadmaps.

Legend:

| Status | Meaning |
|--------|---------|
| **live** | Native UI + gateway API (or local-only chrome) usable end-to-end in-app |
| **partial** | Native surface exists but subset of web (read-only, missing mutations, etc.) |
| **web-handoff** | Explicit SFSafariViewController / `LegalWebView` to production web URL |
| **not started** | No native entry; user must use web outside this shell |

---

## Matrix

| Web surface | Primary web path(s) | Gateway (if relevant) | iOS status | Notes |
|-------------|---------------------|------------------------|------------|--------|
| Home / marketing shell | `/` | — | **partial** | Product home: reverse-auction hero, live job cards, goods strip, post/sell handoffs — not full marketing site |
| Auth — email/password | `/login` | `POST /api/v1/auth/login`, refresh | **live** | Keychain tokens; scaffold session for offline chrome |
| Auth — Sign in with Apple | web OAuth + native | `POST /api/v1/auth/apple/native` | **live** | AuthenticationServices |
| Account session chrome | `/settings/*` | `GET` claims via JWT | **partial** | Account tab; no full settings hub |
| Post job (create) | `/jobs/new` | `POST /api/v1/jobs` (not wired) | **web-handoff** | Home + Account → Safari `jobs/new` |
| Browse jobs | `/jobs` | `GET /api/v1/jobs` | **live** | `JobsView` browse + search |
| My jobs | `/jobs` (mine) | `GET /api/v1/jobs/mine` | **live** | Jobs segment “Mine” |
| Job detail + reverse auction | `/jobs/{id}` | `GET …/jobs/{id}`, `POST …/bids`, `GET …/bids` | **partial** | Hero, countdown, place reverse bid (+ Idempotency-Key), ladder for owner; award/contract on web |
| Listing bid ladder | marketplace detail | `GET …/listings/{id}/bids` | **live** | Public ladder + place bid with Idempotency-Key |
| Sell item (create listing) | `/sell` | `POST /api/v1/listings` (not wired) | **web-handoff** | Home + Account → Safari `/sell` |
| Marketplace browse | `/marketplace` | `GET /api/v1/listings` | **live** | `MarketplaceView` |
| Listing detail + bid / buy-now | `/marketplace/{id}` | bids, buy-now, report | **partial** | Bid + buy-now + Apple Pay path; no offers/watch native |
| My listing bids | account / listing UI | `GET /api/v1/listings/bids/mine` | **live** | `MyBidsView` → Goods |
| My service bids | provider dashboard | `GET /api/v1/bids/mine` | **live** | `MyBidsView` → Services |
| Orders (goods) | `/orders` | `GET /api/v1/me/orders`, pay | **partial** | `MyOrdersView` + Rail A pay; no full escrow handshake UI |
| Messages inbox | `/messages` | `GET /api/v1/channels` | **live** | `MessagesView` |
| Chat thread send | `/messages/{id}` | messages GET/POST | **live** | Plain-text bubbles; web open affordance |
| Notifications | `/notifications` (or bell) | `GET /api/v1/notifications` | **partial** | Read-only list; no mark-read / prefs / APNs register |
| Legal — privacy / terms / guidelines | `/privacy`, `/terms`, … | — | **web-handoff** | `LegalWebView` (Safari) |
| Support | `/support` | — | **web-handoff** | Account legal section |
| Account data export | settings | `GET /api/v1/users/me/export` | **partial** | Bytes confirmed; share sheet follow-up |
| Account deletion | settings | `DELETE /api/v1/users/me` | **live** | `AccountDeletionView` + grace copy |
| Feature flags | admin / client | `GET /api/v1/flags` | **partial** | Client fetch exists; few native gates |
| Contracts / milestones | `/contracts` | contract service | **not started** | Use web |
| Disputes | disputes UI | `/api/v1/disputes` | **not started** | Use web |
| Reviews write | provider profiles | reviews APIs | **not started** | Public review read not in iOS list UIs |
| Seller analytics | sell dashboard | `GET /api/v1/me/seller-analytics` | **not started** | |
| Watchlist / saved searches | marketplace | `/me/watchlist`, saved searches | **not started** | |
| Best offer / counter | listing offers | offers APIs | **not started** | |
| Admin surfaces | `/admin/*` | admin routes | **not started** | Out of scope for consumer app |
| StoreKit digital IAP | — | — | **not started** | Intentionally omitted (Rail A physical GMV) |
| Maps / geo browse | Mapbox web | PostGIS jobs map | **not started** | No Mapbox native shell yet |
| Push (APNs) | — | `POST /notifications/devices` | **not started** | Device register API exists server-side |

---

## Brand / design tokens

| Token area | Web | iOS |
|------------|-----|-----|
| Navy / gold terminal | `globals.css` brand + dark shell | `BrandTheme` navy / gold / elevated |
| Bid active / leading | `--bid-active` / trust-elite blue | `bidActive` / `bidLeading` |
| Bid winning / savings | `--bid-winning` / trust-high green | `bidWinning` / `savings` |
| Warning | `--trust-medium` amber | `warning` |
| Raised surface | elevated card tokens | `surfaceRaised` |
| Gold CTA label | dark text on gold | `ctaLabelOnGold` = navy (contrast) |
| Hero mesh | gold gradients on marketing | `gradientHero` + `brandCard(heroGradient:)` |

---

## Next slices (recommended order)

1. **Native post-job / sell wizards** (or authenticated WKWebView with shared session) to reduce Safari handoff friction.
2. **Notifications mark-read + unread badge** on Account/tab (`POST …/read`, unread-count).
3. **APNs device registration** behind a feature flag.
4. **Watchlist + outbid surfaces** using existing listing bid history.
5. **Contracts / escrow confirmation** for goods pickup handshake.
6. **Maps** for local 25 mi marketplace when location permission UX is product-ready.
7. Share sheet for data export; deep links (`nomarkup://` / universal links) into job/listing detail.

---

## Acceptance for this PR

- Semantic auction colors live in `ios/NoMarkup/Core/BrandTheme.swift` without breaking existing consumers.
- Create entry points are **labeled web handoffs**, not silent WKWebView shells of the whole site.
- My bids + notifications lists call verified gateway paths only.
- Chat bubbles: outgoing gold + navy text; incoming `surfaceRaised` + blue border.
- Matrix stays honest: **partial / web-handoff / not started** remain majority outside catalog + auth core.
