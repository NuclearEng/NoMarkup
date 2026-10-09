#!/usr/bin/env bash
# origin-check.sh — probe canonical production public origins (F7).
#
# Canonical hosts: https://no-markup.com  and  https://api.no-markup.com
#
# Probes (non-2xx is FAIL; health passes if either path is 2xx):
#   https://api.no-markup.com/health
#   https://api.no-markup.com/api/v1/health
#   https://no-markup.com/pricing
#   https://no-markup.com/.well-known/apple-developer-merchantid-domain-association
#
# Prints status only (no response bodies). Default is allow-down: FAIL rows
# still exit 0 so CI without DNS is not red. Exit 1 only with --strict or
# ORIGIN_CHECK_STRICT=1. --allow-down is the explicit default.
#
# Usage:
#   scripts/origin-check.sh
#   scripts/origin-check.sh --strict
#   ORIGIN_CHECK_STRICT=1 make origin-check
#   scripts/origin-check.sh --allow-down
#   make origin-check
#
# Env:
#   PUBLIC_API_URL   API origin (default https://api.no-markup.com)
#   FRONTEND_URL     Web origin (default https://no-markup.com)
#   TIMEOUT          curl max-time seconds (default 10)
#   ORIGIN_CHECK_STRICT=1   same as --strict
#
# Exit:
#   0  all 2xx, or any FAIL when allow-down (default)
#   1  --strict / ORIGIN_CHECK_STRICT=1 and at least one check failed
#   2  usage
#
# Does not provision DNS, TLS, or DEPLOY_PROVISIONED.
set -euo pipefail

PUBLIC_API_URL="${PUBLIC_API_URL:-https://api.no-markup.com}"
FRONTEND_URL="${FRONTEND_URL:-https://no-markup.com}"
TIMEOUT="${TIMEOUT:-10}"
STRICT="${ORIGIN_CHECK_STRICT:-0}"

PUBLIC_API_URL="${PUBLIC_API_URL%/}"
FRONTEND_URL="${FRONTEND_URL%/}"

usage() {
  echo "usage: $0 [--strict|--allow-down]" >&2
  echo "  Probe public origin health, /pricing, and Apple Pay association." >&2
  echo "  Prints status only. Default allow-down (exit 0 with FAIL rows)." >&2
  echo "  --strict or ORIGIN_CHECK_STRICT=1 exits 1 on any FAIL." >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --strict) STRICT=1 ;;
    --allow-down) STRICT=0 ;;
    -h|--help) usage ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage
      ;;
  esac
  shift
done

case "${STRICT}" in
  1|true|TRUE|yes|YES) STRICT=1 ;;
  *) STRICT=0 ;;
esac

PASS=0
FAIL=0

# curl HTTP status only. "000" on DNS/connect/timeout. No body.
# curl -w still prints 000 on failure and exits non-zero — do not append
# another 000 via `|| printf`.
http_code() {
  local url="$1"
  local code
  code="$(
    curl -sS -o /dev/null -m "${TIMEOUT}" -L --max-redirs 5 \
      -w "%{http_code}" \
      -H "User-Agent: NoMarkup-origin-check/1.0" \
      "${url}" 2>/dev/null || true
  )"
  case "${code}" in
    [0-9][0-9][0-9]) ;;
    *) code="000" ;;
  esac
  printf '%s' "${code}"
}

is_2xx() {
  case "$1" in
    2[0-9][0-9]) return 0 ;;
    *) return 1 ;;
  esac
}

row() {
  local status="$1" url="$2" code="$3"
  printf '%-4s  %-88s  %s\n' "${status}" "${url}" "${code}"
}

probe() {
  local url="$1"
  local code
  code="$(http_code "${url}")"
  if is_2xx "${code}"; then
    PASS=$((PASS + 1))
    row "OK" "${url}" "${code}"
    return 0
  fi
  FAIL=$((FAIL + 1))
  row "FAIL" "${url}" "${code}"
  return 1
}

# Health: try both gateway /health and /api/v1/health. Either 2xx is enough.
probe_health() {
  local a="${PUBLIC_API_URL}/health"
  local b="${PUBLIC_API_URL}/api/v1/health"
  local code_a code_b
  code_a="$(http_code "${a}")"
  code_b="$(http_code "${b}")"

  if is_2xx "${code_a}" || is_2xx "${code_b}"; then
    PASS=$((PASS + 1))
    if is_2xx "${code_a}"; then
      row "OK" "${a}" "${code_a}"
    else
      row "—" "${a}" "${code_a}"
    fi
    if is_2xx "${code_b}"; then
      row "OK" "${b}" "${code_b}"
    else
      row "—" "${b}" "${code_b}"
    fi
    return 0
  fi
  FAIL=$((FAIL + 1))
  row "FAIL" "${a}" "${code_a}"
  row "FAIL" "${b}" "${code_b}"
  return 1
}

echo "origin-check  api=${PUBLIC_API_URL}  web=${FRONTEND_URL}"
if [ "${STRICT}" -eq 1 ]; then
  echo "mode=strict"
else
  echo "mode=allow-down"
fi

probe_health || true
probe "${FRONTEND_URL}/pricing" || true
probe "${FRONTEND_URL}/.well-known/apple-developer-merchantid-domain-association" || true

echo "summary  ${PASS} passed, ${FAIL} failed"

if [ "${FAIL}" -gt 0 ] && [ "${STRICT}" -eq 1 ]; then
  exit 1
fi
exit 0
