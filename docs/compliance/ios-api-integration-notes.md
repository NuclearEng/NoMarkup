# iOS API integration notes — Stage B1 (Auth, session, account lifecycle)

**Date:** 2026-07-26  
**Audience:** Native iOS / Stage B1 client  
**Scope:** Gateway HTTP surface only (not gRPC). Paths and JSON shapes verified against the current tree.  
**Code authority:** prefer this document’s path:line citations over `docs/auth-flow.md` where they disagree (that doc still has some aspirational paths).

---

## 1. Base URL

| Environment | Typical base |
|-------------|--------------|
| Local gateway | `http://localhost:8080` (see `.env.example` `NEXT_PUBLIC_API_URL`, `API_URL`) |
| Local web rewrite | Next proxies `/api/v1/*` to the gateway (`web/next.config.ts`); native apps should call the **gateway** origin directly |
| Production zone | Public product zone is **`no-markup.com`** (hyphenated). Exact API host is deploy-config; do not hardcode until DNS is provisioned |

All routes below are under:

```text
{BASE}/api/v1/...
```

Example local login:

```text
POST http://localhost:8080/api/v1/auth/login
```

Env knobs that affect OAuth redirects (server-side, not client):

| Variable | Role | Default (dev) |
|----------|------|----------------|
| `OAUTH_REDIRECT_BASE` | Apple/Google callback host prefix | `http://localhost:8080` |
| `FRONTEND_URL` | Post-OAuth browser redirect target | `http://localhost:3000` |
| `APPLE_CLIENT_ID` / `APPLE_CLIENT_SECRET` | Apple web Services ID + client secret JWT | required if Apple login enabled |
| `JWT_ISSUER` / `JWT_AUDIENCE` | Access JWT `iss` / `aud` validation | `https://auth.nomarkup.com` / `nomarkup-api` |

Sources: `.env.example` (OAuth + frontend block), `gateway/internal/handler/oauth.go` (redirect base / frontend URL), `gateway/internal/middleware/auth.go` (issuer/audience defaults).

---

## 2. What the mobile client must send

### 2.1 Authenticated API calls

Protected routes are mounted with `authMW.Handler` (`gateway/internal/router/router.go` ~422–423). Middleware **only** accepts:

```http
Authorization: Bearer <access_jwt>
```

Evidence: `gateway/internal/middleware/auth.go:83–102` — missing header → `401 {"error":"missing authorization header"}`; non-`Bearer ` prefix → `401 {"error":"invalid authorization header format"}`; invalid/expired JWT → `401 {"error":"invalid or expired token"}`; iss/aud mismatch → `401 {"error":"invalid token","code":"auth_invalid_claims"}`.

There is **no** “access token cookie” path for API auth. Web stores the access JWT in **memory** (`web/src/lib/auth.ts`) and attaches `Authorization: Bearer` on every call (`web/src/lib/api.ts:102–105`).

Recommended headers on authenticated JSON requests:

| Header | Required | Notes |
|--------|----------|--------|
| `Authorization: Bearer <access_token>` | **Yes** on protected routes | RS256 JWT; ~15 min TTL (product rule) |
| `Content-Type: application/json` | Yes when body present | Gateway `decodeJSON` expects JSON |
| `Idempotency-Key` | On payment/subscription POSTs only | `middleware.RequireIdempotencyKey` |
| `X-Request-ID` | Optional | Honored for trace correlation |

Access JWT claims used server-side (`middleware.Claims`): `sub` → user id, `email`, `roles[]`, `exp`. Issuer/audience must match env (defaults above).

### 2.2 Cookie vs body for **refresh** tokens

| Artifact | Wire | Mobile impact |
|----------|------|----------------|
| **Access token** | JSON body field `access_token` on login/register/refresh/MFA; **never** HttpOnly cookie for API auth | Store in Keychain; send as Bearer |
| **Refresh token** | Primarily `Set-Cookie: refresh_token=...; HttpOnly; Path=/api/v1/auth; Max-Age=604800` (7 days) on login/register/refresh/OAuth complete | Cookie jar **or** capture cookie value and POST it in body |
| **Session sentinel** | `Set-Cookie: has_session=1; Path=/; HttpOnly=false` | Web-only UX; ignore on iOS |

Login / register / refresh response **JSON does not include `refresh_token`** (`authResponse` in `gateway/internal/handler/auth.go:79–85`). Refresh **accepts** either cookie or body:

```json
{ "refresh_token": "<opaque>" }
```

(`auth.go:314–326`, `logout` same pattern at `393–405`.)

**Mobile recommendation:**

1. Prefer explicit body mode for Stage B1: after login, read `Set-Cookie: refresh_token` from the response (URLSession cookie storage or manual parse) and persist **only** in Keychain.
2. On refresh/logout, send JSON body `{ "refresh_token": "..." }` — do **not** rely on browser-style `credentials: "include"` alone.
3. Do **not** put refresh tokens in UserDefaults, logs, or analytics.
4. Access token: Keychain (or memory + re-fetch on cold start via refresh). Match web: never `localStorage` equivalents.

### 2.3 CORS

`ALLOWED_ORIGINS` applies to browser clients. Native URLSession is not subject to browser CORS; still call HTTPS origins in staging/prod and keep certificates valid.

---

## 3. Email / password auth

Router: `gateway/internal/router/router.go:151–190`.

### 3.1 Register

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Password1!",
  "display_name": "Alex",
  "roles": ["customer"]
}
```

Rules (`auth.go:201–247`): email must look valid; password ≥ 8 chars and letter + digit/symbol; `roles` may include `customer` / `provider` only (not `admin`).

**201 Created** body:

```json
{
  "user_id": "<uuid>",
  "access_token": "<jwt>",
  "access_token_expires_at": "2006-01-02T15:04:05Z"
}
```

Plus `Set-Cookie: refresh_token=...` (HttpOnly).

### 3.2 Login

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Password1!"
}
```

**200 OK** body (`auth.go:283–289`):

```json
{
  "user_id": "<uuid>",
  "access_token": "<jwt>",
  "access_token_expires_at": "2006-01-02T15:04:05Z",
  "mfa_required": false,
  "mfa_challenge_token": ""
}
```

If MFA is on, `mfa_required: true`, tokens empty/partial, and `mfa_challenge_token` is set — complete with:

```http
POST /api/v1/auth/mfa/verify
Content-Type: application/json

{
  "mfa_challenge_token": "<from login>",
  "totp_code": "123456"
}
```

Unverified email → **403** `"Please verify your email before signing in"` (`auth.go:263–265`).

### 3.3 Refresh

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{ "refresh_token": "<opaque>" }
```

(or rely on `refresh_token` cookie if the client cookie store sends it)

**200**:

```json
{
  "access_token": "<jwt>",
  "access_token_expires_at": "2006-01-02T15:04:05Z"
}
```

Idle timeout can reject refresh with **401** and clear `has_session` (`auth.go:353–362`). Rotated refresh is also re-set via cookie.

### 3.4 Logout

```http
POST /api/v1/auth/logout
Content-Type: application/json

{ "refresh_token": "<opaque>" }
```

Public (no Bearer required). **204** empty body. Best-effort: missing refresh still clears cookies (`auth.go:407–432`).

### 3.5 Related public auth helpers

| Method | Path | Body (summary) |
|--------|------|----------------|
| POST | `/api/v1/auth/verify-email` | `{ "token" }` |
| POST | `/api/v1/auth/resend-verification` | `{ "email" }` |
| POST | `/api/v1/auth/request-password-reset` | `{ "email" }` |
| POST | `/api/v1/auth/reset-password` | `{ "token", "new_password" }` |
| POST | `/api/v1/auth/change-password` | Bearer + `{ "current_password", "new_password" }` |
| POST | `/api/v1/auth/register-phone` | `{ "phone": "+1…", "otp_code" }` (phone-only signup) |

Errors are generally `{"error":"<message>"}` (`response.go:69–70`).

---

## 4. Apple OAuth (web redirect + **native SIWA**)

### 4.1 Mounted routes

From `router.go` auth routes:

| Method | Path | Handler |
|--------|------|---------|
| **GET** | `/api/v1/auth/oauth/apple` | `InitAppleOAuth` — browser redirect to Apple |
| **POST** | `/api/v1/auth/callback/apple` | `AppleOAuthCallback` — Apple `form_post` |
| **POST** | `/api/v1/auth/apple/native` | `NativeAppleSignIn` — AuthenticationServices `identity_token` → JSON tokens |
| **POST** | `/api/v1/auth/google/native` | `NativeGoogleSignIn` — Google OIDC `id_token` (ASWebAuth + PKCE) → JSON tokens |

Google/Facebook web parallels: GET init + GET callback under the same `/api/v1/auth` prefix.
**Native Google (FR-1.1):** iOS uses `ASWebAuthenticationSession` + PKCE against Google
(public iOS client, no client secret), then `POST /api/v1/auth/google/native` with the
verified-by-gateway id_token. Audience accepts `GOOGLE_CLIENT_ID` and/or `GOOGLE_IOS_CLIENT_ID`.
**Not** a WebView of the cookie redirect flow; **no** fabricated Google SDK tokens.

### 4.0 Native SIWA (Stage B1 — shipped)

```http
POST /api/v1/auth/apple/native
Content-Type: application/json

{
  "identity_token": "<JWT from ASAuthorizationAppleIDCredential>",
  "full_name": "Optional First Last",
  "nonce": ""
}
```

**200:**

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<opaque>",
  "access_token_expires_at": "…",
  "is_new_user": false,
  "user_id": "<uuid>"
}
```

Audience verification accepts `APPLE_CLIENT_ID` and/or `APPLE_NATIVE_CLIENT_ID` (iOS bundle id).  
iOS: `APIClient.signInWithApple` + Keychain storage.

### 4.2 Web flow (what exists today)

1. **Browser** opens `GET {BASE}/api/v1/auth/oauth/apple`.
2. Gateway sets HttpOnly `oauth_state` cookie (`Path=/api/v1/auth`, **SameSite=None; Secure=true** for Apple — required because callback is cross-site POST) and 302s to Apple (`oauth.go:234–260`).
3. Apple **POSTs** `application/x-www-form-urlencoded` to  
   `{OAUTH_REDIRECT_BASE}/api/v1/auth/callback/apple`  
   with `code`, `state`, optional `user` (first authorize only), optional `error` (`oauth.go:263–308`).
4. Gateway validates state cookie, exchanges `code` at Apple’s token endpoint, verifies `id_token` via Apple JWKS (`verifyAppleIDToken`, `oauth.go:485–528`), calls user-service `FindOrCreateByOAuth` with `provider="apple"`.
5. **`completeOAuthLogin`** (`oauth.go:391–446`):
   - Sets HttpOnly `refresh_token` cookie
   - Sets non-HttpOnly `oauth_access_token` + `oauth_token_expires` (60s, JS-readable) for the SPA
   - **302** to `{FRONTEND_URL}/dashboard` or `/onboarding` (new user)

There is **no** JSON success body for Apple login — only cookies + browser redirect.

### 4.3 Why this does not work for native Sign in with Apple (SIWA)

| Native SIWA gives you | Backend expects |
|-----------------------|-----------------|
| `ASAuthorizationAppleIDCredential.identityToken` (JWT) | Web authorization `code` via Apple **form_post** callback |
| Optional `authorizationCode` | Server-side `oauth2.Config.Exchange` against redirect URI registered for **web** Services ID |
| App Bundle ID / App ID as audience | `APPLE_CLIENT_ID` as JWT `aud` (Services ID for web) |
| No browser cookies | CSRF `oauth_state` **cookie** on callback |

Native clients **cannot** complete `InitAppleOAuth` → `AppleOAuthCallback` without a system browser + cookie jar + redirect URI registered as the web Services ID callback. That is not an App Store–quality SIWA path.

**Resolved (Stage B1):** `POST /api/v1/auth/apple/native` reuses `verifyAppleIDToken` with multi-audience (`APPLE_CLIENT_ID` + `APPLE_NATIVE_CLIENT_ID`), then `FindOrCreateByOAuth`, returns JSON tokens via `completeOAuthLoginJSON`. Web form_post flow remains for Safari OAuth.

### 4.4 OAuth account list / unlink (works once session exists)

Auth required. Routes (`router.go:443–444`, handlers in `oauth_accounts.go`):

```http
GET /api/v1/users/me/oauth-accounts
Authorization: Bearer <access_token>
```

**200:**

```json
{
  "accounts": [
    {
      "provider": "apple",
      "email": "user@privaterelay.appleid.com",
      "linked_at": "2026-01-15T12:00:00Z"
    }
  ]
}
```

(`provider_id` is intentionally omitted.)

```http
DELETE /api/v1/users/me/oauth-accounts/apple
Authorization: Bearer <access_token>
```

Providers: `google` | `apple` | `facebook` (else **400** `unsupported provider`).

**200:**

```json
{ "unlinked": true, "provider": "apple" }
```

**409** if unlinking the last sign-in method and no password is set (`canUnlinkOAuth`, `oauth_accounts.go:45–56`, `174–177`).

---

## 5. Account deletion (GDPR / CCPA erasure)

```http
DELETE /api/v1/users/me
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "reason": "no longer needed",
  "confirmation": "DELETE"
}
```

- Handler: `UserHandler.RequestMyDeletion` — `gateway/internal/handler/user.go:161–204`
- Router: `router.go:449–450`
- Confirmation phrase (case-insensitive, trimmed): **`DELETE`**  
  (`services/user/internal/domain/types.go:65–68`)
- Body is **required** (`decodeJSON`); empty body → **400**
- Wrong confirmation → gRPC InvalidArgument → **400** `"deletion confirmation phrase invalid"`
- Starts a **30-day grace** window (`DeletionGracePeriod`); cascade is async (cron / admin finalize)

**200 sample:**

```json
{
  "created": true,
  "grace_deadline": "2026-08-25T12:00:00Z",
  "message": "Account deletion requested. You can cancel within 30 days by signing in and clicking 'Restore my account'."
}
```

`created: false` if a request was already pending (idempotent; still returns deadline).

### Restore (cancel within grace)

```http
POST /api/v1/users/me/restore
Authorization: Bearer <access_token>
```

**200:**

```json
{ "cancelled": true }
```

(`user.go:206–226`)

Admin expedite finalize is **not** a consumer API:  
`POST /api/v1/admin/users/{id}/finalize-deletion`.

Also see ops runbook: `docs/operations/gdpr-delete.md`.

---

## 6. Data export (right of access)

```http
GET /api/v1/users/me/export
Authorization: Bearer <access_token>
```

- Handler: `DataExportHandler.ExportMyData` — `gateway/internal/handler/data_export.go:151+`
- Router: `router.go:445–448`
- Owner-scoped **only** via JWT `sub` (no user id in URL)
- Response: large JSON document; headers include  
  `Content-Disposition: attachment; filename="nomarkup-data-export-YYYY-MM-DD.json"`  
  and `Cache-Control: no-store, private`

Top-level shape (illustrative):

```json
{
  "export_metadata": {
    "user_id": "<uuid>",
    "generated_at": "2026-07-26T12:00:00Z",
    "format": "nomarkup.data-export.v1",
    "notice": "This file contains the personal data NoMarkup holds about your account ...",
    "section_cap": 5000
  },
  "profile": { "...": "..." },
  "jobs": [ ],
  "bids": [ ],
  "contracts": [ ],
  "listings": [ ],
  "payments": [ ],
  "messages_sent": [ ]
}
```

Sections may carry `"_truncated": true` or `"_error": "..."` if capped/failed. Security secrets (password hash, MFA secrets) are never included. iOS should stream to a temp file / share sheet rather than holding the whole payload in UI state.

---

## 7. Feature flags

Public (no auth), CDN-cacheable:

```http
GET /api/v1/flags
GET /api/v1/feature-flags
```

Alias pair — same handler (`router.go:320–323`, `feature_flag.go:32–67`).

**200** — flat map:

```json
{
  "legal_services": true,
  "some_flag": false
}
```

Cache policy: `writeCachedJSON(..., 60, 300)` → ~60s s-maxage / 300s SWR at edge.

Admin list/update (`GET /api/v1/admin/flags`, `PUT /api/v1/admin/flags/{key}`) are admin-only; not for the consumer app.

**Product note (from platform rules):** only some route groups call `RequireFlag` server-side; many flags are UI-only. Mobile should still fetch the map for progressive disclosure, but **must not** treat a disabled flag as a security boundary unless the gateway enforces it.

---

## 8. Recommended mobile session storage

| Secret | Storage | Lifetime / notes |
|--------|---------|------------------|
| Access JWT | Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` or stricter) | ~15 min; refresh on 401 |
| Refresh token | Keychain (same) | ~7 days; obtained from `Set-Cookie` on login until/unless body includes it |
| MFA challenge token | Memory only | Single login step |
| Feature flag map | In-memory / short disk cache | Revalidate ~1 min |
| DO **NOT** rely on | HttpOnly cookie alone without a cookie jar | API auth is Bearer-only |
| DO **NOT** store | Tokens in UserDefaults, logs, crash reports, pasteboard | |

Suggested client flow:

```text
cold start → Keychain refresh_token?
  yes → POST /auth/refresh { refresh_token } → store access_token
  no  → login / SIWA (when endpoint exists)
each API call → Authorization: Bearer <access>
on 401 → single-flight refresh → retry once → else clear Keychain → login UI
logout → POST /auth/logout { refresh_token } → wipe Keychain
```

Web reference implementation (Bearer + cookie refresh): `web/src/lib/api.ts`, `web/src/lib/auth.ts`.

---

## 9. Gaps & Stage B1 decisions

| Gap | Severity | Notes |
|-----|----------|-------|
| Native Apple identity-token exchange | **Shipped B1** | `POST /api/v1/auth/apple/native` + dual audience env |
| Refresh token not in JSON login body | Medium | Mobile must harvest `Set-Cookie` or gain a small API change (`refresh_token` in `authResponse`) |
| OAuth complete is browser redirect only | Blocking for pure native OAuth | Same class of problem as SIWA for Google/Facebook in-app |
| `APPLE_CLIENT_ID` is web Services ID | Config | Native App ID must be accepted as `aud` on any native endpoint |
| Idle session timeouts | Medium | Role-based idle can invalidate refresh; surface re-login |
| Feature flags fail-open (non-prod) / partial route coverage | Info | Do not use flags as sole authorization |

### Answer for Stage B1 planning

> **Does native Sign in with Apple need a new backend endpoint?**  
> **Yes.** The current Apple surface is web-redirect / `form_post` only (`GET /api/v1/auth/oauth/apple`, `POST /api/v1/auth/callback/apple`). There is no JSON API that accepts an AuthenticationServices `identityToken`. Prefer adding a dedicated native exchange that reuses `verifyAppleIDToken` + `FindOrCreateByOAuth` and returns the same token JSON as password login — do not ship SIWA by embedding a WebView of the web OAuth dance as the primary path.

---

## 10. Quick path index (evidence)

| Concern | Path | Code |
|---------|------|------|
| Auth routes | `/api/v1/auth/*` | `gateway/internal/router/router.go:151–199` |
| Login / register / refresh / logout | handlers | `gateway/internal/handler/auth.go` |
| Apple OAuth init | `GET /api/v1/auth/oauth/apple` | `oauth.go:234–260` |
| Apple OAuth callback | `POST /api/v1/auth/callback/apple` | `oauth.go:263–388` |
| OAuth complete cookies | — | `oauth.go:391–446` |
| Apple ID token verify | — | `oauth.go:485–528` |
| Bearer middleware | — | `gateway/internal/middleware/auth.go:81–133` |
| List OAuth | `GET /api/v1/users/me/oauth-accounts` | `oauth_accounts.go:58–108` |
| Unlink OAuth | `DELETE /api/v1/users/me/oauth-accounts/{provider}` | `oauth_accounts.go:110–198` |
| Delete account | `DELETE /api/v1/users/me` | `user.go:166–204` |
| Restore account | `POST /api/v1/users/me/restore` | `user.go:206–226` |
| Export | `GET /api/v1/users/me/export` | `data_export.go:151–241` |
| Feature flags | `GET /api/v1/flags`, `/api/v1/feature-flags` | `feature_flag.go:32–67` |
| Confirmation phrase | `"DELETE"` | `services/user/internal/domain/types.go:65–68` |
| Web API client | Bearer + cookie refresh | `web/src/lib/api.ts` |
| Base URL env | `NEXT_PUBLIC_API_URL` | `.env.example` ~173 |

---

## 11. Sample mobile call sequences

### Email login + authed me

```bash
# Login
curl -sS -D - -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","password":"Password1!"}'
# Capture access_token from JSON; capture refresh_token from Set-Cookie

# Profile
curl -sS "$BASE/api/v1/users/me" \
  -H "Authorization: Bearer $ACCESS"

# Refresh (body mode — preferred on iOS)
curl -sS -X POST "$BASE/api/v1/auth/refresh" \
  -H 'Content-Type: application/json' \
  -d "{\"refresh_token\":\"$REFRESH\"}"
```

### Delete + export

```bash
curl -sS -X DELETE "$BASE/api/v1/users/me" \
  -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"leaving platform","confirmation":"DELETE"}'

curl -sS "$BASE/api/v1/users/me/export" \
  -H "Authorization: Bearer $ACCESS" \
  -o nomarkup-export.json
```

### Flags

```bash
curl -sS "$BASE/api/v1/feature-flags"
```

---

*End of Stage B1 iOS API integration notes.*
