#!/bin/bash
# NoMarkup: Pre-write React/Next.js pattern validator
# Enforces component patterns, accessibility, and Next.js conventions

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check TSX/JSX files
case "$FILE_PATH" in
  *.tsx|*.jsx)
    ;;
  *)
    exit 0
    ;;
esac

# === ENFORCE: Images must use Next.js Image component ===

if echo "$CONTENT" | grep -qE '<img\s'; then
  # Allow in email templates or static HTML
  if [[ "$FILE_PATH" != *"email"* && "$FILE_PATH" != *"static"* ]]; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED: Raw <img> tag detected. Use Next.js Image component (next/image) for automatic optimization, lazy loading, and responsive images."
      }
    }'
    exit 0
  fi
fi

# === ENFORCE: Links must use Next.js Link component ===

if echo "$CONTENT" | grep -qE '<a\s+href='; then
  # Allow external links and anchor links
  HAS_EXTERNAL=$(echo "$CONTENT" | grep -cE '<a\s+href="(https?://|mailto:|tel:|#)')
  HAS_ALL_A=$(echo "$CONTENT" | grep -cE '<a\s+href=')
  if [ "$HAS_ALL_A" -gt "$HAS_EXTERNAL" ]; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Internal <a href> detected. Use Next.js Link component for client-side navigation. External links with <a> are fine."
      }
    }'
    exit 0
  fi
fi

# === ENFORCE: Accessibility - interactive elements need labels ===

# Buttons without text content or aria-label
if echo "$CONTENT" | grep -qE '<button[^>]*>\s*<(svg|img|icon)'; then
  if ! echo "$CONTENT" | grep -qE 'aria-label|aria-labelledby|sr-only'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED: Icon-only button without accessible label. Add aria-label or include sr-only text for screen readers."
      }
    }'
    exit 0
  fi
fi

# Form inputs without labels
if echo "$CONTENT" | grep -qE '<input\s'; then
  if ! echo "$CONTENT" | grep -qE '<label|aria-label|aria-labelledby|htmlFor|placeholder'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Form <input> without associated <label> or aria-label. Add a label for accessibility."
      }
    }'
    exit 0
  fi
fi

# === ENFORCE: No inline styles (use Tailwind) ===

if echo "$CONTENT" | grep -qE 'style=\{\{'; then
  # Allow dynamic styles that can't be done with Tailwind (e.g., computed positions)
  if ! echo "$CONTENT" | grep -qE 'style=\{\{.*(transform|position|top|left|width|height|animation).*\}\}'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Inline styles detected. Use Tailwind CSS classes instead. Inline styles are only acceptable for dynamic values (computed positions, animations)."
      }
    }'
    exit 0
  fi
fi

# === ENFORCE: useEffect must have dependency array ===

if echo "$CONTENT" | grep -qE 'useEffect\s*\(\s*\(\)\s*=>\s*\{' | grep -v 'useEffect.*\['; then
  # This is a rough check — look for useEffect without [] nearby
  EFFECTS=$(echo "$CONTENT" | grep -n 'useEffect')
  if echo "$EFFECTS" | grep -qv '\['; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "useEffect without dependency array detected. Ensure every useEffect has an explicit dependency array to prevent infinite re-renders."
      }
    }'
    exit 0
  fi
fi

exit 0
