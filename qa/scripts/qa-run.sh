#!/usr/bin/env bash
# QA helper: login as a user and set cookie in browse tool.
# Usage: bash qa-run.sh <email>
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$DIR/qa-creds.env" ]; then
  echo "qa-creds.env not found. Copy qa-creds.env.example to qa-creds.env and fill in." >&2
  exit 1
fi
source "$DIR/qa-creds.env"
if [ -z "${QA_PASSWORD:-}" ]; then
  echo "QA_PASSWORD is not set. Check qa-creds.env (copy from qa-creds.env.example and fill in)." >&2
  exit 1
fi
EMAIL="$1"

# Login via API proxy
RESP=$(curl -s -c "$DIR/cookies.txt" -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$QA_PASSWORD\"}")

STATUS=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if 'access_token' in d else 'fail')" 2>/dev/null || echo "fail")
echo "$STATUS"
