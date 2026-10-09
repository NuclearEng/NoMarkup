#!/usr/bin/env bash
# Authenticated API E2E smoke — same gateway the physical iOS app uses.
# Usage:
#   API_BASE=http://192.168.1.101:8081 SEED_PASSWORD=... ./scripts/ios-api-e2e-smoke.sh
set -euo pipefail

API_BASE="${API_BASE:-http://192.168.1.101:8081}"
API_BASE="${API_BASE%/}"

SEED_PASSWORD="${SEED_PASSWORD:-}"
if [[ -z "$SEED_PASSWORD" && -f .env.local ]]; then
  SEED_PASSWORD="$(grep -E '^SEED_PASSWORD=' .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]')"
fi
if [[ -z "$SEED_PASSWORD" ]]; then
  SEED_PASSWORD="Password123!"
fi

CUSTOMER_EMAIL="${CUSTOMER_EMAIL:-customer@nomarkup.com}"
PROVIDER_EMAIL="${PROVIDER_EMAIL:-provider@nomarkup.com}"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "PASS  $1 — $2"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL  $1 — $2"; }

request() {
  local method="$1" path="$2" token="${3:-}" body="${4:-}"
  local url="${API_BASE}${path}"
  local args=(-sS -m 15 -w "\n%{http_code}" -X "$method" "$url" -H "Accept: application/json")
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer $token")
  fi
  if [[ -n "$body" ]]; then
    args+=(-H "Content-Type: application/json" -d "$body")
  fi
  curl "${args[@]}" 2>/dev/null || printf '\n000'
}

split_body_code() {
  local raw="$1"
  HTTP_CODE="${raw##*$'\n'}"
  HTTP_BODY="${raw%$'\n'*}"
}

login() {
  local email="$1"
  local raw
  raw="$(request POST /api/v1/auth/login "" "{\"email\":\"$email\",\"password\":\"$SEED_PASSWORD\"}")"
  split_body_code "$raw"
  if [[ "$HTTP_CODE" != "200" ]]; then
    echo ""
    return 1
  fi
  echo "$HTTP_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))"
}

echo "=== NoMarkup iOS API E2E smoke ==="
echo "API_BASE=$API_BASE"
echo

raw="$(request GET /health)"
split_body_code "$raw"
if [[ "$HTTP_CODE" == "200" ]]; then pass "health" "HTTP $HTTP_CODE"; else fail "health" "HTTP $HTTP_CODE"; fi

raw="$(request GET '/api/v1/jobs?page=1&page_size=3')"
split_body_code "$raw"
if [[ "$HTTP_CODE" == "200" ]]; then pass "jobs.public" "HTTP $HTTP_CODE"; else fail "jobs.public" "HTTP $HTTP_CODE"; fi

raw="$(request GET '/api/v1/listings?page=1&page_size=3')"
split_body_code "$raw"
if [[ "$HTTP_CODE" == "200" ]]; then pass "listings.public" "HTTP $HTTP_CODE"; else fail "listings.public" "HTTP $HTTP_CODE"; fi

raw="$(request GET '/api/v1/jobs/map?latitude=47.6&longitude=-122.3&radius_km=50')"
split_body_code "$raw"
if [[ "$HTTP_CODE" == "200" ]]; then pass "jobs.map" "HTTP $HTTP_CODE"; else fail "jobs.map" "HTTP $HTTP_CODE"; fi

raw="$(request GET /api/v1/flags)"
split_body_code "$raw"
if [[ "$HTTP_CODE" == "200" ]]; then pass "flags" "HTTP $HTTP_CODE"; else fail "flags" "HTTP $HTTP_CODE"; fi

CTOKEN="$(login "$CUSTOMER_EMAIL" || true)"
if [[ -n "$CTOKEN" ]]; then
  pass "auth.customer" "token acquired"
  for path in \
    "/api/v1/users/me" \
    "/api/v1/jobs/mine?page=1&page_size=5" \
    "/api/v1/me/orders" \
    "/api/v1/notifications?page=1&page_size=10" \
    "/api/v1/notifications/unread-count" \
    "/api/v1/contracts?page=1&page_size=5" \
    "/api/v1/me/watchlist?page=1&page_size=5" \
    "/api/v1/me/saved-searches" \
    "/api/v1/channels?page=1&page_size=10"
  do
    name="${path%%\?*}"
    name="${name#/api/v1/}"
    raw="$(request GET "$path" "$CTOKEN")"
    split_body_code "$raw"
    if [[ "$HTTP_CODE" =~ ^2 ]]; then
      pass "customer.$name" "HTTP $HTTP_CODE"
    else
      fail "customer.$name" "HTTP $HTTP_CODE body=$(echo "$HTTP_BODY" | head -c 120)"
    fi
  done
else
  fail "auth.customer" "login failed"
fi

PTOKEN="$(login "$PROVIDER_EMAIL" || true)"
if [[ -n "$PTOKEN" ]]; then
  pass "auth.provider" "token acquired"
  for path in \
    "/api/v1/bids/mine?page=1&page_size=5" \
    "/api/v1/listings/bids/mine?page=1&page_size=5" \
    "/api/v1/me/seller-analytics?range=30d"
  do
    name="${path%%\?*}"
    name="${name#/api/v1/}"
    raw="$(request GET "$path" "$PTOKEN")"
    split_body_code "$raw"
    if [[ "$HTTP_CODE" =~ ^2 ]]; then
      pass "provider.$name" "HTTP $HTTP_CODE"
    else
      fail "provider.$name" "HTTP $HTTP_CODE body=$(echo "$HTTP_BODY" | head -c 120)"
    fi
  done
else
  fail "auth.provider" "login failed"
fi

echo
echo "=== Summary: $PASS pass, $FAIL fail ==="
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
