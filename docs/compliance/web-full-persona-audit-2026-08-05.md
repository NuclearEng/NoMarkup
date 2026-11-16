# Web full-persona UI audit — 2026-08-05

**Target:** `http://127.0.0.1:3000` (Next.js) + gateway `http://127.0.0.1:8081`  
**Method:** Agent-team static audits (customer / provider / admin / public) + Playwright deep workflow suite + route wire matrix + live spot-checks.  
**Seed accounts:** `customer@` / `provider@` / `admin@nomarkup.com` with `SEED_PASSWORD` (default local `Password123!` works against this stack).

---

## Executive verdict

| Bar | Result |
|-----|--------|
| **Fully wired (no dead shells on primary funnels)** | **Mostly yes** for core money paths; secondary surfaces have shells / fake controls |
| **No bugs** | **No** — real product bugs + UX lies documented below |
| **Highly performant** | **Not yet** vs McMaster-class targets; public HTML ~2–4.7s felt load in Playwright; API data layer is fast (jobs/listings ~10–30ms) |
| **Best-in-class UI** | **Not yet** — solid foundations (44px targets, skeletons on many lists), dual-role IA and orphan routes fail the bar |

**Bottom line:** The product is a **real, API-backed marketplace**, not a mock. Primary customer/provider/admin surfaces render and call live endpoints. It is **not** bug-free or best-in-class until dual-role nav, lifecycle handoffs, money confirms, and map NaN handling land.

---

## What we ran

| Suite | Result | Signal quality |
|-------|--------|----------------|
| `workflow-deep.spec.ts` (Playwright, serial, live stack) | **63 PASS / 1 FAIL / 0 PARTIAL** | **High** — real login + click-through per persona |
| Full wire matrix (public + customer routes) | Public 14/15 clean; `/jobs/map` P1; customer under load showed Turbopack `next/image` noise | Medium (load-sensitive) |
| Existing dogfood (`tests/e2e/dogfood`) | **29 pass / 27 fail / 5 skipped** under **parallel contention** with wire suite | Low for failures (login timeouts); category step **did pass** when not raced |
| Solo spot-check (public + customer) | Core customer routes **PASS** (`/dashboard`, `/jobs/new` 90 buttons, `/jobs/mine`, `/contracts`, `/orders`, settings, properties, analytics) | High |
| Agent code audits (4 explore agents) | Deep P0/P1 with `path:line` | High for product gaps |

Artifacts:

- `/tmp/nomarkup-web-audit/reports/workflow-deep.json`
- `/tmp/nomarkup-web-audit/reports/wire-audit.json` + `wire-audit.md`
- `/tmp/nomarkup-web-audit/screenshots/{public,customer}/`
- Playwright specs added: `web/tests/e2e/audit/full-wire-audit.spec.ts`, `workflow-deep.spec.ts`

---

## Playwright deep workflow (primary evidence)

### Customer — nearly full surface green

| Step | Status |
|------|--------|
| Login → dashboard greeting | PASS |
| Nav Post Job → wizard | PASS |
| Wizard category list timing | **FAIL** (race: list still “Loading categories…”; **not** a dead taxonomy API — `GET /api/v1/categories/tree` returns 200 ~225KB; dogfood Step 0 later **passed** in 861ms) |
| My jobs / contracts / messages / payments | PASS |
| Marketplace listing + save/watch toggle | PASS |
| All settings pages + profile + notifications | PASS |
| Sell new (78 controls) | PASS |

### Provider — hub through business tools green

| Step | Status |
|------|--------|
| Login, `/provider` hub + trust chrome | PASS |
| Browse job → open UUID → bid CTA (3) + amount field | PASS |
| Bids / workspace / offers / team / verification | PASS |
| Business, expenses, invoices, tax, advances, challenges, onboarding | PASS |
| Contract detail open | PASS |

### Admin — overview through ops queues green

| Step | Status |
|------|--------|
| Overview metrics 4/4 (Total Users, Active Jobs, GMV, Open Disputes) | PASS |
| Users search + user detail | PASS |
| Flags (19 controls) | PASS |
| fraud, disputes, payments, jobs, listings, reviews, verification, markets, platform, taxonomy, banking, insurance, insurers, challenges, advances, guarantee, goods-reports, user-reports, licenses | **All PASS** (no fatal UI) |

### Public

| Step | Status |
|------|--------|
| Landing CTAs, jobs, marketplace, providers (11 items), pricing, demo auction, login validation, register | PASS |

---

## Performance (honest)

| Layer | Observation |
|-------|-------------|
| Gateway public data via web proxy | `GET /api/v1/jobs` ~10ms, listings ~27ms, providers/search ~14ms — **data layer is fast** |
| Playwright public route load (domcontentloaded + 1.8–2.5s settle) | Avg ~**2.9s**, worst `/legal` **4.7s** — fails felt &lt;1.5s LCP north star |
| Customer spot-check route times | ~2.1–2.2s consistent (includes fixed settle wait) |
| RSC-first | `/`, `/jobs`, `/marketplace` seeded; `/providers`, map routes still full client |
| Mapbox | Jobs map dynamically imported; marketplace map less aggressive code-split |

**Not highly performant end-to-end** on the HTML/app shell under local Turbopack; API is not the bottleneck.

---

## P0 product findings (fix before “best in class”)

### 1. Dual-role seed users get provider-first chrome (customer broken on mobile)

- `MobileTabBar.tsx` — `isProvider` replaces **Jobs** tab with **Bids**
- `SidebarNav.tsx` — full provider suite + full common list; no persona switcher
- `analytics/page.tsx` — binary `isProvider ? Provider : Customer` hides customer spend for dual-role JWT (`customer@` seed has both roles)

### 2. Job map throws `Invalid LngLat object: (NaN, NaN)`

- Reproduced on `/jobs/map` (console pageerror)
- `JobMap.tsx` ~212: `.setLngLat([job.location_lng, job.location_lat])` without filtering missing/NaN coords (coarsened/null approximate locations from PII path)

### 3. Recurring job “Pause” is a UI lie

- `jobs/recurring/page.tsx` — local React state + wrong mutation (`is_recurring` flip ≠ pause)

### 4. Provider lifecycle handoff gaps

- Workspace cards **do not link** to `/contracts/[id]`
- Check-in / completion photos only for **“today”** jobs
- Dual completion rules: workspace requires after-photo; contract detail can complete without photos
- Settings payment methods: Connect mid-setup can dead-end (create only; full `StripeOnboarding` lives mainly on onboarding step 8, finish not gated on payouts ready)

### 5. Admin money actions without confirm

- Advances approve/reject/disburse — one-click (`admin/advances/page.tsx`)
- Dispute resolve (services + goods) — no `ActionConfirmDialog`
- Platform bank delete — no confirm

### 6. Misleading admin “platform” controls

- “Enable analytics for all users” → **localStorage only** (`admin/platform/page.tsx`)
- Payments **custom fees** → localStorage, not applied to transactions
- Taxonomy “manage” → **read-only tree**, no CRUD

### 7. Orphan but implemented customer product

Not in sidebar / command palette: properties, insurance, recurring jobs, analytics, referrals, sell/mine, sell/analytics, notifications (bell only), disputes/new (contract entry only).

---

## P1 findings (wiring / UX quality)

| Finding | Evidence |
|---------|----------|
| Payments page promises “manage payment methods” without link | `payments/page.tsx` |
| No set-default payment method UI | `usePayments` delete-only |
| Wrong empty CTAs (Browse Jobs) on customer contracts/payments | contracts/payments pages |
| `/me/positions` “Goods bids” → `/bids` (service bids) | positions page |
| BidPlacementPanel orphan / dead | components/bids |
| Feature flags toggle without confirm (incl. money-adjacent) | admin/flags |
| No unsuspend/unban in admin UI | useAdmin mutations |
| Challenges admin create-only | ChallengeManager |
| Admin sidebar desktop-only (`hidden lg:block`) | admin layout |
| `/providers` full client, no page metadata | SEO/LCP debt |
| Map routes no metadata | SEO |
| Landing category tiles → unfiltered `/jobs` | product wiring |
| Raw hex in command palette | DS violation |
| Error states without Retry on several customer pages | jobs/mine, profile, insurance, dashboard silent query fail |

---

## What is solid (do not re-audit as “unwired”)

- **Auth:** login → dashboard for all three personas (when not rate-limited / raced)
- **Job post wizard:** CategorySelector + taxonomy tree API wired
- **Bid path:** place/lower/withdraw; customer award path on BidCard
- **Contracts detail:** accept/start/complete/change orders/installments/guarantee claim/review
- **Messages:** channels + WS status chrome
- **Marketplace browse/detail/orders/sell publish** (upload-on-publish)
- **Admin queues:** users/jobs/listings/reports/verification mostly real API + DataTable
- **Platform metrics:** live `usePlatformMetrics`, not hard-coded zeros
- **Stripe Connect components exist** (`StripeOnboarding`, `ConnectEmbeddedOnboarding`) on provider onboarding
- **No widespread `href="#"` / empty onClick / console.log** in app components
- **Public providers page** correctly uses `GET /api/v1/providers/search` (bare `/providers` 401 is **not** a page bug)

---

## Persona matrices (compressed)

### Customer

| Area | Wired? | Notes |
|------|--------|-------|
| Dashboard | Partial | Dual-role stacks; weak error |
| Post job / mine | Wired | Category load race only under slow settle |
| Contracts / messages | Wired | Empty CTA copy wrong |
| Payments / settings | Partial | Methods under-linked; no default |
| Marketplace / orders / sell | Wired | sell/mine orphan nav |
| Properties / insurance / recurring / analytics / referrals | Wired but orphan | Nav gap |

### Provider

| Area | Wired? | Notes |
|------|--------|-------|
| Hub / bids / offers / team / verification / advances | Wired | Strong mutations |
| Workspace | Partial | No contract link; today-only sessions |
| Business tools | Wired | Thin error handling |
| Stripe | Partial | Onboarding skippable; settings resume weak |

### Admin

| Area | Wired? | Notes |
|------|--------|-------|
| Overview / users / jobs / listings / fraud / flags | Wired | Money confirms missing |
| Taxonomy / platform analytics toggle / custom fees | Shell / fake | Misleading copy |
| Advances / disputes money | Wired API, weak UX | No confirm |

### Public

| Area | Wired? | Notes |
|------|--------|-------|
| Landing ticker / jobs / marketplace | Wired + RSC seed | |
| Providers | Wired client | Metadata/RSC gap |
| Job map | Partial | NaN LngLat crash path |
| Demo auction | Wired demo | Mock by design |

---

## Best-in-class UI gaps (HIG / Material spirit)

1. **≤5 top destinations** violated — dual-role sidebar is a wall of links  
2. **Persona clarity** — seed dual-role user experiences provider-first mobile  
3. **Discoverability** — half of customer product is deep-link only  
4. **Destructive/money confirms** — admin advances/disputes fail institutional bar  
5. **Skeleton consistency** — referrals still “Loading…” text  
6. **Error + retry** — inconsistent  
7. **Map robustness** — NaN markers are not best-in-class  
8. **Performance felt load** — multi-second HTML shell vs sub-second data APIs  

---

## Recommended fix order

1. **P0 map:** filter jobs without valid lat/lng before `setLngLat` / bounds extend  
2. **P0 dual-role:** persona preference or primary-role for mobile tabs + analytics split  
3. **P0 recurring pause:** real API or remove control  
4. **P0 provider workspace → contract deep links** + work-session for all active/started  
5. **P0 admin:** confirm dialogs on advances + dispute resolve + bank delete  
6. **P0 kill localStorage pretend controls** or wire them to flags/API  
7. **P1 nav:** surface properties, insurance, sell/mine, analytics, referrals under account group  
8. **P1 payments hub → payment methods** + set-default  
9. **Perf:** RSC-seed `/providers` + `/pricing`; lazy marketplace map like jobs map  
10. **Stripe:** mount full onboarding on settings; optional hard-block finish until payouts ready  

---

## How to re-run

```bash
export SEED_PASSWORD=...   # must match seeded DB
cd web
npx playwright test tests/e2e/audit/workflow-deep.spec.ts --project=chromium --workers=1
# Full route matrix (slow; do not parallel with other heavy suites on same Next dev server)
npx playwright test tests/e2e/audit/full-wire-audit.spec.ts --project=chromium --workers=1
```

**Note:** Parallel Playwright against one Turbopack `next dev` produced login timeouts and `next/image` factory errors — treat contention failures as **infra noise**, not product regressions. Prefer serial workers for dogfood.

---

## Honest scorecard vs user ask

| Ask | Score |
|-----|-------|
| Every profile exercised | **Yes** (customer, provider, admin, public) |
| Every UI button entire workflow | **No** — primary CTAs and safe controls yes; not every row action / money mutation in admin |
| Fully wired | **~80% core, ~60% long tail** |
| No bugs | **No** |
| Highly performant | **API yes / app shell no** |
| Best-in-class UI | **Not yet** |

This audit is a **release gate**, not a greenwash. Ship blockers are dual-role IA, map NaN, fake pause, admin money confirms, and provider lifecycle handoffs.

---

## Remediation pass (same day) — re-verify

Fixes landed and re-verified with `workflow-deep.spec.ts` (serial chromium, `SEED_PASSWORD` set):

| Metric | Result |
|--------|--------|
| Playwright deep workflow | **66 PASS · 0 FAIL · 0 PARTIAL** (4/4 tests, ~5.3m) |
| `public.jobs_map` Invalid LngLat | **PASS** (finite lat/lng filter) |
| `customer.wizard_category` | **PASS** (wait for taxonomy list) |
| `admin.advances_confirm` | **PASS** (confirm dialog opens) |
| Auth login after e2e hammer | Cleared Redis `nomarkup:rl:auth:*`; `RATE_LIMIT_AUTH=200` in `.env.local`; gateway `auth_limit:200` |

### Code fixes included
- `JobMap` finite coordinate guard
- Dual-role mobile tabs (customer-primary when both roles) + analytics dual view
- Recurring: remove fake pause → honest “End recurrence”
- Workspace: contract deep-links + work-session on all active cards
- Admin: advances/disputes confirms; banking delete confirm; platform toggle honesty; taxonomy read-only copy
- Nav orphans (properties, sell/mine, recurring, analytics, referrals); payments → methods; positions goods CTA
- Settings: full `StripeOnboarding` for provider payouts
- `scripts/dev/clear-auth-rate-limit.sh` + login fixture 429 backoff

### Residual (product north star, not this gate)
- Felt HTML load still multi-second vs McMaster targets
- Admin mobile nav still desktop-first
- Taxonomy still no admin CRUD (honest copy only)

**Workflow audit bar for this session: 100/100 (66/66 steps green).**
