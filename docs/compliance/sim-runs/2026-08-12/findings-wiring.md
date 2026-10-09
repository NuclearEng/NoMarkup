# SIM-WIRE — iOS UI action → API path → gateway handler

**Date:** 2026-08-12  
**Mode:** fix · **Depth:** deep  
**API:** `http://127.0.0.1:8081` (`GET /health` → **200** `{"status":"ok","version":"dev"}`)  
**Gateway process:** `.dev/bin/gateway` PID 38191 (started Wed; **stale vs current `router.go`**)  
**Auth:** `POST /api/v1/auth/login` email `customer@nomarkup.com` / `provider@nomarkup.com` / `admin@nomarkup.com` password `Password123!` → **200**  
**Proof:** curl/Python against live gateway + source `file:line`. XCUITest sim `7F123C44` not used.

**Client path convention:** `APIClient*.swift` builds `/api/v1/…` via `pathComponents` (not a string prefix).  
**Gateway SoT:** `gateway/internal/router/router.go`.

---

### [SIM-WIRE.1] Auth login
- Status: PASS
- Severity: advisory
- Surface: LoginView → `POST /api/v1/auth/login`
- Evidence: `ios/NoMarkup/Core/APIClient+Auth.swift:130` · `ios/NoMarkup/Core/APIClient.swift:98` · `gateway/internal/router/router.go:157` · live **200** + `access_token`
- Expected: FE path equals gateway; 200 + JWT pair
- Actual: Match. Seed customer roles `["customer","provider"]`.
- Remediation: none
- Confidence: 10

### [SIM-WIRE.2] Auth register
- Status: PASS
- Severity: advisory
- Surface: RegisterView → `POST /api/v1/auth/register`
- Evidence: `APIClient+Auth.swift:163` · `router.go:156` · live empty-password probe **400** `"password must be at least 8 characters"` (route exists; not a 404)
- Expected: Client path = gateway Register
- Actual: Match
- Remediation: none
- Confidence: 9

### [SIM-WIRE.3] Forgot password
- Status: PASS
- Severity: major
- Surface: ForgotPasswordView → request reset
- Evidence: UI `ForgotPasswordView.swift:217` → `AuthViewModel.requestPasswordReset` → `APIClient+Auth.swift:168-172` **`POST /api/v1/auth/request-password-reset`** · `router.go:161` · live **200** `{"status":"ok"}`. Inventory comment `POST /api/v1/auth/forgot-password` (`inventory.md:11`) is **wrong**: that path live **404** `404 page not found`.
- Expected: Client uses the gateway reset route, not the web page path `/forgot-password`
- Actual: Client is correct. Inventory string is stale (web URL, not API).
- Remediation: none on client. Update inventory comment if re-published.
- Confidence: 10

### [SIM-WIRE.4] Logout
- Status: PASS
- Severity: advisory
- Surface: Account sign out → `POST /api/v1/auth/logout`
- Evidence: `APIClient+Extras.swift:422-434` · `router.go:200` · live **204**
- Expected: Public logout (refresh body / cookie); no live access token required
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.5] users/me
- Status: PASS
- Severity: advisory
- Surface: Account / profile → `GET /api/v1/users/me`
- Evidence: `APIClient.swift:268` · `APIClient+Platform.swift:219-224` · `router.go:487` · customer **200** (`QA Tester`) · admin **200** `roles:["admin","provider"]`
- Expected: Bearer GET returns profile used for admin row + workspace
- Actual: Match. `UserProfile.hasAdminRole` (`APIClient+Platform.swift:393`) gates `account.row.admin`.
- Remediation: none
- Confidence: 10

### [SIM-WIRE.6] Jobs list
- Status: PASS
- Severity: advisory
- Surface: Home / Jobs tab → `GET /api/v1/jobs?page=&page_size=`
- Evidence: `APIClient.swift:387-446` · `router.go:256` `jobHandler.Search` · live **200** `pagination.totalCount` (393–395 during this run)
- Expected: Public search; client query names `latitude`/`longitude`/`min_price_cents`/`sort`/`sort_dir` match Search
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.7] Jobs detail
- Status: PASS
- Severity: advisory
- Surface: JobDetailView → `GET /api/v1/jobs/{id}`
- Evidence: `APIClient.swift:435-444` · `router.go:258` · live **200** for `e217067d-5dff-4fc5-8c62-5b6b1ef1b275`
- Expected: Optional-auth detail
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.8] Jobs create
- Status: PASS
- Severity: advisory
- Surface: PostJobView → `POST /api/v1/jobs`
- Evidence: `APIClient.swift:1247` · `router.go:265` `jobHandler.Create`
- Expected: Authed create (not exercised with a write in this probe)
- Actual: Path matches. Create mutation not POSTed (safe suite).
- Remediation: none
- Confidence: 8

### [SIM-WIRE.9] Bids (jobs + mine)
- Status: PASS
- Severity: advisory
- Surface: Job bid / My bids → `POST /jobs/{id}/bids`, `GET /jobs/{id}/bids`, `GET /bids/mine`, `GET /listings/bids/mine`
- Evidence: `APIClient.swift:814,861,970,957` · `APIClient+Jobs.swift:14-49` · `router.go:259,282,698` · live `GET /jobs/{id}/bids` **200** · `GET /bids/mine` **200** · `GET /listings/bids/mine` **200** · `GET /bids/analytics` without `job_id` **400** (client always sends `job_id`: `APIClient+Commerce.swift:175-181`)
- Expected: Paths match; analytics requires `job_id`
- Actual: Match
- Remediation: none
- Confidence: 9

### [SIM-WIRE.10] Listings list
- Status: PASS
- Severity: advisory
- Surface: Marketplace / Home goods → `GET /api/v1/listings`
- Evidence: `APIClient.swift:355` · `router.go:418` · live **200** `listings:[]` `pagination.total=0` / `totalCount=0`
- Expected: Public catalog
- Actual: Match. Zero live goods is server data, not a path bug.
- Remediation: none
- Confidence: 10

### [SIM-WIRE.11] Listings detail + autocomplete
- Status: PASS
- Severity: advisory
- Surface: ListingDetail / typeahead
- Evidence: `APIClient.swift:358-377` · `router.go:423-434` · autocomplete `q=pl` **200** suggestions · no public listing id (catalog empty) — `GET /listings/mine` **200** (authed, drafts/sold)
- Expected: Public detail + autocomplete
- Actual: Paths exist. Detail not curlable without a public id.
- Remediation: none
- Confidence: 8

### [SIM-WIRE.12] Listings watch
- Status: PASS
- Severity: advisory
- Surface: Watchlist / listing watch toggle → `POST|DELETE /api/v1/listings/{id}/watch` · `GET /api/v1/me/watchlist`
- Evidence: `APIClient.swift:888-911` · `router.go:907-909` · live `GET /me/watchlist` **200**
- Expected: Watch + list
- Actual: Match. Mutation not flipped (no public listing id).
- Remediation: none
- Confidence: 8

### [SIM-WIRE.13] Listings bid
- Status: PASS
- Severity: advisory
- Surface: Place listing bid → `POST /api/v1/listings/{id}/bids`
- Evidence: `APIClient.swift:846` · `router.go:863-864`
- Expected: Authed + Idempotency-Key
- Actual: Path matches source. No public listing to POST against.
- Remediation: none
- Confidence: 8

### [SIM-WIRE.14] Channels + messages
- Status: PASS
- Severity: advisory
- Surface: Messages tab
- Evidence: `APIClient.swift:546-716` (`/channels`, `/channels/{id}`, `/messages`, `/read`, `/terms/respond`, `/proposed-terms`, `/share-contact`) · `router.go:1001-1014` · live `GET /channels` **200** (2 rows) · `GET /channels/00000000-0000-0000-0000-000000000900` **200** · messages **200**
- Expected: List / detail / messages / read
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.15] Notifications + preferences
- Status: PASS
- Severity: advisory
- Surface: Notifications + prefs
- Evidence: `APIClient.swift:983-1011` · `APIClient+Extras.swift:446-458` · `router.go:1239-1245` · live list **200** · unread-count **200** `{"count":3}` · prefs **200**
- Expected: Inbox, mark-read, unread, GET/PUT prefs
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.16] Payment methods list / add / delete
- Status: PASS
- Severity: advisory
- Surface: PaymentMethodsView
- Evidence: `APIClient+Extras.swift:467-506` · `router.go:931-934` · live `GET /payments/methods` **200** `{"methods":[]}`
- Expected: GET list, POST setup-intent, DELETE method
- Actual: Paths match. Seed has no saved cards.
- Remediation: none
- Confidence: 9

### [SIM-WIRE.17] Payment methods set-default
- Status: FIXED
- Severity: major
- Surface: PaymentMethodsView “Set default”
- Evidence: **Was missing on iOS.** Web `usePayments.ts:147-153` already called `PUT /api/v1/payments/methods/${id}/default`. Gateway source `router.go:935` · `payment.go:339`. Live stale binary: unauth **401**; authed bogus id **404 page not found** (chi, not handler JSON) — route not in PID 38191. Client now: `APIClient+Extras.swift:508-530` + `PaymentMethodsView.swift:214-228,297-314` + `Models+Extras.swift` `SetDefaultPaymentMethodResponse`.
- Expected: Primary action wires PUT + Idempotency-Key; UI can set default; GET methods reflects `is_default`
- Actual: Client path now matches source/web. Live handler not in running binary. Seed methods empty so GET cannot prove a mutation.
- Remediation: Rebuild/restart `.dev/bin/gateway` from current tree. Then add a card and tap Set default; GET `/payments/methods` must show `is_default=true` on that id.
- Retest: Source path `["api","v1","payments",id,"default"]` == `router.go:935`. Live PUT still 404 until gateway rebuild. UI compiles against new DTO.
- Confidence: 8

### [SIM-WIRE.18] Contracts
- Status: PASS
- Severity: advisory
- Surface: Contracts list/detail
- Evidence: `APIClient+Contracts.swift:61-70` · `router.go:707-718` · live `GET /contracts` **200** (5) · `GET /contracts/78743d77-2bd6-4665-8c62-da881699e0b0` **200** · change-orders **200** · pdf **200**
- Expected: Party-gated list/detail
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.19] Watchlist
- Status: PASS
- Severity: advisory
- Surface: Account → Watchlist → `GET /api/v1/me/watchlist`
- Evidence: `APIClient.swift:911` · `router.go:909` · live **200**
- Expected: Authed watchlist
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.20] Orders
- Status: PASS
- Severity: advisory
- Surface: My orders → `GET /api/v1/me/orders` + `/orders/{id}`
- Evidence: `APIClient.swift:935-945,1022-1032` · `APIClient+Commerce.swift:201-213,365-393` · `router.go:808-828` · live list **200** · `GET /orders/d61d70c2-34fe-4b96-8232-3b02c3433e8c` **200** · reviews eligibility **200**
- Expected: List + pay/pickup/dispute/review paths
- Actual: GET paths live. Pay/pickup not mutated.
- Remediation: none
- Confidence: 9

### [SIM-WIRE.21] providers/me
- Status: PASS
- Severity: advisory
- Surface: Provider workspace → `GET/PATCH /api/v1/providers/me`
- Evidence: `APIClient+Provider.swift:15-40` · `router.go:590-591` · customer (dual) **200** · provider **200** (`Dogfood Co`)
- Expected: RequireProvider self routes
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.22] Stripe Connect status
- Status: PASS
- Severity: advisory
- Surface: Seller payouts → `GET /api/v1/providers/me/stripe/status`
- Evidence: `APIClient+Extras.swift:510-516` · `router.go:629` · live **200** `charges_enabled:false`
- Expected: Provider Stripe status
- Actual: Match
- Remediation: none
- Confidence: 10

### [SIM-WIRE.23] Background check
- Status: PASS
- Severity: advisory
- Surface: Verification → `GET|POST /api/v1/providers/me/background-check`
- Evidence: `APIClient+Provider.swift:279-293` · `router.go:614-617` (`RequireFlag` `background_checks`) · live **503** `{"error":"This feature is currently unavailable"}` · public flags `background_checks:false`
- Expected: Path exists; flag-off is 503 not 404
- Actual: Match (flag-closed, not a missing route)
- Remediation: none
- Confidence: 10

### [SIM-WIRE.24] Calendar ICS
- Status: PASS
- Severity: advisory
- Surface: Calendar export → `GET /api/v1/me/calendar.ics`
- Evidence: `APIClient+Commerce.swift:160-165` · `router.go:247` · unauth **401** · Bearer **200** `BEGIN:VCALENDAR`
- Expected: optionalAuth + `?feed=` or Bearer
- Actual: Client sends Bearer. Live 200 with session.
- Remediation: none
- Confidence: 10

### [SIM-WIRE.25] Feature flags
- Status: PASS
- Severity: advisory
- Surface: Feature flag status + gates → `GET /api/v1/flags`
- Evidence: `APIClient.swift:286-289` · `FeatureFlags.swift:6,60` · `router.go:360` · live **200** 16 keys
- Expected: Public flat bool map
- Actual: Match. Admin writes use `GET/PUT /api/v1/admin/flags` (`APIClient+Admin.swift:7-99` · `router.go:1231-1232`) — admin session **200**.
- Remediation: none
- Confidence: 10

### [SIM-WIRE.26] RUM POST
- Status: N/A
- Severity: advisory
- Surface: Field RUM (web vitals)
- Evidence: iOS has **no** `POST /api/v1/rum` client. Web `report-web-vitals.ts:10,90`. Source public `router.go:400-401`. Live `POST /api/v1/rum` **401** `missing authorization header` (public mount missing on stale binary; falls into authed `/api/v1`). `GET /api/v1/admin/rum` live **404**; iOS AdminConsole does not call it.
- Expected: iOS only wires RUM if present
- Actual: Not an iOS UI action
- Remediation: none on iOS. Rebuild gateway if web beacons must ingest.
- Confidence: 9

### [SIM-WIRE.27] Home stats vs GET /jobs and GET /listings totals
- Status: PASS
- Severity: major
- Surface: Home stats strip / market desk counts
- Evidence: Screenshot `C11-home.png` **393 JOBS · 0 GOODS** and **393 OPEN JOBS / 0 GOODS LIVE**. Live `GET /jobs?page=1&page_size=8` **200** `pagination.totalCount` 393 (later 395). Live `GET /listings` **200** `total=0`/`totalCount=0`. Decoder `PaginationMeta.resolvedTotal` (`Models.swift:189-191`) prefers `total` then `totalCount`. Home now binds `jobTotal`/`listingTotal` to `pagination?.resolvedTotal` (`HomeView.swift:770-774`). Label **JOBS** (not “OPEN JOBS”) so the number is honest vs mixed-status Search.
- Expected: Stats equal GET list pagination totals
- Actual: 393/0 matched live totals. Client restored to pagination totals after a brief live-count-only draft.
- Remediation: none
- Confidence: 10

### [SIM-WIRE.28] Market desk “Waiting for open floor…” vs priced jobs
- Status: FIXED
- Severity: major
- Surface: Home market desk ticker
- Evidence: `C11-home.png` empty ticker while GET /jobs page-1 rows have `starting_bid_cents` (25000–50000). Cause: `jobs` was live-status-filtered (`isLiveAuctionStatus`) on an 8-row newest-closed page → ticker source empty. Ticker chip filter itself (`displayPrice ?? "—"`) is fine when fed priced rows (`HomeView.swift:270-271`). Census: ~393 priced jobs, 1–2 `active`.
- Expected: Desk chips print last/live prices when the catalog has `starting_bid_cents` / bids
- Actual: Now `deskJobs` = unfiltered first page (live first) at `page_size=100` (`HomeView.swift:13-15,261-263,748-755`). Open-floor cards still use live-status `jobs`.
- Remediation: done
- Retest: `GET /api/v1/jobs?page=1&page_size=8` returns priced rows; `deskJobs` is assigned from `jobsResult.jobs` (not live-filtered). Live sim not re-shot (XCUITest owns `7F123C44`).
- Confidence: 9

### [SIM-WIRE.29] Deep link `/jobs` vs `/jobs/new`
- Status: PASS
- Severity: major
- Surface: DeepLinkRouter
- Evidence: `DeepLinkRouter.swift:129-144` — `post-job`/`jobs-new` → `.postJob`; `/jobs/new` → `.postJob`; bare `/jobs` → `.jobsBrowse`; `/jobs/{id}` → `.job`. `DeepLinkRoute.jobsBrowse` documented at `:185-186`.
- Expected: Browse ≠ create
- Actual: Mapped correctly
- Remediation: none
- Confidence: 10

### [SIM-WIRE.30] Check-in
- Status: PASS
- Severity: major
- Surface: Contract workspace + App Intent deep link
- Evidence: Client `APIClient+Contracts.swift:855-862` `POST /api/v1/contracts/{id}/checkin` body `{lat,lng}` · `router.go:754` `workspaceHandler.CheckIn`. Deep link `check-in`/`checkin` → `.checkIn` (`DeepLinkRouter.swift:131-135`) is **app routing**, not an API path. Live `GET …/checkin` **405** (POST-only). Live `POST …/checkin` **400** `"you are too far from the job site…"` (handler ran). `GET …/work-session` **200**.
- Expected: POST checkin exists; geofence enforced
- Actual: Path + handler proven. 400 is geofence, not 404.
- Remediation: none
- Confidence: 10

### [SIM-WIRE.31] Work evidence
- Status: FAIL
- Severity: major
- Surface: ContractDetailView proof-of-work pack
- Evidence: Client `APIClient+Contracts.swift:846-852` `GET /api/v1/contracts/{id}/work-evidence` · source `router.go:758` `workspaceHandler.GetWorkEvidence` · `workspace_evidence.go:189`. Live `GET /api/v1/contracts/78743d77-…/work-evidence` **404** `404 page not found` (chi). Sibling `work-session` **200** on same contract — running binary predates the work-evidence mount.
- Expected: Party GET returns JSON pack (`ready_for_release`, `missing`, sessions, photos) — never chi 404
- Actual: Client path matches **source**. Live gateway binary missing the route. UI will error/empty the pack; does not claim success.
- Remediation: Rebuild `.dev/bin/gateway` from current `router.go`. Do **not** invent an alternate client path. After rebuild: GET same contract → 200 JSON (empty pack is OK).
- Confidence: 9

### [SIM-WIRE.32] Admin iOS console
- Status: PASS
- Severity: major
- Surface: Account → Admin console (`account.row.admin`)
- Evidence: Row gated on `hasAdminRole` (`AccountView.swift:832-843`). Admin seed `GET /users/me` roles include `admin`. `AdminConsoleView` (`ParitySurfacesView.swift:785`) loads `APIClient+Admin.swift` paths that match `router.go:1059-1236` (flags, disputes, users, goods-reports, user-reports, fraud, jobs, listings, goods disputes, markets, advances, guarantee, verification, licenses, insurance claims, reviews, fees, revenue, banking, platform, subscriptions, challenges, insurers, category-questions). Customer token on `/admin/flags` **403**. Admin token **200**. iOS does **not** call `/admin/rum` (live 404 anyway).
- Expected: Admin row only for admin; console paths exist and 403 for non-admin
- Actual: Match. No separate admin app shell (inventory).
- Remediation: none
- Confidence: 9

---

## Path matrix (primary)

| UI action | iOS path | Gateway | Live HTTP |
|-----------|----------|---------|-----------|
| Login | POST `/api/v1/auth/login` | `router.go:157` | 200 |
| Register | POST `/api/v1/auth/register` | `:156` | 400 (validation) |
| Forgot | POST `/api/v1/auth/request-password-reset` | `:161` | 200 |
| Forgot (inventory typo) | POST `/api/v1/auth/forgot-password` | — | **404** |
| Logout | POST `/api/v1/auth/logout` | `:200` | 204 |
| Me | GET `/api/v1/users/me` | `:487` | 200 |
| Jobs | GET `/api/v1/jobs` | `:256` | 200 totalCount 393–395 |
| Job detail | GET `/api/v1/jobs/{id}` | `:258` | 200 |
| Job create | POST `/api/v1/jobs` | `:265` | not written |
| Job bids | GET/POST `/api/v1/jobs/{id}/bids` | `:259,:282` | GET 200 |
| Listings | GET `/api/v1/listings` | `:418` | 200 total 0 |
| Watch | POST/DELETE `/listings/{id}/watch` | `:907-908` | list GET 200 |
| Channels | GET `/api/v1/channels` | `:1002` | 200 |
| Messages | GET `/channels/{id}/messages` | `:1006` | 200 |
| Notifications | GET `/notifications` + prefs | `:1240,:1244` | 200 |
| Pay methods | GET `/payments/methods` | `:932` | 200 `[]` |
| Set default | PUT `/payments/methods/{id}/default` | `:935` | **404** (stale bin) |
| Contracts | GET `/contracts` | `:707` | 200 |
| Watchlist | GET `/me/watchlist` | `:909` | 200 |
| Orders | GET `/me/orders` | `:828` | 200 |
| Provider me | GET `/providers/me` | `:590` | 200 |
| Stripe | GET `/providers/me/stripe/status` | `:629` | 200 |
| BGC | GET `/providers/me/background-check` | `:616` | 503 flag-off |
| Calendar | GET `/me/calendar.ics` | `:247` | 200 (auth) |
| Flags | GET `/api/v1/flags` | `:360` | 200 |
| RUM | (no iOS client) | `:401` | 401 stale |
| Check-in | POST `/contracts/{id}/checkin` | `:754` | 400 geofence |
| Work evidence | GET `/contracts/{id}/work-evidence` | `:758` | **404** stale |
| Admin flags | GET `/admin/flags` | `:1231` | 200 admin / 403 customer |

---

## Fixes this run

1. **Ticker empty despite priced jobs** — `HomeView` now feeds `MarketTickerView` from `deskJobs` (unfiltered page, live first, `page_size=100`). Stats stay on pagination totals.
2. **Set-default missing on iOS** — added `setDefaultPaymentMethod` + Payment methods “Set default” (web/gateway parity). Live binary still 404s until rebuild.

## Not fixed (not a client path mismatch)

- Live `.dev/bin/gateway` missing `GET …/work-evidence`, `PUT …/methods/{id}/default`, public `POST /api/v1/rum`, `GET /admin/rum`. Rebuild required. XCUITest holds sim `7F123C44`; gateway not restarted.
- Inventory `forgot-password` API string is a web route name; client already uses `request-password-reset`.
