# iOS ↔ Web feature matrix

**Date:** 2026-07-26 (agent-team gap closure pass 3)  
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
| Auth (login, SIWA, register, MFA, logout) | auth/* | **live** | Enable MFA + server logout |
| Change password / age / ToS accept | change-password, age-status, tos | **live** | `TermsAcceptanceView` |
| Trust tiers | trust/tiers | **live** | `TrustTiersView` |
| Plan limits (read-only) | subscriptions/tiers | **live** | No in-app purchase; web-only paid digital copy |
| Post job / drafts / publish | jobs, drafts, publish | **live** | `JobDraftsView` + category tree |
| Jobs browse/map/detail/award | jobs/* | **live** | Reverse auction + owner close/cancel |
| Marketplace + autocomplete | listings, autocomplete | **live** | Typeahead + category filter |
| Category tree picker | categories/tree | **live** | `CategoryPickerView` on create forms |
| Fair price hint | analytics/fair-price | **live** | Soft hint on create |
| Sell listing | listings POST | **live** | Category picker + photos |
| Providers / follow / feed / reviews | providers, follows, feed | **live** | |
| Properties / watchlist / wishlist / saved | me/* | **live** | |
| Seller analytics / sales CSV / calendar ICS | seller-analytics, sales.csv, calendar.ics | **live** | Share sheet exports |
| Quote templates / verification docs | providers/me/* | **live** | |
| Stripe Connect / payment methods | stripe, payments | **live** | |
| Orders escrow | orders/* | **live** | |
| Messages / notifications / prefs / APNs | channels, notifications | **live** | |
| Referrals / NPS / markets / savings | me/referrals, nps, markets, savings | **live** | |
| Provider workspace lite | providers/me | **live** | Not full Business OS |
| Contracts advanced | contracts/* | **live** | Change orders, tip, guarantee, reports |
| Bid analytics (per job) | bids/analytics?job_id= | **live** | API wired for tools |
| Photo upload | images/* | **live** | |
| Legal / support | — | **web-handoff** | Safari |
| Data export / delete | export, DELETE me | **live** | |
| Feature flags / offline | flags | **live** | Hard-offs + NetworkMonitor |
| Admin | /admin/* | **out of scope** | |
| StoreKit IAP | — | **out of scope** | Free-tier digital only |
| Regulated rails | BNPL, insurance, advances, legal, instant payout | **out of scope** | Hard-off |
| Full provider Business OS | team, tax, expenses, WC | **out of scope** | Lite only |
| Google/Facebook OAuth | oauth | **not started** | SIWA + email |
| Chat / auction WebSocket | /ws/* | **partial** | REST polling |

---

## Architecture

```
iOS SwiftUI → URLSession → Go gateway → Postgres / services
Keychain JWT · APNs · MapKit · Stripe PaymentSheet (Rail A)
```

---

## Agent-team batches

1. Harden + dollar bids + LIVE auction chrome  
2. Account hub (providers, properties, wishlist, blocks, referrals, security, prefs, cards, payouts)  
3. Social · contracts advanced · provider workspace · growth  
4. **Catalog autocomplete/categories · job drafts · trust/ToS/plan limits · seller exports/templates**  

---

## Intentionally remaining (non-blocking)

1. Native Google/Facebook OAuth  
2. Full WebSocket auction/chat  
3. Provider Business OS (employees, tax, expenses, advances)  
4. Admin console  
5. StoreKit digital subscriptions  
6. Regulated financial rails  
