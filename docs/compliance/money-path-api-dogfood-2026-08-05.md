# Money-Path API Dogfood — 3 Seed Roles — 2026-08-05

**Target:** `http://127.0.0.1:8081`  
**Auth:** `POST /api/v1/auth/login` → Bearer `access_token` (RS256 JWT)  
**Seed password:** `Password123!` (not committed; used only for local dogfood)  
**Actors:**

| Role label | Email | Seed user id | `roles` from `/users/me` |
|------------|-------|--------------|--------------------------|
| customer | `customer@nomarkup.com` | `00000000-0000-0000-0000-000000000002` | `customer`, `provider` |
| provider | `provider@nomarkup.com` | `00000000-0000-0000-0000-000000000003` | `provider` |
| admin | `admin@nomarkup.com` | `00000000-0000-0000-0000-000000000001` | `admin`, `provider` |

**Scope:** Login + money-adjacent / catalog reads required for iOS/web dogfood of customer, provider, and admin surfaces. Mutations (place bid, create payment, Stripe account create) out of scope for this pass.

**Method:** Python `urllib` against live gateway (equivalent to curl). Bodies redacted — no tokens stored in this doc. Router SSOT: `gateway/internal/router/router.go`.

---

## Verdict

| Class | Count | Result |
|-------|------:|--------|
| Required role reads **200** | all required | **PASS** |
| Public unauth catalog **200** | 3 | **PASS** |
| Path-shape 404 (literal `/api/v1/me`, `/api/v1/me/stripe/status`) | 2 shapes | **NOTE** (not 500; correct paths below) |
| Unexpected **5xx** | **0** | **PASS** |

**No FAIL (500).** No code fix required for this dogfood pass. Clients must use canonical paths `/api/v1/users/me` and `/api/v1/providers/me/stripe/status` (not bare `/api/v1/me*`).

---

## Results table

| Endpoint | Role | Status | Note |
|----------|------|-------:|------|
| `GET /health` | unauth | **200** | `{"status":"ok","version":"dev"}` |
| `GET /api/v1/jobs?page=1&page_size=2` | unauth | **200** | Public catalog; `totalCount` 393; sample Austin jobs |
| `GET /api/v1/listings?page=1&page_size=2` | unauth | **200** | Public marketplace; active goods listings returned |
| `POST /api/v1/auth/login` | customer | **200** | Token issued; `user_id` …0002 |
| `GET /api/v1/jobs?page=1&page_size=5` | customer | **200** | Job list + pagination OK |
| `GET /api/v1/listings?page=1&page_size=5` | customer | **200** | Listings list OK |
| `GET /api/v1/payments/methods` | customer | **200** | `{"methods":[]}` — empty wallet OK, **not 500** |
| `GET /api/v1/payments/methods` (+ `Idempotency-Key`) | customer | **200** | Same empty list; GET does not require key in practice |
| `GET /api/v1/me` | customer | **404** | **Not mounted** — chi `404 page not found` |
| `GET /api/v1/users/me` | customer | **200** | Canonical me; roles include `customer` (+ seed also has `provider`) |
| `POST /api/v1/auth/login` | provider | **200** | Token issued; `user_id` …0003 |
| `GET /api/v1/jobs?page=1` | provider | **200** | Job browse OK |
| `GET /api/v1/me/stripe/status` | provider | **404** | Wrong path shape — not mounted under bare `/me` |
| `GET /api/v1/providers/me/stripe/status` | provider | **200** | **iOS/Connect path** — `charges_enabled:false`, `payouts_enabled:false`, `details_submitted:false`, `transfers_ready:false`, `stripe_transfers_status:"unrequested"` (seed not onboarded; intentional 200, not 500) |
| `GET /api/v1/bids/mine` | provider | **200** | Service reverse-auction bids; 20 rows; sample active bid `45000` cents |
| `GET /api/v1/listings/bids/mine` | provider | **200** | Goods marketplace bids history OK |
| `GET /api/v1/users/me` | provider | **200** | roles: `["provider"]`, status `active` |
| `GET /api/v1/providers/me` | provider | **200** | Provider profile (`business_name` present) |
| `POST /api/v1/auth/login` | admin | **200** | Token issued; `user_id` …0001 |
| `GET /api/v1/me` | admin | **404** | Same as customer — use `/users/me` |
| `GET /api/v1/users/me` | admin | **200** | roles: `["admin","provider"]` — **admin role confirmed** |
| `GET /api/v1/admin/flags` | admin | **200** | Admin-only list; **16** flags; sample `background_checks` off, `customer_bnpl` on |
| `GET /api/v1/admin/users?page=1&page_size=5` | admin | **200** | Admin-only users list; pagination `totalCount` 39 |

---

## Path map (money / identity)

| Intent | Canonical path | Auth |
|--------|----------------|------|
| Session user | `GET /api/v1/users/me` | Bearer |
| Provider profile | `GET /api/v1/providers/me` | Bearer + provider role |
| Stripe Connect account status (iOS) | `GET /api/v1/providers/me/stripe/status` | Bearer + provider |
| Stripe onboarding link | `GET /api/v1/providers/me/stripe/onboarding` | Bearer + provider |
| Payment methods | `GET /api/v1/payments/methods` | Bearer |
| Service bids (provider) | `GET /api/v1/bids/mine` | Bearer |
| Goods bids (buyer) | `GET /api/v1/listings/bids/mine` | Bearer |
| Feature flags (admin) | `GET /api/v1/admin/flags` | Bearer + admin |
| Users search (admin) | `GET /api/v1/admin/users` | Bearer + admin |

Router refs: payments group `router.go` ~900–908; Stripe Connect under `/providers` + `RequireProvider` ~606–609; `bids/mine` ~677–678; admin flags ~1202; users me ~476–477.

---

## FAIL / 500 log

**None.** Zero HTTP 500 responses on any call in this matrix.

Non-500 notes only:

1. **`GET /api/v1/me` → 404** — product/docs often say “/me”; wire path is **`/api/v1/users/me`**. Body: `404 page not found`.
2. **`GET /api/v1/me/stripe/status` → 404** — wire path is **`/api/v1/providers/me/stripe/status`**.
3. **Stripe status all false / unrequested** — seed provider has no completed Connect onboarding; returns structured 200, not an error. Suitable for iOS “finish payout setup” UX.
4. **Customer seed dual role** — `customer@nomarkup.com` returns `roles: ["customer","provider"]`. Dogfood still treats it as the customer persona for catalog + payment-methods reads.

---

## Curl recipes (local)

```bash
BASE=http://127.0.0.1:8081

# Unauth smoke
curl -sS -w '\n%{http_code}\n' "$BASE/health"
curl -sS -w '\n%{http_code}\n' "$BASE/api/v1/jobs?page=1&page_size=5"
curl -sS -w '\n%{http_code}\n' "$BASE/api/v1/listings?page=1&page_size=5"

# Login (print status only; do not log token)
TOKEN=$(curl -sS -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@nomarkup.com","password":"Password123!"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

curl -sS -w '\n%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v1/payments/methods"
curl -sS -w '\n%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v1/users/me"

# Provider Connect + bids
TOKEN=$(curl -sS -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"provider@nomarkup.com","password":"Password123!"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

curl -sS -w '\n%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v1/providers/me/stripe/status"
curl -sS -w '\n%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v1/bids/mine"

# Admin
TOKEN=$(curl -sS -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@nomarkup.com","password":"Password123!"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

curl -sS -w '\n%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v1/users/me"
curl -sS -w '\n%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v1/admin/flags"
```

**Secrets policy:** tokens and password used only in ephemeral shell; not written into git. Rotate seed password before any shared/staging deploy.

---

## Follow-ups (non-blocking)

| Item | Priority | Note |
|------|----------|------|
| iOS/web “/me” alias | low | If mobile still hardcodes `/api/v1/me`, it will 404; confirm clients use `/users/me` |
| Seed Connect onboarding | optional | Provider payout UI will show incomplete until Stripe test onboarding completes |
| Dual-role customer seed | doc | Customer also has `provider` — intentional for QA or seed quirk; do not assume single-role |

---

*Generated 2026-08-05 from live dogfood against gateway on `127.0.0.1:8081`.*
