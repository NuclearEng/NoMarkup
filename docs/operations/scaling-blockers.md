# Horizontal Scaling Blockers

> What stops us from adding more pods to handle more load? An honest audit
> of statefulness, in-memory caches, and sticky-session assumptions.

## TL;DR

Most services are statelessly horizontal. The notable exceptions:

1. **Gateway in-memory rate limit fallback** — degrades when Redis is unavailable but does not block scaling.
2. **Chat WebSocket hub is per-pod** — connections are sticky to the pod that owns them; cross-pod broadcasts go through Redis Pub/Sub.
3. **Bidding engine** — stateless per-bid but relies on Postgres row locks for serialization. Adding pods is safe but database becomes the bottleneck.

No state lives on local disk. No services use sticky-session cookies.

## Service-by-Service Audit

### Gateway

| Concern                     | State                                                            |
|-----------------------------|------------------------------------------------------------------|
| Sessions                    | Stateless — JWT validation uses public key in pod, no DB call.   |
| Rate limit                  | Redis-backed; in-memory fallback per-pod (degrades behavior under Redis outage but does not break it). |
| Idempotency cache           | Redis. Per-pod cache absent — every request hits Redis.          |
| File uploads                | Streamed direct to S3 (presigned URL flow); no temp files.       |
| WebSocket connections       | Forwarded to chat service; gateway holds no upgrade state.       |

**Verdict:** Safe to scale to N pods. With Redis present, behavior is identical regardless of N.

### User Service

| Concern                     | State                                                            |
|-----------------------------|------------------------------------------------------------------|
| Sessions                    | Hashed refresh tokens in Postgres (`sessions` table).            |
| OTP / MFA challenges        | Redis with TTL.                                                  |
| Password hashing            | Per-request CPU; no shared state.                                |

**Verdict:** Safe to scale.

### Job Service

| Concern                     | State                                                            |
|-----------------------------|------------------------------------------------------------------|
| Search index                | Meilisearch (external).                                          |
| Job lifecycle               | Postgres (status transitions are safe via row locks).            |
| Photos                      | S3.                                                              |

**Verdict:** Safe to scale.

### Payment Service

| Concern                     | State                                                            |
|-----------------------------|------------------------------------------------------------------|
| Stripe API                  | External, idempotent via `Idempotency-Key`.                      |
| Escrow ledger               | Postgres.                                                        |
| Webhook processing          | Idempotent via `processed_events` table — replay-safe across pods. |
| Subscription billing        | Stripe Connect; we don't keep authoritative billing state.       |

**Verdict:** Safe to scale. The webhook processor is the most subtle —
double-delivery is handled by checking `processed_events` before applying the
event, so two pods receiving the same retry are safe.

### Chat Service ⚠️

| Concern                     | State                                                            |
|-----------------------------|------------------------------------------------------------------|
| **WebSocket connections**   | **In-memory per-pod hub** (`internal/ws/handler.go` Hub struct). |
| Pub/Sub fan-out             | Redis Pub/Sub (every pod subscribes; messages reach all pods that hold a connection for that user). |
| Channel/message persistence | Postgres.                                                        |

**Implication:** A user's connection lives on one pod. If that pod dies, the
client reconnects to a different pod and gets a new WebSocket. Active state
is rebuilt from `chat_messages` + the Redis subscription.

**Sticky session is NOT required** because:
- Sends from any pod to any user are routed via Redis Pub/Sub.
- Reads of historical messages go through Postgres (any pod).
- Clients reconnect on disconnect.

**What WOULD require sticky session (and is not implemented):**
- Server-side WebSocket message ordering across reconnects.
- "Typing…" presence aggregation (currently best-effort, may be slightly stale).

**Scale ceiling per pod:** The hub's `connections` map is keyed by user ID and
appends to a slice on each connection. With ~10k connections per pod
(per CLAUDE.md infra budget: 100k per node ÷ 10 pods/node), the map is
trivially sized. Above that, switch to a sharded map.

### Notification Service

| Concern                     | State                                                            |
|-----------------------------|------------------------------------------------------------------|
| Email / SMS / push          | Stateless dispatchers; external services (SendGrid, Twilio, FCM). |
| Notification preferences    | Postgres.                                                        |
| Templates                   | Embedded in code or external (SendGrid).                         |

**Verdict:** Safe to scale.

### Bidding Engine ⚠️ (database-bound)

| Concern                     | State                                                            |
|-----------------------------|------------------------------------------------------------------|
| Auction state               | Postgres with row locks per `auctions.id`.                       |
| Live bid streaming          | Redis Pub/Sub.                                                   |

**Implication:** Multiple pods can process bids for different auctions in
parallel. Bids on the **same** auction serialize through a Postgres row lock.
Adding pods does not increase throughput on a single hot auction.

**Mitigation if a single auction hot-spots:** the auction is naturally
bounded — most auctions resolve in <30 minutes with <50 bids. If we add
flash-auctions with 1000s of concurrent bidders, we'd need to move state to
Redis with optimistic concurrency, which is a larger refactor.

### Fraud / Trust Engines

| Concern                     | State                                                            |
|-----------------------------|------------------------------------------------------------------|
| Inputs                      | Postgres reads.                                                  |
| Outputs                     | Postgres writes (`fraud_alerts`, `trust_scores`).                |
| Caches                      | None — every score is freshly computed.                          |

**Verdict:** Safe to scale.

### Imaging Engine

| Concern                     | State                                                            |
|-----------------------------|------------------------------------------------------------------|
| Inputs                      | S3 reads.                                                        |
| Outputs                     | S3 writes.                                                       |
| Caches                      | None.                                                            |

**Verdict:** Safe to scale. CPU-bound; HPA on CPU.

## Postgres Bottleneck

Every service goes through Postgres. As pods grow, connections grow. Mitigations:

1. **PgBouncer** (transaction pooling) is mandatory in production, sized at
   100 default pool, 500 max client.
2. **Read replicas** for analytics, search, profile reads. Wired as
   `DATABASE_URL_REPLICA` (and dbReadPool passed to read paths in gateway + key handlers).
   Primary used for writes/ownership. Gap closed (see gap-closure-plan.md P0-1).
3. **Connection cap per pod** — pgxpool max=20 in code; with 10 pods per
   service × ~7 services = 1400 connections max, which exceeds PgBouncer's
   500 client limit on a single instance. Run **2x PgBouncer instances**
   in production behind a Service.

## Redis Bottleneck

Redis is single-shard in current docker-compose. Production expects
**Redis Cluster mode** (per CLAUDE.md). Until cluster is provisioned:

- Single Redis instance handles rate limits, OTPs, idempotency cache,
  Pub/Sub.
- At ~10k concurrent users, Redis is comfortably under load (sub-ms
  p99 ops).
- Redis Pub/Sub fans out to every chat pod; keep an eye on
  `redis-cli INFO clients` and `pubsub_channels`.

**Provision Redis Cluster** before launch (see `docs/launch-checklist.md`).

## Meilisearch

- Stateless query path; index is on local disk.
- Meilisearch 1.x supports replicas via "remote tasks". For now, single node
  with persistent volume + daily snapshot to S3.
- Search rebuilds from Postgres if Meilisearch loses data.

## Outright Blockers (none today)

None of the services hold state that would prevent horizontal scaling. The
nearest thing is the chat WebSocket hub, which is per-pod by design and
explicitly works around the constraint via Redis Pub/Sub.

## Things to Watch as We Scale

1. **Refresh-token rotation churn** — each user holds 1 valid session row.
   With 10M users × frequent rotations, the `sessions` table grows fast.
   Add periodic vacuum + index-only scans.
2. **Audit log volume** — every auth, payment, admin action writes a row.
   At 10M users, this hits ~100M rows/year. Plan for partitioning by month.
3. **Notifications table volume** — same problem. Move to a fan-out queue
   (e.g. Outbox + Kafka) at scale rather than direct DB writes.
4. **Stripe webhook backpressure** — Stripe retries on 5xx. We process
   sequentially per event. Move to a queue with N consumers if event rate
   exceeds 100/s.
5. **OpenTelemetry export** — at 10M req/day, even 0.1 sample rate is
   1M spans/day. Configure tail sampling at the OTel collector.

## Owner

- Service-level scaling: each service team.
- Postgres / Redis / Meilisearch sizing: Platform team.
- Load testing: see `tests/load/` (k6 scripts) — owned by Platform.
