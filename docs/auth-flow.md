# NoMarkup Authentication Flow Specification

This document is the single source of truth for every authentication and authorization flow in the NoMarkup platform. It is written to be implementation-ready: an engineer should be able to build the entire auth system from this document alone.

---

## Table of Contents

1. [JWT Token Structure](#1-jwt-token-structure)
2. [Registration Flow](#2-registration-flow)
3. [Login Flow](#3-login-flow)
4. [Token Refresh Flow](#4-token-refresh-flow)
5. [Middleware Chain](#5-middleware-chain)
6. [Role-Based Access Control](#6-role-based-access-control)
7. [OAuth Flow](#7-oauth-flow)
8. [Email Verification Flow](#8-email-verification-flow)
9. [Phone Verification Flow](#9-phone-verification-flow)
10. [Password Reset Flow](#10-password-reset-flow)
11. [MFA Flow](#11-mfa-flow)
12. [Session Management](#12-session-management)
13. [Logout Flow](#13-logout-flow)
14. [Security Headers](#14-security-headers)
15. [Frontend Auth State](#15-frontend-auth-state)

---

## 1. JWT Token Structure

### 1.1 Access Token (RS256 JWT)

The access token is a signed JWT using the RS256 algorithm. The private key lives in the gateway; the public key is distributed to any service that needs to verify tokens.

**Header:**

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "<key-id>"
}
```

`kid` is the SHA-256 fingerprint of the public key, truncated to 8 hex characters. This supports key rotation: services look up the correct public key by `kid`.

**Payload (claims):**

| Claim   | Type       | Description                                                      |
|---------|------------|------------------------------------------------------------------|
| `sub`   | `string`   | User ID (UUID v7). Example: `"01902a3b-4c5d-7e6f-8a9b-0c1d2e3f4a5b"` |
| `email` | `string`   | User's verified email address.                                   |
| `roles` | `[]string` | Array of role strings. Example: `["customer", "provider"]`       |
| `exp`   | `int64`    | Expiration timestamp (Unix seconds). Set to `iat + 900` (15 min).|
| `iat`   | `int64`    | Issued-at timestamp (Unix seconds).                              |
| `jti`   | `string`   | Unique token ID (UUID v4). Used for revocation checks.           |
| `iss`   | `string`   | Always `"nomarkup-gateway"`.                                     |
| `aud`   | `string`   | Always `"nomarkup-api"`.                                         |

**Go struct:**

```go
type AccessTokenClaims struct {
    jwt.RegisteredClaims
    Email string   `json:"email"`
    Roles []string `json:"roles"`
}
```

**Signing:**

- Private key: RSA 2048-bit minimum, 4096-bit preferred.
- Key stored as PEM in environment variable `JWT_PRIVATE_KEY` or mounted file at `/run/secrets/jwt_private_key`.
- Public key distributed via `/.well-known/jwks.json` endpoint on the gateway.

### 1.2 Refresh Token

Refresh tokens are NOT JWTs. They are opaque 256-bit cryptographically random tokens, base64url-encoded (43 characters).

**Generation:**

```go
raw := make([]byte, 32)
crypto_rand.Read(raw)
token := base64.RawURLEncoding.EncodeToString(raw)
```

**Storage in DB (`refresh_tokens` table):**

| Column        | Type          | Value                                                           |
|---------------|---------------|-----------------------------------------------------------------|
| `id`          | `uuid`        | Primary key (UUID v7).                                          |
| `user_id`     | `uuid`        | FK to `users.id`.                                               |
| `token_hash`  | `text`        | SHA-256 hash of the raw token, hex-encoded.                     |
| `device_info` | `text`        | User-Agent string, truncated to 256 chars.                      |
| `ip_address`  | `inet`        | Client IP from `X-Forwarded-For` or direct connection.          |
| `expires_at`  | `timestamptz` | Role-based: 60min (customer), 120min (provider), 30min (admin). |
| `revoked_at`  | `timestamptz` | NULL if active. Set on revocation.                              |
| `created_at`  | `timestamptz` | Row creation time.                                              |

The raw refresh token is NEVER stored. Only the SHA-256 hash is persisted. The raw token is sent to the client once via an HTTP-only cookie.

### 1.3 Key Rotation

- Keys are rotated every 90 days or on compromise.
- During rotation, both old and new keys are valid for 24 hours (overlap window).
- The JWKS endpoint returns all currently valid keys, identified by `kid`.
- Access tokens signed with the old key remain valid until they expire (max 15 min after rotation).

---

## 2. Registration Flow

### 2.1 Email/Password Registration

**RPC:** `UserService.Register`

**Step 1 -- Client sends registration request**

```
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecureP@ss123!",
  "display_name": "Jane Doe",
  "captcha_token": "<reCAPTCHA-v3-token>"
}
```

Validation rules:
- `email`: valid RFC 5322 format, max 254 characters, lowercased and trimmed.
- `password`: minimum 10 characters, at least one uppercase, one lowercase, one digit, one special character. Max 128 characters. Checked against top 100,000 breached passwords list.
- `display_name`: 2-100 characters, trimmed, no leading/trailing whitespace.
- `captcha_token`: required, non-empty.

**Step 2 -- Server validates reCAPTCHA**

- Call Google reCAPTCHA v3 API: `POST https://www.google.com/recaptcha/api/siteverify` with `secret` and `response` (the captcha token).
- Require score >= 0.5. If below threshold, return `403 Forbidden` with body `{"code": "CAPTCHA_FAILED", "message": "Verification failed. Please try again."}`.

**Step 3 -- Server checks for existing user**

```sql
SELECT id, email, password_hash, status FROM users WHERE email = $1;
```

- If a row exists with `status = 'active'` and `password_hash IS NOT NULL`: return `409 Conflict` with `{"code": "EMAIL_EXISTS", "message": "An account with this email already exists."}`.
- If a row exists with `status = 'active'` and `password_hash IS NULL` (OAuth-only account): proceed to Step 4 to link password to the existing account.
- If a row exists with `status = 'pending_verification'` and was created more than 24 hours ago: delete the stale row and proceed to create a new one.
- If a row exists with `status = 'pending_verification'` and was created less than 24 hours ago: return `409 Conflict` with `{"code": "VERIFICATION_PENDING", "message": "Please check your email for a verification link."}`.

**Step 4 -- Server hashes password**

```go
params := argon2id.Params{
    Memory:      65536, // 64 MB
    Iterations:  3,
    Parallelism: 4,
    SaltLength:  16,
    KeyLength:   32,
}
hash, err := argon2id.CreateHash(password, &params)
```

Stored format: `$argon2id$v=19$m=65536,t=3,p=4$<base64-salt>$<base64-hash>`

**Step 5 -- Server creates user record**

```sql
INSERT INTO users (
    id, email, email_verified, password_hash, display_name,
    roles, status, mfa_enabled, created_at, updated_at
) VALUES (
    gen_ulid(), $1, false, $2, $3,
    ARRAY['customer'], 'pending_verification', false, NOW(), NOW()
)
RETURNING id;
```

Default role is `customer`. Roles `provider`, `admin`, `support`, and `analyst` are assigned by an admin via a separate endpoint.

**Step 6 -- Server generates email verification token**

- Generate 32-byte random token, base64url-encode it.
- Store SHA-256 hash in a `verification_tokens` table (or similar) with `user_id`, `token_hash`, `type = 'email_verification'`, `expires_at = NOW() + interval '24 hours'`.
- Send email via transactional email service with link: `https://nomarkup.com/verify-email?token=<raw-token>`.

**Step 7 -- Server returns response**

```
HTTP 201 Created

{
  "user_id": "01902a3b-4c5d-7e6f-8a9b-0c1d2e3f4a5b",
  "message": "Account created. Please check your email to verify your address."
}
```

No tokens are issued at registration. The user must verify their email first.

**Error cases:**

| Condition                     | Status | Code                    |
|-------------------------------|--------|-------------------------|
| Invalid email format          | 400    | `INVALID_EMAIL`         |
| Password too weak             | 400    | `WEAK_PASSWORD`         |
| Missing display name          | 400    | `INVALID_DISPLAY_NAME`  |
| reCAPTCHA failed              | 403    | `CAPTCHA_FAILED`        |
| Email already registered      | 409    | `EMAIL_EXISTS`          |
| Verification still pending    | 409    | `VERIFICATION_PENDING`  |
| Rate limited                  | 429    | `RATE_LIMITED`          |
| Internal error                | 500    | `INTERNAL_ERROR`        |

### 2.2 OAuth Registration

OAuth registration is handled through the OAuth flow (Section 7). When a user signs in with Google or Apple and no matching account exists, the system auto-creates a user record with `email_verified = true` (since the OAuth provider has already verified it), `password_hash = NULL`, and `status = 'active'`.

---

## 3. Login Flow

**RPC:** `UserService.Login`

### 3.1 Email/Password Login

**Step 1 -- Client sends login request**

```
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecureP@ss123!"
}
```

**Step 2 -- Server checks rate limit**

- Key: `auth:login:<ip>:<email-hash>` (SHA-256 of the lowercased email, to avoid storing raw emails in Redis).
- Limit: 5 attempts per 15-minute sliding window.
- If exceeded: return `429 Too Many Requests` with `{"code": "RATE_LIMITED", "message": "Too many login attempts. Please try again in X minutes."}` and `Retry-After` header.

**Step 3 -- Server looks up user**

```sql
SELECT id, email, email_verified, password_hash, roles, status,
       mfa_enabled, mfa_secret, last_login_at
FROM users
WHERE email = $1;
```

- If no row found: return `401 Unauthorized` with `{"code": "INVALID_CREDENTIALS", "message": "Invalid email or password."}`. Do NOT reveal whether the email exists.
- If `status = 'suspended'`: return `403 Forbidden` with `{"code": "ACCOUNT_SUSPENDED", "message": "Your account has been suspended. Contact support."}`.
- If `status = 'pending_verification'`: return `403 Forbidden` with `{"code": "EMAIL_NOT_VERIFIED", "message": "Please verify your email before logging in."}`.
- If `password_hash IS NULL` (OAuth-only account): return `401 Unauthorized` with `{"code": "INVALID_CREDENTIALS", "message": "Invalid email or password."}`. This prevents enumeration of OAuth accounts.

**Step 4 -- Server verifies password**

```go
match, err := argon2id.ComparePasswordAndHash(password, user.PasswordHash)
```

- If `match == false`: increment rate limit counter, return `401 Unauthorized` with `{"code": "INVALID_CREDENTIALS", "message": "Invalid email or password."}`.
- If match is true: proceed.

**Step 5 -- Server checks MFA**

If `mfa_enabled == true`: return a partial response indicating MFA is required.

```
HTTP 200 OK

{
  "mfa_required": true,
  "mfa_token": "<temporary-mfa-session-token>",
  "mfa_methods": ["totp", "backup_code"]
}
```

The `mfa_token` is a short-lived (5 minute) opaque token stored in Redis:

```
Key:   mfa_session:<token-hash>
Value: {"user_id": "...", "email": "...", "roles": [...], "created_at": "..."}
TTL:   300 seconds
```

If `mfa_enabled == false`: skip to Step 6.

**Step 6 -- Server issues tokens**

Generate access token (JWT) and refresh token (opaque). See Section 1 for structure.

```sql
-- Insert refresh token
INSERT INTO refresh_tokens (id, user_id, token_hash, device_info, ip_address, expires_at, created_at)
VALUES (gen_ulid(), $1, $2, $3, $4, $5, NOW());

-- Update last login
UPDATE users SET last_login_at = NOW(), last_active_at = NOW() WHERE id = $1;
```

The `expires_at` for the refresh token depends on the user's highest-privilege role:
- `admin`: `NOW() + interval '30 minutes'`
- `provider`: `NOW() + interval '120 minutes'`
- `customer` (default): `NOW() + interval '60 minutes'`

If a user has multiple roles, the shortest timeout applies. Priority order: `admin` > `support` > `analyst` > `provider` > `customer`.

Role-to-timeout mapping:

| Role       | Session Timeout |
|------------|-----------------|
| `admin`    | 30 minutes      |
| `support`  | 30 minutes      |
| `analyst`  | 60 minutes      |
| `provider` | 120 minutes     |
| `customer` | 60 minutes      |

**Step 7 -- Server enforces device limit**

```sql
-- Count active sessions for this user
SELECT COUNT(*) FROM refresh_tokens
WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW();
```

If count >= 3 (max concurrent devices), revoke the oldest session:

```sql
UPDATE refresh_tokens
SET revoked_at = NOW()
WHERE id = (
    SELECT id FROM refresh_tokens
    WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
    ORDER BY created_at ASC
    LIMIT 1
);
```

**Step 8 -- Server returns response**

```
HTTP 200 OK
Set-Cookie: refresh_token=<raw-refresh-token>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=3600

{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 900,
  "user": {
    "id": "01902a3b-4c5d-7e6f-8a9b-0c1d2e3f4a5b",
    "email": "user@example.com",
    "display_name": "Jane Doe",
    "roles": ["customer"],
    "email_verified": true,
    "mfa_enabled": false
  }
}
```

Cookie attributes:
- `HttpOnly`: prevents JavaScript access.
- `Secure`: only sent over HTTPS.
- `SameSite=Strict`: prevents CSRF.
- `Path=/api/v1/auth`: cookie only sent to auth endpoints (refresh, logout).
- `Max-Age`: matches the refresh token expiry in seconds.

**Error cases:**

| Condition                  | Status | Code                    |
|----------------------------|--------|-------------------------|
| Missing email or password  | 400    | `INVALID_REQUEST`       |
| Invalid credentials        | 401    | `INVALID_CREDENTIALS`   |
| Email not verified         | 403    | `EMAIL_NOT_VERIFIED`    |
| Account suspended          | 403    | `ACCOUNT_SUSPENDED`     |
| Rate limited               | 429    | `RATE_LIMITED`          |
| Internal error             | 500    | `INTERNAL_ERROR`        |

---

## 4. Token Refresh Flow

**RPC:** `UserService.RefreshToken`

### 4.1 Refresh with Rotation

Every refresh issues a NEW refresh token and invalidates the old one. This is called "refresh token rotation."

**Step 1 -- Client sends refresh request**

```
POST /api/v1/auth/refresh
Cookie: refresh_token=<raw-refresh-token>
```

No body is required. The refresh token comes from the cookie.

**Step 2 -- Server extracts and hashes the token**

```go
rawToken := r.Cookie("refresh_token")
tokenHash := sha256Hex(rawToken.Value)
```

**Step 3 -- Server looks up the token**

```sql
SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at, rt.device_info, rt.ip_address,
       u.email, u.roles, u.status, u.mfa_enabled
FROM refresh_tokens rt
JOIN users u ON u.id = rt.user_id
WHERE rt.token_hash = $1;
```

**Step 4 -- Server validates the token**

Checks, in order:

1. **Token exists**: if no row, return `401 Unauthorized` with `{"code": "INVALID_TOKEN", "message": "Invalid refresh token."}`.
2. **Token not revoked**: if `revoked_at IS NOT NULL`, this is a **reuse detection** event (see Step 4a). Return `401 Unauthorized`.
3. **Token not expired**: if `expires_at < NOW()`, return `401 Unauthorized` with `{"code": "TOKEN_EXPIRED", "message": "Session expired. Please log in again."}`.
4. **User is active**: if `u.status != 'active'`, revoke the token and return `403 Forbidden` with `{"code": "ACCOUNT_SUSPENDED"}`.

**Step 4a -- Reuse detection (critical security mechanism)**

If a refresh token that has already been revoked is presented, it means either:
- The token was stolen and the legitimate user already used the next one (attacker trying to reuse), or
- A race condition occurred (two legitimate requests used the same token simultaneously).

Action on reuse detection: **revoke ALL refresh tokens for this user** (nuclear option):

```sql
UPDATE refresh_tokens
SET revoked_at = NOW()
WHERE user_id = $1 AND revoked_at IS NULL;
```

Return `401 Unauthorized` with `{"code": "TOKEN_REUSE_DETECTED", "message": "Suspicious activity detected. All sessions have been terminated. Please log in again."}`.

Log this event at WARN level with user_id, IP, and device_info for security monitoring.

**Step 5 -- Server revokes the old token**

```sql
UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1;
```

**Step 6 -- Server issues new tokens**

Generate new access token (JWT) and new refresh token (opaque), exactly as in login Step 6.

Insert new refresh token row with the same `device_info` and updated `ip_address`.

**Step 7 -- Server returns response**

```
HTTP 200 OK
Set-Cookie: refresh_token=<new-raw-refresh-token>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=3600

{
  "access_token": "<new-jwt>",
  "token_type": "Bearer",
  "expires_in": 900
}
```

### 4.2 Race Condition Handling

When a single-page application makes multiple concurrent API calls and all trigger a refresh simultaneously, the following can happen:

1. Request A arrives, uses refresh token T1, issues T2.
2. Request B arrives (concurrently), also uses T1, but T1 is now revoked.
3. Reuse detection fires, all sessions revoked. User is logged out.

**Mitigation -- Grace Period:**

Instead of immediate reuse detection, allow a **10-second grace period** after a token is revoked. During this window, the revoked token can still be used and will return the same new token pair (not a different one).

Implementation:

```sql
-- When revoking in Step 5, also store the replacement token ID
UPDATE refresh_tokens
SET revoked_at = NOW(), replaced_by = $2
WHERE id = $1;
```

In Step 4 validation, if the token is revoked but `revoked_at > NOW() - interval '10 seconds'`:
- Look up the replacement token via `replaced_by`.
- Return the access token associated with the replacement session.
- Return the replacement refresh token as the cookie.

This makes concurrent refresh calls idempotent within the grace window.

**Error cases:**

| Condition            | Status | Code                    |
|----------------------|--------|-------------------------|
| No cookie present    | 401    | `MISSING_TOKEN`         |
| Invalid token        | 401    | `INVALID_TOKEN`         |
| Token expired        | 401    | `TOKEN_EXPIRED`         |
| Reuse detected       | 401    | `TOKEN_REUSE_DETECTED`  |
| Account suspended    | 403    | `ACCOUNT_SUSPENDED`     |

---

## 5. Middleware Chain

The gateway uses Chi router. Middleware executes in the order registered. The exact chain:

```go
r := chi.NewRouter()

// 1. Request ID
r.Use(middleware.RequestID)

// 2. Real IP extraction
r.Use(middleware.RealIP)

// 3. Structured logging
r.Use(structuredLogger)

// 4. Panic recovery
r.Use(middleware.Recoverer)

// 5. Security headers (Section 14)
r.Use(securityHeaders)

// 6. CORS
r.Use(corsMiddleware)

// 7. Rate limiting (global: 100 req/s per IP)
r.Use(rateLimiter)

// 8. Request size limit (1MB default, 10MB for uploads)
r.Use(middleware.RequestSize(1 << 20))

// Public routes (no auth required)
r.Group(func(r chi.Router) {
    // Auth-specific rate limit: 5 attempts per 15 min
    r.Use(authRateLimiter)

    r.Post("/api/v1/auth/register", registerHandler)
    r.Post("/api/v1/auth/login", loginHandler)
    r.Post("/api/v1/auth/refresh", refreshHandler)
    r.Post("/api/v1/auth/password/reset-request", passwordResetRequestHandler)
    r.Post("/api/v1/auth/password/reset", passwordResetHandler)
    r.Post("/api/v1/auth/mfa/verify", mfaVerifyHandler)
    r.Get("/api/v1/auth/verify-email", verifyEmailHandler)
    r.Get("/api/v1/auth/oauth/google", googleOAuthHandler)
    r.Get("/api/v1/auth/oauth/google/callback", googleOAuthCallbackHandler)
    r.Get("/api/v1/auth/oauth/apple", appleOAuthHandler)
    r.Post("/api/v1/auth/oauth/apple/callback", appleOAuthCallbackHandler)
    r.Get("/.well-known/jwks.json", jwksHandler)
})

// Protected routes (auth required)
r.Group(func(r chi.Router) {
    // 9. JWT authentication
    r.Use(jwtAuthMiddleware)

    // 10. Activity tracking
    r.Use(activityTracker)

    // 11. Inactivity timeout check
    r.Use(inactivityCheck)

    r.Post("/api/v1/auth/logout", logoutHandler)
    r.Post("/api/v1/auth/mfa/enable", mfaEnableHandler)
    r.Post("/api/v1/auth/mfa/disable", mfaDisableHandler)
    r.Post("/api/v1/auth/verify-phone", verifyPhoneHandler)
    r.Post("/api/v1/auth/send-phone-otp", sendPhoneOtpHandler)

    // Role-restricted routes
    r.Group(func(r chi.Router) {
        r.Use(requireRoles("admin"))
        r.Mount("/api/v1/admin", adminRouter)
    })

    r.Group(func(r chi.Router) {
        r.Use(requireRoles("provider"))
        r.Mount("/api/v1/provider", providerRouter)
    })

    // ... other role-gated groups
})
```

### 5.1 JWT Authentication Middleware (`jwtAuthMiddleware`)

```go
func jwtAuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // 1. Extract token from Authorization header
        authHeader := r.Header.Get("Authorization")
        if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
            respondError(w, 401, "MISSING_TOKEN", "Authorization header required.")
            return
        }
        tokenString := strings.TrimPrefix(authHeader, "Bearer ")

        // 2. Parse and validate JWT
        claims, err := validateAccessToken(tokenString)
        if err != nil {
            // Distinguish expired vs invalid
            if errors.Is(err, jwt.ErrTokenExpired) {
                respondError(w, 401, "TOKEN_EXPIRED", "Access token expired.")
            } else {
                respondError(w, 401, "INVALID_TOKEN", "Invalid access token.")
            }
            return
        }

        // 3. Check jti against revocation list (Redis set "revoked_jtis")
        if isRevoked(claims.ID) {
            respondError(w, 401, "TOKEN_REVOKED", "Token has been revoked.")
            return
        }

        // 4. Inject user context
        ctx := context.WithValue(r.Context(), ctxKeyUserID, claims.Subject)
        ctx = context.WithValue(ctx, ctxKeyEmail, claims.Email)
        ctx = context.WithValue(ctx, ctxKeyRoles, claims.Roles)
        ctx = context.WithValue(ctx, ctxKeyJTI, claims.ID)

        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

### 5.2 Activity Tracker Middleware (`activityTracker`)

```go
func activityTracker(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        userID := r.Context().Value(ctxKeyUserID).(string)

        // Debounce: only update if last update was > 60 seconds ago (checked via Redis)
        cacheKey := fmt.Sprintf("last_active:%s", userID)
        if !recentlyTracked(cacheKey, 60*time.Second) {
            // Async update -- do not block request
            go func() {
                db.Exec("UPDATE users SET last_active_at = NOW() WHERE id = $1", userID)
                redis.Set(cacheKey, "1", 60*time.Second)
            }()
        }

        next.ServeHTTP(w, r)
    })
}
```

### 5.3 Inactivity Check Middleware (`inactivityCheck`)

```go
func inactivityCheck(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        userID := r.Context().Value(ctxKeyUserID).(string)
        roles := r.Context().Value(ctxKeyRoles).([]string)

        timeout := sessionTimeoutForRoles(roles) // Returns the shortest timeout

        var lastActive time.Time
        db.QueryRow("SELECT last_active_at FROM users WHERE id = $1", userID).Scan(&lastActive)

        if time.Since(lastActive) > timeout {
            // Revoke all refresh tokens for this user
            db.Exec("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL", userID)
            respondError(w, 401, "SESSION_TIMEOUT", "Session expired due to inactivity.")
            return
        }

        next.ServeHTTP(w, r)
    })
}
```

---

## 6. Role-Based Access Control

### 6.1 Role Definitions

| Role       | Description                                     | Assignable By |
|------------|-------------------------------------------------|---------------|
| `customer` | Default role. Can browse, book, purchase.        | System (auto) |
| `provider` | Service provider. Can manage listings.           | `admin`       |
| `admin`    | Full platform access.                            | `admin`       |
| `support`  | Can view user accounts, handle tickets.          | `admin`       |
| `analyst`  | Read-only access to analytics and reports.       | `admin`       |

Users can have multiple roles simultaneously (e.g., `["customer", "provider"]`).

### 6.2 Route Protection Pattern

```go
// requireRoles returns middleware that checks if the user has ANY of the specified roles.
func requireRoles(roles ...string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            userRoles := r.Context().Value(ctxKeyRoles).([]string)

            for _, required := range roles {
                for _, have := range userRoles {
                    if required == have {
                        next.ServeHTTP(w, r)
                        return
                    }
                }
            }

            respondError(w, 403, "FORBIDDEN", "You do not have permission to access this resource.")
        })
    }
}
```

Usage examples:

```go
// Only admins
r.Use(requireRoles("admin"))

// Admins or support
r.Use(requireRoles("admin", "support"))

// Any authenticated user (no role middleware needed, jwtAuthMiddleware is sufficient)
```

### 6.3 Per-Resource Authorization

Beyond role checks, individual handlers perform resource-level authorization:

```go
func getOrderHandler(w http.ResponseWriter, r *http.Request) {
    userID := r.Context().Value(ctxKeyUserID).(string)
    roles := r.Context().Value(ctxKeyRoles).([]string)
    orderID := chi.URLParam(r, "orderID")

    order, err := db.GetOrder(orderID)
    if err != nil {
        respondError(w, 404, "NOT_FOUND", "Order not found.")
        return
    }

    // Admins and support can view any order
    if hasRole(roles, "admin") || hasRole(roles, "support") {
        respondJSON(w, 200, order)
        return
    }

    // Customers can only view their own orders
    if order.CustomerID != userID && order.ProviderID != userID {
        respondError(w, 403, "FORBIDDEN", "You do not have permission to view this order.")
        return
    }

    respondJSON(w, 200, order)
}
```

---

## 7. OAuth Flow

### 7.1 Google OAuth (Authorization Code Flow with PKCE)

**Step 1 -- Client initiates Google sign-in**

```
GET /api/v1/auth/oauth/google?redirect_uri=https://nomarkup.com/auth/callback
```

**Step 2 -- Server generates OAuth state and PKCE**

```go
state := generateRandomString(32)          // CSRF protection
codeVerifier := generateRandomString(43)   // PKCE
codeChallenge := base64url(sha256(codeVerifier))

// Store in Redis with 10-minute TTL
redis.Set("oauth_state:"+sha256Hex(state), json.Marshal(OAuthSession{
    State:        state,
    CodeVerifier: codeVerifier,
    RedirectURI:  redirectURI,
}), 10*time.Minute)
```

**Step 3 -- Server redirects to Google**

```
HTTP 302 Found
Location: https://accounts.google.com/o/oauth2/v2/auth?
    client_id=<GOOGLE_CLIENT_ID>&
    redirect_uri=https://api.nomarkup.com/api/v1/auth/oauth/google/callback&
    response_type=code&
    scope=openid%20email%20profile&
    state=<state>&
    code_challenge=<code_challenge>&
    code_challenge_method=S256&
    prompt=select_account
```

**Step 4 -- Google redirects back with authorization code**

```
GET /api/v1/auth/oauth/google/callback?code=<auth-code>&state=<state>
```

**Step 5 -- Server validates state**

```go
session := redis.Get("oauth_state:" + sha256Hex(state))
if session == nil {
    return error(400, "INVALID_STATE", "Invalid or expired OAuth state.")
}
redis.Del("oauth_state:" + sha256Hex(state)) // One-time use
```

**Step 6 -- Server exchanges code for tokens**

```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

client_id=<GOOGLE_CLIENT_ID>&
client_secret=<GOOGLE_CLIENT_SECRET>&
code=<auth-code>&
code_verifier=<code_verifier>&
grant_type=authorization_code&
redirect_uri=https://api.nomarkup.com/api/v1/auth/oauth/google/callback
```

**Step 7 -- Server extracts user info from ID token**

Google returns an `id_token` (JWT). Parse it to get:
- `sub`: Google user ID
- `email`: verified email
- `email_verified`: must be `true`
- `name`: display name

**Step 8 -- Server links or creates account**

```sql
-- Check for existing OAuth link
SELECT user_id FROM oauth_accounts
WHERE provider = 'google' AND provider_id = $1;
```

Case A -- Existing OAuth link found:
- Fetch the user, proceed to token issuance (same as login Step 6).

Case B -- No OAuth link, but email matches existing user:
```sql
SELECT id FROM users WHERE email = $1 AND email_verified = true;
```
- If found: link the OAuth account and proceed to token issuance.
  ```sql
  INSERT INTO oauth_accounts (user_id, provider, provider_id, email)
  VALUES ($1, 'google', $2, $3);
  ```

Case C -- No existing user:
```sql
-- Create user
INSERT INTO users (id, email, email_verified, display_name, roles, status, created_at, updated_at)
VALUES (gen_ulid(), $1, true, $2, ARRAY['customer'], 'active', NOW(), NOW())
RETURNING id;

-- Link OAuth account
INSERT INTO oauth_accounts (user_id, provider, provider_id, email)
VALUES ($1, 'google', $2, $3);
```

**Step 9 -- Server issues tokens and redirects**

Issue access token + refresh token (same as login). Redirect the user to the frontend callback URL with the access token as a URL fragment (NOT query parameter, to prevent server-side logging):

```
HTTP 302 Found
Location: https://nomarkup.com/auth/callback#access_token=<jwt>&expires_in=900
Set-Cookie: refresh_token=<raw-refresh-token>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=3600
```

### 7.2 Apple OAuth (Authorization Code Flow)

Apple Sign In has platform-specific requirements.

**Step 1 -- Client initiates Apple sign-in**

```
GET /api/v1/auth/oauth/apple?redirect_uri=https://nomarkup.com/auth/callback
```

**Step 2 -- Server generates state**

Same as Google Step 2 (without PKCE; Apple does not support PKCE).

**Step 3 -- Server redirects to Apple**

```
HTTP 302 Found
Location: https://appleid.apple.com/auth/authorize?
    client_id=<APPLE_SERVICE_ID>&
    redirect_uri=https://api.nomarkup.com/api/v1/auth/oauth/apple/callback&
    response_type=code%20id_token&
    scope=name%20email&
    state=<state>&
    response_mode=form_post
```

Note: Apple uses `response_mode=form_post`, meaning the callback is a POST, not a GET.

**Step 4 -- Apple POSTs to callback**

```
POST /api/v1/auth/oauth/apple/callback
Content-Type: application/x-www-form-urlencoded

code=<auth-code>&id_token=<jwt>&state=<state>&user=<json-user-object>
```

The `user` field is ONLY sent on the user's first authorization. It contains `name.firstName` and `name.lastName`. The server MUST persist these on first receipt because Apple will not send them again.

**Step 5 -- Server validates state**

Same as Google Step 5.

**Step 6 -- Server validates Apple ID token**

- Fetch Apple's public keys from `https://appleid.apple.com/auth/keys`.
- Verify the `id_token` JWT signature against Apple's keys.
- Validate `iss = "https://appleid.apple.com"`, `aud = <APPLE_SERVICE_ID>`, `exp > now`.
- Extract `sub` (Apple user ID), `email`, `email_verified`.

**Step 7 -- Server exchanges code for tokens (optional, for refresh)**

```
POST https://appleid.apple.com/auth/token
Content-Type: application/x-www-form-urlencoded

client_id=<APPLE_SERVICE_ID>&
client_secret=<APPLE_CLIENT_SECRET_JWT>&
code=<auth-code>&
grant_type=authorization_code&
redirect_uri=https://api.nomarkup.com/api/v1/auth/oauth/apple/callback
```

Apple's `client_secret` is a JWT signed with the Apple private key (ES256), containing `iss` (Team ID), `sub` (Service ID), `aud` ("https://appleid.apple.com"), `iat`, `exp` (max 6 months).

**Step 8 -- Server links or creates account**

Same logic as Google Step 8, replacing `'google'` with `'apple'`.

**Step 9 -- Server issues tokens and redirects**

Same as Google Step 9.

**Error cases (both providers):**

| Condition                     | Status | Code                    |
|-------------------------------|--------|-------------------------|
| Invalid or expired state      | 400    | `INVALID_STATE`         |
| OAuth provider error          | 400    | `OAUTH_ERROR`           |
| Email not verified by provider| 400    | `EMAIL_NOT_VERIFIED`    |
| Account suspended             | 403    | `ACCOUNT_SUSPENDED`     |
| Internal error                | 500    | `INTERNAL_ERROR`        |

---

## 8. Email Verification Flow

**RPC:** `UserService.VerifyEmail`

### 8.1 Verification

**Step 1 -- User clicks verification link**

```
GET /api/v1/auth/verify-email?token=<raw-token>
```

**Step 2 -- Server validates token**

```go
tokenHash := sha256Hex(rawToken)
```

```sql
SELECT vt.id, vt.user_id, vt.expires_at, u.status
FROM verification_tokens vt
JOIN users u ON u.id = vt.user_id
WHERE vt.token_hash = $1 AND vt.type = 'email_verification';
```

- If no row: return `400 Bad Request` with `{"code": "INVALID_TOKEN", "message": "Invalid or expired verification link."}`.
- If `expires_at < NOW()`: delete the token row, return `400 Bad Request` with `{"code": "TOKEN_EXPIRED", "message": "Verification link has expired. Please request a new one."}`.

**Step 3 -- Server updates user**

```sql
BEGIN;

UPDATE users
SET email_verified = true, status = 'active', updated_at = NOW()
WHERE id = $1 AND status = 'pending_verification';

DELETE FROM verification_tokens WHERE id = $2;

COMMIT;
```

**Step 4 -- Server redirects**

```
HTTP 302 Found
Location: https://nomarkup.com/auth/login?verified=true
```

### 8.2 Re-send Verification Email

**Step 1 -- Client requests re-send**

```
POST /api/v1/auth/verify-email/resend
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Step 2 -- Server validates**

Rate limit: 3 re-sends per email per hour. Key: `email_verify_resend:<email-hash>`.

```sql
SELECT id, status, email_verified FROM users WHERE email = $1;
```

- If no user found or already verified: return `200 OK` with `{"message": "If an account exists with this email, a verification link has been sent."}`. (Do not reveal account existence.)
- If `status = 'pending_verification'` and not rate limited:
  - Delete any existing verification tokens for this user.
  - Generate new token (same as registration Step 6).
  - Send verification email.

**Step 3 -- Server returns response**

Always return the same response regardless of outcome:

```
HTTP 200 OK

{
  "message": "If an account exists with this email, a verification link has been sent."
}
```

---

## 9. Phone Verification Flow

**RPCs:** `UserService.SendPhoneOTP`, `UserService.VerifyPhone`

### 9.1 Send OTP

**Step 1 -- Client requests phone verification**

```
POST /api/v1/auth/send-phone-otp
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "phone": "+14155551234"
}
```

The user must be authenticated. Phone verification is optional and adds to the user's trust level.

**Step 2 -- Server validates phone number**

- Parse with a phone number library (e.g., `nyaruka/phonenumbers` for Go).
- Must be a valid E.164 format.
- Must not already be verified by another user:
  ```sql
  SELECT id FROM users WHERE phone = $1 AND phone_verified = true AND id != $2;
  ```
  If found: return `409 Conflict` with `{"code": "PHONE_IN_USE", "message": "This phone number is already associated with another account."}`.

**Step 3 -- Server generates OTP**

```go
otp := fmt.Sprintf("%06d", crypto_rand.Intn(1000000)) // 6-digit code
```

Store in Redis:
```
Key:   phone_otp:<user-id>
Value: {"otp_hash": "<sha256-of-otp>", "phone": "+14155551234", "attempts": 0}
TTL:   300 seconds (5 minutes)
```

Rate limit: 3 OTP requests per phone number per hour. Key: `phone_otp_rate:<phone-hash>`.

**Step 4 -- Server sends SMS**

Send via SMS provider (Twilio, etc.): `"Your NoMarkup verification code is: 123456. It expires in 5 minutes."`

**Step 5 -- Server returns response**

```
HTTP 200 OK

{
  "message": "Verification code sent.",
  "expires_in": 300
}
```

### 9.2 Verify OTP

**Step 1 -- Client sends OTP**

```
POST /api/v1/auth/verify-phone
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "code": "123456"
}
```

**Step 2 -- Server validates OTP**

```go
session := redis.Get("phone_otp:" + userID)
if session == nil {
    return error(400, "NO_PENDING_OTP", "No pending verification. Please request a new code.")
}

session.Attempts++
if session.Attempts > 5 {
    redis.Del("phone_otp:" + userID)
    return error(429, "TOO_MANY_ATTEMPTS", "Too many incorrect attempts. Please request a new code.")
}

if sha256Hex(code) != session.OTPHash {
    redis.Set("phone_otp:"+userID, session, session.TTL) // Update attempt count
    return error(400, "INVALID_CODE", "Incorrect verification code.")
}
```

**Step 3 -- Server updates user**

```sql
UPDATE users
SET phone = $1, phone_verified = true, updated_at = NOW()
WHERE id = $2;
```

Delete the Redis OTP session.

**Step 4 -- Server returns response**

```
HTTP 200 OK

{
  "message": "Phone number verified successfully."
}
```

**Error cases:**

| Condition              | Status | Code                    |
|------------------------|--------|-------------------------|
| Invalid phone format   | 400    | `INVALID_PHONE`         |
| Phone already in use   | 409    | `PHONE_IN_USE`          |
| No pending OTP         | 400    | `NO_PENDING_OTP`        |
| Incorrect code         | 400    | `INVALID_CODE`          |
| Too many attempts      | 429    | `TOO_MANY_ATTEMPTS`     |
| Rate limited (send)    | 429    | `RATE_LIMITED`          |

---

## 10. Password Reset Flow

**RPCs:** `UserService.RequestPasswordReset`, `UserService.ResetPassword`

### 10.1 Request Password Reset

**Step 1 -- Client sends reset request**

```
POST /api/v1/auth/password/reset-request
Content-Type: application/json

{
  "email": "user@example.com",
  "captcha_token": "<reCAPTCHA-v3-token>"
}
```

**Step 2 -- Server validates reCAPTCHA**

Same as registration Step 2. Score threshold >= 0.5.

**Step 3 -- Server looks up user**

```sql
SELECT id, email, status FROM users WHERE email = $1 AND password_hash IS NOT NULL;
```

Regardless of whether a user is found, always return the same 200 response (prevents enumeration).

**Step 4 -- If user found, generate reset token**

```go
raw := make([]byte, 32)
crypto_rand.Read(raw)
token := base64.RawURLEncoding.EncodeToString(raw)
tokenHash := sha256Hex(token)
```

```sql
-- Delete any existing reset tokens for this user
DELETE FROM verification_tokens WHERE user_id = $1 AND type = 'password_reset';

-- Insert new token
INSERT INTO verification_tokens (id, user_id, token_hash, type, expires_at, created_at)
VALUES (gen_ulid(), $1, $2, 'password_reset', NOW() + interval '1 hour', NOW());
```

**Step 5 -- Send email**

Send email with link: `https://nomarkup.com/auth/reset-password?token=<raw-token>`

Rate limit: 3 reset requests per email per hour. Key: `pwd_reset_rate:<email-hash>`.

**Step 6 -- Server returns response**

```
HTTP 200 OK

{
  "message": "If an account exists with this email, a password reset link has been sent."
}
```

### 10.2 Reset Password

**Step 1 -- Client sends new password**

```
POST /api/v1/auth/password/reset
Content-Type: application/json

{
  "token": "<raw-reset-token>",
  "password": "NewSecureP@ss456!"
}
```

**Step 2 -- Server validates token**

```sql
SELECT vt.id, vt.user_id, vt.expires_at
FROM verification_tokens vt
WHERE vt.token_hash = $1 AND vt.type = 'password_reset';
```

- If no row or expired: return `400 Bad Request` with `{"code": "INVALID_TOKEN", "message": "Invalid or expired reset link."}`.

**Step 3 -- Server validates new password**

Same rules as registration: min 10 chars, complexity requirements, breached password check. Must not be the same as the current password.

**Step 4 -- Server updates password and revokes all sessions**

```sql
BEGIN;

-- Hash new password (argon2id, same params as registration)
UPDATE users
SET password_hash = $1, updated_at = NOW()
WHERE id = $2;

-- Delete the used reset token
DELETE FROM verification_tokens WHERE id = $3;

-- Delete ALL reset tokens for this user (invalidate any other pending resets)
DELETE FROM verification_tokens WHERE user_id = $2 AND type = 'password_reset';

-- Revoke ALL refresh tokens (force re-login on all devices)
UPDATE refresh_tokens
SET revoked_at = NOW()
WHERE user_id = $2 AND revoked_at IS NULL;

COMMIT;
```

**Step 5 -- Server returns response**

```
HTTP 200 OK

{
  "message": "Password reset successfully. Please log in with your new password."
}
```

Send a notification email: "Your password was just changed. If you did not do this, contact support immediately."

**Error cases:**

| Condition               | Status | Code                    |
|-------------------------|--------|-------------------------|
| reCAPTCHA failed        | 403    | `CAPTCHA_FAILED`        |
| Invalid/expired token   | 400    | `INVALID_TOKEN`         |
| Weak password           | 400    | `WEAK_PASSWORD`         |
| Same as old password    | 400    | `PASSWORD_REUSED`       |
| Rate limited            | 429    | `RATE_LIMITED`          |

---

## 11. MFA Flow

**RPCs:** `UserService.EnableMFA`, `UserService.VerifyMFA`, `UserService.DisableMFA`

### 11.1 Enable MFA (TOTP Setup)

**Step 1 -- Client requests MFA setup**

```
POST /api/v1/auth/mfa/enable
Authorization: Bearer <access-token>
```

**Step 2 -- Server generates TOTP secret**

```go
secret := make([]byte, 20) // 160 bits
crypto_rand.Read(secret)
base32Secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(secret)

// Generate provisioning URI for QR code
uri := fmt.Sprintf("otpauth://totp/NoMarkup:%s?secret=%s&issuer=NoMarkup&algorithm=SHA1&digits=6&period=30",
    url.QueryEscape(user.Email), base32Secret)
```

Store the secret temporarily in Redis (NOT in the DB yet -- MFA is not enabled until the user confirms):

```
Key:   mfa_setup:<user-id>
Value: {"secret": "<base32-secret>"}
TTL:   600 seconds (10 minutes)
```

**Step 3 -- Server generates backup codes**

```go
backupCodes := make([]string, 10)
for i := range backupCodes {
    raw := make([]byte, 4) // 8 hex chars
    crypto_rand.Read(raw)
    backupCodes[i] = fmt.Sprintf("%x", raw) // e.g., "a1b2c3d4"
}
```

Store the backup codes temporarily alongside the secret in Redis.

**Step 4 -- Server returns setup data**

```
HTTP 200 OK

{
  "secret": "JBSWY3DPEHPK3PXP",
  "provisioning_uri": "otpauth://totp/NoMarkup:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=NoMarkup&algorithm=SHA1&digits=6&period=30",
  "backup_codes": [
    "a1b2c3d4", "e5f6a7b8", "c9d0e1f2", "a3b4c5d6", "e7f8a9b0",
    "c1d2e3f4", "a5b6c7d8", "e9f0a1b2", "c3d4e5f6", "a7b8c9d0"
  ]
}
```

The client shows the QR code (generated from `provisioning_uri`) and the backup codes. The user must save the backup codes.

**Step 5 -- Client confirms MFA with a TOTP code**

```
POST /api/v1/auth/mfa/verify
Content-Type: application/json

{
  "mfa_token": null,
  "code": "123456",
  "type": "totp_setup"
}
```

Note: This endpoint serves dual purpose. When `type` is `"totp_setup"`, it confirms MFA enablement. When `type` is `"totp"` or `"backup_code"` and `mfa_token` is present, it completes a login MFA challenge.

**Step 6 -- Server validates TOTP code**

```go
setupSession := redis.Get("mfa_setup:" + userID)
if setupSession == nil {
    return error(400, "NO_PENDING_SETUP", "No pending MFA setup. Please start again.")
}

// Validate TOTP (allow 1 step of clock skew: current, previous, next 30-second window)
valid := totp.Validate(code, setupSession.Secret, totp.ValidateOpts{
    Period: 30,
    Skew:   1,
    Digits: 6,
})

if !valid {
    return error(400, "INVALID_CODE", "Incorrect verification code. Please try again.")
}
```

**Step 7 -- Server persists MFA configuration**

```go
// Hash backup codes for storage
hashedCodes := make([]string, len(setupSession.BackupCodes))
for i, code := range setupSession.BackupCodes {
    hashedCodes[i] = sha256Hex(code)
}
```

```sql
UPDATE users
SET mfa_enabled = true,
    mfa_secret = $1,   -- Encrypted at rest (AES-256-GCM with key from KMS)
    mfa_backup_codes = $2,  -- Array of SHA-256 hashes
    updated_at = NOW()
WHERE id = $3;
```

Delete the Redis setup session.

**Step 8 -- Server returns confirmation**

```
HTTP 200 OK

{
  "message": "MFA enabled successfully."
}
```

### 11.2 MFA Verification During Login

When login returns `mfa_required: true` (see Section 3, Step 5):

**Step 1 -- Client sends MFA code**

```
POST /api/v1/auth/mfa/verify
Content-Type: application/json

{
  "mfa_token": "<temporary-mfa-session-token>",
  "code": "123456",
  "type": "totp"
}
```

OR, with backup code:

```json
{
  "mfa_token": "<temporary-mfa-session-token>",
  "code": "a1b2c3d4",
  "type": "backup_code"
}
```

**Step 2 -- Server validates MFA session token**

```go
tokenHash := sha256Hex(mfaToken)
session := redis.Get("mfa_session:" + tokenHash)
if session == nil {
    return error(401, "INVALID_MFA_SESSION", "MFA session expired. Please log in again.")
}
```

**Step 3 -- Server validates the code**

For TOTP:
```go
var mfaSecret string
db.QueryRow("SELECT mfa_secret FROM users WHERE id = $1", session.UserID).Scan(&mfaSecret)
decryptedSecret := decrypt(mfaSecret) // AES-256-GCM

valid := totp.Validate(code, decryptedSecret, totp.ValidateOpts{Period: 30, Skew: 1, Digits: 6})
if !valid {
    // Increment attempt counter in the Redis session
    session.Attempts++
    if session.Attempts >= 5 {
        redis.Del("mfa_session:" + tokenHash)
        return error(429, "TOO_MANY_ATTEMPTS", "Too many attempts. Please log in again.")
    }
    redis.Set("mfa_session:"+tokenHash, session, session.RemainingTTL)
    return error(400, "INVALID_CODE", "Incorrect verification code.")
}
```

For backup code:
```go
codeHash := sha256Hex(code)
var backupCodes []string
db.QueryRow("SELECT mfa_backup_codes FROM users WHERE id = $1", session.UserID).Scan(&backupCodes)

found := false
for i, stored := range backupCodes {
    if stored == codeHash {
        // Remove the used code
        backupCodes = append(backupCodes[:i], backupCodes[i+1:]...)
        found = true
        break
    }
}

if !found {
    return error(400, "INVALID_CODE", "Invalid backup code.")
}

// Update remaining backup codes
db.Exec("UPDATE users SET mfa_backup_codes = $1 WHERE id = $2", backupCodes, session.UserID)

// If fewer than 3 codes remain, warn the user in the response
```

**Step 4 -- Server issues tokens**

Same as login Step 6 (JWT access token + refresh token cookie). Delete the MFA session from Redis.

**Step 5 -- Server returns response**

```
HTTP 200 OK
Set-Cookie: refresh_token=<raw-refresh-token>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=3600

{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "expires_in": 900,
  "user": { ... },
  "backup_codes_remaining": 9
}
```

If `backup_codes_remaining < 3`, also include `"backup_codes_warning": "You have few backup codes remaining. Please generate new ones."`.

### 11.3 Disable MFA

**Step 1 -- Client requests MFA disable**

```
POST /api/v1/auth/mfa/disable
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "password": "SecureP@ss123!",
  "code": "123456"
}
```

Requires BOTH the current password AND a valid TOTP code (or backup code) to disable MFA. This prevents an attacker who has the password but not the device from disabling MFA.

**Step 2 -- Server validates password**

```go
match, _ := argon2id.ComparePasswordAndHash(password, user.PasswordHash)
if !match {
    return error(401, "INVALID_CREDENTIALS", "Incorrect password.")
}
```

**Step 3 -- Server validates TOTP code**

Same as MFA verification Step 3 (TOTP path).

**Step 4 -- Server disables MFA**

```sql
UPDATE users
SET mfa_enabled = false, mfa_secret = NULL, mfa_backup_codes = NULL, updated_at = NOW()
WHERE id = $1;
```

**Step 5 -- Server returns response**

```
HTTP 200 OK

{
  "message": "MFA has been disabled."
}
```

Send notification email: "MFA was just disabled on your account. If you did not do this, secure your account immediately."

---

## 12. Session Management

### 12.1 Concurrent Device Limit

Maximum **3** concurrent sessions per user (enforced at login -- see Section 3, Step 7).

Each session corresponds to one row in `refresh_tokens` with `revoked_at IS NULL AND expires_at > NOW()`.

### 12.2 Activity Tracking

- `last_active_at` on the `users` table is updated on every authenticated request, debounced to at most once per 60 seconds per user (see Section 5.2).
- This timestamp drives inactivity timeout decisions.

### 12.3 Inactivity Timeout

Checked by the `inactivityCheck` middleware (Section 5.3) on every authenticated request:

| Role       | Timeout    |
|------------|------------|
| `admin`    | 30 minutes |
| `support`  | 30 minutes |
| `analyst`  | 60 minutes |
| `provider` | 120 minutes|
| `customer` | 60 minutes |

If the user has multiple roles, the **shortest** timeout applies.

When timeout fires:
1. All refresh tokens for the user are revoked.
2. The current request returns `401` with `SESSION_TIMEOUT`.
3. The access token's remaining lifetime (up to 15 min) is a grace window. In practice, the frontend should redirect to login immediately on receiving `SESSION_TIMEOUT`.

### 12.4 Active Session Listing

Users can view their active sessions:

```
GET /api/v1/auth/sessions
Authorization: Bearer <access-token>
```

Returns:

```json
{
  "sessions": [
    {
      "id": "01902a3b-...",
      "device_info": "Mozilla/5.0 (Macintosh; ...)",
      "ip_address": "203.0.113.42",
      "created_at": "2026-03-01T10:00:00Z",
      "last_used_at": "2026-03-01T11:30:00Z",
      "current": true
    },
    {
      "id": "01902a3c-...",
      "device_info": "NoMarkup-iOS/1.0",
      "ip_address": "198.51.100.7",
      "created_at": "2026-02-28T08:00:00Z",
      "last_used_at": "2026-03-01T09:00:00Z",
      "current": false
    }
  ]
}
```

### 12.5 Revoke Specific Session

```
DELETE /api/v1/auth/sessions/:sessionId
Authorization: Bearer <access-token>
```

```sql
UPDATE refresh_tokens
SET revoked_at = NOW()
WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL;
```

Returns `204 No Content` on success.

---

## 13. Logout Flow

**RPC:** `UserService.Logout`

**Step 1 -- Client sends logout request**

```
POST /api/v1/auth/logout
Authorization: Bearer <access-token>
Cookie: refresh_token=<raw-refresh-token>
```

**Step 2 -- Server revokes refresh token**

```go
rawToken := r.Cookie("refresh_token")
if rawToken != nil {
    tokenHash := sha256Hex(rawToken.Value)
    db.Exec("UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1", tokenHash)
}
```

**Step 3 -- Server adds access token JTI to revocation list**

```go
jti := r.Context().Value(ctxKeyJTI).(string)
// Add to Redis set with TTL matching the token's remaining lifetime
remainingTTL := claims.ExpiresAt.Time.Sub(time.Now())
if remainingTTL > 0 {
    redis.Set("revoked_jti:"+jti, "1", remainingTTL)
}
```

This ensures the access token is immediately invalidated, even though it has not expired yet. The JTI check in the middleware (Section 5.1, step 3) catches this.

**Step 4 -- Server clears the refresh token cookie**

```
HTTP 200 OK
Set-Cookie: refresh_token=; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT

{
  "message": "Logged out successfully."
}
```

Setting `Max-Age=0` and a past `Expires` instructs the browser to delete the cookie.

### 13.1 Logout All Devices

```
POST /api/v1/auth/logout-all
Authorization: Bearer <access-token>
```

```sql
UPDATE refresh_tokens
SET revoked_at = NOW()
WHERE user_id = $1 AND revoked_at IS NULL;
```

Also adds the current access token's JTI to the revocation list and clears the cookie.

Returns:

```
HTTP 200 OK
Set-Cookie: refresh_token=; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT

{
  "message": "Logged out of all devices."
}
```

Note: Other devices' access tokens will remain valid for up to 15 minutes (their remaining lifetime), but they will not be able to refresh.

---

## 14. Security Headers

Applied globally by the `securityHeaders` middleware (position 5 in the chain).

```go
func securityHeaders(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // HSTS: enforce HTTPS for 2 years, include subdomains, allow preload
        w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")

        // Prevent clickjacking
        w.Header().Set("X-Frame-Options", "DENY")

        // Prevent MIME type sniffing
        w.Header().Set("X-Content-Type-Options", "nosniff")

        // XSS protection (legacy, but still set for older browsers)
        w.Header().Set("X-XSS-Protection", "1; mode=block")

        // Referrer policy: only send origin for cross-origin requests
        w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

        // Permissions policy: disable unnecessary browser features
        w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)")

        // Content Security Policy (for API responses, restrictive)
        w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")

        // Prevent caching of auth responses
        if strings.HasPrefix(r.URL.Path, "/api/v1/auth") {
            w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, private")
            w.Header().Set("Pragma", "no-cache")
        }

        next.ServeHTTP(w, r)
    })
}
```

### 14.1 CORS Configuration

```go
func corsMiddleware(next http.Handler) http.Handler {
    cors := cors.New(cors.Options{
        AllowedOrigins:   []string{"https://nomarkup.com", "https://www.nomarkup.com"},
        AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
        AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Request-ID"},
        ExposedHeaders:   []string{"X-Request-ID", "Retry-After"},
        AllowCredentials: true,  // Required for cookies
        MaxAge:           86400, // Preflight cache: 24 hours
    })
    return cors.Handler(next)
}
```

In development/staging, `AllowedOrigins` can include `http://localhost:3000`. This MUST be driven by environment configuration, never hardcoded.

---

## 15. Frontend Auth State (Next.js 15)

### 15.1 Auth Storage Strategy

| Token          | Storage Location                      | Accessible By    |
|----------------|---------------------------------------|-------------------|
| Access token   | In-memory variable (React state/ref)  | JavaScript only   |
| Refresh token  | HTTP-only `Secure` cookie             | Browser auto-sends|

The access token is NEVER stored in `localStorage` or `sessionStorage` (XSS risk). It lives only in a JavaScript variable and is lost on page refresh (by design -- the app silently refreshes on mount).

### 15.2 Auth Context Provider

```tsx
// /app/providers/auth-provider.tsx
"use client";

import { createContext, useContext, useCallback, useRef, useState, useEffect } from "react";

interface User {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  emailVerified: boolean;
  mfaEnabled: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const accessTokenRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  const setAccessToken = useCallback((token: string | null) => {
    accessTokenRef.current = token;

    // Schedule refresh 1 minute before expiry (at 14 minutes)
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    if (token) {
      refreshTimerRef.current = setTimeout(() => {
        refreshAuth();
      }, 14 * 60 * 1000); // 14 minutes
    }
  }, []);

  const refreshAuth = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include", // Send cookies
      });

      if (!res.ok) {
        setAccessToken(null);
        setUser(null);
        return false;
      }

      const data = await res.json();
      setAccessToken(data.access_token);
      return true;
    } catch {
      setAccessToken(null);
      setUser(null);
      return false;
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (data.mfa_required) {
      return { mfaRequired: true, mfaToken: data.mfa_token, mfaMethods: data.mfa_methods };
    }

    if (!res.ok) {
      throw new AuthError(data.code, data.message);
    }

    setAccessToken(data.access_token);
    setUser(data.user);
    return { mfaRequired: false };
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { Authorization: `Bearer ${accessTokenRef.current}` },
    });
    setAccessToken(null);
    setUser(null);
  }, []);

  // Silent refresh on mount (recovers session after page refresh)
  useEffect(() => {
    refreshAuth().finally(() => setIsLoading(false));
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!accessTokenRef.current,
      accessToken: accessTokenRef.current,
      login,
      logout,
      refreshAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
```

### 15.3 Authenticated Fetch Wrapper

```tsx
// /lib/api-client.ts
import { useAuth } from "@/app/providers/auth-provider";

export function useApiClient() {
  const { accessToken, refreshAuth, logout } = useAuth();

  const apiFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const makeRequest = (token: string) =>
      fetch(url, {
        ...options,
        credentials: "include",
        headers: {
          ...options.headers,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

    let res = await makeRequest(accessToken!);

    // If 401, try refreshing the token once
    if (res.status === 401) {
      const refreshed = await refreshAuth();
      if (refreshed) {
        res = await makeRequest(accessToken!); // accessToken was updated by refreshAuth
      } else {
        await logout();
        window.location.href = "/auth/login";
        throw new Error("Session expired");
      }
    }

    return res;
  };

  return { apiFetch };
}
```

### 15.4 Next.js Middleware (Edge)

```tsx
// /middleware.ts
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/",
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
  "/auth/callback",
];

const ROLE_ROUTES: Record<string, string[]> = {
  "/admin": ["admin"],
  "/provider": ["provider"],
  "/support": ["admin", "support"],
  "/analytics": ["admin", "analyst"],
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Allow API routes (auth is handled by the gateway)
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Check for a lightweight session indicator cookie
  // This is NOT the refresh token. It's a separate non-HttpOnly cookie
  // set by the frontend after successful login, used only for routing decisions.
  const sessionIndicator = request.cookies.get("has_session");
  if (!sessionIndicator) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Role-based route protection (coarse-grained; fine-grained is in the API)
  const userRoles = request.cookies.get("user_roles")?.value?.split(",") || [];
  for (const [routePrefix, requiredRoles] of Object.entries(ROLE_ROUTES)) {
    if (pathname.startsWith(routePrefix)) {
      const hasRole = requiredRoles.some((r) => userRoles.includes(r));
      if (!hasRole) {
        return NextResponse.redirect(new URL("/", request.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};
```

### 15.5 Session Indicator Cookies

After successful login (or token refresh), the frontend sets two lightweight, non-sensitive cookies that the Next.js Edge Middleware can read for routing:

```tsx
// Set after login or MFA completion
document.cookie = "has_session=1; path=/; secure; samesite=strict; max-age=7200";
document.cookie = `user_roles=${user.roles.join(",")}; path=/; secure; samesite=strict; max-age=7200`;
```

On logout:

```tsx
document.cookie = "has_session=; path=/; secure; samesite=strict; max-age=0";
document.cookie = "user_roles=; path=/; secure; samesite=strict; max-age=0";
```

These cookies contain NO secrets. They are hints for the middleware to avoid unnecessary redirects. The actual authorization always happens server-side via the JWT.

### 15.6 Full Authentication Lifecycle

1. **Page load (no session):** User visits any protected page. Next.js middleware sees no `has_session` cookie, redirects to `/auth/login?redirect=/original-path`.
2. **Login:** User submits credentials. Frontend calls `POST /api/v1/auth/login`. On success, stores access token in memory, sets session indicator cookies, redirects to original path.
3. **Authenticated request:** Frontend uses `apiFetch()` which attaches the `Authorization: Bearer` header. Gateway middleware validates JWT, injects user context, routes to handler.
4. **Token expiry approaching:** 14 minutes after login, the refresh timer fires. Frontend calls `POST /api/v1/auth/refresh` (browser auto-sends the refresh cookie). New access token stored in memory. New refresh cookie set by server.
5. **Page refresh:** Access token is lost (memory-only). `AuthProvider` calls `refreshAuth()` on mount. If the refresh cookie is still valid, new tokens are issued. User stays logged in.
6. **Inactivity:** If the user is idle past their role-based timeout, the next API call returns `401 SESSION_TIMEOUT`. The frontend detects this, clears state, redirects to login.
7. **Logout:** User clicks logout. Frontend calls `POST /api/v1/auth/logout`. Server revokes refresh token, adds access JTI to revocation list, clears cookie. Frontend clears memory state and session indicator cookies. Redirects to login.

---

## Appendix A: Environment Variables

| Variable                  | Description                                  | Example                           |
|---------------------------|----------------------------------------------|-----------------------------------|
| `JWT_PRIVATE_KEY`         | RSA private key (PEM) for signing JWTs       | `-----BEGIN RSA PRIVATE KEY-----` |
| `JWT_PUBLIC_KEY`          | RSA public key (PEM) for verifying JWTs      | `-----BEGIN PUBLIC KEY-----`      |
| `JWT_KEY_ID`              | Key ID for JWKS                              | `a1b2c3d4`                        |
| `GOOGLE_CLIENT_ID`        | Google OAuth client ID                       | `123...apps.googleusercontent.com`|
| `GOOGLE_CLIENT_SECRET`    | Google OAuth client secret                   | `GOCSPX-...`                      |
| `APPLE_SERVICE_ID`        | Apple Sign In service ID                     | `com.nomarkup.auth`               |
| `APPLE_TEAM_ID`           | Apple Developer Team ID                      | `A1B2C3D4E5`                      |
| `APPLE_KEY_ID`            | Apple private key ID                         | `K1L2M3N4O5`                      |
| `APPLE_PRIVATE_KEY`       | Apple private key (PEM, ES256)               | `-----BEGIN EC PRIVATE KEY-----`  |
| `RECAPTCHA_SECRET_KEY`    | Google reCAPTCHA v3 secret key               | `6Le...`                          |
| `RECAPTCHA_SITE_KEY`      | Google reCAPTCHA v3 site key (frontend)      | `6Le...`                          |
| `MFA_ENCRYPTION_KEY`      | AES-256-GCM key for encrypting TOTP secrets  | 32-byte base64                    |
| `DATABASE_URL`            | PostgreSQL connection string                 | `postgres://user:pass@host/db`    |
| `REDIS_URL`               | Redis connection string                      | `redis://host:6379/0`             |
| `SMS_PROVIDER_API_KEY`    | Twilio or similar API key                    | `SK...`                           |
| `EMAIL_PROVIDER_API_KEY`  | SendGrid, SES, or similar API key            | `SG...`                           |
| `BASE_URL`                | Public-facing base URL                       | `https://api.nomarkup.com`        |
| `FRONTEND_URL`            | Frontend base URL                            | `https://nomarkup.com`            |

## Appendix B: Redis Key Patterns

| Key Pattern                         | TTL          | Purpose                                    |
|-------------------------------------|--------------|---------------------------------------------|
| `auth:login:<ip>:<email-hash>`      | 15 min       | Login rate limiting                         |
| `mfa_session:<token-hash>`          | 5 min        | Temporary MFA challenge session             |
| `mfa_setup:<user-id>`               | 10 min       | Pending MFA enablement                      |
| `phone_otp:<user-id>`               | 5 min        | Pending phone verification                  |
| `phone_otp_rate:<phone-hash>`       | 1 hour       | Phone OTP send rate limiting                |
| `email_verify_resend:<email-hash>`  | 1 hour       | Email re-send rate limiting                 |
| `pwd_reset_rate:<email-hash>`       | 1 hour       | Password reset request rate limiting        |
| `oauth_state:<state-hash>`          | 10 min       | OAuth CSRF state                            |
| `revoked_jti:<jti>`                 | <= 15 min    | Revoked access token JTI                    |
| `last_active:<user-id>`             | 60 sec       | Activity tracking debounce                  |

## Appendix C: Database Schema Additions

Beyond the tables listed in the context, the following table is needed for verification and password reset tokens:

```sql
CREATE TABLE verification_tokens (
    id             UUID PRIMARY KEY DEFAULT gen_ulid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash     TEXT NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('email_verification', 'password_reset')),
    expires_at     TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_verification_token_hash UNIQUE (token_hash)
);

CREATE INDEX idx_verification_tokens_user_type ON verification_tokens(user_id, type);
CREATE INDEX idx_verification_tokens_expires ON verification_tokens(expires_at);
```

Also add a `replaced_by` column to `refresh_tokens` for the race condition grace period:

```sql
ALTER TABLE refresh_tokens ADD COLUMN replaced_by UUID REFERENCES refresh_tokens(id);
```

## Appendix D: Error Response Format

All auth error responses follow this structure:

```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable message."
}
```

HTTP status codes used:

| Status | Meaning                                           |
|--------|---------------------------------------------------|
| 200    | Success                                           |
| 201    | Created (registration)                            |
| 204    | No content (session revocation)                   |
| 302    | Redirect (OAuth, email verification)              |
| 400    | Bad request (validation, invalid tokens)          |
| 401    | Unauthorized (missing/invalid/expired auth)       |
| 403    | Forbidden (suspended account, captcha, wrong role)|
| 409    | Conflict (duplicate email, phone in use)          |
| 429    | Rate limited                                      |
| 500    | Internal server error                             |
