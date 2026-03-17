#!/usr/bin/env bash
# QA login helper. Usage: bash qa-login.sh <email>
# Reads password from qa-creds.env, logs in, prints access token.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/qa-creds.env"
EMAIL="$1"
RESP=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$QA_PASSWORD\"}")
echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])"
