#!/bin/bash
# NoMarkup: Pre-execution Bash command validator
# Blocks dangerous commands, enforces security policies

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# === HARD BLOCKS: Commands that are never allowed ===

HARD_BLOCKS=(
  "rm -rf /"
  "rm -rf /*"
  "rm -rf ~"
  "DROP DATABASE"
  "DROP TABLE"
  "TRUNCATE TABLE"
  "DELETE FROM.*WHERE 1"
  "git push.*--force.*main"
  "git push.*--force.*master"
  "git reset --hard origin"
  "chmod 777"
  "curl.*| bash"
  "wget.*| bash"
  "eval \$(curl"
  "eval \$(wget"
  "> /dev/sda"
  "mkfs\."
  ":(){:|:&};:"
)

for pattern in "${HARD_BLOCKS[@]}"; do
  if echo "$COMMAND" | grep -qiE "$pattern"; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED: Dangerous command detected. This command could cause irreversible damage."
      }
    }'
    exit 0
  fi
done

# === SECRET DETECTION: Block commands that might expose secrets ===

SECRET_PATTERNS=(
  "echo.*PASSWORD"
  "echo.*SECRET"
  "echo.*API_KEY"
  "echo.*TOKEN"
  "echo.*PRIVATE_KEY"
  "cat.*\.env"
  "cat.*credentials"
  "cat.*\.pem"
  "cat.*\.key"
  "printenv"
)

for pattern in "${SECRET_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qiE "$pattern"; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED: This command may expose secrets or credentials. Use environment variable references instead of printing values."
      }
    }'
    exit 0
  fi
done

# === WARN: Commands that need extra scrutiny ===

WARN_PATTERNS=(
  "npm publish"
  "npx.*deploy"
  "git push"
  "docker push"
  "terraform apply"
  "terraform destroy"
  "aws.*delete"
  "gcloud.*delete"
)

for pattern in "${WARN_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qiE "$pattern"; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "This command affects external systems. Please confirm."
      }
    }'
    exit 0
  fi
done

exit 0
