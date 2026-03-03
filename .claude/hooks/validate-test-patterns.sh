#!/bin/bash
# NoMarkup: Pre-write test pattern validator
# Enforces test quality standards and patterns

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check test files
case "$FILE_PATH" in
  *__tests__*|*.test.*|*.spec.*)
    ;;
  *)
    exit 0
    ;;
esac

# === BLOCK: Empty test bodies ===

if echo "$CONTENT" | grep -qE "it\(['\"].*['\"],\s*\(\)\s*=>\s*\{\s*\}\)"; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "BLOCKED: Empty test body detected. Tests must contain assertions. Use expect() to verify behavior."
    }
  }'
  exit 0
fi

# === BLOCK: test.skip / it.skip / describe.skip without TODO ===

if echo "$CONTENT" | grep -qE '\.(skip|todo)\('; then
  if ! echo "$CONTENT" | grep -qE '// TODO|// FIXME|// HACK'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Skipped test detected without a TODO comment explaining why. Add a // TODO comment or remove the .skip."
      }
    }'
    exit 0
  fi
fi

# === ENFORCE: Test files must have at least one expect() ===

HAS_TEST=$(echo "$CONTENT" | grep -cE "it\(|test\(")
HAS_EXPECT=$(echo "$CONTENT" | grep -cE "expect\(|assert\.|should\.")

if [ "$HAS_TEST" -gt 0 ] && [ "$HAS_EXPECT" -eq 0 ]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "BLOCKED: Test file has test cases but no assertions (expect/assert). Every test must verify expected behavior."
    }
  }'
  exit 0
fi

# === ENFORCE: No hardcoded test data that looks like production ===

if echo "$CONTENT" | grep -qE '@(gmail|yahoo|hotmail|outlook)\.com|555-\d{4}|123.*Main.*St'; then
  if ! echo "$CONTENT" | grep -qiE 'faker|mock|fixture|factory|test.*data|@example\.com'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Test data looks like real contact info. Use @example.com for emails and faker/factories for test data generation."
      }
    }'
    exit 0
  fi
fi

exit 0
