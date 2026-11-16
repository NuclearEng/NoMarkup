#!/usr/bin/env bash
# Cancel draft jobs for the seed customer when the 10-draft cap blocks POST /jobs.
# Usage: ./scripts/dev/free-customer-draft-capacity.sh [base_url] [max_cancel]
set -euo pipefail
BASE="${1:-http://127.0.0.1:8081}"
MAX_CANCEL="${2:-5}"
EMAIL="${NOMARKUP_SEED_CUSTOMER_EMAIL:-customer@nomarkup.com}"
PASSWORD="${NOMARKUP_SEED_PASSWORD:-Password123!}"

login=$(curl -sS -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
token=$(printf '%s' "$login" | python3 -c 'import json,sys; j=json.load(sys.stdin); print(j.get("access_token") or (j.get("data") or {}).get("access_token") or "")')
if [[ -z "$token" ]]; then
  echo "login failed: $login" >&2
  exit 1
fi

auth=(-H "Authorization: Bearer $token" -H 'Content-Type: application/json')

# Prefer drafts endpoint when present; fall back to jobs/mine?status=draft
drafts_json=$(curl -sS "$BASE/api/v1/jobs/drafts?page=1&page_size=50" "${auth[@]}" || true)
if ! printf '%s' "$drafts_json" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
  drafts_json=$(curl -sS "$BASE/api/v1/jobs/mine?page=1&page_size=50&status=draft" "${auth[@]}" || true)
fi

ids=$(printf '%s' "$drafts_json" | python3 -c "
import json,sys
cap=int(sys.argv[1])
try:
    j=json.load(sys.stdin)
except Exception:
    print('')
    raise SystemExit(0)
jobs=j.get('jobs') or j.get('data') or []
if isinstance(jobs, dict):
    jobs=jobs.get('jobs') or []
ids=[]
for job in jobs:
    if not isinstance(job, dict):
        continue
    i=job.get('id')
    if not i:
        continue
    st=(job.get('status') or '').lower()
    if st in ('draft','') or job.get('is_draft') is True or st == 'draft':
        ids.append(i)
    if len(ids)>=cap:
        break
# If status filter already returned drafts, take first N ids.
if not ids:
    ids=[x['id'] for x in jobs if isinstance(x,dict) and x.get('id')][:cap]
print(' '.join(ids))
" "$MAX_CANCEL")

if [[ -z "${ids// }" ]]; then
  echo "no draft ids found to cancel"
  exit 0
fi

cancelled=0
for id in $ids; do
  code=$(curl -sS -o /tmp/cancel-draft.out -w '%{http_code}' -X POST "$BASE/api/v1/jobs/$id/cancel" \
    "${auth[@]}" -d '{}')
  echo "cancel $id -> $code"
  if [[ "$code" == "200" || "$code" == "204" ]]; then
    cancelled=$((cancelled+1))
  fi
done
echo "cancelled=$cancelled (attempted max=$MAX_CANCEL)"
