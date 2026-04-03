# Secrets Rotation Procedure

This document defines the inventory, rotation procedures, schedules, and emergency
protocols for every secret used by the NoMarkup platform.

---

## 1. Secret Inventory

| Secret | Location(s) | Services That Consume It |
|--------|-------------|--------------------------|
| JWT RS256 private key (`keys/private.pem`) | Vault `secret/nomarkup/jwt`, `.env.local` | API Gateway (signing), all services (verification via public key) |
| JWT RS256 public key (`keys/public.pem`) | Vault `secret/nomarkup/jwt`, `.env.local` | API Gateway, User Service, Job Service, Payment Service, Chat Service |
| `DATABASE_URL` (PostgreSQL credentials) | Vault `secret/nomarkup/db`, `.env.local` | All Go services, Rust engines (sqlx) |
| `REDIS_URL` | Vault `secret/nomarkup/redis`, `.env.local` | API Gateway (rate limiting, sessions), Chat Service (pub/sub) |
| `STRIPE_SECRET_KEY` | Vault `secret/nomarkup/stripe`, `.env.local` | Payment Service |
| `STRIPE_WEBHOOK_SECRET` | Vault `secret/nomarkup/stripe`, `.env.local` | API Gateway (webhook handler) |
| `STRIPE_CONNECT_CLIENT_ID` | Vault `secret/nomarkup/stripe`, `.env.local` | Payment Service |
| `STRIPE_PUBLISHABLE_KEY` | Vault `secret/nomarkup/stripe`, `.env.local` | Web frontend (public, lower sensitivity) |
| `SENDGRID_API_KEY` | Vault `secret/nomarkup/sendgrid`, `.env.local` | User Service (email verification, notifications) |
| `TWILIO_ACCOUNT_SID` | Vault `secret/nomarkup/twilio`, `.env.local` | User Service (phone verification) |
| `TWILIO_AUTH_TOKEN` | Vault `secret/nomarkup/twilio`, `.env.local` | User Service (phone verification) |
| `SESSION_SECRET` | Vault `secret/nomarkup/auth`, `.env.local` | API Gateway |
| `VERIFICATION_SECRET` | Vault `secret/nomarkup/auth`, `.env.local` | User Service (email/phone verification tokens) |
| `MEILISEARCH_API_KEY` | Vault `secret/nomarkup/meilisearch`, `.env.local` | Job Service (search indexing), API Gateway (search queries) |
| `S3_ACCESS_KEY_ID` | Vault `secret/nomarkup/s3`, `.env.local` | User Service (avatars, docs), Job Service (photos), Imaging Engine |
| `S3_SECRET_ACCESS_KEY` | Vault `secret/nomarkup/s3`, `.env.local` | Same as S3_ACCESS_KEY_ID |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Vault `secret/nomarkup/mapbox`, `.env.local` | Web frontend |
| `SENTRY_DSN` | Vault `secret/nomarkup/sentry`, `.env.local` | All services, Web frontend |
| Firebase credentials (service account JSON) | Vault `secret/nomarkup/firebase`, `.env.local` | User Service (push notifications) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Vault `secret/nomarkup/otel`, `.env.local` | All services (traces) |

---

## 2. Rotation Procedures

### 2.1 JWT RS256 Signing Keys

**Sensitivity:** Critical (controls all API authentication)

**Generate new key pair:**
```bash
# Generate new private key
openssl genrsa -out private-new.pem 4096

# Extract public key
openssl rsa -in private-new.pem -pubout -out public-new.pem
```

**Zero-downtime rotation (dual-key validation period):**

1. **Day 0 -- Deploy new public key alongside old one.**
   Update all services to accept tokens signed by *either* key. The Gateway and
   every service that validates JWTs must load both `JWT_PUBLIC_KEY` (current) and
   `JWT_PUBLIC_KEY_NEXT` (new). Validation succeeds if either key verifies.
   ```bash
   vault kv put secret/nomarkup/jwt \
     private_key=@private.pem \
     public_key=@public.pem \
     public_key_next=@public-new.pem
   ```
   Rolling-restart all services so they pick up the second public key.

2. **Day 1 -- Switch signing to the new private key.**
   Update the Gateway to sign new tokens with the new private key. Old tokens
   (max lifetime 15 min access + 7 day refresh) remain valid because the old
   public key is still trusted.
   ```bash
   vault kv put secret/nomarkup/jwt \
     private_key=@private-new.pem \
     public_key=@public-new.pem \
     public_key_prev=@public.pem
   ```
   Rolling-restart the Gateway.

3. **Day 8 -- Remove old public key.**
   All refresh tokens signed with the old key have expired (7-day max). Remove
   `public_key_prev` from Vault. Rolling-restart services.

4. **Securely delete old private key:**
   ```bash
   shred -u private.pem
   ```

**Verification:**
- `curl -H "Authorization: Bearer <new-token>" https://api.nomarkup.com/v1/me` returns 200
- `curl -H "Authorization: Bearer <old-token>" https://api.nomarkup.com/v1/me` returns 401 (after Day 8)
- Check Sentry/logs for unexpected 401 spikes

---

### 2.2 DATABASE_URL (PostgreSQL Credentials)

**Sensitivity:** Critical

**Generate new credentials:**
```sql
-- Connect as superuser
CREATE ROLE nomarkup_new WITH LOGIN PASSWORD '<generated-via-openssl-rand-base64-32>';
GRANT ALL PRIVILEGES ON DATABASE nomarkup TO nomarkup_new;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO nomarkup_new;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO nomarkup_new;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO nomarkup_new;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO nomarkup_new;
```

**Zero-downtime rotation:**

1. Create the new role with identical grants.
2. Update Vault with the new connection string (use the generated credential -- never embed it in docs or code).
3. Rolling-restart services one at a time (Gateway first, then User, Job, Payment, Chat, engines). Monitor connection pool metrics between each restart.
4. After all services are using the new credentials, revoke the old role:
   ```sql
   REASSIGN OWNED BY nomarkup_old TO nomarkup_new;
   DROP ROLE nomarkup_old;
   ```

**Verification:**
- All services report healthy database connections in health-check endpoints
- No `FATAL: authentication failed` entries in PostgreSQL logs
- Run a smoke test: create a user, post a job, place a bid

---

### 2.3 REDIS_URL

**Sensitivity:** High

**Generate new credentials:**
```bash
# In redis-cli as admin
ACL SETUSER nomarkup_new on ><generated-value> ~* +@all
```

**Zero-downtime rotation:**

1. Create new Redis user with identical ACL.
2. Update Vault with the new connection URL.
3. Rolling-restart: API Gateway, Chat Service (these are the primary consumers).
4. Remove old user: `ACL DELUSER nomarkup_old`

**Verification:**
- Rate limiting still functions (make 6 rapid requests to auth endpoint; 6th should be rejected)
- Chat WebSocket connections are re-established
- Session store reads succeed (existing sessions may be lost -- acceptable)

---

### 2.4 Stripe Keys (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)

**Sensitivity:** Critical (handles money)

**Generate new values:**
- `STRIPE_SECRET_KEY`: Roll the key in Stripe Dashboard > Developers > API keys > Roll key. Stripe provides a 72-hour grace period where both old and new keys work.
- `STRIPE_WEBHOOK_SECRET`: Create a new webhook endpoint in Stripe Dashboard (or update the existing one). The new signing value is shown once.

**Zero-downtime rotation:**

1. **STRIPE_SECRET_KEY:**
   a. Roll the key in Stripe Dashboard. Note the expiration of the old key.
   b. Update Vault immediately with the new key.
   c. Rolling-restart Payment Service.
   d. Verify within 72 hours (before old key expires).

2. **STRIPE_WEBHOOK_SECRET:**
   a. Update the webhook URL in Stripe to point to a new path (`/webhooks/stripe/v2`).
   b. Deploy code that handles both paths, each with its own signing value.
   c. Once all events arrive at the new path, remove the old webhook in Stripe.
   d. Remove old path handler.

**Verification:**
- Create a test payment intent and verify it completes
- Trigger a test webhook event from Stripe Dashboard and confirm receipt
- Check Payment Service logs for `signature verification failed` errors

---

### 2.5 STRIPE_CONNECT_CLIENT_ID

**Sensitivity:** High

This value rarely changes. It is tied to the Stripe Connect platform configuration.

**Rotation:** Only rotated if the Connect platform is re-created. Update Vault and restart Payment Service.

---

### 2.6 SENDGRID_API_KEY

**Sensitivity:** Medium

**Generate:** SendGrid Dashboard > Settings > API Keys > Create API Key (restricted: Mail Send only).

**Rotation:**

1. Create new API key in SendGrid.
2. Update Vault with the new value.
3. Restart User Service.
4. Verify: trigger a reset email and confirm delivery.
5. Delete old API key in SendGrid Dashboard.

---

### 2.7 TWILIO_AUTH_TOKEN

**Sensitivity:** Medium

**Generate:** Twilio Console > Account > API Keys and Tokens > Rotate Auth Token. Twilio provides a secondary token during rotation.

**Rotation:**

1. Promote the secondary auth token in Twilio Console.
2. Update Vault with the new token value.
3. Restart User Service.
4. Verify: trigger a phone verification SMS and confirm receipt.

**Note:** `TWILIO_ACCOUNT_SID` is not a credential (it is a public identifier) but is stored alongside the auth token for convenience.

---

### 2.8 SESSION_SECRET / VERIFICATION_SECRET

**Sensitivity:** High

**Generate:**
```bash
openssl rand -base64 32
```

**Rotation:**

1. Update Vault with the new value(s).
2. Rolling-restart API Gateway (SESSION_SECRET) and User Service (VERIFICATION_SECRET).
3. **Impact:** All existing sessions are invalidated. Users must re-login. All pending email/phone verification links become invalid. Time this during low-traffic hours.

**Verification:**
- Login flow works end-to-end
- Email verification link in a new email works
- Old session cookies return 401

---

### 2.9 MEILISEARCH_API_KEY

**Sensitivity:** Medium

**Generate:** Create a new key via the Meilisearch management API using the master key.

**Rotation:**

1. Create new API key via Meilisearch API.
2. Update Vault with the new key value.
3. Restart Job Service and API Gateway.
4. Delete old key via Meilisearch API.

**Verification:**
- Search for a job by title and confirm results return

---

### 2.10 S3 Credentials (S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)

**Sensitivity:** High

**Generate:** AWS IAM Console > Create new access key for the service user (or use `aws iam create-access-key`).

**Rotation:**

1. Create new access key (AWS allows 2 active keys per IAM user).
2. Update Vault with new key pair.
3. Restart: User Service, Job Service, Imaging Engine.
4. Verify: upload an avatar image, upload a job photo, confirm they appear.
5. Deactivate and delete old access key in IAM.

---

### 2.11 NEXT_PUBLIC_MAPBOX_TOKEN

**Sensitivity:** Low (public token, but should still be rotated to limit abuse)

**Generate:** Mapbox Dashboard > Access tokens > Create token (scoped to your domain via URL restrictions).

**Rotation:**

1. Create new token in Mapbox Dashboard with domain restrictions.
2. Update Vault and `.env.local`.
3. Rebuild and redeploy the web frontend.
4. Delete old token in Mapbox Dashboard.

**Verification:**
- Map renders on the provider browse page

---

### 2.12 SENTRY_DSN

**Sensitivity:** Low (identifies the project, not an authentication credential)

**Rotation:** Only needed if the Sentry project is migrated. Update all services and rebuild the frontend.

---

### 2.13 Firebase Credentials (Service Account JSON)

**Sensitivity:** High

**Generate:** Firebase Console > Project Settings > Service accounts > Generate new private key.

**Rotation:**

1. Generate new service account key.
2. Update Vault with the new JSON file content.
3. Restart User Service.
4. Verify: send a test push notification.
5. Revoke old service account key in Google Cloud Console > IAM > Service accounts.

---

## 3. Rotation Schedule

| Category | Secrets | Interval | Overlap Period |
|----------|---------|----------|----------------|
| **Critical** | `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SESSION_SECRET`, `VERIFICATION_SECRET` | 90 days | 24 hours (DB), 72 hours (Stripe) |
| **JWT signing** | `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | 180 days | 30-day dual-key validation |
| **API keys** | `SENDGRID_API_KEY`, `TWILIO_AUTH_TOKEN`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `MEILISEARCH_API_KEY` | 365 days | Create-before-delete (1 hour) |
| **Infrastructure** | `REDIS_URL`, `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`, Firebase credentials | 90 days | Dual-credential period (1 hour) |
| **Low sensitivity** | `SENTRY_DSN`, `STRIPE_CONNECT_CLIENT_ID`, `OTEL_EXPORTER_OTLP_ENDPOINT` | As needed (only on compromise or project migration) | N/A |

### Calendar Cadence

- **Q1 (Jan):** JWT key rotation begins (Day 0 deploy new public key)
- **Q1 (Feb):** JWT rotation completes (Day 8 remove old key)
- **Q1, Q2, Q3, Q4 (first week):** Critical credentials (DB, Stripe, session) rotated
- **Annual (Jan):** API keys (SendGrid, Twilio, Mapbox, Meilisearch) rotated

Maintain a shared calendar with reminders 7 days before each scheduled rotation.

---

## 4. Emergency Rotation (Compromised Secret)

### Immediate Steps (within 15 minutes)

1. **Identify the compromised value.** Determine scope: single item, single service, or full breach.
2. **Generate a replacement** using the procedure in Section 2 for that item.
3. **Update Vault** with the replacement.
4. **Force-restart affected services** (not rolling -- all pods simultaneously to minimize exposure window):
   ```bash
   kubectl rollout restart deployment/<service-name> -n nomarkup
   ```
5. **Revoke/delete the old value** at the source (Stripe Dashboard, AWS IAM, PostgreSQL, etc.).

### Service Restart Order (if multiple items are compromised)

Restart in this order to minimize cascading failures:

1. **PostgreSQL** -- rotate DB credentials (all services depend on the database)
2. **Redis** -- rotate Redis credentials (sessions, rate limiting)
3. **API Gateway** -- rotate JWT keys, SESSION_SECRET (front door to all services)
4. **User Service** -- rotate VERIFICATION_SECRET, SendGrid, Twilio, Firebase
5. **Payment Service** -- rotate Stripe keys
6. **Job Service** -- rotate Meilisearch key
7. **Chat Service** -- no unique items (uses DB + Redis)
8. **Rust engines** -- rotate if they have direct DB connections
9. **Web frontend** -- rebuild with new NEXT_PUBLIC_* values, deploy

### Post-Incident Actions

1. **Audit logs:** Review `admin_audit_log` and service logs for unauthorized access during the exposure window.
2. **Stripe:** If `STRIPE_SECRET_KEY` was compromised, review recent charges/transfers in Stripe Dashboard for unauthorized activity.
3. **Database:** If `DATABASE_URL` was compromised, audit `pg_stat_activity` for suspicious queries. Consider rotating all user credentials if data exfiltration is suspected.
4. **JWT keys:** If the private key was compromised, immediately revoke all refresh tokens:
   ```sql
   UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL;
   ```
   This forces all users to re-authenticate.

### User Notification Requirements

| Scenario | Notification Required |
|----------|----------------------|
| JWT key compromised | No (silent rotation, users re-login) |
| Database credentials compromised, no data accessed | No |
| Database credentials compromised, data possibly accessed | Yes -- email all users within 72 hours per breach notification laws |
| Stripe key compromised | Yes -- notify affected users if any unauthorized charges occurred |
| SendGrid/Twilio compromised | No (rotate and monitor for abuse) |
| S3 credentials compromised | Yes if user files (documents, photos) were accessible |

---

## 5. Vault Configuration Reference

All production values are stored in HashiCorp Vault under the `secret/nomarkup/` path.
Each service reads its configuration at startup via the Vault Agent sidecar in Kubernetes.

```hcl
# Example Vault policy for the Payment Service
path "secret/data/nomarkup/db" {
  capabilities = ["read"]
}
path "secret/data/nomarkup/stripe" {
  capabilities = ["read"]
}
```

**Development:** Values live in `.env.local` (git-ignored). Use the `.env.example`
file as a template. Never commit real values.

**CI/CD:** GitHub Actions store test-environment values separately. These are
independent from production and can be rotated independently.
