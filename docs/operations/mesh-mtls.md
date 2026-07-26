# gRPC mesh mTLS

**Status:** code-complete, default-off. Arm only after certs are mounted and
kubelet probes are switched to HTTP healthz.

## Why

Until mTLS is armed, any process that can open a TCP connection to a service
port can call RPCs and supply any `customer_id` / `provider_id` in the request
body. Network position is the authentication boundary. NetworkPolicies reduce
blast radius; mTLS makes peer identity **cryptographic**.

End-user identity still rides on request fields set by the gateway after JWT
verification — that is normal. What mTLS authenticates is the **mesh peer**
(gateway, payment, bidding, …), not the browser user.

## Configuration

Shared env vars (Go `pkg/grpmtls` and Rust `engine_telemetry::load_server_tls`):

| Variable | Meaning |
|----------|---------|
| `GRPC_MTLS` | `true` / `1` forces mTLS; incomplete cert paths then fail closed |
| `GRPC_TLS_CERT_FILE` | This process's cert (PEM) |
| `GRPC_TLS_KEY_FILE` | This process's private key (PEM) |
| `GRPC_TLS_CA_FILE` | Mesh CA that signed peer certs (PEM) |
| `GRPC_TLS_SERVER_NAME` | Client dial SNI / cert DNS SAN (default `nomarkup-mesh`) |
| `GRPC_MTLS_SERVICE_NAME` | Optional explicit service name for allowlists |

Having all three path vars set also enables mTLS even without `GRPC_MTLS=true`.
Partial paths always fail closed.

Development / compose without certs: leave unset → insecure credentials (same
as before). Production: generate certs, mount them, set the paths, then arm.

## Local cert generation

```bash
./scripts/gen-mesh-certs.sh keys/mesh
```

Each service gets `{name}.pem` + `{name}-key.pem` with:

- CN = service name (fallback peer identity)
- DNS SAN = `nomarkup-mesh` + service name
- URI SAN = `spiffe://nomarkup/service/{name}` (preferred peer identity)

## Kubelet probes

Native gRPC liveness/readiness probes **cannot** present a client certificate.
When mTLS is armed (`ClientAuth = RequireAndVerifyClientCert`), those probes
fail and the pod restarts.

Every Go service and Rust engine already exposes HTTP `/healthz` / `/readyz` on
a separate observability port. Switch the Deployment probes to that HTTP port
**before** arming mTLS in a cluster. Do not enable mTLS while probes still use
`grpc:`.

## What remains after arming

1. **Cluster verification (B1):** apply certs + probe switch on staging; confirm
   every service reaches its dependencies and tracing still flows.
2. **Peer allowlists:** `grpmtls.PeerServiceName` extracts the caller from the
   cert; handlers can start rejecting unexpected mesh peers. Request-body
   `customer_id` still comes from the gateway after JWT — that is intentional.
3. **Cert rotation / Vault PKI:** not wired; gen script is for local/dev. Prod
   should issue short-lived certs from the platform CA.

## Unverified in this environment

No Kubernetes cluster and no long-running multi-process mesh here. Transport
credentials load and unit tests pass; end-to-end mTLS between gateway and a
service is not exercised against a live stack.
