#!/bin/bash
# NoMarkup: Pre-write file validator
# Enforces file creation policies, blocks sensitive file overwrites

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# === BLOCK: Never overwrite these files without explicit approval ===

PROTECTED_FILES=(
  ".env"
  ".env.local"
  ".env.production"
  "credentials.json"
  "serviceAccountKey.json"
  "*.pem"
  "*.key"
  "package-lock.json"
  "yarn.lock"
  "pnpm-lock.yaml"
)

BASENAME=$(basename "$FILE_PATH")
for pattern in "${PROTECTED_FILES[@]}"; do
  if [[ "$BASENAME" == $pattern ]]; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Protected file: '"$BASENAME"'. Confirm this write is intentional."
      }
    }'
    exit 0
  fi
done

# === BLOCK: Secrets in file content ===

SECRET_CONTENT_PATTERNS=(
  "sk-[a-zA-Z0-9]{20,}"
  "AKIA[0-9A-Z]{16}"
  "ghp_[a-zA-Z0-9]{36}"
  "-----BEGIN (RSA |EC )?PRIVATE KEY-----"
  "password\s*[:=]\s*['\"][^'\"]{8,}"
  "secret\s*[:=]\s*['\"][^'\"]{8,}"
  "api_key\s*[:=]\s*['\"][^'\"]{8,}"
)

for pattern in "${SECRET_CONTENT_PATTERNS[@]}"; do
  if echo "$CONTENT" | grep -qiE "$pattern"; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED: Detected what appears to be a hardcoded secret or credential in the file content. Use environment variables instead."
      }
    }'
    exit 0
  fi
done

# === ENFORCE: TypeScript strict patterns ===

if [[ "$FILE_PATH" == *.ts || "$FILE_PATH" == *.tsx ]]; then
  # Check for 'any' type usage
  if echo "$CONTENT" | grep -qE ':\s*any\b|<any>|as any'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED: TypeScript \"any\" type detected. Use a specific type, unknown, or a generic. No \"any\" allowed per project rules."
      }
    }'
    exit 0
  fi

  # Check for @ts-ignore
  if echo "$CONTENT" | grep -qE '@ts-ignore|@ts-nocheck'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED: @ts-ignore/@ts-nocheck detected. Fix the type error instead of suppressing it."
      }
    }'
    exit 0
  fi

  # Check for console.log (not console.error)
  if echo "$CONTENT" | grep -qE 'console\.(log|info|debug|warn)\(' | grep -v '// eslint-disable'; then
    # Only block in non-test files
    if [[ "$FILE_PATH" != *"__tests__"* && "$FILE_PATH" != *".test."* && "$FILE_PATH" != *".spec."* ]]; then
      jq -n '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "BLOCKED: console.log detected in production code. Use the structured logger instead. console.error is allowed for error handlers."
        }
      }'
      exit 0
    fi
  fi
fi

# === ENFORCE: SQL injection prevention ===

if echo "$CONTENT" | grep -qE '(query|exec|execute)\s*\(\s*`.*\$\{'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "BLOCKED: Potential SQL injection detected. String interpolation in SQL queries is not allowed. Use parameterized queries or the query builder."
    }
  }'
  exit 0
fi

# === ENFORCE: No dangerouslySetInnerHTML without sanitization ===

if echo "$CONTENT" | grep -q 'dangerouslySetInnerHTML'; then
  if ! echo "$CONTENT" | grep -q 'DOMPurify\|sanitize\|purify'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED: dangerouslySetInnerHTML without sanitization. Use DOMPurify.sanitize() to prevent XSS."
      }
    }'
    exit 0
  fi
fi

exit 0
