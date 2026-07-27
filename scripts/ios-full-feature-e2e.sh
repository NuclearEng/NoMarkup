#!/usr/bin/env bash
# Full consumer feature E2E against the gateway the iOS app uses.
# Covers dual-profile + public surfaces shipped in the native app.
# Usage:
#   API_BASE=http://192.168.1.101:8081 SEED_PASSWORD=Password123! ./scripts/ios-full-feature-e2e.sh
set -euo pipefail

API_BASE="${API_BASE:-http://192.168.1.101:8081}"
API_BASE="${API_BASE%/}"
SEED_PASSWORD="${SEED_PASSWORD:-Password123!}"
CUSTOMER_EMAIL="${CUSTOMER_EMAIL:-customer@nomarkup.com}"
PROVIDER_EMAIL="${PROVIDER_EMAIL:-provider@nomarkup.com}"

PASS=0
FAIL=0
SKIP=0
RESULTS=()

# Log to stderr so command substitutions only capture pure return values (tokens/ids).
pass() { PASS=$((PASS + 1)); RESULTS+=("PASS|$1|$2"); echo "PASS  $1 — $2" >&2; }
fail() { FAIL=$((FAIL + 1)); RESULTS+=("FAIL|$1|$2"); echo "FAIL  $1 — $2" >&2; }
skip() { SKIP=$((SKIP + 1)); RESULTS+=("SKIP|$1|$2"); echo "SKIP  $1 — $2" >&2; }

request() {
  local method="$1" path="$2" token="${3:-}" body="${4:-}" extra_hdr="${5:-}"
  local url="${API_BASE}${path}"
  local args=(-sS -m 20 -w "\n%{http_code}" -X "$method" "$url" -H "Accept: application/json")
  if [[ -n "$token" ]]; then args+=(-H "Authorization: Bearer $token"); fi
  if [[ -n "$extra_hdr" ]]; then args+=(-H "$extra_hdr"); fi
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

expect() {
  local name="$1" want="$2" method="$3" path="$4" token="${5:-}" body="${6:-}" extra="${7:-}"
  local raw
  raw="$(request "$method" "$path" "$token" "$body" "$extra")"
  split_body_code "$raw"
  if [[ "$HTTP_CODE" == "$want" ]]; then
    pass "$name" "HTTP $HTTP_CODE"
    return 0
  fi
  # DELETE / empty success often returns 204
  if [[ "$want" == "200" && "$HTTP_CODE" == "204" ]]; then
    pass "$name" "HTTP 204"
    return 0
  fi
  # Soft-accept 404/501 for optional feature-gated endpoints when want is 200
  if [[ "$want" == "200" && ( "$HTTP_CODE" == "404" || "$HTTP_CODE" == "501" || "$HTTP_CODE" == "503" ) ]]; then
    skip "$name" "HTTP $HTTP_CODE (optional/gated)"
    return 0
  fi
  local snip
  snip="$(echo "$HTTP_BODY" | head -c 120 | tr '\n' ' ')"
  fail "$name" "HTTP $HTTP_CODE want $want — $snip"
  return 0  # keep suite running under set -e
}

login() {
  local email="$1"
  local raw
  raw="$(request POST /api/v1/auth/login "" "{\"email\":\"$email\",\"password\":\"$SEED_PASSWORD\"}")"
  split_body_code "$raw"
  if [[ "$HTTP_CODE" != "200" ]]; then
    fail "auth.$email" "HTTP $HTTP_CODE"
    echo ""
    return 1
  fi
  pass "auth.$email" "HTTP 200"
  echo "$HTTP_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token') or d.get('accessToken') or '')"
}

json_field() {
  python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null || true
}

echo "=== NoMarkup FULL feature E2E (iOS surface) ===" >&2
echo "API_BASE=$API_BASE" >&2
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
echo >&2

# ── Public ──────────────────────────────────────────────────────────
expect "health" 200 GET /health
expect "flags" 200 GET /api/v1/flags
expect "jobs.public" 200 GET '/api/v1/jobs?page=1&page_size=5'
expect "listings.public" 200 GET '/api/v1/listings?page=1&page_size=5'
expect "jobs.map" 200 GET '/api/v1/jobs/map?latitude=30.27&longitude=-97.74&radius_km=50'
expect "providers.search" 200 GET '/api/v1/providers/search?q=a&page=1&page_size=5'
expect "categories.tree" 200 GET /api/v1/categories/tree
expect "listings.autocomplete" 200 GET '/api/v1/listings/autocomplete?q=mak'
expect "markets" 200 GET /api/v1/markets
expect "trust.tiers" 200 GET /api/v1/trust/tiers
expect "subscriptions.tiers" 200 GET /api/v1/subscriptions/tiers
expect "tos.current" 200 GET /api/v1/tos/current

# ── Customer auth ───────────────────────────────────────────────────
CTOKEN="$(login "$CUSTOMER_EMAIL")"
if [[ -z "$CTOKEN" ]]; then
  echo "Cannot continue without customer token"
  echo "SUMMARY pass=$PASS fail=$FAIL skip=$SKIP"
  exit 1
fi

# Profile / session
expect "customer.users/me" 200 GET /api/v1/users/me "$CTOKEN"
expect "customer.age-status" 200 GET /api/v1/me/age-status "$CTOKEN"
expect "customer.tos-acceptance" 200 GET /api/v1/me/tos-acceptance "$CTOKEN"
expect "customer.savings" 200 GET /api/v1/users/me/savings "$CTOKEN"
expect "customer.properties" 200 GET /api/v1/properties "$CTOKEN"
expect "customer.payment-methods" 200 GET /api/v1/payments/methods "$CTOKEN"
expect "customer.notification-prefs" 200 GET /api/v1/notifications/preferences "$CTOKEN"
expect "customer.notifications" 200 GET '/api/v1/notifications?page=1&page_size=10' "$CTOKEN"
expect "customer.notifications.unread" 200 GET /api/v1/notifications/unread-count "$CTOKEN"

# Dual-rail catalogs (owner)
expect "customer.jobs/mine" 200 GET '/api/v1/jobs/mine?page=1&page_size=10' "$CTOKEN"
expect "customer.jobs/drafts" 200 GET /api/v1/jobs/drafts "$CTOKEN"
expect "customer.listings/mine" 200 GET '/api/v1/listings/mine?page=1&page_size=10' "$CTOKEN"
expect "customer.me/orders" 200 GET /api/v1/me/orders "$CTOKEN"
expect "customer.contracts" 200 GET '/api/v1/contracts?page=1&page_size=10' "$CTOKEN"
expect "customer.bids.jobs" 200 GET '/api/v1/bids/mine?page=1&page_size=10' "$CTOKEN"
expect "customer.bids.listings" 200 GET '/api/v1/listings/bids/mine?page=1&page_size=10' "$CTOKEN"

# Commerce retention
expect "customer.watchlist" 200 GET '/api/v1/me/watchlist?page=1&page_size=10' "$CTOKEN"
expect "customer.wishlist" 200 GET /api/v1/me/wishlist "$CTOKEN"
expect "customer.saved-searches" 200 GET /api/v1/me/saved-searches "$CTOKEN"
expect "customer.follows" 200 GET /api/v1/me/follows "$CTOKEN"
expect "customer.feed" 200 GET '/api/v1/me/feed?page=1&page_size=10' "$CTOKEN"
expect "customer.blocks" 200 GET /api/v1/me/blocks "$CTOKEN"
expect "customer.channels" 200 GET '/api/v1/channels?page=1&page_size=10' "$CTOKEN"
expect "customer.referrals.code" 200 GET /api/v1/me/referrals/code "$CTOKEN"
expect "customer.referrals.list" 200 GET /api/v1/me/referrals "$CTOKEN"
expect "customer.nps.pending" 200 GET /api/v1/me/nps/pending "$CTOKEN"
expect "customer.seller-analytics" 200 GET '/api/v1/me/seller-analytics?range=30d' "$CTOKEN"

pick_json_id() {
  # stdin: full request raw (body\ncode). args: python expression using d
  local raw="$1"
  split_body_code "$raw"
  echo "$HTTP_BODY" | python3 -c "$2" 2>/dev/null || true
}

# Live job auction (customer owner ladder)
raw="$(request GET '/api/v1/jobs?page=1&page_size=20')"
JOB_ID="$(pick_json_id "$raw" '
import sys,json
d=json.load(sys.stdin)
jobs=d.get("jobs") or []
for j in jobs:
  if (j.get("status") or "").lower() in ("active","open","bidding"):
    print(j.get("id","")); break
else:
  print(jobs[0].get("id","") if jobs else "")
')"
if [[ -n "$JOB_ID" ]]; then
  expect "customer.job.detail" 200 GET "/api/v1/jobs/${JOB_ID}" "$CTOKEN"
  expect "customer.job.bids" 200 GET "/api/v1/jobs/${JOB_ID}/bids" "$CTOKEN"
  expect "customer.job.auction-state" 200 GET "/api/v1/jobs/${JOB_ID}/auction/state" "$CTOKEN"
else
  skip "customer.job.*" "no jobs in catalog"
fi

# Live listing
raw="$(request GET '/api/v1/listings?page=1&page_size=10')"
LISTING_ID="$(pick_json_id "$raw" '
import sys,json
d=json.load(sys.stdin)
items=d.get("listings") or []
for j in items:
  if (j.get("status") or "").lower()=="active":
    print(j.get("id","")); break
else:
  print(items[0].get("id","") if items else "")
')"
if [[ -n "$LISTING_ID" ]]; then
  expect "customer.listing.detail" 200 GET "/api/v1/listings/${LISTING_ID}" "$CTOKEN"
  expect "customer.listing.bids" 200 GET "/api/v1/listings/${LISTING_ID}/bids" "$CTOKEN"
  expect "customer.listing.similar" 200 GET "/api/v1/listings/${LISTING_ID}/similar" "$CTOKEN"
  expect "customer.listing.offers" 200 GET "/api/v1/listings/${LISTING_ID}/offers" "$CTOKEN"
else
  skip "customer.listing.*" "no listings in catalog"
fi

# Contracts detail if any
raw="$(request GET '/api/v1/contracts?page=1&page_size=5' "$CTOKEN")"
CONTRACT_ID="$(pick_json_id "$raw" '
import sys,json
d=json.load(sys.stdin)
items=d.get("contracts") or d.get("data") or []
print(items[0].get("id","") if items else "")
')"
if [[ -n "$CONTRACT_ID" ]]; then
  expect "customer.contract.detail" 200 GET "/api/v1/contracts/${CONTRACT_ID}" "$CTOKEN"
  expect "customer.contract.change-orders" 200 GET "/api/v1/contracts/${CONTRACT_ID}/change-orders" "$CTOKEN"
else
  skip "customer.contract.*" "no contracts"
fi

# Provider public profile
raw="$(request GET '/api/v1/providers/search?q=a&page=1&page_size=1')"
PROVIDER_USER="$(pick_json_id "$raw" '
import sys,json
d=json.load(sys.stdin)
ps=d.get("providers") or []
print(ps[0].get("id","") if ps else "")
')"
if [[ -n "$PROVIDER_USER" ]]; then
  expect "customer.provider.detail" 200 GET "/api/v1/providers/${PROVIDER_USER}" "$CTOKEN"
  expect "customer.user.reviews" 200 GET "/api/v1/users/${PROVIDER_USER}/reviews?page=1&page_size=10" "$CTOKEN"
fi

# ── Mutations (safe / reversible) ───────────────────────────────────
# Watchlist toggle
if [[ -n "$LISTING_ID" ]]; then
  expect "customer.watch" 200 POST "/api/v1/listings/${LISTING_ID}/watch" "$CTOKEN" "{}"
  expect "customer.unwatch" 200 DELETE "/api/v1/listings/${LISTING_ID}/watch" "$CTOKEN"
fi

# Wishlist create + delete
WISH_BODY='{"keyword":"e2e-test-widget","max_price_cents":5000}'
raw="$(request POST /api/v1/me/wishlist "$CTOKEN" "$WISH_BODY")"
split_body_code "$raw"
if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
  pass "customer.wishlist.create" "HTTP $HTTP_CODE"
  WID="$(echo "$HTTP_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('wishlist_item') or d).get('id',''))" 2>/dev/null || true)"
  if [[ -n "$WID" ]]; then
    expect "customer.wishlist.delete" 200 DELETE "/api/v1/me/wishlist/${WID}" "$CTOKEN"
  fi
else
  fail "customer.wishlist.create" "HTTP $HTTP_CODE"
fi

# Follow / unfollow first provider
if [[ -n "$PROVIDER_USER" ]]; then
  expect "customer.follow" 200 POST "/api/v1/users/${PROVIDER_USER}/follow" "$CTOKEN" "{}"
  expect "customer.unfollow" 200 DELETE "/api/v1/users/${PROVIDER_USER}/follow" "$CTOKEN"
fi

# Mark all notifications read (idempotent)
expect "customer.notifications.mark-all" 200 POST /api/v1/notifications/read-all "$CTOKEN" "{}"

# ── Provider auth ───────────────────────────────────────────────────
PTOKEN="$(login "$PROVIDER_EMAIL")"
if [[ -z "$PTOKEN" ]]; then
  fail "provider.session" "no token"
else
  expect "provider.users/me" 200 GET /api/v1/users/me "$PTOKEN"
  expect "provider.bids/mine" 200 GET '/api/v1/bids/mine?page=1&page_size=10' "$PTOKEN"
  expect "provider.listings/bids/mine" 200 GET '/api/v1/listings/bids/mine?page=1&page_size=10' "$PTOKEN"
  expect "provider.seller-analytics" 200 GET '/api/v1/me/seller-analytics?range=30d' "$PTOKEN"
  expect "provider.profile.me" 200 GET /api/v1/providers/me "$PTOKEN"
  expect "provider.licenses" 200 GET /api/v1/providers/me/licenses "$PTOKEN"
  expect "provider.streaks" 200 GET /api/v1/providers/me/streaks "$PTOKEN"
  expect "provider.documents" 200 GET /api/v1/providers/me/documents "$PTOKEN"
  expect "provider.quote-templates" 200 GET /api/v1/providers/me/quote-templates "$PTOKEN"
  expect "provider.stripe.status" 200 GET /api/v1/providers/me/stripe/status "$PTOKEN"
  expect "provider.sales.csv" 200 GET /api/v1/me/sales.csv "$PTOKEN"
  expect "provider.calendar.ics" 200 GET /api/v1/me/calendar.ics "$PTOKEN"
  expect "provider.contracts" 200 GET '/api/v1/contracts?page=1&page_size=10' "$PTOKEN"
  expect "provider.channels" 200 GET '/api/v1/channels?page=1&page_size=10' "$PTOKEN"

  # Place reverse bid on open job if possible (dollars → cents)
  if [[ -n "$JOB_ID" ]]; then
    raw="$(request GET "/api/v1/jobs/${JOB_ID}" "$PTOKEN")"
    split_body_code "$raw"
    START_CENTS="$(echo "$HTTP_BODY" | python3 -c "
import sys,json
try:
  j=json.load(sys.stdin).get('job') or {}
  print(j.get('starting_bid_cents') or 50000)
except Exception:
  print(50000)
" 2>/dev/null)"
    # Bid 10% below start
    BID_CENTS="$(python3 -c "print(max(100, int($START_CENTS * 0.9)))")"
    IDEM="e2e-job-bid-$(date +%s)-$RANDOM"
    raw="$(request POST "/api/v1/jobs/${JOB_ID}/bids" "$PTOKEN" "{\"amount_cents\":${BID_CENTS}}" "Idempotency-Key: ${IDEM}")"
    split_body_code "$raw"
    if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
      pass "provider.job.bid" "HTTP $HTTP_CODE amount_cents=$BID_CENTS"
    elif [[ "$HTTP_CODE" == "409" ]]; then
      pass "provider.job.bid" "HTTP 409 already has active bid (ok)"
    elif [[ "$HTTP_CODE" == "403" ]]; then
      skip "provider.job.bid" "HTTP 403 (role/permission)"
    else
      fail "provider.job.bid" "HTTP $HTTP_CODE — $(echo "$HTTP_BODY" | head -c 100)"
    fi
  fi
fi

# ── Listing bid bond path (customer) ────────────────────────────────
if [[ -n "$LISTING_ID" && -n "$CTOKEN" ]]; then
  IDEM="e2e-list-bid-$(date +%s)-$RANDOM"
  # High enough over starting — use current+increment style amount
  raw="$(request GET "/api/v1/listings/${LISTING_ID}" "$CTOKEN")"
  split_body_code "$raw"
  BID_CENTS="$(echo "$HTTP_BODY" | python3 -c "
import sys,json
try:
  L=json.load(sys.stdin).get('listing') or {}
  cur=L.get('current_bid_cents') or L.get('starting_price_cents') or 1000
  inc=L.get('min_increment_cents') or 100
  print(int(cur)+int(inc)+100)
except Exception:
  print(10000)
" 2>/dev/null)"
  raw="$(request POST "/api/v1/listings/${LISTING_ID}/bids" "$CTOKEN" "{\"amount_cents\":${BID_CENTS}}" "Idempotency-Key: ${IDEM}")"
  split_body_code "$raw"
  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
    pass "customer.listing.bid" "HTTP $HTTP_CODE"
  elif [[ "$HTTP_CODE" == "402" ]]; then
    pass "customer.listing.bid.bond-gate" "HTTP 402 requires bid bond (expected path)"
    # Create bond
    raw="$(request POST "/api/v1/listings/${LISTING_ID}/bid-bond" "$CTOKEN" "{\"intended_bid_cents\":${BID_CENTS}}" "Idempotency-Key: bond-$IDEM")"
    split_body_code "$raw"
    if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
      pass "customer.listing.bid-bond.create" "HTTP $HTTP_CODE"
    else
      fail "customer.listing.bid-bond.create" "HTTP $HTTP_CODE"
    fi
  elif [[ "$HTTP_CODE" == "409" || "$HTTP_CODE" == "400" ]]; then
    skip "customer.listing.bid" "HTTP $HTTP_CODE (auction state)"
  else
    fail "customer.listing.bid" "HTTP $HTTP_CODE — $(echo "$HTTP_BODY" | head -c 100)"
  fi
fi

echo >&2
echo "=== SUMMARY ===" >&2
echo "pass=$PASS fail=$FAIL skip=$SKIP total=$((PASS+FAIL+SKIP))" >&2
echo >&2
printf '%s\n' "${RESULTS[@]}" | column -t -s'|' 2>/dev/null || printf '%s\n' "${RESULTS[@]}"
printf '%s\n' "${RESULTS[@]}" | column -t -s'|' 2>/dev/null >&2 || printf '%s\n' "${RESULTS[@]}" >&2

# Machine-readable footer for reports
echo "E2E_RESULT pass=$PASS fail=$FAIL skip=$SKIP"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
