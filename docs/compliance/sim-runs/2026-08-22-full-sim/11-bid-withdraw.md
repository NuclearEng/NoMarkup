# Bid place + withdraw — 2026-08-22 full-sim (`11`)

**Agent:** iphone-sim bid-submit residual closer  
**Goal:** prove a **reversible local** job reverse-bid against seed data. Engineering only — **not** founder live Stripe.  
**Did not:** award, escrow, PaymentIntent, listing/goods bid, or mutate any other seed bid.

| Field | Value |
|-------|--------|
| Date | 2026-08-22 20:56:00 GMT |
| API | `http://127.0.0.1:8081` `GET /health` **200** `{"status":"ok","version":"dev"}` |
| Method | curl Bearer + refresh cookie. No iOS sim occupied. No commit. |
| Persona | `provider2@nomarkup.com` / `Password123!` (`user_id` `00000000-0000-0000-0000-000000000004`, role `provider`) |
| Fallback | not needed (place was **201**, not 403/409) |

**Verdict: PASS.** Place **201**, withdraw **200**, bid left `status=withdrawn`. Count on the job returned to **0**.

---

## Job picked

`GET /api/v1/jobs?status=open` → **200**, `totalCount=3`. Preferred seed title matched.

| Field | Value |
|-------|--------|
| Job | `00000000-0000-0000-0000-000000000103` |
| Title | Review SaaS vendor contract before signing |
| Owner | `customer_id` `…0002` (not this provider) |
| Status | `active` |
| Auction | `sealed` · `auction_ends_at` `2026-08-24T18:17:03Z` (still open) |
| Starting bid | **40000** cents ($400.00) |
| `bid_count` (list) | **0** before place |

Other open jobs (not used): `…0104` “One-hour business law consultation…” (`bid_count=1`, starting 25000); `…0100` “AC Unit Not Cooling Properly” (`bid_count=2`, starting 50000). Provider2 already holds seed bid `…0201` **42000** cents **active** on `…0100` — left untouched.

Plan headroom (`GET /api/v1/subscriptions/usage` **200**): `active_bids=1` / `max_active_bids=3` (free).

---

## Existing bids (pre-place)

Sealed reverse-auction list is **job-owner only**. Provider2 cannot read competitor amounts; ceiling is the public starting bid (and `bid_count=0`).

| Call | HTTP | Body |
|------|------|------|
| `GET /api/v1/jobs/…0103/bids` as provider2 | **403** | `{"error":"permission denied: only the job owner can view bids"}` |
| `GET /api/v1/jobs/…0103/bids/count` | **200** | `{"count":0}` |
| `GET /api/v1/bids/mine` | **200** | one row: seed `…0201` on job `…0100`, **42000** cents, `active` |

**Current lowest used for the bid:** no live bids → strictly below **starting_bid_cents 40000**. Amount placed: **39000** cents ($390.00).

---

## Place

`POST /api/v1/jobs/00000000-0000-0000-0000-000000000103/bids`

- Header `Idempotency-Key: 3fbfb776-78ea-46dd-9364-fe2ac7bd39e5`
- Body `{"amount_cents":39000}`
- **HTTP 201 Created** · `X-Request-Id: 19a7e3f85fd2be7d`

| Field | Value |
|-------|--------|
| bid id | `d26fbb02-a57c-4229-a207-bfc3502760ac` |
| amount_cents | **39000** |
| original_amount_cents | 39000 |
| job_id | `00000000-0000-0000-0000-000000000103` |
| provider_id | `00000000-0000-0000-0000-000000000004` |
| status | `active` |
| created_at | `2026-08-22T20:56:00Z` |

`GET /api/v1/bids/{id}` immediately after → **200**, same row, `status=active`.

---

## Withdraw

`DELETE /api/v1/bids/d26fbb02-a57c-4229-a207-bfc3502760ac`

- **HTTP 200 OK** · `X-Request-Id: 12de6242d2d7be5b`
- Body: same id, `amount_cents` **39000**, `status` **`withdrawn`**, `withdrawn_at` `2026-08-22T20:56:00Z`

Confirm:

| Call | HTTP | Result |
|------|------|--------|
| `GET /api/v1/bids/{id}` | **200** | `status=withdrawn`, `withdrawn_at` set |
| `GET /api/v1/jobs/…0103/bids/count` | **200** | `{"count":0}` (back to pre-place) |
| `GET /api/v1/bids/mine` | **200** | new row `withdrawn` **39000** + seed `…0201` still `active` **42000** on job `…0100` |

No award. No escrow. No Stripe. Seed HVAC bid `…0201` unchanged.

---

## Sequence

| Step | Request | HTTP | Notes |
|------|---------|------|-------|
| 0 | `GET /health` | **200** | `version=dev` |
| 1 | `POST /api/v1/auth/login` provider2 | **200** | JWT + refresh cookie. `user_id` `…0004` |
| 2 | `GET /api/v1/users/me` | **200** | roles `[provider]`, email `provider2@nomarkup.com` |
| 3 | `GET /api/v1/jobs?status=open` | **200** | picked `…0103` SaaS contract |
| 4 | `GET /api/v1/jobs/…0103` | **200** | starting **40000**, sealed, not owned |
| 5 | `GET /api/v1/jobs/…0103/bids` | **403** | sealed / owner-only (expected) |
| 6 | `GET /api/v1/jobs/…0103/bids/count` | **200** | count **0** |
| 7 | `POST /api/v1/jobs/…0103/bids` 39000¢ + UUID key | **201** | bid `d26fbb02-a57c-4229-a207-bfc3502760ac` |
| 8 | `GET /api/v1/bids/{id}` | **200** | `active` 39000 |
| 9 | `DELETE /api/v1/bids/{id}` | **200** | `withdrawn` |
| 10 | `GET /api/v1/bids/{id}` | **200** | still `withdrawn` |
| 11 | `GET …/bids/count` | **200** | count **0** |

`provider@` fallback unused.

---

## PASS/FAIL

**PASS.** Reversible reverse-bid on seed job `…0103`: placed **39000** cents (**201**) strictly below starting **40000**, withdrawn (**200**). Residual from 09 (`Job bid submit = founder`) is closed for the **local HTTP** path only — iOS UI submit was not re-walked here and still is not a live-Stripe proof.
