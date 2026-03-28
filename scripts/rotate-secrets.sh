#!/usr/bin/env bash
set -euo pipefail

# NoMarkup Secrets Rotation Procedure
# ====================================
# Run this script to rotate all application secrets.
# Each section can be run independently by passing its name as an argument.
#
# Usage:
#   ./scripts/rotate-secrets.sh              # Rotate all secrets (interactive walkthrough)
#   ./scripts/rotate-secrets.sh jwt          # Rotate JWT RS256 key pair only
#   ./scripts/rotate-secrets.sh session      # Rotate session secret only
#   ./scripts/rotate-secrets.sh db           # Rotate database credentials
#   ./scripts/rotate-secrets.sh stripe       # Walkthrough for Stripe key rotation
#   ./scripts/rotate-secrets.sh redis        # Rotate Redis password
#   ./scripts/rotate-secrets.sh sendgrid     # Walkthrough for SendGrid API key rotation
#   ./scripts/rotate-secrets.sh oauth        # Walkthrough for OAuth client secret rotation
#   ./scripts/rotate-secrets.sh s3           # Rotate S3/MinIO access keys
#   ./scripts/rotate-secrets.sh meilisearch  # Rotate Meilisearch API key
#
# Prerequisites:
#   - openssl (for key generation)
#   - Access to .env.local or HashiCorp Vault (production)
#
# After rotation:
#   - Update .env.local (development) or Vault (production) with new values
#   - Restart affected services: make dev (development) or redeploy (production)
#
# Security notes:
#   - JWT key rotation invalidates ALL existing access tokens (15 min expiry)
#     and requires refresh. Plan rotation during low-traffic windows.
#   - Session secret rotation invalidates ALL active sessions immediately.
#   - This script prints secrets to stdout. Run in a secure terminal session.
#   - Backup files are created with restricted permissions (600).

echo "=== NoMarkup Secrets Rotation ==="
echo ""

# 1. JWT Keys (RS256)
# Used by: gateway (auth middleware — validates tokens with public key)
#          user service (JWTManager — signs tokens with private key)
# Files:   gateway/internal/middleware/auth.go, services/user/internal/service/jwt.go
# Env:     JWT_PRIVATE_KEY_PATH, JWT_PUBLIC_KEY_PATH
rotate_jwt_keys() {
    echo "--- Rotating JWT Keys (RS256) ---"
    echo ""

    KEYS_DIR="${KEYS_DIR:-./keys}"
    BACKUP_DIR="${KEYS_DIR}/backup/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"

    # Backup existing keys
    if [ -f "$KEYS_DIR/private.pem" ]; then
        cp "$KEYS_DIR/private.pem" "$BACKUP_DIR/"
        cp "$KEYS_DIR/public.pem" "$BACKUP_DIR/"
        chmod 600 "$BACKUP_DIR/private.pem"
        chmod 600 "$BACKUP_DIR/public.pem"
        echo "Backed up existing keys to $BACKUP_DIR"
    fi

    # Generate new RSA-4096 key pair
    echo "Generating new RSA-4096 key pair..."
    openssl genrsa -out "$KEYS_DIR/private.pem" 4096 2>/dev/null
    openssl rsa -in "$KEYS_DIR/private.pem" -pubout -out "$KEYS_DIR/public.pem" 2>/dev/null
    chmod 600 "$KEYS_DIR/private.pem"
    chmod 644 "$KEYS_DIR/public.pem"

    echo "New JWT keys generated at:"
    echo "  Private: $KEYS_DIR/private.pem"
    echo "  Public:  $KEYS_DIR/public.pem"
    echo ""
    echo "Impact:"
    echo "  - All existing access tokens will fail validation immediately."
    echo "  - Clients must re-authenticate using refresh tokens (which are DB-stored, not JWT-signed)."
    echo "  - If access tokens are still within their 15-min window, users will see auth errors"
    echo "    until they refresh."
    echo ""
    echo "Next steps:"
    echo "  1. Restart the gateway:       make dev (or redeploy gateway)"
    echo "  2. Restart the user service:   make dev (or redeploy user service)"
    echo "  3. In production, update Vault paths for JWT_PRIVATE_KEY_PATH / JWT_PUBLIC_KEY_PATH"
}

# 2. Session Secret
# Used by: user service (HMAC-SHA256 signing of email verification tokens, MFA challenge tokens)
# File:    services/user/internal/service/auth.go — Auth.verificationSecret
# Env:     SESSION_SECRET
rotate_session_secret() {
    echo "--- Rotating Session Secret ---"
    echo ""

    NEW_SECRET=$(openssl rand -base64 32)
    echo "New SESSION_SECRET:"
    echo "  $NEW_SECRET"
    echo ""
    echo "Impact:"
    echo "  - All pending email verification links will become invalid."
    echo "  - All pending MFA challenge tokens will become invalid."
    echo "  - Active JWT access/refresh tokens are NOT affected (they use RSA keys, not this secret)."
    echo ""
    echo "Next steps:"
    echo "  1. Update SESSION_SECRET in .env.local (dev) or Vault (prod)"
    echo "  2. Restart the user service"
}

# 3. Database Credentials
# Used by: all Go services via DATABASE_URL
# Env:     DATABASE_URL
rotate_db_credentials() {
    echo "--- Rotating Database Credentials ---"
    echo ""

    NEW_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
    echo "New database password: $NEW_PASSWORD"
    echo ""
    echo "Steps:"
    echo "  1. Connect to PostgreSQL as superuser:"
    echo "     psql -U postgres -h localhost -p 5433"
    echo ""
    echo "  2. Change the password:"
    echo "     ALTER USER nomarkup WITH PASSWORD '$NEW_PASSWORD';"
    echo ""
    echo "  3. Update DATABASE_URL in .env.local:"
    echo "     DATABASE_URL=postgresql://nomarkup:${NEW_PASSWORD}@localhost:5433/nomarkup?sslmode=disable"
    echo ""
    echo "  4. In production:"
    echo "     - Update the credential in Vault"
    echo "     - Update PgBouncer auth config if applicable"
    echo "     - Rolling restart all services (gateway, user, job, payment, chat, notification)"
    echo ""
    echo "  5. Restart all services: make dev"
}

# 4. Stripe Keys
# Used by: payment service (Stripe Connect, webhooks, escrow)
# Env:     STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_CLIENT_ID
rotate_stripe_keys() {
    echo "--- Rotating Stripe Keys ---"
    echo ""
    echo "Stripe key rotation must be done through the Stripe Dashboard."
    echo "Stripe supports rolling keys with a grace period where both old and new keys work."
    echo ""
    echo "Steps:"
    echo "  1. Go to Stripe Dashboard > Developers > API Keys"
    echo "  2. Click 'Roll key' on the Secret key"
    echo "     - Stripe keeps the old key active for 24 hours by default"
    echo "  3. Copy the new secret key"
    echo "  4. Update STRIPE_SECRET_KEY in .env.local / Vault"
    echo "  5. If rotating webhook secret:"
    echo "     a. Go to Developers > Webhooks > select endpoint"
    echo "     b. Click 'Roll secret'"
    echo "     c. Update STRIPE_WEBHOOK_SECRET in .env.local / Vault"
    echo "  6. Restart the payment service"
    echo ""
    echo "Impact:"
    echo "  - During the grace period, both old and new keys work."
    echo "  - Webhook signature verification will fail if the secret changes without a service restart."
    echo "  - Test in Stripe test mode first (sk_test_ / whsec_test_)."
}

# 5. Redis Password
# Used by: all services for cache, sessions, pub/sub
# Env:     REDIS_URL
rotate_redis_password() {
    echo "--- Rotating Redis Password ---"
    echo ""

    NEW_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
    echo "New Redis password: $NEW_PASSWORD"
    echo ""
    echo "Steps (development — no auth by default):"
    echo "  1. If Redis auth is enabled, connect to Redis:"
    echo "     redis-cli -h localhost -p 6379"
    echo "  2. Set the new password:"
    echo "     CONFIG SET requirepass '$NEW_PASSWORD'"
    echo "  3. Update REDIS_URL in .env.local:"
    echo "     REDIS_URL=redis://:${NEW_PASSWORD}@localhost:6379"
    echo "  4. Restart all services: make dev"
    echo ""
    echo "Steps (production):"
    echo "  1. Update password in Redis Cluster config"
    echo "  2. Update REDIS_URL in Vault"
    echo "  3. Rolling restart all services"
    echo ""
    echo "Impact:"
    echo "  - All existing Redis connections will drop."
    echo "  - Cached data (sessions, rate limit counters) will be inaccessible until services reconnect."
}

# 6. SendGrid API Key
# Used by: notification service (email delivery)
# Env:     SENDGRID_API_KEY
rotate_sendgrid_key() {
    echo "--- Rotating SendGrid API Key ---"
    echo ""
    echo "Steps:"
    echo "  1. Go to SendGrid Dashboard > Settings > API Keys"
    echo "  2. Create a new API key with the same permissions as the current key:"
    echo "     - Mail Send (full access)"
    echo "     - Template Engine (read access)"
    echo "  3. Copy the new key (it is only shown once)"
    echo "  4. Update SENDGRID_API_KEY in .env.local / Vault"
    echo "  5. Restart the notification service"
    echo "  6. Verify email delivery works (registration flow, password reset)"
    echo "  7. Delete the old API key in SendGrid Dashboard"
    echo ""
    echo "Impact:"
    echo "  - Email delivery will fail between updating the key and restarting the service."
    echo "  - Plan rotation during low-traffic windows."
}

# 7. OAuth Client Secrets (Google, Apple)
# Used by: gateway (OAuth callback handling)
# Env:     GOOGLE_CLIENT_SECRET, APPLE_CLIENT_SECRET
rotate_oauth_secrets() {
    echo "--- Rotating OAuth Client Secrets ---"
    echo ""
    echo "Google OAuth:"
    echo "  1. Go to Google Cloud Console > APIs & Services > Credentials"
    echo "  2. Edit the OAuth 2.0 Client ID"
    echo "  3. Click 'Reset Secret'"
    echo "  4. Copy the new secret"
    echo "  5. Update GOOGLE_CLIENT_SECRET in .env.local / Vault"
    echo ""
    echo "Apple OAuth:"
    echo "  1. Go to Apple Developer > Certificates, Identifiers & Profiles > Keys"
    echo "  2. Generate a new key or rotate the existing client secret"
    echo "  3. Update APPLE_CLIENT_SECRET in .env.local / Vault"
    echo ""
    echo "After both:"
    echo "  1. Restart the gateway"
    echo "  2. Test OAuth login flows for each provider"
    echo ""
    echo "Impact:"
    echo "  - OAuth login will fail for the affected provider until the service restarts."
    echo "  - Existing sessions (JWT-based) are NOT affected."
}

# 8. S3/MinIO Access Keys
# Used by: imaging service, job service (file uploads)
# Env:     S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
rotate_s3_keys() {
    echo "--- Rotating S3/MinIO Access Keys ---"
    echo ""
    echo "Development (MinIO):"
    echo "  1. Access MinIO Console at http://localhost:9001"
    echo "  2. Go to Identity > Service Accounts"
    echo "  3. Create a new access key pair"
    echo "  4. Update .env.local:"
    echo "     S3_ACCESS_KEY_ID=<new-access-key>"
    echo "     S3_SECRET_ACCESS_KEY=<new-secret-key>"
    echo "  5. Delete the old access key"
    echo "  6. Restart affected services: make dev"
    echo ""
    echo "Production (AWS S3):"
    echo "  1. Go to AWS IAM > Users > nomarkup-app > Security credentials"
    echo "  2. Create a new access key"
    echo "  3. Update S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in Vault"
    echo "  4. Rolling restart services that use S3"
    echo "  5. Deactivate the old access key in IAM"
    echo "  6. After confirming everything works, delete the old key"
    echo ""
    echo "Impact:"
    echo "  - File uploads and image processing will fail until services restart with new keys."
}

# 9. Meilisearch API Key
# Used by: job service (search indexing and queries)
# Env:     MEILISEARCH_API_KEY
rotate_meilisearch_key() {
    echo "--- Rotating Meilisearch API Key ---"
    echo ""

    NEW_KEY=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
    echo "New Meilisearch master key: $NEW_KEY"
    echo ""
    echo "Steps:"
    echo "  1. Stop Meilisearch"
    echo "  2. Restart Meilisearch with the new master key:"
    echo "     meilisearch --master-key='$NEW_KEY'"
    echo "     (or update MEILI_MASTER_KEY in docker-compose.yml)"
    echo "  3. Update MEILISEARCH_API_KEY in .env.local / Vault"
    echo "  4. Restart services that use search: make dev"
    echo ""
    echo "Impact:"
    echo "  - Search functionality will be unavailable during the restart."
    echo "  - Existing search indexes are preserved (they are stored on disk, not tied to the key)."
}

# Menu
case "${1:-all}" in
    jwt)         rotate_jwt_keys ;;
    session)     rotate_session_secret ;;
    db)          rotate_db_credentials ;;
    stripe)      rotate_stripe_keys ;;
    redis)       rotate_redis_password ;;
    sendgrid)    rotate_sendgrid_key ;;
    oauth)       rotate_oauth_secrets ;;
    s3)          rotate_s3_keys ;;
    meilisearch) rotate_meilisearch_key ;;
    all)
        rotate_jwt_keys
        echo ""
        rotate_session_secret
        echo ""
        rotate_db_credentials
        echo ""
        rotate_stripe_keys
        echo ""
        rotate_redis_password
        echo ""
        rotate_sendgrid_key
        echo ""
        rotate_oauth_secrets
        echo ""
        rotate_s3_keys
        echo ""
        rotate_meilisearch_key
        ;;
    *)
        echo "Usage: $0 {jwt|session|db|stripe|redis|sendgrid|oauth|s3|meilisearch|all}"
        exit 1
        ;;
esac

echo ""
echo "=== Rotation complete. Restart affected services. ==="
