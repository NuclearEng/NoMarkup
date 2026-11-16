#!/usr/bin/env bash
# Clear gateway auth (and local-IP) rate-limit counters in Redis so local login
# works after dense Playwright / dogfood runs trip TierAuth (5 attempts / 15 min).
#
# Usage: ./scripts/dev/clear-auth-rate-limit.sh
set -euo pipefail

REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
# redis-cli accepts -u for Redis URLs (redis-cli ≥6)
if redis-cli -u "$REDIS_URL" PING >/dev/null 2>&1; then
  CLI=(redis-cli -u "$REDIS_URL")
else
  CLI=(redis-cli)
fi

deleted=0
while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  "${CLI[@]}" DEL "$key" >/dev/null
  echo "deleted $key"
  deleted=$((deleted + 1))
done < <("${CLI[@]}" --scan --pattern 'nomarkup:rl:auth:*')

# Optional: also clear per-IP standard buckets on loopback (noisy e2e only)
if [[ "${CLEAR_ALL_IP_LIMITS:-}" == "1" ]]; then
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    "${CLI[@]}" DEL "$key" >/dev/null
    echo "deleted $key"
    deleted=$((deleted + 1))
  done < <("${CLI[@]}" --scan --pattern 'nomarkup:rl:*:ip:*')
fi

echo "cleared $deleted rate-limit key(s). Try signing in again."
