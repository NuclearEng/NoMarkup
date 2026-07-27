# Production Readiness — Final Report

Generated 2026-04-26. Branch: `fix/security-audit-2026-04-23`.

## Verdict

| Stage | Verdict |
|---|---|
| Internal beta | ✅ READY |
| Closed beta (50 invited) | ✅ READY |
| Public 1% rollout | ⚠️ READY pending external infra (Sentry org, Cloudflare WAF, Stripe live keys) |
| Public GA | ⚠️ READY after 7-day clean canary + production restore drill |

## Gap closure scoreboard

| # | Gap | Status | Commit(s) | Evidence |
|---|---|---|---|---|
| 1 | PII at-rest encryption | ✅ CLOSED | `a3be00b` | `pg_dump` of encrypted columns shows ciphertext only; `make encrypt-pii` round-trip verified; key rotation procedure documented |
| 2 | GDPR full erasure pipeline | ✅ CLOSED | `2defbb2`, `173a18e`, `452cb68`, `661b536`, `612813f`, `245127c` | Lifecycle (Request → 30-day grace → Finalize) end-to-end, table-by-table cascade with FOR UPDATE idempotency, gateway routes wired, web UI shipped, integration tests pass |
| 3 | HashiCorp Vault client | ✅ CLOSED | `8a4daa7` | `gateway/internal/vault/` wrapper with AppRole + token auth + env fallback + TTL cache; 3/3 unit tests pass; `docs/operations/vault-client.md` covers AppRole setup, dev bootstrap, K8s migration |
| 4 | Rust engine Prometheus exposition | ✅ CLOSED for the 4 stateful engines (⚠️ 2 remain) | — | `engines/{bidding,fraud,trust,imaging}/src/metrics.rs` each serve `/metrics` on a `{ENGINE}_METRICS_PORT` listener, wired + scraped in `deploy/k8s/base/*/deployment.yaml`. `pricing` and `underwriting` still have none (`prometheus.io/scrape: "false"`) — tracked as OPS-18. Superseded the old "deferred, gateway histograms cover it" note, which was wrong on both counts (see Observability inventory). |
| 5 | CSP nonce migration | ✅ CLOSED | `7eeeed8` | Per-request nonce in `web/src/middleware.ts` with `'strict-dynamic'`; verified 3 sequential requests produce 3 distinct nonces; 0 securitypolicyviolation events on every audited page |
| 6 | Slow-3G LCP tuning | ✅ CLOSED | `ec7b958` | `/` LCP 4224 → 3952 ms; `/dashboard` LCP 5040 → 3812 ms (both under 4000 ms budget); per-route bundles within 50 KB budget |

## CI gate results

| Gate | Result |
|---|---|
| Web TypeScript | **0 errors** |
| Web ESLint | **0 errors** |
| Web Vitest | **3671 / 3671 passing** |
| Web Playwright (49-page real-stack tour) | **49 / 49 rendered, 0 page errors** |
| Go services build | All clean (user, job, payment, chat, notification, gateway) |
| Go services tests | All pass |
| Rust engines build | Clean (`cargo build --workspace`) |
| Rust engines tests | Clean (no failures) |
| Postgres migration round-trip | Clean (versions 1 → 32 → 28 → 32) |

**Update (2026-07-25).** This table is a point-in-time snapshot from the readiness pass and predates
several CI jobs. Current gate list is `.github/workflows/ci.yml`; the two that changed the coverage
story materially:

- `fullstack-security-test` — boots the docker-compose stack and runs the Tier-1 suites in
  `tests/integration/` (4 × `TestAuthBypass_*`, `TestDoubleSpend_ParallelAwardsCreateOneContract`,
  `TestOwnership_CrossAccountReadIsRejected`) plus the live-stack
  `TestIdempotency_PaymentDoubleSubmit`. Before this job those tests ran **nowhere** — every file is
  behind `//go:build integration`, so `go test ./...` matched no packages. It is a hard `needs:` of
  `build`.
- `money-race-tests` now passes `-tags integration -short`, so the tagged idempotency test at least
  compiles on every PR (it previously was not part of that job's build at all, despite the job name).

## DR drill — actual numbers

Executed 2026-04-26 against the local dev stack.

| Step | Time |
|---|---|
| `pg_dump -F c` of full DB | 1s |
| Stop services + drop DB | 5s |
| `pg_restore` | 0s (sub-second) |
| Verify counts match baseline | — |
| **Total RTO** | **6 seconds** |

Baseline counts: 17 users, 416 jobs, 3088 bids, 16 contracts, 4 reviews, 2 provider_profiles, 378 service_categories.
Post-restore: identical row counts. ✅

Backup file: 524 KB. The dev stack is small; production RTO will be dominated by file-transfer time (network + disk I/O for multi-GB dumps) and infrastructure provisioning (managed Postgres restore + DNS cutover). RTO budget per `docs/operations/backup-disaster-recovery.md` is 1h; this drill confirms the procedure works.

**Caveat**: pg_dump version must match server version. macOS Homebrew installs 16 by default; this branch documents `/opt/homebrew/opt/postgresql@17/bin/pg_dump` as the correct binary. Pin pg_dump version in CI.

## Security inventory

Per CLAUDE.md §6:

| Requirement | Status |
|---|---|
| JWT (RS256), short-lived access (15min), refresh in HTTP-only cookies | ✅ |
| Role-based access (customer, provider, admin) | ✅ all endpoints check role |
| Argon2id password hashing | ✅ |
| Backup codes argon2id hashed (one-way) | ✅ |
| PII at rest | ✅ **XSalsa20-Poly1305** via Go `nacl/secretbox` — *not* AES-256-GCM, and not whole-row: selected fields only (phone, MFA secret, provider service address, EIN/TIN, insurance policy number; migrations `031`/`033`). Email stays plaintext for auth lookup. See CLAUDE.md §6 and tracker SEC-13. |
| TLS | ⚠️ **edge default + mesh optional.** TLS 1.3 + HSTS at the ingress/CDN (`next.config.ts`). gRPC mesh mTLS is **code-complete, default-off** (`pkg/grpmtls` / `engine_telemetry::load_server_tls`; `docs/operations/mesh-mtls.md`; tracker SEC-05 Done code, claim demoted). Without certs mounted the mesh still uses insecure credentials on the private network. Do not read this row as "TLS 1.3 for all connections". |
| CORS allowlist (no wildcards in prod) | ✅ |
| CSP | ✅ `script-src` per-request nonce + `strict-dynamic`, no `'unsafe-eval'` in prod. ⚠️ `style-src` still allows `'unsafe-inline'` (`web/src/middleware.ts:161`) — Next.js/Tailwind inject styles; tracker SEC-11. |
| Per-IP + per-user rate limiting | ✅ 5/15min on auth tier |
| Stripe webhook signature mandatory + replay-safe | ✅ |
| Idempotency keys on payment mutations | ✅ middleware + DB unique constraint |
| Secrets in Vault (or fallback to K8s/env) | ✅ wrapper exists, env-fallback works |

## Observability inventory

Per CLAUDE.md §11:

| Component | Status |
|---|---|
| Structured JSON logs everywhere | ✅ slog (Go) + tracing (Rust) |
| Per-service `/healthz` + `/readyz` | ⚠️ **endpoints exist everywhere in Go; k8s only probes them on the gateway.** Gateway serves `/healthz`, `/health` (legacy alias) and `/readyz` on the main port (`gateway/internal/router/router.go:145-147`); each Go service serves `/healthz` + `/readyz` on its separate observability port (`services/{user,job,payment,chat,notification}/cmd/server/observability.go`). Only `deploy/k8s/base/gateway/deployment.yaml:114-131` actually probes HTTP (liveness `/health`, readiness `/readyz`); every Go service and Rust engine uses a `grpc:` probe instead, so the HTTP readiness endpoints are unprobed in-cluster. Rust engines have no HTTP health endpoint at all. |
| gRPC health on Rust engines | ✅ tonic-health — and it is what k8s actually probes (`deploy/k8s/base/{bidding,fraud,trust,imaging,pricing,underwriting}/deployment.yaml`) |
| Prometheus `/metrics` per Go service | ✅ (gateway `/metrics` is now bearer-token/loopback gated — `router.go:148`, `protectMetrics`) |
| Prometheus per Rust engine | ⚠️ **4 of 6 shipped, not deferred.** `bidding`, `fraud`, `trust`, `imaging` each have `src/metrics.rs` exporting the SLO histograms (`bid_processing_duration_seconds`, `fraud_scoring_duration_seconds`, `trust_score_computation_duration_seconds`, `image_processing_duration_seconds`) behind a `{ENGINE}_METRICS_PORT` listener that `deploy/k8s/base/*/deployment.yaml` sets and scrapes. `pricing` and `underwriting` have no `metrics.rs` and are `prometheus.io/scrape: "false"`. The old "gateway gRPC histograms cover SLOs" caveat was also wrong twice over: it covered only *gateway-observed* latency, and `GRPCRequestDuration` was registered-but-never-observed until the `GRPCClientInterceptor` was wired (`gateway/internal/middleware/metrics.go:49-56` declares it, `gateway/internal/middleware/grpcclient.go:62` observes it, `gateway/cmd/server/main.go:126-130` installs it). |
| OpenTelemetry traces (gateway → service → DB / Redis / Stripe / Meilisearch) | ✅ for the Go tier: inbound HTTP server root span with `traceparent` extraction (`gateway/internal/middleware/tracing.go:63-107`), `otelgrpc` client handler on all 9 backend dials (`gateway/cmd/server/main.go:125`) and server handlers in all 5 Go services, `otelpgx` DB spans in the gateway + all 5 services, `redisotel` in gateway/chat/user/job, `otelhttp` around Meilisearch (`gateway/internal/observability/httpclient.go:24-35`), hand-rolled Stripe client spans (`services/payment/internal/observability/stripe.go:23-31`). |
| ⤷ **web** hop | ❌ **not traced.** `web/` has no `@opentelemetry/*` dependency; `web/src/instrumentation.ts` is Sentry-only. The browser/Next server never emits or propagates `traceparent`, so traces start at the gateway, not the browser. |
| ⤷ **engine** hop | ⚠️ OTLP exporter init exists in `bidding`/`fraud`/`trust`/`imaging` (none in `pricing`/`underwriting`), but **no span is ever created** — no `#[instrument]`, no `*_span!`, no tower `TraceLayer`. In practice the Rust tier contributes no spans (no gRPC server spans, no sqlx DB spans). |
| ⤷ **S3** spans | ❌ none, and none possible in Go — **no AWS SDK exists in any Go module** in this repo. All S3/MinIO I/O lives in the Rust imaging engine (`engines/imaging/Cargo.toml` `aws-sdk-s3`), which is untraced (see above). |
| ⤷ **notification** Redis | ⚠️ `services/notification` creates Redis clients without `redisotel.InstrumentTracing` (`cmd/server/follows_pubsub.go:68`, `cmd/server/listing_scheduler.go:285`) — the only Go service missing Redis spans. |
| Sentry (env-gated) | ✅ all 5 Go services + gateway + web |

## Runbooks (`docs/runbooks/`)

| Scenario | File |
|---|---|
| Stripe webhook stuck / signature failure | `01-stripe-webhook-stuck.md` |
| Postgres master down / failover | `02-database-master-down.md` |
| Provider payout failed | `03-provider-payout-failed.md` |
| Bidding engine down / queue replay | `04-bidding-engine-down.md` |
| Auth / user service degraded | `05-auth-service-degraded.md` |
| Fraud false positive / manual override | `06-fraud-false-positive.md` |
| Redis degraded or unreachable | `07-redis-degraded.md` |
| Meilisearch degraded | `08-meilisearch-degraded.md` |
| Database migration Job | `09-migration-job.md` |

## Operations docs (`docs/operations/`)

- `incident-response.md`
- `oncall-checklist.md`
- `gdpr-delete.md` (now reflects shipped implementation)
- `backup-disaster-recovery.md`
- `abuse-defense.md`
- `scaling-blockers.md`
- `metrics.md`
- `encryption-key-rotation.md`
- `vault-client.md`

## Outstanding follow-ups (open tickets)

These do not block beta / 1% rollout:

1. **Rust engine `/metrics` — remaining 2 engines.** `bid_processing_duration_seconds`, `trust_score_computation_duration_seconds`, `fraud_scoring_duration_seconds` and `image_processing_duration_seconds` all ship today (see gap #4). What is left is `engines/pricing` and `engines/underwriting`: neither has a `src/metrics.rs` or a `*_METRICS_PORT` listener, and both are `prometheus.io/scrape: "false"` in `deploy/k8s/base/`. (`underwriting/Cargo.toml` already pulls in `prometheus`/`hyper` but never uses them.)
2. **CSP `style-src 'unsafe-inline'`** — Tailwind v4 + Next.js still require it. Track upstream Next.js progress on RSC nonce-injection support for inline styles.
3. **External secret-id rotation** — implement `external-secrets-operator` sidecar for Vault AppRole secret-id rotation in K8s.
4. **Vault token renewal** — add a goroutine to renew Vault tokens before expiry (currently relies on AppRole login on each service start).
5. **Production restore drill** — execute a full restore on staging quarterly per `docs/operations/backup-disaster-recovery.md`. Local drill (this report) only validates the procedure.
6. **Email delivery for GDPR confirmation** — **SHIPPED (ARC-17)**: request/cancel/finalize via notification → SendGrid; residual is operational (`SENDGRID_API_KEY` on notification service), same as other transactional mail.
7. **Stripe Connect + Customer cleanup on GDPR delete** — `StripeDeleter` interface exists with no-op default; payment-service team to wire the actual API calls.
8. **PII audit follow-ups** — `provider_employees.phone`, `properties.address` (lat/lng kept for analytics), `company_employees.ssn_last_four` are in the same risk class as the encrypted columns; consider in next PII pass.

## Branch state

26 commits ahead of `main` since the start of this readiness pass:

```
8a4daa7 feat(security): vault client wrapper + GDPR account-page lint fixes
a3be00b feat(security): encrypt PII at rest with nacl/secretbox
245127c docs(gdpr): rewrite gdpr-delete.md to reflect implementation
612813f feat(web): add account settings page with delete/restore flow
661b536 feat(gateway): wire GDPR erasure routes
452cb68 feat(user-svc): implement GDPR/CCPA full-erasure pipeline
173a18e feat(db): add 032 migration for GDPR erasure lifecycle columns
2defbb2 feat(proto): add GDPR/CCPA erasure RPCs to user service
ec7b958 perf(web): bring / and /dashboard LCP under 4s on Slow 3G
7eeeed8 perf(web): migrate CSP to per-request nonce + 'strict-dynamic'
6d3ab32 feat(readiness): tier 1/2/3 production-readiness pass — 4 agent teams
70a3636 fix(stack): resolve last 2 page errors from post-deploy verification
6dede6a fix(stack): close 16 E2E gaps surfaced by full-stack functional test
... (13 earlier commits in this branch's history)
```
