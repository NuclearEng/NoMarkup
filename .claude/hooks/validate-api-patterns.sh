#!/bin/bash
# NoMarkup: Pre-write API pattern validator
# Enforces API route security, auth middleware, rate limiting patterns

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check API route files
case "$FILE_PATH" in
  */api/*|*/routes/*|*/handlers/*|*/controllers/*)
    ;;
  *)
    exit 0
    ;;
esac

# Only check TS/JS files
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx)
    ;;
  *)
    exit 0
    ;;
esac

# === ENFORCE: API routes must use auth middleware ===
# Check if file exports route handlers without auth

# Detect route handler patterns (Next.js App Router, Express, etc.)
HAS_HANDLER=$(echo "$CONTENT" | grep -cE 'export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)|app\.(get|post|put|patch|delete)\(|router\.(get|post|put|patch|delete)\(')

if [ "$HAS_HANDLER" -gt 0 ]; then
  # Check for auth middleware/wrapper
  HAS_AUTH=$(echo "$CONTENT" | grep -cE 'withAuth|requireAuth|authenticate|verifyToken|getSession|getServerSession|auth\(\)|middleware|isAuthenticated|requireRole')

  # Allow public routes explicitly marked
  IS_PUBLIC=$(echo "$CONTENT" | grep -cE '// @public|// public route|// no-auth|PUBLIC_ROUTE')

  if [ "$HAS_AUTH" -eq 0 ] && [ "$IS_PUBLIC" -eq 0 ]; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "API route handler detected without auth middleware. If this is intentionally public, add a \"// @public\" comment. Otherwise, wrap with withAuth()."
      }
    }'
    exit 0
  fi
fi

# === ENFORCE: No raw req.body without validation ===

if echo "$CONTENT" | grep -qE 'req\.body\.' | grep -v 'schema\|validate\|parse\|zod\|yup\|joi\|safeParse'; then
  HAS_VALIDATION=$(echo "$CONTENT" | grep -cE 'z\.|schema|validate|safeParse|yup\.|Joi\.')
  if [ "$HAS_VALIDATION" -eq 0 ]; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "API route accesses req.body without schema validation. Use Zod or similar for input validation."
      }
    }'
    exit 0
  fi
fi

# === ENFORCE: Rate limiting on mutation endpoints ===

HAS_MUTATION=$(echo "$CONTENT" | grep -cE 'export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)|app\.(post|put|patch|delete)\(|router\.(post|put|patch|delete)\(')

if [ "$HAS_MUTATION" -gt 0 ]; then
  HAS_RATE_LIMIT=$(echo "$CONTENT" | grep -cE 'rateLimit|rateLimiter|throttle|limiter')
  if [ "$HAS_RATE_LIMIT" -eq 0 ]; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Mutation endpoint (POST/PUT/PATCH/DELETE) without rate limiting. Add rateLimiter middleware for security."
      }
    }'
    exit 0
  fi
fi

exit 0
