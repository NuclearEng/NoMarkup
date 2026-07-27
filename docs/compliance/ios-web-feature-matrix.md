# iOS ↔ Web feature matrix

**Date:** 2026-07-26 (full product parity pass)  
**Scope:** Native iOS app (`ios/NoMarkup`) vs product web (`web/`, zone `no-markup.com`).  
**Honesty rule:** status is measured against shipped native code + gateway routes.

Legend:

| Status | Meaning |
|--------|---------|
| **live** | Native UI + gateway API usable end-to-end in-app |
| **partial** | Native surface exists but subset of web |
| **web-handoff** | Safari to production web (intentional for long-form legal content) |
| **out of scope** | Intentionally not in consumer iOS (admin console) |

---

## Matrix

| Web surface | Gateway | iOS status | Notes |
|-------------|---------|------------|--------|
| Home / product shell | — | **live** | LIVE auction cards, offline banner |
| Auth (login, SIWA, register, MFA, logout) | auth/* | **live** | Enable MFA + server logout |
| Change password / age / ToS accept | change-password, age-status, tos | **live** | `TermsAcceptanceView` |
| Trust tiers | trust/tiers | **live** | `TrustTiersView` |
| Plan limits (read-only) | subscriptions/tiers | **live** | No StoreKit IAP; web-only paid digital |
| Post job / drafts / publish | jobs, drafts, publish | **live** | Photos: library **+ camera** |
| Jobs browse/map/detail/award | jobs/* | **live** | Reverse auction + owner close/cancel |
| Marketplace + autocomplete | listings, autocomplete | **live** | Typeahead + category filter |
| Category tree picker | categories/tree | **live** | `CategoryPickerView` |
| Fair price hint | analytics/fair-price | **live** | Soft hint on create |
| Sell listing | listings POST | **live** | Photos: library **+ camera** |
| Providers / follow / feed / reviews | providers, follows, feed | **live** | |
| Properties / watchlist / wishlist / saved | me/* | **live** | |
| Seller analytics / sales CSV / calendar ICS | seller-analytics, sales.csv, calendar.ics | **live** | Share sheet exports |
| Quote templates / verification docs | providers/me/* | **live** | Camera + library document upload |
| Stripe Connect / payment methods | stripe, payments | **live** | |
| Orders escrow | orders/* | **live** | |
| Messages / notifications / prefs / APNs | channels, notifications | **live** | |
| Referrals / NPS / markets / savings | me/referrals, nps, markets, savings | **live** | |
| Provider workspace lite | providers/me | **live** | |
| Contracts advanced | contracts/* | **live** | Change orders, tip, guarantee, reports |
| Photo / camera upload | images/* | **live** | `PhotosPicker` + `UIImagePickerController` camera |
| **BNPL installments** | payments/installment-plans | **live** | `InstallmentsListView` + API; gated by `customer_bnpl` **server flag** (no iOS hard-off) |
| **Per-job insurance** | insurance/* | **live** | Policies + products browse; flag `per_job_insurance` |
| **Working capital advances** | providers/me/advances* | **live** | List, credit limit, repay; flag `working_capital` |
| **Instant payout** | payments/instant-payout* | **live** | Summary + request; flag `instant_payout` |
| **Expenses** | providers/me/expenses | **live** | Create/list/delete |
| **Tax center** | providers/me/tax-* | **live** | Forms list + estimate |
| Business & finance hub | — | **live** | `BusinessFeaturesHubView` (Account) |
| Feature flags | flags | **live** | Server-driven; `iOSHardOffKeys` empty |
| Legal / support | — | **web-handoff** | Safari |
| Data export / delete | export, DELETE me | **live** | |
| Admin | /admin/* | **out of scope** | |
| StoreKit IAP (digital subscription purchase) | — | **out of scope** | Free-tier read-only; web for paid digital |
| Google/Facebook OAuth | oauth | **not started** | SIWA + email |
| Chat / auction WebSocket | /ws/* | **live** (chat native WS + hybrid poll; job auction native WS + hybrid poll) / spectator WS residual | |

---

## Architecture

```
iOS SwiftUI → URLSession → Go gateway → Postgres / services
Keychain JWT · APNs · MapKit · Camera · Stripe PaymentSheet (Rail A)
```

---

## Policy change (2026-07-26)

Previous hard-offs for BNPL / insurance / advances / instant payout are **removed**.  
Rails are controlled by **server feature flags** + gateway `RequireFlag` (fail closed when off).  
App UI lives under **Account → Business & finance**.
