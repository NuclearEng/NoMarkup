# Persona mutation / write-path e2e workflows — 2026-08-05

**Target:** local gateway `http://127.0.0.1:8081`  
**Auth:** `POST /api/v1/auth/login` with seed password `Password123!`  
**Method:** Python `urllib` (no browser)  
**Generated:** 2026-08-06 (UTC session; date-stamped per request)

| Metric | Value |
|--------|------:|
| **PASS** | **20** |
| **FAIL** | **0** (after draft-capacity free; see note) |
| **Hard 5xx** | **0** |
| Gateway bug fixes applied | none required |

> **Draft-capacity note:** First `POST /api/v1/jobs` with `publish: false` returned **422** `maximum of 10 draft jobs allowed` (domain rule, not a gateway bug — job service maps `ErrDraftLimitExceeded` → gRPC `FailedPrecondition` → HTTP 422). Customer seed had **12** drafts (over prior runs). Cancelled 3 non-production draft jobs via `POST /jobs/{id}/cancel`, then create returned **201**. Documented as **PASS** for the write path after capacity free; initial 422 is expected product behavior.

---

## Dual-role inventory (`GET /api/v1/users/me`)

| Persona | Email | User ID | Roles from `/users/me` |
|---------|-------|---------|------------------------|
| customer | `customer@nomarkup.com` | `00000000-0000-0000-0000-000000000002` | **`customer`, `provider`** (dual-role seed) |
| provider | `provider@nomarkup.com` | `00000000-0000-0000-0000-000000000003` | **`provider`** |
| admin | `admin@nomarkup.com` | `00000000-0000-0000-0000-000000000001` | **`admin`, `provider`** |

Customer JWT access token claims also encode `roles: ["customer","provider"]` (matches `/users/me`). Customer can hit provider-side reads (`/providers/me`, `/provider/offers`, seller analytics) when dual-role is present — consistent with prior `persona-e2e-api-2026-08-05.md` smoke.

---

## Customer workflow

| # | Step | Method | Path | HTTP | Status | Notes |
|---|------|--------|------|-----:|--------|-------|
| 0 | Health (preflight) | GET | `/health` | 200 | **PASS** | `{"status":"ok","version":"dev"}` |
| 1 | Login | POST | `/api/v1/auth/login` | 200 | **PASS** | Returns `access_token` + `user_id` |
| 1b | Me / roles | GET | `/api/v1/users/me` | 200 | **PASS** | roles=`[customer, provider]`; display_name=QA Tester |
| 2 | List jobs | GET | `/api/v1/jobs?page=1&page_size=10` | 200 | **PASS** | 10 jobs; sample open/active id `655fbdfa-662d-44a8-aeed-675e83add3f9` |
| 3a | Create draft (first try) | POST | `/api/v1/jobs` (`publish:false`) | 422 | **EXPECTED** | `maximum of 10 draft jobs allowed` — business cap |
| 3b | Free capacity | POST | `/api/v1/jobs/{id}/cancel` ×3 | 200 | **PASS** | Cancelled leftover fraud/velocity test drafts only |
| 3c | Create draft (retry) | POST | `/api/v1/jobs` (`publish:false`) | **201** | **PASS** | id=`f31f1987-93f3-4b8a-ad39-68cd62b38ab5`, status=`draft` |
| 4 | My jobs | GET | `/api/v1/jobs/mine?page=1&page_size=10` | 200 | **PASS** | pagination works (total seed volume large) |
| 5a | Contracts | GET | `/api/v1/contracts?page=1&page_size=20` | 200 | **PASS** | 20 rows returned on page 1 |
| 5b | Payment methods | GET | `/api/v1/payments/methods` | 200 | **PASS** | `{"methods":[]}` — empty Stripe methods for seed customer |

### Draft create body used (local-only, not published)

```json
{
  "title": "Persona e2e draft <unix>",
  "description": "Local-only persona e2e draft job — do not publish. Safe smoke.",
  "category_id": "db487d00-fca2-4a17-9f4a-a926b8a306da",
  "property_id": "00000000-0000-0000-0000-000000000010",
  "schedule_type": "flexible",
  "auction_type": "sealed",
  "auction_duration_hours": 72,
  "starting_bid_cents": 45000,
  "publish": false,
  "location_address": "94102",
  "location_lat": 37.7749,
  "location_lng": -122.4194
}
```

**Created draft id:** `f31f1987-93f3-4b8a-ad39-68cd62b38ab5` (left as draft; not published).

---

## Provider workflow

| # | Step | Method | Path | HTTP | Status | Notes |
|---|------|--------|------|-----:|--------|-------|
| 1 | Login | POST | `/api/v1/auth/login` | 200 | **PASS** | user_id `…0003` |
| 1b | Me / roles | GET | `/api/v1/users/me` | 200 | **PASS** | roles=`[provider]`; display_name=Mike Provider |
| 2 | Instant-match offers | GET | `/api/v1/provider/offers` | 200 | **PASS** | `{"offers":[]}` |
| 3a | Open jobs | GET | `/api/v1/jobs?page=1&page_size=10` | 200 | **PASS** | first job `655fbdfa-662d-44a8-aeed-675e83add3f9` |
| 3b | Job bids | GET | `/api/v1/jobs/{id}/bids` | **403** | **PASS** | Sealed auction: non-owner provider cannot list bids (authz, not outage) |
| 4 | Stripe Connect status | GET | `/api/v1/providers/me/stripe/status` | 200 | **PASS** | `charges_enabled=false`, `payouts_enabled=false`, details not submitted (dev seed) |
| 5 | Seller analytics | GET | `/api/v1/me/seller-analytics?range=30d` | 200 | **PASS** | `range_days=30`, sell_through_rate present |

No destructive mutations (no bid placement / award / cancel of live jobs).

---

## Admin workflow (read-only)

| # | Step | Method | Path | HTTP | Status | Notes |
|---|------|--------|------|-----:|--------|-------|
| 1 | Login | POST | `/api/v1/auth/login` | 200 | **PASS** | user_id `…0001` |
| 1b | Me / roles | GET | `/api/v1/users/me` | 200 | **PASS** | roles=`[admin, provider]` |
| 2 | Feature flags | GET | `/api/v1/admin/flags` | 200 | **PASS** | **flag count = 16** |
| 3a | Disputes | GET | `/api/v1/admin/disputes?page=1` | 200 | **PASS** | Seed disputes present (e.g. contract `…0301`) |
| 3b | Users page 1 | GET | `/api/v1/admin/users?page=1&page_size=5` | 200 | **PASS** | `totalCount=39`, `totalPages=8`, `hasNext=true` |

**Explicitly not exercised (destructive / money-sensitive):** ban/suspend user, toggle money flags, resolve disputes, fee-config writes, marketplace suspend/cancel.

### Flag keys observed (count 16)

Sample keys from response include: `background_checks`, `customer_bnpl`, `fair_price_index`, plus remaining platform flags (money keys marked `binary_only: true` in payload). Full list available from `GET /api/v1/admin/flags` on this env.

---

## 5xx / gateway bug scan

| Finding | Severity | Action |
|---------|----------|--------|
| No HTTP 500 on any persona step | — | No fix required |
| Draft limit 422 | product rule | Documented; capacity free → 201 |
| Sealed job bids 403 for provider | product authz | Documented as PASS |
| Customer dual-role | seed design | Documented |

Domain mapping for draft cap lives in:

- `services/job/internal/domain/types.go` — `ErrDraftLimitExceeded`
- `services/job/internal/grpc/server.go` — `codes.FailedPrecondition` → gateway 422

---

## Pass/fail summary by persona

| Persona | Steps exercised | Result |
|---------|----------------:|--------|
| public | 1 | **PASS** |
| customer | 8 (+ capacity free) | **PASS** (write path after free) |
| provider | 7 | **PASS** |
| admin | 5 | **PASS** (read-only) |
| **Overall** | **~21** | **PASS — 0 hard fails, 0×500** |

---

## Residual / follow-ups (non-blocking)

1. **Draft inventory hygiene on seed customer:** 10+ drafts accumulate from fraud/velocity/e2e runs; consider seed cleanup or higher cap in dev only.
2. **`GET /jobs/mine` default list** does not surface drafts on early pages when total volume is high — use `?status=draft` or `GET /api/v1/jobs/drafts` for draft management (both work).
3. **Provider Stripe:** seed account not onboarded (`charges_enabled=false`) — expected for local; not a regression.
4. **Sealed bid list 403:** correct for reverse auction sealed visibility; open/live auction bid list was not retested here.

---

## Repro

```bash
# Login
curl -sS -X POST http://127.0.0.1:8081/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@nomarkup.com","password":"Password123!"}'

# Subsequent calls: Authorization: Bearer <access_token>
# Customer write (draft): POST /api/v1/jobs with publish:false
# Provider: GET /api/v1/provider/offers, /providers/me/stripe/status, /me/seller-analytics?range=30d
# Admin: GET /api/v1/admin/flags, /admin/disputes?page=1, /admin/users?page=1&page_size=5
```

**Related:** broader read-only matrix in [`persona-e2e-api-2026-08-05.md`](./persona-e2e-api-2026-08-05.md) (ok=86, hard_fail=0).
