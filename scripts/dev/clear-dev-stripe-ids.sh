#!/usr/bin/env bash
# clear-dev-stripe-ids.sh — NULL synthetic DevMode Stripe IDs in local Postgres only.
#
# Why: Seed / DevMode Stripe leaves cus_dev_% on users.stripe_customer_id and
# acct_dev% on provider_profiles.stripe_account_id. Against a real Stripe key those
# IDs are soft-handled in app code, but clearing them lets provisioning mint real
# cus_/acct_ objects on the next money path (see docs/compliance soft-id notes).
#
# Safety: Refuses to run unless DATABASE_URL host is localhost / 127.0.0.1 / ::1
# (or a docker-compose-style "postgres" host only when explicitly allowed). Never
# points at staging/prod.
#
# Usage (from repo root, with local stack up):
#   export DATABASE_URL='postgresql://nomarkup:nomarkup@localhost:5433/nomarkup?sslmode=disable'
#   ./scripts/dev/clear-dev-stripe-ids.sh
#
# Optional:
#   DRY_RUN=1  — print row counts only, no UPDATE
#   ALLOW_DOCKER_HOST=1 — also accept host name "postgres" (compose service DNS)
#
# Requires: psql on PATH, DATABASE_URL set.
set -euo pipefail

log()  { printf '[clear-dev-stripe] %s\n' "$*"; }
die()  { printf '[clear-dev-stripe] ERROR: %s\n' "$*" >&2; exit 1; }

DATABASE_URL="${DATABASE_URL:-}"
if [[ -z "${DATABASE_URL}" ]]; then
  die "DATABASE_URL is required (local Postgres only)"
fi

if ! command -v psql >/dev/null 2>&1; then
  die "psql not found on PATH"
fi

# Extract host from common URL shapes:
#   postgresql://user:pass@host:port/db?params
#   postgres://user@host/db
#   postgresql://user:pass@host/db
extract_host() {
  local url="$1"
  # Strip scheme
  url="${url#*://}"
  # Drop userinfo if present
  if [[ "${url}" == *"@"* ]]; then
    url="${url#*@}"
  fi
  # Host is up to :port or /path or ?
  url="${url%%/*}"
  url="${url%%\?*}"
  if [[ "${url}" == *"]"* ]]; then
    # IPv6 in brackets [::1]:5432
    url="${url#\[}"
    url="${url%%\]*}"
  else
    url="${url%%:*}"
  fi
  printf '%s' "${url}"
}

HOST="$(extract_host "${DATABASE_URL}")"
HOST_LC="$(printf '%s' "${HOST}" | tr '[:upper:]' '[:lower:]')"

ALLOWED=0
case "${HOST_LC}" in
  localhost|127.0.0.1|::1|0:0:0:0:0:0:0:1)
    ALLOWED=1
    ;;
  postgres)
    if [[ "${ALLOW_DOCKER_HOST:-0}" == "1" ]]; then
      ALLOWED=1
    fi
    ;;
esac

if [[ "${ALLOWED}" -ne 1 ]]; then
  die "Refusing to run: DATABASE_URL host is '${HOST}' (not localhost/127.0.0.1/::1). This script is local-dev only."
fi

log "Host OK (${HOST}). Scanning synthetic Stripe IDs…"

# Count first (always).
CUSTOMER_COUNT="$(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FROM users WHERE stripe_customer_id LIKE 'cus_dev_%';")"
ACCOUNT_COUNT="$(psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -Atqc \
  "SELECT count(*) FROM provider_profiles WHERE stripe_account_id LIKE 'acct_dev%';")"

log "users.stripe_customer_id matching cus_dev_%:        ${CUSTOMER_COUNT}"
log "provider_profiles.stripe_account_id matching acct_dev%: ${ACCOUNT_COUNT}"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  log "DRY_RUN=1 — no updates applied."
  exit 0
fi

if [[ "${CUSTOMER_COUNT}" -eq 0 && "${ACCOUNT_COUNT}" -eq 0 ]]; then
  log "Nothing to clear."
  exit 0
fi

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

UPDATE users
   SET stripe_customer_id = NULL,
       updated_at = now()
 WHERE stripe_customer_id LIKE 'cus_dev_%';

UPDATE provider_profiles
   SET stripe_account_id = NULL,
       updated_at = now()
 WHERE stripe_account_id LIKE 'acct_dev%';

COMMIT;
SQL

log "Cleared ${CUSTOMER_COUNT} customer id(s) and ${ACCOUNT_COUNT} connect account id(s)."
log "Next payment/Connect path will provision real Stripe objects when a live key is configured."
