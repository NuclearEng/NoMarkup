# Cloudflare edge — in-repo inventory (OPS-24)

## Claim vs reality

| Claim (product) | In-repo evidence | Live provision |
|-----------------|------------------|----------------|
| Registrar + DNS for zone **`no-markup.com`** (hyphenated; `nomarkup.com` **not** owned) | Documented in `Claude.md` §2, README, launch-checklist | Founder owns the Cloudflare account; **no** API token, Zone ID, or account ID is committed |
| CDN / edge for public **DATA** (not HTML) | Origin `writeCachedJSON` (`gateway/internal/handler/response.go`): `public, s-maxage` + ETag/304 | CDN must honor origin cache headers; orange-cloud proxy is Founder/dashboard |
| Auth cache bypass on API | Expression + verification steps in [`cdn-cache-auth-bypass.md`](./cdn-cache-auth-bypass.md) | **Must be applied in Cloudflare** — cannot be enforced from origin alone |
| WAF / bot / DDoS | Planned posture in [`abuse-defense.md`](./abuse-defense.md) | Founder: WAF custom rules, rate limits, Under Attack Mode |

**Not in this repo (by design until credentials exist):**

- Cloudflare Terraform provider / `wrangler.toml` / Workers scripts
- Zone-level API exports or rule JSON committed with secrets
- Account ID / Zone ID (Vault / `.env.local` only)

Do not claim “Cloudflare fully configured as code” while this inventory is docs + origin headers only.

## Origin behavior the edge must complement

1. **Public catalog JSON** — gateway sets cache-friendly headers via `writeCachedJSON` for anonymous reads. Authed requests stay `private, no-store`.
2. **App HTML is not edge-cacheable** — root layout CSP nonce forces dynamic HTML (Claude.md §14). Cache **data**, not pages.
3. **Auth bypass rule (required for correctness)** — if a public body is cached at the edge, a signed-in browser can receive it without hitting origin. Apply the expression in [`cdn-cache-auth-bypass.md`](./cdn-cache-auth-bypass.md) on the API hostname.

### Suggested Cache Rule (summary)

```
(http.request.uri.path starts_with "/api/v1/") and (
  is_defined(http.request.headers["authorization"]) or
  http.request.headers["cookie"][0] contains "refresh_token="
)
```

Action: **Bypass cache**.

### Suggested page-rule / Cache-Everything exclusions

- `/api/v1/*` with credentials → Bypass (above)
- `/_next/static/*` → long TTL (origin also sets `immutable` in `next.config.ts`)
- HTML document routes → respect origin (no aggressive “Cache Everything” on `/`)

## Verification (Founder after dashboard apply)

1. Anonymous warm GET of a `writeCachedJSON` route → `CF-Cache-Status: HIT` (or equivalent).
2. Same URL with `Authorization: Bearer …` → `DYNAMIC` / BYPASS; body matches origin for that session.
3. TTFB + cache headers via [`scripts/cdn-ttfb-sample.sh`](../../scripts/cdn-ttfb-sample.sh) once DNS points at CF:
   `BASE_URL=https://api.<zone> ./scripts/cdn-ttfb-sample.sh --artifact-dir artifacts/cdn-ttfb`
   Optional CI: set repo var `CDN_TTFB_BASE_URL` (or reuse `K6_BASE_URL`); job `cdn-ttfb-sample` on schedule/`workflow_dispatch` uploads `cdn-ttfb-<run_id>` (PERF-13 Partial — not automatic live proof until that URL is the real edge).

## Residual (Founder-Action)

- Create/own zone `no-markup.com` in Cloudflare if not already.
- Orange-cloud proxy for web + API hostnames; TLS 1.3 at edge.
- Apply auth cache-bypass + WAF baselines from this doc + abuse-defense.
- Store Account/Zone IDs in Vault — never git.

**Status mapping:** OPS-24 is **Partial** when this inventory + auth-bypass recipe exist; **Done** only when live CF rules are applied and verified (Founder).
