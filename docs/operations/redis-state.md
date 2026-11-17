# What Redis holds (and what it must never hold)

> Status as of migrations 138–141 (branch `fix/durable-evidence-state`).

Production Redis runs `maxmemory-policy volatile-lru`
(`deploy/prod/docker-compose.yml`): under memory pressure **any key with a
TTL can be evicted**, and once nothing evictable is left, writes fail with
OOM. So the rule is:

**Redis holds only state that is either reconstructible (a cache, a
presence set, pub/sub) or short-lived (a window, a challenge, an
idempotency record), and whose loss only degrades a request. Records —
evidence, credentials a user configured elsewhere, work queues — live in
Postgres.**

## Inventory

Every key below carries a TTL, so every key is evictable. "On eviction" is
what a user or operator would see.

| State | Key / channel | TTL | Owner | On eviction |
|---|---|---|---|---|
| Feature-flag cache | `nomarkup:feature_flag_v2:*` | 30 s | `gateway/internal/middleware/feature_flag.go` | Re-read from `feature_flags` |
| Trust-score cache | `nomarkup:trust:score:*` | 5 min | `gateway/internal/handler/trust.go` | Re-fetched from the trust engine |
| Category-tree cache | `nomarkup:categories:tree*` | 1 h | `gateway/internal/handler/categories.go` | Re-read from Postgres |
| Rate-limit windows | `nomarkup:rl:*` (ZSET) | window + 1 s | `gateway/internal/cache/redis.go`, `middleware/ratelimit.go` | Window restarts early (limit briefly looser) |
| Idempotency records | `nomarkup:idempotency:*` | 24 h (pending 30 s) | `gateway/internal/middleware/idempotency.go` | A retried request may execute again; Stripe idempotency keys still guard money |
| Idle-session timestamps | `nomarkup:sess:idle:*` | role idle timeout | `gateway/internal/middleware/idle_session.go` | User is treated as idle and re-authenticates |
| Phone OTPs / verified claims / daily counters | user-service phone keys (`services/user`) | 5 min / 10 min / end of UTC day | `services/user/internal/service/phone.go` | User requests a new code |
| Passkey ceremony challenges | `nomarkup:passkey_session:*` | 5 min | `gateway/internal/handler/passkey.go` | Ceremony restarts |
| Instant-match offers and claims | `instant_match:{job}`, `instant_match:{job}:resp:{provider}` | 20 min | `gateway/internal/handler/instant_match.go` | Offer lapses; the engine's locked Postgres transaction remains the authority |
| Viewer / spectator presence | `nomarkup:spectators:*`, `nomarkup:listing_viewers:*`, … | 2 h / minutes | `gateway/internal/handler/spectator_ws.go`, `listings.go`, `job.go` | Counts under-report until the next heartbeat |
| Live fan-out | pub/sub channels (bids, listings, chat, follows) | none (not stored) | bidding engine, job/chat/notification services | Nothing stored; a message published while a subscriber is down is missed, as before |

## Moved to Postgres (do not move back)

| State | Was | Now | Why |
|---|---|---|---|
| Provider check-in / check-out | `contract:checkin:{c}:{u}`, `contract:checkout:{c}:{u}` (24 h), written alongside Postgres | `contract_work_sessions` only (migration 123; coordinates encrypted, 138). Redis copy no longer written. | Dispute evidence and the escrow-release gate. Evictable and 24 h-lived. |
| Completion-photo metadata | `contract:photo:{c}:{u}:{phase}` (24 h, never read) | `contract_completion_photos` only (123) | Same; the Redis copy was write-only. |
| Calendar feed tokens | `nomarkup:calfeed:{sha256}` (90 d) | `calendar_feed_tokens` (140): hash only, `expires_at` checked on read, expired rows pruned on mint, deleted on GDPR erasure | An evicted key silently broke a user's subscribed calendar. |
| Search reindex retry queue | ZSET `search:retry` (no TTL) | `search_retry_outbox` (141) | Never evicted, but enqueue failed under OOM, dropping index updates. |

### Search reindex retry outbox (ARC-16)

When a Meilisearch index or remove still fails after the job service's 3
in-process attempts, the task goes to `search_retry_outbox` (migration
141). There is one pending row per (index, entity, op); a new failure resets
that row's attempts and makes it due again. Every job-service replica runs
the worker every 30 s (`SEARCH_RETRY_INTERVAL`, batch `SEARCH_RETRY_BATCH`).
It claims due rows with `FOR UPDATE SKIP LOCKED` and a claim token leased
for 5 minutes, so two workers never take the same row and a crashed
worker's rows come back after 5 minutes. It re-reads the job or listing
from Postgres and applies the index or remove. Success deletes the row. A
failure backs off 30 s, 60 s, 120 s, 240 s, and after 5 attempts the row is
dead-lettered (`dead_lettered_at` set, plus an ERROR `SEARCH RETRY
DEAD-LETTER` log). Dead letters stay 30 days for inspection, then the worker
deletes them. The table holds entity ids and a sanitised error class only,
no personal data.

The enqueue is **not** in the job/listing write transaction: escalation runs
in a goroutine after the write has committed and after the in-process
retries, so there is no open transaction to join. The write that just
committed shows Postgres is up, which is the property the Redis enqueue
lacked.

Metrics: `search_retry_enqueued_total`,
`search_retry_enqueue_failed_total{reason=no_queue|db_error}`,
`search_retry_processed_total{result}`, `search_retry_dead_letter_total`,
`search_retry_queue_depth` (rows not dead-lettered). To inspect:

```sql
SELECT index_name, op, entity_id, attempts, last_error, dead_lettered_at
  FROM search_retry_outbox ORDER BY created_at DESC;
```

## Legacy fallbacks and when to delete them

Each move keeps a read-only path to the old Redis keys so records written
before the deploy are not lost. Each has a removal note in its file.

| Fallback | Behaviour | Remove after | Where |
|---|---|---|---|
| Work sessions | On a Postgres miss (or error), `GET /work-session` and check-out read the old keys; a check-out against a Redis-only check-in writes a durable closed session. New check-ins delete the old keys. | **24 h after the release** (every old key has expired) | `gateway/internal/handler/workspace_legacy_redis.go`, plus its calls in `workspace.go` |
| Calendar feeds | On a Postgres miss, the old key is read once; a hit is copied into `calendar_feed_tokens` with the TTL it had left and the Redis key is deleted. A finalized-erased user's token is refused and deleted. | **90 days after the release**, once `SCAN 0 MATCH nomarkup:calfeed:*` returns nothing | `legacyRedisCalendarFeedStore` / `calendarFeedStoreWithLegacy` in `gateway/internal/handler/calendar_feed_store.go`, and `WithCache` in `router.go` |
| Search retry queue | Each job-service start moves any `search:retry` members into the outbox (attempts and due time kept, attempts capped so each gets one more try), deleting each member after its insert. Running it again is harmless. | **One release after**, once `EXISTS search:retry` returns 0 | `services/job/internal/service/search_retry_redis_drain.go` and the drain block in `services/job/cmd/server/main.go` |

In production every check-in since migration 123 was written to Postgres
before Redis (a failed Postgres write returns 503 before Redis is touched),
so the work-session fallback can only surface a key whose Postgres row also
exists. It is kept for the rollout rule and for a development gateway
started without `DATABASE_URL`.

## Deploy order

1. Apply migrations **138–141 before** rolling out the new gateway and job
   service. The old binaries ignore the new columns and tables. New binaries
   against the old schema would fail check-in, check-out and feed minting
   with 503s, and the job service's retry enqueue would fail.
2. Roll out gateway, job and user services.
3. Run `make encrypt-pii` (direct Postgres connection, not PgBouncer) to
   encrypt the work-session coordinates written before 138. Then
   `SELECT * FROM pii_plaintext_audit` must be empty. Run it **after** the
   rollout: until every gateway pod is new, an old pod can still write
   plaintext coordinates. The drain is idempotent, so run it again if a row
   shows up.
4. Remove the fallbacks on the dates in the table above.
