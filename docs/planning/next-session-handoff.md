# Next-session handoff — remaining gaps

**As of:** 2026-07-25 (evening), branch `fix/security-audit-2026-04-23`
(local commits ahead of origin; push only when asked)

A production-readiness review closed 18 blockers and ~30 further defects the
fixes uncovered. A later session closed most of **section C** (see
"Closed in code" below). This is what is left, why, and what "done" looks like.

**Read this first:** everything below is either (a) blocked on a decision only a
human can make, (b) unverifiable in a sandbox with no cluster / no Stripe keys /
no load generator, or (c) real code work with a known shape. They are separated
because mixing them is how the first two silently become nobody's job.

**Do not reverse:** `docs/adr/0001-marketplace-payment-collection.md`. In
particular do not default `MARKETPLACE_OFFSESSION_CHARGE` or
`MARKETPLACE_PAYMENT_EXPIRY` on without the decisions in section A.

---

## A. Blocked on a human decision — do these first, they gate other work

### A1. Off-session charging is defaulted OFF, and must stay off until the terms exist
`services/payment/cmd/server/main.go` — `MARKETPLACE_OFFSESSION_CHARGE=false`.

Charging a saved card while the buyer is away requires the bidding terms to say
that placing a bid authorizes it. `tos_versions` / `tos_acceptances` exist but no
terms text in the tree states that authorization, and the content is
admin-managed so it cannot be confirmed from the repo.

**Done when:** legal confirms the terms shipped and someone flips the env var.
Until then the marketplace collects via the "pay for your win" surface
(`POST /api/v1/orders/{id}/pay` — **now shipped**, see C3 closed). See ADR-0001.

### A2. Payment window (72h) and expiry arming
`MARKETPLACE_PAYMENT_WINDOW`, `MARKETPLACE_PAYMENT_EXPIRY` (currently off).

72h is my number, reasoned in ADR-0001 (local pickup holds the seller's item off
the market; eBay's 4 days is calibrated for shipped goods). Arming expiry
cancels won auctions, so it must not be armed before failure notifications are
confirmed to actually send.

**Done when:** product ratifies the window, and someone confirms a real
notification arrives before enabling expiry.

### A3. SCA-pending orders have no time bound
An order awaiting 3DS stays alive indefinitely. Deliberate — cancelling a
solvent, willing buyer's win is the worse error — but it is an unbounded state.

**Done when:** there is a policy (e.g. expire after N reminders) or an explicit
decision to leave it unbounded, recorded.

---

## B. Cannot be verified in this environment — needs a real cluster / keys / load

These are not "probably fine". They are **unproven**, and several are the kind
of thing whose first real run is where you find out.

### B1. Every Kubernetes change is hand-traced only
No `kubectl`, no cluster. Affects: readiness/liveness probes, the gRPC health
registration, the least-privilege NetworkPolicies, automatic rollback, metrics
scrape auth, the JWT key file mounts, **and arming mesh mTLS** (see Closed C1).

The NetworkPolicy work is the riskiest: it replaced an allow-all rule, and
removing an allow-all silently removes whatever else it was permitting. Two such
cases were caught (otel-collector ingress, web→gateway) by enumerating the
reachability matrix. **A third may exist.**

When mTLS is armed, native gRPC kubelet probes **cannot** present a client
cert — switch Deployments to the HTTP healthz/readyz ports first
(`docs/operations/mesh-mtls.md`).

**Done when:** applied to a staging cluster and every service reaches its
dependencies. Check tracing still flows and server-rendered pages still load —
those are the two that would break silently.

### B2. The full-stack CI job has never executed
`.github/workflows/ci.yml` → `fullstack-security-test`. It boots docker compose
and runs the Tier-1 suite (`TestAuthBypass_*`, `TestDoubleSpend_*`,
`TestOwnership_*`) which previously ran nowhere at all.

`actionlint` passes and the job graph resolves, but Docker does not exist here.
Likely first-run issues: BuildKit cache mounts, whether the bogus-login probe
returns exactly 401/404, whether the seeded contract the payment idempotency
test needs exists, and total wall-clock (it now gates `build`).

**Done when:** it goes green once on a real runner.

### B3. The entire payment path is proven against mocks
No Stripe keys. Unproven: that a real 3DS challenge renders and completes, that
a test card declines as expected, that the redirect-return path works, that
Stripe accepts the argument shapes — including the new
`POST /api/v1/orders/{id}/pay` path and re-read `client_secret` on charge
re-entry.

**Done when:** exercised end-to-end against Stripe test keys with a live stack
(see `E2E.md`).

### B4. 8 of 12 performance budgets have no measurement
CLAUDE.md §8. The four measured are Rust compute paths measured in isolation —
no serialization, no network, no DB — so they do not validate a service-level
p99 either.

Note: `rank_bids` is `#[allow(dead_code)]` and the criterion bench measures it,
so **the bid-ranking benchmark measures a function the server never calls.** The
server ranks via SQL `ORDER BY`. Any future latency claim must not cite it.

**Done when:** the k6 scripts in `tests/load/` run against a live stack.

### B5. Migrations verified on PostGIS 3.6; production targets 3.4
107 migrations apply clean on PG17 + PostGIS 3.6. The PG16 run had to shim
PostGIS types. The spatial DDL is untested on the real target version.

---

## C. Real code work still open

### C2. The frontend cannot save EIN/TIN or insurance policy number
`proto/user/v1/user.proto` has no fields for them (re-verified: 0 matches), so the
encrypt-on-write path is unreachable from the UI —
`web/src/app/.../provider/onboarding/page.tsx` collects both and silently drops
them. The load-bearing half is done (those columns can never be written in
plaintext); the contract is additive work spanning proto → gRPC → gateway → web.

### C4. No SCA notification type
The enum has no member for "authentication required", so it reuses
`PAYMENT_FAILED` with the distinction in `Data["outcome"]`. A dedicated member
would let the UI render an "Authenticate" button instead of a generic failure.

### C7. The CDN half of the cache guard — **origin cannot finish this**
`writeCachedJSON` refuses to publicly **store** a response for an identified
caller. That does **not** prevent a public body already at the edge from being
**served** to a signed-in caller.

**Origin work:** documented only —
`docs/operations/cdn-cache-auth-bypass.md` (Cloudflare expression + verification
steps).

**Done when:** a Cloudflare rule on the API zone bypasses cache when
`Authorization` or the `refresh_token` cookie is present. Needs CF account
access; not doable from the repo alone.

### C8. Web has zero OpenTelemetry
Verified: no `@opentelemetry/*` anywhere in `web/`. The Go tier is instrumented
and the Rust engines emit spans, so the trace starts at the gateway — the
browser and server-rendered hops are missing.

### C11. Remaining small items (partially closed)
- ~~`CreateInsurancePaymentIntent` empty idempotency key~~ — **closed** (empty
  key fails closed; `TestCreateInsurancePaymentIntent_requiresIdempotencyKey`).
- GDPR erasure leaves `jobs` geometries at their ~1 km cell rather than zeroing
  (zeroing would move a deleted user's public jobs to 0,0). Documented trade.
- The licence read path 500s on an unopenable ciphertext, so a key rotation
  without `ENCRYPTION_KEY_PREVIOUS` takes out the public badge endpoint until
  the key is restored.
- Bid bonds still have no capturable artifact — the table has no payment-method
  column and the handler discards the `payment_method_id` it receives. Capture
  on no-show remains unimplemented, not merely unwired.
- `provider_profiles.service_location` stays exact at rest. It is the indexed
  `ST_DWithin` target and backs the distance `ORDER BY`; ciphertext cannot be
  indexed and coarsening perturbs a 30%-weighted ranking term. Documented as a
  `COMMENT ON COLUMN` with a revisit condition.

---

## Closed in code (do not re-open without re-verifying)

### C1. mTLS for the gRPC mesh — **code complete, default OFF**
Shared `pkg/grpmtls` (Go) + `engine_telemetry::load_server_tls` (Rust). All Go
dial sites and servers, and all six Rust engines, load mTLS when
`GRPC_TLS_CERT_FILE` / `KEY` / `CA` are set (or `GRPC_MTLS=true`). Dev/default
still uses insecure credentials so compose and tests keep working.

- Cert generator: `./scripts/gen-mesh-certs.sh`
- Ops: `docs/operations/mesh-mtls.md`
- Peer name helper: `grpmtls.PeerServiceName` (SPIFFE URI SAN or CN)

**Still open (not “done” by the original definition):**

1. Certs mounted and mTLS **armed** in a real cluster (B1).
2. Kubelet probes switched to HTTP before arming.
3. Handlers do **not** yet reject unexpected mesh peers via allowlists; end-user
   identity still rides on request fields set by the gateway after JWT (that is
   intentional — mTLS authenticates the mesh peer, not the browser user).

### C3. `POST /api/v1/orders/{id}/pay` — **shipped**
- Route: `ListingOrdersHandler.PayOrder`, buyer-only, idempotent key required,
  409 if not `pending_payment`, 503 if empty `client_secret`.
- `ChargeListingWinner` re-entry re-reads ClientSecret from Stripe / dev store
  (mutation-tested).
- Dev marketplace secrets shaped so web `hasConfirmablePayment` accepts them.
- `total_cents` forwarded on pay, buy-now, and offer-accept.

Unverified: live Stripe 3DS against this route (B3).

### C5. `stale-if-error` bounded — **shipped**
`staleIfErrorSeconds(sMaxAge, swr)` = `max(sMaxAge*10, swr*2)`, hard-capped at
1h. Feature flags (60/300) → 600s, not 86400.

### C6. `MyListings` Cache-Control — **shipped**
`private, no-store` set first on `MyListings`; `GetListing` delegates `id=mine`
before the nil-DB check so the collision path always stamps it.

### C9. `pricing` and `underwriting` Prometheus metrics — **shipped**
`engines/{pricing,underwriting}/src/metrics.rs`; observe in gRPC handlers;
optional HTTP server on `PRICING_METRICS_PORT` / `UNDERWRITING_METRICS_PORT`.

### C10. Web idempotency key reuse — **shipped (money paths)**
`idempotencyHeader(operationKey)` reuses a UUID per logical operation until
`clearIdempotencyKey`. Wired on order-pay, buy-now, create-payment, process-payment.
Legacy no-arg still mints a fresh key — prefer always passing an operation key
on new money call sites.

---

## Suggested order for the next session

1. **C2** if product needs onboarding EIN/TIN (proto → web contract).
2. **C4** if SCA UX needs a dedicated notification type.
3. **C8** if tracing browser → gateway is a release gate.
4. Otherwise stay on **A** (human) and **B** (staging/Stripe/k6) — those gate
   production claims more than residual C polish.
5. **C7** only when someone has Cloudflare API access.

---

## D. Invariants worth not breaking

Cheap to state, expensive to rediscover.

1. **Coordinate coarsening is bit-exact with SQL.** `testdata/geo_coarsen_golden.csv`
   pins four implementations (three Go copies + `pii_coarsen_ordinate`). The
   binary residue in `math.Round(v/0.01)*0.01` is CORRECT — "tidying" it breaks
   equality with Postgres. The guard is mutation-tested and catches a one-bit
   difference.
2. **Detect encrypted PII per VALUE by authentication, never by a per-row flag.**
   `pii_encrypted_v1` is per-row while encryption is per-column, so a row can
   read TRUE with a plaintext column. Three outcomes: opens → plaintext; not our
   format → legacy plaintext; **is our format but will not open → error, never
   emit raw bytes.**
3. **Money paths fail closed.** Escrow release and post-payout refunds are
   actor-checked; the idempotency middleware refuses rather than risking a
   duplicate charge; feature flags fail closed in production.
4. **Anything encrypted needs a write path AND a read path.** Encrypting on
   backfill alone means new rows silently land in plaintext while the docs claim
   coverage. That bug has occurred here twice.
5. **ChargeListingWinner re-entry must return a non-empty ClientSecret** for
   `pending_payment` (pay-route / SCA). Do not strip the re-read; the unit test
   pins it and mutation-fails without it.
6. **Mesh mTLS stays default-off** until certs + HTTP probes are real. Do not
   set `GRPC_MTLS=true` in production manifests without the probe switch.
