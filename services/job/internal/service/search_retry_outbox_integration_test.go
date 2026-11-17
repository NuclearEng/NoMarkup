//go:build integration

// Integration tests for the search_retry_outbox store (migration 141) and the
// SearchRetryQueue worker on top of it.
//
// Run against a SCRATCH database (each test empties search_retry_outbox):
//
//	DATABASE_URL=postgres://.../nomarkup_itest?sslmode=disable \
//	REDIS_TEST_URL=redis://127.0.0.1:6379/3 \
//	  go test -tags=integration -count=1 -run SearchRetryOutbox ./internal/service/
//
// The tests are deliberately NOT t.Parallel: the worker claims any due row, so
// two tests sharing the table concurrently would steal each other's rows.
// Top-level parallel tests in this package are held until these finish.
package service

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func searchRetryOutboxPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL unset — skipping search_retry_outbox integration test")
	}
	pool, err := pgxpool.New(context.Background(), url)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	var reg *string
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT to_regclass('public.search_retry_outbox')::text`).Scan(&reg))
	require.NotNil(t, reg, "search_retry_outbox missing — apply migration 141")
	_, err = pool.Exec(context.Background(), `DELETE FROM search_retry_outbox`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM search_retry_outbox`)
	})
	return pool
}

func outboxTask(op string) SearchRetryTask {
	return SearchRetryTask{
		Index: searchRetryIndexJobs, Op: op, EntityID: uuid.NewString(), Operation: "itest",
	}
}

type outboxRow struct {
	attempts     int
	dueInSeconds float64
	token        *string
	lastErr      *string
	dead         bool
}

func readOutboxRow(t *testing.T, pool *pgxpool.Pool, id string) outboxRow {
	t.Helper()
	var r outboxRow
	require.NoError(t, pool.QueryRow(context.Background(), `
		SELECT attempts, EXTRACT(EPOCH FROM next_attempt_at - now())::float8,
		       claim_token::text, last_error, dead_lettered_at IS NOT NULL
		  FROM search_retry_outbox WHERE id = $1::uuid`, id).
		Scan(&r.attempts, &r.dueInSeconds, &r.token, &r.lastErr, &r.dead))
	return r
}

func countOutbox(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT count(*) FROM search_retry_outbox`).Scan(&n))
	return n
}

func TestSearchRetryOutbox_migrationShape(t *testing.T) {
	pool := searchRetryOutboxPool(t)
	rows, err := pool.Query(context.Background(),
		`SELECT indexname FROM pg_indexes WHERE tablename = 'search_retry_outbox'`)
	require.NoError(t, err)
	defer rows.Close()
	have := map[string]bool{}
	for rows.Next() {
		var name string
		require.NoError(t, rows.Scan(&name))
		have[name] = true
	}
	require.NoError(t, rows.Err())
	for _, want := range []string{
		"search_retry_outbox_pkey",
		"uq_search_retry_outbox_pending",
		"idx_search_retry_outbox_next_attempt_at",
		"idx_search_retry_outbox_dead_lettered_at",
	} {
		assert.True(t, have[want], "missing index %s", want)
	}

	// CHECK constraints reject an unknown index / op.
	_, err = pool.Exec(context.Background(), `
		INSERT INTO search_retry_outbox (index_name, op, entity_id) VALUES ('bogus', 'index', gen_random_uuid())`)
	assert.Error(t, err)
	_, err = pool.Exec(context.Background(), `
		INSERT INTO search_retry_outbox (index_name, op, entity_id) VALUES ('jobs', 'upsert', gen_random_uuid())`)
	assert.Error(t, err)
}

func TestSearchRetryOutbox_roundTrip(t *testing.T) {
	pool := searchRetryOutboxPool(t)
	store := pgSearchRetryStore{pool: pool}
	ctx := context.Background()

	task := outboxTask(searchRetryOpIndex)
	require.NoError(t, store.Enqueue(ctx, task))

	got, err := store.Claim(ctx, 10)
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, task.EntityID, got[0].Task.EntityID)
	assert.Equal(t, task.Index, got[0].Task.Index)
	assert.Equal(t, task.Op, got[0].Task.Op)
	assert.Equal(t, "itest", got[0].Task.Operation)
	assert.Equal(t, 0, got[0].Task.Attempts)

	// Leased: not due again until the lease runs out.
	r := readOutboxRow(t, pool, got[0].ID)
	assert.InDelta(t, searchRetryLease.Seconds(), r.dueInSeconds, 5)
	again, err := store.Claim(ctx, 10)
	require.NoError(t, err)
	assert.Empty(t, again)

	ok, err := store.Complete(ctx, got[0].ID, got[0].Token)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, 0, countOutbox(t, pool))

	// Non-UUID entity ids are refused before reaching SQL.
	assert.Error(t, store.Enqueue(ctx, SearchRetryTask{Index: "jobs", Op: "index", EntityID: "j1"}))
}

func TestSearchRetryOutbox_dedupeResetsAndVoidsClaim(t *testing.T) {
	pool := searchRetryOutboxPool(t)
	store := pgSearchRetryStore{pool: pool}
	ctx := context.Background()

	task := outboxTask(searchRetryOpRemove)
	require.NoError(t, store.Enqueue(ctx, task))
	c, err := store.Claim(ctx, 1)
	require.NoError(t, err)
	require.Len(t, c, 1)
	ok, err := store.Reschedule(ctx, c[0].ID, c[0].Token, 3, time.Hour, "meili down")
	require.NoError(t, err)
	require.True(t, ok)

	// Same entity/op again: still one row, budget reset, due now.
	require.NoError(t, store.Enqueue(ctx, task))
	assert.Equal(t, 1, countOutbox(t, pool))
	r := readOutboxRow(t, pool, c[0].ID)
	assert.Equal(t, 0, r.attempts)
	assert.LessOrEqual(t, r.dueInSeconds, 1.0)
	assert.Nil(t, r.lastErr)

	// A different op on the same entity is a separate task.
	other := task
	other.Op = searchRetryOpIndex
	require.NoError(t, store.Enqueue(ctx, other))
	assert.Equal(t, 2, countOutbox(t, pool))
}

func TestSearchRetryOutbox_staleClaimIsNoOp(t *testing.T) {
	pool := searchRetryOutboxPool(t)
	store := pgSearchRetryStore{pool: pool}
	ctx := context.Background()

	task := outboxTask(searchRetryOpIndex)
	require.NoError(t, store.Enqueue(ctx, task))
	c, err := store.Claim(ctx, 1)
	require.NoError(t, err)
	require.Len(t, c, 1)

	// A new failure for the same entity lands while the worker is busy.
	require.NoError(t, store.Enqueue(ctx, task))

	ok, err := store.Complete(ctx, c[0].ID, c[0].Token)
	require.NoError(t, err)
	assert.False(t, ok, "stale worker must not delete the re-enqueued task")
	ok, err = store.Reschedule(ctx, c[0].ID, c[0].Token, 1, time.Minute, "x")
	require.NoError(t, err)
	assert.False(t, ok)
	ok, err = store.DeadLetter(ctx, c[0].ID, c[0].Token, 5, "x")
	require.NoError(t, err)
	assert.False(t, ok)

	// It is due now and claimable afresh.
	c2, err := store.Claim(ctx, 1)
	require.NoError(t, err)
	require.Len(t, c2, 1)
	assert.Equal(t, c[0].ID, c2[0].ID)
	assert.NotEqual(t, c[0].Token, c2[0].Token)
}

func TestSearchRetryOutbox_leaseExpiryReclaims(t *testing.T) {
	pool := searchRetryOutboxPool(t)
	store := pgSearchRetryStore{pool: pool}
	ctx := context.Background()

	require.NoError(t, store.Enqueue(ctx, outboxTask(searchRetryOpIndex)))
	c, err := store.Claim(ctx, 1)
	require.NoError(t, err)
	require.Len(t, c, 1)

	// Simulate the claiming worker crashing and the lease running out.
	_, err = pool.Exec(ctx, `UPDATE search_retry_outbox SET next_attempt_at = now() - interval '1 second' WHERE id = $1::uuid`, c[0].ID)
	require.NoError(t, err)

	c2, err := store.Claim(ctx, 1)
	require.NoError(t, err)
	require.Len(t, c2, 1)
	assert.Equal(t, c[0].ID, c2[0].ID)

	ok, err := store.Complete(ctx, c[0].ID, c[0].Token)
	require.NoError(t, err)
	assert.False(t, ok, "the crashed worker's token is void after re-claim")
	ok, err = store.Complete(ctx, c2[0].ID, c2[0].Token)
	require.NoError(t, err)
	assert.True(t, ok)
}

func TestSearchRetryOutbox_workerBackoffAndDeadLetter(t *testing.T) {
	pool := searchRetryOutboxPool(t)
	store := pgSearchRetryStore{pool: pool}
	ctx := context.Background()
	q := newSearchRetryQueueWithStore(store)
	q.execute = func(context.Context, SearchRetryTask) error { return errors.New("meilisearch unavailable") }

	require.NoError(t, q.Enqueue(ctx, outboxTask(searchRetryOpIndex)))
	var id string
	require.NoError(t, pool.QueryRow(ctx, `SELECT id::text FROM search_retry_outbox`).Scan(&id))

	for attempt := 1; attempt < maxSearchRetryDurableAttempts; attempt++ {
		n, err := q.ProcessDue(ctx, 10)
		require.NoError(t, err)
		require.Equal(t, 1, n, "attempt %d", attempt)
		r := readOutboxRow(t, pool, id)
		assert.Equal(t, attempt, r.attempts)
		assert.InDelta(t, SearchRetryBackoff(attempt).Seconds(), r.dueInSeconds, 5)
		assert.Nil(t, r.token)
		require.NotNil(t, r.lastErr)
		assert.Equal(t, "meilisearch unavailable", *r.lastErr)
		assert.False(t, r.dead)
		// Fast-forward to due.
		_, err = pool.Exec(ctx, `UPDATE search_retry_outbox SET next_attempt_at = now() WHERE id = $1::uuid`, id)
		require.NoError(t, err)
	}

	n, err := q.ProcessDue(ctx, 10)
	require.NoError(t, err)
	require.Equal(t, 1, n)
	r := readOutboxRow(t, pool, id)
	assert.True(t, r.dead)
	assert.Equal(t, maxSearchRetryDurableAttempts, r.attempts)

	// Dead letters are never claimed, and free the pending slot.
	n, err = q.ProcessDue(ctx, 10)
	require.NoError(t, err)
	assert.Equal(t, 0, n)
	var entity string
	require.NoError(t, pool.QueryRow(ctx, `SELECT entity_id::text FROM search_retry_outbox WHERE id = $1::uuid`, id).Scan(&entity))
	require.NoError(t, q.Enqueue(ctx, SearchRetryTask{Index: searchRetryIndexJobs, Op: searchRetryOpIndex, EntityID: entity}))
	assert.Equal(t, 2, countOutbox(t, pool))

	// Success path deletes the fresh row.
	q.execute = func(context.Context, SearchRetryTask) error { return nil }
	n, err = q.ProcessDue(ctx, 10)
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	assert.Equal(t, 1, countOutbox(t, pool), "only the dead letter remains")
}

func TestSearchRetryOutbox_pruneDeadLetters(t *testing.T) {
	pool := searchRetryOutboxPool(t)
	store := pgSearchRetryStore{pool: pool}
	ctx := context.Background()

	_, err := pool.Exec(ctx, `
		INSERT INTO search_retry_outbox (index_name, op, entity_id, attempts, dead_lettered_at)
		VALUES ('jobs', 'index', gen_random_uuid(), 5, now() - interval '31 days'),
		       ('jobs', 'index', gen_random_uuid(), 5, now() - interval '1 day'),
		       ('listings', 'remove', gen_random_uuid(), 0, NULL)`)
	require.NoError(t, err)

	n, err := store.PruneDeadLetters(ctx, searchRetryDeadLetterRetention, searchRetryPruneBatch)
	require.NoError(t, err)
	assert.Equal(t, int64(1), n)
	assert.Equal(t, 2, countOutbox(t, pool))

	pending, err := store.PendingCount(ctx)
	require.NoError(t, err)
	assert.Equal(t, int64(1), pending)
}

// TestSearchRetryOutbox_claimConcurrency: several workers claiming at once
// never receive the same row, and together they drain every row exactly once.
func TestSearchRetryOutbox_claimConcurrency(t *testing.T) {
	pool := searchRetryOutboxPool(t)
	store := pgSearchRetryStore{pool: pool}
	ctx := context.Background()

	const total = 200
	_, err := pool.Exec(ctx, `
		INSERT INTO search_retry_outbox (index_name, op, entity_id)
		SELECT 'jobs', 'index', gen_random_uuid() FROM generate_series(1, $1)`, total)
	require.NoError(t, err)

	const workers = 8
	var (
		mu   sync.Mutex
		seen = map[string]int{}
		wg   sync.WaitGroup
		errs = make(chan error, workers)
	)
	start := make(chan struct{})
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for {
				batch, cerr := store.Claim(ctx, 7)
				if cerr != nil {
					errs <- cerr
					return
				}
				if len(batch) == 0 {
					return
				}
				mu.Lock()
				for _, c := range batch {
					seen[c.ID]++
				}
				mu.Unlock()
			}
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for e := range errs {
		require.NoError(t, e)
	}

	assert.Len(t, seen, total, "every row claimed")
	for id, n := range seen {
		assert.Equal(t, 1, n, "row %s claimed %d times", id, n)
	}
}

func TestSearchRetryOutbox_legacyRedisDrain(t *testing.T) {
	pool := searchRetryOutboxPool(t)
	redisURL := os.Getenv("REDIS_TEST_URL")
	if redisURL == "" {
		t.Skip("REDIS_TEST_URL unset — skipping legacy search:retry drain test")
	}
	opt, err := redis.ParseURL(redisURL)
	require.NoError(t, err)
	rdb := redis.NewClient(opt)
	t.Cleanup(func() { _ = rdb.Close() })
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("redis unreachable: %v", err)
	}
	require.NoError(t, rdb.Del(ctx, legacySearchRetryRedisKey).Err())
	t.Cleanup(func() { _ = rdb.Del(context.Background(), legacySearchRetryRedisKey).Err() })

	store := pgSearchRetryStore{pool: pool}
	q := newSearchRetryQueueWithStore(store)

	future := time.Now().Add(10 * time.Minute).Truncate(time.Second)
	a := SearchRetryTask{Index: searchRetryIndexJobs, Op: searchRetryOpIndex, EntityID: uuid.NewString(), Operation: "publish", Attempts: 2}
	b := SearchRetryTask{Index: searchRetryIndexListings, Op: searchRetryOpRemove, EntityID: uuid.NewString(), Attempts: 0}
	dup := outboxTask(searchRetryOpIndex)
	require.NoError(t, store.Enqueue(ctx, dup)) // already pending in Postgres
	dup.Attempts = 4

	ma, _ := marshalSearchRetryMember(a)
	mb, _ := marshalSearchRetryMember(b)
	mdup, _ := marshalSearchRetryMember(dup)
	require.NoError(t, rdb.ZAdd(ctx, legacySearchRetryRedisKey,
		redis.Z{Score: float64(future.Unix()), Member: ma},
		redis.Z{Score: float64(time.Now().Unix()), Member: mb},
		redis.Z{Score: float64(time.Now().Unix()), Member: mdup},
		redis.Z{Score: 1, Member: "not-json"},
	).Err())

	st, err := q.DrainLegacySearchRetryRedis(ctx, rdb)
	require.NoError(t, err)
	assert.Equal(t, searchRetryDrainStats{Seen: 4, Imported: 2, Duplicate: 1, Corrupt: 1}, st)

	exists, err := rdb.Exists(ctx, legacySearchRetryRedisKey).Result()
	require.NoError(t, err)
	assert.Equal(t, int64(0), exists, "drained key must be empty")
	assert.Equal(t, 3, countOutbox(t, pool))

	var attempts int
	var due time.Time
	var operation string
	require.NoError(t, pool.QueryRow(ctx, `
		SELECT attempts, next_attempt_at, operation FROM search_retry_outbox WHERE entity_id = $1::uuid`, a.EntityID).
		Scan(&attempts, &due, &operation))
	assert.Equal(t, 2, attempts, "drain preserves spent attempts")
	assert.True(t, due.Equal(future), "drain preserves the due time: got %v want %v", due, future)
	assert.Equal(t, "publish", operation)

	require.NoError(t, pool.QueryRow(ctx, `
		SELECT attempts FROM search_retry_outbox WHERE entity_id = $1::uuid`, dup.EntityID).Scan(&attempts))
	assert.Equal(t, 0, attempts, "an existing pending row wins over the legacy member")

	// Second run is a no-op.
	st, err = q.DrainLegacySearchRetryRedis(ctx, rdb)
	require.NoError(t, err)
	assert.Equal(t, searchRetryDrainStats{}, st)
}
