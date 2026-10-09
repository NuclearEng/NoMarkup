#!/usr/bin/env bash
# check-go-coverage.sh — fail if go coverprofile total statements % is under a floor.
#
# Usage:
#   scripts/check-go-coverage.sh <coverprofile> <min_percent>
#
# Example (from gateway/ after tests wrote coverage.out):
#   ../scripts/check-go-coverage.sh coverage.out 12
#
# QA-02: practical CI gate (not the aspirational 80% in docs). Floors are
# ratchet-only — raise in CI after coverage improves; never lower without
# documenting a measured regression.
#
# Exit codes:
#   0 — coverage meets or exceeds min_percent
#   1 — under floor, missing profile, or unparseable total

set -euo pipefail

usage() {
  echo "usage: $0 <coverprofile> <min_percent>" >&2
  echo "  coverprofile  path from go test -coverprofile=..." >&2
  echo "  min_percent   integer or decimal floor (e.g. 12 or 40.0)" >&2
  exit 1
}

if [[ $# -ne 2 ]]; then
  usage
fi

PROFILE_ARG="$1"
MIN_RAW="$2"

if [[ ! -f "$PROFILE_ARG" ]]; then
  echo "::error::check-go-coverage: coverprofile not found: ${PROFILE_ARG}" >&2
  exit 1
fi

# Validate min is a non-negative number (integer or decimal).
if ! [[ "$MIN_RAW" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "::error::check-go-coverage: min_percent must be a non-negative number, got: ${MIN_RAW}" >&2
  exit 1
fi

# `go tool cover -func` resolves package paths via the nearest go.mod. Profiles
# are written with module-relative package names, so run from the profile dir
# (typically gateway/ or services/<svc>/ after `go test -coverprofile=...`).
PROFILE_ABS="$(cd "$(dirname "$PROFILE_ARG")" && pwd)/$(basename "$PROFILE_ARG")"
PROFILE_DIR="$(dirname "$PROFILE_ABS")"
PROFILE_BASE="$(basename "$PROFILE_ABS")"

# go tool cover -func prints a final line like:
#   total:                                          (statements)        15.2%
TOTAL_LINE="$(
  cd "$PROFILE_DIR"
  go tool cover -func="$PROFILE_BASE" | grep '^total:' || true
)"
if [[ -z "$TOTAL_LINE" ]]; then
  echo "::error::check-go-coverage: no 'total:' line in go tool cover -func ${PROFILE_ARG}" >&2
  exit 1
fi

# Extract the last field and strip trailing %
PCT_RAW="$(awk '{print $NF}' <<<"$TOTAL_LINE" | tr -d '%')"
if ! [[ "$PCT_RAW" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "::error::check-go-coverage: could not parse coverage percent from: ${TOTAL_LINE}" >&2
  exit 1
fi

# awk numeric compare (handles decimals)
PASS="$(awk -v pct="$PCT_RAW" -v min="$MIN_RAW" 'BEGIN { print (pct + 0 >= min + 0) ? "yes" : "no" }')"

echo "Go coverage total: ${PCT_RAW}% (floor ${MIN_RAW}%)"
echo "  profile: ${PROFILE_ABS}"
echo "  ${TOTAL_LINE}"

if [[ "$PASS" != "yes" ]]; then
  echo "::error::check-go-coverage: ${PCT_RAW}% < floor ${MIN_RAW}% — add tests or do not lower the floor without a measured reason (QA-02 ratchet)." >&2
  exit 1
fi

echo "Go coverage gate OK (${PCT_RAW}% ≥ ${MIN_RAW}%)"
exit 0
