// Package service — durable Meilisearch reindex retry (ARC-16).
//
// Problem: indexJobWithRetry / indexListingWithRetry used fire-and-forget
// goroutines with 3 in-process attempts. On exhaustion the failure was only
// logged — a process restart or prolonged Meilisearch outage silently dropped
// the update until a full rebuild.
//
// Fix (minimal, Redis-backed — matches docs/TODOS.md and existing job-service
// REDIS_URL wiring used for auction notifications):
//
//  1. In-process 3-attempt exponential backoff stays first-line (fast path).
//  2. On exhaustion, enqueue a compact task into a Redis ZSET scored by next
//     attempt unix time. Survives restarts; multi-replica safe enough for
//     search (Meilisearch upsert/delete is idempotent — double-claim is OK).
//  3. Background cron (default 30s) claims due members, re-fetches the entity
//     from Postgres (source of truth), and re-applies index or remove.
//  4. After max durable attempts: ERROR dead-letter log + Prometheus counter
//     (pageable). Search is not money — we fail-soft, never block writers.
//
// When REDIS_URL is unset the queue is nil: in-process retries still run, and
// exhaustion is recorded as dead-letter with reason=no_queue so the gap is
// visible rather than silent.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/nomarkup/nomarkup/services/job/internal/domain"
)

// Redis ZSET holding pending search retry tasks. Score = next attempt unix
// seconds; member = JSON SearchRetryTask. Fixed key so multi-replica pods share
// one queue and a crashed pod's backlog is picked up by the next.
const searchRetryRedisKey = "search:retry"

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

// SearchRetryQueue is a Redis-backed durable queue + worker for Meilisearch
// index/remove retries. All fields optional-safe: nil queue means no durable
// path (callers still log + metric).
type SearchRetryQueue struct {
	rdb *redis.Client

	// Re-fetch + apply hooks. Set at wire-up; nil-safe per call site.
	jobRepo        domain.JobRepository
	jobSearch      *SearchEngine
	listingRepo    domain.ListingRepository
	listingSearch  *ListingSearchEngine
	listingHydrate ListingHydrator
}

// NewSearchRetryQueue builds a queue. rdb must be non-nil; callers should
// skip construction when REDIS_URL is unset.
func NewSearchRetryQueue(rdb *redis.Client) *SearchRetryQueue {
	return &SearchRetryQueue{rdb: rdb}
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

// Enqueue schedules a durable retry. Immediate next-attempt (score=now) so the
// next worker tick picks it up. Fail-soft: returns error for the caller to
// metric/log; never panics.
func (q *SearchRetryQueue) Enqueue(ctx context.Context, task SearchRetryTask) error {
	if q == nil || q.rdb == nil {
		return fmt.Errorf("search retry queue: redis unwired")
	}
	if err := validateSearchRetryTask(task); err != nil {
		return err
	}
	if task.Attempts < 0 {
		task.Attempts = 0
	}
	member, err := marshalSearchRetryMember(task)
	if err != nil {
		return err
	}
	// Score = now so the next 30s tick (or an immediate ProcessDue) claims it.
	// Slight skew via Attempts is unnecessary on first enqueue.
	score := float64(time.Now().UTC().Unix())
	if err := q.rdb.ZAdd(ctx, searchRetryRedisKey, redis.Z{
		Score:  score,
		Member: member,
	}).Err(); err != nil {
		return fmt.Errorf("search retry enqueue: %w", err)
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

	if q == nil || q.rdb == nil {
		searchRetryEnqueueFailedTotal.WithLabelValues(task.Index, task.Op, searchRetryReasonNoQueue).Inc()
		searchRetryDeadLetterTotal.WithLabelValues(task.Index, task.Op).Inc()
		slog.Error("SEARCH RETRY DEAD-LETTER — durable queue unavailable (REDIS_URL unset or unwired); entity may drift from search until rebuild",
			"index", task.Index,
			"op", task.Op,
			"entity_id", task.EntityID,
			"operation", task.Operation,
			"reason", searchRetryReasonNoQueue,
		)
		return
	}

	if err := q.Enqueue(ctx, task); err != nil {
		reason := searchRetryReasonRedisErr
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

// ProcessDue claims and processes up to limit tasks whose score <= now.
// Returns the number of tasks claimed (including skips / reschedules / dead-letters).
// Fail-soft on Redis errors so a tick never takes down the job service.
func (q *SearchRetryQueue) ProcessDue(ctx context.Context, limit int64) (int, error) {
	if q == nil || q.rdb == nil {
		return 0, fmt.Errorf("search retry queue: redis unwired")
	}
	if limit <= 0 {
		limit = 50
	}

	now := float64(time.Now().UTC().Unix())
	members, err := q.rdb.ZRangeByScoreWithScores(ctx, searchRetryRedisKey, &redis.ZRangeBy{
		Min:    "-inf",
		Max:    fmt.Sprintf("%f", now),
		Offset: 0,
		Count:  limit,
	}).Result()
	if err != nil {
		return 0, fmt.Errorf("search retry claim: %w", err)
	}

	// Depth gauge: total pending (due + future), not just this batch.
	if card, cerr := q.rdb.ZCard(ctx, searchRetryRedisKey).Result(); cerr == nil {
		searchRetryQueueDepth.Set(float64(card))
	}

	processed := 0
	for _, z := range members {
		member, ok := z.Member.(string)
		if !ok {
			// Unexpected type — drop to avoid poison loops.
			_ = q.rdb.ZRem(ctx, searchRetryRedisKey, z.Member).Err()
			continue
		}
		// Claim: ZREM must return 1. If 0, another replica already claimed.
		n, remErr := q.rdb.ZRem(ctx, searchRetryRedisKey, member).Result()
		if remErr != nil || n == 0 {
			continue
		}
		processed++

		task, perr := unmarshalSearchRetryMember(member)
		if perr != nil {
			slog.Error("search retry: corrupt queue member dropped", "member", member, "error", perr)
			continue
		}
		q.applyTask(ctx, task)
	}
	return processed, nil
}

// applyTask re-fetches entity state and applies index/remove, then reschedules
// or dead-letters on failure.
func (q *SearchRetryQueue) applyTask(ctx context.Context, task SearchRetryTask) {
	err := q.executeTask(ctx, task)
	if err == nil {
		searchRetryProcessedTotal.WithLabelValues(task.Index, task.Op, searchRetryResultSuccess).Inc()
		slog.Info("search durable retry succeeded",
			"index", task.Index,
			"op", task.Op,
			"entity_id", task.EntityID,
			"operation", task.Operation,
			"attempts", task.Attempts+1,
		)
		return
	}

	// Skip (entity gone / not indexable) is success-shaped for queue purposes.
	if err == errSearchRetrySkip {
		searchRetryProcessedTotal.WithLabelValues(task.Index, task.Op, searchRetryResultSkip).Inc()
		slog.Info("search durable retry skipped (entity no longer needs this op)",
			"index", task.Index,
			"op", task.Op,
			"entity_id", task.EntityID,
			"operation", task.Operation,
		)
		return
	}

	next := task
	next.Attempts++
	if next.Attempts >= maxSearchRetryDurableAttempts {
		searchRetryProcessedTotal.WithLabelValues(task.Index, task.Op, searchRetryResultDeadLetter).Inc()
		searchRetryDeadLetterTotal.WithLabelValues(task.Index, task.Op).Inc()
		slog.Error("SEARCH RETRY DEAD-LETTER — durable attempts exhausted; run reindex or wait for next lifecycle write",
			"index", task.Index,
			"op", task.Op,
			"entity_id", task.EntityID,
			"operation", task.Operation,
			"attempts", next.Attempts,
			"max_attempts", maxSearchRetryDurableAttempts,
			"error", err,
		)
		return
	}

	// Reschedule with exponential backoff from pure helper.
	score := SearchRetryNextScore(time.Now().UTC(), next.Attempts)
	member, merr := marshalSearchRetryMember(next)
	if merr != nil {
		searchRetryEnqueueFailedTotal.WithLabelValues(task.Index, task.Op, searchRetryReasonMarshal).Inc()
		searchRetryDeadLetterTotal.WithLabelValues(task.Index, task.Op).Inc()
		slog.Error("SEARCH RETRY DEAD-LETTER — reschedule marshal failed",
			"index", task.Index, "op", task.Op, "entity_id", task.EntityID, "error", merr)
		return
	}
	if zerr := q.rdb.ZAdd(ctx, searchRetryRedisKey, redis.Z{Score: score, Member: member}).Err(); zerr != nil {
		searchRetryEnqueueFailedTotal.WithLabelValues(task.Index, task.Op, searchRetryReasonRedisErr).Inc()
		searchRetryDeadLetterTotal.WithLabelValues(task.Index, task.Op).Inc()
		slog.Error("SEARCH RETRY DEAD-LETTER — reschedule ZADD failed",
			"index", task.Index, "op", task.Op, "entity_id", task.EntityID, "error", zerr)
		return
	}
	searchRetryProcessedTotal.WithLabelValues(task.Index, task.Op, searchRetryResultReschedule).Inc()
	slog.Warn("search durable retry failed, rescheduled",
		"index", task.Index,
		"op", task.Op,
		"entity_id", task.EntityID,
		"operation", task.Operation,
		"attempts", next.Attempts,
		"next_score", score,
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
// Interval defaults to 30s; initialDelay keeps deploy storms from stampeding Redis.
func RunSearchRetryCron(ctx context.Context, q *SearchRetryQueue, interval, initialDelay time.Duration, batchLimit int64) {
	if q == nil || q.rdb == nil {
		slog.Info("search durable retry cron disabled (no Redis queue)")
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
			"redis_key", searchRetryRedisKey,
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

// SearchRetryNextScore returns the ZSET score (unix seconds) for the next
// attempt after `attempts` durable failures have already been recorded.
func SearchRetryNextScore(now time.Time, attempts int) float64 {
	return float64(now.Add(SearchRetryBackoff(attempts)).UTC().Unix())
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
