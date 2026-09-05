# Evening API Red-Team — 2026-08-05

**Target:** `http://127.0.0.1:8081`  
**Auth:** `POST /api/v1/auth/login` → Bearer access token (RS256 JWT)  
**Credentials:** seed password `Password123!`

| Actor | Email | Observed roles (JWT /me) |
|-------|-------|--------------------------|
| Customer | `customer@nomarkup.com` | `customer`, `provider` (dual-role seed/QA state) |
| Provider | `provider@nomarkup.com` | `provider` |
| Admin | `admin@nomarkup.com` | `admin` (+ provider pass-through via `RequireProvider`) |

**Scope:** Exhaustive **GET** of every admin route and every customer/provider `/me` (and closely related “mine”) route registered in `gateway/internal/router/router.go`. Collect all HTTP **5xx**. Fix unexpected **500**s (intentional flag **503**s left alone). Re-verify. Run iOS API E2E scripts.

**Router source of truth:** `gateway/internal/router/router.go` (admin block ~1032–1204; provider `/providers/me/*` ~559–660; shared `/me/*` and authenticated catalog under `/api/v1`).

---

## Verdict

| Class | Pre-fix | Post-fix | Result |
|-------|---------:|----------:|--------|
| Unexpected **500** | **3** | **0** | **PASS** (fixed) |
| Intentional feature-flag **503** | 3–4 | 3 | **PASS** (expected fail-closed) |
| Soft 4xx (400/422/404) | present | present | **PASS** (expected) |
| iOS API smoke | — | 19 pass / 0 fail | **PASS** |
| iOS full-feature E2E | — | 72 pass / 0 fail / 1 skip | **PASS** |

**Code fixes shipped** (payment service):

1. `GET /api/v1/subscriptions/invoices` — empty `stripe_subscription_id` no longer calls Stripe → was HTTP 500.
2. `GET /api/v1/providers/me/stripe/onboarding` — synthetic `acct_dev_*` Connect IDs against a live key no longer call Stripe → was HTTP 500; now **422** `provider is not set up to receive payouts` (same CTA path as missing account).

---

## Method

1. Ensure native stack (`bin/dev`, `GATEWAY_PORT=8081`) is healthy (`GET /health` → 200).
2. Login as customer / provider / admin; capture `access_token`.
3. GET every admin collection path under `/api/v1/admin/*`.
4. GET every shared authenticated `/me` and “mine” surface for customer + provider.
5. GET every provider-self path under `/api/v1/providers/me/*` (+ related provider analytics / offers / instant-payout summary) as provider and admin.
6. Resolve live IDs from list payloads (`payments`, `disputes`) and hit detail routes; probe `ffffffff-ffff-ffff-ffff-ffffffffffff` for 404-vs-500.
7. Collect 5xx; triage 503 (flag) vs 500 (bug).
8. Fix payment-service root causes; rebuild + restart `payment`; re-run full matrix.
9. Run:
   - `API_BASE=http://127.0.0.1:8081 SEED_PASSWORD=Password123! bash scripts/ios-api-e2e-smoke.sh`
   - `API_BASE=http://127.0.0.1:8081 SEED_PASSWORD=Password123! bash scripts/ios-full-feature-e2e.sh`

---

## Unexpected 500s found → fixed

### 1. `GET /api/v1/subscriptions/invoices` → 500 (customer + provider)

**Symptom:** `{"error":"internal error"}` (~2s latency).

**Root cause:** Seed/admin-granted rows in `subscriptions` have `status=active` but **empty** `stripe_subscription_id`.  
`SubscriptionService.ListInvoices` still called Stripe `Invoice.List` with `subscription=""`, which returns Stripe `parameter_invalid_empty` → gRPC Internal → gateway 500.

**Evidence (payment log):**

```text
[ERROR] Request error from Stripe (status 400): ... "You passed an empty string for 'subscription'."
grpc call failed method=/nomarkup.subscription.v1.SubscriptionService/ListInvoices ... Internal
```

**DB state:**

| user_id (seed) | status | stripe_subscription_id |
|----------------|--------|------------------------|
| …0002 (customer) | active | (empty) |
| …0003 (provider) | active | (empty) |
| …0001 (admin) | active | (empty) |

**Fix:** `services/payment/internal/service/subscription.go` — if subscription row is missing Stripe ID, return `[]` (no Stripe call). Unit test: `empty_stripe_subscription_id_returns_empty_list`.

**Post-fix:** `200 {"invoices":[]}` for customer, provider, and admin.

---

### 2. `GET /api/v1/providers/me/stripe/onboarding` → 500 (provider only)

**Symptom:** `{"error":"internal error"}`.

**Root cause:** Seeded `provider_profiles.stripe_account_id = 'acct_dev_'` for provider `…0003`.  
`GetStripeAccountStatus` already soft-handled synthetic `acct_dev*` IDs against a live key, but **`GetStripeOnboardingLink` did not** — it called Stripe `AccountLink.Create` with `acct_dev_` → `resource_missing` → Internal → 500.

**Evidence (payment log):**

```text
[ERROR] Request error from Stripe (status 400): ... "No such account: 'acct_dev_'"
grpc call failed method=/nomarkup.payment.v1.PaymentService/GetStripeOnboardingLink ... Internal
```

Admin/customer (no / empty Connect id) already returned **422** `provider is not set up to receive payouts` via `ErrStripeAccountNotFound`.

**Fix:** `services/payment/internal/service/service.go` — mirror status soft-id policy:

- If live key + `isSyntheticDevStripeAccountID(accountID)` → `domain.ErrStripeAccountNotFound` (gateway **422**).
- If Stripe returns missing-resource on AccountLink → same sentinel.

Unit test: `synthetic_acct_dev_against_live_key_returns_not_found`.

**Post-fix:** provider **422** (same as missing account); status still **200** with `charges_enabled/payouts_enabled: false`.

---

## Intentional 503 (feature flags — not bugs)

| Status | Path | Flag | Notes |
|-------:|------|------|-------|
| 503 | `/api/v1/admin/guarantee-claims` | `nomarkup_guarantee=false` | Admin money path fail-closed |
| 503 | `/api/v1/providers/me/background-check` | `background_checks=false` | Provider + admin; flag-off API-off |

Body: `{"error":"This feature is currently unavailable"}` — `RequireFlag` middleware.

Observed flag map (admin `GET /api/v1/admin/flags`) relevant to this matrix:

| Key | Enabled |
|-----|:-------:|
| `nomarkup_guarantee` | false |
| `background_checks` | false |
| `legal_services` | true |
| `insurance_competition` | true |
| `working_capital` | true |
| `per_job_insurance` | true |
| `provider_business_os` | true |
| `instant_payout` | true |
| `marketplace_offers` | true |
| `customer_bnpl` | true |

---

## Post-fix matrix summary

**171 GETs** (admin collections + details + customer/provider `/me` + provider-self).

| Status | Count | Interpretation |
|-------:|------:|----------------|
| 200 | 161 | Healthy |
| 400 | 2 | `GET /bids/analytics` without `job_id` (API contract) |
| 404 | 3 | Unknown UUID probes (users/payments/disputes) |
| 422 | 2 | Stripe onboarding without a real Connect account |
| 503 | 3 | Flag-off only |
| **500** | **0** | — |

### Admin GET routes exercised

| Path | Status |
|------|-------:|
| `/api/v1/admin/fraud/alerts` | 200 |
| `/api/v1/admin/users` (+ `?limit=5`) | 200 |
| `/api/v1/admin/users/{id}` live | 200 |
| `/api/v1/admin/users/{bogus}` | 404 |
| `/api/v1/admin/fraud/users/{id}/risk` | 200 |
| `/api/v1/admin/verification/queue` | 200 |
| `/api/v1/admin/licenses` (+ pending filter) | 200 |
| `/api/v1/admin/insurers` | 200 |
| `/api/v1/admin/jobs` | 200 |
| `/api/v1/admin/disputes` | 200 |
| `/api/v1/admin/disputes/goods` | 200 |
| `/api/v1/admin/disputes/{id}` live | 200 |
| `/api/v1/admin/disputes/{bogus}` | 404 |
| `/api/v1/admin/guarantee-claims` | **503** (flag) |
| `/api/v1/admin/reviews/flagged` | 200 |
| `/api/v1/admin/payments` | 200 |
| `/api/v1/admin/payments/fee-config` | 200 |
| `/api/v1/admin/payments/{id}` live | 200 |
| `/api/v1/admin/payments/{bogus}` | 404 |
| `/api/v1/admin/revenue` | 200 |
| `/api/v1/admin/banking` | 200 |
| `/api/v1/admin/advances` | 200 |
| `/api/v1/admin/platform/metrics` | 200 |
| `/api/v1/admin/platform/growth` | 200 |
| `/api/v1/admin/platform/categories` | 200 |
| `/api/v1/admin/platform/geographic` | 200 |
| `/api/v1/admin/subscriptions` | 200 |
| `/api/v1/admin/challenges` | 200 |
| `/api/v1/admin/insurance/claims` | 200 |
| `/api/v1/admin/listings` | 200 |
| `/api/v1/admin/goods-reports` | 200 |
| `/api/v1/admin/user-reports` | 200 |
| `/api/v1/admin/markets` | 200 |
| `/api/v1/admin/flags` | 200 |

`/admin/category-questions` is write-only (no GET).

### Shared `/me` + mine (customer & provider) — sample

All of the following returned **200** for both actors after fix (unless noted):

- `/api/v1/users/me`, `/me/savings`, `/me/oauth-accounts`, `/me/export`
- `/api/v1/me/tos-acceptance`, `/me/age-status`, `/me/follows`, `/me/feed`
- `/api/v1/me/referrals/code`, `/me/referrals`, `/me/nps/pending`
- `/api/v1/me/preferred-providers`, `/me/orders`, `/me/seller-analytics`, `/me/sales.csv`
- `/api/v1/me/watchlist`, `/me/saved-searches`, `/me/wishlist`
- `/api/v1/me/chat/aliases`, `/me/chat/templates`, `/me/blocks`
- `/api/v1/subscriptions/me`, `/usage`, **`/invoices` (fixed → 200 empty)**
- `/api/v1/analytics/customers/me/spending`
- `/api/v1/jobs/mine`, `/jobs/drafts`, `/listings/mine`, `/listings/bids/mine`
- `/api/v1/bids/mine`, `/properties/`, `/contracts/`, `/payments/`, `/payments/methods`
- `/api/v1/channels/`, `/channels/unread`, notifications + prefs
- `/api/v1/challenges/`, `/challenges/me`, `/me/calendar.ics`
- Flag-gated list reads: installment-plans, insurance quote-requests, insurance policies

**Expected non-200:**

| Path | Status | Note |
|------|-------:|------|
| `/api/v1/bids/analytics` | 400 | Requires `job_id` query param |

### Provider `/me` routes

| Path | Provider | Admin | Notes |
|------|--------:|------:|-------|
| `/providers/me` | 200 | 200 | |
| `/providers/me/streaks` | 200 | 200 | |
| `/providers/me/licenses` | 200 | 200 | `legal_services` on |
| `/providers/me/documents` | 200 | 200 | |
| `/providers/me/documents/{type}/status` | 200 | 200 | identity + insurance |
| `/providers/me/background-check` | **503** | **503** | flag off |
| `/providers/me/employees` | 200 | 200 | |
| `/providers/me/stripe/onboarding` | **422** | **422** | synthetic/missing Connect (fixed; was 500 for provider) |
| `/providers/me/stripe/status` | 200 | 200 | soft-id already OK |
| `/providers/me/advances` | 200 | 200 | `working_capital` on |
| `/providers/me/credit-limit` | 200 | 200 | |
| `/providers/me/expenses` | 200 | 200 | `provider_business_os` on |
| `/providers/me/tax-forms` | 200 | 200 | |
| `/providers/me/tax-estimate` | 200 | 200 | |
| `/providers/me/quote-templates` | 200 | 200 | |
| `/provider/offers/` | 200 | 200 | |
| `/payments/instant-payout/summary` | 200 | 200 | |
| `/analytics/providers/{seed provider}` | 200 | 200 | |
| `/analytics/providers/{id}/earnings` | 200 | 200 | |

---

## iOS E2E scripts

```bash
API_BASE=http://127.0.0.1:8081 SEED_PASSWORD=Password123! bash scripts/ios-api-e2e-smoke.sh
# === Summary: 19 pass, 0 fail ===

API_BASE=http://127.0.0.1:8081 SEED_PASSWORD=Password123! bash scripts/ios-full-feature-e2e.sh
# E2E_RESULT pass=72 fail=0 skip=1
```

**Skip (not a failure):** `customer.listing.bid` — HTTP 400 auction state (no live bid-eligible listing in current seed timing).

---

## Code changes

| File | Change |
|------|--------|
| `services/payment/internal/service/subscription.go` | Empty `StripeSubscriptionID` → empty invoice list |
| `services/payment/internal/service/service.go` | `GetStripeOnboardingLink` soft-handles synthetic / missing Connect IDs |
| `services/payment/internal/service/subscription_admin_test.go` | Unit test for empty Stripe sub ID |
| `services/payment/internal/service/service_proxies_test.go` | Unit test for `acct_dev_` onboarding |

Payment service rebuilt and restarted via `bin/dev rebuild payment` + `bin/dev up payment`. Unit package:  
`go test ./internal/service/ -run 'ListInvoices|GetStripeOnboardingLink|GetStripeAccountStatus'` → **ok**.

---

## Residuals / notes (not 500s)

1. **GDPR export soft section:** gateway log  
   `data export: section failed … provider_profile … cannot scan NULL into *string` (customer dual-role row with null `business_name`). Overall `GET /users/me/export` still returned **200**; section is dropped, not fatal. Worth a nullable scan fix when touching export again.
2. **Customer dual-role:** seed customer currently has roles `["customer","provider"]` and a `provider_profiles` row — so provider routes are reachable for that actor. Pure customer-only 403 coverage was not asserted on this seed.
3. **`bids/analytics` without `job_id`:** intentional **400** — not a 5xx.
4. **Synthetic Connect IDs in DB:** provider still stores `acct_dev_`. Status/onboarding now safe; optional cleanup = null the column or re-run Connect create so future money paths start from a real `acct_…`.
5. **Jaeger / OTLP:** gateway logs continuous `traces export: connection refused` on `:4317` — observability noise only; not user-facing.

---

## Final gate

| Check | Result |
|-------|:------:|
| Unexpected HTTP 500 on admin GETs | **0** |
| Unexpected HTTP 500 on customer/provider `/me` GETs | **0** |
| Intentional 503 flags preserved | yes |
| Payment unit tests for fixes | pass |
| `ios-api-e2e-smoke.sh` | 19/19 pass |
| `ios-full-feature-e2e.sh` | 72 pass / 0 fail / 1 skip |

**Evening red-team: PASS after payment soft-id / empty-subscription invoice fixes.**
