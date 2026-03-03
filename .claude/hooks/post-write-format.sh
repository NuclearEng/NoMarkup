#!/bin/bash
# NoMarkup: Post-write auto-formatter
# Runs Prettier on written/edited files (if available)

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only format supported file types
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.css|*.scss|*.html|*.md)
    ;;
  *)
    exit 0
    ;;
esac

# Check if the file exists
if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Find project root (look for package.json)
DIR=$(dirname "$FILE_PATH")
PROJECT_ROOT=""
while [ "$DIR" != "/" ]; do
  if [ -f "$DIR/package.json" ]; then
    PROJECT_ROOT="$DIR"
    break
  fi
  DIR=$(dirname "$DIR")
done

# Try npx prettier if in a project, otherwise try global prettier
if [ -n "$PROJECT_ROOT" ] && [ -f "$PROJECT_ROOT/node_modules/.bin/prettier" ]; then
  "$PROJECT_ROOT/node_modules/.bin/prettier" --write "$FILE_PATH" 2>/dev/null
elif command -v prettier &>/dev/null; then
  prettier --write "$FILE_PATH" 2>/dev/null
fi

# Formatter is best-effort — never block on failure
exit 0
