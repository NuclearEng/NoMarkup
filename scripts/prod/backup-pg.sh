#!/usr/bin/env bash
# Dump Postgres from the prod Compose stack into ./backups with a timestamp,
# then retain only the last N dumps.
#
# Usage (from repo root):
#   ./scripts/prod/backup-pg.sh
#   KEEP=14 BACKUP_DIR=/opt/nomarkup/backups ./scripts/prod/backup-pg.sh
#
# Env:
#   REPO_ROOT         default: parent of scripts/prod
#   COMPOSE_FILE      default: deploy/prod/docker-compose.yml
#   COMPOSE_PROJECT   default: nomarkup
#   POSTGRES_SERVICE  default: postgres
#   POSTGRES_USER     default: nomarkup (or POSTGRES_USER from env file if set)
#   POSTGRES_DB       default: nomarkup
#   BACKUP_DIR        default: ${REPO_ROOT}/backups
#   KEEP              default: 7 (number of *.sql.gz dumps to retain)
#
# Credentials are never hardcoded. The dump runs inside the postgres container
# as the configured DB user (peer/trust or container env). Optional
# PGPASSWORD may be provided by the environment for password auth — do not
# commit it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/prod/docker-compose.yml}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-nomarkup}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-nomarkup}"
POSTGRES_DB="${POSTGRES_DB:-nomarkup}"
BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
KEEP="${KEEP:-7}"

log()  { printf '[backup-pg] %s\n' "$*"; }
die()  { printf '[backup-pg] ERROR: %s\n' "$*" >&2; exit 1; }

cd "${REPO_ROOT}"

if [[ ! -f "${REPO_ROOT}/${COMPOSE_FILE}" ]]; then
  die "compose file not found: ${REPO_ROOT}/${COMPOSE_FILE}"
fi
if ! command -v docker >/dev/null 2>&1; then
  die "docker not found"
fi

# Optional non-secret overrides from env files (do not source full files —
# they contain secrets and may use shell-incompatible syntax). Prefer already-
# exported POSTGRES_USER / POSTGRES_DB; else parse simple KEY=value lines.
_env_get() {
  local key="$1" file="$2" line val
  line="$(grep -E "^${key}=" "${file}" 2>/dev/null | head -1 || true)"
  [[ -z "${line}" ]] && return 0
  val="${line#*=}"
  val="${val%\"}"
  val="${val#\"}"
  val="${val%\'}"
  val="${val#\'}"
  printf '%s' "${val}"
}
for candidate in \
  "${REPO_ROOT}/deploy/prod/.env" \
  "${REPO_ROOT}/.env.prod" \
  "${REPO_ROOT}/.env"; do
  if [[ -f "${candidate}" ]]; then
    if [[ -z "${POSTGRES_USER:-}" || "${POSTGRES_USER}" == "nomarkup" ]]; then
      _v="$(_env_get POSTGRES_USER "${candidate}")"
      [[ -n "${_v}" ]] && POSTGRES_USER="${_v}"
    fi
    if [[ -z "${POSTGRES_DB:-}" || "${POSTGRES_DB}" == "nomarkup" ]]; then
      _v="$(_env_get POSTGRES_DB "${candidate}")"
      [[ -n "${_v}" ]] && POSTGRES_DB="${_v}"
    fi
    POSTGRES_USER="${POSTGRES_USER:-nomarkup}"
    POSTGRES_DB="${POSTGRES_DB:-nomarkup}"
    break
  fi
done

compose() {
  local args=(compose -p "${COMPOSE_PROJECT}" -f "${COMPOSE_FILE}")
  if [[ -f "${REPO_ROOT}/deploy/prod/.env" ]]; then
    args+=(--env-file "${REPO_ROOT}/deploy/prod/.env")
  elif [[ -f "${REPO_ROOT}/.env.prod" ]]; then
    args+=(--env-file "${REPO_ROOT}/.env.prod")
  elif [[ -f "${REPO_ROOT}/.env" ]]; then
    args+=(--env-file "${REPO_ROOT}/.env")
  fi
  docker "${args[@]}" "$@"
}

if ! compose ps --status running --services 2>/dev/null | grep -qx "${POSTGRES_SERVICE}"; then
  # Fall back: service may be healthy but status filter differs by compose version.
  if ! compose ps --services 2>/dev/null | grep -qx "${POSTGRES_SERVICE}"; then
    die "postgres service '${POSTGRES_SERVICE}' not found in compose project '${COMPOSE_PROJECT}'"
  fi
  log "warning: could not confirm ${POSTGRES_SERVICE} is running; attempting dump anyway"
fi

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}" || true

ts="$(date -u +%Y%m%dT%H%M%SZ)"
outfile="${BACKUP_DIR}/nomarkup-${POSTGRES_DB}-${ts}.sql.gz"

log "dumping ${POSTGRES_SERVICE}:${POSTGRES_DB} as ${POSTGRES_USER}"
log "output: ${outfile}"

# Custom format would need pg_restore; plain SQL + gzip is portable for VPS restores.
# Write to a temp path then rename for atomic appearance.
set +o pipefail
compose exec -T \
  -e "PGPASSWORD=${PGPASSWORD:-}" \
  "${POSTGRES_SERVICE}" \
  pg_dump \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    --no-owner \
    --no-acl \
    --format=plain \
  | gzip -c >"${outfile}.tmp"
dump_status=${PIPESTATUS[0]}
gzip_status=${PIPESTATUS[1]}
set -o pipefail

if [[ "${dump_status}" -ne 0 || "${gzip_status}" -ne 0 ]]; then
  rm -f "${outfile}.tmp"
  die "pg_dump failed (pg_dump=${dump_status} gzip=${gzip_status})"
fi

mv "${outfile}.tmp" "${outfile}"
chmod 600 "${outfile}" || true

size="$(wc -c <"${outfile}" | tr -d ' ')"
if [[ "${size}" -lt 100 ]]; then
  die "backup suspiciously small (${size} bytes): ${outfile}"
fi
log "wrote ${outfile} (${size} bytes)"

# Retention: keep last N timestamped dumps matching our naming pattern.
if [[ "${KEEP}" =~ ^[0-9]+$ ]] && [[ "${KEEP}" -gt 0 ]]; then
  log "retaining last ${KEEP} dumps in ${BACKUP_DIR}"
  # shellcheck disable=SC2012
  mapfile -t old < <(ls -1t "${BACKUP_DIR}"/nomarkup-*.sql.gz 2>/dev/null || true)
  if [[ ${#old[@]} -gt "${KEEP}" ]]; then
    for f in "${old[@]:${KEEP}}"; do
      log "removing old backup: ${f}"
      rm -f "${f}"
    done
  fi
else
  log "KEEP=${KEEP} — skipping retention pruning"
fi

log "backup complete"
