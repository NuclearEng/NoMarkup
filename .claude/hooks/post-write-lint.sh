#!/bin/bash
# NoMarkup: Post-write linter
# Runs ESLint on TypeScript/JavaScript files after write/edit

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only lint TS/JS files
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx)
    ;;
  *)
    exit 0
    ;;
esac

if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Find project root
DIR=$(dirname "$FILE_PATH")
PROJECT_ROOT=""
while [ "$DIR" != "/" ]; do
  if [ -f "$DIR/package.json" ]; then
    PROJECT_ROOT="$DIR"
    break
  fi
  DIR=$(dirname "$DIR")
done

# Run ESLint if available
LINT_OUTPUT=""
if [ -n "$PROJECT_ROOT" ] && [ -f "$PROJECT_ROOT/node_modules/.bin/eslint" ]; then
  LINT_OUTPUT=$("$PROJECT_ROOT/node_modules/.bin/eslint" --no-error-on-unmatched-pattern --format compact "$FILE_PATH" 2>&1)
  LINT_EXIT=$?
elif command -v eslint &>/dev/null; then
  LINT_OUTPUT=$(eslint --no-error-on-unmatched-pattern --format compact "$FILE_PATH" 2>&1)
  LINT_EXIT=$?
else
  # No linter available — skip
  exit 0
fi

# If there are errors, surface them but don't block
if [ $LINT_EXIT -ne 0 ] && [ -n "$LINT_OUTPUT" ]; then
  # Filter to just error lines (not warnings about config)
  ERROR_LINES=$(echo "$LINT_OUTPUT" | grep -E "Error|error" | head -10)
  if [ -n "$ERROR_LINES" ]; then
    echo "ESLint issues detected in $FILE_PATH:"
    echo "$ERROR_LINES"
  fi
fi

# Post-write hooks should not block
exit 0
