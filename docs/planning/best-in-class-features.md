# Best-in-class feature set — proof of work, liquidity, honest price geo

**Date:** 2026-08-12  
**Scope:** Engineering-closable only. Not Checkr live, not off-session charge, not StoreKit, not `DEPLOY_PROVISIONED`.

## Decision-IDs (out of this build)

| ID | Why not this PR |
|----|-----------------|
| CHECKR-FR-2.9 | Needs `CHECKR_API_KEY` |
| OFFSESSION-LEGAL | Needs shipped bid-authorization terms |
| STOREKIT-B2 | Needs ASC products |
| FOUNDER-SECRETS | OAuth / SendGrid / Sentry / Apple Pay file |

## F1 — Proof of work (gates money)

**Shall:** Customer cannot release service escrow until the contract has a durable check-in and at least one **after** completion photo. Admin may override. Provider cannot release their own escrow (unchanged).

**Why Redis is not enough:** check-in + photos are Redis keys with a 24h TTL. Release days later has no evidence. Authority moves to Postgres.

### Data (migration `123_contract_work_evidence`)

`contract_work_sessions`  
- `id` UUID PK `gen_random_uuid()`  
- `contract_id` UUID NOT NULL FK `contracts(id)`  
- `provider_id` UUID NOT NULL FK `users(id)`  
- `checked_in_at` TIMESTAMPTZ NOT NULL  
- `check_in_lat` / `check_in_lng` DOUBLE PRECISION  
- `checked_out_at` TIMESTAMPTZ NULL  
- `check_out_lat` / `check_out_lng` DOUBLE PRECISION  
- `duration_minutes` INT NULL  
- `created_at` / `updated_at` TIMESTAMPTZ NOT NULL  
- Unique open session: `UNIQUE (contract_id, provider_id) WHERE checked_out_at IS NULL`  
- Indexes: `idx_contract_work_sessions_contract_id`

`contract_completion_photos`  
- `id` UUID PK  
- `contract_id` UUID NOT NULL FK `contracts(id)`  
- `uploaded_by` UUID NOT NULL FK `users(id)`  
- `phase` TEXT NOT NULL CHECK (`before` \| `after`)  
- `url` TEXT NOT NULL  
- `created_at` TIMESTAMPTZ NOT NULL  
- Index: `idx_contract_completion_photos_contract_id`

Down: drop both tables.

### Writes

`POST /contracts/{id}/checkin` — existing geofence, then **INSERT** session (or update open session’s check-in). Redis cache optional, not authoritative.

`POST /contracts/{id}/checkout` — close open session, set duration. Persist even if Redis miss.

`POST /contracts/{id}/completion-photos` — after imaging confirm, **INSERT** photo row. Redis optional.

### Reads

`GET /api/v1/contracts/{id}/work-evidence`  
- Auth + `RequirePartyAccess` (customer or provider).  
- Body:

```json
{
  "ready_for_release": false,
  "missing": ["check_in", "after_photo"],
  "sessions": [
    {
      "checked_in_at": "RFC3339",
      "checked_out_at": "RFC3339|null",
      "duration_minutes": 0
    }
  ],
  "photos": [
    { "phase": "before|after", "url": "https://...", "uploaded_at": "RFC3339" }
  ]
}
```

`ready_for_release` = at least one session with `checked_in_at` AND at least one photo with `phase=after`.

Do **not** return raw lat/lng to the customer (PII). Provider may see their own coords on the existing work-session GET.

### Release gate

`POST /api/v1/payments/{id}/release` (gateway, before gRPC):

- Load payment. If `contract_id` empty (goods / non-service), skip gate.  
- If actor is admin: allow (existing admin path).  
- Else evaluate work-evidence. If not ready: **409**  
  `{ "error": "proof of work required", "missing": ["check_in","after_photo"] }`  
- Never 500 for a missing session.

### UI

Web + iOS contract detail (customer):

- Evidence pack: sessions (times only) + photo thumbs (allowlisted URLs).  
- Release CTA disabled until `ready_for_release`; copy lists missing items.  
- On 409, show `missing` (do not claim release succeeded).

Provider: same pack, read-only (they still cannot release).

## F2 — Time-to-first-bid (liquidity)

**Shall:** Job owner sees how many providers were notified and whether/when the first bid arrived. Never invent a “typical 14 min” without data.

### Data (migration `124_job_match_notifications`)

`job_match_notifications`  
- `job_id` UUID NOT NULL FK `jobs(id)`  
- `provider_id` UUID NOT NULL FK `users(id)`  
- `notified_at` TIMESTAMPTZ NOT NULL DEFAULT now()  
- PRIMARY KEY (`job_id`, `provider_id`)  
- Index: `idx_job_match_notifications_job_id`

### Writes

`triggerProviderMatching` / `notifyProviderOfMatch`: after a successful notify (or after the match is selected, even if notify fails-soft), `INSERT ... ON CONFLICT DO NOTHING`.

### Reads

Owner-only fields on **GET job** (gateway enrich, not proto):

```json
{
  "liquidity": {
    "notified_count": 3,
    "first_bid_at": "RFC3339|null",
    "minutes_to_first_bid": 12,
    "bid_count": 2
  }
}
```

`first_bid_at` = `MIN(bids.created_at)` for the job. `minutes_to_first_bid` only when first bid exists. Non-owners: omit `liquidity`.

### UI

Job detail (customer/owner, web + iOS):

- `3 providers notified — first bid in 12 min`  
- `3 providers notified — waiting for the first bid`  
- Hide the block when `notified_count=0` and `bid_count=0` (no theater).

## F3 — Honest price geography

**Shall:** Pricing map plots only ZIPs that exist in `zip_codes` with real lat/lng. No hashed US-centroid. No “Live” badge.

### API

`GET /api/v1/pricing/heatmap?category={slug}` (public, `writeCachedJSON`)

```json
{
  "points": [
    {
      "zip_code": "98103",
      "lat": 47.67,
      "lng": -122.34,
      "median_price_cents": 18500,
      "completed_jobs": 8
    }
  ]
}
```

SQL: join `fair_price_index` to `zip_codes` on zip. Drop unknown / `unknown` zips. Optional `category` filter. Empty `points` if no join hits.

### UI

`PriceHeatMap`: fetch this endpoint; plot real points. Caption stays honest: “Completed jobs by ZIP (where we have coordinates).” If `points.length===0`, empty state — do not fall back to hash offsets.

Optional: `/pricing/[slug]` public page with category name, ZIP table (from existing `GET /pricing/{slug}`), CTA to post a job. Metadata for SEO.

## Tests (minimum)

- POW: check-in persists; photo persists; release 409 without them; release OK with them; admin skip; goods payment (no contract) skip.  
- TTFB: match insert; owner GET includes liquidity; non-owner omits.  
- Heatmap: unknown zip omitted; known zip present; no centroid constants in the map component.

## Non-goals

Live Checkr, off-session goods charge, StoreKit, field RUM, Instant live GPS tracking, materials catalog.

---

## Re-audit 2026-08-12

Method: source + `go test ./internal/handler/ -run 'WorkEvidence|Release|Heatmap'` + targeted Vitest (55 pass).

| Shall | Status | Evidence |
|-------|--------|----------|
| F1 durable sessions + photos | **PASS** | `123_contract_work_evidence`; workspace writes Postgres; Redis cache only |
| F1 GET work-evidence | **PASS** | `GET /contracts/{id}/work-evidence`; no lat/lng; `ready_for_release` + `missing` |
| F1 release 409 without proof | **PASS** | `allowProofOfWorkRelease`; admin skip; no `contract_id` skip; nil db fail-closed 409 |
| F1 web + iOS pack + gated release | **PASS** | `WorkEvidencePack` + iOS `ContractDetailView`; 409 not toasted as success |
| F2 match notify persist | **PASS** | `124_job_match_notifications`; INSERT ON CONFLICT DO NOTHING |
| F2 owner liquidity, hide empty | **PASS** | Owner GET enrich; web/iOS hide when notified=0 and bids=0 |
| F3 heatmap real ZIP only | **PASS** | `GET /pricing/heatmap` INNER JOIN `zip_codes`; `PriceHeatMap` no hash offsets |
| F3 no Live badge | **PASS** | Caption: completed jobs by ZIP with coordinates |

**Residual (accepted):** apply migrations 123–124 on each environment (`make migrate-up`). No live-stack dogfood of release 409 in this audit. JobMap default center is still US centroid (map camera, not fake price points).
