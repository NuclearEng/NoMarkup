#!/bin/bash
# NoMarkup: Pre-write payment code validator
# Enforces Stripe best practices, prevents common payment security issues

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // .tool_input.new_string // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check payment-related files
case "$FILE_PATH" in
  */payment*|*/billing*|*/stripe*|*/checkout*|*/subscription*|*/invoice*)
    ;;
  *)
    # Also check if content references Stripe
    if ! echo "$CONTENT" | grep -qiE 'stripe|payment|charge|refund|payout|transfer|subscription'; then
      exit 0
    fi
    ;;
esac

# === BLOCK: Client-side Stripe secret key ===

if echo "$CONTENT" | grep -qE 'sk_(test|live)_[a-zA-Z0-9]+'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "BLOCKED: Stripe secret key hardcoded in source. Use environment variables (process.env.STRIPE_SECRET_KEY)."
    }
  }'
  exit 0
fi

# === BLOCK: Amount calculation on client side ===

# Check for price/amount calculations in frontend files
case "$FILE_PATH" in
  */components/*|*/pages/*|*/app/*|*client*|*frontend*)
    if echo "$CONTENT" | grep -qE '(price|amount|total|cost)\s*[=*+-].*[0-9]|calculateTotal|calculatePrice'; then
      # Allow display-only formatting
      if ! echo "$CONTENT" | grep -qE 'format|display|toLocaleString|Intl\.NumberFormat'; then
        jq -n '{
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "BLOCKED: Price/amount calculation detected in frontend code. All payment calculations must happen server-side to prevent manipulation."
          }
        }'
        exit 0
      fi
    fi
    ;;
esac

# === ENFORCE: Webhook signature verification ===

if echo "$CONTENT" | grep -qE 'webhook|stripe.*event|event\.type'; then
  if ! echo "$CONTENT" | grep -qE 'constructEvent|verifyWebhookSignature|stripe\.webhooks\.constructEvent|webhook.*secret|WEBHOOK_SECRET'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "BLOCKED: Stripe webhook handler without signature verification. Use stripe.webhooks.constructEvent() to verify webhook authenticity."
      }
    }'
    exit 0
  fi
fi

# === ENFORCE: Idempotency keys on payment mutations ===

if echo "$CONTENT" | grep -qE 'paymentIntents\.create|charges\.create|transfers\.create|payouts\.create|refunds\.create'; then
  if ! echo "$CONTENT" | grep -qE 'idempotencyKey|idempotency_key|Idempotency-Key'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Stripe payment mutation without idempotency key. Add idempotencyKey to prevent duplicate charges on retries."
      }
    }'
    exit 0
  fi
fi

# === ENFORCE: Error handling on payment operations ===

if echo "$CONTENT" | grep -qE 'stripe\.\w+\.\w+\('; then
  if ! echo "$CONTENT" | grep -qE 'try\s*\{|\.catch\(|StripeError|CardError|InvalidRequestError'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Stripe API call without error handling. Wrap in try/catch and handle StripeError types (CardError, InvalidRequestError, etc.)."
      }
    }'
    exit 0
  fi
fi

exit 0
