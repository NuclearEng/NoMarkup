# SetDefaultPaymentMethod RPC — 2026-08-12

Stale `.dev/bin/payment` (PID 76662, started Wed Aug 5) replaced with a
source-fresh binary so `PUT /api/v1/payments/methods/{id}/default` no
longer 501s. The proto RPC already existed; the live payment process
did not serve it.

**Scope:** local only. Postgres, Redis, and the rebuilt gateway were
not stopped. Nothing committed.

## Why

After the gateway rebuild (`gateway-rebuild.md`) the route was mounted
on `:8081` but the payment gRPC stub returned:

```
HTTP/1.1 501 Not Implemented
{"error":"unknown method SetDefaultPaymentMethod for service nomarkup.payment.v1.PaymentService"}
```

`.dev/bin/payment` mtime **Aug 5 17:41** — predates proto + server
implementation (source mtime **Aug 12 16:37**). Gateway PID 26897
called a method the Aug 5 binary had never registered.

## What shipped in process (already in source)

| Layer | Location | Behavior |
|-------|----------|----------|
| Proto | `proto/payment/v1/payment.proto:39` | `rpc SetDefaultPaymentMethod` |
| gRPC | `services/payment/internal/grpc/server.go:251` | Requires JWT `customer_id` + `payment_method_id`; maps `ErrPaymentNotFound` → `NotFound` |
| Service | `services/payment/internal/service/service.go:1817` | Owner-scoped list, then persist |
| SQL | `services/payment/internal/repository/customer.go:173` | Tx: demote siblings `is_default=false`, promote target `is_default=true`. Parameterized `$1/$2`. Unique index `idx_user_payment_methods_one_default` |
| Gateway | `gateway/internal/handler/payment.go:339` | JWT subject as `customer_id`; `200 {"is_default":true}` |

Authz is fail-closed: a method that is not the caller's live row
returns `ErrPaymentNotFound` → HTTP **404** JSON (no existence leak).

Stripe is **not** invented. `users.stripe_customer_id` is unset on the
seed customer. The service now mirrors to Stripe only when a Customer
is already provisioned; otherwise `user_payment_methods` is the source
of truth. No `cus_` / `pm_` objects were created at Stripe.

One source tweak vs the previous fail-closed-on-unprovisioned path:
skip the Stripe `Customer.Update` when Lookup returns `""` so a real
local method can be marked default without minting a Customer. Tests:
`TestSetDefaultPaymentMethod_IDOR`,
`TestSetDefaultPaymentMethod_tableIsSourceOfTruth`.

## How the live process is launched

Same as `bin/dev` (`start_go_service` / `cmd_rebuild`):

```
bin/dev rebuild payment   # stop + go build -o .dev/bin/payment ./cmd/server
bin/dev up payment        # sources .env.local and execs
```

`.env.local` already has `PAYMENT_SERVICE_PORT=50054` and
`DATABASE_URL=postgresql://nomarkup:password@localhost:5433/nomarkup`.

## Before (Wed Aug 5 binary)

| Item | Value |
|------|--------|
| PID | 76662 (started Wed Aug 5 17:41) |
| Binary | `.dev/bin/payment` mtime **Aug 5 17:41:16** size **34216994** |
| Listen | `*:50054` |
| Gateway | PID **26897** on `:8081` (already rebuilt) |
| `PUT …/methods/{uuid}/default` (authed + Idempotency-Key) | **501** `unknown method SetDefaultPaymentMethod` |
| Postgres | PID **14320** on `:5433` |
| Redis | PID **14338** on `:6379` |

## Rebuild + restart

```
$ bin/dev rebuild payment
 ✔ Stopped payment (pid 76662)
 ==> Rebuilding payment...
  → Building payment...
 ✔ payment rebuilt — restart with: bin/dev up payment

$ bin/dev up payment
 ✔ payment ready on :50054
```

| Item | Value |
|------|--------|
| Rebuild window | 2026-08-13T03:29:00Z → 03:29:12Z (local Aug 12 20:29) |
| New binary | `.dev/bin/payment` mtime **Aug 12 20:29:12** size **34236594** |
| New PID | **30369** (started Wed Aug 12 20:29:19 local) |
| Listen | `*:50054` |
| Gateway | still **26897** on `:8081` |
| Postgres | still **14320** (alive) |
| Redis | still **14338** (alive) |

Startup log (`.dev/logs/payment.log`):

```
{"msg":"connected to database"}
{"msg":"stripe key configured"}
{"msg":"payment service starting","port":"50054"}
```

## Seed (local table only)

Seed customer `00000000-0000-0000-0000-000000000002`
(`customer@nomarkup.com`) had **zero** `user_payment_methods` rows and
`users.stripe_customer_id` NULL. Two owned cards + one provider card
were inserted for the live probe (display fields only; no PAN):

| Owner | `stripe_payment_method_id` | Brand | Last4 | Before |
|-------|----------------------------|-------|-------|--------|
| customer | `pm_local_visa_4242` | visa | 4242 | default |
| customer | `pm_local_mc_5555` | mastercard | 5555 | not default |
| provider | `pm_local_provider_amex` | amex | 0005 | default |

`users.stripe_customer_id` left NULL on both accounts.

## Live PUT (bearer + Idempotency-Key)

Login `POST /api/v1/auth/login` customer@nomarkup.com / Password123!
→ **200** + access token (`user_id` `…0002`).

| Probe | Path id | Status | Body | Request-Id |
|-------|---------|--------|------|------------|
| Unknown UUID | `00000000-0000-0000-0000-000000000099` | **404** | `{"error":"payment not found"}` | `f854f8127d5567ee` |
| Foreign (provider) | `pm_local_provider_amex` | **404** | `{"error":"payment not found"}` | `1a91ec0a80a0e3ff` |
| Own mastercard | `pm_local_mc_5555` | **200** | `{"is_default":true}` | `2ec36a0eea2c912f` |
| Replay own (already default) | `pm_local_mc_5555` | **200** | `{"is_default":true}` | `1a9d28fe72b0e295` |

Never 501. Payment logs the same four RPCs as
`/nomarkup.payment.v1.PaymentService/SetDefaultPaymentMethod`
(NotFound ×2, OK ×2).

## DB after own-mastercard PUT

| Owner | Method | `is_default` |
|-------|--------|--------------|
| customer | `pm_local_mc_5555` | **t** |
| customer | `pm_local_visa_4242` | **f** |
| provider | `pm_local_provider_amex` | t (untouched) |

Sibling demoted in the same transaction. Provider row unchanged.
`users.stripe_customer_id` still NULL — no Stripe Customer minted.

## Infra not taken down

| Service | PID before | PID after | Listen |
|---------|------------|-----------|--------|
| postgres | 14320 | 14320 | 127.0.0.1:5433 |
| redis | 14338 | 14338 | *:6379 |
| gateway | 26897 | 26897 | *:8081 |
| payment | 76662 (killed SIGTERM via `bin/dev rebuild`) | 30369 | *:50054 |

## Residual

`GET /api/v1/payments/methods` still lists from Stripe when a real
`STRIPE_SECRET_KEY` is configured. The seed customer has no Customer,
so that list stays `[]` even though the local table now has two cards.
Set-default keys off `user_payment_methods.stripe_payment_method_id`
(the id the list RPC would return once a Customer exists). iOS
`PaymentMethodsView` cannot tap-to-default a row it cannot list; the
RPC itself is live.
