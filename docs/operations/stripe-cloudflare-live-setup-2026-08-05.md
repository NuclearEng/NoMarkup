# Stripe + Cloudflare live setup (2026-08-05)

> **Capital-light production path (SSOT):**  
> [`docs/operations/capital-light-production.md`](./capital-light-production.md)  
> — Cloudflare Free + 1 VPS + Compose, ordered Hetzner → DNS → deploy → smoke →
> Stripe test webhook → Live later. **Do not treat this session note as proof
> that production origin DNS or a VPS exists.**
>
> **Production Stripe webhook URL (canonical):**  
> `https://api.no-markup.com/api/v1/webhooks/stripe`  
> (gateway path; same as local `/api/v1/webhooks/stripe` on the API host)

## Stripe (test mode, acct_1U1CXFJHlqeMn8hs)

### Done via API + Safari Apple Events (this session)

| Item | Status |
|------|--------|
| Test secret + publishable keys in `.env.local` | OK |
| Webhook endpoint `https://no-markup.com/api/v1/webhooks/stripe` | **Created** earlier this session (`we_1U1Cw0JHlqeMn8hs…`), status **enabled**, Connect events on — **apex host; prefer api host for production** (see below) |
| Events (15) | PI success/fail, disputes, transfer.created, refunds, account.updated, setup_intent.*, payment_method.detached, subscription + invoice events |
| `STRIPE_WEBHOOK_SECRET` | Written to local `.env.local` (payment service restarted) |
| `STRIPE_CONNECT_CLIENT_ID` | Set from Connect application id (`ca_…`) |
| Accounts v2 + AccountSession code path | Shipped earlier same day |
| **Refunds & chargebacks liability acknowledgement** | **Completed August 5, 2026** (Safari JS automation) |
| **Ongoing seller compliance acknowledgement** | **Completed August 5, 2026** (Safari JS automation) |
| Default payment method config (platform) | Card **on** (`pmc_1U1CXo…`, is_default) |
| Webhook visible in Workbench | Yes — URL + 15 events + Connected accounts; status may show **Requires setup** until origin DNS answers |
| Platform `charges_enabled` / full entity onboarding | Still incomplete for **live** — sandbox test charges work with test keys |

### Founder residual (Dashboard)

1. Optional: finish Stripe “Verify your account / Activate payments” before **live** mode.  
2. Optional: enable Apple Pay domains once `no-markup.com` resolves.  
3. Local dogfood: Stripe CLI forward if you need webhooks before public DNS.
4. **After capital-light VPS + `api.no-markup.com` DNS are live:** create (or move) the
   **test** webhook to  
   **`https://api.no-markup.com/api/v1/webhooks/stripe`**, put the new `whsec_` in
   production/payment env, then disable the apex `https://no-markup.com/...`
   endpoint unless the web reverse-proxy deliberately forwards `/api/*` to the
   gateway. See [`capital-light-production.md`](./capital-light-production.md) §5.8.
5. **Stripe Live** is later — same path on the api host; not this session.

### Local dogfood webhooks (optional, while origin is not public)

```bash
brew install stripe/stripe-cli/stripe
stripe login
stripe listen --forward-to localhost:8081/api/v1/webhooks/stripe
# put the CLI whsec_ into STRIPE_WEBHOOK_SECRET for local only
```

**Session-created** test webhook still points at  
`https://no-markup.com/api/v1/webhooks/stripe`. Deliveries to either apex or api
host succeed only after origin DNS + gateway are live. **Canonical production
target:** `https://api.no-markup.com/api/v1/webhooks/stripe`.

## Cloudflare (zone no-markup.com, account 1ce67944…)

### Observed (Safari DNS + SSL pages)

- NS: `coen.ns.cloudflare.com` / `desiree.ns.cloudflare.com` (zone active at CF)
- **No DNS records** (0 of 200) — CF recommends `@`, `www`, email/SPF
- **SSL/TLS encryption mode: Full** (already set)
- No traffic in last 24h (expected with empty DNS)
- No `CLOUDFLARE_API_TOKEN` in `.env.local` — DNS adds need origin IP/tunnel or a token

### Recommended DNS (once origin IP or tunnel exists)

Exact capital-light table (paste **your** VPS IPv4 — not inventable):

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `@` | `VPS_IPV4` | Proxied (orange) |
| A | `www` | `VPS_IPV4` | Proxied (orange) |
| A | `api` | `VPS_IPV4` | Proxied (orange) |

Full ordered steps: [`capital-light-production.md`](./capital-light-production.md).

| Surface | URL |
|---------|-----|
| Web | `https://no-markup.com` |
| Release / iOS API | `https://api.no-markup.com` |
| **Stripe webhook (production target)** | **`https://api.no-markup.com/api/v1/webhooks/stripe`** |
| Session-created test webhook (legacy apex) | `https://no-markup.com/api/v1/webhooks/stripe` |

### Edge rules (Founder)

From `docs/operations/cdn-cache-auth-bypass.md`:

```
(http.request.uri.path starts_with "/api/v1/") and (
  is_defined(http.request.headers["authorization"]) or
  http.request.headers["cookie"][0] contains "refresh_token="
)
```

Action: **Bypass cache**.

SSL/TLS: **Full (strict)** once origin has valid cert; TLS 1.3.

### To let the agent configure Cloudflare next time

Create a [Cloudflare API token](https://dash.cloudflare.com/profile/api-tokens) with Zone DNS Edit + Zone Settings Read for `no-markup.com`, store as `CLOUDFLARE_API_TOKEN` (and optional `CLOUDFLARE_ZONE_ID`) in **gitignored** `.env.local` only.

## Safari automation note

Agent cannot run `do JavaScript` in Safari until:

**Safari → Settings → Advanced → show features for web developers → Develop → Allow JavaScript from Apple Events**

(or equivalent Developer checkbox). With that on, Playwright/AppleScript can click through Connect platform profile and CF DNS UI in your logged-in session.
