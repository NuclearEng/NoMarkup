// Package service — durable Meilisearch reindex retry (ARC-16).
//
// Problem: indexJobWithRetry / indexListingWithRetry used fire-and-forget
// goroutines with 3 in-process attempts. On exhaustion the failure was only
// logged — a process restart or prolonged Meilisearch outage silently dropped
// the update until a full rebuild.
//
// Fix:
//
//  1. In-process 3-attempt exponential backoff stays first-line (fast path).
//  2. On exhaustion, enqueue a compact task into the Postgres outbox
//     search_retry_outbox (migration 141). Survives restarts; one pending row
//     per (index, entity, op).
//  3. Background cron (default 30s) claims due rows with FOR UPDATE SKIP
//     LOCKED + a claim-token lease (two workers never get the same row),
//     re-fetches the entity from Postgres (source of truth), and re-applies
//     index or remove outside any transaction.
//  4. After max durable attempts: ERROR dead-letter log + Prometheus counter
//     (pageable); the row is kept with dead_lettered_at for 30 days. Search is
//     not money — we fail-soft, never block writers.
//
// Why Postgres and not Redis (until 2026-11 this was the Redis ZSET
// `search:retry`): production Redis runs volatile-lru. The ZSET had no TTL so
// it was never evicted, but at maxmemory every ZADD fails with OOM, so the
// escalation itself was dropped exactly when the platform was under pressure.
//
// Why the enqueue is NOT in the job/listing write transaction: escalation is
// the tail of a goroutine that runs after the write already committed and
// after three in-process Meilisearch attempts (up to ~3s later). There is no
// open transaction to join, and making every repository write emit an outbox
// row would turn this retry path into the primary indexing path — a much
// larger redesign. The durability gap that mattered is closed anyway: the
// write that triggered indexing just succeeded against the same Postgres, so
// the enqueue no longer depends on a second store with a memory ceiling. The
// remaining window is a process crash during the in-process retries (≤ ~3s),
// unchanged from before.
//
// The queue is wired whenever the job service has a database pool. A nil queue
// (unit tests, misconfigured composition root) still records exhaustion as a
// dead-letter with reason=no_queue so the gap is visible rather than silent.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// Search index UIDs used as task labels (must match Meilisearch index names).
const (
	searchRetryIndexJobs     = "jobs"
	searchRetryIndexListings = "listings"
)

// Ops performed against the search index.
const (
	searchRetryOpIndex  = "index"
	searchRetryOpRemove = "remove"
)

// maxSearchRetryDurableAttempts is how many times the background worker will
// re-attempt after the in-process 3-shot path already failed. Total worst-case
// Meilisearch hits ≈ 3 + 5 before dead-letter.
const maxSearchRetryDurableAttempts = 5

// searchRetryPollInterval is the default worker tick (docs/TODOS.md: 30s).
const searchRetryPollInterval = 30 * time.Second

// SearchRetryTask is one durable unit of search work. Entity body is NOT
// stored — the worker re-reads Postgres so a delayed retry indexes current
// state (e.g. a job that was cancelled while queued becomes a remove).
type SearchRetryTask struct {
	Index     string `json:"index"` // jobs | listings
	Op        string `json:"op"`    // index | remove
	EntityID  string `json:"id"`
	Operation string `json:"operation,omitempty"` // caller context: create, publish, cancel…
	Attempts  int    `json:"attempts"`            // durable attempts already spent
}

// SearchRetryQueue is a Postgres-backed durable queue + worker for Meilisearch
// index/remove retries. All fields optional-safe: nil queue means no durable
// path (callers still log + metric).
type SearchRetryQueue struct {
	store searchRetryStore

	// execute applies one task; defaults to executeTask. Tests override it.
	execute func(ctx context.Context, task SearchRetryTask) error

	// Re-fetch + apply hooks. Set at wire-up; nil-safe per call site.
	jobRepo        domain.JobRepository
	jobSearch      *SearchEngine
	listingRepo    domain.ListingRepository
	listingSearch  *ListingSearchEngine
	listingHydrate ListingHydrator
}

// NewSearchRetryQueue builds a queue on the search_retry_outbox table.
// Returns nil when pool is nil so callers keep the no_queue dead-letter path.
func NewSearchRetryQueue(pool *pgxpool.Pool) *SearchRetryQueue {
	if pool == nil {
		return nil
	}
	return newSearchRetryQueueWithStore(pgSearchRetryStore{pool: pool})
}

func newSearchRetryQueueWithStore(store searchRetryStore) *SearchRetryQueue {
	q := &SearchRetryQueue{store: store}
	q.execute = q.executeTask
	return q
}

// WithJobHandlers wires Postgres re-fetch + Meilisearch for jobs.
func (q *SearchRetryQueue) WithJobHandlers(repo domain.JobRepository, search *SearchEngine) *SearchRetryQueue {
	if q == nil {
		return nil
	}
	q.jobRepo = repo
	q.jobSearch = search
	return q
}

// WithListingHandlers wires Postgres re-fetch + Meilisearch for listings.
func (q *SearchRetryQueue) WithListingHandlers(repo domain.ListingRepository, search *ListingSearchEngine, hydrate ListingHydrator) *SearchRetryQueue {
	if q == nil {
		return nil
	}
	q.listingRepo = repo
	q.listingSearch = search
	q.listingHydrate = hydrate
	return q
}

// Enqueue schedules a durable retry, due immediately so the next worker tick
// picks it up. A pending task for the same entity/op is reset (fresh budget).
// Fail-soft: returns error for the caller to metric/log; never panics.
func (q *SearchRetryQueue) Enqueue(ctx context.Context, task SearchRetryTask) error {
	if q == nil || q.store == nil {
		return fmt.Errorf("search retry queue: store unwired")
	}
	if err := validateSearchRetryTask(task); err != nil {
		return err
	}
	// A fresh escalation always starts a fresh durable budget.
	task.Attempts = 0
	if err := q.store.Enqueue(ctx, task); err != nil {
		return err
	}
	searchRetryEnqueuedTotal.WithLabelValues(task.Index, task.Op).Inc()
	return nil
}

// escalateToDurableQueue is the shared hook from in-process retry exhaustion.
// When q is nil or enqueue fails, records a dead-letter metric + ERROR log so
// the drop is never silent (ARC-16 acceptance: no silent drop).
func escalateToDurableQueue(q *SearchRetryQueue, task SearchRetryTask) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if q == nil || q.store == nil {
		searchRetryEnqueueFailedTotal.WithLabelValues(task.Index, task.Op, searchRetryReasonNoQueue).Inc()
		searchRetryDeadLetterTotal.WithLabelValues(task.Index, task.Op).Inc()
		slog.Error("SEARCH RETRY DEAD-LETTER — durable queue unavailable (no database pool wired); entity may drift from search until rebuild",
			"index", task.Index,
			"op", task.Op,
			"entity_id", task.EntityID,
			"operation", task.Operation,
			"reason", searchRetryReasonNoQueue,
		)
		return
	}

	if err := q.Enqueue(ctx, task); err != nil {
		reason := searchRetryReasonDBErr
		searchRetryEnqueueFailedTotal.WithLabelValues(task.Index, task.Op, reason).Inc()
		searchRetryDeadLetterTotal.WithLabelValues(task.Index, task.Op).Inc()
		slog.Error("SEARCH RETRY DEAD-LETTER — durable enqueue failed; entity may drift from search until rebuild",
			"index", task.Index,
			"op", task.Op,
			"entity_id", task.EntityID,
			"operation", task.Operation,
			"reason", reason,
			"error", err,
		)
		return
	}

	slog.Warn("search index/remove escalated to durable retry queue",
		"index", task.Index,
		"op", task.Op,
		"entity_id", task.EntityID,
		"operation", task.Operation,
	)
}

// ProcessDue claims and processes up to limit due tasks. Returns the number of
// tasks claimed (including skips / reschedules / dead-letters). Fail-soft on
// store errors so a tick never takes down the job service.
func (q *SearchRetryQueue) ProcessDue(ctx context.Context, limit int64) (int, error) {
	if q == nil || q.store == nil {
		return 0, fmt.Errorf("search retry queue: store unwired")
	}
	if limit <= 0 {
		limit = 50
	}

	claimed, err := q.store.Claim(ctx, int(limit))
	if err != nil {
		return 0, err
	}

	for _, c := range claimed {
		if verr := validateSearchRetryTask(c.Task); verr != nil {
			// CHECK constraints make this unreachable; drop rather than loop.
			slog.Error("search retry: invalid outbox row dropped", "id", c.ID, "error", verr)
			if _, derr := q.store.Complete(ctx, c.ID, c.Token); derr != nil {
				slog.Error("search retry: drop invalid row failed", "id", c.ID, "error", derr)
			}
			continue
		}
		q.applyTask(ctx, c)
	}

	// Depth gauge: total pending (due + future + leased), not just this batch.
	if n, cerr := q.store.PendingCount(ctx); cerr == nil {
		searchRetryQueueDepth.Set(float64(n))
	} else {
		slog.Warn("search retry: depth query failed", "error", cerr)
	}

	// Opportunistic, bounded retention prune of old dead letters (same
	// pattern as notification_send_ledger: no dedicated sweeper).
	if n, perr := q.store.PruneDeadLetters(ctx, searchRetryDeadLetterRetention, searchRetryPruneBatch); perr != nil {
		slog.Warn("search retry: dead-letter prune failed", "error", perr)
	} else if n > 0 {
		slog.Info("search retry: pruned expired dead letters", "rows", n)
	}

	return len(claimed), nil
}

// applyTask re-fetches entity state and applies index/remove, then completes,
// reschedules or dead-letters the claimed row. Every write is guarded by the
// claim token: if the row was re-enqueued while we worked, our outcome is
// discarded and the fresh task runs on a later tick.
func (q *SearchRetryQueue) applyTask(ctx context.Context, c claimedSearchRetryTask) {
	task := c.Task
	exec := q.execute
	if exec == nil {
		exec = q.executeTask
	}
	err := exec(ctx, task)
	if err == nil || errors.Is(err, errSearchRetrySkip) {
		result := searchRetryResultSuccess
		if err != nil {
			result = searchRetryResultSkip
		}
		if _, cerr := q.store.Complete(ctx, c.ID, c.Token); cerr != nil {
			// Lease expiry will re-run an idempotent upsert/delete; not a loss.
			slog.Warn("search retry: complete failed; row will be retried after lease",
				"id", c.ID, "index", task.Index, "entity_id", task.EntityID, "error", cerr)
		}
		searchRetryProcessedTotal.WithLabelValues(task.Index, task.Op, result).Inc()
		if result == searchRetryResultSkip {
			slog.Info("search durable retry skipped (entity no longer needs this op)",
				"index", task.Index,
				"op", task.Op,
				"entity_id", task.EntityID,
				"operation", task.Operation,
			)
			return
		}
		slog.Info("search durable retry succeeded",
			"index", task.Index,
			"op", task.Op,
			"entity_id", task.EntityID,
			"operation", task.Operation,
			"attempts", task.Attempts+1,
		)
		return
	}

	attempts := task.Attempts + 1
	lastErr := sanitizeSearchRetryError(err)
	if attempts >= maxSearchRetryDurableAttempts {
		if _, derr := q.store.DeadLetter(ctx, c.ID, c.Token, attempts, lastErr); derr != nil {
			slog.Error("search retry: dead-letter write failed; row will be retried after lease",
				"id", c.ID, "error", derr)
		}
		searchRetryProcessedTotal.WithLabelValues(task.Index, task.Op, searchRetryResultDeadLetter).Inc()
		searchRetryDeadLetterTotal.WithLabelValues(task.Index, task.Op).Inc()
		slog.Error("SEARCH RETRY DEAD-LETTER — durable attempts exhausted; run reindex or wait for next lifecycle write",
			"index", task.Index,
			"op", task.Op,
			"entity_id", task.EntityID,
			"operation", task.Operation,
			"attempts", attempts,
			"max_attempts", maxSearchRetryDurableAttempts,
			"error", err,
		)
		return
	}

	backoff := SearchRetryBackoff(attempts)
	if _, rerr := q.store.Reschedule(ctx, c.ID, c.Token, attempts, backoff, lastErr); rerr != nil {
		// The lease still expires, so the task is retried — just without the
		// attempt being counted. Not a drop.
		searchRetryEnqueueFailedTotal.WithLabelValues(task.Index, task.Op, searchRetryReasonDBErr).Inc()
		slog.Error("search retry: reschedule write failed; row will be retried after lease",
			"index", task.Index, "op", task.Op, "entity_id", task.EntityID, "error", rerr)
		return
	}
	searchRetryProcessedTotal.WithLabelValues(task.Index, task.Op, searchRetryResultReschedule).Inc()
	slog.Warn("search durable retry failed, rescheduled",
		"index", task.Index,
		"op", task.Op,
		"entity_id", task.EntityID,
		"operation", task.Operation,
		"attempts", attempts,
		"next_retry_in", backoff.String(),
		"error", err,
	)
}

// errSearchRetrySkip signals the worker should drop the task without counting
// as a failure (e.g. job no longer active when we wanted to index).
var errSearchRetrySkip = fmt.Errorf("search retry skip")

func (q *SearchRetryQueue) executeTask(ctx context.Context, task SearchRetryTask) error {
	switch task.Index {
	case searchRetryIndexJobs:
		return q.executeJobTask(ctx, task)
	case searchRetryIndexListings:
		return q.executeListingTask(ctx, task)
	default:
		return fmt.Errorf("unknown search index %q", task.Index)
	}
}

func (q *SearchRetryQueue) executeJobTask(ctx context.Context, task SearchRetryTask) error {
	if q.jobSearch == nil {
		return fmt.Errorf("job search engine unwired")
	}
	switch task.Op {
	case searchRetryOpRemove:
		return q.jobSearch.RemoveJob(ctx, task.EntityID)
	case searchRetryOpIndex:
		if q.jobRepo == nil {
			return fmt.Errorf("job repo unwired")
		}
		job, err := q.jobRepo.GetJob(ctx, task.EntityID)
		if err != nil {
			// Transient DB errors must reschedule — only true not-found is a skip.
			if !errors.Is(err, domain.ErrJobNotFound) {
				return fmt.Errorf("job re-fetch: %w", err)
			}
			// Gone → best-effort remove so a stale document does not linger.
			if removeErr := q.jobSearch.RemoveJob(ctx, task.EntityID); removeErr != nil {
				slog.DebugContext(ctx, "search retry: remove missing job failed",
					"job_id", task.EntityID, "error", removeErr)
			}
			return errSearchRetrySkip
		}
		if job.Status != "active" {
			// Lifecycle moved on; keep the index consistent via remove.
			if removeErr := q.jobSearch.RemoveJob(ctx, task.EntityID); removeErr != nil {
				return removeErr
			}
			return nil
		}
		return q.jobSearch.IndexJob(ctx, job)
	default:
		return fmt.Errorf("unknown op %q", task.Op)
	}
}

func (q *SearchRetryQueue) executeListingTask(ctx context.Context, task SearchRetryTask) error {
	if q.listingSearch == nil {
		return fmt.Errorf("listing search engine unwired")
	}
	switch task.Op {
	case searchRetryOpRemove:
		return q.listingSearch.RemoveListing(ctx, task.EntityID)
	case searchRetryOpIndex:
		if q.listingRepo == nil {
			return fmt.Errorf("listing repo unwired")
		}
		l, err := q.listingRepo.GetListing(ctx, task.EntityID)
		if err != nil {
			if !errors.Is(err, domain.ErrListingNotFound) {
				return fmt.Errorf("listing re-fetch: %w", err)
			}
			if removeErr := q.listingSearch.RemoveListing(ctx, task.EntityID); removeErr != nil {
				slog.DebugContext(ctx, "search retry: remove missing listing failed",
					"listing_id", task.EntityID, "error", removeErr)
			}
			return errSearchRetrySkip
		}
		if l.Status != "active" {
			if removeErr := q.listingSearch.RemoveListing(ctx, task.EntityID); removeErr != nil {
				return removeErr
			}
			return nil
		}
		return q.listingSearch.IndexListing(ctx, l, q.listingHydrate)
	default:
		return fmt.Errorf("unknown op %q", task.Op)
	}
}

// RunSearchRetryCron starts the durable search-retry worker. Stops on ctx cancel.
// Interval defaults to 30s; initialDelay keeps deploy storms from stampeding
// the database. Safe on every replica: claims use FOR UPDATE SKIP LOCKED.
func RunSearchRetryCron(ctx context.Context, q *SearchRetryQueue, interval, initialDelay time.Duration, batchLimit int64) {
	if q == nil || q.store == nil {
		slog.Info("search durable retry cron disabled (no database queue)")
		return
	}
	if interval <= 0 {
		interval = searchRetryPollInterval
	}
	if initialDelay < 0 {
		initialDelay = 0
	}
	if batchLimit <= 0 {
		batchLimit = 50
	}

	go func() {
		slog.Info("search durable retry cron starting",
			"interval", interval.String(),
			"initial_delay", initialDelay.String(),
			"batch_limit", batchLimit,
			"store", "postgres:search_retry_outbox",
			"max_durable_attempts", maxSearchRetryDurableAttempts,
		)
		select {
		case <-time.After(initialDelay):
		case <-ctx.Done():
			return
		}

		t := time.NewTicker(interval)
		defer t.Stop()

		runOnce := func() {
			runCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
			defer cancel()
			n, err := q.ProcessDue(runCtx, batchLimit)
			if err != nil {
				slog.Error("search durable retry: tick failed", "error", err)
				return
			}
			if n > 0 {
				slog.Info("search durable retry: tick processed", "claimed", n)
			}
		}
		runOnce()

		for {
			select {
			case <-t.C:
				runOnce()
			case <-ctx.Done():
				slog.Info("search durable retry cron stopping")
				return
			}
		}
	}()
}

// ── pure helpers (unit-tested) ──────────────────────────────────────────────

// SearchRetryBackoff returns the wait after a durable failure at the given
// 1-based attempt count. Exponential: 30s, 60s, 120s, 240s, 480s — capped at
// 15m so a long Meilisearch outage does not pin tasks for hours.
func SearchRetryBackoff(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	// 30s << (attempts-1): attempt 1 → 30s, 2 → 60s, 3 → 120s, …
	d := 30 * time.Second * time.Duration(1<<(attempts-1))
	const cap = 15 * time.Minute
	if d > cap {
		return cap
	}
	return d
}

func validateSearchRetryTask(task SearchRetryTask) error {
	if task.EntityID == "" {
		return fmt.Errorf("search retry task: empty entity id")
	}
	switch task.Index {
	case searchRetryIndexJobs, searchRetryIndexListings:
	default:
		return fmt.Errorf("search retry task: invalid index %q", task.Index)
	}
	switch task.Op {
	case searchRetryOpIndex, searchRetryOpRemove:
	default:
		return fmt.Errorf("search retry task: invalid op %q", task.Op)
	}
	return nil
}

func marshalSearchRetryMember(task SearchRetryTask) (string, error) {
	if err := validateSearchRetryTask(task); err != nil {
		return "", err
	}
	b, err := json.Marshal(task)
	if err != nil {
		return "", fmt.Errorf("marshal search retry task: %w", err)
	}
	return string(b), nil
}

func unmarshalSearchRetryMember(member string) (SearchRetryTask, error) {
	var task SearchRetryTask
	if err := json.Unmarshal([]byte(member), &task); err != nil {
		return SearchRetryTask{}, fmt.Errorf("unmarshal search retry task: %w", err)
	}
	if err := validateSearchRetryTask(task); err != nil {
		return SearchRetryTask{}, err
	}
	return task, nil
}
