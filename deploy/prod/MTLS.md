# gRPC mesh mTLS (prod compose)

Without mTLS, anything that can reach a service port on the Docker `internal`
network can call any RPC with any `customer_id` / `provider_id`. Arming mTLS
makes caller identity cryptographic (`pkg/grpmtls` for Go,
`engines/telemetry::load_server_tls` for the Rust engines).

The base `docker-compose.yml` is unchanged and boots without certs. mTLS is an
overlay: `docker-compose.mtls.yml`. The dev compose at the repo root is not
touched.

## 1. Generate certs (on the VPS, once)

```bash
deploy/prod/gen-mtls-certs.sh            # → deploy/prod/mtls/ (gitignored)
# images run as uid 10001 (deploy/docker/*.Dockerfile); keys are 0600, so chown them:
MTLS_CERT_OWNER=10001:10001 sudo -E deploy/prod/gen-mtls-certs.sh
```

* Local EC P-256 CA (`mtls/ca/ca.{crt,key}`, 5 years). It is **not** mounted
  into any container. Back up `mtls/ca/` off-box like `deploy/prod/keys`.
* One leaf per service (`mtls/<svc>/{tls.crt,tls.key,ca.crt}`, 397 days),
  serverAuth + clientAuth, CN=`<svc>`, SANs `DNS:<svc>`, `DNS:nomarkup-mesh`,
  `DNS:localhost`, `URI:spiffe://nomarkup/service/<svc>`.
* Clients verify `ServerName=nomarkup-mesh` (the `pkg/grpmtls` default), so
  one SAN works for every hop. `PeerServiceName()` reads the SPIFFE URI.
* Re-running is idempotent. `--force` rotates the leaf certs and keeps the CA.
  `--force-ca` rotates everything.
* You can override `MTLS_DIR`, `MTLS_SERVICES`, `MTLS_CA_DAYS` and
  `MTLS_LEAF_DAYS`.

## 2. Arm it

```bash
MTLS=1 ./scripts/prod/deploy.sh
# or by hand:
docker compose -f deploy/prod/docker-compose.yml -f deploy/prod/docker-compose.mtls.yml \
  --env-file deploy/prod/.env up -d
```

Each mesh service (gateway, user, job, payment, chat, notification, and the six
engines) gets `GRPC_MTLS=true`, `GRPC_TLS_{CERT,KEY,CA}_FILE=/mtls/...`,
`GRPC_MTLS_SERVICE_NAME=<svc>`, and its own cert dir mounted read-only at
`/mtls`. When the certs are missing or unreadable, the service exits at
startup. It does not fall back to plaintext. Compose healthchecks use the HTTP
observability ports, so they are unaffected.

`MTLS_CERTS_DIR` (default `./mtls`, relative to `deploy/prod/`) moves the cert
root. Use an absolute path if you set it.

## 3. Optional: per-service caller allowlists

Set them in `deploy/prod/.env`. Names are the service names above. When a
variable is empty, any holder of a mesh cert is allowed.

```
MESH_PEER_ALLOWLIST_PAYMENT=gateway,job,user
MESH_PEER_ALLOWLIST_USER=gateway,job,payment,chat,notification
```

Find out who calls whom before you tighten a list (`*_SERVICE_ADDR` envs in
`docker-compose.yml`). A missing caller gets `PermissionDenied`.

## 4. Rotation

Leaf certs expire after 397 days. Rotate before then with
`gen-mtls-certs.sh --force`, then restart the stack:
`MTLS=1 ./scripts/prod/deploy.sh`.
