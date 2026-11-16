#!/usr/bin/env bash
# QA login helper. Usage: bash qa-login.sh <email>
# Reads password from qa-creds.env, logs in, prints access token.
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
RESP=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$QA_PASSWORD\"}")
echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])"
