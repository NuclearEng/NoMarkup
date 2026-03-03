#!/bin/bash
# NoMarkup: Pre-write environment variable validator
# Enforces proper env var usage, prevents accidental client-side exposure

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check TS/JS files
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx)
    ;;
  *)
    exit 0
    ;;
esac

# === BLOCK: Server secrets in client components ===
# In Next.js, only NEXT_PUBLIC_ vars are available client-side

SERVER_SECRETS=(
  "STRIPE_SECRET_KEY"
  "DATABASE_URL"
  "REDIS_URL"
  "JWT_SECRET"
  "SESSION_SECRET"
  "SENDGRID_API_KEY"
  "AWS_SECRET_ACCESS_KEY"
  "GOOGLE_CLIENT_SECRET"
  "ENCRYPTION_KEY"
  "WEBHOOK_SECRET"
)

# Check if this is a client component
IS_CLIENT=false
if echo "$CONTENT" | grep -qE "^['\"]use client['\"]|'use client'|\"use client\""; then
  IS_CLIENT=true
fi

# Also check common client paths
case "$FILE_PATH" in
  */components/*|*/hooks/*|*/context/*)
    IS_CLIENT=true
    ;;
esac

if [ "$IS_CLIENT" = true ]; then
  for secret in "${SERVER_SECRETS[@]}"; do
    if echo "$CONTENT" | grep -qE "process\.env\.$secret|process\.env\[.*$secret"; then
      jq -n '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "BLOCKED: Server-only secret '"$secret"' referenced in client-side code. Server secrets must not be exposed to the browser. Use a server action or API route instead."
        }
      }'
      exit 0
    fi
  done

  # Check for any non-NEXT_PUBLIC_ env var in client code
  NON_PUBLIC=$(echo "$CONTENT" | grep -oE 'process\.env\.[A-Z_]+' | grep -v 'NEXT_PUBLIC_' | head -1)
  if [ -n "$NON_PUBLIC" ]; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Non-public env var ('"$NON_PUBLIC"') in client component. Only NEXT_PUBLIC_ prefixed vars are available client-side. Is this intentionally server-only code?"
      }
    }'
    exit 0
  fi
fi

# === ENFORCE: Env vars must have fallback or validation ===

# Check for unvalidated process.env usage
if echo "$CONTENT" | grep -qE 'process\.env\.\w+[^?!]' | grep -v 'env\.mjs\|env\.ts\|env\.js\|config'; then
  HAS_VALIDATION=$(echo "$CONTENT" | grep -cE 'z\.string|env\.mjs|createEnv|envSchema|process\.env\.\w+\s*\|\||process\.env\.\w+\s*\?\?|process\.env\.\w+!')
  if [ "$HAS_VALIDATION" -eq 0 ]; then
    # Only warn if there are multiple raw env usages (suggests no validation layer)
    RAW_COUNT=$(echo "$CONTENT" | grep -cE 'process\.env\.\w+')
    if [ "$RAW_COUNT" -gt 2 ]; then
      jq -n '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: "Multiple raw process.env references without validation. Consider using a validated env config (e.g., @t3-oss/env-nextjs or a Zod schema) for type-safe environment variables."
        }
      }'
      exit 0
    fi
  fi
fi

exit 0
