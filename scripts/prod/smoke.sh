#!/usr/bin/env bash
# Post-deploy smoke checks against public web + gateway health endpoints.
#
# Codebase endpoints (gateway/internal/router/router.go):
#   GET /healthz  — liveness (always 200 if process can respond)
#   GET /health   — legacy alias of /healthz
#   GET /readyz   — readiness (Postgres + Redis)
# Web (web/src/app/api/health/route.ts):
#   GET /api/health — Next.js liveness (dependency-free)
# Also probes BASE_URL / for a non-5xx HTML response.
#
# Usage:
#   BASE_URL=https://no-markup.com API_URL=https://api.no-markup.com ./scripts/prod/smoke.sh
#   BASE_URL=http://127.0.0.1:3000 API_URL=http://127.0.0.1:8080 ./scripts/prod/smoke.sh
#
# Env:
#   BASE_URL   web origin (required)
#   API_URL    gateway origin (required)
#   TIMEOUT    curl max-time seconds (default 15)
#   RETRIES    attempts per check (default 3)
#   RETRY_SLEEP seconds between retries (default 2)
#
# No secrets required.
set -euo pipefail

BASE_URL="${BASE_URL:-}"
API_URL="${API_URL:-}"
TIMEOUT="${TIMEOUT:-15}"
RETRIES="${RETRIES:-3}"
RETRY_SLEEP="${RETRY_SLEEP:-2}"

PASS=0
FAIL=0

log()  { printf '[smoke] %s\n' "$*"; }
die()  { printf '[smoke] ERROR: %s\n' "$*" >&2; exit 1; }

if [[ -z "${BASE_URL}" ]]; then
  die "BASE_URL is required (e.g. https://no-markup.com)"
fi
if [[ -z "${API_URL}" ]]; then
  die "API_URL is required (e.g. https://api.no-markup.com or http://127.0.0.1:8080)"
fi

# Strip trailing slashes for clean joins.
BASE_URL="${BASE_URL%/}"
API_URL="${API_URL%/}"

pass() { PASS=$((PASS + 1)); log "PASS  $1 — $2"; }
fail() { FAIL=$((FAIL + 1)); log "FAIL  $1 — $2"; }

# curl with retries; sets HTTP_CODE and HTTP_BODY.
http_get() {
  local url="$1"
  local attempt=1
  local raw code body
  HTTP_CODE="000"
  HTTP_BODY=""
  while [[ "${attempt}" -le "${RETRIES}" ]]; do
    raw="$(
      curl -sS -m "${TIMEOUT}" -L \
        -w "\n%{http_code}" \
        -H "Accept: application/json, text/html;q=0.9,*/*;q=0.8" \
        -H "User-Agent: NoMarkup-prod-smoke/1.0" \
        "${url}" 2>/dev/null || printf '\n000'
    )"
    code="${raw##*$'\n'}"
    body="${raw%$'\n'*}"
    HTTP_CODE="${code}"
    HTTP_BODY="${body}"
    if [[ "${HTTP_CODE}" =~ ^[23][0-9][0-9]$ ]]; then
      return 0
    fi
    if [[ "${attempt}" -lt "${RETRIES}" ]]; then
      sleep "${RETRY_SLEEP}"
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

expect_2xx() {
  local name="$1" url="$2"
  if http_get "${url}"; then
    pass "${name}" "HTTP ${HTTP_CODE} ${url}"
  else
    fail "${name}" "HTTP ${HTTP_CODE} ${url}"
  fi
}

expect_status() {
  local name="$1" url="$2" want="$3"
  local attempt=1
  HTTP_CODE="000"
  while [[ "${attempt}" -le "${RETRIES}" ]]; do
    HTTP_CODE="$(
      curl -sS -m "${TIMEOUT}" -o /dev/null -w "%{http_code}" \
        -H "User-Agent: NoMarkup-prod-smoke/1.0" \
        "${url}" 2>/dev/null || printf '000'
    )"
    if [[ "${HTTP_CODE}" == "${want}" ]]; then
      pass "${name}" "HTTP ${HTTP_CODE} ${url}"
      return 0
    fi
    if [[ "${attempt}" -lt "${RETRIES}" ]]; then
      sleep "${RETRY_SLEEP}"
    fi
    attempt=$((attempt + 1))
  done
  fail "${name}" "expected ${want}, got ${HTTP_CODE} ${url}"
}

log "=== NoMarkup prod smoke ==="
log "BASE_URL=${BASE_URL}"
log "API_URL=${API_URL}"
log "TIMEOUT=${TIMEOUT}s RETRIES=${RETRIES}"

# Web
expect_2xx "web_root"       "${BASE_URL}/"
expect_2xx "web_api_health" "${BASE_URL}/api/health"

# Gateway — prefer readyz (deps) and healthz (liveness); /health is legacy alias.
expect_2xx "gateway_healthz" "${API_URL}/healthz"
expect_2xx "gateway_health"  "${API_URL}/health"
expect_2xx "gateway_readyz"  "${API_URL}/readyz"

echo ""
log "summary: ${PASS} passed, ${FAIL} failed"
if [[ "${FAIL}" -gt 0 ]]; then
  exit 1
fi
log "all smoke checks passed"
