# NoMarkup — Performance Playbook (measured baseline & detail)

> Offloaded from `CLAUDE.md` §14 to keep the always-loaded rules file lean. CLAUDE.md keeps the
> north star **targets**, the default RSC pattern recommendation, and the two non-negotiable
> "validated" learnings. This file holds the full baseline narrative and the principles list.
>
> **Truth note (2026-07-09):** North Star numbers are **targets**, not achieved field metrics.
> Lab LCP remains multi-second on key routes; SW is a kill-switch; DATA-layer CDN cache is real.

**North star (aspiration):** NoMarkup must feel *instantly responsive*, on par with or faster than
mcmaster.com. Speed is a feature and a first-class acceptance criterion for new work — **do not
claim the bar is already met**.

## Status vs targets (honest)

| Metric | Target | Current reality |
|--------|--------|-----------------|
| LCP P75 field | < 1.5s | **No RUM / web-vitals pipeline yet** |
| LCP lab (key routes) | — | **Multi-second** in prior lab checks (~3–4s class); not under North Star |
| Stretch "edge HTML < 300ms" | aspirational | **Impossible while CSP script nonce forces dynamic HTML** |
| INP | < 100ms | Not field-gated |
| DATA-layer CDN (`writeCachedJSON`) | shipped | **Real** — public listings/catalog JSON cacheable |
| Service worker | offline/instant repeat | **Kill-switch only** (`public/sw.js` unregisters + purges) |
| Criterion / k6 | enforce budgets | **Partial (PERF-10)** — scripts under `tests/load/`; optional CI `k6-smoke` when `K6_BASE_URL` set (schedule / dispatch). Not capacity proof |
| Lighthouse lab (`/`, `/marketplace`, `/jobs`) | regression floors | **Partial (PERF-02)** — `npm run lighthouse:ci`; CI optional (PR soft / nightly hard); not North Star |

## JS budgets (React-floor-aware — measured, not aspirational)
| Surface | First Load JS budget |
|--------|--------|
| Shared by all routes | ≤ **190 kB** parsed (~60 kB gzip) — the React+Next runtime floor; **don't regress** |
| Interactive route (auctions, sell, dashboards) | ≤ **300 kB** First Load; trim with islands/dynamic |
| Read/catalog route (browse, listing detail) | as low as possible toward the shared floor |
| Genuinely-static surface (pure RSC, no islands) | **< 20–35 kB** total — only place aggressive MPA budgets apply |

## Stack reality (do not pretend otherwise)
Frontend is **Next.js 15 App Router + React 19**. Backend is **Go** (gateway + gRPC services).
Performance-critical compute is **Rust** in `engines/` (backend gRPC, not browser WASM today).
There is currently **no Go `templ` app rendering** and **no Rust WASM in the UI**. The McMaster
*goals* are mandatory for new work; the *mechanism* is whatever provably hits them on THIS stack.

## Measured baseline & what we learned (2026-06, `npm run analyze`)
- Shared First Load JS: **~183 kB parsed** (React + react-dom ~107 kB + Next runtime + app-wide
  providers). This is the **React floor** — irreducible without leaving React on that surface.
- Routes range ~220–370 kB First Load; the heaviest are *interactive* (auctions, sell, onboarding),
  not catalog. Catalog pages (`/marketplace` 272 kB, `/marketplace/[id]` 268 kB) carry small
  route-specific JS (13–23 kB) — already lean.
- Heavy deps are **already lazy/route-isolated**: `mapbox-gl` is in an async chunk, not in any
  First Load. **Dependency-carving is largely exhausted.**
- **Accepted budget overages (re-measured 2026-06-10, post-RSC conversions):** `/jobs/[id]`
  **375 kB** and `/jobs/new` **309 kB** exceed the ≤300 kB interactive budget. Audited the island
  tree: charts are hand-rolled; the only notable dep is `react-grid-layout` for the live-auction
  terminal — lazy-loading the page's primary UI would trade LCP/CLS for bytes. Accepted as the cost
  of the product's most interactive surface. **Revisit if:** the terminal moves off react-grid-layout.
- **Validated:** the RSC pilot (`/marketplace` + `/marketplace/[id]`) left First Load JS flat
  (interactivity is irreducible) but delivered server-rendered first paint + SEO. On interactive
  pages, **RSC wins LCP/SEO, not bundle size.** Don't promise a JS cut from RSC on an interactive surface.
- **Validated (don't re-chase): the app HTML cannot be edge-cached.** Root layout calls
  `await headers()` for the per-request CSP **script** nonce (styles still allow `'unsafe-inline'` —
  see security CSP truth). That forces pages into dynamic rendering. `export const revalidate` / ISR
  on app pages is a **no-op for public HTML caching** while the nonce stands — routes serve
  `Cache-Control: private, no-store` class behavior. Edge-caching the HTML would require dropping the
  nonce (a CSP downgrade) — not worth it. **Cache the DATA layer instead.**
- **Shipped: edge-cache the public DATA, not the HTML.** The Go gateway's public catalog reads use
  `writeCachedJSON` (`gateway/internal/handler/response.go`): `Cache-Control: public, s-maxage +
  stale-while-revalidate + stale-if-error` + strong `ETag`/`304`. `/api/v1/listings` (30s) and
  `/listings/{id}` (15s) are CDN-cacheable; authed/user-specific reads stay uncached. This is the
  security-preserving way to absorb catalog load (keeps strong script CSP).

## RSC-first pattern (recommended for new pages; not yet app-wide)
**Shipped pilots:** marketplace list + detail. **Still client-heavy:** homepage `/`, `/jobs` browse,
and many dashboard routes.

When adding or converting a public page, copy the marketplace pattern:
1. `page.tsx` is a **Server Component**: `async`, server-fetches its data (`GET
   ${API_URL}/api/v1/...`, public reads need no auth), normalizes nullable fields, `notFound()` on
   miss, sets `next: { revalidate: N }` (Next **data-fetch** cache only — the HTML itself stays
   dynamic due to the CSP nonce), and exports `metadata`/`generateMetadata` for SEO.
2. The interactive UI lives in a `*Client.tsx` **island** (`'use client'`) seeded with the server
   data via TanStack Query `initialData` — so first paint is real content, no skeleton, and all
   interactivity (live bidding, WS, countdowns) is preserved unchanged.
3. Keep islands small; push `'use client'` to the leaf. Genuinely-static content stays in the
   Server Component (no client JS).

## Principles (apply to every page/feature)
1. **Server-render the HTML.** Prefer RSC / SSR so first paint is complete HTML. Push `'use client'`
   to the leaf. Stream where it helps.
2. **Hover-prefetch + instant navigation.** Use `<Link>` with prefetch (and `router.prefetch` on
   hover for off-screen/long links).
3. **Aggressive caching where safe.** Go sets `Cache-Control`, `ETag`, `stale-while-revalidate` on
   **public DATA**. Do **not** claim HTML CDN cache or a production SW cache until those exist.
   Current SW is a kill-switch.
4. **Minimal, lightweight everything.** Stay inside the JS budgets. Code-split per route. No trackers/bloat.
5. **Zero layout shift.** Fixed-size images (Next `<Image>` w/ width/height), reserved space for
   async content. Perfect CLS is the goal.
6. **Rust for hot paths only, lazy + measured.** Rust may power a narrow UI module via WASM **only
   when it beats the JS version on a real metric**. TypeScript owns navigation and DOM. Keep all
   existing backend Rust/Go.

## Preservation + proof rules (non-negotiable)
- **Preserve all existing Go, Rust, and the Next.js/React frontend.** Do NOT remove, rewrite, or
  re-architect them unless the change delivers a **measured** win (smaller bundle, faster
  LCP/INP/nav, lower TTFB) shown with before/after numbers.
- **Measure or it didn't happen.** Every perf change reports before/after for the relevant budget
  metric (Lighthouse/field data, bundle analyzer, `curl -w` TTFB, etc.). No unverified "this should
  be faster" claims.
- A change that misses a budget without a written, accepted reason is a regression.

## k6 load / smoke (PERF-10 — Partial)

Scripts live under [`tests/load/`](../tests/load/). Shared config: `config.js` (`BASE_URL`, mock or `AUTH_TOKEN` headers).

| Script | Role |
|--------|------|
| `smoke.js` | **CI path** — 1 VU × 5 iterations, public GETs only (`/healthz`, pricing, markets, categories, jobs, listings) |
| `jobs.js`, `bids.js`, `search.js`, `auction.js`, `websocket.js`, `marketplace-scoreboard.js` | Full load profiles — **local / manual** against a live stack |

```bash
# Install: https://grafana.com/docs/k6/latest/set-up/install-k6/
k6 run tests/load/smoke.js
k6 run -e BASE_URL=http://127.0.0.1:8080 tests/load/smoke.js
k6 run -e BASE_URL=https://staging-api.example.com tests/load/marketplace-scoreboard.js
```

**CI:** `.github/workflows/ci.yml` job **`k6-smoke`** — `schedule` + `workflow_dispatch` only. Skips cleanly when repo variable **`K6_BASE_URL`** (or secret `K6_BASE_URL`) is unset. Optional secret `K6_AUTH_TOKEN` for future authed smokes. `continue-on-error: true`; JSON summary artifact when run. **Not** a PR gate and **not** Done: full staging load proof with real tokens + threshold artifacts still required to close PERF-10.

## TTFB / DATA-layer CDN sampling (PERF-13 recipe)

For **public JSON** TTFB (not HTML), use [`scripts/cdn-ttfb-sample.sh`](../scripts/cdn-ttfb-sample.sh):
`curl -w` reports `time_starttransfer` (TTFB) and `time_total`, plus last-sample cache headers
(`Cache-Control`, `Age`, `ETag`, `CF-Cache-Status`, `X-Cache`). Default paths are
`/api/v1/pricing` and `/api/v1/markets` against `http://127.0.0.1:8080`. Point `BASE_URL` at the
public edge host for CDN numbers and optionally `--write-md` an artifact. This is a **measurement
recipe**, not live CDN proof or a CI gate — companion LAN catalog p50/p95 remains
[`scripts/api-p95-sample.sh`](../scripts/api-p95-sample.sh).

## Lighthouse CI (PERF-02 — Partial)

Lab Lighthouse against a production standalone Next server for **`/`**, **`/marketplace`**,
**`/jobs`**.

| How | Command / job |
|-----|----------------|
| Local | `cd web && npm run lighthouse:ci` (builds into `.next-lhci`, boots standalone on `:3011`, asserts) |
| Deeper sample | `LHCI_NUMBER_OF_RUNS=3 npm run lighthouse:ci` |
| Reuse build | `LHCI_SKIP_BUILD=1 npm run lighthouse:ci` |
| CI | `.github/workflows/ci.yml` job **`lighthouse-budget`** — PR + nightly schedule + `workflow_dispatch` |

**CI posture (honest Partial):**
- **Not a hard PR gate** — `continue-on-error: true` on `pull_request` so merge is not blocked.
- **Nightly / workflow_dispatch hard-fail** when regression floors break (signal without PR noise).
- Does **not** join the `build` `needs` chain.
- No live gateway in the job — public routes fail-soft (empty catalogs). Scores are **lab**, not field.

**Config:** [`web/lighthouserc.cjs`](../web/lighthouserc.cjs) + wrapper
[`web/scripts/run-lighthouse-ci.mjs`](../web/scripts/run-lighthouse-ci.mjs).

| Metric | CI regression floor (asserted) | Stretch / North Star (not asserted) |
|--------|--------------------------------|-------------------------------------|
| Performance score | ≥ 0.30 | ≥ 0.90 |
| Accessibility score | ≥ 0.70 | ≥ 0.95 (product a11y is jsx-a11y + axe) |
| LCP (lab) | ≤ 12s | field P75 < 1.5s; lab stretch < 2.5s |
| CLS (lab) | ≤ 0.50 | < 0.05 |
| TBT / TTI | warn only (3s / 15s) | — |

Floors exist to catch catastrophic regressions, not to claim North Star. Local smoke
(2026-07-27, desktop preset, empty API): Performance ~0.8–0.98, LCP ~1.0–1.2s, homepage
CLS ~0.23–0.38 — **do not treat those as field RUM**. Ratchet floors down only after repeated
green runs; never raise without updating this table.

Reports land in `web/lighthouse-reports/` (gitignored); CI uploads them as artifacts.
