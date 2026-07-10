# Required Kubernetes Secret: `nomarkup-secrets`

Every Go service `Deployment` mounts this Secret via `envFrom: secretRef`. The
Secret itself is **not committed** to this repo — it must be provisioned
externally per environment (Vault / External Secrets Operator / SealedSecrets /
`kubectl create secret generic`).

If a service starts and any of the keys below is missing, the service will
**fail-closed at startup** rather than booting in a degraded state. This was
explicit in the post-2026-04-23 security audit (TODOS S2 / E1) — services are
no longer permitted to silently fall back to dev stubs in non-development
environments.

## Required keys (per environment)

| Key | Used by | Why mandatory |
|---|---|---|
| `DATABASE_URL` | every Go service + migration Job | DB connection string |
| `REDIS_URL` | gateway, services | session/idempotency cache |
| `JWT_PRIVATE_KEY` | user service | RS256 signing |
| `JWT_PUBLIC_KEY` | gateway, every service | JWT verification |
| `SESSION_SECRET` | gateway | secure cookie sealing |
| `INTERNAL_WS_SECRET` | gateway + chat | Shared secret for gateway→chat WebSocket hop auth. Generate with `openssl rand -base64 32`. Same value on both Deployments (explicit `secretKeyRef` + `envFrom`). |
| `STRIPE_SECRET_KEY` | payment service | server-side Stripe API |
| `STRIPE_WEBHOOK_SECRET` | payment service | webhook signature verification (mandatory; no env-based bypass) |
| `STRIPE_CONNECT_CLIENT_ID` | payment service | Connect onboarding |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | imaging, payment | object storage |
| `SENDGRID_API_KEY` | notification | email sending (dev-mode stub if absent — TODOS-6) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | notification | SMS sending |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | every service | error tracking (TODOS-7) |
| `GOOGLE_CLIENT_SECRET` | gateway | Google OAuth token exchange |
| `APPLE_CLIENT_SECRET` | gateway | Apple OAuth token exchange |
| `ENCRYPTION_KEY` | user, services with PII | base64 32-byte AES-256-GCM key |
| `MEILISEARCH_API_KEY` | gateway, job service, meilisearch (as `MEILI_MASTER_KEY`) | search index admin operations + gateway listings search; the in-cluster Meilisearch Deployment (`base/meilisearch/deployment.yaml`) boots with this same value as its master key — identical to the docker-compose wiring |

## Provisioning (recommended via External Secrets Operator + Vault)

Sample ExternalSecret manifest (copy + apply after ClusterSecretStore exists):

```bash
cp deploy/k8s/base/externalsecret.sample.yaml \
   deploy/k8s/overlays/production/externalsecret.yaml
# edit store name / Vault path, then:
kubectl apply -f deploy/k8s/overlays/production/externalsecret.yaml
```

```yaml
# deploy/k8s/base/externalsecret.sample.yaml (committed sample)
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: nomarkup-secrets
  namespace: nomarkup
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: nomarkup-secrets
  dataFrom:
    - extract:
        key: nomarkup/production
```

## Manual fallback (one-shot, NOT for production)

```bash
kubectl create secret generic nomarkup-secrets \
  --from-literal=DATABASE_URL='postgres://...' \
  --from-literal=STRIPE_SECRET_KEY='sk_live_...' \
  --from-literal=STRIPE_WEBHOOK_SECRET='whsec_...' \
  ... \
  --namespace=nomarkup
```

## Audit-trail rotation

Every entry above is in scope for the secrets-rotation runbook
(`docs/secrets-rotation.md`). After rotation, restart all pods that mount
`nomarkup-secrets` to pick up the new values:

```bash
kubectl rollout restart deployment -n nomarkup -l app.kubernetes.io/part-of=nomarkup
```
