# iOS ↔ Web feature matrix

**Date:** 2026-08-02 (parity loop re-audit)  
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
| Google/Facebook OAuth | oauth + native | **live** (config-gated) | SIWA + Google native + Facebook native (App ID + FACEBOOK_* secrets) |
| Chat / auction WebSocket | /ws/* | **live** | Chat WS + hybrid poll; auction + spectator WS; FR-8.1 inquiry; FR-8.8 share-contact; PDF attach live |
| Instant payout (prod Stripe) | payments/instant-payout | **live** (flag-gated) | Gateway → payment service gRPC InstantPayout (no gateway `payout_dev_*` with live keys) |
| Bid ladder sort/filter | jobs bids | **live** | Price / trust / rating / volume + trust band + min jobs filters |
| Job schedule preference | jobs create | **live** | flexible / specific / range on iOS PostJob |
| Recurring auto-approve + rate | contracts recurring PATCH | **live** | iOS toggle + future rate |
| Tab unread badges | channels + notifications | **live** | Messages + Account tab badges |
| PDF verification + chat attach | images upload (document/chat_attachment) | **live** | Imaging PDF pass-through; iOS + web chat PDF |
| Facebook OAuth | auth/facebook/native | **live** (config-gated) | ASWebAuth + code exchange; needs FACEBOOK_* + App ID |
| Provider team / challenges | employees, challenges | **live** | EmployeesView + ChallengesView |
| Legal services | legal_services flag | **live** (flag-gated) | LegalServicesView when flag on |
| Job distance FR-10.7 | jobs search + lat/lng | **live** | `distance_km` when browse geo-scoped |

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
