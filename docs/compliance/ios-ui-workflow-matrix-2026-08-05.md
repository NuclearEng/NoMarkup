# iOS UI workflow matrix — Account + root tabs

**Date:** 2026-08-05  
**Source of truth (UI):** [`ios/NoMarkup/Features/AccountView.swift`](../../ios/NoMarkup/Features/AccountView.swift), [`RootTabView.swift`](../../ios/NoMarkup/Features/RootTabView.swift)  
**API mapping:** `ios/NoMarkup/Core/APIClient*.swift` path comments + destination view loaders  
**API suite:** [`scripts/ios-full-feature-e2e.sh`](../../scripts/ios-full-feature-e2e.sh)  
**UI automation:** [`NoMarkupUITests.swift`](../../ios/NoMarkupUITests/NoMarkupUITests.swift), [`ScreenshotWalkUITests.swift`](../../ios/NoMarkupUITests/ScreenshotWalkUITests.swift)

---

## Honesty rules (read first)

| Claim | Reality |
|-------|---------|
| **Not** “100% UI automated” | UITests do **not** exercise every Account row mutation, payment sheet, camera, or deep contract lifecycle. |
| **API e2e** | Hits gateway routes the app uses. Proves backend contract readiness for dual seed profiles. Does **not** prove SwiftUI navigation, share sheets, Stripe PaymentSheet, or AX. |
| **UITest smoke** (`NoMarkupUITests`) | Cold launch → login/auto-login → **tab bar only** (Home / Marketplace / Jobs / Messages / Account). No row-level Account walk. |
| **Screenshot walk** (`ScreenshotWalkUITests`) | Real login form (no DEBUG auto-login). Opens a **subset** of Account rows for screenshots; records `WALK-SKIP` when a row is missing/lazy. Does **not** submit money or delete account. |
| **Device auto-login** | DEBUG launch with `NOMARKUP_UI_TEST_EMAIL` / `NOMARKUP_UI_TEST_PASSWORD` (or `DEVICECTL_CHILD_*`). Proves signed-in shell + process live. **Not** a full touch walkthrough of every list row. |
| **Manual residual** | Anything requiring human judgment, system sheets, flag-on money rails, camera/permissions, or multi-party escrow handshake. Marked residual — **not** treated as test “failures.” |
| **Admin on iOS** | **No admin console.** Admin seed gets the same 5-tab consumer shell; iOS has no `isAdmin` gated product UI. |

### Verification legend

| Tag | Meaning |
|-----|---------|
| **API e2e** | Covered by `ios-full-feature-e2e.sh` (or soft-skip 404/501/503 as optional/gated). |
| **UITest smoke** | `NoMarkupUITests` (tabs / login only). |
| **Screenshot walk** | `ScreenshotWalkUITests` opens the surface (or skips with reason). |
| **Device launch** | Physical/sim install + auto-login or dogfood process start (session shell). |
| **Manual residual** | Needs human (or not automated); gap is residual coverage, not a red suite. |

---

## Root tabs (signed-in shell)

| Role | UI surface | Expected API (primary load) | How verified |
|------|------------|-----------------------------|--------------|
| all (auth) | **Tab · Home** | `GET /health`; `GET /api/v1/jobs?page&page_size`; `GET /api/v1/listings?page&page_size` | API e2e (`health`, `jobs.public`, `listings.public`); UITest smoke tab; Screenshot walk home; Device launch |
| all | **Tab · Marketplace** | `GET /api/v1/listings…`; autocomplete `GET /api/v1/listings/autocomplete?q=` | API e2e (`listings.public`, `listings.autocomplete`); UITest smoke; Screenshot walk listing detail subset; Device launch |
| all | **Tab · Jobs** | `GET /api/v1/jobs…`; detail/auction when opened | API e2e (`jobs.public`, job detail/auction/bids when owned); UITest smoke; Screenshot walk job bid UI (provider); Device launch |
| all (auth) | **Tab · Messages** | `GET /api/v1/channels?page&page_size` (+ messages/read on open) | API e2e (`customer.channels`, `provider.channels`); UITest smoke; Screenshot walk empty Messages (customer2); **Manual residual:** send/WS fan-out |
| all (auth) | **Tab · Account** | On appear: `GET /api/v1/users/me` (Finish setup banner); `GET /api/v1/notifications/unread-count`; JWT/local user id | API e2e (`users/me`, `notifications.unread`); UITest smoke tab.account; Screenshot walk account root top/mid/bottom; Device launch |
| all (auth) | Tab badges (Messages / Account) | `GET /api/v1/channels…` + unread-count aggregation | API e2e channels + unread; **Manual residual:** badge after mark-read in UI |

Scaffold / unauthenticated: create/browse public catalog still works where allowed; authenticated Account rows stay disabled when `isScaffoldSession` or not signed in.

---

## Account — load / chrome (not a row destination)

| Role | UI surface | Expected API | How verified |
|------|------------|--------------|--------------|
| all (auth) | Account root · session labels / user id | Local JWT (`currentUserID`); optional email from JWT if Auth VM empty | Device launch / Screenshot walk; **not** a dedicated e2e assert beyond login |
| all (auth, incomplete profile) | **Finish setup** banner → `OnboardingWizardView` sheet | `GET /api/v1/users/me`; wizard: `PATCH /api/v1/users/me`, `POST …/auth/send-phone-otp`, `POST …/auth/verify-phone`, `POST /api/v1/users/me/roles` (provider) | API e2e `users/me`; **Manual residual:** full wizard touch + OTP |
| all | Market wiring (API desk / Stripe / Apple Pay labels) | Config only (`AppConfig`) — no HTTP | Code review / Device launch config |
| all (auth) | Push status / open Settings / request permission | APNs register: `POST /api/v1/notifications/devices` (elsewhere on auth); Account buttons open system Settings or local request | **Manual residual** (system dialogs); unregister on sign-out covered in app code paths |
| all (auth) | Unread badge on Notifications row | `GET /api/v1/notifications/unread-count` | API e2e `customer.notifications.unread` |

---

## Account · Session

| Role | UI surface | Expected API | How verified |
|------|------------|--------------|--------------|
| all (auth) | **Profile settings** → `ProfileSettingsView` | `GET/PATCH /api/v1/users/me`; optional `POST /api/v1/users/me/roles` (enable provider) | API e2e `users/me`; Screenshot walk `Profile settings`; **Manual residual:** save display name / role enable |
| provider (+ dual-role) | **Provider workspace** → `ProviderWorkspaceView` | `GET /api/v1/users/me`; `GET/PATCH /api/v1/providers/me`; streaks `GET …/providers/me/streaks`; licenses `GET/POST …/licenses`; terms/portfolio/availability/categories `PUT …/me/*` | API e2e `provider.profile.me`, licenses, streaks; Screenshot walk `Provider workspace`; **Manual residual:** edit bio/portfolio/availability |
| provider | **Instant offers** → `ProviderInstantOffersView` | `GET /api/v1/users/me`; `GET /api/v1/providers/me`; `GET /api/v1/provider/offers`; accept/decline `POST …/provider/offers/{jobId}/accept|decline` | **Not** in `ios-full-feature-e2e.sh` → residual for API suite; Screenshot walk opens list; **Manual residual:** accept/decline race |
| all (auth) | **Security** → `SecuritySettingsView` | `GET /api/v1/me/age-status`; `GET /api/v1/users/me`; `PUT /api/v1/me/dob`; `POST /api/v1/auth/change-password`; MFA enable/verify-setup/disable; OAuth list/unlink `GET|DELETE /api/v1/users/me/oauth-accounts…`; passkeys register (auth) | API e2e `age-status` only; Screenshot walk Security; **Manual residual:** MFA, password change, DOB, OAuth unlink, passkeys |
| all (incl. scaffold-limited) | **Verify email & phone** → `VerificationCenterView` | Resend email `POST /api/v1/auth/resend-verification`; verify email token; phone OTP send/verify; provider BGC `GET|POST /api/v1/providers/me/background-check` | **Not** full e2e paths → residual; Screenshot walk opens; **Manual residual:** real OTP/email |
| all (auth) | **Sign out** | Best-effort `POST /api/v1/auth/logout`; device unregister `DELETE /api/v1/notifications/devices/{token}`; keychain clear | Screenshot walk sign-out between roles; **Manual residual:** next-user push inheritance check |

---

## Account · Create

| Role | UI surface | Expected API | How verified |
|------|------------|--------------|--------------|
| customer / dual (auth for submit) | **Post a job** → `PostJobView` | Taxonomy `GET /api/v1/categories/tree` (picker); properties `GET /api/v1/properties`; fair/market `GET /api/v1/analytics/fair-price`, `…/market/range`; create `POST /api/v1/jobs`; optional instant match `POST /api/v1/jobs/{id}/instant-match`; images upload-url/confirm | API e2e categories/tree, properties; Screenshot walk form (no submit); **Manual residual:** publish + photos + instant match |
| customer (auth) | **Job drafts** → `JobDraftsView` | `GET /api/v1/jobs/drafts`; `POST /api/v1/jobs/{id}/publish` | API e2e `customer.jobs/drafts`; **Screenshot walk gap** (row not visited); **Manual residual:** publish draft |
| seller / dual | **Sell an item** → `CreateListingView` | `POST /api/v1/listings`; fair price; image upload | API e2e public listings only (create mutation not in suite); **Screenshot walk gap**; **Manual residual:** create listing + photos |

---

## Account · Orders, bids & alerts

| Role | UI surface | Expected API | How verified |
|------|------------|--------------|--------------|
| buyer/seller (auth) | **Orders** → `MyOrdersView` | `GET /api/v1/me/orders`; pay `POST /api/v1/orders/{id}/pay`; pickup `POST …/confirm-pickup`; seller confirm; disputes/no-show; order reviews | API e2e list `customer.me/orders`; Screenshot walk Orders; **Manual residual:** Stripe pay, dual escrow confirm, dispute |
| customer + provider | **Contracts** → `ContractsView` (+ detail) | List `GET /api/v1/contracts`; detail + milestones, change-orders, payments, check-in/out, PDF, tip, guarantee, reviews… | API e2e list + detail/change-orders when seed has contracts; **Screenshot walk gap** (Contracts row not in walk); **Manual residual:** full lifecycle |
| provider + goods bidder | **My bids** → `MyBidsView` | `GET /api/v1/listings/bids/mine`; `GET /api/v1/bids/mine`; retract/update/withdraw | API e2e both bid lists + place bid paths; Screenshot walk My bids; **Manual residual:** retract/lower in UI |
| seller (auth) | **My listings** → `MyListingsView` | `GET /api/v1/listings/mine` (+ detail mutations elsewhere) | API e2e `customer.listings/mine`; **Screenshot walk gap**; Device launch residual |
| all (auth) | **Watchlist** → `WatchlistView` | `GET /api/v1/me/watchlist`; add/remove via listing `POST|DELETE /api/v1/listings/{id}/watch` | API e2e list + watch/unwatch mutation; Screenshot walk Watchlist |
| all (auth) | **Saved searches** → `SavedSearchesView` | `GET|POST|DELETE /api/v1/me/saved-searches` | API e2e list; Screenshot walk; **Manual residual:** create/delete alert |
| seller (auth) | **Seller analytics** → `SellerAnalyticsView` | `GET /api/v1/me/seller-analytics?range=` | API e2e customer + provider analytics; Screenshot walk (provider leg) |
| provider (auth) | **Seller payouts** → `SellerPayoutsView` | `GET /api/v1/users/me`; `GET /api/v1/providers/me/stripe/status`; create account + onboarding link | API e2e `provider.stripe.status`; Screenshot walk Seller payouts; **Manual residual:** Connect onboarding Safari |
| provider (+ flag-gated rails) | **Business & finance** → `BusinessFeaturesHubView` | BNPL `…/payments/installment-plans*`; insurance `…/insurance/*`; advances `…/providers/me/advances*`, credit-limit; instant payout `…/payments/instant-payout*`; expenses; tax forms/estimate | **Not** in full-feature e2e (optional/flagged) → residual; **Screenshot walk gap**; **Manual residual:** only when server flags ON |
| seller/provider (auth) | **Sales export (CSV)** → `SalesExportView` | `GET /api/v1/me/sales.csv` | API e2e `provider.sales.csv`; **Screenshot walk gap**; **Manual residual:** share sheet |
| all (auth, schedule data) | **Calendar export** → `CalendarExportView` | `GET /api/v1/me/calendar.ics` | API e2e `provider.calendar.ics`; **Screenshot walk gap**; share sheet residual |
| provider (auth) | **Team** → `EmployeesView` | `GET|POST|DELETE /api/v1/providers/me/employees` | **Not** in e2e suite → residual; **Screenshot walk gap**; Manual residual |
| provider (auth) | **Challenges** → `ChallengesView` | `GET /api/v1/challenges`; `POST /api/v1/challenges/{id}/join` | **Not** in e2e suite → residual; **Screenshot walk gap**; Manual residual |
| all (when flag `legal_services`) | **Legal services** → `LegalServicesView` | Resolve category + `GET /api/v1/jobs…` filtered legal | Soft-skip style residual if flag off; **Screenshot walk gap**; Manual residual |
| provider (auth) | **Quote templates** → `QuoteTemplatesView` | `GET|POST|DELETE /api/v1/providers/me/quote-templates` | API e2e list `provider.quote-templates`; Screenshot walk |
| provider (auth) | **Verification documents** → `VerificationDocumentsView` | `GET|POST /api/v1/providers/me/documents` (+ image upload pipeline) | API e2e list `provider.documents`; **Screenshot walk gap**; **Manual residual:** camera/library upload |
| all (auth) | **Payment methods** → `PaymentMethodsView` | `GET /api/v1/payments/methods`; setup intent; `DELETE …/methods/{id}` | API e2e list; **Screenshot walk gap**; **Manual residual:** Stripe PaymentSheet add card + biometrics gate |
| all (auth) | **Notifications** → `NotificationsView` | `GET /api/v1/notifications`; mark one/all read; unread-count | API e2e list + mark-all; **Screenshot walk gap** (prefs only); Manual residual: deep-link open |
| all (auth) | **Notification preferences** → `NotificationPreferencesView` | `GET|PUT /api/v1/notifications/preferences` | API e2e GET; Screenshot walk; **Manual residual:** toggle save |

---

## Account · Network & safety

| Role | UI surface | Expected API | How verified |
|------|------------|--------------|--------------|
| all | **Providers** → `ProvidersView` | `GET /api/v1/providers/search?q=&page&page_size` (+ detail follow) | API e2e search + provider detail + follow/unfollow; **Screenshot walk gap**; Manual residual: open detail |
| all (auth) | **Following** → `FollowingView` | `GET /api/v1/me/follows`; unfollow `DELETE /api/v1/users/{id}/follow` | API e2e follows + unfollow; **Screenshot walk gap** |
| all (auth) | **Following feed** → `FeedView` | `GET /api/v1/me/feed` | API e2e `customer.feed`; **Screenshot walk gap** |
| customer (auth) | **Properties** → `PropertiesView` | `GET|POST|PUT|DELETE /api/v1/properties`; spending analytics; preferred providers; related jobs/contracts | API e2e list; Screenshot walk; **Manual residual:** create/delete property |
| all (auth) | **Wishlist** → `WishlistView` | `GET|POST|DELETE /api/v1/me/wishlist` | API e2e list + create/delete; **Screenshot walk gap** |
| all (auth) | **Blocked users** → `BlockedUsersView` | `GET /api/v1/me/blocks`; unblock | API e2e list; **Screenshot walk gap**; Manual residual: block from profile |
| all (auth) | **Referrals** → `ReferralsView` | `GET /api/v1/me/referrals/code`; `GET /api/v1/me/referrals`; redeem `POST …/redeem` | API e2e code + list; Screenshot walk; Manual residual: redeem |
| all (auth) | **Feedback surveys** → `NPSSurveysView` | `GET /api/v1/me/nps/pending`; `POST /api/v1/me/nps/{id}` | API e2e pending; **Screenshot walk gap**; Manual residual: submit score |
| customer (auth) | **Savings** → `SavingsView` | `GET /api/v1/users/me/savings` (+ optional referral code) | API e2e savings; **Screenshot walk gap** |
| all | **Markets** → `MarketsView` | `GET /api/v1/markets` | API e2e `markets`; **Screenshot walk gap** |
| all | **Trust tiers** → `TrustTiersView` | `GET /api/v1/trust/tiers` | API e2e; Screenshot walk |

---

## Account · Legal & support

| Role | UI surface | Expected API | How verified |
|------|------------|--------------|--------------|
| all | **Privacy Policy** / **Terms of Service** / **Community Guidelines** / **Support** | Web handoff URLs (`AppConfig.*`) via `LegalWebView` — no gateway product API | **Manual residual** / Screenshot optional; not API e2e |
| all (auth) | **Terms acceptance** → `TermsAcceptanceView` | `GET /api/v1/tos/current`; `GET|POST /api/v1/me/tos-acceptance` | API e2e current + acceptance GET; Screenshot walk; Manual residual: accept new version |

---

## Account · Your data

| Role | UI surface | Expected API | How verified |
|------|------------|--------------|--------------|
| all (auth) | **Export Data** (button) | `GET /api/v1/users/me/export` → share sheet | **Not** in full-feature e2e → residual; **Manual residual:** share sheet + file size |
| all (auth) | **Delete Account** → `AccountDeletionView` | `DELETE /api/v1/users/me` (grace schedule); biometric gate local | **Never auto-run against seed** → Manual residual only (destructive) |

---

## Account · Subscriptions / about

| Role | UI surface | Expected API | How verified |
|------|------------|--------------|--------------|
| all | **Plan limits** → `PlanLimitsView` | `GET /api/v1/subscriptions/tiers` | API e2e `subscriptions.tiers`; Screenshot walk |
| all | **Feature flag status** → `RegulatedRailsStatusView` | `GET /api/v1/flags` (via `FeatureFlags.refresh`) | API e2e `flags`; Screenshot walk (admin leg + readable for all); no admin write on iOS |
| all | About (version / API host / Stripe key label) | Config only | Device launch |

---

## Cross-check: `ios-full-feature-e2e.sh` vs Account map

### Covered by the script (HTTP green path for seed data)

Public: health, flags, jobs, listings, jobs/map, providers/search, categories/tree, autocomplete, markets, trust/tiers, subscriptions/tiers, tos/current.

Customer session + dual-rail lists: users/me, age-status, tos-acceptance, savings, properties, payment-methods, notification prefs/inbox/unread, jobs/mine, drafts, listings/mine, orders, contracts, bids (job + listing), watchlist, wishlist, saved-searches, follows, feed, blocks, channels, referrals, nps, seller-analytics; live job/listing/contract/provider detail where data exists; watch/wishlist/follow mutations; mark-all notifications.

Provider: users/me, bids, listing bids, seller-analytics, providers/me, licenses, streaks, documents, quote-templates, stripe status, sales.csv, calendar.ics, contracts, channels, place job bid (409 OK).

Listing bid bond path when 402.

### Present in Account UI but **not** asserted by the script (residual — not fail)

| Surface | Why residual |
|---------|----------------|
| Instant offers (`/provider/offers`) | No e2e GET/accept/decline |
| Employees / challenges | No e2e coverage |
| Business & finance rails | Flag-gated money; not in suite |
| Data export `users/me/export` | Not called |
| Account deletion | Destructive — intentionally out |
| Payment setup-intent / delete method | List only |
| MFA / change-password / DOB / OAuth unlink / passkeys | Security mutations not in suite |
| Phone/email verification OTP | External delivery |
| Sales/calendar share sheet UI | API bytes only on provider |
| Contract advanced mutations | Detail + change-orders GET only |
| Order pay / escrow handshake | List only |
| Post job / create listing POST | Not exercised (safe suite) |
| Legal services vertical | Flag-gated |
| Job drafts publish | Drafts GET only |
| Background check request | Not covered |
| Push device register/unregister | Not in this script |

Soft-skips inside the suite (404/501/503 optional, empty catalog) are **not** product failures.

---

## Cross-check: UI automation coverage

### `NoMarkupUITests` (smoke)

| What | Coverage |
|------|----------|
| Cold launch | login form **or** root tabs |
| Credentialed login | DEBUG auto-login preferred; form fallback |
| Signed-in tabs | Taps all five tab identifiers / labels once |
| Account rows | **None** |

### `ScreenshotWalkUITests` (ordered walk + screenshots)

**Customer:** Account root (top/mid/bottom); Profile settings; Security; Verify email & phone; Post a job form (no submit); My bids; Orders; Watchlist; Saved searches; Notification preferences; Properties; Referrals; Trust tiers; Terms acceptance; Plan limits.

**Provider:** Provider workspace; Instant offers; Quote templates; Seller analytics; Seller payouts; job bid UI on Jobs tab.

**Empty states:** provider2 / customer2 subsets.

**Admin:** same consumer shell; Feature flag status only (documents “no admin UI”).

**Not walked (Account rows exist in UI):** Job drafts, Sell an item, Contracts, My listings, Seller analytics (customer leg), Business & finance, Sales export, Calendar export, Team, Challenges, Legal services, Verification documents, Payment methods, Notifications inbox, Following, Following feed, Wishlist, Blocked users, Feedback surveys, Savings, Markets, Providers directory, Export Data, Delete Account, Finish setup wizard, most mutations on opened screens.

### Device auto-login

Historical dogfood ([`device-e2e-results-2026-07-26.md`](./device-e2e-results-2026-07-26.md)): install + launch with seed env → process running. Expected human follow-up table lists Account destinations (orders, contracts, drafts, following, feed, wishlist, providers, payouts, exports, trust, plan limits, terms). That follow-up remains **manual residual** unless a fresh walk is signed off.

---

## Role summary

| Role | iOS product reality |
|------|---------------------|
| **customer** | Full Account commerce + properties + post job + orders/contracts as buyer |
| **provider** | Same shell + workspace, instant offers, quotes, docs, team, challenges, Stripe payouts, provider bids |
| **dual-role** | Both sets of rows enabled when roles present on `users/me` |
| **admin** | **Consumer app only** — no `/admin` surface; flags status is read-only diagnostic |
| **scaffold / signed-out** | Public browse; create forms may open but mutations/chat disabled or login-gated |

---

## Residual backlog (coverage, not suite red)

1. Extend `ios-full-feature-e2e.sh` optionally for: provider offers list, employees list, challenges list, `users/me/export` (GET), installment/insurance/advances **only when flags on** (skip when off).  
2. Expand Screenshot walk (or dedicated UITest) for: Contracts, My listings, Payment methods, Notifications, Business & finance (flag-aware skip), exports, Wishlist/Following/Feed, Job drafts.  
3. Keep destructive delete, MFA enrollment, real OTP, Stripe PaymentSheet, Apple Pay, camera, and dual-party escrow as **manual / device smoke** items on [`device-smoke-checklist.md`](./device-smoke-checklist.md).  
4. Do not promote API e2e green or auto-login process-alive into “full UI verified.”

---

## Related

- [`ios-web-feature-matrix.md`](./ios-web-feature-matrix.md) — product live/partial status  
- [`device-e2e-results-2026-07-26.md`](./device-e2e-results-2026-07-26.md) — prior green API suite + device launch note  
- [`device-smoke-checklist.md`](./device-smoke-checklist.md) — human device matrix  
- [`ios/README.md`](../../ios/README.md) — runbooks  

**Generated from source mapping on 2026-08-05; re-run API e2e / walks when Account rows or gateway routes change.**
