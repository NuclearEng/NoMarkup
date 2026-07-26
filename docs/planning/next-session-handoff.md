# Next-session handoff — remaining gaps

**As of:** 2026-07-25, branch `fix/security-audit-2026-04-23` (pushed, 40 commits ahead of `main`)

A production-readiness review closed 18 blockers and ~30 further defects the
fixes uncovered. This is what is left, why, and what "done" looks like for each.

**Read this first:** everything below is either (a) blocked on a decision only a
human can make, (b) unverifiable in a sandbox with no cluster / no Stripe keys /
no load generator, or (c) real code work with a known shape. They are separated
because mixing them is how the first two silently become nobody's job.

---

## A. Blocked on a human decision — do these first, they gate other work

### A1. Off-session charging is defaulted OFF, and must stay off until the terms exist
`services/payment/cmd/server/main.go` — `MARKETPLACE_OFFSESSION_CHARGE=false`.

Charging a saved card while the buyer is away requires the bidding terms to say
that placing a bid authorizes it. `tos_versions` / `tos_acceptances` exist but no
terms text in the tree states that authorization, and the content is
admin-managed so it cannot be confirmed from the repo.

**Done when:** legal confirms the terms shipped and someone flips the env var.
Until then the marketplace collects via the "pay for your win" surface, which
works — this is not a broken state, it is a deliberate one. See ADR-0001.

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
scrape auth, the JWT key file mounts.

The NetworkPolicy work is the riskiest: it replaced an allow-all rule, and
removing an allow-all silently removes whatever else it was permitting. Two such
cases were caught (otel-collector ingress, web→gateway) by enumerating the
reachability matrix. **A third may exist.**

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
Stripe accepts the argument shapes.

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

## C. Real code work, known shape

### C1. mTLS for the gRPC mesh — the largest remaining security gap
The mesh runs on `insecure.NewCredentials()` (6 dial sites) and the RPCs take
the acting user's identity as a **request field** (`AwardBidRequest.customer_id`,
the `provider_id` fields). The service trusts what it is told, so anything that
can open a TCP connection to a service port can impersonate any user.

The network half is done — `deploy/k8s/base/network-policy.yaml` now grants
least privilege derived from the real call graph — but that reduces blast radius,
it does not authenticate. Until mTLS lands, **network position is the
authentication boundary.**

**Done when:** peer identity is cryptographic and the services derive the caller
from the certificate rather than the request body.

### C2. The frontend cannot save EIN/TIN or insurance policy number
`proto/user/v1/user.proto` has no fields for them (verified: 0 matches), so the
new encrypt-on-write path is unreachable from the UI —
`web/src/app/.../provider/onboarding/page.tsx` collects both and silently drops
them. The load-bearing half is done (those columns can never be written in
plaintext); the contract is additive work spanning proto → gRPC → gateway → web.

### C3. `POST /api/v1/orders/{id}/pay` does not exist
Verified: no such route. The web "pay for your win" surface was built against it
and degrades to an explanatory message on 404/405/501 rather than crashing — but
until it exists, a buyer whose off-session charge fails has no way to pay.

**This is the gap that most directly blocks A1/A2 being meaningful.**

Two related contract gaps: `ChargeListingWinner`'s idempotent re-entry returns
an **empty** `ClientSecret` (`listing_charge.go`), so a retry hands the browser
nothing — whoever wires the route must re-read or persist it. And the gateway
drops `total_cents` from `ChargeListingWinnerResponse`, so the client cannot
show the real total (item + fee + tax) and the button says "Pay now" rather than
an amount.

### C4. No SCA notification type
The enum has no member for "authentication required", so it reuses
`PAYMENT_FAILED` with the distinction in `Data["outcome"]`. A dedicated member
would let the UI render an "Authenticate" button instead of a generic failure.

### C5. `stale-if-error=86400` on the feature-flag endpoint
`gateway/internal/handler/feature_flag.go:66` — `writeCachedJSON(..., 60, 300)`
inherits the flat 24h `stale-if-error`. During an origin outage the edge can
serve a **day-old flag map**. Combined with flags failing *open* on a missing
row, disabling a financial flag and then hitting an origin error keeps it
enabled at the edge for up to a day.

**Done when:** `stale-if-error` is a parameter bounded relative to `s-maxage`
rather than a flat constant.

### C6. `MyListings` is reachable from a public route with no `Cache-Control`
`gateway/internal/handler/listings.go` delegates `GET /api/v1/listings/{id}` to
`MyListings` when `id == "mine"` (a chi route-collision workaround).
`MyListings` (`listings_bid.go:883`) reads claims, 401s on that path, and writes
with `writeJSON` and **no** cache header, outside the `PrivateNoStore` subtree.
Nothing leaks today. If that route ever gains `optionalAuth` it would emit a
per-user body with no cache header on a public path.

**Done when:** `w.Header().Set("Cache-Control", "private, no-store")` at the top
of `MyListings`.

### C7. The CDN half of the cache guard
`writeCachedJSON` now refuses to publicly cache a response for an identified
caller. That prevents a per-user body being **stored**. It does **not** prevent a
public body being **served** to a signed-in caller — if the edge holds a fresh
copy the origin is never consulted.

**Done when:** a Cloudflare rule on the API zone bypasses cache when
`Authorization` or the `refresh_token` cookie is present. Cannot be done from
the origin.

### C8. Web has zero OpenTelemetry
Verified: no `@opentelemetry/*` anywhere in `web/`. The Go tier is now genuinely
instrumented and the Rust engines emit spans, so the trace starts at the gateway
— the browser and server-rendered hops are missing.

### C9. `pricing` and `underwriting` export no Prometheus metrics
No `metrics.rs` in either (the other four have one). `underwriting` also
declares `prometheus`/`hyper`/`http-body-util` dependencies it never uses.

### C10. The web client defeats its own idempotency
`web/src/lib/api.ts` mints a **fresh** UUID per call, so a retry presents a new
key and the middleware cannot dedupe. Idempotency keys are now correctly scoped
per caller and route server-side, and the middleware fails closed — but the
client makes it a header-presence tax rather than a retry guarantee.

**Done when:** the key is derived from the logical operation and reused across
retries of that operation.

### C11. Smaller, verified, uncontroversial
- `CreateInsurancePaymentIntent` sets `IdempotencyKey` without the empty-guard
  every other money method has. Its only caller always passes one, so it is
  latent, not live.
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
