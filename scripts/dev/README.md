# Local development scripts

Helpers that are **safe only against local Postgres** (or explicitly opted-in compose DNS). Do not point these at staging/production.

## `clear-dev-stripe-ids.sh`

NULLs synthetic DevMode Stripe IDs left by seeds / DevMode Stripe:

| Table | Column | Match |
|-------|--------|--------|
| `users` | `stripe_customer_id` | `cus_dev_%` |
| `provider_profiles` | `stripe_account_id` | `acct_dev%` |

**Guard:** exits non-zero unless `DATABASE_URL` host is `localhost`, `127.0.0.1`, or `::1`. Set `ALLOW_DOCKER_HOST=1` only if you intentionally run via the compose service hostname `postgres`.

```bash
# Typical local compose DB (port from .env.example / docker-compose)
export DATABASE_URL='postgresql://nomarkup:nomarkup@localhost:5433/nomarkup?sslmode=disable'

# Preview counts only
DRY_RUN=1 ./scripts/dev/clear-dev-stripe-ids.sh

# Apply
./scripts/dev/clear-dev-stripe-ids.sh
```

Requires `psql` on `PATH`. Idempotent: re-running after a clean DB is a no-op.

**Why:** Soft-handling in the payment service avoids 500s for synthetic IDs against a real Stripe key, but clearing them lets lazy provisioning mint real `cus_` / `acct_` objects on the next money path. See soft-id notes under `docs/compliance/` and `services/payment/internal/service/stripe.go`.
