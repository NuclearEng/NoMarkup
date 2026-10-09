# Abuse Defense — Rate Limiting, DDoS, Auth

> What stops a 100k-RPS scraper, a credential-stuffing botnet, or a single
> bad actor from breaking the platform?

## Layers (defense in depth)

```
   Internet
      │
      ▼
┌─────────────────┐
│   Cloudflare    │  L3/L4 DDoS scrubbing, bot detection, WAF rules,
│                 │  challenge for suspicious traffic. Free at any scale.
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Ingress / NGINX │  TLS, basic rate caps per IP at the edge.
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Gateway       │  Per-IP + per-user rate limiting (Redis-backed,
│                 │  in-memory fallback). Tier-based (auth / strict /
│                 │  standard). Idempotency-Key enforcement on
│                 │  payments + subscriptions.
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Backend svcs   │  Application-level checks: ownership, party access,
│                 │  fraud scoring, business rules.
└─────────────────┘
```

## What's wired today

### Cloudflare (planned)

Per the launch checklist, Cloudflare CDN is provisioned for static assets.
For full WAF / DDoS coverage on the API origin, we need to put `nomarkup.com`
and `api.nomarkup.com` behind Cloudflare's proxy (orange cloud).

**Default WAF rules to enable:**
- "OWASP ModSecurity Core Rule Set" — block CRS class 3+.
- Bot Fight Mode → enabled.
- "Browser Integrity Check" → enabled.
- Custom WAF: block PUT/PATCH/DELETE without `Authorization` header at the
  edge (defense-in-depth — gateway will reject anyway).
- Rate limit at edge: 1000 req/min per IP across all paths (above any
  legitimate user). Acts as a DDoS dampener before traffic reaches origin.

### Ingress

Nginx ingress controller (per `deploy/k8s/base/ingress.yaml`) terminates TLS
and forwards to the gateway. Default config has no rate limit at this layer
(gateway handles it). If we ever lose Cloudflare temporarily, add:
```yaml
nginx.ingress.kubernetes.io/limit-rps: "100"
nginx.ingress.kubernetes.io/limit-burst-multiplier: "5"
nginx.ingress.kubernetes.io/limit-connections: "30"
```

### Gateway rate limiter

Implementation: `gateway/internal/middleware/ratelimit.go`.

**Two-axis limiting:** every request is checked against:
1. **Per-IP**: prevents anonymous flood.
2. **Per-user** (when JWT claims present): prevents one user from hogging an
   IP they share (office / café / mobile NAT).

Both limits use the same per-tier numeric value; the user must satisfy both.

**Three tiers:**
| Tier      | Limit (prod) | Limit (dev — 10x) | Routes                             |
|-----------|-------------:|-------------------:|------------------------------------|
| Standard  | 60 req/min   | 600 req/min        | All authenticated business routes  |
| Strict    | 10 req/min   | 100 req/min        | Expensive ops (admin, payments, contracts, reviews, subscriptions, MFA setup, password-reset request, OTP send) |
| Auth      | 20 req/min   | 200 req/min        | Login, register, refresh, MFA verify, password reset, email/phone verify |
| None      | (unlimited)  | (unlimited)        | `/healthz`, `/readyz`              |

**Window:** 1 minute sliding.
**Storage:** Redis (`cache.RateLimitCheck`) when available; in-memory map fallback (`memoryLimiter`) per pod when not. The in-memory mode is fine for dev but
loses the per-IP guarantee across pods in production; **Redis is required for prod**.

**Auth limit override** (knob for game-day or recovery from refresh storm):
```bash
kubectl set env deployment/gateway RATE_LIMIT_AUTH=100
kubectl rollout restart deployment/gateway
```

### Idempotency

All POST / PATCH on `/payments/*` and `/subscriptions/*` require an
`Idempotency-Key` header (`gateway/internal/middleware/idempotency.go`).
Requests without the header get 400. Replays of the same key within 24h
get the cached response and never hit the backend twice.

### Authentication-specific defenses

- Argon2id for password hashing (memory=65536, iterations=3, parallelism=4).
- 5 failed login attempts in 15 min triggers a 15-min lockout (handled in
  user service).
- Login + register hits write to `audit_log` with IP and user-agent. Patterns
  like single IP attempting many emails surface in fraud scoring.
- MFA challenge tokens are one-time use, 5-minute TTL, stored in Redis.
- Refresh tokens are stored hashed in `sessions` and revoked on every refresh
  (rotation).

### WebSocket origin allowlist

`WS_ALLOWED_ORIGINS` env enforces an Origin header allowlist on chat and
auction WebSockets. Empty value defaults to production hosts only (fails
closed).

### Trusted proxies

`TRUSTED_PROXIES` env defines which CIDRs may set `X-Forwarded-For` /
`X-Real-IP`. Without this list, an attacker could spoof their IP and bypass
per-IP rate limits. Defaults are loopback + RFC1918 + IPv6 ULA — production
should narrow to the actual proxy egress range.

## Threat → Defense Map

| Threat                                  | Defense layer                                             |
|----------------------------------------|-----------------------------------------------------------|
| L3/L4 DDoS                              | Cloudflare scrubbing                                      |
| L7 flood (single IP)                    | Cloudflare edge rate limit + gateway per-IP rate limit    |
| L7 flood (botnet, distributed)          | Cloudflare bot fight + per-user rate limit (forces signup)|
| Credential stuffing                     | Argon2id + 5-fail lockout + per-IP auth limit + fraud scoring on novel device |
| Account takeover via session hijack     | Short-lived JWT (15m) + httpOnly secure refresh cookie + IP/UA mismatch flag |
| Replay attacks on payments              | Idempotency-Key required                                  |
| Stripe webhook spoofing                 | Stripe signature verification (mandatory in payment svc)  |
| Multi-account fraud rings               | Fraud engine fingerprint correlation + manual T&S review  |
| Scraper / data harvesting               | Cloudflare bot mode + per-IP rate limit + auth required   |
| Sealed-bid sniping                      | Bid-engine snipe extension cap + per-bid rate            |
| Resource exhaustion (huge upload)       | Max body size (10MB images, 25MB docs) at gateway         |
| Slowloris                               | Read header timeout + write timeout on http.Server        |
| SSRF / SQLi / XSS                       | Parameterized queries + Zod validation + CSP headers      |
| Spam (job posts, reviews)               | Trust score gate on posting + admin review queue          |

## Operational Knobs

When under attack:
1. Cloudflare → "Under Attack Mode" (interstitial JS challenge for every visitor).
2. Lower rate limit tiers via Redis (`SET ratelimit:override:auth 5`).
3. Block specific IPs at the WAF (Cloudflare → Security → WAF Custom Rules).
4. Disable a specific endpoint via feature flag (e.g. `feature.public_provider_search=false`).

## Verification

```bash
# Confirm gateway rate limit is enforcing per-IP:
for i in $(seq 1 30); do
  curl -s -o /dev/null -w '%{http_code}\n' \
    https://nomarkup.com/api/v1/auth/register -X POST \
    -H "Content-Type: application/json" \
    -d '{"email":"rl-test@example.com","password":"x"}'
done | sort | uniq -c
# Expect: ~20x 400/409, then ~10x 429.

# Confirm Idempotency-Key enforcement:
curl -i .../payments -X POST -H "Authorization: Bearer ..." -H "Content-Type: application/json" -d '{}'
# Expect: 400 missing Idempotency-Key.

curl -i .../payments -X POST -H "Authorization: Bearer ..." -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" -d '{...}'
# Expect: 200/201 first, 200 cached on second call with same key.
```

## Owner

- Cloudflare config: Platform team.
- Gateway rate limiter: Gateway service team.
- Fraud signals: Engines team (fraud engine).
- Trust & Safety policy: Trust & Safety team.
