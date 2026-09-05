# Runbook: Auth / User Service Degraded

> The user service handles login, registration, JWT issuance, MFA, password
> reset, and OAuth. If it's degraded, no one new can log in. Already-logged-in
> users may continue to function until their access token expires (15 min).

## Symptoms

- Alert: `NoMarkupServiceDown` for `user`.
- Alert: `NoMarkupAuthFailureSpike` (P0) — could be DDoS, but also a backend regression.
- Logs (gateway):
  ```
  failed to connect to user service: connection refused
  authHandler: Login: rpc error: code = Unavailable
  ```
- Customer-side: login form returns 500 or hangs.
- Provider-side: same. New session creation broken.
- Existing sessions: API requests succeed for ~15 min until access token expires; refresh-token flow then fails.

## Diagnosis

1. **Pod state:**
   ```bash
   kubectl get pods -n nomarkup -l app.kubernetes.io/name=user
   kubectl describe pod -n nomarkup -l app.kubernetes.io/name=user | tail -30
   ```

2. **Logs:**
   ```bash
   kubectl logs -n nomarkup deployment/user --tail=300
   kubectl logs -n nomarkup deployment/user --previous --tail=300
   ```
   Common failures:
   - `JWT private key file not found` → secret mount missing.
   - `failed to load JWT private key: parse: invalid PEM` → secret corrupted.
   - `pgxpool: connection refused` → see runbook 02.
   - `redis: connection refused` → MFA / OTP storage unavailable.

3. **Verify env / secrets are mounted:**
   ```bash
   kubectl exec -n nomarkup deployment/user -- ls -la /etc/keys/
   kubectl exec -n nomarkup deployment/user -- printenv | grep -E "JWT|VERIFICATION_SECRET|DATABASE_URL" | sed 's/=.*/=<redacted>/'
   ```

4. **gRPC health from gateway:**
   ```bash
   kubectl exec -n nomarkup deployment/gateway -- \
     grpc_health_probe -addr=user:50051
   ```

5. **Identify whether the issue is auth-specific or full-service:**
   - Login fails but `GET /api/v1/users/me` works → JWT validation is fine, only auth flow broken.
   - All user RPCs fail → service-level issue.
   - Refresh fails but login works → refresh token storage (Redis) issue.

## Mitigation

### Cached JWT validation fallback (already enabled)

The gateway validates JWTs with the **public key** loaded from disk at startup
(`JWT_PUBLIC_KEY_PATH`). It does NOT call the user service per-request. So even
if the user service is fully down, **already-issued access tokens continue to
work for their full TTL (15 min)**.

This is the primary mitigation — it's already in place. Do not break it by
adding synchronous user-service calls to the auth middleware.

### Path A: Roll back recent deploy

```bash
kubectl rollout undo -n nomarkup deployment/user
kubectl rollout status -n nomarkup deployment/user
```

### Path B: Scale horizontally if overloaded

```bash
kubectl scale -n nomarkup deployment/user --replicas=4
```

### Path C: JWT key issue (nuclear)

If JWT private key is corrupted in the secret, login is fully broken until
fixed. There is no automated recovery — restore the keypair from your secret
manager (Vault / 1Password) and:
```bash
kubectl create secret generic nomarkup-jwt-keys \
  --from-file=private.pem=/path/to/private.pem \
  --from-file=public.pem=/path/to/public.pem \
  --dry-run=client -o yaml | kubectl apply -n nomarkup -f -
kubectl rollout restart -n nomarkup deployment/user deployment/gateway
```
**Do NOT generate a new keypair** — that invalidates every outstanding
refresh token (logout storm, see Path D).

### Path D: Refresh token storm

Symptom: `NoMarkupAuthFailureSpike` triggered by your own users, not an attack.
Happens when:
- Many tokens expire simultaneously (after a deploy at the 15-min mark).
- Refresh storm overwhelms the user service.

Mitigation:
1. Raise refresh rate limit temporarily:
   ```bash
   kubectl set env -n nomarkup deployment/gateway RATE_LIMIT_AUTH=100
   kubectl rollout restart -n nomarkup deployment/gateway
   ```
2. Scale user service replicas:
   ```bash
   kubectl scale -n nomarkup deployment/user --replicas=6
   ```
3. After the storm dies down (10–15 min), revert the rate limit:
   ```bash
   kubectl set env -n nomarkup deployment/gateway RATE_LIMIT_AUTH-
   kubectl rollout restart -n nomarkup deployment/gateway
   ```

### Path E: Redis MFA / OTP unavailable

Phone OTP and MFA codes live in Redis. If Redis is unreachable:
- New OTPs cannot be issued.
- Already-sent OTPs cannot be verified.
- Existing logged-in users are unaffected.

Mitigation: see Redis-specific runbook (TBD) or restart the Redis pod. As a
**last-resort customer recovery**, an admin can mark a user as MFA-verified
manually:
```sql
-- Read from audit log to confirm legitimacy first, then:
UPDATE users SET mfa_verified_at = now() WHERE id = '<uuid>';
```

## Resolution

1. `kubectl get pods -n nomarkup -l app.kubernetes.io/name=user` — all Running.
2. gRPC health: SERVING.
3. Smoke-test login with a known good account through the gateway.
4. `NoMarkupServiceDown` and `NoMarkupAuthFailureSpike` cleared.
5. Verify session count graph stops dropping (refresh storm dissipated).

## Postmortem Template

```
## Incident: Auth Degradation YYYY-MM-DD
- Severity: P0
- Duration: HH:MM
- New logins blocked: estimated <count> from drop in `auth_logins_total`
- Refresh failures: <count>
- Root cause: <one sentence>

### Action items
- [ ] If JWT key issue: rotate Vault break-glass procedure
- [ ] If refresh storm: stagger access token TTL across users (jitter)
```
