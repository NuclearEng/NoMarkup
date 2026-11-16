#!/usr/bin/env bash
# Pull/build and start the capital-light prod stack via Docker Compose.
#
# Expects layout (created separately under deploy/prod/):
#   deploy/prod/docker-compose.yml
#   optional migrate service named "migrate"
#   optional env file: deploy/prod/.env or repo-root .env / .env.prod
#
# Usage (from repo root, or set REPO_ROOT):
#   ./scripts/prod/deploy.sh
#   COMPOSE_FILE=deploy/prod/docker-compose.yml ./scripts/prod/deploy.sh
#
# Env:
#   REPO_ROOT       default: parent of scripts/prod (repo root)
#   COMPOSE_FILE    default: deploy/prod/docker-compose.yml (relative to REPO_ROOT)
#   COMPOSE_PROJECT default: nomarkup
#   SKIP_PULL=1     skip docker compose pull
#   SKIP_BUILD=1    skip docker compose build
#   SKIP_MIGRATE=1  skip migrate service even if defined
#   EXTRA_COMPOSE_ARGS  extra args appended to compose commands
#
# No secrets in this script — load them via compose env_file / host env.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/prod/docker-compose.yml}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-nomarkup}"
SKIP_PULL="${SKIP_PULL:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"
# Optional extra args for every compose invocation (space-separated).
EXTRA_COMPOSE_ARGS_RAW="${EXTRA_COMPOSE_ARGS:-}"
EXTRA_COMPOSE_ARGS=()
if [[ -n "${EXTRA_COMPOSE_ARGS_RAW}" ]]; then
  # shellcheck disable=SC2206
  EXTRA_COMPOSE_ARGS=( ${EXTRA_COMPOSE_ARGS_RAW} )
fi

log()  { printf '[deploy] %s\n' "$*"; }
die()  { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

cd "${REPO_ROOT}"

compose_path="${REPO_ROOT}/${COMPOSE_FILE}"
if [[ ! -f "${compose_path}" ]]; then
  die "compose file not found: ${compose_path}
Expected capital-light layout under deploy/prod/. Create it before deploying."
fi

if ! command -v docker >/dev/null 2>&1; then
  die "docker not found — run scripts/prod/bootstrap-vps.sh first"
fi
if ! docker compose version >/dev/null 2>&1; then
  die "docker compose plugin not found — run scripts/prod/bootstrap-vps.sh first"
fi

# Prefer an env file next to compose, then common repo locations (compose also
# may declare env_file itself — we only pass --env-file when one exists).
ENV_FILE=""
for candidate in \
  "${REPO_ROOT}/deploy/prod/.env" \
  "${REPO_ROOT}/.env.prod" \
  "${REPO_ROOT}/.env"; do
  if [[ -f "${candidate}" ]]; then
    ENV_FILE="${candidate}"
    break
  fi
done

compose() {
  local args=(compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}")
  if [[ -n "${ENV_FILE}" ]]; then
    args+=(--env-file "${ENV_FILE}")
  fi
  if [[ ${#EXTRA_COMPOSE_ARGS[@]} -gt 0 ]]; then
    args+=("${EXTRA_COMPOSE_ARGS[@]}")
  fi
  docker "${args[@]}" "$@"
}

service_defined() {
  local name="$1"
  compose config --services 2>/dev/null | grep -qx "${name}"
}

log "REPO_ROOT=${REPO_ROOT}"
log "COMPOSE_FILE=${COMPOSE_FILE}"
log "COMPOSE_PROJECT=${COMPOSE_PROJECT}"
if [[ -n "${ENV_FILE}" ]]; then
  log "using env file: ${ENV_FILE}"
else
  log "no .env file found at deploy/prod/.env, .env.prod, or .env (compose may still supply env_file)"
fi

log "validating compose config"
compose config --quiet

if [[ "${SKIP_PULL}" != "1" ]]; then
  log "pulling images (best-effort for local-build services)"
  compose pull --ignore-pull-failures || compose pull || true
else
  log "SKIP_PULL=1"
fi

if [[ "${SKIP_BUILD}" != "1" ]]; then
  log "building images"
  compose build
else
  log "SKIP_BUILD=1"
fi

# Migrate before bringing the full stack up when a one-shot migrate service exists.
if [[ "${SKIP_MIGRATE}" != "1" ]] && service_defined migrate; then
  log "running migrate service (compose run --rm migrate)"
  # Ensure dependencies migrate needs (often postgres) are up first.
  if service_defined postgres; then
    compose up -d postgres
    # Wait briefly for postgres health if healthcheck exists.
    log "waiting for postgres to accept connections"
    for _ in $(seq 1 60); do
      if compose exec -T postgres pg_isready >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
  fi
  compose run --rm migrate
  log "migrations finished"
elif [[ "${SKIP_MIGRATE}" == "1" ]]; then
  log "SKIP_MIGRATE=1"
else
  log "no migrate service in compose — skipping schema migrate step"
fi

log "starting stack: docker compose up -d"
compose up -d --remove-orphans

log "service status"
compose ps

log "deploy complete"
log "next: BASE_URL=... API_URL=... ./scripts/prod/smoke.sh"
