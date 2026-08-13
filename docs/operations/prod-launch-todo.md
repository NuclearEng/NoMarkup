# Production go-live todo (Lightsail + Cloudflare + Stripe + iOS)

**Status:** Deferred until founder finishes development and testing.  
**Day-to-day now:** local `bin/dev` + Stripe **test** only.  
**Resume phrases for agent:** `resume production deploy` or `Lightsail IP: x.x.x.x`

| Doc | Role |
|-----|------|
| [`capital-light-production.md`](./capital-light-production.md) | Architecture + ordered path |
| [`lightsail-create-guide.md`](./lightsail-create-guide.md) | Exact Lightsail create clicks |
| [`deploy/prod/README.md`](../../deploy/prod/README.md) | Compose / Caddy on the box |
| [`scripts/prod/README.md`](../../scripts/prod/README.md) | Bootstrap / deploy / smoke / backup |
| [`ios-prod-api-readiness.md`](./ios-prod-api-readiness.md) | iOS Release API host |
| [`cdn-cache-auth-bypass.md`](./cdn-cache-auth-bypass.md) | Cloudflare auth cache-bypass rule |

**Cost target:** ~$10–25/mo (Lightsail 4 GB + Cloudflare Free). No EKS/Firebase day one.

---

## Phase 0 — Already done (in-repo)

- [x] Capital-light decision: Cloudflare Free + **AWS Lightsail** + Docker Compose + Caddy
- [x] `deploy/prod/docker-compose.yml` (lean stack + optional profiles)
- [x] `deploy/prod/Caddyfile` (`no-markup.com` / `www` → web, `api.no-markup.com` → gateway)
- [x] `deploy/prod/.env.example`
- [x] `scripts/prod/bootstrap-vps.sh`, `deploy.sh`, `backup-pg.sh`, `smoke.sh`
- [x] iOS Release → `https://api.no-markup.com` (Info.plist empty; Archive https-only)
- [x] Stripe **test** keys in local `.env.local` + Connect liability acks (test Dashboard)
- [x] Stripe **test** webhook endpoint created (may still point at apex URL — move to `api` host in Phase 4)

---

## Phase 1 — AWS Lightsail (Founder)

**Console:** [https://lightsail.aws.amazon.com](https://lightsail.aws.amazon.com)  
**Guide:** [`lightsail-create-guide.md`](./lightsail-create-guide.md)

- [ ] AWS account ready (billing enabled)
- [ ] Create instance
  - [ ] Region: **us-west-2** (Oregon) or **us-west-1** (preferred for King County)
  - [ ] Blueprint: **OS Only → Ubuntu 24.04 LTS**
  - [ ] Plan: **4 GB RAM (~$20/mo)** recommended (2 GB only if cash-tight)
  - [ ] Name: `nomarkup-prod`
  - [ ] SSH key attached / `.pem` saved safely
- [ ] Create **static IP** and attach to instance
- [ ] Firewall IPv4: **TCP 22, 80, 443**
- [ ] (Optional) Automatic snapshots enabled
- [ ] Record: static IPv4, region, SSH key path
- [ ] Confirm SSH works: `ssh ubuntu@STATIC_IP`

**Hand off to agent:** paste `Lightsail IP: x.x.x.x` (and region if not us-west-2).

---

## Phase 2 — Server bootstrap + secrets

**On instance (or agent via SSH):**

- [ ] Clone NoMarkup repo (or rsync release) to e.g. `/opt/nomarkup`
- [ ] `sudo bash scripts/prod/bootstrap-vps.sh` (Docker, Compose plugin, UFW 22/80/443)
- [ ] `cp deploy/prod/.env.example deploy/prod/.env` and fill production values
  - [ ] `ENVIRONMENT=production`
  - [ ] Strong `POSTGRES_PASSWORD`, `REDIS` auth if used, `MEILI_MASTER_KEY`
  - [ ] `DATABASE_URL` / `REDIS_URL` matching compose services
  - [ ] Stripe **test** keys first (Live later): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`
  - [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / web public API URL for `api.no-markup.com`
  - [ ] `FRONTEND_URL=https://no-markup.com`
  - [ ] `OAUTH_REDIRECT_BASE=https://api.no-markup.com`
  - [ ] **OAuth (OAUTH-FULL-SETUP — also in `docs/TODOS.md` #19):**
    - [ ] `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (Web client; redirect `https://api.no-markup.com/api/v1/auth/callback/google`)
    - [ ] `FACEBOOK_CLIENT_ID` + `FACEBOOK_CLIENT_SECRET` (redirect `…/callback/facebook`)
    - [ ] `APPLE_CLIENT_ID` + `APPLE_CLIENT_SECRET` (Sign in with Apple Services ID)
    - [ ] Optional: `GOOGLE_IOS_CLIENT_ID` for native iOS
    - [ ] Dogfood each provider once after first deploy
  - [ ] `ENCRYPTION_KEY`, `SESSION_SECRET`, JWT paths
  - [ ] `ACME_EMAIL` for Caddy (or document Cloudflare Full / tls strategy)
- [ ] Generate JWT keypair under `deploy/prod/keys/` (see `deploy/prod/README.md`)
- [ ] `chmod 600 deploy/prod/.env` and restrict key files
- [ ] Confirm **no secrets committed** to git
- [ ] Run `make founder-secrets-check` (or `./scripts/founder-secrets-check.sh --strict` on the box) before go-live — fail-closed inventory of OAuth / SendGrid / Sentry / Stripe / `ENCRYPTION_KEY` / Checkr / Apple Pay association / `DEPLOY_PROVISIONED`. Does **not** provision secrets; Founder-Action residuals stay open until a human fills them.

Process start is already fail-closed for JWT public-key load (gateway, every env), `STRIPE_SECRET_KEY` (payment, non-dev), `STRIPE_WEBHOOK_SECRET` (payment, every env), and `ENCRYPTION_KEY` (production PII cipher). Do **not** add OAuth / SendGrid / Sentry / Apple Pay to `bin/dev` startup — local dev stays advisory via this check.

---

## Phase 3 — Cloudflare DNS + edge

**Console:** [https://dash.cloudflare.com](https://dash.cloudflare.com) → zone **`no-markup.com`**

### DNS (all Proxied / orange cloud)

| Type | Name | Content | Proxied |
|------|------|---------|---------|
| A | `@` | Lightsail static IP | Yes |
| A | `www` | Lightsail static IP | Yes |
| A | `api` | Lightsail static IP | Yes |

- [ ] Add `@` A record
- [ ] Add `www` A record
- [ ] Add `api` A record
- [ ] SSL/TLS mode: **Full** first; move to **Full (strict)** once origin cert is valid
- [ ] Confirm DNS resolves: `dig +short api.no-markup.com` (CF anycast, not raw IP)

### Cache / security

- [ ] Apply **auth cache-bypass** on API (see [`cdn-cache-auth-bypass.md`](./cdn-cache-auth-bypass.md)):
  - Path starts with `/api/v1/` **and** (`Authorization` present **or** cookie contains `refresh_token=`) → **Bypass cache**
- [ ] (Optional) Basic WAF / bot fight mode — keep simple on free plan
- [ ] (Optional later) R2/S3 for uploads and off-box backups

---

## Phase 4 — Deploy app stack + smoke

**On server:**

- [ ] `bash scripts/prod/deploy.sh` (or `docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env up -d --build`)
- [ ] Migrations completed (compose `migrate` service / job)
- [ ] Lean services up: caddy, postgres, redis, meilisearch, user, job, payment, gateway, web
- [ ] `make origin-check` (default allow-down; `ORIGIN_CHECK_STRICT=1 make origin-check` once DNS is live)
- [ ] Smoke:
  ```bash
  BASE_URL=https://no-markup.com \
  API_URL=https://api.no-markup.com \
  bash scripts/prod/smoke.sh
  ```
- [ ] Manual checks:
  - [ ] `https://api.no-markup.com/healthz` → 200
  - [ ] `https://api.no-markup.com/readyz` → 200
  - [ ] `https://no-markup.com` loads
  - [ ] Login / one authenticated API call works

### Backups

- [ ] Run `bash scripts/prod/backup-pg.sh` once successfully
- [ ] Install cron (nightly) for `backup-pg.sh`
- [ ] (Recommended) Copy dumps off-box (S3/R2/local download) weekly

---

## Phase 5 — Stripe (public origin)

**Dashboard:** [https://dashboard.stripe.com](https://dashboard.stripe.com)

### Test mode (first, against real DNS)

- [ ] Webhook endpoint URL:  
  **`https://api.no-markup.com/api/v1/webhooks/stripe`**
- [ ] Events include at least:  
  `payment_intent.*`, `charge.dispute.*`, `transfer.created`, `charge.refunded`,  
  `account.updated`, `setup_intent.*`, `payment_method.detached`, subscription/invoice as needed
- [ ] Connect / account events enabled as required
- [ ] `STRIPE_WEBHOOK_SECRET` on server matches this endpoint (update `.env` + restart payment/gateway)
- [ ] Trigger a test event; confirm payment service accepts signature
- [ ] Remove or disable obsolete webhook URLs (e.g. apex-only if unused)

### Live mode (only after smoke + product freeze)

- [ ] Complete Stripe business / activate payments (if not already)
- [ ] Switch to **Live** keys in server `.env` (never commit)
- [ ] New **Live** webhook → same `api.no-markup.com` path + new `whsec_`
- [ ] Confirm Connect platform profile (negative balance / compliance) in **Live**
- [ ] Small real-money smoke (or Live test cards per Stripe docs)
- [ ] Dashboard notifications / email for disputes on

---

## Phase 6 — iOS / App Store path

- [ ] Confirm Debug dogfood still uses scheme env / LAN (not production) for day-to-day
- [ ] Archive / TestFlight build hits **`https://api.no-markup.com`** only (Release)
- [ ] Run `scripts/ios-archive-lint.sh` (or project equivalent) before submit
- [ ] No shipping ATS cleartext exceptions for LAN
- [ ] Privacy / terms / support URLs load on `https://no-markup.com`
- [ ] App Store Connect metadata + review notes (payments rails as implemented)
- [ ] TestFlight smoke: login, browse, one money-adjacent path against **prod API**

---

## Phase 7 — Ops hygiene (minimum for solo)

- [ ] Document SSH + deploy commands in a private note (not only in chat)
- [ ] Lightsail snapshot or automated snapshots on
- [ ] Uptime check (free): `https://api.no-markup.com/healthz` + web root
- [ ] Know how to restore from `backup-pg.sh` dump (one dry run)
- [ ] Feature flags reviewed for production fail-closed money paths
- [ ] Do **not** set `DEPLOY_PROVISIONED=true` until/unless moving to K8s path

---

## Phase 8 — Later scale (not day one)

- [ ] Larger Lightsail plan if OOM / CPU bound
- [ ] Managed Postgres (Lightsail DB / RDS) when disk/ops pain
- [ ] Managed Redis when needed
- [ ] Real S3 for private docs / assets
- [ ] Optional: second instance / load balancer
- [ ] Graduate to EKS + `deploy/k8s` + Vault when revenue justifies

---

## Hostnames (canonical)

| Hostname | Role |
|----------|------|
| `https://no-markup.com` | Web |
| `https://www.no-markup.com` | Web |
| `https://api.no-markup.com` | Gateway + Stripe webhooks |
| Webhook | `https://api.no-markup.com/api/v1/webhooks/stripe` |

---

## Checklist summary (copy when executing)

```
[ ] Phase 1 Lightsail + static IP + firewall
[ ] Phase 2 Bootstrap + .env + JWT keys
[ ] Phase 3 Cloudflare DNS + SSL + cache bypass
[ ] Phase 4 Deploy + smoke + backup cron
[ ] Phase 5 Stripe test webhook on api host → then Live later
[ ] Phase 6 TestFlight against production API
[ ] Phase 7 Snapshots + uptime + restore drill
```
