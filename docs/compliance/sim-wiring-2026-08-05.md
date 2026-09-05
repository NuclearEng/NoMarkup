# SIM-WIRE — iOS primary tabs FE↔BE (2026-08-05)

**Mode:** Audit + fix only if client path clearly wrong  
**Commit:** none (report only)  
**Target:** `http://127.0.0.1:8081` (matches Debug Simulator `AppConfig` base)  
**Actor:** `customer@nomarkup.com` / `Password123!`  
**Auth:** `POST /api/v1/auth/login` → Bearer RS256 access token  
**Subject:** `00000000-0000-0000-0000-000000000002` (roles: `customer`, `provider`)  
**Scope:** Entry-load network calls for **Home · Marketplace · Jobs · Messages · Account**  
**Code authority:** `ios/NoMarkup/Features/{Home,Marketplace,Jobs,Messages,Account}View.swift` + `RootTabView.swift` → `ios/NoMarkup/Core/APIClient*.swift`

## Verdict

| Tab | Entry API path(s) | HTTP (Bearer customer) | SIM-WIRE |
|-----|-------------------|------------------------:|----------|
| **Home** | `GET /health` (+ fallback `GET /api/v1/health`) | **200** / fallback **404** | **PASS** |
| **Home** | `GET /api/v1/jobs?page=1&page_size=8` | **200** | **PASS** |
| **Home** | `GET /api/v1/listings?page=1&page_size=3` | **200** | **PASS** |
| **Marketplace** | `GET /api/v1/listings?page=1&page_size=40` (+ optional geo) | **200** | **PASS** |
| **Jobs** (default Browse) | `GET /api/v1/jobs?page=1&page_size=40` | **200** | **PASS** |
| **Jobs** (Mine segment) | `GET /api/v1/jobs/mine?page=1&page_size=40` | **200** | **PASS** |
| **Messages** | `GET /api/v1/channels?page=1&page_size=40` | **200** | **PASS** |
| **Account** | `GET /api/v1/notifications/unread-count` | **200** | **PASS** |
| **Account** | `GET /api/v1/users/me` | **200** | **PASS** |

**Overall: PASS.** No client path is clearly wrong. **No code fixes applied.**

Public (no-auth) control checks: catalog + `/health` return **200**; authed-only routes return documented **401** `missing authorization header`.

---

## Method

1. Map each primary tab’s `.task` / entry `load` → `APIClient` method → concrete gateway path.
2. Login as seed customer; capture `access_token`.
3. `GET` the same path the client builds (including query params the UI uses on cold open).
4. Expect **2xx**, or a **documented 4xx** (auth gate / missing route) that the client already tolerates.
5. Fix only if the Swift path string is clearly wrong vs gateway (none found).

Probes run against live gateway at probe time (`2026-08-05T23:32:02Z` UTC).

---

## Per-tab wiring map

### Home (`HomeView` → `refreshHome` / `loadCatalog`)

| Client | Path | Auth | Probe status | Result |
|--------|------|------|-------------:|--------|
| `APIClient.health()` | `GET /health` first, then `GET /api/v1/health` | none | **200** then (if reached) **404** with Bearer / **401** without | **PASS** — first candidate succeeds; fallback is dead on this gateway |
| `fetchJobs(page:1, pageSize:8)` | `GET /api/v1/jobs?page=1&page_size=8` | public | **200** (jobs array + pagination) | **PASS** |
| `fetchListings(page:1, pageSize:3)` | `GET /api/v1/listings?page=1&page_size=3` | public | **200** (listings array) | **PASS** |

**Sources:** `HomeView.swift` (`refreshHome` / `loadCatalog`); `APIClient.swift` `health()`, `fetchJobs`, `fetchListings`.

**Note — health fallback:** Gateway exposes **`GET /health`** (`{"status":"ok","version":"dev"}`). There is no live `GET /api/v1/health` route (Bearer → **404** `404 page not found`; no-auth → **401** because `/api/v1/*` auth middleware catches unknown paths). Client tries `/health` **first** and returns on 2xx, so Home entry is fine. **Not a wrong primary path** — no fix under “clearly wrong path” rule. Residual: secondary candidate is vestigial; optional later cleanup only.

---

### Marketplace (`MarketplaceView` → `load(reset: true)`)

| Client | Path | Auth | Probe status | Result |
|--------|------|------|-------------:|--------|
| `fetchListings(page:1, pageSize:40, …)` | `GET /api/v1/listings?page=1&page_size=40` | public | **200** | **PASS** |

Optional query (only when `AppConfig.browseCoordinate` is set): `lat`, `lng`, `radius_km`. Cold open without geo still hits the bare list path above. Category/search filters are not entry-load.

**Sources:** `MarketplaceView.swift` `load`; `APIClient.swift` `fetchListings`.

---

### Jobs (`JobsView` → `load(reset: true)` on `.task(id: segment)`)

Default segment is **Browse**.

| Segment | Client | Path | Auth | Probe status | Result |
|---------|--------|------|------|-------------:|--------|
| Browse (entry default) | `fetchJobs(page:1, pageSize:40, …)` | `GET /api/v1/jobs?page=1&page_size=40` | public | **200** | **PASS** |
| Mine | `fetchMyJobs(page:1, pageSize:40)` | `GET /api/v1/jobs/mine?page=1&page_size=40` | Bearer | **200** | **PASS** |

Optional browse filters (`q`, `category_ids`, `latitude`/`longitude`, `schedule_type`, `min_price_cents`) only after user action / config center — not required for path correctness.

**Sources:** `JobsView.swift` `load`; `APIClient.swift` `fetchJobs`, `fetchMyJobs`.

---

### Messages (`MessagesView` → `load()`)

| Client | Path | Auth | Probe status | Result |
|--------|------|------|-------------:|--------|
| `fetchChatChannels(page:1, pageSize:40)` | `GET /api/v1/channels?page=1&page_size=40` | Bearer | **200** (`channels` present) | **PASS** |

Inbox search (`q=`) and thread detail (`GET /channels/{id}`, messages) are **not** tab entry loads.

**Sources:** `MessagesView.swift` `load`; `APIClient.swift` `fetchChatChannels`.

---

### Account (`AccountView` → `.task`)

| Client | Path | Auth | Probe status | Result |
|--------|------|------|-------------:|--------|
| `fetchUnreadNotificationCount()` | `GET /api/v1/notifications/unread-count` | Bearer | **200** `{"count":0}` | **PASS** |
| `fetchMe()` | `GET /api/v1/users/me` | Bearer | **200** (profile for seed customer) | **PASS** |
| `currentUserID()` | *(JWT decode only — no network)* | n/a | n/a | n/a |

**Sources:** `AccountView.swift` `refreshUnreadCount` / `refreshOnboardingBanner`; `APIClient+Platform.swift` `fetchMe`; `APIClient.swift` `fetchUnreadNotificationCount`.

---

## Chrome (not a tab body, but runs on signed-in shell)

`RootTabView.refreshUnreadBadges()` on appear / tab change:

| Client | Path | Probe | Result |
|--------|------|------:|--------|
| `fetchChatChannels(page:1, pageSize:40)` | `GET /api/v1/channels?page=1&page_size=40` | **200** | **PASS** (same as Messages) |
| `fetchUnreadNotificationCount()` | `GET /api/v1/notifications/unread-count` | **200** | **PASS** (same as Account) |

---

## Public vs authed control matrix

| Path | No auth | Bearer customer |
|------|--------:|----------------:|
| `GET /health` | **200** | **200** |
| `GET /api/v1/health` | **401** missing auth header | **404** page not found |
| `GET /api/v1/jobs?page=1&page_size=8` | **200** | **200** |
| `GET /api/v1/listings?page=1&page_size=3` | **200** | **200** |
| `GET /api/v1/listings?page=1&page_size=40` | **200** | **200** |
| `GET /api/v1/jobs?page=1&page_size=40` | **200** | **200** |
| `GET /api/v1/jobs/mine?page=1&page_size=40` | **401** | **200** |
| `GET /api/v1/channels?page=1&page_size=40` | **401** | **200** |
| `GET /api/v1/users/me` | **401** | **200** |
| `GET /api/v1/notifications/unread-count` | **401** | **200** |

401s above are **expected** for protected routes without Bearer.

---

## Client path correctness

| Check | Outcome |
|-------|---------|
| Home catalog paths match gateway public jobs/listings | **OK** |
| Marketplace listings path | **OK** |
| Jobs browse + mine paths | **OK** |
| Messages channels path | **OK** |
| Account me + unread-count paths | **OK** |
| Path clearly wrong → fix | **None** |

---

## Residual / non-blocking

1. **`/api/v1/health` fallback** — not registered; client never needs it when `/health` works. Optional dead-code cleanup later (out of scope for path-wrong fix).
2. **Response decoding** — this audit is path/status only (SIM-WIRE). DTO decode failures would surface as client UI errors even on HTTP 200; not re-tested here.
3. **Geo query params** — Marketplace/Jobs may append lat/lng when `AppConfig` browse center is set; bare list paths already **200**.
4. **Scaffold / browse-only session** — Messages Mine/Account gate network when `isScaffoldSession`; real customer login (as probed) is the production path.

---

## Summary

All five primary iOS tabs call gateway paths that return **200** for the seed customer on `http://127.0.0.1:8081`. Protected routes correctly **401** without a token. **SIM-WIRE: PASS.** No Swift path corrections required.
