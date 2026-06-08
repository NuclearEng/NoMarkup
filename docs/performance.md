# NoMarkup — Performance Playbook (measured baseline & detail)

> Offloaded from `CLAUDE.md` §14 to keep the always-loaded rules file lean. CLAUDE.md keeps the
> north star, the hard-gate budgets, the default RSC pattern, and the two non-negotiable
> "validated" learnings. This file holds the full baseline narrative and the principles list.

**North star:** NoMarkup must feel *instantly responsive*, on par with or faster than mcmaster.com
(one of the fastest catalog sites on the internet). Speed is a feature and a first-class
acceptance criterion, not an afterthought.

## JS budgets (React-floor-aware — measured, not aspirational)
| Surface | First Load JS budget |
|--------|--------|
| Shared by all routes | ≤ **190 kB** parsed (~60 kB gzip) — the React+Next runtime floor; **don't regress** |
| Interactive route (auctions, sell, dashboards) | ≤ **300 kB** First Load; trim with islands/dynamic |
| Read/catalog route (browse, listing detail) | as low as possible toward the shared floor |
| Genuinely-static surface (pure RSC, no islands, or a future Go-`templ` page) | **< 20–35 kB** total — the only place the aggressive McMaster-MPA budget applies |

## Stack reality (do not pretend otherwise)
Frontend is **Next.js 15 App Router + React 19** (81 pages). Backend is **Go** (gateway + gRPC
services). Performance-critical compute is **Rust** in `engines/` (backend gRPC, not browser WASM
today). There is currently **no Go `templ`/`html/template` app rendering** and **no Rust WASM in
the UI**. The McMaster *goals* are mandatory; the *mechanism* is whatever provably hits them on
THIS stack. Do not invent a Go-SSR or WASM layer unless it measurably beats the Next.js equivalent.

## Measured baseline & what we learned (2026-06, `npm run analyze`)
- Shared First Load JS: **~183 kB parsed** (React + react-dom ~107 kB + Next runtime + app-wide
  providers). This is the **React floor** — irreducible without leaving React on that surface.
- Routes range ~220–370 kB First Load; the heaviest are *interactive* (auctions, sell, onboarding),
  not catalog. Catalog pages (`/marketplace` 272 kB, `/marketplace/[id]` 268 kB) carry small
  route-specific JS (13–23 kB) — already lean.
- Heavy deps are **already lazy/route-isolated**: `mapbox-gl` (~454 kB) is in an async chunk, not
  in any First Load; `recharts` is confined to `/sell/analytics`. **Dependency-carving is
  exhausted — no headroom there.**
- **Validated:** the RSC pilot (`/marketplace` + `/marketplace/[id]`) left First Load JS flat
  (interactivity is irreducible) but delivered server-rendered first paint + SEO. On interactive
  pages, **RSC wins LCP/SEO, not bundle size.** Don't promise a JS cut from RSC on an interactive surface.
- **Validated (don't re-chase): the app HTML cannot be edge-cached.** `layout.tsx` calls
  `await headers()` to read the per-request CSP nonce (lets us drop `'unsafe-inline'`, §6), which
  forces EVERY page into dynamic rendering. `export const revalidate` / ISR on app pages is a
  **no-op** while the nonce stands — verified: routes build `ƒ` and serve `Cache-Control: private,
  no-store`. Edge-caching the HTML would require dropping the nonce (a CSP downgrade) — not worth
  it. **Cache the DATA layer instead.**
- **Shipped: edge-cache the public DATA, not the HTML.** The Go gateway's public catalog reads use
  `writeCachedJSON` (`gateway/internal/handler/response.go`): `Cache-Control: public, s-maxage +
  stale-while-revalidate + stale-if-error` + strong `ETag`/`304`. `/api/v1/listings` (30s) and
  `/listings/{id}` (15s) are CDN-cacheable; authed/user-specific reads stay uncached. This is the
  security-preserving way to absorb catalog load (keeps the strong CSP).

## Default pattern for new pages: RSC-first + seeded client island (proven)
Shipped on the marketplace pages — copy it:
1. `page.tsx` is a **Server Component**: `async`, server-fetches its data (`GET
   ${API_URL}/api/v1/...`, public reads need no auth), normalizes nullable fields, `notFound()` on
   miss, sets `next: { revalidate: N }` (Next data-fetch cache only — the HTML itself stays dynamic
   due to the CSP nonce), and exports `metadata`/`generateMetadata` for SEO.
2. The interactive UI lives in a `*Client.tsx` **island** (`'use client'`) seeded with the server
   data via TanStack Query `initialData` — so first paint is real content, no skeleton, and all
   interactivity (live bidding, WS, countdowns) is preserved unchanged.
3. Keep islands small; push `'use client'` to the leaf. Genuinely-static content stays in the
   Server Component (no client JS).

## Principles (apply to every page/feature)
1. **Server-render the HTML.** Default to RSC / SSR so first paint is complete HTML, not a client
   render. Push `'use client'` to the leaf. Stream where it helps.
2. **Hover-prefetch + instant navigation.** Use `<Link>` with prefetch (and `router.prefetch` on
   hover for off-screen/long links) so the next page is in cache before click; client nav swaps
   content without a full reload. (Next's built-in equivalent of the McMaster hover-prefetch +
   History-API swap — use it before hand-rolling vanilla TS.)
3. **Aggressive caching everywhere.** Go sets `Cache-Control`, `ETag`, `stale-while-revalidate`.
   Cache full HTML/JSON at the CDN edge (Cloudflare). Ship a minimal service worker for instant
   repeat visits + background refresh.
4. **Minimal, lightweight everything.** Stay inside the JS budgets. Inline critical CSS;
   async/defer the rest. Code-split per route. No trackers/bloat.
5. **Zero layout shift.** Fixed-size images (Next `<Image>` w/ width/height), reserved space for
   async content, sprites/icons sized. Perfect CLS is the goal.
6. **Rust for hot paths only, lazy + measured.** Rust may power a narrow, compute-heavy UI module
   via lazily-loaded WASM **only when it beats the JS version on a real metric** and does not grow
   the initial bundle or slow prefetch/nav. TypeScript always owns navigation and DOM. Rust is
   never the UI framework. Keep all existing backend Rust/Go.

## Preservation + proof rules (non-negotiable)
- **Preserve all existing Go, Rust, and the Next.js/React frontend.** Do NOT remove, rewrite, or
  re-architect them unless the change delivers a **measured** win (smaller bundle, faster
  LCP/INP/nav, lower TTFB) shown with before/after numbers.
- **Measure or it didn't happen.** Every perf change reports before/after for the relevant budget
  metric (Lighthouse/field data, bundle analyzer, `curl -w` TTFB, etc.). No unverified "this should
  be faster" claims.
- A change that misses a budget without a written, accepted reason is a regression.
