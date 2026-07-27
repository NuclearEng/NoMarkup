#!/usr/bin/env bash
# Sample public catalog API latency (p50 / p95) against a live gateway.
#
# Usage:
#   API_BASE=http://192.168.1.101:8081 SAMPLES=20 ./scripts/api-p95-sample.sh
#   ./scripts/api-p95-sample.sh --write-md docs/compliance/perf-gate-2026-07-26-samples.md
#
# Budget (showcase living checklist + Claude.md §8): public catalog p95 < 200ms.
set -euo pipefail

API_BASE="${API_BASE:-http://192.168.1.101:8081}"
API_BASE="${API_BASE%/}"
SAMPLES="${SAMPLES:-20}"
BUDGET_P95_MS="${BUDGET_P95_MS:-200}"
WRITE_MD=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --write-md)
      WRITE_MD="${2:-}"
      shift 2
      ;;
    --samples)
      SAMPLES="${2:-20}"
      shift 2
      ;;
    --base)
      API_BASE="${2%/}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

# Paths relative to API_BASE (no host). Query strings kept stable for cache-friendly GETs.
ENDPOINTS=(
  "/health"
  "/api/v1/jobs?page=1&page_size=20"
  "/api/v1/listings?page=1&page_size=20"
  "/api/v1/flags"
  "/api/v1/providers/search?page=1&page_size=20"
)

# Catalog endpoints subject to the p95 < 200ms public-catalog budget.
# /health is ops-only (reported, not budget-gated).
CATALOG_PATHS=(
  "/api/v1/jobs?page=1&page_size=20"
  "/api/v1/listings?page=1&page_size=20"
  "/api/v1/flags"
  "/api/v1/providers/search?page=1&page_size=20"
)

is_catalog() {
  local p="$1"
  local c
  for c in "${CATALOG_PATHS[@]}"; do
    [[ "$p" == "$c" ]] && return 0
  done
  return 1
}

# percentile_ms sorted_ms_list index(0-based) → prints ms at that index (clamped).
percentile_at() {
  local idx="$1"
  shift
  local -a vals=("$@")
  local n=${#vals[@]}
  if [[ $n -eq 0 ]]; then
    echo "na"
    return
  fi
  if [[ $idx -lt 0 ]]; then idx=0; fi
  if [[ $idx -ge $n ]]; then idx=$((n - 1)); fi
  echo "${vals[$idx]}"
}

# p50 = vals[floor(0.50*(n-1))], p95 = vals[floor(0.95*(n-1))] on sorted list.
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

sample_endpoint() {
  local path="$1"
  local url="${API_BASE}${path}"
  local -a times=()
  local -a codes=()
  local i code t_ms
  local fail=0

  for ((i = 1; i <= SAMPLES; i++)); do
    # time_total is whole seconds as float; convert to ms.
    # On transport failure curl exits non-zero — capture with || true.
    local out
    out="$(curl -sS -o /dev/null -m 15 \
      -w '%{http_code} %{time_total}' \
      "$url" 2>/dev/null || echo "000 0")"
    code="$(echo "$out" | awk '{print $1}')"
    t_ms="$(echo "$out" | awk '{printf "%.0f", ($2 + 0) * 1000}')"
    codes+=("$code")
    times+=("$t_ms")
    if [[ "$code" != "200" && "$code" != "204" ]]; then
      fail=$((fail + 1))
    fi
  done

  compute_p50_p95 "${times[@]}"
  SAMPLE_TIMES=("${times[@]}")
  SAMPLE_CODES=("${codes[@]}")
  SAMPLE_FAILS=$fail
  # Prefer last non-000 code for reporting; fall back to first.
  SAMPLE_HTTP="${codes[$((SAMPLES - 1))]}"
  # If any sample succeeded, note majority code.
  local c
  SAMPLE_HTTP="$(printf '%s\n' "${codes[@]}" | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')"
}

echo "=== NoMarkup API p50/p95 sample ==="
echo "API_BASE=$API_BASE"
echo "SAMPLES=$SAMPLES"
echo "BUDGET_P95_MS=${BUDGET_P95_MS} (catalog endpoints)"
echo "WHEN=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

printf '%-42s %6s %8s %8s %8s %8s %6s %s\n' \
  "PATH" "HTTP" "p50_ms" "p95_ms" "min_ms" "max_ms" "fails" "budget"
printf '%-42s %6s %8s %8s %8s %8s %6s %s\n' \
  "------------------------------------------" "------" "--------" "--------" "--------" "--------" "------" "------"

MD_ROWS=()
OVERALL_PASS=1

for path in "${ENDPOINTS[@]}"; do
  sample_endpoint "$path"
  budget_note="n/a"
  row_pass="—"
  if is_catalog "$path"; then
    if [[ "$SAMPLE_FAILS" -gt 0 ]]; then
      budget_note="FAIL(http)"
      row_pass="FAIL"
      OVERALL_PASS=0
    elif [[ "$P95_MS" =~ ^[0-9]+$ ]] && [[ "$P95_MS" -lt "$BUDGET_P95_MS" ]]; then
      budget_note="PASS"
      row_pass="PASS"
    else
      budget_note="FAIL(>p95)"
      row_pass="FAIL"
      OVERALL_PASS=0
    fi
  fi

  printf '%-42s %6s %8s %8s %8s %8s %6s %s\n' \
    "$path" "$SAMPLE_HTTP" "$P50_MS" "$P95_MS" "$MIN_MS" "$MAX_MS" "$SAMPLE_FAILS" "$budget_note"

  # Markdown table row (escape pipes in path — none expected).
  MD_ROWS+=("| \`$path\` | $SAMPLE_HTTP | $P50_MS | $P95_MS | $MIN_MS | $MAX_MS | $SAMPLE_FAILS | $row_pass |")
done

echo
if [[ $OVERALL_PASS -eq 1 ]]; then
  echo "OVERALL catalog p95 budget (< ${BUDGET_P95_MS}ms): PASS"
else
  echo "OVERALL catalog p95 budget (< ${BUDGET_P95_MS}ms): FAIL"
fi

OVERALL_LABEL=$([[ $OVERALL_PASS -eq 1 ]] && echo PASS || echo FAIL)
WHEN_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [[ -n "$WRITE_MD" ]]; then
  mkdir -p "$(dirname "$WRITE_MD")"
  {
    echo "# API p50/p95 sample results"
    echo
    echo "- **When (UTC):** $WHEN_UTC"
    echo "- **API_BASE:** \`$API_BASE\`"
    echo "- **Samples per path:** $SAMPLES"
    echo "- **Budget:** catalog p95 < ${BUDGET_P95_MS} ms"
    echo "- **Method:** \`curl -o /dev/null -w '%{http_code} %{time_total}'\` sequential, client-side total time"
    echo "- **Overall catalog budget:** $OVERALL_LABEL"
    echo
    echo "| Path | HTTP (mode) | p50 ms | p95 ms | min ms | max ms | non-2xx | Budget |"
    echo "|------|-------------|--------|--------|--------|--------|---------|--------|"
    for row in "${MD_ROWS[@]}"; do
      echo "$row"
    done
    echo
    echo "Percentiles: sorted sample list; index = floor(q × (n−1)) for q ∈ {0.50, 0.95}."
  } >"$WRITE_MD"
  echo "Wrote $WRITE_MD"
fi

# Optional: patch the showcase perf-gate doc live-results section when present.
PERF_GATE="${PERF_GATE_MD:-docs/compliance/perf-gate-2026-07-26.md}"
if [[ -f "$PERF_GATE" ]]; then
  # Build a fenced results block for inclusion.
  RESULTS_BLOCK=$(mktemp)
  {
    echo "#### Captured sample ($WHEN_UTC)"
    echo
    echo "- **API_BASE:** \`$API_BASE\`"
    echo "- **Samples:** $SAMPLES"
    echo "- **Overall catalog budget:** **$OVERALL_LABEL**"
    echo
    echo "| Path | HTTP (mode) | p50 ms | p95 ms | min ms | max ms | non-2xx | Budget (&lt;200 ms p95) |"
    echo "|------|-------------|--------|--------|--------|--------|---------|-------------------------|"
    for row in "${MD_ROWS[@]}"; do
      echo "$row"
    done
  } >"$RESULTS_BLOCK"

  # Replace between markers if present; otherwise leave file alone.
  if grep -q '<!-- PERF_SAMPLE_START -->' "$PERF_GATE" && grep -q '<!-- PERF_SAMPLE_END -->' "$PERF_GATE"; then
    awk -v blockfile="$RESULTS_BLOCK" '
      /<!-- PERF_SAMPLE_START -->/ {
        print
        while ((getline line < blockfile) > 0) print line
        close(blockfile)
        skip=1
        next
      }
      /<!-- PERF_SAMPLE_END -->/ { skip=0; print; next }
      !skip { print }
    ' "$PERF_GATE" >"${PERF_GATE}.tmp" && mv "${PERF_GATE}.tmp" "$PERF_GATE"
    echo "Patched live sample into $PERF_GATE"
  fi
  rm -f "$RESULTS_BLOCK"
fi

exit $((1 - OVERALL_PASS))
