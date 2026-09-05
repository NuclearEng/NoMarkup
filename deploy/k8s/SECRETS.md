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
| `JWT_PRIVATE_KEY` | user service | RS256 signing. **Mounted as a file, not read from env** — see below. |
| `JWT_PUBLIC_KEY` | gateway, every service | JWT verification. **Mounted as a file, not read from env** — see below. |
| `SESSION_SECRET` | gateway, web (edge) | HMAC for `has_session` soft-gate cookie (SEC-07); optional `HAS_SESSION_SECRET` override |
| `INTERNAL_WS_SECRET` | gateway + chat | Shared secret for gateway→chat WebSocket hop auth. Generate with `openssl rand -base64 32`. Same value on both Deployments (explicit `secretKeyRef` + `envFrom`). |
| `STRIPE_SECRET_KEY` | payment service | server-side Stripe API |
| `STRIPE_WEBHOOK_SECRET` | payment service | webhook signature verification (mandatory; no env-based bypass) |
| `STRIPE_CONNECT_CLIENT_ID` | payment service | Connect onboarding |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | imaging, payment | object storage |
| `SENDGRID_API_KEY` | notification | email sending (dev-mode stub if absent — TODOS-6) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | notification | SMS sending |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | every service | error tracking (TODOS-7) |
| `GOOGLE_CLIENT_ID` | gateway | Google OAuth web client ID (`…apps.googleusercontent.com`). Used for OAuth `aud` validation — **not** confidential like the secret, but still provisioned out-of-band so **staging and production** overlays never commit a real (or fake `SET_ME_*`) value (OPS-08). Gateway reads it via `envFrom: secretRef: nomarkup-secrets`. |
| `GOOGLE_CLIENT_SECRET` | gateway | Google OAuth token exchange (confidential — Vault only) |
| `APPLE_CLIENT_SECRET` | gateway | Apple OAuth token exchange |
| `ENCRYPTION_KEY` | user, services with PII | base64 32-byte key for **XSalsa20-Poly1305** (`nacl/secretbox`), not AES-256-GCM — see CLAUDE.md §6. Required in staging as well as production: the code's ephemeral-key fallback is keyed on `ENVIRONMENT == "production"`, so a staging pod without this generates a **different random key per replica** and writes permanently undecryptable PII. |
| `MEILISEARCH_API_KEY` | gateway, job service, meilisearch (as `MEILI_MASTER_KEY`) | search index admin operations + gateway listings search; the in-cluster Meilisearch Deployment (`base/meilisearch/deployment.yaml`) boots with this same value as its master key — identical to the docker-compose wiring |
| `METRICS_BEARER_TOKEN` | gateway (+ Prometheus, see below) | Bearer token for `GET /metrics`. Without it the gateway's `protectMetrics` gate (SEC-08) returns **401 to every non-loopback request in production**, so Prometheus scrapes from the `monitoring` namespace fail and every alert built on `http_requests_total` / `http_request_duration_seconds` — including the P0 `NoMarkupPaymentFailureSpike` and `NoMarkupPaymentPathDown` — silently never fires. Generate with `openssl rand -base64 32`. |

### RS256 keys are consumed as FILES, not env values

This is the one place where "put it in the Secret and `envFrom` it" is not
enough, and getting it wrong is a hard startup failure rather than a silent
degradation.

Every consumer reads a **path** and opens the file — `gateway/cmd/server/main.go`
(`os.ReadFile`), `services/user/cmd/server/main.go`, and
`web/src/lib/server/verify-jwt.ts`. None of them read the PEM out of the
environment. So the Secret keys `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` still hold
the PEM **content**, but they reach the process by being projected as files:

- `base/gateway/deployment.yaml` mounts the **public key only** at
  `/etc/nomarkup/jwt/public.pem` and sets `JWT_PUBLIC_KEY_PATH`. The gateway
  verifies tokens and must never hold the signing key.
- `base/user/deployment.yaml` mounts **both** keys and sets
  `JWT_PRIVATE_KEY_PATH` + `JWT_PUBLIC_KEY_PATH`. The user service is the only
  component that mints tokens.

Both volumes use `defaultMode: 0400`, and the containers run as non-root with a
read-only mount.

Before this was wired, the Secret supplied the PEMs as environment values that
nothing read, no `volumeMounts` existed, and neither `*_KEY_PATH` variable was
set — so the gateway and the user service would both have exited 1 at startup
on the first real deploy.

### `METRICS_BEARER_TOKEN` — both sides must match

The gateway reads it from env (`METRICS_BEARER_TOKEN`, falling back to
`METRICS_TOKEN`) via an explicit `secretKeyRef` in
`base/gateway/deployment.yaml` — deliberately **not** `optional: true`, so a
missing key stops the pod from starting instead of booting with metrics
unscrapeable.

Prometheus runs in the `monitoring` namespace (`deploy/monitoring/` kustomize
root — OPS-10), so it needs the **same value** mirrored there as a file.
Provision **before** `kubectl apply -k deploy/monitoring`:

```bash
# same value as nomarkup-secrets/METRICS_BEARER_TOKEN
kubectl create secret generic nomarkup-metrics-token \
  --from-literal=METRICS_BEARER_TOKEN="$TOKEN" \
  --namespace=monitoring
```

The mount is already declared on
`deploy/monitoring/k8s/prometheus-deployment.yaml` (Secret
`nomarkup-metrics-token` → `/etc/prometheus/secrets/metrics-bearer-token`).
`deploy/monitoring/prometheus/prometheus.yml` consumes it on the
`kubernetes-pods` job as
`authorization: {type: Bearer, credentials_file: /etc/prometheus/secrets/metrics-bearer-token}`.
Rotating this key means rotating **both** Secrets together, then restarting the
gateway and Prometheus — a mismatch takes alerting dark without any alert firing
about it (watch the `up{job="kubernetes-pods"}` series and Prometheus' own
`scrape_samples_scraped` after any rotation).

**Never** set `METRICS_PUBLIC=true` as a workaround — that serves `/metrics`
unauthenticated to anything that can reach the pod.

Apply + verify: [`docs/operations/monitoring-stack.md`](../../docs/operations/monitoring-stack.md).

### `PLATFORM_EIN` — 1099-NEC payer EIN (generate-path, not startup-fatal)

Payment service stamps this IRS EIN (`NN-NNNNNNN`) onto generated 1099-NEC
forms. Provision it into `nomarkup-secrets` (payment `envFrom`) like the
Stripe keys; do **not** commit a live EIN. Empty, whitespace, dummy
`88-1234567`, and invalid shape are rejected at **GenerateTaxForm** — the
service still starts. Already-stored forms with a real EIN can still be
rendered.

## Provisioning (OPS-04 Partial)

**In-repo today:** sample manifests + this doc. **Not done:** Founder still
stands up Vault (or Sealed Secrets controller), stores live values, and applies
the CRs on a real cluster. Samples never contain real credentials — do not
invent Stripe / Google / JWT material into git.

| Path | Sample | When to use |
|---|---|---|
| **ESO + Vault** (preferred) | [`base/externalsecret.sample.yaml`](./base/externalsecret.sample.yaml) | Production once Vault + ClusterSecretStore exist |
| **Sealed Secrets** (gitops fallback) | [`base/sealedsecret.sample.yaml`](./base/sealedsecret.sample.yaml) | Offline seal with `kubeseal` when Vault is not wired yet |
| Manual `kubectl create secret` | below | Dev / break-glass only |

Neither sample is listed in `kustomization.yaml` — copy into an overlay or
secrets platform after the backend is real.

### Spotlight key families (explicit in the samples)

These four groups are mapped with explicit ExternalSecret `data:` remoteRefs
(and listed for SealedSecret `encryptedData`) so the Vault property → K8s key
contract is reviewable:

| Family | Secret keys | Consumers |
|---|---|---|
| **METRICS** | `METRICS_BEARER_TOKEN` | gateway (`secretKeyRef`) **and** Prometheus Secret `nomarkup-metrics-token` in `monitoring` (same value twice) |
| **JWT** | `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | PEM **content** in Secret → file mounts (`JWT_*_KEY_PATH`); user signs, gateway verifies |
| **STRIPE** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_CLIENT_ID` | payment service only |
| **GOOGLE** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | gateway OAuth; **not** ConfigMap (OPS-08) |

### External Secrets Operator + Vault

```bash
# 1) Founder: install ESO, create Vault KV path, apply ClusterSecretStore
#    (commented skeleton at bottom of externalsecret.sample.yaml).

# 2) Copy sample → production overlay (gitignored or secrets-only branch OK)
cp deploy/k8s/base/externalsecret.sample.yaml \
   deploy/k8s/overlays/production/externalsecret.yaml
# Edit Vault path / store name if they differ from vault-backend + nomarkup/production.
# Strip the commented ClusterSecretStore if you apply it separately.

# 3) Apply both ExternalSecrets (nomarkup-secrets + monitoring metrics token)
kubectl apply -f deploy/k8s/overlays/production/externalsecret.yaml

# 4) Confirm sync
kubectl get externalsecret -n nomarkup
kubectl get externalsecret -n monitoring
kubectl get secret nomarkup-secrets -n nomarkup -o jsonpath='{.data}' | jq 'keys'
kubectl get secret nomarkup-metrics-token -n monitoring -o jsonpath='{.data}' | jq 'keys'
```

Pattern (abbreviated — full explicit remoteRefs live in the sample file):

```yaml
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
  data:
    - secretKey: METRICS_BEARER_TOKEN
      remoteRef: { key: nomarkup/production, property: METRICS_BEARER_TOKEN }
    - secretKey: JWT_PRIVATE_KEY
      remoteRef: { key: nomarkup/production, property: JWT_PRIVATE_KEY }
    - secretKey: JWT_PUBLIC_KEY
      remoteRef: { key: nomarkup/production, property: JWT_PUBLIC_KEY }
    - secretKey: STRIPE_SECRET_KEY
      remoteRef: { key: nomarkup/production, property: STRIPE_SECRET_KEY }
    - secretKey: STRIPE_WEBHOOK_SECRET
      remoteRef: { key: nomarkup/production, property: STRIPE_WEBHOOK_SECRET }
    - secretKey: STRIPE_CONNECT_CLIENT_ID
      remoteRef: { key: nomarkup/production, property: STRIPE_CONNECT_CLIENT_ID }
    - secretKey: GOOGLE_CLIENT_ID
      remoteRef: { key: nomarkup/production, property: GOOGLE_CLIENT_ID }
    - secretKey: GOOGLE_CLIENT_SECRET
      remoteRef: { key: nomarkup/production, property: GOOGLE_CLIENT_SECRET }
    # …DATABASE_URL, REDIS_URL, SESSION_SECRET, INTERNAL_WS_SECRET, …
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: nomarkup-metrics-token
  namespace: monitoring
spec:
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: nomarkup-metrics-token
  data:
    - secretKey: METRICS_BEARER_TOKEN
      remoteRef: { key: nomarkup/production, property: METRICS_BEARER_TOKEN }
```

Force resync after Vault rotation:

```bash
kubectl annotate externalsecret nomarkup-secrets force-sync=$(date +%s) \
  -n nomarkup --overwrite
kubectl annotate externalsecret nomarkup-metrics-token force-sync=$(date +%s) \
  -n monitoring --overwrite
kubectl rollout restart deployment -n nomarkup -l app.kubernetes.io/part-of=nomarkup
kubectl -n monitoring rollout restart deploy/prometheus
```

### Sealed Secrets (fallback)

See [`base/sealedsecret.sample.yaml`](./base/sealedsecret.sample.yaml) for the
full `kubeseal` workflow. Summary:

1. Build a plain Secret **locally** (never commit) with the keys above.
2. `kubeseal --format=yaml` → overlay sealed manifests (cluster-scoped ciphertext).
3. Seal `METRICS_BEARER_TOKEN` twice (namespaces `nomarkup` + `monitoring`) with
   the **same** plaintext.
4. Apply SealedSecrets; controller materializes `nomarkup-secrets` /
   `nomarkup-metrics-token`.

The committed sample has empty `encryptedData: {}` on purpose — only kubeseal
output is apply-ready.

## Manual fallback (one-shot, NOT for production)

```bash
# Placeholders only — substitute real values from Vault / vendor dashboards.
# Do not commit the resulting Secret or shell history with live keys.
kubectl create secret generic nomarkup-secrets \
  --from-literal=DATABASE_URL='postgres://…' \
  --from-literal=METRICS_BEARER_TOKEN="$(openssl rand -base64 32)" \
  --from-literal=STRIPE_SECRET_KEY='sk_live_…' \
  --from-literal=STRIPE_WEBHOOK_SECRET='whsec_…' \
  --from-literal=GOOGLE_CLIENT_ID='….apps.googleusercontent.com' \
  --from-literal=GOOGLE_CLIENT_SECRET='…' \
  ... \
  --namespace=nomarkup
```

Mirror metrics token for Prometheus before `kubectl apply -k deploy/monitoring`
(see `METRICS_BEARER_TOKEN` section above).

## Audit-trail rotation

Every entry above is in scope for the secrets-rotation runbook
(`docs/secrets-rotation.md`). After rotation, restart all pods that mount
`nomarkup-secrets` to pick up the new values, **and** restart Prometheus if
`METRICS_BEARER_TOKEN` changed:

```bash
kubectl rollout restart deployment -n nomarkup -l app.kubernetes.io/part-of=nomarkup
kubectl -n monitoring rollout restart deploy/prometheus
```
