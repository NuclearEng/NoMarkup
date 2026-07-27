#!/usr/bin/env bash
# Measure TTFB / CDN-ish JSON latency for public gateway catalog endpoints.
#
# Uses curl -w timing (time_starttransfer = TTFB) plus selected cache headers
# (Cache-Control, Age, ETag, CF-Cache-Status, X-Cache) so you can see whether
# a response looks origin-served vs edge-cached.
#
# This is an **artifact recipe**, not live CDN proof. Default BASE_URL is local
# gateway smoke. Point BASE_URL at a public edge URL for CDN numbers; commit or
# archive the markdown output when you need evidence.
#
# Usage:
#   ./scripts/cdn-ttfb-sample.sh
#   BASE_URL=http://127.0.0.1:8080 SAMPLES=20 ./scripts/cdn-ttfb-sample.sh
#   BASE_URL=https://api.example.com ./scripts/cdn-ttfb-sample.sh --write-md /tmp/cdn-ttfb.md
#   ./scripts/cdn-ttfb-sample.sh --base http://localhost:8080 --path /api/v1/pricing
#   ./scripts/cdn-ttfb-sample.sh --base http://localhost:8080 --path /api/v1/markets --samples 30
#
# Env / flags:
#   BASE_URL / --base     Origin or CDN base (default: http://127.0.0.1:8080)
#   SAMPLES / --samples   Requests per path (default: 20)
#   PATHS / --path        Repeatable; default: /api/v1/pricing /api/v1/markets
#   BUDGET_TTFB_MS        Soft budget for p95 TTFB (default: 100; report only)
#   --write-md FILE       Write a markdown results artifact
#   --warm N              Discard first N samples per path (default: 1) for cold-edge noise
#   -h / --help           This header
#
# Companion: scripts/api-p95-sample.sh samples catalog p50/p95 total latency (LAN gate).
# This script focuses on time_starttransfer (TTFB) + cache-header visibility.
#
# Requires: bash, curl, awk, sort, date. Portable on bash 3.2+ (macOS).
# No secrets: public GETs only; do not pass auth headers here.
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
BASE_URL="${BASE_URL%/}"
SAMPLES="${SAMPLES:-20}"
BUDGET_TTFB_MS="${BUDGET_TTFB_MS:-100}"
WARM="${WARM:-1}"
WRITE_MD=""
# Default public JSON paths (writeCachedJSON / catalog DATA layer).
PATHS=()
PATHS_FROM_CLI=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --write-md)
      WRITE_MD="${2:-}"
      if [[ -z "$WRITE_MD" ]]; then
        echo "error: --write-md requires a file path" >&2
        exit 2
      fi
      shift 2
      ;;
    --samples)
      SAMPLES="${2:-20}"
      shift 2
      ;;
    --base)
      BASE_URL="${2%/}"
      shift 2
      ;;
    --path)
      if [[ -z "${2:-}" ]]; then
        echo "error: --path requires a path" >&2
        exit 2
      fi
      PATHS+=("$2")
      PATHS_FROM_CLI=1
      shift 2
      ;;
    --warm)
      WARM="${2:-1}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,35p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$PATHS_FROM_CLI" -eq 0 ]]; then
  if [[ -n "${PATHS_ENV:-}" ]]; then
    # Optional space-separated PATHS_ENV for non-interactive use.
    # shellcheck disable=SC2206
    PATHS=($PATHS_ENV)
  else
    PATHS=(
      "/api/v1/pricing"
      "/api/v1/markets"
    )
  fi
fi

if ! [[ "$SAMPLES" =~ ^[0-9]+$ ]] || [[ "$SAMPLES" -lt 1 ]]; then
  echo "error: SAMPLES must be a positive integer" >&2
  exit 2
fi
if ! [[ "$WARM" =~ ^[0-9]+$ ]]; then
  echo "error: WARM must be a non-negative integer" >&2
  exit 2
fi

# percentile_at index sorted_ms... → value at index (clamped)
percentile_at() {
  local idx="$1"
  shift
  # bash 3.2: no namerefs; rebuild array from remaining args
  local n=$#
  if [[ $n -eq 0 ]]; then
    echo "na"
    return
  fi
  if [[ $idx -lt 0 ]]; then idx=0; fi
  if [[ $idx -ge $n ]]; then idx=$((n - 1)); fi
  # 1-based positional for bash: shift idx then echo $1
  shift "$idx"
  echo "$1"
}

compute_p50_p95() {
  local -a raw=("$@")
  local -a sorted
  # shellcheck disable=SC2207
  sorted=($(printf '%s\n' "${raw[@]}" | sort -n))
  local n=${#sorted[@]}
  local p50_idx p95_idx
  p50_idx=$(awk -v n="$n" 'BEGIN { printf "%d", int(0.50 * (n - 1)) }')
  p95_idx=$(awk -v n="$n" 'BEGIN { printf "%d", int(0.95 * (n - 1)) }')
  P50_MS="$(percentile_at "$p50_idx" "${sorted[@]}")"
  P95_MS="$(percentile_at "$p95_idx" "${sorted[@]}")"
  MIN_MS="${sorted[0]}"
  MAX_MS="${sorted[$((n - 1))]}"
}

# One curl sample: prints
#   http_code ttfb_ms total_ms namelookup_ms connect_ms appconnect_ms cache_control age etag cf_status x_cache
# Fields after timings may contain spaces — we use SOH separators in -w where needed is hard;
# instead pull headers via -D and timings via -w separately for reliability.
# header_value FILE Name → first matching header value (case-insensitive; BSD/gawk)
header_value() {
  local file="$1"
  local name="$2"
  awk -v want="$name" '
    {
      line = $0
      sub(/\r$/, "", line)
      colon = index(line, ":")
      if (colon < 1) next
      key = substr(line, 1, colon - 1)
      if (tolower(key) == tolower(want)) {
        val = substr(line, colon + 1)
        sub(/^[[:space:]]+/, "", val)
        print val
        exit
      }
    }
  ' "$file" 2>/dev/null || true
}

sample_once() {
  local url="$1"
  local hdr body_discard out
  local t_starttransfer t_total
  local cache_control age etag cf_status x_cache
  local code

  hdr="$(mktemp "${TMPDIR:-/tmp}/cdn-ttfb-hdr.XXXXXX")"
  body_discard="$(mktemp "${TMPDIR:-/tmp}/cdn-ttfb-body.XXXXXX")"

  out="$(curl -sS -o "$body_discard" -D "$hdr" -m 20 \
    -w '%{http_code} %{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total}' \
    -H 'Accept: application/json' \
    "$url" 2>/dev/null || echo "000 0 0 0 0 0")"

  code="$(echo "$out" | awk '{print $1}')"
  # Columns: code namelookup connect appconnect starttransfer total (seconds → ms)
  t_starttransfer="$(echo "$out" | awk '{printf "%.0f", ($5 + 0) * 1000}')"
  t_total="$(echo "$out" | awk '{printf "%.0f", ($6 + 0) * 1000}')"

  cache_control="$(header_value "$hdr" "Cache-Control")"
  age="$(header_value "$hdr" "Age")"
  etag="$(header_value "$hdr" "ETag")"
  cf_status="$(header_value "$hdr" "CF-Cache-Status")"
  x_cache="$(header_value "$hdr" "X-Cache")"

  rm -f "$hdr" "$body_discard"

  # Pipe-safe single line for later parsing (replace | in header values).
  cache_control="$(printf '%s' "$cache_control" | tr '|' ' ')"
  age="$(printf '%s' "$age" | tr '|' ' ')"
  etag="$(printf '%s' "$etag" | tr '|' ' ')"
  cf_status="$(printf '%s' "$cf_status" | tr '|' ' ')"
  x_cache="$(printf '%s' "$x_cache" | tr '|' ' ')"

  [[ -n "$cache_control" ]] || cache_control="-"
  [[ -n "$age" ]] || age="-"
  [[ -n "$etag" ]] || etag="-"
  [[ -n "$cf_status" ]] || cf_status="-"
  [[ -n "$x_cache" ]] || x_cache="-"

  # Fields: code|ttfb_ms|total_ms|cache_control|age|etag|cf_status|x_cache
  printf '%s|%s|%s|%s|%s|%s|%s|%s\n' \
    "$code" "$t_starttransfer" "$t_total" \
    "$cache_control" "$age" "$etag" "$cf_status" "$x_cache"
}

sample_endpoint() {
  local path="$1"
  local url="${BASE_URL}${path}"
  local -a ttfb_times=()
  local -a total_times=()
  local -a codes=()
  local i line code ttfb total
  local fail=0
  local last_cache="-" last_age="-" last_etag="-" last_cf="-" last_xcache="-"
  local total_iters=$((SAMPLES + WARM))

  for ((i = 1; i <= total_iters; i++)); do
    line="$(sample_once "$url")"
    # Fields: code|ttfb_ms|total_ms|cache_control|age|etag|cf_status|x_cache
    code="$(echo "$line" | awk -F'|' '{print $1}')"
    ttfb="$(echo "$line" | awk -F'|' '{print $2}')"
    total="$(echo "$line" | awk -F'|' '{print $3}')"
    last_cache="$(echo "$line" | awk -F'|' '{print $4}')"
    last_age="$(echo "$line" | awk -F'|' '{print $5}')"
    last_etag="$(echo "$line" | awk -F'|' '{print $6}')"
    last_cf="$(echo "$line" | awk -F'|' '{print $7}')"
    last_xcache="$(echo "$line" | awk -F'|' '{print $8}')"

    if [[ $i -le $WARM ]]; then
      continue
    fi

    codes+=("$code")
    ttfb_times+=("$ttfb")
    total_times+=("$total")
    if [[ "$code" != "200" && "$code" != "204" && "$code" != "304" ]]; then
      fail=$((fail + 1))
    fi
  done

  compute_p50_p95 "${ttfb_times[@]}"
  TTFB_P50="$P50_MS"
  TTFB_P95="$P95_MS"
  TTFB_MIN="$MIN_MS"
  TTFB_MAX="$MAX_MS"

  compute_p50_p95 "${total_times[@]}"
  TOTAL_P50="$P50_MS"
  TOTAL_P95="$P95_MS"

  SAMPLE_FAILS=$fail
  SAMPLE_HTTP="$(printf '%s\n' "${codes[@]}" | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')"
  SAMPLE_CACHE="$last_cache"
  SAMPLE_AGE="$last_age"
  SAMPLE_ETAG="$last_etag"
  SAMPLE_CF="$last_cf"
  SAMPLE_XCACHE="$last_xcache"
}

WHEN_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "=== NoMarkup CDN / TTFB JSON sample ==="
echo "BASE_URL=$BASE_URL"
echo "SAMPLES=$SAMPLES (warm discard=$WARM)"
echo "BUDGET_TTFB_MS=${BUDGET_TTFB_MS} (soft report only; not CI gate)"
echo "WHEN=$WHEN_UTC"
echo "NOTE=artifact recipe — local default is not CDN proof"
echo

printf '%-28s %6s %8s %8s %8s %8s %8s %6s  %s\n' \
  "PATH" "HTTP" "ttfb_p50" "ttfb_p95" "ttfb_min" "ttfb_max" "tot_p95" "fails" "cache (last sample)"
printf '%-28s %6s %8s %8s %8s %8s %8s %6s  %s\n' \
  "----------------------------" "------" "--------" "--------" "--------" "--------" "--------" "------" "-------------------"

MD_ROWS=()
OVERALL_PASS=1

for path in "${PATHS[@]}"; do
  sample_endpoint "$path"

  budget_note="ok"
  if [[ "$SAMPLE_FAILS" -gt 0 ]]; then
    budget_note="FAIL(http)"
    OVERALL_PASS=0
  elif [[ "$TTFB_P95" =~ ^[0-9]+$ ]] && [[ "$TTFB_P95" -gt "$BUDGET_TTFB_MS" ]]; then
    # Soft: note over-budget but do not fail overall on local origin (expected).
    budget_note="over_budget"
  fi

  cache_summ="$SAMPLE_CACHE"
  if [[ "$SAMPLE_CF" != "-" ]]; then
    cache_summ="${cache_summ}; CF=${SAMPLE_CF}"
  fi
  if [[ "$SAMPLE_XCACHE" != "-" ]]; then
    cache_summ="${cache_summ}; X-Cache=${SAMPLE_XCACHE}"
  fi
  if [[ "$SAMPLE_AGE" != "-" ]]; then
    cache_summ="${cache_summ}; Age=${SAMPLE_AGE}"
  fi

  # Truncate long Cache-Control for terminal width.
  cache_disp="$cache_summ"
  if [[ ${#cache_disp} -gt 48 ]]; then
    cache_disp="${cache_disp:0:45}..."
  fi

  printf '%-28s %6s %8s %8s %8s %8s %8s %6s  %s\n' \
    "$path" "$SAMPLE_HTTP" "$TTFB_P50" "$TTFB_P95" "$TTFB_MIN" "$TTFB_MAX" \
    "$TOTAL_P95" "$SAMPLE_FAILS" "$cache_disp ($budget_note)"

  MD_ROWS+=("| \`$path\` | $SAMPLE_HTTP | $TTFB_P50 | $TTFB_P95 | $TTFB_MIN | $TTFB_MAX | $TOTAL_P95 | $SAMPLE_FAILS | \`$SAMPLE_CACHE\` | $SAMPLE_AGE | $SAMPLE_ETAG | $SAMPLE_CF | $SAMPLE_XCACHE | $budget_note |")
done

echo
echo "Timing: curl -w time_starttransfer (TTFB) / time_total; units ms (rounded)."
echo "Headers: last-sample Cache-Control, Age, ETag, CF-Cache-Status, X-Cache."
echo "Percentiles: sorted samples; index = floor(q × (n−1)) for q ∈ {0.50, 0.95}."
if [[ $OVERALL_PASS -eq 1 ]]; then
  echo "HTTP health: PASS (all samples 200/204/304 on kept iterations)"
else
  echo "HTTP health: FAIL (non-success status in samples)"
fi

if [[ -n "$WRITE_MD" ]]; then
  mkdir -p "$(dirname "$WRITE_MD")"
  {
    echo "# CDN / TTFB JSON sample results"
    echo
    echo "- **When (UTC):** $WHEN_UTC"
    echo "- **BASE_URL:** \`$BASE_URL\`"
    echo "- **Samples per path:** $SAMPLES (warm discard: $WARM)"
    echo "- **Soft TTFB p95 budget:** ${BUDGET_TTFB_MS} ms (report only; local origin often exceeds edge target)"
    echo "- **Method:** \`curl -o /dev/null -D headers -w '%{http_code} %{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total}'\`"
    echo "- **Scope:** artifact recipe — not automatic live CDN proof or CI gate"
    echo
    echo "| Path | HTTP (mode) | TTFB p50 | TTFB p95 | TTFB min | TTFB max | Total p95 | non-2xx | Cache-Control | Age | ETag | CF-Cache-Status | X-Cache | Note |"
    echo "|------|-------------|----------|----------|----------|----------|-----------|---------|---------------|-----|------|-----------------|---------|------|"
    for row in "${MD_ROWS[@]}"; do
      echo "$row"
    done
    echo
    echo "Percentiles: sorted sample list; index = floor(q × (n−1)) for q ∈ {0.50, 0.95}."
    echo
    echo "To measure edge/CDN: set \`BASE_URL\` to the public API host behind Cloudflare (or other CDN)"
    echo "and re-run; look for \`CF-Cache-Status: HIT\` / low Age / TTFB under the DATA TTFB target."
  } >"$WRITE_MD"
  echo "Wrote $WRITE_MD"
fi

exit $((1 - OVERALL_PASS))
