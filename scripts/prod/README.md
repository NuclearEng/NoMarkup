# Capital-light VPS production scripts

Solo-founder ops for a Hetzner-class VPS running **Docker Compose** under
`deploy/prod/` (compose file + images are defined there; these scripts only
operate that layout).

**Domain note:** production zone is **`no-markup.com`** (hyphenated).

## Prerequisites

- Ubuntu/Debian VPS (or similar) with root/sudo
- Repo present on the host (e.g. `/opt/nomarkup`)
- `deploy/prod/docker-compose.yml` available (sibling work may create this)
- Production env file with secrets (**never commit**): prefer
  `deploy/prod/.env` (mode `600`), else `.env.prod` / `.env` at repo root

## Usage order

```text
1. bootstrap   → once per server
2. copy .env   → secrets onto the host
3. deploy      → pull/build/up (+ migrate if defined)
4. smoke       → health checks
5. backup cron → scheduled pg_dump retention
```

### 1. Bootstrap the VPS

As root (or sudo), from the repo (or after copying just this script):

```bash
sudo ./scripts/prod/bootstrap-vps.sh
# optional dedicated deploy user:
sudo DEPLOY_USER=deploy ./scripts/prod/bootstrap-vps.sh
# skip fail2ban:
sudo INSTALL_FAIL2BAN=0 ./scripts/prod/bootstrap-vps.sh
```

What it does (idempotent-ish):

- Installs **Docker Engine + Compose plugin**
- Enables **UFW**: allow **22 / 80 / 443**, deny other inbound
- Optional light **fail2ban** (sshd jail)
- Creates **`/opt/nomarkup`** (override with `APP_ROOT`)
- Prints non-root operational notes

It does **not** clone the repo, write secrets, or start the stack.

### 2. Copy production `.env`

On the host:

```bash
# after cloning/copying the repo into /opt/nomarkup
cd /opt/nomarkup
cp /secure/path/prod.env deploy/prod/.env   # or .env.prod at repo root
chmod 600 deploy/prod/.env
```

Fill all required vars from the project `.env.example` (database, Redis,
Meilisearch, JWT keys, Stripe, S3, Mapbox, OTel/Sentry, etc.). **No secrets
belong in these scripts.**

### 3. Deploy

From repo root:

```bash
./scripts/prod/deploy.sh
```

Behavior:

- `docker compose -f deploy/prod/docker-compose.yml` (project `nomarkup`)
- `pull` (best-effort) → `build` → if a **`migrate`** service exists:
  bring up `postgres` if present, `compose run --rm migrate`
- `compose up -d --remove-orphans`

Useful knobs:

| Env | Default | Meaning |
|-----|---------|---------|
| `REPO_ROOT` | detected from script path | monorepo root |
| `COMPOSE_FILE` | `deploy/prod/docker-compose.yml` | compose path |
| `COMPOSE_PROJECT` | `nomarkup` | compose project name |
| `SKIP_PULL` | `0` | set `1` to skip pull |
| `SKIP_BUILD` | `0` | set `1` to skip build |
| `SKIP_MIGRATE` | `0` | set `1` to skip migrate |

### 4. Smoke test

Endpoints used match the codebase:

| Surface | Path | Role |
|---------|------|------|
| Web | `GET /` | site reachable (2xx/3xx) |
| Web | `GET /api/health` | Next.js liveness (`web/src/app/api/health/route.ts`) |
| Gateway | `GET /healthz` | process liveness |
| Gateway | `GET /health` | legacy alias of `/healthz` |
| Gateway | `GET /readyz` | readiness (Postgres + Redis) |

```bash
BASE_URL=https://no-markup.com \
API_URL=https://api.no-markup.com \
  ./scripts/prod/smoke.sh

# local compose ports example:
BASE_URL=http://127.0.0.1:3000 \
API_URL=http://127.0.0.1:8080 \
  ./scripts/prod/smoke.sh
```

Exit code `1` if any check fails after retries.

### 5. Postgres backup + cron

Dumps the Compose **`postgres`** service with `pg_dump` → gzip under
`./backups` (default), keeps last **N** files (`KEEP=7`).

```bash
./scripts/prod/backup-pg.sh
KEEP=14 BACKUP_DIR=/opt/nomarkup/backups ./scripts/prod/backup-pg.sh
```

Example daily cron (as the deploy user that can talk to Docker):

```cron
15 3 * * * cd /opt/nomarkup && /opt/nomarkup/scripts/prod/backup-pg.sh >>/var/log/nomarkup-backup.log 2>&1
```

Restore sketch (manual):

```bash
gunzip -c backups/nomarkup-nomarkup-YYYYMMDDTHHMMSSZ.sql.gz \
  | docker compose -p nomarkup -f deploy/prod/docker-compose.yml \
      exec -T postgres psql -U nomarkup -d nomarkup
```

(Adjust user/db/service names to match `deploy/prod`.)

## Layout expected

```text
deploy/prod/
  docker-compose.yml    # required
  .env                  # recommended secrets file (gitignored)
scripts/prod/
  bootstrap-vps.sh
  deploy.sh
  backup-pg.sh
  smoke.sh
  README.md
backups/                # created by backup-pg.sh
```

## Safety

- `set -euo pipefail` on all scripts
- No secrets embedded; pass via env files / process environment only
- UFW does not open Postgres/Redis/Meilisearch to the world — keep them on the
  Docker network only
- Treat `docker` group membership as root-equivalent
- Production HTML is not edge-cached (CSP nonce); public **data** may still be
  CDN-cached by the gateway — see project performance docs

## Related

- Compose Dockerfiles: `deploy/docker/*`
- K8s path (heavier): `deploy/k8s/`
- Provisioning gate: `docs/operations/provisioning-checklist.md`
