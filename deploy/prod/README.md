# NoMarkup — capital-light production (VPS + Compose + Caddy)

Single-box production path for a solo founder (~$5–10/mo):

| Piece | Choice |
|--------|--------|
| Host | One VPS (Hetzner CX22/CPX21 or similar, 4–8 GB RAM) |
| Orchestration | Docker Compose (`deploy/prod/docker-compose.yml`) |
| Edge TLS | Caddy on **80/443** only |
| DNS / CDN | Cloudflare on **`no-markup.com`** (hyphenated) |
| App | Gateway + web + user + job + payment |
| Data | PostGIS 16, Redis 7, Meilisearch 1.6 |

This is **not** a replacement for root `docker-compose.yml` (dev) or `deploy/k8s/` (full mesh). It is the lean launch path until `DEPLOY_PROVISIONED` / Kubernetes is real.

---

## Architecture (lean)

```
Internet → Cloudflare (orange cloud)
        → VPS :80/:443 (Caddy)
              ├─ no-markup.com / www  → web:3000
              └─ api.no-markup.com    → gateway:8080
                                            │ gRPC (private Docker network)
                                            ├─ user:50051
                                            ├─ job:50052
                                            └─ payment:50054
                     postgres · redis · meilisearch  (no host ports)
```

Optional Compose **profiles** (start when you have RAM / product need):

| Profile | Services |
|---------|----------|
| `chat` | chat (gRPC + WS backend) |
| `notification` | email/SMS/push dispatcher |
| `engines` | bidding, fraud, trust, imaging, underwriting, pricing |
| `storage` | MinIO (prefer Cloudflare R2 / real S3 instead) |

Stripe webhooks: **`POST https://api.no-markup.com/api/v1/webhooks/stripe`**  
(Gateway route; signature verified with `STRIPE_WEBHOOK_SECRET`.)

`ENVIRONMENT=production` everywhere — feature flags, PII crypto, Stripe, Meilisearch, and metrics all **fail closed**.

---

## Prerequisites

On the VPS:

- Docker Engine 24+ and Docker Compose v2 plugin
- Git clone of this monorepo (or rsync of a release tree)
- DNS at Cloudflare for `no-markup.com`, `www`, `api` → VPS IP (proxied)
- Open firewall **only** 22, 80, 443 (and optionally ICMP)

Recommended box size for lean stack: **≥ 4 GB RAM** (8 GB if you enable `engines`).

---

## 1. Secrets and keys (on the VPS)

```bash
cd /opt/nomarkup   # or your clone path
cp deploy/prod/.env.example deploy/prod/.env
chmod 600 deploy/prod/.env

# JWT RS256 keypair (user signs, gateway + web verify)
mkdir -p deploy/prod/keys
openssl genrsa -out deploy/prod/keys/private.pem 2048
openssl rsa -in deploy/prod/keys/private.pem -pubout -out deploy/prod/keys/public.pem
chmod 400 deploy/prod/keys/*.pem

# Strong secrets (paste into deploy/prod/.env)
openssl rand -base64 24   # POSTGRES_PASSWORD  (+ same value URL-encoded in DATABASE_URL)
openssl rand -base64 24   # REDIS_PASSWORD     (+ same value in REDIS_URL)
openssl rand -base64 32   # MEILISEARCH_API_KEY, SESSION_SECRET, ENCRYPTION_KEY, …
```

Edit **`deploy/prod/.env`** and replace every `CHANGE_ME`. Checklist:

- [ ] `POSTGRES_PASSWORD` / `DATABASE_URL` (password URL-encoded if needed)
- [ ] `REDIS_PASSWORD` / `REDIS_URL`
- [ ] `MEILISEARCH_API_KEY`
- [ ] `SESSION_SECRET`, `ENCRYPTION_KEY`
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID`
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_MAPBOX_TOKEN`
- [ ] `ACME_EMAIL` (Let’s Encrypt recovery)
- [ ] S3/R2 keys if you use imaging later

**Never commit** `deploy/prod/.env` or `deploy/prod/keys/*.pem` (covered by root `.gitignore`).

---

## 2. Cloudflare DNS + SSL

1. Zone: **`no-markup.com`**
2. Records (proxied / orange cloud):
   - `A` `@` → VPS IPv4  
   - `A` `www` → VPS IPv4  
   - `A` `api` → VPS IPv4  
   - AAAA if you have IPv6
3. SSL/TLS mode:
   - **Full** — origin may use Caddy `tls internal` (self-signed). Quick first boot.
   - **Full (strict)** — prefer once ACME or a [Cloudflare Origin CA](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/) cert is on Caddy.  
   - **Never Flexible.**
4. Optional: orange-cloud off briefly so Caddy can complete HTTP-01 ACME, then re-enable proxy. See comments in `Caddyfile`.

---

## 3. Build and run

From the **repository root** (build contexts assume monorepo root):

```bash
# Validate env + compose (fails fast on missing required vars)
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env config >/dev/null

# Build images (first build is slow: Go + Next.js)
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env build

# Start lean stack (migrate runs once, then apps)
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env up -d

# Watch
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env ps
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env logs -f gateway
```

### Optional profiles

```bash
# Chat messaging
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env --profile chat up -d

# Email/SMS
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env --profile notification up -d

# Rust engines (heavy; needs more RAM)
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env --profile engines up -d
```

### Rebuild after public URL / Mapbox / Stripe publishable key changes

`NEXT_PUBLIC_*` are baked into the web client at **image build** time:

```bash
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env build web --no-cache
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env up -d web
```

---

## 4. Stripe webhook

In Stripe Dashboard → Developers → Webhooks → Add endpoint:

| Field | Value |
|-------|--------|
| URL | `https://api.no-markup.com/api/v1/webhooks/stripe` |
| Events | payment + Connect set used by the app |
| Signing secret | → `STRIPE_WEBHOOK_SECRET` in `.env` |

Restart payment + gateway after changing the secret:

```bash
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env up -d payment gateway
```

---

## 5. Smoke checks

```bash
# From the VPS
curl -fsS http://127.0.0.1:80/api/health -H 'Host: no-markup.com'   # via Caddy→web (HTTP)
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env exec gateway \
  wget -q -O - http://127.0.0.1:8080/health
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env exec gateway \
  wget -q -O - http://127.0.0.1:8080/readyz

# From your laptop (after DNS + TLS)
curl -fsSI https://no-markup.com
curl -fsSI https://api.no-markup.com/health
curl -fsSI https://api.no-markup.com/readyz
```

`/readyz` should be **200** only when Postgres + Redis are reachable.

---

## 6. Migrations

`migrate` is a one-shot service: **`migrate -path=/migrations -database $DATABASE_URL up`**.  
App containers wait for `service_completed_successfully`.

Re-run after pulling new migrations:

```bash
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env run --rm migrate
# then rolling restart of services that care about schema
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env up -d gateway user job payment
```

Production policy: **forward-only** (`up`). Do not run `down` against prod data.

---

## 7. Updates / deploy loop

```bash
cd /opt/nomarkup
git pull   # or unpack a release tarball

docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env build
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env run --rm migrate
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env up -d
```

Pin images later with `IMAGE_REGISTRY` + `IMAGE_TAG` in `.env` and `docker compose pull` instead of building on the box.

---

## 8. Backups (minimum)

| Volume | What |
|--------|------|
| `nomarkup-prod_pgdata` | Postgres — `pg_dump` daily off-box |
| `nomarkup-prod_redisdata` | Sessions/cache — optional |
| `nomarkup-prod_meilidata` | Search indexes — rebuildable via reindex job |
| `nomarkup-prod_caddy_data` | ACME certs |
| `deploy/prod/keys` + `.env` | **Off-box encrypted backup** (loss = cannot decrypt PII / mint JWTs) |

Example dump:

```bash
docker compose -f deploy/prod/docker-compose.yml --env-file deploy/prod/.env exec -T postgres \
  pg_dump -U nomarkup nomarkup | gzip > "nomarkup-$(date +%F).sql.gz"
```

---

## 9. What this stack deliberately omits

- Jaeger / Prometheus / Grafana (set `OTEL_EXPORTER_OTLP_ENDPOINT` later if you add a collector)
- PgBouncer (fine at low QPS; add when pool exhaustion shows up)
- Kubernetes / Terraform EKS path (`deploy/k8s`, `deploy/terraform`)
- Public `/metrics` (scrape via Docker network or SSH tunnel + `METRICS_BEARER_TOKEN`)

When you outgrow one VPS, move to the k8s manifests and keep the same Dockerfiles / env contract.

---

## File map

| Path | Role |
|------|------|
| `deploy/prod/docker-compose.yml` | Production services, networks, volumes, profiles |
| `deploy/prod/Caddyfile` | TLS + reverse proxy |
| `deploy/prod/.env.example` | Secret placeholders (copy → `.env`) |
| `deploy/prod/README.md` | This runbook |
| `deploy/docker/*.Dockerfile` | Existing multi-stage builds (context = repo root) |

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `migrate` exits non-zero | Bad `DATABASE_URL` / Postgres not healthy / dirty migration |
| Gateway exits on boot | Missing `JWT` public key file, `DATABASE_URL`, `REDIS_URL`, `MEILISEARCH_URL`, or `ENCRYPTION_KEY` |
| Payment exits on boot | Missing/placeholder `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` |
| Web exits on boot | Missing runtime env (`API_URL`, `NEXT_PUBLIC_*`, `JWT_PUBLIC_KEY_PATH`) — see `web/src/lib/server/env.ts` |
| 502 from Caddy | Upstream not healthy; `docker compose … logs web gateway` |
| CF 525 / 526 | SSL mode mismatch (use Full or Full strict consistently with Caddy cert strategy) |
| Chat / bids fail | Profile not started (`chat` / `engines`); gRPC dial fails at request time |
| Client still hits localhost | Rebuild **web** image after changing `NEXT_PUBLIC_*` |
