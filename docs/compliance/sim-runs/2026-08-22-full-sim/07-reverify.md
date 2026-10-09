# SIM re-verify — live wiring / workflows / security (2026-08-22)

- **Date:** 2026-08-22 ~19:08 UTC
- **API:** `http://127.0.0.1:8081`
- **Mode:** audit-only (no product edits, no commit)
- **Client SoT:** `ios/NoMarkup/Core/APIClient.swift` + `APIClient+*.swift` (not invented)
- **Tokens:** withheld. Login JSON keys only: `user_id`, `access_token`, `access_token_expires_at`.
- **Readiness:** **GREEN** — gateway up; zero FAIL / GAP / BLOCKED.

| Metric | Value |
|--------|--------|
| **PASS** | 13 |
| **FAIL** | 0 |
| **GAP** | 0 |
| **N/A** | 1 (`GET /api/v1/me` is not a Chi route; clients use `GET /api/v1/users/me`) |
| **BLOCKED** | 0 |
| **Catalog listings** | **n=23 / total=23** · all `status=active` · none past `auction_ends_at` |
| **Open jobs** | **n=3 / totalCount=3** · all `status=active` · none past `auction_ends_at` |
| **Activity** | **HTTP 200** all 4 personas (`{events}` n=50); unauth **401** (not 404) |

Do **not** claim PASS if `/health` is down. This run: **200**.

---

## Environment

```
GET http://127.0.0.1:8081/health  → 200 {"status":"ok","version":"dev"}
GET http://127.0.0.1:8081/readyz  → 200
```

Clock used for auction windows: `2026-08-22T19:08:25Z` (script) / `2026-08-22T19:08:58Z` (range pass).

Seed: `customer@` / `provider@` / `admin@` / `provider2@nomarkup.com` · `Password123!`

Exact paths (iOS, not invented):

| Probe | iOS | Chi |
|-------|-----|-----|
| login | `APIClient.swift:99` `POST /api/v1/auth/login` | `router.go` Login |
| me | `APIClient+Platform.swift:222` `GET /api/v1/users/me` | `router.go:497` `r.Get("/me", userHandler.GetMe)` under `/users` |
| activity | `APIClient+Extras.swift:912` `GET /api/v1/me/activity` | `router.go:529` |
| notifications | `APIClient.swift:1053` `GET /api/v1/notifications` | notifications group |
| jobs mine | `APIClient.swift:548` `GET /api/v1/jobs/mine` | jobs group |
| instant offers | `APIClient+Provider.swift:127` `GET /api/v1/provider/offers` | |
| payouts | `APIClient+Extras.swift:537` `GET /api/v1/providers/me/stripe/status` | |
| admin flags | `APIClient+Admin.swift:8` `GET /api/v1/admin/flags` | |
| place listing bid | `APIClient.swift:909` `POST /api/v1/listings/{id}/bids` | |
| place job bid | `APIClient.swift:877` `POST /api/v1/jobs/{id}/bids` | |
| public listings | `APIClient.swift:385` `GET /api/v1/listings` | |
| public jobs | `APIClient.swift:484` `GET /api/v1/jobs` (`status=open` aliases `active`) | |

---

## Findings

### [SIM-WIRE.1] Gateway health
- Status: PASS
- Severity: blocker
- Surface: `GET /health` (+ `GET /readyz`)
- Evidence: HTTP **200** body `{"status":"ok","version":"dev"}`; readyz **200**
- Expected: 200 while live re-verify runs
- Actual: 200
- Remediation: none
- Confidence: 10

### [SIM-WIRE.2] Public goods catalog
- Status: PASS
- Severity: major
- Surface: `GET /api/v1/listings?page=1&page_size=60`
- Evidence:
  - HTTP **200** `{listings, pagination}`
  - **n=23 / total=23** (`page=1`, `page_size=60`, `has_next=false`, `total_pages=1`)
  - statuses: `{active: 23}` — none other
  - `auction_ends_at` present on all 23; **past_count=0**; **missing_end=0**
  - window: min `2026-08-23T18:17:02.985384Z` · max `2026-08-29T18:17:02.985384Z` (all > now)
  - sample: `00000000-0000-4000-a000-00000000a01a` “IKEA KALLAX 4×4 shelf with doors” `status=active`
- Expected: n>0, every row `status=active`, none past `auction_ends_at`
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.3] Public open jobs (live reverse-auction window)
- Status: PASS
- Severity: major
- Surface: `GET /api/v1/jobs?status=open` (also confirmed `page_size=60`)
- Evidence:
  - HTTP **200** `{jobs, pagination}`
  - **n=3 / totalCount=3** (`hasNext=false`)
  - statuses: `{active: 3}` (`open` aliases `active` per `APIClient.swift:417`)
  - `auction_ends_at` on all 3; **past_count=0**; **missing_end=0**
  - all three end `2026-08-24T18:17:03Z` (future)
  - titles: “Review SaaS vendor contract before signing”; “One-hour business law consultation for new LLC”; “AC Unit Not Cooling Properly”
- Expected: n>0, all active, live auction window
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.4] Login — four seed personas
- Status: PASS
- Severity: blocker
- Surface: `POST /api/v1/auth/login` body `{email, password}`
- Evidence:

| Persona | HTTP | Token | `user_id` |
|---------|------|-------|-----------|
| `customer@nomarkup.com` | **200** | yes | `00000000-0000-0000-0000-000000000002` |
| `provider@nomarkup.com` | **200** | yes | `00000000-0000-0000-0000-000000000003` |
| `admin@nomarkup.com` | **200** | yes | `00000000-0000-0000-0000-000000000001` |
| `provider2@nomarkup.com` | **200** | yes | `00000000-0000-0000-0000-000000000004` |

- Expected: 200 + `access_token` for each seed
- Actual: Match. No `roles` on login JSON (roles come from `/users/me`)
- Remediation: none
- Confidence: 10

### [SIM-WIRE.5] `GET /api/v1/users/me` (canonical “me”)
- Status: PASS
- Severity: major
- Surface: `APIClient+Platform.swift:220` `fetchMe`
- Evidence (Bearer):

| Persona | HTTP | email | roles | status |
|---------|------|-------|-------|--------|
| customer | **200** | `customer@nomarkup.com` | `customer`, `provider` | active |
| provider | **200** | `provider@nomarkup.com` | `provider` | active |
| admin | **200** | `admin@nomarkup.com` | `admin`, `provider` | active |
| provider2 | **200** | `provider2@nomarkup.com` | `provider` | active |

- Expected: 200 owner profile; roles match seed
- Actual: Match. Seed customer also has `provider` (dual-role, not a wiring miss)
- Remediation: none
- Confidence: 10

### [SIM-WIRE.6] `GET /api/v1/me/activity` must not 404
- Status: PASS
- Severity: major
- Surface: `APIClient+Extras.swift:909` `fetchMeActivity` · `router.go:529`
- Evidence:

| Caller | HTTP | Body |
|--------|------|------|
| customer | **200** | `{events}` n=50 |
| provider | **200** | `{events}` n=50 |
| admin | **200** | `{events}` n=50 |
| provider2 | **200** | `{events}` n=50 |
| unauthenticated | **401** | `{"error":"missing authorization header"}` |

- Expected: authed 200 (not 404); unauth 401
- Actual: Match. 50 is the list cap on this hop, not a miss
- Remediation: none
- Confidence: 10

### [SIM-WIRE.7] Notifications inbox
- Status: PASS
- Severity: advisory
- Surface: `GET /api/v1/notifications` (`APIClient.swift:1053`)
- Evidence:

| Persona | HTTP | n / totalCount |
|---------|------|----------------|
| customer | **200** | 18 / 18 |
| provider | **200** | 19 / 19 |
| admin | **200** | 20 / 20 |
| provider2 | **200** | 19 / 19 |

- Expected: 200 `{notifications, pagination}` for signed-in users
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.8] Customer jobs mine
- Status: PASS
- Severity: advisory
- Surface: `GET /api/v1/jobs/mine` (`APIClient.swift:548`)
- Evidence: customer Bearer **200** `{jobs, pagination}` **jobs_n=5 / totalCount=5**
- Expected: route exists; customer can list own jobs
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.9] Provider instant offers + payouts
- Status: PASS
- Severity: advisory
- Surface: `GET /api/v1/provider/offers` · `GET /api/v1/providers/me/stripe/status`
- Evidence:

| Persona | offers | stripe/status |
|---------|--------|----------------|
| provider | **200** `{offers}` n=0 | **200** `charges_enabled=false` `payouts_enabled=false` `details_submitted=false` |
| provider2 | **200** `{offers}` n=0 | **200** same seed Stripe-not-onboarded shape |

- Expected: routes exist; 200 (empty offers OK; Connect not onboarded in seed)
- Actual: Match. Empty inbox is seed state, not a 404
- Remediation: none
- Confidence: 10

### [SIM-WIRE.10] Admin flags
- Status: PASS
- Severity: major
- Surface: `GET /api/v1/admin/flags` (`APIClient+Admin.swift:8`)
- Evidence: admin Bearer **200** `{flags}` **flags_n=16**
- Expected: admin 200 with flag rows
- Actual: Match (16 keys, Claude.md inventory)
- Remediation: none
- Confidence: 10

### [SIM-SEC.1] Customer hitting admin route → 403
- Status: PASS
- Severity: blocker
- Surface: `GET /api/v1/admin/flags` with customer (and provider) JWT
- Evidence:
  - customer **403** `{"error":"admin access required"}` — not 200, not 500
  - provider **403** same error (extra check)
  - admin **200** (control)
- Expected: non-admin 403
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-SEC.2] Wrong password → 401 not 500
- Status: PASS
- Severity: blocker
- Surface: `POST /api/v1/auth/login` `customer@nomarkup.com` / `WrongPassword!!`
- Evidence: HTTP **401** `{"error":"invalid credentials"}`
- Expected: 401
- Actual: 401 (not 500)
- Remediation: none
- Confidence: 10

### [SIM-SEC.3] Unauthenticated money POST (place bid) → 401
- Status: PASS
- Severity: blocker
- Surface: listing + job bid POSTs without `Authorization` (`APIClient.swift:866–918`, `authorized: .required`)
- Evidence:
  - `POST /api/v1/listings/00000000-0000-4000-a000-00000000a012/bids` body `{"amount_cents":100}` → **401** `{"error":"missing authorization header"}`
  - `POST /api/v1/jobs/00000000-0000-0000-0000-000000000103/bids` body `{"amount_cents":100}` → **401** same
- Expected: 401 (fail closed; no 200/500)
- Actual: Match on both goods and services bid paths
- Remediation: none
- Confidence: 10

### [SIM-WIRE.11] Bare `GET /api/v1/me` (task wording vs real path)
- Status: N/A
- Severity: advisory
- Surface: `GET /api/v1/me` (not called by iOS or web)
- Evidence: all 4 personas **404** `404 page not found`. Chi mounts profile at `/api/v1/users/me` (`router.go:496–497`). Clients: iOS `fetchMe` → `["api","v1","users","me"]`; activity is the only `/api/v1/me/...` profile-adjacent hop (`/me/activity`).
- Expected: do not invent an alias; probe the path the app uses
- Actual: alias 404; canonical `/users/me` 200 (SIM-WIRE.5)
- Remediation: none — adding `/api/v1/me` would be a new public alias, not a <20-line FAIL fix
- Confidence: 10

---

## Per-persona matrix

| Path | customer | provider | admin | provider2 | unauth |
|------|----------|----------|-------|-----------|--------|
| `POST /auth/login` | 200 | 200 | 200 | 200 | — |
| `GET /api/v1/me` | 404 | 404 | 404 | 404 | — |
| `GET /users/me` | 200 | 200 | 200 | 200 | — |
| `GET /me/activity` | **200** | **200** | **200** | **200** | **401** |
| `GET /notifications` | 200 | 200 | 200 | 200 | — |
| `GET /jobs/mine` | 200 (5) | — | — | — | — |
| `GET /provider/offers` | — | 200 (0) | — | 200 (0) | — |
| `GET /providers/me/stripe/status` | — | 200 | — | 200 | — |
| `GET /admin/flags` | **403** | **403** | **200** (16) | — | — |

Wrong password and unauth bids: see SIM-SEC.2 / SIM-SEC.3.

---

## Fixes applied

None. No FAIL with `file:line` that is a <20-line product bug. Gateway was up; catalog live; authz fail-closed.

---

## Reproduce

```bash
API=http://127.0.0.1:8081
curl -sS -w '\nHTTP %{http_code}\n' $API/health
curl -sS "$API/api/v1/listings?page=1&page_size=60" | python3 -c 'import json,sys,datetime; d=json.load(sys.stdin); print(len(d["listings"]), d["pagination"]["total"])'
curl -sS "$API/api/v1/jobs?status=open" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d["jobs"]), d["pagination"])'
# then POST /api/v1/auth/login per persona and Bearer-GET the matrix above
```

Raw redacted JSON from this run: `/tmp/nm-reverify/` (local, not committed).

---

## Disclaimer

Live local seed gateway only. Tokens not stored in this report. Mutations limited to login + rejected unauth bids (no placed bids, no flag writes). iOS Simulator was not re-launched this pass — this document is HTTP re-proof of wiring/authz against `:8081`.

---

## Recheck — 2026-08-22T20:25:22Z

- **Clock:** 2026-08-22T20:25:22Z (catalog) / 2026-08-22T20:25:37Z (auth)
- **API:** `http://127.0.0.1:8081`
- **Mode:** audit-only (no product edits, no commit)
- **Readiness:** **GREEN** — gateway up; required probe set all PASS.

| Metric | Value |
|--------|--------|
| **PASS** | **8** (required) + 2 extra (unauth activity 401, unauth job bid 401) |
| **FAIL** | **0** |
| **GAP** | 0 |
| **BLOCKED** | 0 |
| **Catalog listings** | **n=23 / total=23** · all `status=active` · `past_count=0` |
| **Open jobs** | **n=3 / totalCount=3** · all `status=active` · `past_count=0` |

| Probe | HTTP | Result |
|-------|------|--------|
| `GET /health` | **200** | `{"status":"ok","version":"dev"}` — **PASS** |
| `GET /readyz` | **200** | postgres ok, redis ok — extra, not in required 8 |
| `GET /api/v1/listings?page=1&page_size=60` | **200** | n=23/23 all `active`; window min `2026-08-23T18:17:02.985384Z` max `2026-08-29T18:17:02.985384Z` — **PASS** |
| `GET /api/v1/jobs?status=open` | **200** | n=3/3 all `active`; all end `2026-08-24T18:17:03Z` — **PASS** |
| `POST /api/v1/auth/login` `customer@nomarkup.com` / `Password123!` | **200** | keys `user_id`, `access_token`, `access_token_expires_at`; `user_id=00000000-0000-0000-0000-000000000002`; expires `2026-08-22T20:40:37Z` — **PASS** |
| `GET /api/v1/me/activity` (customer Bearer) | **200** | `{events}` n=50 — not 404 — **PASS** |
| `GET /api/v1/users/me` (customer Bearer) | **200** | email `customer@nomarkup.com` roles `customer, provider` status `active` — **PASS** |
| `POST /api/v1/auth/login` wrong password | **401** | `{"error":"invalid credentials"}` — **PASS** |
| `POST /api/v1/listings/{id}/bids` unauth | **401** | listing `00000000-0000-4000-a000-00000000a01a` body `{"amount_cents":100}` → `{"error":"missing authorization header"}` — **PASS** |

Extras (not in the required 8, still fail-closed):

| Probe | HTTP | Result |
|-------|------|--------|
| `GET /api/v1/me/activity` unauth | **401** | `missing authorization header` |
| `POST /api/v1/jobs/00000000-0000-0000-0000-000000000103/bids` unauth | **401** | `missing authorization header` |

Fixes applied: none. No FAIL. iOS Simulator was not re-launched this recheck.
