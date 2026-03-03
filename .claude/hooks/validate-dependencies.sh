#!/bin/bash
# NoMarkup: Pre-write dependency validator
# Blocks unapproved or dangerous package additions

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

BASENAME=$(basename "$FILE_PATH")

# Only check package.json writes
if [ "$BASENAME" != "package.json" ]; then
  exit 0
fi

# === BLOCK: Known dangerous or deprecated packages ===

BLOCKED_PACKAGES=(
  "event-stream"
  "flatmap-stream"
  "ua-parser-js"
  "coa"
  "rc"
  "colors"
  "faker"
  "request"
  "node-ipc"
  "node-fetch"
)

for pkg in "${BLOCKED_PACKAGES[@]}"; do
  if echo "$CONTENT" | grep -q "\"$pkg\""; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED: Package \"'"$pkg"'\" is deprecated, compromised, or has known vulnerabilities. Use an alternative."
      }
    }'
    exit 0
  fi
done

# === WARN: Packages that need review ===

REVIEW_PACKAGES=(
  "eval"
  "vm2"
  "child_process"
  "shelljs"
  "exec"
)

for pkg in "${REVIEW_PACKAGES[@]}"; do
  if echo "$CONTENT" | grep -q "\"$pkg\""; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Package \"'"$pkg"'\" can execute arbitrary code. Confirm this is intentional."
      }
    }'
    exit 0
  fi
done

exit 0
