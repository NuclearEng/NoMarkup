# Admin API Smoke Matrix — 2026-08-05

**Target:** `http://127.0.0.1:8081`  
**Actor:** `admin@nomarkup.com` / `Password123!`  
**Auth:** `POST /api/v1/auth/login` → Bearer access token (RS256 JWT)  
**Admin subject:** `00000000-0000-0000-0000-000000000001` (roles: `admin`, `provider`)  
**Scope:** All **GET** routes under `/api/v1/admin/*` registered in `gateway/internal/router/router.go`, plus post soft-id regression checks for customer payment-methods and provider Stripe status.

## Verdict

| Class | Count | Result |
|-------|------:|--------|
| List/detail GETs **200** | 36 | **PASS** |
| Feature-flag **503** (intentional) | 1 | **PASS** (expected) |
| Not-found **404** (unknown UUID probes) | 3 | **PASS** (expected) |
| Unexpected **5xx** | 0 | **PASS** |
| Soft-id regression (`/payments/methods`, `/providers/me/stripe/status`) | 2×200 | **PASS** |

**No code fixes required.** No unexpected 500s. The single non-2xx list endpoint is `GET /api/v1/admin/guarantee-claims` returning **503** because `RequireFlag(..., "nomarkup_guarantee")` is off — intentional fail-closed behavior, not a bug.

---

## Method

1. Login as admin; capture `access_token`.
2. `GET` every collection/admin read path under `/api/v1/admin` that the Chi router mounts (see router excerpt below).
3. Resolve live IDs from list payloads where needed (`users`, `payments`, `disputes`) and hit detail routes.
4. Probe non-existent UUIDs to distinguish **404** vs **500**.
5. Regression: `GET /api/v1/payments/methods` and `GET /api/v1/providers/me/stripe/status` with the same admin token (admin also holds `provider`).

Router source of truth (GET only; mutations out of scope):

| Route | Handler | Notes |
|-------|---------|-------|
| `/admin/fraud/alerts` | `fraudHandler.ListAlerts` | |
| `/admin/fraud/users/{id}/risk` | `fraudHandler.GetUserRiskProfile` | |
| `/admin/users` | `adminUsersHandler.SearchUsers` | |
| `/admin/users/{id}` | `adminUsersHandler.GetUser` | |
| `/admin/verification/queue` | `adminVerificationHandler.ListPendingDocuments` | |
| `/admin/licenses` | `providerLicenseHandler.ListPendingLicenses` | flag `legal_services` |
| `/admin/insurers` | `insuranceCompetitionHandler.AdminListInsurers` | flag `insurance_competition` |
| `/admin/jobs` | `adminJobsHandler.ListJobs` | |
| `/admin/disputes` | `adminDisputesHandler.ListDisputes` | |
| `/admin/disputes/goods` | `adminMarketplaceHandler.ListGoodsDisputes` | |
| `/admin/disputes/{id}` | `adminDisputesHandler.GetDispute` | |
| `/admin/guarantee-claims` | `adminDisputesHandler.ListGuaranteeClaims` | flag `nomarkup_guarantee` |
| `/admin/reviews/flagged` | `adminReviewsHandler.ListFlaggedReviews` | |
| `/admin/payments` | `adminPaymentsHandler.ListPayments` | |
| `/admin/payments/fee-config` | `adminPaymentsHandler.GetFeeConfig` | |
| `/admin/payments/{id}` | `adminPaymentsHandler.GetPaymentDetails` | |
| `/admin/revenue` | `adminPaymentsHandler.GetRevenueReport` | |
| `/admin/banking` | `adminBankingHandler.GetPlatformBankAccount` | |
| `/admin/advances` | `workingCapitalHandler.AdminListAdvances` | flag `working_capital` |
| `/admin/platform/metrics` | `adminPlatformHandler.GetPlatformMetrics` | |
| `/admin/platform/growth` | `adminPlatformHandler.GetGrowthMetrics` | |
| `/admin/platform/categories` | `adminPlatformHandler.GetCategoryMetrics` | |
| `/admin/platform/geographic` | `adminPlatformHandler.GetGeographicMetrics` | |
| `/admin/subscriptions` | `adminPlatformHandler.ListSubscriptions` | |
| `/admin/challenges` | `challengeHandler.AdminListChallenges` | |
| `/admin/insurance/claims` | `insuranceHandler.AdminListClaims` | flag `per_job_insurance` |
| `/admin/listings` | `adminMarketplaceHandler.ListListings` | |
| `/admin/goods-reports` | `adminMarketplaceHandler.ListReports` | |
| `/admin/user-reports` | `userReportsHandler.ListUserReports` | |
| `/admin/markets` | `adminMarketsHandler.List` | |
| `/admin/flags` | `featureFlagHandler.ListFeatureFlags` | |

`/admin/category-questions` is write-only (POST/PATCH/DELETE) — no GET in router.

---

## Results — collection / config GETs

| Status | Path | Pass? | Notes |
|-------:|------|:-----:|-------|
| 200 | `/api/v1/admin/fraud/alerts` | ✅ | Alerts present |
| 200 | `/api/v1/admin/users` | ✅ | 39 users, pagination OK |
| 200 | `/api/v1/admin/users?limit=5` | ✅ | Query accepted (pageSize still default 20 in body) |
| 200 | `/api/v1/admin/verification/queue` | ✅ | Empty queue OK |
| 200 | `/api/v1/admin/licenses` | ✅ | Flag `legal_services` enabled |
| 200 | `/api/v1/admin/licenses?status=pending` | ✅ | Pending licenses returned |
| 200 | `/api/v1/admin/insurers` | ✅ | Flag `insurance_competition` enabled |
| 200 | `/api/v1/admin/jobs` | ✅ | Jobs listed |
| 200 | `/api/v1/admin/jobs?limit=5` | ✅ | |
| 200 | `/api/v1/admin/disputes` | ✅ | Service disputes listed |
| 200 | `/api/v1/admin/disputes/goods` | ✅ | Goods disputes listed |
| **503** | `/api/v1/admin/guarantee-claims` | ✅ | **Expected** — flag `nomarkup_guarantee` off; body `This feature is currently unavailable` |
| 200 | `/api/v1/admin/reviews/flagged` | ✅ | Empty flags OK |
| 200 | `/api/v1/admin/payments` | ✅ | 14 payments |
| 200 | `/api/v1/admin/payments?limit=5` | ✅ | |
| 200 | `/api/v1/admin/payments/fee-config` | ✅ | fee_percentage 0.08, etc. |
| 200 | `/api/v1/admin/revenue` | ✅ | GMV / revenue aggregates |
| 200 | `/api/v1/admin/banking` | ✅ | `{"account":null}` (no platform bank set) |
| 200 | `/api/v1/admin/advances` | ✅ | Flag `working_capital` enabled |
| 200 | `/api/v1/admin/platform/metrics` | ✅ | |
| 200 | `/api/v1/admin/platform/growth` | ✅ | |
| 200 | `/api/v1/admin/platform/categories` | ✅ | |
| 200 | `/api/v1/admin/platform/geographic` | ✅ | Empty regions OK |
| 200 | `/api/v1/admin/subscriptions` | ✅ | 3 subscriptions |
| 200 | `/api/v1/admin/challenges` | ✅ | |
| 200 | `/api/v1/admin/insurance/claims` | ✅ | Flag `per_job_insurance` enabled; empty claims |
| 200 | `/api/v1/admin/listings` | ✅ | Marketplace listings |
| 200 | `/api/v1/admin/goods-reports` | ✅ | 3 reports |
| 200 | `/api/v1/admin/user-reports` | ✅ | 2 reports |
| 200 | `/api/v1/admin/markets` | ✅ | Full market catalog |
| 200 | `/api/v1/admin/flags` | ✅ | Feature flag map |

---

## Results — detail GETs (live + probe IDs)

IDs resolved from list endpoints:

| Entity | ID |
|--------|-----|
| User | `d21e56a0-b500-4a9f-b8cf-0c63ca40103a` (Carlos Customer) |
| Payment | `518091d0-1572-48f9-a875-c734612dadb8` |
| Dispute | `5c045c87-279d-41ea-bba9-43933eac5ff0` |

| Status | Path | Pass? | Notes |
|-------:|------|:-----:|-------|
| 200 | `/api/v1/admin/users/{live}` | ✅ | Full user payload |
| 200 | `/api/v1/admin/fraud/users/{live}/risk` | ✅ | risk_level low |
| 200 | `/api/v1/admin/disputes/{live}` | ✅ | Dispute detail |
| 200 | `/api/v1/admin/payments/{live}` | ✅ | Fee breakdown present |
| 200 | `/api/v1/admin/fraud/users/00000000-0000-0000-0000-000000000001/risk` | ✅ | Admin subject risk profile |
| 404 | `/api/v1/admin/users/00000000-0000-0000-0000-000000000099` | ✅ | `user not found` |
| 404 | `/api/v1/admin/disputes/00000000-0000-0000-0000-000000000099` | ✅ | `dispute not found` |
| 404 | `/api/v1/admin/payments/00000000-0000-0000-0000-000000000099` | ✅ | `payment not found` |

---

## Soft-id regression (post recent fixes)

| Status | Path | Pass? | Notes |
|-------:|------|:-----:|-------|
| 200 | `/api/v1/payments/methods` | ✅ | `{"methods":[]}` — no 500; empty wallet OK for this seed |
| 200 | `/api/v1/providers/me/stripe/status` | ✅ | Status object returned (`transfers_ready: false` etc.); no soft-id crash |

Both paths previously at risk of 500s when UUID/string soft-id coercion was wrong. Smoke confirms they remain healthy under the admin+provider seed token.

---

## Feature-flag GET surface (observed)

| Flag key (route) | Observed status | Interpretation |
|------------------|----------------:|----------------|
| `legal_services` (`/admin/licenses`) | 200 | Enabled |
| `insurance_competition` (`/admin/insurers`) | 200 | Enabled |
| `working_capital` (`/admin/advances`) | 200 | Enabled |
| `per_job_insurance` (`/admin/insurance/claims`) | 200 | Enabled |
| `nomarkup_guarantee` (`/admin/guarantee-claims`) | **503** | Disabled — fail-closed (expected) |

---

## Fail / Pass summary table

| Endpoint group | Status | Verdict |
|----------------|-------:|:-------:|
| Auth login (admin) | 200 | **PASS** |
| Fraud alerts + user risk | 200 | **PASS** |
| Users list + get | 200 / 404 | **PASS** |
| Verification queue | 200 | **PASS** |
| Licenses (flag) | 200 | **PASS** |
| Insurers (flag) | 200 | **PASS** |
| Jobs list | 200 | **PASS** |
| Disputes (service + goods + detail) | 200 / 404 | **PASS** |
| Guarantee claims (flag off) | 503 | **PASS** (intentional) |
| Reviews flagged | 200 | **PASS** |
| Payments list / fee-config / detail / revenue | 200 / 404 | **PASS** |
| Banking | 200 | **PASS** |
| Advances (flag) | 200 | **PASS** |
| Platform metrics / growth / categories / geographic | 200 | **PASS** |
| Subscriptions | 200 | **PASS** |
| Challenges | 200 | **PASS** |
| Insurance claims (flag) | 200 | **PASS** |
| Listings | 200 | **PASS** |
| Goods reports | 200 | **PASS** |
| User reports | 200 | **PASS** |
| Markets | 200 | **PASS** |
| Feature flags | 200 | **PASS** |
| Customer payment-methods (soft-id) | 200 | **PASS** |
| Provider stripe/status (soft-id) | 200 | **PASS** |
| Unexpected 500s | — | **NONE** |

### Overall: **PASS** (0 unexpected failures; 0 code changes)

---

## Out of scope (not exercised)

- All **POST/PUT/PATCH/DELETE** admin mutations (suspend, ban, resolve, fee updates, disburse, etc.)
- Admin MFA challenge path
- Non-admin role denial matrix (403)
- Unauthenticated matrix (401) — only confirmed `/health` public vs protected routes require auth
- Production edge / CDN behavior

## Reproduce

```bash
BASE=http://127.0.0.1:8081
TOKEN=$(curl -s -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@nomarkup.com","password":"Password123!"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

for p in \
  /api/v1/admin/fraud/alerts \
  /api/v1/admin/users \
  /api/v1/admin/verification/queue \
  /api/v1/admin/licenses \
  /api/v1/admin/insurers \
  /api/v1/admin/jobs \
  /api/v1/admin/disputes \
  /api/v1/admin/disputes/goods \
  /api/v1/admin/guarantee-claims \
  /api/v1/admin/reviews/flagged \
  /api/v1/admin/payments \
  /api/v1/admin/payments/fee-config \
  /api/v1/admin/revenue \
  /api/v1/admin/banking \
  /api/v1/admin/advances \
  /api/v1/admin/platform/metrics \
  /api/v1/admin/platform/growth \
  /api/v1/admin/platform/categories \
  /api/v1/admin/platform/geographic \
  /api/v1/admin/subscriptions \
  /api/v1/admin/challenges \
  /api/v1/admin/insurance/claims \
  /api/v1/admin/listings \
  /api/v1/admin/goods-reports \
  /api/v1/admin/user-reports \
  /api/v1/admin/markets \
  /api/v1/admin/flags \
  /api/v1/payments/methods \
  /api/v1/providers/me/stripe/status
do
  code=$(curl -s -o /tmp/body -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE$p")
  echo "$code  $p"
done
```
