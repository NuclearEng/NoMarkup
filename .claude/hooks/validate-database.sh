#!/bin/bash
# NoMarkup: Pre-write database migration/query validator
# Enforces safe migration patterns, prevents destructive operations

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check migration files and database-related code
IS_MIGRATION=false
IS_DB_CODE=false

case "$FILE_PATH" in
  */migrations/*|*/migrate/*|*/seeds/*|*/seeders/*)
    IS_MIGRATION=true
    ;;
  */db/*|*/database/*|*/models/*|*/repositories/*|*/prisma/*)
    IS_DB_CODE=true
    ;;
esac

if [ "$IS_MIGRATION" = false ] && [ "$IS_DB_CODE" = false ]; then
  exit 0
fi

# === BLOCK: Destructive migration operations without safeguards ===

if [ "$IS_MIGRATION" = true ]; then
  # Block DROP TABLE without IF EXISTS
  if echo "$CONTENT" | grep -qiE 'DROP\s+TABLE(?!\s+IF\s+EXISTS)'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED: DROP TABLE without IF EXISTS in migration. Use DROP TABLE IF EXISTS for safety."
      }
    }'
    exit 0
  fi

  # Block TRUNCATE in migrations
  if echo "$CONTENT" | grep -qiE 'TRUNCATE\s+TABLE'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED: TRUNCATE TABLE in migration file. This destroys all data. Use DELETE with WHERE clause if needed."
      }
    }'
    exit 0
  fi

  # Warn on column drops
  if echo "$CONTENT" | grep -qiE 'DROP\s+COLUMN|dropColumn|removeColumn'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Migration drops a column. Confirm this is intentional — dropped columns cannot be recovered without a backup."
      }
    }'
    exit 0
  fi

  # Enforce down/rollback migration exists
  if echo "$CONTENT" | grep -qE 'export\s+async\s+function\s+up|exports\.up'; then
    if ! echo "$CONTENT" | grep -qE 'export\s+async\s+function\s+down|exports\.down'; then
      jq -n '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "BLOCKED: Migration has an up() but no down() rollback function. Every migration must be reversible."
        }
      }'
      exit 0
    fi
  fi
fi

# === ENFORCE: No raw SQL in application code (use query builder/ORM) ===

if [ "$IS_DB_CODE" = true ]; then
  if echo "$CONTENT" | grep -qE '(query|exec)\s*\(\s*[`"'"'"']SELECT|INSERT|UPDATE|DELETE'; then
    HAS_PARAMETERIZED=$(echo "$CONTENT" | grep -cE '\$[0-9]+|\?\s*,|\$\{.*\}.*prepared|\.prepare\(')
    HAS_ORM=$(echo "$CONTENT" | grep -cE 'prisma\.|knex\.|sequelize\.|typeorm|drizzle|\.findMany|\.findUnique|\.create\(|\.update\(|\.delete\(')
    if [ "$HAS_PARAMETERIZED" -eq 0 ] && [ "$HAS_ORM" -eq 0 ]; then
      jq -n '{
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: "Raw SQL detected in application code without parameterization. Use the ORM/query builder or parameterized queries ($1, $2)."
        }
      }'
      exit 0
    fi
  fi
fi

exit 0
