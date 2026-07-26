# CDN cache bypass for authenticated API traffic (C7)

## Gap

`writeCachedJSON` refuses to **store** a public body for a request the gateway
has associated with a user (`private, no-store` when claims or the
`refresh_token` cookie are present). That prevents a per-user body being
written into the shared cache.

It does **not** prevent a public (anonymous) body already held at the edge from
being **served** to a signed-in caller: if the CDN has a fresh entry for that
URL, the origin is never consulted and the origin guard never runs.

## Done when

A Cloudflare (or equivalent edge) rule on the API zone bypasses cache when
any of the following are present on the request:

- `Authorization` header (Bearer access token)
- `Cookie` containing `refresh_token=` (httpOnly refresh cookie)
- Optionally `Cookie` containing `has_session=1` if product wants signed-in
  browsers to always revalidate catalog data (hit-rate tradeoff)

## Cannot be done from the origin

This rule lives on the CDN configuration for the API hostname. The origin can
only set response headers; it cannot force the edge to skip a cached entry for
a request it never sees.

## Suggested Cloudflare expression

```
(http.request.uri.path starts_with "/api/v1/") and (
  is_defined(http.request.headers["authorization"]) or
  http.request.headers["cookie"][0] contains "refresh_token="
)
```

Cache rule action: **Bypass cache** (or Cache Level: Bypass).

## Verification (not done in this environment)

No Cloudflare API credentials here. After applying:

1. Anonymous GET of a `writeCachedJSON` route → `CF-Cache-Status: HIT` after warm.
2. Same URL with `Authorization: Bearer …` → `CF-Cache-Status: DYNAMIC` / BYPASS
   and response body matches origin for that user context.
3. Confirm anonymous hit rate on catalog routes does not collapse (Bearer is
   attached by the web client for signed-in browsing of public pages — the
   origin already does not downgrade on bare Authorization without resolved
   claims; the CDN rule is stricter and is a product choice).
