#!/usr/bin/env bash
# Fail on duplicate migration version numbers in database/migrations/*_*.up.sql.
# Also fail when the numeric sequence has gaps between min and max (prevents
# two branches inventing the same next NNN after a merge).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${ROOT}/database/migrations"

if [ ! -d "$DIR" ]; then
  echo "error: migrations directory not found: $DIR" >&2
  exit 1
fi

# Portable: no mapfile / bash-4-only features (macOS ships bash 3.2).
ups=$(find "$DIR" -maxdepth 1 -type f -name '*_*.up.sql' | LC_ALL=C sort)
if [ -z "$ups" ]; then
  echo "error: no *.up.sql migrations under $DIR" >&2
  exit 1
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

echo "$ups" | while IFS= read -r f; do
  base=$(basename "$f")
  case "$base" in
    [0-9]*_*.up.sql) ;;
    *)
      echo "error: migration filename must be NNN_name.up.sql: $base" >&2
      exit 1
      ;;
  esac
  n=$(printf '%s' "$base" | sed -E 's/^([0-9]+)_.*/\1/')
  printf '%s\t%s\n' "$n" "$base"
done >"$tmp"

# Duplicates: same version key more than once
dups=$(cut -f1 "$tmp" | sort | uniq -d)
if [ -n "$dups" ]; then
  echo "error: duplicate migration version(s):" >&2
  echo "$dups" | while IFS= read -r n; do
    echo "  - $n:" >&2
    awk -F'\t' -v n="$n" '$1==n { print "      " $2 }' "$tmp" >&2
  done
  exit 1
fi

# Contiguity min..max (decimal)
nums=$(cut -f1 "$tmp" | sed 's/^0*//' | sed 's/^$/0/' | sort -n)
min=$(echo "$nums" | head -1)
max=$(echo "$nums" | tail -1)
count=$(echo "$nums" | wc -l | tr -d ' ')
expected=$((max - min + 1))

if [ "$count" -ne "$expected" ]; then
  echo "error: migration sequence has gaps between $min and $max (have $count, expect $expected)" >&2
  # List missing
  have=$(mktemp)
  echo "$nums" >"$have"
  i=$min
  while [ "$i" -le "$max" ]; do
    if ! grep -qx "$i" "$have"; then
      echo "  missing: $i" >&2
    fi
    i=$((i + 1))
  done
  rm -f "$have"
  exit 1
fi

echo "ok: $count migrations, versions $min..$max contiguous, no duplicates"
