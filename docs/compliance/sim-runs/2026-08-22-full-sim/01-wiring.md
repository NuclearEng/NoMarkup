# SIM-WIRE — FE action → API path → Chi handler (2026-08-22 full sim)

**Date:** 2026-08-22  
**Mode:** fix · **Depth:** deep / full  
**API:** `http://127.0.0.1:8081` (`GET /health` → **200** `{"status":"ok","version":"dev"}`; `GET /readyz` → **200**)  
**Client SoT:** `ios/NoMarkup/Core/APIClient.swift` + `APIClient+*.swift` · `ios/NoMarkup/Features/AccountView.swift` `account.row.*`  
**Gateway SoT:** `gateway/internal/router/router.go` (not rewritten)  
**Catalog SoT:** `docs/workflows/catalog.yaml` (37 HTTP workflows after `account.request_log` hop added)  
**Inventory:** `docs/compliance/sim-runs/2026-08-21-account-audit/00-inventory.md` primary APIs  
**Proof:** source `file:line` + live GET against `:8081` (tokens withheld). No invented endpoints. Mutations not executed.

**Verdict:** Catalog HTTP hops and Account-row primary APIs **match Chi** (method + path). **No FAIL** (iOS calling a path/method Chi does not register). One **GAP closed**: Account Request log was local-only while `GET /api/v1/me/activity` existed — iOS now fetches on appear (owner-only, fail-soft 401/404), merge-by-request-id matching web.

---

## Per-persona login (live)

Unauthenticated `GET /api/v1/users/me` → **401**. Same for `/payments/methods` and `/me/activity`.

| Persona | Login HTTP | Token | Sample authed GET |
|---------|------------|-------|-------------------|
| `customer@nomarkup.com` | **200** | yes | `/users/me` 200 · `/admin/flags` **403** |
| `provider@nomarkup.com` | **200** | yes | `/users/me` 200 · `/admin/flags` **403** |
| `admin@nomarkup.com` | **200** | yes | `/users/me` 200 · `/admin/flags` **200** `{flags}` |

Login keys: `access_token`, `access_token_expires_at`, `user_id` (no `roles` on login JSON).

---

## Catalog workflows

FAIL criterion: iOS calls a path with no Chi route, or wrong method.

| id | catalog | iOS | Chi | live | status |
|----|---------|-----|-----|------|--------|
| `auth.login` | `POST /api/v1/auth/login` | `APIClient.swift:99` / `APIClient+Auth.swift:124` | `router.go:161` `Login` | 200 JWT | **PASS** |
| `account.me` | `GET /api/v1/users/me` | `APIClient+Platform.swift:220` `fetchMe` | `router.go:497` `GetMe` | 200 | **PASS** |
| `account.profile.save` | `PATCH /api/v1/users/me` | `APIClient+Platform.swift:230` `updateMe` | `router.go:498` `UpdateMe` | not executed | **PASS** |
| `account.security` | `GET /api/v1/users/me` | same `fetchMe` (+ oauth/age) | `router.go:497` | 200 | **PASS** |
| `account.verification` | `POST /api/v1/auth/resend-verification` | `APIClient+Auth.swift:198` | `router.go:164` | not executed | **PASS** |
| `account.post_job` | `POST /api/v1/jobs` | `APIClient.swift:1251` `createJob` | `router.go:269` `Create` | not executed | **PASS** |
| `account.sell` | `POST /api/v1/listings` | `APIClient.swift:1330` `createListing` | `router.go:884` `CreateListing` | not executed | **PASS** |
| `account.orders` | `GET /api/v1/me/orders` | `APIClient.swift:1019` | `router.go:843` | 200 `{orders}` | **PASS** |
| `account.contracts` | `GET /api/v1/contracts` | `APIClient+Contracts.swift:45` | `router.go:722` | 200 `{contracts, pagination}` | **PASS** |
| `account.bids` | `GET /api/v1/bids/mine` | `APIClient.swift:1040` | `router.go:713` | 200 `{bids, pagination}` | **PASS** |
| `account.listings` | `GET /api/v1/listings/mine` | `APIClient+Commerce.swift:112` | `router.go:442` | 200 `{listings, pagination}` | **PASS** |
| `account.watchlist` | `GET /api/v1/me/watchlist` | `APIClient.swift:981` | `router.go:924` | 200 `{listings, pagination}` | **PASS** |
| `account.payment_methods` | `GET /api/v1/payments/methods` | `APIClient+Extras.swift:467` | `router.go:947` | 200 `{methods}` | **PASS** |
| `account.notifications` | `GET /api/v1/notifications` | `APIClient.swift:1053` | `router.go:1269` | 200 `{notifications, pagination}` | **PASS** |
| `account.notification_prefs.save` | `PUT /api/v1/notifications/preferences` | `APIClient+Extras.swift:453` | `router.go:1274` | not executed | **PASS** |
| `account.plan_limits` | `GET /api/v1/subscriptions/tiers` | `APIClient+Extras.swift:865` | `router.go:331` | 200 `{tiers}` | **PASS** |
| `account.plan_limits.enforce` | `POST /api/v1/jobs/{id}/bids` | `APIClient.swift:866` | `router.go:286` | not executed | **PASS** |
| `account.export` | `GET /api/v1/users/me/export` | `APIClient.swift:307` | `router.go:507` | not executed | **PASS** |
| `account.sign_out` | `POST /api/v1/auth/logout` | `APIClient+Extras.swift:422` | `router.go:204` | not executed | **PASS** |
| `account.request_log` | `GET /api/v1/me/activity` | `APIClient+Extras.swift:909` `fetchMeActivity` · `ClientActionLogView.swift:145` | `router.go:529` `ListMyActivity` | 200 `{events}` unauth **401** | **PASS** (GAP closed) |
| `account.admin.flags` | `GET /api/v1/admin/flags` | `APIClient+Admin.swift:8` | `router.go:1260` | admin 200 / others 403 | **PASS** |
| `account.admin.users` | `GET /api/v1/admin/users` | `APIClient+Admin.swift:29` | `router.go:1087` | source match | **PASS** |
| `account.admin.disputes` | `GET /api/v1/admin/disputes` | `APIClient+Admin.swift:17` | `router.go:1129` | source match | **PASS** |
| `account.admin.fraud` | `GET /api/v1/admin/fraud/alerts` | `APIClient+Admin.swift:81` | `router.go:1080` | source match | **PASS** |
| `account.admin.jobs` | `GET /api/v1/admin/jobs` | `APIClient+Admin.swift:370` | `router.go:1122` | source match | **PASS** |
| `account.admin.fees` | `GET /api/v1/admin/payments/fee-config` | `APIClient+Admin.swift:1126` | `router.go:1158` | source match | **PASS** |
| `account.admin.banking` | `GET /api/v1/admin/banking` | `APIClient+Admin.swift:1271` | `router.go:1176` | source match | **PASS** |
| `provider.workspace` | `GET /api/v1/contracts` | `fetchContracts` (workspace also loads `/providers/me`) | `router.go:722` | 200 | **PASS** |
| `provider.payouts` | `GET /api/v1/providers/me/stripe/status` | `APIClient+Extras.swift:535` | `router.go:644` | 200 | **PASS** |
| `provider.instant_offers` | `GET /api/v1/provider/offers` | `APIClient+Provider.swift:127` | `router.go:1295` | 200 `{offers}` | **PASS** |
| `provider.categories.save` | `PUT /api/v1/providers/me/categories` | `APIClient+Provider.swift:89` | `router.go:608` | not executed | **PASS** |
| `provider.portfolio.save` | `PUT /api/v1/providers/me/portfolio` | `APIClient+Provider.swift:75` | `router.go:609` | not executed | **PASS** |
| `money.pay_order` | `POST /api/v1/orders/{id}/pay` | `APIClient.swift:1007` | `router.go:830` | not executed | **PASS** |
| `money.escrow` | `POST /api/v1/payments/{id}/process` | `APIClient+Contracts.swift:767` | `router.go:972` | not executed | **PASS** |
| `money.payouts` | `GET /api/v1/providers/me/stripe/status` | same as `provider.payouts` | `router.go:644` | 200 | **PASS** |
| `bid.place` | `POST /api/v1/jobs/{id}/bids` | `APIClient.swift:866` | `router.go:286` | not executed | **PASS** |
| `bid.retract` | `POST /api/v1/listings/{id}/bids/{bidId}/retract` | `APIClient+Commerce.swift:278` | `router.go:899` | not executed | **PASS** |

Goods bids list is extra on `account.row.myBids`: `GET /api/v1/listings/bids/mine` (`APIClient.swift:1027` · `router.go:443`) — Chi registered, live **200**. Not a catalog miss.

---

### [SIM-WIRE.1] Catalog vs Chi vs iOS
- Status: PASS
- Severity: advisory
- Surface: `docs/workflows/catalog.yaml` (37 HTTP workflows)
- Evidence: table above · live customer/provider/admin GETs 200 where sampled · admin GETs 403 for non-admin
- Expected: iOS method+path equals a Chi registration
- Actual: Match. No iOS path without a handler
- Remediation: none
- Confidence: 10

---

## Spotlight: payment methods

### [SIM-WIRE.2] `account.row.paymentMethods` → `GET /api/v1/payments/methods`
- Status: PASS
- Severity: advisory
- Surface: `AccountView.swift:515–529` `PaymentMethodsView` → `PaymentMethodsView.swift:260` `fetchPaymentMethods()`
- Evidence:
  - iOS: `APIClient+Extras.swift:466–471` `pathComponents: ["api","v1","payments","methods"]` GET, Bearer required
  - Chi: `router.go:942–947` `/api/v1/payments` group `r.Get("/methods", paymentHandler.ListPaymentMethods)` (`gateway/internal/handler/payment.go` `ListPaymentMethods`)
  - Live: unauth **401**; customer/provider/admin **200** `{methods}`
- Expected: catalog `account.payment_methods` GET `/api/v1/payments/methods`
- Actual: Match. Mutations `DELETE /payments/methods/{id}` and `PUT /payments/methods/{id}/default` also registered (`router.go:949–950`) and called from iOS (`APIClient+Extras.swift:496, 513`)
- Remediation: none
- Confidence: 10

---

## Spotlight: request log / `GET /api/v1/me/activity`

Catalog previously documented `account.request_log` as **local, no API** (`method/path/status: null`). Gateway already served owner-only `GET /api/v1/me/activity` (`router.go:529`, `handler/activity.go`). Web `/settings/request-log` already merged `fetchMeActivity()` (`web/src/lib/api.ts` + `web/src/app/(dashboard)/settings/request-log/page.tsx`). iOS `ClientActionLogView` did **not** fetch — **GAP**.

### [SIM-WIRE.3] Request log server merge
- Status: **GAP closed** → PASS
- Severity: major (pre-fix)
- Surface: `account.row.requestLog` (`AccountView.swift:843–853`) → `ClientActionLogView`
- Evidence (post-fix):
  - Chi: `router.go:529` `r.Get("/me/activity", activityHandler.ListMyActivity)` under authed `/api/v1` (JWT; keys exclusively off `claims.UserID`)
  - iOS client: `APIClient+Extras.swift:904–919` `GET /api/v1/me/activity`; 401/404 → `[]`
  - iOS UI: `ClientActionLogView.swift:116–145` `.task` / `.refreshable` when `auth.isAuthenticated && !auth.isScaffoldSession`
  - Merge: `ClientActionLog.mergeActivity` dedupes on `requestID` (`local` / `server` / `both`) — web parity. Paths sanitized (no query/hash). No bodies or tokens stored
  - Live: unauth **401**; customer/provider/admin **200** `{events}`
  - Tests: `APIClientMeActivityTests` (200 / 404 / 401→[]) + `ClientActionLogTests` parse/merge — **16 passed**
- Expected: owner-only fetch on appear, fail-soft 401/404, local hops still shown
- Actual: Match after fix. Catalog yaml/json + VCR fixture `web/tests/e2e/catalog/fixtures/account.request_log.json` updated so SSOT is no longer “local only”
- Remediation: done (no router rewrite)
- Confidence: 10

---

## Account inventory primary APIs

Source: `00-inventory.md` master table. Legal Safari / widgets / About / market wiring have **no gateway path** (N/A, not FAIL).

| a11y id | primary GET/mutation | iOS | Chi | status |
|---|---|---|---|---|
| `account.row.profile` | `GET\|PATCH /users/me` | `APIClient+Platform.swift:220, 230` | `497–498` | PASS |
| `account.row.providerWorkspace` | `GET /providers/me` + streaks/licenses/categories | `APIClient+Provider.swift:13, 165, 176` | `605, 611, 619, 232` | PASS |
| `account.row.instantOffers` | `GET /provider/offers` | `APIClient+Provider.swift:127` | `1295` | PASS |
| `account.row.security` | oauth + age + me | `APIClient+Extras.swift:591, 637` | `502, 548, 497` | PASS |
| `account.row.verification` | resend-verification; Checkr GET | `APIClient+Auth.swift:198` · `APIClient+Provider.swift:281` | `164, 631` | PASS |
| `account.row.signOut` | `POST /auth/logout` | `APIClient+Extras.swift:422` | `204` | PASS |
| `account.row.postJob` | `POST /jobs` + properties/categories | `APIClient.swift:1251` · `APIClient+Extras.swift:52` | `269, 700, 232` | PASS |
| `account.row.drafts` | `GET /jobs/drafts` | `APIClient+Jobs.swift:110` | `268` | PASS |
| `account.row.sell` | `POST /listings` | `APIClient.swift:1330` | `884` | PASS |
| `account.row.orders` | `GET /me/orders` | `APIClient.swift:1019` | `843` | PASS |
| `account.row.contracts` | `GET /contracts` | `APIClient+Contracts.swift:45` | `722` | PASS |
| `account.row.recurringJobs` | `GET /contracts/{id}/recurring` | `APIClient+Contracts.swift:414` | `784` | PASS |
| `account.row.myBids` | `/listings/bids/mine` + `/bids/mine` | `APIClient.swift:1027, 1040` | `443, 713` | PASS |
| `account.row.positions` | same three GETs as bids + watchlist | `APIClient.swift:981, 1027, 1040` | `924, 443, 713` | PASS |
| `account.row.myListings` | `GET /listings/mine` | `APIClient+Commerce.swift:112` | `442` | PASS |
| `account.row.watchlist` | `GET /me/watchlist` | `APIClient.swift:981` | `924` | PASS |
| `account.row.savedSearches` | `GET /me/saved-searches` | `APIClient+Commerce.swift:91` | `926` | PASS |
| `account.row.sellerAnalytics` | `GET /me/seller-analytics` | `APIClient+Commerce.swift:136` | `852` | PASS |
| `account.row.sellerPayouts` | `GET /providers/me/stripe/status` | `APIClient+Extras.swift:535` | `644` | PASS |
| `account.row.businessFinance` | expenses/tax/invoices; money rails flag-gated | `APIClient+RegulatedRails.swift` | `667–682, 978, 1005, 654` | PASS (hard-off UI) |
| `account.row.insuranceQuote` | `GET /insurance/products` if flags | `APIClient+RegulatedRails.swift:62` | `387` | PASS (hard-off UI) |
| `account.row.salesExport` | `GET /me/sales.csv` | `APIClient+Commerce.swift:147` | `853` | PASS |
| `account.row.calendarExport` | `GET /me/calendar.ics` | `APIClient+Commerce.swift:160` | `251` | PASS |
| `account.row.team` | `GET /providers/me/employees` | `APIClient+Provider.swift:403` | `636` | PASS |
| `account.row.challenges` | `GET /challenges` | `APIClient+Provider.swift:475` | `1320` | PASS |
| `account.row.legalServices` | `GET /jobs` (row hidden; iOS hard-off) | `APIClient.swift:412` | `260` | PASS |
| `account.row.quoteTemplates` | `GET /providers/me/quote-templates` | `APIClient+Provider.swift:219` | `688` | PASS |
| `account.row.verificationDocuments` | `GET /providers/me/documents` | `APIClient+Provider.swift:302` | `624` | PASS |
| `account.row.paymentMethods` | `GET /payments/methods` | SIM-WIRE.2 | `947` | PASS |
| `account.row.paymentsHistory` | `GET /payments` | `APIClient+Contracts.swift:656` | `945` | PASS |
| `account.row.notifications` | `GET /notifications` | `APIClient.swift:1053` | `1269` | PASS |
| `account.row.notificationPreferences` | `GET\|PUT /notifications/preferences` | `APIClient+Extras.swift:444, 453` | `1273–1274` | PASS |
| `account.row.providers` | `GET /providers/search` | `APIClient+Extras.swift:14` | `339` | PASS |
| `account.row.following` | `GET /me/follows` | `APIClient+Extras.swift:744` | `574` | PASS |
| `account.row.followingFeed` | `GET /me/feed` | `APIClient+Extras.swift:783` | `575` | PASS |
| `account.row.properties` | `GET /properties` | `APIClient+Extras.swift:52` | `700` | PASS |
| `account.row.wishlist` | `GET /me/wishlist` | `APIClient+Extras.swift:216` | `938` | PASS |
| `account.row.blockedUsers` | `GET /me/blocks` | `APIClient+Extras.swift:269` | `1056` | PASS |
| `account.row.referrals` | `GET /me/referrals/code` + list | `APIClient+Extras.swift:313, 321` | `582, 584` | PASS |
| `account.row.feedbackSurveys` | `GET /me/nps/pending` | `APIClient+Extras.swift:345` | `591` | PASS |
| `account.row.savings` | `GET /users/me/savings` | `APIClient+Extras.swift:372` | `500` | PASS |
| `account.row.markets` | `GET /markets` | `APIClient+Extras.swift:670` | `241` | PASS |
| `account.row.fairPrice` | `GET /analytics/fair-price` | `APIClient.swift:1156` | `472` | PASS |
| `account.row.marketplaceMap` | `GET /listings` | `APIClient.swift:343` | `428` | PASS |
| `account.row.trustTiers` | `GET /trust/tiers` | `APIClient+Extras.swift:853` | `317` | PASS |
| `account.row.termsAcceptance` | `GET /tos/current` + `/me/tos-acceptance` | `APIClient+Extras.swift:874, 882` | `399, 545` | PASS |
| `account.row.exportData` | `GET /users/me/export` | `APIClient.swift:307` | `507` | PASS |
| `account.row.deleteAccount` | `DELETE /users/me` | `APIClient.swift:296` | `509` | PASS |
| `account.row.planLimits` | `GET /subscriptions/tiers` | `APIClient+Extras.swift:865` | `331` | PASS |
| `account.row.featureFlags` | `GET /flags` | `APIClient.swift:317` | `364` | PASS |
| `account.row.admin` | `/admin/*` (flags, users, disputes, fraud, jobs, fees, banking, job-reports, …) | `APIClient+Admin.swift` | `1075–1261` | PASS |
| `account.row.requestLog` | `GET /me/activity` + local ring buffer | SIM-WIRE.3 | `529` | PASS |
| privacy / terms / guidelines / support | `AppConfig` public web URLs | no Chi | N/A | N/A |
| `account.row.widgets` | copy only | no API | N/A | PASS |

### [SIM-WIRE.4] Account inventory primary APIs
- Status: PASS
- Surface: every `account.row.*` primary API in `00-inventory.md`
- Expected: destination view’s load/mutation path exists on Chi with the same method
- Actual: Match. Hard-off rails (`legal_services`, BNPL, insurance, advances, instant payout) still have handlers; iOS does not call them in this binary
- Remediation: none
- Confidence: 10

### [SIM-WIRE.5] Admin job-reports (prior live 404)
- Status: PASS
- Surface: `GET /api/v1/admin/job-reports` (`APIClient+Admin.swift:56–59` · `router.go:1229–1230`)
- Evidence: live admin Bearer **200** `{pagination, reports}`; customer/provider **403** `{error}` (not chi `404 page not found`)
- Expected: handler exists; non-admin 403
- Actual: Match (2026-08-21 FAIL was a stale gateway binary)
- Confidence: 10

---

## Summary

| ID | Surface | Status |
|----|---------|--------|
| SIM-WIRE.1 | 37 catalog HTTP workflows | **PASS** |
| SIM-WIRE.2 | `GET /api/v1/payments/methods` | **PASS** (live 200 `{methods}`) |
| SIM-WIRE.3 | `GET /api/v1/me/activity` from Request log | **GAP closed** (iOS fetch + merge; live 200 `{events}`) |
| SIM-WIRE.4 | Account inventory primary APIs | **PASS** |
| SIM-WIRE.5 | admin job-reports | **PASS** (200 admin / 403 others) |

**FAIL count:** 0 (no iOS path without a Chi route).  
**GAP count:** 1, closed in this run (`ClientActionLogView` + `fetchMeActivity`).  
Router not rewritten. No commit.
