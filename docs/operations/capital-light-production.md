# Capital-light production runbook (Founder)

> **Single source of truth** for the first public origin of NoMarkup without
> standing up EKS, managed Postgres, or Firebase.
>
> **Status (2026-08-05):** Code and Compose stack exist in-repo. **No production
> VPS IP, no live DNS A records, no `DEPLOY_PROVISIONED=true`.** Everything
> below that says “paste IP”, “create Lightsail instance”, or “apply in Dashboard”
> is **Founder-Action** until you do it. Do not treat this doc as proof that
> production is live.
>
> **Host decision (locked when we resume):** **AWS Lightsail** (US) — see
> [`lightsail-create-guide.md`](./lightsail-create-guide.md).
>
> **Pause (Founder):** Lightsail + public DNS + Live Stripe are **deferred** until
> more development and testing are done. Use local stack + Stripe **test** only.
> Resume with a Lightsail static IP or “resume production deploy.”

Related:

| Doc | Role |
|-----|------|
| [`cloudflare-edge.md`](./cloudflare-edge.md) | In-repo CF inventory; what is *not* Terraform-managed |
| [`cdn-cache-auth-bypass.md`](./cdn-cache-auth-bypass.md) | Auth cache-bypass expression (must apply on API host) |
| [`stripe-cloudflare-live-setup-2026-08-05.md`](./stripe-cloudflare-live-setup-2026-08-05.md) | Stripe test keys / Connect acknowledgements session notes |
| [`provisioning-checklist.md`](./provisioning-checklist.md) | Full K8s / Vault path (later; fail-closed until provisioned) |
| [`../launch-checklist.md`](../launch-checklist.md) | Product launch readiness beyond “origin answers HTTPS” |

---

## 1. Decision (locked for day one)

| Choice | Day-one | Explicitly **not** day one |
|--------|---------|----------------------------|
| Edge / DNS / TLS | **Cloudflare Free** on zone **`no-markup.com`** | Firebase Hosting, Vercel-as-API, CloudFront-first |
| Compute | **AWS Lightsail** (Ubuntu) + **Docker Compose** + Caddy | EKS / GKE day one; Firebase |
| Data | Postgres + Redis + Meilisearch **on that instance** | Managed RDS/ElastiCache day one |
| Deploy | SSH + `scripts/prod/*` + `deploy/prod` | `DEPLOY_PROVISIONED=true` K8s pipeline |
| Cost target | **~$10–25 / month** (4 GB Lightsail + CF Free) | Unicorn-scale multi-AZ budget |
| Scale path | Bigger Lightsail → managed DB → full AWS/EKS later | Rewrite to BaaS |

**Why:** Ship a real `https://api.no-markup.com` and `https://no-markup.com`
for dogfood, Stripe webhooks, and TestFlight Release builds without burning
founding capital on a cluster you cannot yet operate. The K8s manifests under
`deploy/k8s/` and Terraform skeleton under `deploy/terraform/` remain the
**graduation path** (§9), not the first origin.

**Honesty rules:**

- Zone may already exist in Cloudflare (NS active) with **zero DNS records** —
  see session notes in the Stripe/CF setup doc. That is *not* a live site.
- Stripe **test** mode can be wired before public DNS; **live** mode is later.
- iOS **Release** already targets `https://api.no-markup.com` — the origin must
  eventually exist for TestFlight; Debug can stay on localhost.

---

## 2. Hostnames

| Hostname | Role | Origin on VPS |
|----------|------|----------------|
| `no-markup.com` | Web (Next.js) | reverse proxy → `web:3000` |
| `www.no-markup.com` | Web (canonical redirect or same app) | same as `@` |
| `api.no-markup.com` | Gateway (REST + WS hop) | reverse proxy → `gateway:8080` |

Owned zone only: **`no-markup.com`** (hyphenated). **`nomarkup.com` is not owned** — never document it as production.

Public paths the founder will hit after go-live:

- Web: `https://no-markup.com`
- API health: `https://api.no-markup.com/healthz` (also `/health`, `/readyz`)
- Stripe webhook (production target):  
  **`https://api.no-markup.com/api/v1/webhooks/stripe`**

---

## 3. Cost envelope (~$5–20 / mo)

Indicative only; Hetzner and Cloudflare prices change. Stay inside the band by
**not** buying managed K8s or multi-region DBs on day one.

| Item | Typical | Notes |
|------|---------|--------|
| **AWS Lightsail** 4 GB (recommended) | ~$20 / mo | US West; Ubuntu 24.04; see [`lightsail-create-guide.md`](./lightsail-create-guide.md) |
| Lightsail 2 GB (tight) | ~$10 / mo | Lean only; builds may OOM |
| Cloudflare Free | $0 | DNS + orange-cloud proxy + TLS 1.3 at edge |
| Domain `no-markup.com` | already owned | Registrar may already be CF |
| Object storage | Disk volume day one; **S3/R2** when needed | Prefer real S3 when cash allows |
| Email / maps / Stripe | free tiers / usage | Mapbox, SendGrid, Stripe fees are product cost, not “infra” |

**Out of band (do not force into $20):** Apple Developer, Google OAuth verification
fees, paid observability SaaS. Optional later.

---

## 4. Ordered path (do in this order)

```
1. Lightsail: create Ubuntu instance + static IP  → Founder (lightsail-create-guide.md)
2. Paste static IPv4 to agent / checklist below
3. Bootstrap (Docker, UFW)                        → scripts/prod/bootstrap-vps.sh
4. Cloudflare DNS: A records → static IP          → Founder (orange cloud)
5. Secrets + JWT keys on box                      → deploy/prod/.env
6. Deploy Compose                                 → scripts/prod/deploy.sh
7. Smoke HTTPS + health                           → scripts/prod/smoke.sh
8. Stripe TEST webhook → api host                 → Dashboard / API
9. Dogfood (web + iOS TestFlight Release API)     → Founder
10. Stripe LIVE later                             → Founder
11. Graduate to full AWS/EKS when load forces it
```

Nothing in steps 1–9 is “done” until you check the box yourself. Agents cannot
create your Hetzner account or invent a public IP.

---

## 5. Step-by-step

### 5.1 Create Hetzner server (Founder-Action)

1. Create a Hetzner Cloud account and project (or reuse an existing one you control).
2. Create a server:
   - **Location:** pick one; Ashburn / US East or EU is fine for Seattle dogfood.
   - **Image:** Ubuntu 24.04 LTS (or current LTS).
   - **Type:** start ~2–4 vCPU / **≥4 GB RAM** (8 GB preferred for full diet).
   - **IPv4:** yes (Cloudflare A records need it; AAAA optional).
   - **SSH key:** your key only; disable password auth after first login.
3. **Copy the public IPv4.** You will paste it into Cloudflare. There is no
   committed IP in this repo — do not invent one in docs or chat.

Optional: floating IP later if you rebuild the box often.

### 5.2 Bootstrap the VPS

If a repo script exists (e.g. `scripts/bootstrap-vps.sh`), prefer it after
review. **As of this writing the script may not be committed** — use the manual
bootstrap below and treat any script as a thin wrapper around the same steps.

On the server (as root or sudo):

```bash
# OS updates + Docker Engine + Compose plugin (official Docker install path)
apt-get update && apt-get upgrade -y
# Install Docker per https://docs.docker.com/engine/install/ubuntu/
# Verify:
docker version
docker compose version

# Non-root deploy user (example)
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /opt/nomarkup && chown deploy:deploy /opt/nomarkup

# Firewall: only SSH + HTTP/HTTPS from the world
# (Cloudflare will proxy 80/443; still allow them so CF can reach origin)
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Optional: restrict SSH to your home IP later
```

Clone or rsync the monorepo to `/opt/nomarkup` (private git over SSH, or
artifact tarball). Do **not** commit production `.env` files.

Generate secrets on the box (examples — store only in `/opt/nomarkup/.env.production`, mode `600`):

```bash
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY (32-byte material as required by cipher)
openssl rand -base64 32   # INTERNAL_WS_SECRET (gateway + chat same value)
openssl rand -base64 32   # METRICS_BEARER_TOKEN
# JWT: generate RS256 keypair; mount PEMs read-only into gateway/user
```

Set `ENVIRONMENT=production` for every Go/Rust process that validates it.
**Never** leave production on the ephemeral PII-key / feature-flag fail-open
paths meant for development.

### 5.3 Cloudflare DNS (exact table)

Dashboard → zone **`no-markup.com`** → DNS → Records.

Replace `VPS_IPV4` with the address from §5.1. **All three should be Proxied
(orange cloud)** so edge TLS and DDoS sit in front of the origin.

| Type | Name | Content | Proxy status | TTL |
|------|------|---------|--------------|-----|
| A | `@` | `VPS_IPV4` | **Proxied** (orange) | Auto |
| A | `www` | `VPS_IPV4` | **Proxied** (orange) | Auto |
| A | `api` | `VPS_IPV4` | **Proxied** (orange) | Auto |

Notes:

- Prefer **A** records to the VPS (simple). CNAME flattening for `@` is fine if
  you later front with a tunnel; day-one path is A → IP.
- Do **not** grey-cloud (DNS only) for public HTTPS unless you know you are
  terminating TLS only on origin and want no CF protection.
- MX / SPF / DKIM are separate (email). Not required for API smoke.

### 5.4 SSL/TLS mode: Full → Full (strict)

Cloudflare SSL/TLS → Overview:

| Phase | Mode | When |
|-------|------|------|
| First boot (origin has self-signed or CF Origin Cert not yet installed) | **Full** | Edge → origin encrypted; origin cert not publicly trusted |
| Steady state | **Full (strict)** | Origin presents a cert trusted by Cloudflare (Origin CA cert **or** public Let’s Encrypt) |

**Never use Flexible** for this product (HTTPS to browser, cleartext to origin).

Capital-light recommended path:

1. Create a **Cloudflare Origin Certificate** (SSL/TLS → Origin Server) for  
   `no-markup.com`, `*.no-markup.com` (covers `www` + `api`).
2. Install that cert + private key on the VPS reverse proxy (Caddy or nginx).
3. Flip dashboard to **Full (strict)**.
4. Confirm TLS 1.3 is available at the edge (default on Free for modern clients).

Reverse proxy sketch (concept only — pick one tool and keep config out of git
if it embeds the private key path):

- `no-markup.com` / `www.no-markup.com` → `127.0.0.1:3000` (web)
- `api.no-markup.com` → `127.0.0.1:8080` (gateway)
- WebSocket upgrade paths on the API host must pass through (chat/WS).

Gateway and web containers speak **HTTP** on the private Docker network; the
proxy terminates TLS. Same pattern as the K8s ingress design
(`docs/runbooks/10-ingress-tls.md`).

### 5.5 Auth cache-bypass (API hostname)

Origin `writeCachedJSON` will not store authed bodies, but the **edge can still
serve a cached anonymous body to a signed-in client** if the request never
reaches origin. Apply a Cache Rule on **`api.no-markup.com`**.

Expression (from [`cdn-cache-auth-bypass.md`](./cdn-cache-auth-bypass.md)):

```
(http.request.uri.path starts_with "/api/v1/") and (
  is_defined(http.request.headers["authorization"]) or
  http.request.headers["cookie"][0] contains "refresh_token="
)
```

**Action: Bypass cache.**

Verification (after DNS + origin live):

1. Anonymous GET of a public catalog route → warm then `CF-Cache-Status: HIT`.
2. Same URL with `Authorization: Bearer …` → `DYNAMIC` / bypass; body is origin-fresh.
3. Optional: `BASE_URL=https://api.no-markup.com ./scripts/cdn-ttfb-sample.sh`

This rule **cannot** be enforced from the Go origin alone.

### 5.6 Deploy (Compose service diet)

On the VPS under `/opt/nomarkup`:

1. Production env file with real secrets (Stripe **test** keys first, S3/MinIO,
   JWT paths, `ALLOWED_ORIGINS=https://no-markup.com,https://www.no-markup.com`,
   `FRONTEND_URL=https://no-markup.com`,
   `NEXT_PUBLIC_API_URL=https://api.no-markup.com`,
   `NEXT_PUBLIC_WS_URL=wss://api.no-markup.com`,
   secure cookies on).
2. Run migrations against the on-box Postgres (same migration set as CI;
   forward-only; do not edit shipped migrations).
3. `docker compose up -d` with the **launch diet** in §6 (not the full
   observability zoo unless you have RAM).
4. Confirm containers healthy; `curl -sf http://127.0.0.1:8080/healthz` on box.

There is **no** automated production deploy gate for Compose in GitHub Actions.
The K8s workflow stays **fail-closed** until `DEPLOY_PROVISIONED=true` and real
cluster secrets exist — that is intentional and separate from this path.

### 5.7 Smoke (Founder)

From your laptop (not only on-box):

```bash
curl -sfI https://no-markup.com
curl -sf https://api.no-markup.com/healthz
curl -sf https://api.no-markup.com/readyz   # expect 200 when DB/Redis up
# Optional CDN sample once edge is warm:
# BASE_URL=https://api.no-markup.com ./scripts/cdn-ttfb-sample.sh
```

Browser:

- Marketing/app shell loads on `https://no-markup.com`
- Sign-up / login cookie path works against `api.no-markup.com` (CORS + secure cookies)
- No mixed-content (all API/WS HTTPS/WSS)

### 5.8 Stripe **test** webhook (after public API DNS)

**Production webhook URL (canonical for this runbook):**

```text
https://api.no-markup.com/api/v1/webhooks/stripe
```

In Stripe Dashboard (Test mode):

1. Developers → Webhooks → Add endpoint (or edit existing).
2. URL = the line above (gateway path is `/api/v1/webhooks/stripe` — see
   `docs/route-map.md` and `gateway/internal/handler/webhook.go`).
3. Subscribe the same event set you use in test today (PI success/fail, disputes,
   Connect `account.updated`, refunds, transfers, setup intents, etc.).
4. Copy signing secret → `STRIPE_WEBHOOK_SECRET` on the **payment** service;
   restart payment.
5. Send a test event; confirm 2xx and no signature failures in payment logs.

**Session note (2026-08-05):** an earlier test endpoint may point at
`https://no-markup.com/api/v1/webhooks/stripe`. That only works if the **web**
host reverse-proxies `/api/*` to the gateway. Prefer a **dedicated** endpoint on
**`api.no-markup.com`** so web and API hosts stay clean. Disable or redirect the
apex webhook once the api-host endpoint is green.

Local dogfood without public DNS still uses Stripe CLI:

```bash
stripe listen --forward-to localhost:8081/api/v1/webhooks/stripe
```

### 5.9 Stripe **Live** (later — not day-one smoke)

Do **not** flip live keys until:

- [ ] Platform entity / “Activate payments” complete in Stripe
- [ ] Test-mode webhook + happy-path escrow/charge proven on the VPS origin
- [ ] Live webhook endpoint created at the **same api host path**
- [ ] Live `STRIPE_SECRET_KEY`, publishable key, `STRIPE_WEBHOOK_SECRET`, Connect client id
- [ ] Refunds / chargebacks / seller compliance acknowledgements already done for the platform

Live mode is a **Founder business** step, not an eng merge.

### 5.10 iOS: Release vs Debug dogfood

Resolved in `ios/NoMarkup/Core/AppConfig.swift` (see `ios/README.md`):

| Build | API base |
|-------|----------|
| **Release** (TestFlight / App Store) | **`https://api.no-markup.com`** (hard production default) |
| Debug + Simulator | `http://127.0.0.1:8081` when env/plist empty |
| Debug dogfood (device / LAN) | `NOMARKUP_API_BASE_URL` or Info.plist `APIBaseURL` (**https only** is enforced for non-debug/Release) |

Implications:

- **TestFlight Release builds will call production DNS.** Until §5.3–5.7 are
  done, TestFlight will fail API calls. That is expected — not an iOS bug.
- Debug can keep dogfooding local Compose or a staging tunnel without waiting
  for the VPS.
- Committed plist `APIBaseURL` should stay empty for Release archives so the
  production HTTPS default applies.
- Legal/support links already use `https://no-markup.com` — web must answer or
  those links 404.

---

## 6. Service diet (what to run at launch)

Goal: one box, enough process to run services + goods marketplace paths without
starting every optional observability container.

### 6.1 Must run (launch)

| Layer | Services |
|-------|----------|
| Data | `postgres` (PostGIS 16), `redis`, `meilisearch`, `minio` (or real S3) |
| Pooling | `pgbouncer` recommended even on one node |
| Go | `gateway`, `user`, `job`, `payment`, `chat`, `notification` |
| Rust | `bidding`, `trust`, `fraud`, `imaging` |
| Front | `web` |
| Edge on host | Caddy/nginx + Origin cert (not a Compose service) |

Gateway `depends_on` in root `docker-compose.yml` expects user/job/payment/chat/
notification/bidding/fraud/trust/imaging — treat those as **in** for a
faithful stack. Underwriting/pricing are not on that gateway dependency list
for basic CRUD + bid paths.

### 6.2 Defer on a small VPS (unless you have RAM)

| Service | Why defer |
|---------|-----------|
| `underwriting`, `pricing` | Advanced money engines; not required for first dogfood loop |
| `jaeger`, `prometheus`, `alertmanager` | Use Cloudflare analytics + host logs first; add when debugging latency |
| Multi-replica anything | Single Compose replica per service |

### 6.3 Disk / backup minimum (Founder — still capital-light)

Until managed Postgres:

- Nightly `pg_dump` compressed to off-box storage (Backblaze/S3/your laptop).
- Volume backups for MinIO bucket data if users upload photos.
- Redis is ephemeral (rate limits / OTP); AOF on is fine; not authoritative.
- Meilisearch can be rebuilt from Postgres.

The full multi-AZ RPO story in `backup-disaster-recovery.md` is the **graduated**
target, not a claim about this VPS.

---

## 7. Secrets & production config checklist

Copy shape from `.env.example` → server-only `.env.production`. Never commit.

Minimum that will bite you if missing:

- `ENVIRONMENT=production`
- `DATABASE_URL`, `REDIS_URL`, Meilisearch URL + key
- JWT public/private PEM paths; `SESSION_SECRET`; `ENCRYPTION_KEY`
- `INTERNAL_WS_SECRET` (gateway **and** chat)
- Stripe test set first: secret, publishable (web), webhook secret, Connect client id
- `S3_*` (MinIO-compatible endpoints OK for day one)
- `ALLOWED_ORIGINS` / `FRONTEND_URL` / Next public API + WS URLs (HTTPS/WSS)
- `METRICS_BEARER_TOKEN` if you expose `/metrics` beyond loopback
- Mapbox / Sentry / OTel: optional early; set or disable cleanly so boot does not hang

Feature flags: production **fails closed** when rows missing/errors (SEC-01).
Seed required flags before you toggle product surfaces off by accident.

---

## 8. What is *not* done by this runbook

| Item | Reality |
|------|---------|
| Hetzner account / server | Founder creates; no IP in git |
| Cloudflare Account/Zone IDs in Vault | Founder; never commit tokens |
| Live CF rule JSON as code | Docs only; apply in dashboard (or later token automation) |
| `DEPLOY_PROVISIONED=true` | Still **false** until real K8s path |
| Multi-AZ HA / 99.9% measured SLA | Design target only |
| Firebase / EKS day one | Explicitly rejected for capital-light phase |
| Stripe Live money | Separate Founder step after test proof |

---

## 9. Graduation path (Compose → K8s)

Move off the single VPS when **one** of these is true:

- Sustained load or GMV where a single node outage is unacceptable
- You need rolling deploys without SSH snowflakes
- Compliance / customer contracts require multi-AZ or managed DB

Then:

1. Work [`provisioning-checklist.md`](./provisioning-checklist.md) (Vault/ESO,
   managed Postgres PostGIS, Redis, real S3, registry credentials).
2. Apply `deploy/k8s/` overlays; wire ingress + `nomarkup-tls` (or CF origin still
   in front of the LB).
3. Point the **same** DNS names (`@`, `www`, `api`) at the new LB/ingress IP or
   hostname — clients (including iOS Release) keep `api.no-markup.com`.
4. Keep Cloudflare orange + auth bypass rule; only the origin changes.
5. Set `DEPLOY_PROVISIONED=true` **only after** migrate-on-deploy and secrets are
   proven (workflow stays fail-closed until then).
6. Decommission Compose on the VPS after dual-run smoke; do not delete the VPS
   until DNS + Stripe webhooks + TestFlight are green on K8s.

Terraform under `deploy/terraform/` is a **skeleton** until you fill account IDs
and apply — see OPS-02 notes in the provisioning checklist.

---

## 10. Founder checkbox summary

- [ ] Hetzner account + server created; **IPv4 written down**
- [ ] VPS bootstrapped (Docker, firewall, deploy user, secrets file mode 600)
- [ ] DNS A records `@` / `www` / `api` → VPS IP, **proxied**
- [ ] Origin cert installed; SSL mode **Full**, then **Full (strict)**
- [ ] Auth cache-bypass rule on `api.no-markup.com`
- [ ] Launch service diet up; migrations applied
- [ ] Smoke: web + `/healthz` + `/readyz` over HTTPS
- [ ] Stripe **test** webhook → `https://api.no-markup.com/api/v1/webhooks/stripe`
- [ ] Web dogfood login + one bid/payment path in test mode
- [ ] TestFlight Release only after API host is live (or accept hard failures)
- [ ] Stripe **Live** deferred until entity + test proof
- [ ] Nightly off-box Postgres dump scheduled
- [ ] K8s graduation deferred with eyes open

When every box above that you care about for dogfood is checked, you have a
capital-light production origin. You do **not** yet have provisioned unicorn
infra — and that is the point of this document.
