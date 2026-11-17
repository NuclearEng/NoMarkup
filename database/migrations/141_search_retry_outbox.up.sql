-- 141: Durable Meilisearch reindex retry outbox (replaces the Redis ZSET
-- `search:retry`, ARC-16).
--
-- Why: production Redis runs `maxmemory-policy volatile-lru`. The ZSET had no
-- TTL so it was never EVICTED, but when Redis is at maxmemory every write that
-- grows memory fails with OOM — including the ZADD that escalated a failed
-- search index/remove. That task was then dead-lettered at enqueue time and the
-- entity drifted from search until a manual rebuild. The escalation runs right
-- after a job/listing write committed to Postgres, so Postgres is the store
-- that is demonstrably up at that moment.
--
-- Shape (services/job/internal/service/search_retry_outbox.go owns the SQL):
--   * One PENDING row per (index_name, entity_id, op): the worker re-reads the
--     entity from Postgres, so one pending task per entity/op is enough. A new
--     failure upserts onto the pending row, resets attempts and clears any
--     claim, which makes an in-flight worker's completion a no-op.
--   * Claim = one statement: SELECT … FOR UPDATE SKIP LOCKED + UPDATE that stamps
--     claim_token and pushes next_attempt_at out by a lease, so two workers
--     never receive the same row and a crashed worker's rows come due again.
--     Meilisearch calls happen outside any transaction.
--   * Every completion/reschedule/dead-letter is guarded by claim_token.
--   * Dead-lettered rows (attempts exhausted) keep dead_lettered_at for
--     operator visibility and are pruned by the worker after 30 days.
--   * entity_id has NO foreign key: a job/listing that is gone is the worker's
--     "skip" path, not an error.
--   * last_error holds a sanitized error class (never a request body — the
--     Meilisearch client embeds the document in its error string).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS search_retry_outbox (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    index_name        TEXT NOT NULL CHECK (index_name IN ('jobs', 'listings')),
    op                TEXT NOT NULL CHECK (op IN ('index', 'remove')),
    entity_id         UUID NOT NULL,
    operation         TEXT NOT NULL DEFAULT '',
    attempts          INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    claim_token       UUID,
    claimed_at        TIMESTAMPTZ,
    last_error        TEXT,
    dead_lettered_at  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedupe: at most one pending task per entity/op.
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_retry_outbox_pending
    ON search_retry_outbox (index_name, entity_id, op)
    WHERE dead_lettered_at IS NULL;

-- Worker claim predicate + ORDER BY.
CREATE INDEX IF NOT EXISTS idx_search_retry_outbox_next_attempt_at
    ON search_retry_outbox (next_attempt_at)
    WHERE dead_lettered_at IS NULL;

-- Dead-letter retention prune.
CREATE INDEX IF NOT EXISTS idx_search_retry_outbox_dead_lettered_at
    ON search_retry_outbox (dead_lettered_at)
    WHERE dead_lettered_at IS NOT NULL;

CREATE TRIGGER set_updated_at_search_retry_outbox
    BEFORE UPDATE ON search_retry_outbox
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMENT ON TABLE search_retry_outbox IS
    'ARC-16 durable Meilisearch index/remove retry outbox (replaces Redis ZSET search:retry, which failed to enqueue under Redis OOM). Claimed with FOR UPDATE SKIP LOCKED + claim_token lease by services/job SearchRetryQueue; dead-lettered rows kept 30 days. Holds entity ids only — no PII.';
