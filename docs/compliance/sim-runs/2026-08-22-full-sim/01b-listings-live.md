# SIM-CATALOG — public listings + open jobs live floor (2026-08-22)

**Date:** 2026-08-22  
**Mode:** fix · **Depth:** catalog verify after seed + live-window filter  
**API:** `http://127.0.0.1:8081` (`GET /health` → 200)  
**Seed:** `database/seeds/active_marketplace_listings.sql` applied (23 rows). Jobs `status=active` with past deadline extended +2 days.  
**Filter SoT:** `gateway/internal/handler/listings.go` `ListListings` — `l.status = 'active'` + `publicListingLiveWindowSQL` (`auction_ends_at IS NULL OR auction_ends_at > now()`) + post-scan `includeInPublicListingCatalog`. Jobs: `GET /jobs?status=open` → job service live window + gateway `effectiveJobStatus` omit.  
**Proof:** live GET against `:8081` + `go test ./internal/handler/ -count=1 -run Listing`. No commit.

**Verdict:** Public catalog is a **live floor**. Listings page 1 returns **n=23**, all `status=active`, none past `auction_ends_at`. Open jobs return **n=3**, all `status=active`, none past deadline. Handler test omits past-deadline `active` rows. **PASS**.

Now UTC at probe: `2026-08-22T18:20:16Z`.

---

## GET /api/v1/listings?page=1&page_size=60

| Field | Value |
|-------|--------|
| HTTP | **200** |
| Cache-Control | `public, max-age=0, s-maxage=30, stale-while-revalidate=120, stale-if-error=300` |
| `listings.length` | **23** |
| `pagination.total` / `totalCount` | **23** |
| `pagination.page` | 1 |
| `hasNext` | false |
| status ≠ `active` | **0** |
| `auction_ends_at` ≤ now | **0** |
| missing `auction_ends_at` | **0** |

All 23 rows `status=active`. Earliest close `2026-08-23T11:17:02-07:00` (Makita drill, Patagonia jacket, IKEA KALLAX); latest `2026-08-29T11:17:02-07:00`.

| n | title | auction_ends_at (local −07) |
|---|-------|-----------------------------|
| 3 | Makita 18V LXT · Patagonia Nano Puff · IKEA KALLAX | 2026-08-23 11:17 |
| 7 | walnut sideboard · Switch OLED · Thule Force · Big Green Egg · Criterion lot · AirPods Pro · Yeti Tundra | 2026-08-24 11:17 |
| 13 | DeWalt kit · Weber Genesis · walnut credenza · Sony A7 III · Trek FX 2 · BMW wheels · Pokémon box · vinyl lot · Canyon Ultimate · LEGO Modular · Yakima HighRoad · Bosch GLM · Toro mower | 2026-08-29 11:17 |

Matches seed revival + 12 device-test UUIDs (`a010`–`a01b`) plus remaining live demo rows (`9209`, `9210`, `9217`, …).

Prior UI walk (`02-ui.md` SIM-UI.2) had `totalCount=0` / Marketplace empty. **Closed** by seed + live-window filter.

---

## GET /api/v1/jobs?status=open&page=1&page_size=50

| Field | Value |
|-------|--------|
| HTTP | **200** |
| `jobs.length` | **3** |
| `pagination.totalCount` | **3** |
| status ≠ `active` | **0** |
| `auction_ends_at` ≤ now | **0** |

| id | title | status | auction_ends_at |
|----|-------|--------|-----------------|
| `…0103` | Review SaaS vendor contract before signing | active | 2026-08-24T18:17:03Z |
| `…0104` | One-hour business law consultation for new LLC | active | 2026-08-24T18:17:03Z |
| `…0100` | AC Unit Not Cooling Properly | active | 2026-08-24T18:17:03Z |

Prior UI walk (`02-ui.md` SIM-UI.1) had `status=open` returning 3 **closed** jobs (ended 2026-08-16). **Closed** by deadline +2 day extension + live-window on `SearchJobs` (`auction_ends_at > now()` when status is active/open) and gateway omit of non-`active` after `effectiveJobStatus`.

---

## Go test — ListListings omits past-deadline active rows

Added `gateway/internal/handler/listings_list_test.go` `TestListListings_omitsPastDeadlineActiveRows`:

- Unit: `includeInPublicListingCatalog("active", past) == false`; future/nil stay; sold/expired never included; SQL constant pin.
- Live DB (`DATABASE_URL` / `GATEWAY_TEST_DATABASE_URL`): insert one live + one stale `status=active` listing, `GET /listings?q=LIVEWINDOW-…`. Expect **only** the live id, `status=active`, `pagination.total=1` (COUNT uses the same live-window predicate).

Also extracted `publicListingLiveWindowSQL` + `includeInPublicListingCatalog` in `listings.go` (ListListings WHERE + post-scan skip).

```
cd gateway && DATABASE_URL=postgresql://nomarkup:password@localhost:5433/nomarkup?sslmode=disable \
  go test ./internal/handler/ -count=1 -run Listing
```

**Result:** `ok  github.com/nomarkup/nomarkup/gateway/internal/handler  0.770s`

Verbose pin:

```
=== RUN   TestListListings_omitsPastDeadlineActiveRows/handler_live_db
--- PASS: TestListListings_omitsPastDeadlineActiveRows (0.05s)
    --- PASS: TestListListings_omitsPastDeadlineActiveRows/handler_live_db (0.05s)
```

Mirrors existing `TestJobHandler_Search_openOmitsPastDeadlineActiveRows` in `handler_test.go`.

---

### [SIM-CATALOG.1] Public listings page 1 is a live active floor
- Status: **PASS**
- Severity: —
- Surface: `GET /api/v1/listings`
- Evidence: n=23, status counts `{active: 23}`, zero past `auction_ends_at`
- Expected: n>0, all `status=active`, no ended auctions on the browse floor
- Actual: matches
- Confidence: 10

### [SIM-CATALOG.2] Open jobs are live active
- Status: **PASS**
- Severity: —
- Surface: `GET /api/v1/jobs?status=open`
- Evidence: n=3, all `status=active`, `auction_ends_at=2026-08-24T18:17:03Z`
- Expected: n>0, all `status=active`
- Actual: matches
- Confidence: 10

### [SIM-CATALOG.3] ListListings omits past-deadline active rows
- Status: **PASS**
- Severity: —
- Surface: `ListingsHandler.ListListings`
- Evidence: live-DB fixture (stale `active` + past `auction_ends_at`) absent from body and COUNT; unit pin on helper + SQL constant
- Expected: stale row never on public catalog
- Actual: matches
- Confidence: 10
