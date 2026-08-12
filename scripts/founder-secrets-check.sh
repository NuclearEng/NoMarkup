#!/usr/bin/env bash
# founder-secrets-check.sh — founder-action secrets inventory.
#
# Reports present / missing / placeholder / not-armed only.
# NEVER prints secret VALUES. Refuses to run under `set -x`.
#
# Sources (later overlays earlier; process env is the base):
#   .env.local
#   deploy/prod/.env
# Missing files are skipped.
#
# Usage:
#   scripts/founder-secrets-check.sh           # exit 0 unless ENVIRONMENT=production
#   scripts/founder-secrets-check.sh --strict  # exit 1 on any failing row
#   make founder-secrets-check
#
# Exit:
#   0  development/staging advisory (rows may still fail)
#   1  ENVIRONMENT=production or --strict, and at least one row is not present
#   2  usage / safety (xtrace)
#
# This check does not provision secrets and does not close Founder-Action
# residuals. A green row only means a non-placeholder value is visible.

set -euo pipefail

case "$-" in
  *x*)
    echo "error: refuse to run with set -x (would print secret values)" >&2
    exit 2
    ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STRICT=0

usage() {
  echo "usage: $0 [--strict]" >&2
  echo "  Reports founder-action secrets as present/missing/placeholder." >&2
  echo "  Never prints values. Exit 0 in development; exit 1 if" >&2
  echo "  ENVIRONMENT=production or --strict and any row fails." >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --strict) STRICT=1 ;;
    -h|--help) usage ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage
      ;;
  esac
  shift
done

WANTED_KEYS="ENVIRONMENT GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET FACEBOOK_CLIENT_ID APPLE_CLIENT_ID SENDGRID_API_KEY SENTRY_DSN NEXT_PUBLIC_SENTRY_DSN DEPLOY_PROVISIONED STRIPE_WEBHOOK_SECRET ENCRYPTION_KEY CHECKR_API_KEY NOMARKUP_STRIPE_PUBLISHABLE_KEY NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"

is_wanted() {
  case " $WANTED_KEYS " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

trim() {
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  printf '%s' "$v"
}

# Parse KEY=VALUE only for the wanted inventory. No source(1), no $() eval.
load_env_file() {
  local file="$1" line key val
  [ -f "$file" ] || return 0
  if [ -n "${SOURCES:-}" ]; then
    SOURCES="${SOURCES}"$'\n'"  found     ${file#"$ROOT/"}"
  else
    SOURCES="  found     ${file#"$ROOT/"}"
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in
      ''|'#'*) continue ;;
    esac
    case "$line" in
      export[[:space:]]*)
        line="${line#export}"
        line="${line#"${line%%[![:space:]]*}"}"
        ;;
    esac
    case "$line" in
      [A-Za-z_][A-Za-z0-9_]*=*) ;;
      *) continue ;;
    esac
    key="${line%%=*}"
    is_wanted "$key" || continue
    val="${line#*=}"
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
      \'*\') val="${val#\'}"; val="${val%\'}" ;;
    esac
    printf -v "$key" '%s' "$val"
  done < "$file"
}

is_placeholder() {
  local v u
  v="$(trim "${1-}")"
  [ -n "$v" ] || return 0
  u=$(printf '%s' "$v" | tr '[:lower:]' '[:upper:]')
  case "$u" in
    *CHANGE_ME*|*REPLACE_ME*|*SET_ME*|*PLACEHOLDER*|*TODO*|*XXXX*|*EXAMPLE*)
      return 0
      ;;
  esac
  case "$v" in
    *...) return 0 ;;
  esac
  return 1
}

# stdout: missing | placeholder | present   (never the value)
classify() {
  local v
  v="$(trim "${1-}")"
  if [ -z "$v" ]; then
    echo missing
    return
  fi
  if is_placeholder "$v"; then
    echo placeholder
    return
  fi
  echo present
}

# DEPLOY_PROVISIONED is only "present" when it is exactly true.
classify_flag() {
  local v u
  v="$(trim "${1-}")"
  if [ -z "$v" ]; then
    echo missing
    return
  fi
  if is_placeholder "$v"; then
    echo placeholder
    return
  fi
  u=$(printf '%s' "$v" | tr '[:lower:]' '[:upper:]')
  if [ "$u" = "TRUE" ]; then
    echo present
    return
  fi
  echo not-armed
}

row_fails() {
  case "$1" in
    present) return 1 ;;
    *) return 0 ;;
  esac
}

SOURCES=""
if [ -f "$ROOT/.env.local" ]; then
  load_env_file "$ROOT/.env.local"
else
  SOURCES="${SOURCES:+$SOURCES$'\n'}  absent    .env.local"
fi
if [ -f "$ROOT/deploy/prod/.env" ]; then
  load_env_file "$ROOT/deploy/prod/.env"
else
  SOURCES="${SOURCES:+$SOURCES$'\n'}  absent    deploy/prod/.env"
fi

ENV_NAME="$(trim "${ENVIRONMENT:-}")"
if [ -z "$ENV_NAME" ]; then
  ENV_NAME="development"
fi
ENV_LC=$(printf '%s' "$ENV_NAME" | tr '[:upper:]' '[:lower:]')

FAILS=0
ROWS=0

report() {
  local name="$1" status="$2" note="${3-}"
  ROWS=$((ROWS + 1))
  if row_fails "$status"; then
    FAILS=$((FAILS + 1))
  fi
  if [ -n "$note" ]; then
    printf '  %-54s %-12s %s\n' "$name" "$status" "$note"
  else
    printf '  %-54s %s\n' "$name" "$status"
  fi
}

APPLE_FILE="$ROOT/web/public/.well-known/apple-developer-merchantid-domain-association"
apple_status() {
  if [ ! -f "$APPLE_FILE" ]; then
    echo missing
    return
  fi
  # Status only — never print matching lines.
  if grep -Eiq 'PLACEHOLDER|TODO|example' "$APPLE_FILE"; then
    echo placeholder
    return
  fi
  echo present
}

echo "=== NoMarkup founder-secrets-check ==="
echo "Values are never printed. Status remains Founder-Action until a human provisions real credentials."
echo ""
echo "Sources:"
echo "$SOURCES"
echo ""
if [ "$STRICT" -eq 1 ]; then
  MODE=strict
elif [ "$ENV_LC" = "production" ]; then
  MODE=fail-closed
else
  MODE=advisory
fi
echo "ENVIRONMENT=${ENV_LC}   mode=${MODE}"
echo ""
printf '  %-54s %s\n' "KEY" "STATUS"
printf '  %-54s %s\n' "---" "------"

report "GOOGLE_CLIENT_ID" "$(classify "${GOOGLE_CLIENT_ID-}")"
report "GOOGLE_CLIENT_SECRET" "$(classify "${GOOGLE_CLIENT_SECRET-}")"
report "FACEBOOK_CLIENT_ID" "$(classify "${FACEBOOK_CLIENT_ID-}")"
report "APPLE_CLIENT_ID" "$(classify "${APPLE_CLIENT_ID-}")"
report "SENDGRID_API_KEY" "$(classify "${SENDGRID_API_KEY-}")"
report "SENTRY_DSN" "$(classify "${SENTRY_DSN-}")"
report "NEXT_PUBLIC_SENTRY_DSN" "$(classify "${NEXT_PUBLIC_SENTRY_DSN-}")"
report "DEPLOY_PROVISIONED" "$(classify_flag "${DEPLOY_PROVISIONED-}")" "present only when true"
report "STRIPE_WEBHOOK_SECRET" "$(classify "${STRIPE_WEBHOOK_SECRET-}")"
report "ENCRYPTION_KEY" "$(classify "${ENCRYPTION_KEY-}")"
report "CHECKR_API_KEY" "$(classify "${CHECKR_API_KEY-}")"

WEB_PK="$(classify "${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY-}")"
IOS_PK="$(classify "${NOMARKUP_STRIPE_PUBLISHABLE_KEY-}")"
if [ "$WEB_PK" = "present" ] || [ "$IOS_PK" = "present" ]; then
  WHICH=""
  [ "$WEB_PK" = "present" ] && WHICH="NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
  if [ "$IOS_PK" = "present" ]; then
    if [ -n "$WHICH" ]; then
      WHICH="$WHICH + NOMARKUP_STRIPE_PUBLISHABLE_KEY"
    else
      WHICH="NOMARKUP_STRIPE_PUBLISHABLE_KEY"
    fi
  fi
  report "NOMARKUP_STRIPE_PUBLISHABLE_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" "present" "$WHICH"
elif [ "$WEB_PK" = "placeholder" ] || [ "$IOS_PK" = "placeholder" ]; then
  report "NOMARKUP_STRIPE_PUBLISHABLE_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" "placeholder"
else
  report "NOMARKUP_STRIPE_PUBLISHABLE_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" "missing"
fi

APPLE="$(apple_status)"
APPLE_NOTE="web/public/.well-known/apple-developer-merchantid-domain-association"
if [ "$APPLE" = "placeholder" ]; then
  APPLE_NOTE="$APPLE_NOTE contains PLACEHOLDER/TODO/example"
elif [ "$APPLE" = "missing" ]; then
  APPLE_NOTE="$APPLE_NOTE not found"
fi
report "APPLE_PAY_DOMAIN_ASSOCIATION" "$APPLE" "$APPLE_NOTE"

echo ""
echo "$FAILS / $ROWS rows are not present."
echo "A green row is visibility only — OAuth consoles, SendGrid, Sentry, Apple Pay verify, and DEPLOY_PROVISIONED stay Founder-Action."
echo ""

FAIL_CLOSED=0
if [ "$STRICT" -eq 1 ] || [ "$ENV_LC" = "production" ]; then
  FAIL_CLOSED=1
fi

if [ "$FAILS" -gt 0 ]; then
  if [ "$FAIL_CLOSED" -eq 1 ]; then
    echo "FAIL: fail-closed (ENVIRONMENT=production or --strict)."
    exit 1
  fi
  echo "ADVISORY: development/staging exit 0. Re-run with --strict (or ENVIRONMENT=production) to fail closed."
  exit 0
fi

echo "OK: every inventoried row is present (non-placeholder)."
if [ "$FAIL_CLOSED" -eq 0 ]; then
  echo "Still advisory — this does not mean production is provisioned."
fi
exit 0
