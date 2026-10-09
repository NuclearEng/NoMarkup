# Local gateway rebuild — 2026-08-12

Stale `.dev/bin/gateway` (PID 38191, started Wed Aug 5) replaced with a
source-fresh binary so routes that exist in
`gateway/internal/router/router.go` are actually mounted on
`http://127.0.0.1:8081`.

**Scope:** local only. Postgres and Redis were not stopped. Nothing committed.

## Why

Unauthenticated probes against the contracts / payments groups return 401
(auth middleware on the parent `chi.Route`) even when the child route is
missing. After login the live binary returned chi's plain-text
`404 page not found` for:

- `GET /api/v1/contracts/{id}/work-evidence`
- `PUT /api/v1/payments/methods/{id}/default`

Public `POST /api/v1/rum` returned `401 missing authorization header`
(the public mount in source was not in the running binary).

## How the live process is launched

`bin/dev` (`start_go_service` / `start_gateway`) builds and runs
`.dev/bin/gateway` — **not** `gateway/bin/server` (`make build-gateway`).

```
bin/dev rebuild gateway   # stop + go build -o .dev/bin/gateway ./cmd/server
bin/dev up gateway        # sources .env.local (GATEWAY_PORT=8081) and execs
```

`.env.local` already has `GATEWAY_PORT=8081`. `cmd_up` `set -a; source
.env.local` before `start_gateway`.

## Before (Wed Aug 5 binary)

| Item | Value |
|------|--------|
| PID | 38191 (PPID 1, cwd repo root) |
| Binary | `.dev/bin/gateway` mtime **Aug 5 21:37:30 2026** size **49113170** |
| Listen | `*:8081` |
| `GET /health` | 200 `{"status":"ok","version":"dev"}` |
| Login | 200 (token issued) |
| `GET .../work-evidence` (authed) | **404** body `404 page not found` |
| `PUT .../methods/{uuid}/default` (authed + Idempotency-Key) | **404** body `404 page not found` |
| `POST /api/v1/rum` (no auth) | **401** `{"error":"missing authorization header"}` |
| Postgres | PID **14320** on `:5433` |
| Redis | PID **14338** on `:6379` |

Rebuild start UTC: `2026-08-13T03:22:50Z`.

## Rebuild + restart

```
$ bin/dev rebuild gateway
 ✔ Stopped gateway (pid 38191)
 ==> Rebuilding gateway...
  → Building gateway...
 ✔ gateway rebuilt — restart with: bin/dev up gateway

$ bin/dev up gateway
 ==> Starting API gateway...
 ✔ gateway ready on :8081
 ✔ Gateway ready
```

| Item | Value |
|------|--------|
| Rebuild window | 2026-08-13T03:22:50Z → 03:22:58Z |
| New binary | `.dev/bin/gateway` mtime **Aug 12 20:22:58 2026** size **49323986** |
| New PID | **26897** (started Wed Aug 12 20:23:05 local) |
| Listen | `*:8081` |
| Postgres | still **14320** (alive) |
| Redis | still **14338** (alive) |

Startup log (`.dev/logs/gateway.log`):

```
vault: VAULT_ADDR unset — using env-var fallback
tracing enabled service=gateway endpoint=http://localhost:4317
cache: redis connected addr=localhost:6379
pgx pool initialized
gateway starting port=8081
```

## After — required proofs

All against `http://127.0.0.1:8081` at 2026-08-13T03:23:28Z.

### 1. `GET /health` → 200

```
HTTP/1.1 200 OK
Content-Type: application/json
X-Request-Id: aa9ae536e0a6c5c5

{"status":"ok","version":"dev"}
```

### 2. Login `customer@nomarkup.com` / `Password123!` → 200

`POST /api/v1/auth/login` with `{"email":"customer@nomarkup.com","password":"Password123!"}`

```
HTTP/1.1 200 OK
Set-Cookie: refresh_token=…; Path=/api/v1/auth; HttpOnly; SameSite=Lax
Set-Cookie: has_session=v1.00000000-0000-0000-0000-000000000002.…
X-Request-Id: eb740d0acc30e64b

user_id=00000000-0000-0000-0000-000000000002
access_token issued (RS256)
access_token_expires_at=2026-08-13T03:38:28Z
```

### 3. `GET /api/v1/contracts` then `.../work-evidence`

`GET /api/v1/contracts` → 200, 20 contracts. First id used:

`78743d77-2bd6-4665-8c62-da881699e0b0` (NM-2026-00148, status=abandoned).

`GET /api/v1/contracts/78743d77-2bd6-4665-8c62-da881699e0b0/work-evidence`

```
HTTP/1.1 200 OK
Cache-Control: private, no-store
Content-Type: application/json
X-Request-Id: 1d77d5c48b8c26c1

{"ready_for_release":false,"missing":["check_in","after_photo"],"sessions":[],"photos":[]}
```

Empty pack is OK. This is **not** chi `404 page not found`.

Unknown contract id (route still mounted):

`GET /api/v1/contracts/00000000-0000-0000-0000-000000000001/work-evidence`
→ **404** JSON `{"error":"not found"}` (handler 404, not chi plaintext).

### 4. `PUT /api/v1/payments/methods/{uuid}/default`

Customer has no saved methods (`GET /api/v1/payments/methods` →
`{"methods":[]}`). Probe used
`00000000-0000-0000-0000-000000000099` with bearer +
`Idempotency-Key: gateway-rebuild-<epoch>`.

```
HTTP/1.1 501 Not Implemented
Content-Type: application/json
X-Request-Id: c392330a25027454

{"error":"unknown method SetDefaultPaymentMethod for service nomarkup.payment.v1.PaymentService"}
```

The **gateway route is mounted**. 501 is the payment gRPC stub, not chi
`404 page not found`. A missing-method JSON 404 would also have been
acceptable; 501 is stronger proof the handler ran.

### Bonus: public `POST /api/v1/rum`

No auth. Body `{"name":"LCP","value":1234,"path":"/","rating":"good"}`.

```
HTTP/1.1 202 Accepted
X-Request-Id: 08fbfea04f036455

{"status":"accepted"}
```

Was 401 on the stale binary.

## Infra not taken down

| Service | PID before | PID after | Listen |
|---------|------------|-----------|--------|
| postgres | 14320 | 14320 | 127.0.0.1:5433 / [::1]:5433 |
| redis | 14338 | 14338 | *:6379 |
| gateway | 38191 (killed SIGTERM via `bin/dev rebuild`) | 26897 | *:8081 |

## Residual (out of scope)

`SetDefaultPaymentMethod` is wired on the gateway but the payment
service gRPC surface does not implement that RPC yet (501). Rebuild
goal was route presence on the local gateway, not implementing the
payment RPC.
