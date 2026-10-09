#!/usr/bin/env bash
# FE-03 thin wrapper — implementation is check-no-raw-hex.mjs (Node, portable).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${SCRIPT_DIR}/check-no-raw-hex.mjs"
