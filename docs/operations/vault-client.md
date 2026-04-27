# Vault Client

Thin Go wrapper around `github.com/hashicorp/vault/api` with transparent
env-var fallback for local development.

## Files

- `gateway/internal/vault/vault.go` — `vault.Client`
- `gateway/internal/vault/vault_test.go` — round-trip + fallback tests

## Usage

```go
import "github.com/nomarkup/nomarkup/gateway/internal/vault"

ctx := context.Background()
v, err := vault.New(ctx)
if err != nil {
    log.Fatal(err)
}

// Reads "stripe_secret" from secret/nomarkup/dev/payment.
// Falls back to STRIPE_SECRET_KEY env var if Vault is unreachable or
// the path/key doesn't exist.
key := v.GetString(ctx, "secret/nomarkup/dev/payment", "stripe_secret", "STRIPE_SECRET_KEY")
```

## Configuration

| Env var | Required? | Purpose |
|---|---|---|
| `VAULT_ADDR` | optional | If empty, client is no-op; everything falls through to env. Set to `https://vault.internal:8200` in production. |
| `VAULT_NAMESPACE` | enterprise | Vault Enterprise namespace |
| `VAULT_TOKEN` | dev/CI | Direct token auth — fine for local, never prod |
| `VAULT_ROLE_ID` + `VAULT_SECRET_ID` | production | AppRole auth (recommended) |

## Path convention

```
secret/nomarkup/<env>/<service>/<key>
                 │     │       └─ key inside the secret (e.g. "stripe_secret")
                 │     └─ service name: payment, user, job, gateway, etc.
                 └─ env: dev, staging, prod
```

For KVv2 mounts (the default), the wrapper auto-injects `/data/` if you pass a v1-style path.

## Local dev with a real Vault

For testing AppRole / TTL / rotation locally:

```bash
# Run dev Vault
vault server -dev -dev-root-token-id=dev-root

# In another terminal:
export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN=dev-root

# Seed a dev secret
vault kv put secret/nomarkup/dev/payment \
    stripe_secret=sk_test_local \
    stripe_webhook_secret=whsec_local

# Verify the wrapper reads it
go test ./gateway/internal/vault/...
```

## AppRole production setup

```bash
# 1. Enable AppRole on the cluster (one-time)
vault auth enable approle

# 2. Create a policy that allows reads on our service paths
vault policy write nomarkup-services - <<EOF
path "secret/data/nomarkup/prod/*" {
  capabilities = ["read"]
}
EOF

# 3. Create the role
vault write auth/approle/role/nomarkup-services \
    token_policies="nomarkup-services" \
    token_ttl=1h token_max_ttl=4h \
    secret_id_ttl=24h

# 4. Issue role_id + secret_id (deploy-time, written to K8s Secret)
ROLE_ID=$(vault read -field=role_id auth/approle/role/nomarkup-services/role-id)
SECRET_ID=$(vault write -force -field=secret_id auth/approle/role/nomarkup-services/secret-id)
```

## Cache TTL + rotation

The wrapper caches reads for 5 minutes. After rotating a secret in Vault:

- Reads pick up the new value automatically within 5 minutes.
- For zero-delay rotation, restart the service or call `client.cache = nil`
  (not exposed; rolling restart is simpler).
- For app-side key rotation (e.g., `ENCRYPTION_KEY`), follow
  `docs/operations/encryption-key-rotation.md`.

## Migration from K8s Secrets

K8s Secrets remain the source of truth until each service migrates to Vault. The wrapper's env-fallback design means:

- Today: `VAULT_ADDR` empty → `vault.GetString` reads `os.Getenv(envFallback)` → matches the existing K8s-Secret-mounted env vars. **Zero behavioral change.**
- During migration: set `VAULT_ADDR` per service. Vault wins where the secret exists; env fallback covers everything else.
- After migration: delete K8s Secret mounts.

## Health check

`Healthy(ctx)` returns nil when Vault is reachable (or when not configured — env-fallback mode is always healthy). Wire it into `/readyz` of any service that depends on Vault for first-write operations.

## Known limitations

- AppRole `secret_id` rotation requires re-issuing and updating K8s Secrets.
  Use a sidecar or `external-secrets-operator` for production.
- The wrapper does not yet handle Vault token renewal — tokens at default
  TTL will expire and force a fresh AppRole login. Add a renewal goroutine
  if your TTL is shorter than your service uptime.
