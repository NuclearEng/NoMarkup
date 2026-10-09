# Workflows — 2026-08-22 full-sim (HTTP matrix)

Personas × gateway workflows against the live API. **No 500s.** No handler patch. No commit.

| Field | Value |
|-------|--------|
| Date | 2026-08-22 ~10:03–10:06 PT |
| API | `http://127.0.0.1:8081` `GET /health` **200** `{"status":"ok","version":"dev"}` |
| Seed | `Password123!` · `customer@` / `provider@` / `provider2@` / `admin@nomarkup.com` |
| Method | **curl** Bearer + cookie jar. Did **not** take either exclusive sim for `xcodebuild`. |
| Sims (short `simctl` only) | iPhone 17 Pro `7F123C44-…8510` login chrome (`API: 127.0.0.1:8081`). iPhone 17 Pro Max `503E262C-…539E` public Home, LIVE GATEWAY, **0 LIVE / 0 GOODS**. |
| Router | `gateway/internal/router/router.go` — jobs `GET /api/v1/jobs`, marketplace `GET /api/v1/listings` (public); authed `/bids/mine`, `/contracts`, `/me/orders`, `/me/watchlist`, `/notifications`, `/subscriptions/usage`, `/me/activity`, `/admin/flags`; public `/subscriptions/tiers`; `POST /api/v1/auth/login` + `/logout`. |

Cells: **C**ustomer / **P**rovider / **P2** `provider2@` / **A**dmin. Status: **PASS** / **FAIL** / **GAP** + HTTP code. Unauth column is the logged-out baseline (not a persona).

---

## Seed identity (`GET /api/v1/users/me` after login)

| Persona | email | roles | `display_name` | user_id |
|---------|-------|-------|----------------|---------|
| C | `customer@nomarkup.com` | `customer`, `provider` | Customer | `…0002` |
| P | `provider@nomarkup.com` | `provider` | Customer | (token issued) |
| P2 | `provider2@nomarkup.com` | `provider` | Customer | (token issued) |
| A | `admin@nomarkup.com` | `admin`, `provider` | Customer | (token issued) |

All four logins returned a JWT (`mfa_required` absent). `display_name` is **Customer** on every seed account (seed overwrite, not an HTTP fail) — see SIM-WF.2.

---

## SIM-WF matrix

| ID | Workflow | Unauth | C | P | P2 | A | Notes |
|----|----------|--------|---|---|----|---|-------|
| **SIM-WF.1** | `POST /api/v1/auth/login` | — | **PASS 200** | **PASS 200** | **PASS 200** | **PASS 200** | `{email,password}` → `access_token` + refresh cookie. |
| **SIM-WF.2** | `GET /api/v1/users/me` | **401** | **PASS 200** | **PASS 200** | **PASS 200** | **PASS 200** | Roles/email correct. Identity copy GAP: all `display_name=Customer`. |
| **SIM-WF.3** | `GET /api/v1/jobs` | **PASS 200** | **PASS 200** | **PASS 200** | **PASS 200** | **PASS 200** | Public. `totalCount=3` (Seattle / legal+HVAC). |
| **SIM-WF.4** | `GET /api/v1/listings` | **PASS 200** | **PASS 200** | **PASS 200** | **PASS 200** | **PASS 200** | Public catalog **empty** (`total=0`) even with Seattle `lat/lng`. Route is live. Data GAP — see finding. |
| **SIM-WF.5** | `GET /api/v1/bids/mine` | **401** | **PASS 200** `[]` | **PASS 200** (has bids) | **PASS 200** (has bids) | **PASS 200** `[]` | Services bids. C has dual role but no job bids. |
| **SIM-WF.6** | `GET /api/v1/contracts` | **401** | **PASS 200** (has rows) | **PASS 200** (has rows) | **PASS 200** `[]` | **PASS 200** `[]` | C/P share seed contract `NM-2026-00001` $220. |
| **SIM-WF.7** | `GET /api/v1/me/orders` | **401** | **PASS 200** | **PASS 200** | **PASS 200** | **PASS 200** | Goods orders present (e.g. Peloton Bike+). |
| **SIM-WF.8** | `GET /api/v1/me/watchlist` | **401** | **PASS 200** (has rows) | **PASS 200** `[]` | **PASS 200** `[]` | **PASS 200** `[]` | C watches sold DJI listing `…9101`. |
| **SIM-WF.9** | `GET /api/v1/notifications` | **401** | **PASS 200** | **PASS 200** | **PASS 200** | **PASS 200** | Inbox non-empty for all four. |
| **SIM-WF.10** | `GET /api/v1/subscriptions/tiers` | **PASS 200** | **PASS 200** | **PASS 200** | **PASS 200** | **PASS 200** | Public. `free` / `pro_customer` / `pro_provider`. |
| **SIM-WF.11** | `GET /api/v1/subscriptions/usage` | **401** | **PASS 200** | **PASS 200** | **PASS 200** | **PASS 200** | C max bids 10; P 50; P2/A 3 (free). |
| **SIM-WF.12** | `POST /api/v1/jobs` empty / `{}` / `{title}` | — | **PASS 400** | **PASS 400** | **PASS 400** | **PASS 400** | Empty → `invalid request body: EOF`. `{}` → `title is required`. `{title}` → `description is required`. Not 500. |
| **SIM-WF.13** | Place bid empty body | — | **PASS 400** | **PASS 400** | **PASS 400** | **PASS 400** | Job + listing. See permutations below. **No 500.** |
| **SIM-WF.14** | `GET /api/v1/admin/flags` | **401** | **PASS 403** | **PASS 403** | **PASS 403** | **PASS 200** | `{"error":"admin access required"}` for non-admin. Admin flag list includes `binary_only` money keys. |
| **SIM-WF.15** | `GET /api/v1/me/activity` | **401** | **PASS 200** | **PASS 200** | **PASS 200** | **PASS 200** | `events[]` with `request_id` / method / path. |
| **SIM-WF.16** | `POST /api/v1/auth/logout` | **PASS 204** | **PASS 204** | **PASS 204** | **PASS 204** | **PASS 204** | Public; revokes refresh cookie. Best-effort 204 with no token. |

**FAIL count: 0.** **500 count: 0.**

---

## Bid / job mutation permutations (SIM-WF.12–13)

Job id used: `00000000-0000-0000-0000-000000000103` (from public `GET /jobs`). Listing id for empty POST: seed watchlist `…9101` (detail 200, `status=sold`). Same statuses on all four personas (C is dual-role so PlaceBid role-gate does not 403).

| Call | Status | Body |
|------|--------|------|
| `POST /jobs` empty body | **400** | `invalid request body: EOF` |
| `POST /jobs` `{}` | **400** | `title is required` |
| `POST /jobs` `{"title":"x"}` | **400** | `description is required` |
| `POST /jobs/{id}/bids` empty + `Idempotency-Key` | **400** | `invalid request body: EOF` |
| `POST /jobs/{id}/bids` `{}` + `Idempotency-Key` | **400** | `amount_cents must be positive` |
| `POST /jobs/{id}/bids` empty, **no** idempotency key | **400** | `Idempotency-Key header is required for payment mutations` |
| `POST /listings/{id}/bids` empty + `Idempotency-Key` | **400** | `invalid request body: EOF` |

`RequireIdempotencyKey` is POST/PUT-only (`gateway/internal/middleware/idempotency.go`); GET `/subscriptions/usage` is not blocked by the group middleware.

---

## SIM-WF findings

### [SIM-WF.4] Public goods catalog is empty (HTTP 200, data GAP)

- **Severity:** GAP (seed / auction clock), not an API fail.
- **Evidence:** `GET /api/v1/listings` and `?lat=47.6062&lng=-122.3321&radius_km=40` both `total=0`. Handler filters `l.status = 'active' AND l.is_hidden = false` (`listings.go` ListListings). Customer watchlist listing `…9101` **GET 200** `status=sold` (DJI Mavic 3 Pro). Orders still list sold goods (Peloton). iOS Home on 17 Pro Max: **0 LIVE · 0 GOODS**.
- **Not a 500.** Marketplace list path is the public `GET /api/v1/listings` in `router.go`.
- **Remediation:** re-seed or extend `auction_ends_at` / `status='active'` if the browse floor must be non-empty. Out of scope here (no 500).

### [SIM-WF.2] Every seed `display_name` is `Customer`

- **Severity:** GAP (identity copy). Login and role checks still PASS.
- **Evidence:** `/users/me` for `provider@`, `provider2@`, `admin@` all `display_name=Customer` (emails/roles correct). Seed originally used Mike/Sarah/Admin names.
- **Remediation:** re-seed display names; do not treat as a gateway bug.

### [SIM-WF.3 vs Home ticker] Jobs list 3, Home “0 LIVE NOW”

- **Severity:** GAP (UI vs list filter), not HTTP.
- **Evidence:** `GET /jobs` `totalCount=3` (sample `auction_ends_at=2026-08-16T03:25:37Z`, already past). Sim Home shows **0 LIVE NOW** / LEGAL $400 / HVAC $500 chips. API still 200.
- No handler change.

---

## iOS UI workflows already proven (not re-run)

Did **not** lock DerivedData. Existing XCUITest + Playwright from this conversation:

| Proof | Result | Artifact |
|-------|--------|----------|
| `ScreenshotWalkUITests.test09AccountRowTapSmoke` | **PASS** 4m 4s | `ios/DerivedDataAccountRewalk/Logs/Test/Test-NoMarkup-2026.08.22_07-52-18--0700.xcresult` · iPhone 17 Pro. Shots: `docs/compliance/sim-runs/2026-08-21-account-audit/shots/test09AccountRowTapSmoke-*.png` (login, Account root, profile, security, **payment methods not Jobs**, orders, still-alive). |
| `ScreenshotWalkUITests.test06CustomerAccountRowIDSweep` | **PASS** 43m | `…/Test-NoMarkup-2026.08.22_07-57-22--0700.xcresult`. 116 shots under `docs/compliance/sim-runs/2026-08-22-account-rewalk/test06CustomerAccountRowIDSweep-*.png` (login, Account rows, inner contracts/orders/bids/listings/watchlist, recover, still-alive). |
| Live Playwright catalog 4 personas | **PASS** (this conversation) | Target card `00-target-card.md`; rewalk `REPORT.md` (`SEED_PASSWORD` + `:8081`). Earlier 07:06 note (`iphone-simulator-2026-08-22.md`) had VCR-only / live skipped — superseded by the later live run. **Not re-executed here.** |

Short `simctl io screenshot` only (10:06):

- `sim-17pro-current.png` — Sign in, `API: 127.0.0.1:8081`
- `sim-17promax-current.png` — public Home, tab shell, LIVE GATEWAY, 0 goods (matches SIM-WF.4)

---

## Verdict

HTTP workflow matrix **green**: login, me, jobs, listings route, bids/contracts/orders/watchlist/notifications/tiers/usage/activity, validated POST job, empty bid **400 not 500**, admin flags **200/403**, logout **204**. Two data GAPs (empty active listings; seed display names). **No 500. No code change. No commit.**
