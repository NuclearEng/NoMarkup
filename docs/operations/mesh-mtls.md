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

Shared env vars (Go `pkg/grpmtls` and Rust `engine_telemetry::{load_server_tls,
PeerAllowlist}`):

| Variable | Meaning |
|----------|---------|
| `GRPC_MTLS` | `true` / `1` forces mTLS; incomplete cert paths then fail closed |
| `GRPC_TLS_CERT_FILE` | This process's cert (PEM) |
| `GRPC_TLS_KEY_FILE` | This process's private key (PEM) |
| `GRPC_TLS_CA_FILE` | Mesh CA that signed peer certs (PEM) |
| `GRPC_TLS_SERVER_NAME` | Client dial SNI / cert DNS SAN (default `nomarkup-mesh`) |
| `GRPC_MTLS_SERVICE_NAME` | Optional explicit service name this process claims |
| `MESH_PEER_ALLOWLIST` | Optional comma-separated peer service names permitted to call this server (e.g. `gateway,payment`). **Default empty = no peer check.** When set, unary/stream interceptors reject unexpected SPIFFE/CN with `PermissionDenied`. |

Having all three path vars set also enables mTLS even without `GRPC_MTLS=true`.
Partial paths always fail closed.

Development / compose without certs: leave unset → insecure credentials (same
as before). Production: generate certs, mount them, set the paths, then arm.

### Peer allowlist (optional application-layer check)

Transport mTLS proves the peer holds a mesh cert signed by the CA. The
**allowlist** is a second, optional gate: only listed service names may invoke
RPCs on this process.

- **Go code:** `pkg/grpmtls.PeerServiceName` (SPIFFE URI SAN preferred, else CN)
  + `UnaryServerInterceptor` / `StreamServerInterceptor` + `ParsePeerAllowlist`
  / `PeerAllowlistFromEnv`.
- **Go wiring:** every Go service server already calls
  `grpmtls.Config.AppendServerOptions`, which chains the interceptors when
  `MESH_PEER_ALLOWLIST` is non-empty. No per-handler changes.
- **Rust code:** `engine_telemetry::PeerAllowlist` + `peer_allowlist_layer()`
  (tonic interceptor) + `parse_peer_allowlist` / `peer_service_name_from_der`
  (SPIFFE URI SAN preferred, else CN — same rules as Go).
- **Rust wiring:** every engine (`bidding`, `fraud`, `trust`, `imaging`,
  `pricing`, `underwriting`) applies `.layer(peer_allowlist_layer())` on the
  tonic `Server` builder. Empty allowlist → interceptor is a no-op (still
  registered; zero cost beyond one empty-set check).
- **Default OFF:** empty / unset allowlist → no peer check.
- **Fail closed when armed:** missing peer identity (plaintext dial) or a peer
  name not on the list → `codes.PermissionDenied` / tonic
  `Status::permission_denied`. Do not enable the allowlist without mTLS (or
  you will reject every call).
- **Example (job service / bidding engine accepts only gateway):**  
  `MESH_PEER_ALLOWLIST=gateway`
- **Example (payment accepts gateway + job):**  
  `MESH_PEER_ALLOWLIST=gateway,job`

End-user identity still rides on request fields set by the gateway after JWT —
that is intentional. The allowlist authenticates the **mesh peer**, not the
browser user.

## Local cert generation

```bash
./scripts/gen-mesh-certs.sh keys/mesh
```

Each service gets `{name}.pem` + `{name}-key.pem` with:

- CN = service name (fallback peer identity)
- DNS SAN = `nomarkup-mesh` + service name
- URI SAN = `spiffe://nomarkup/service/{name}` (preferred peer identity)

## Kubelet probes

**2026-08-03:** Rust engine Deployments (bidding, fraud, trust, imaging,
underwriting, pricing) use **HTTP** `GET /healthz` on the named `metrics` port
(not `grpc:`). Go services already use HTTP. That probe switch is done in-repo —
still verify on a live cluster before arming mTLS.

**Privileged money peers (2026-08-04):** After mTLS is armed, set
`MESH_PRIVILEGED_MONEY_PEERS=gateway` on the **payment** service so
`ActorIsAdmin` / `SystemInitiated` release and refund RPCs only succeed from
allowlisted mesh peers. Unset = private-network trust (dev default).

Native gRPC liveness/readiness probes **cannot** present a client certificate.
When mTLS is armed (`ClientAuth = RequireAndVerifyClientCert`), those probes
fail and the pod restarts.

Go services expose HTTP `/healthz` + `/readyz` on the metrics port. Rust engines
expose process `/healthz` on the metrics port (Deployments already probe that —
2026-08-03). Confirm probes on staging before arming mTLS. Do not re-enable
`grpc:` probes under mTLS.

## What remains after arming

1. **Cluster verification (B1):** apply certs + probe switch on staging; confirm
   every service reaches its dependencies and tracing still flows.
2. **Peer allowlists (code shipped on Go + Rust, default off):** set
   `MESH_PEER_ALLOWLIST` per Deployment once mTLS is armed and expected
   callers are known. Residual is **ops** (which names each service/engine
   should accept), not missing library support. Engines typically accept
   `gateway` (and sometimes `job` / `payment` for inter-service dials).
3. **Cert rotation / Vault PKI:** not wired; gen script is for local/dev. Prod
   should issue short-lived certs from the platform CA.

## Unverified in this environment

No Kubernetes cluster and no long-running multi-process mesh here. Transport
credentials load and unit tests pass; end-to-end mTLS between gateway and a
service is not exercised against a live stack.
