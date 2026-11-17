package service

// Postgres outbox behind SearchRetryQueue (migration 141, search_retry_outbox).
//
// The SQL lives here rather than in internal/repository because the queue is
// the only consumer and the store is a private seam: unit tests drive
// SearchRetryQueue against an in-memory fake of searchRetryStore, and the
// integration tests drive this file against a real database.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/meilisearch/meilisearch-go"
)

// searchRetryLease is how far a claim pushes next_attempt_at out. A worker that
// crashes mid-batch leaves its rows claimed; they become due again after the
// lease. It must comfortably exceed one tick's processing budget (25s).
const searchRetryLease = 5 * time.Minute

// searchRetryDeadLetterRetention is how long dead-lettered rows are kept for
// operator inspection before the worker prunes them.
const searchRetryDeadLetterRetention = 30 * 24 * time.Hour

// searchRetryPruneBatch bounds one tick's dead-letter prune.
const searchRetryPruneBatch = 500

// searchRetryLastErrorMax bounds last_error.
const searchRetryLastErrorMax = 300

// claimedSearchRetryTask is one row handed to a worker by Claim.
type claimedSearchRetryTask struct {
	ID    string
	Token string
	Task  SearchRetryTask
}

// searchRetryStore is the durable store behind SearchRetryQueue.
type searchRetryStore interface {
	// Enqueue upserts a pending task. A pending row for the same
	// (index, entity, op) is reset: attempts=0, due now, claim cleared.
	Enqueue(ctx context.Context, task SearchRetryTask) error
	// Import inserts a task carried over from the legacy Redis ZSET, keeping
	// its attempts and due time. A pending duplicate wins (no-op).
	Import(ctx context.Context, task SearchRetryTask, nextAttemptAt time.Time) (bool, error)
	// Claim leases up to limit due rows to this caller.
	Claim(ctx context.Context, limit int) ([]claimedSearchRetryTask, error)
	// Complete deletes a claimed row. false = claim lost (re-enqueued meanwhile).
	Complete(ctx context.Context, id, token string) (bool, error)
	// Reschedule records a failed attempt and sets the next due time.
	Reschedule(ctx context.Context, id, token string, attempts int, backoff time.Duration, lastErr string) (bool, error)
	// DeadLetter marks a claimed row as exhausted.
	DeadLetter(ctx context.Context, id, token string, attempts int, lastErr string) (bool, error)
	// PendingCount counts rows not dead-lettered (due + future + leased).
	PendingCount(ctx context.Context) (int64, error)
	// PruneDeadLetters deletes up to limit rows dead-lettered before olderThan ago.
	PruneDeadLetters(ctx context.Context, olderThan time.Duration, limit int) (int64, error)
}

// pgSearchRetryStore implements searchRetryStore on search_retry_outbox.
type pgSearchRetryStore struct {
	pool *pgxpool.Pool
}

func (s pgSearchRetryStore) Enqueue(ctx context.Context, task SearchRetryTask) error {
	if _, err := uuid.Parse(task.EntityID); err != nil {
		return fmt.Errorf("search retry enqueue: entity id is not a uuid: %w", err)
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO search_retry_outbox (index_name, op, entity_id, operation, attempts, next_attempt_at)
		VALUES ($1, $2, $3::uuid, $4, $5, now())
		ON CONFLICT (index_name, entity_id, op) WHERE dead_lettered_at IS NULL
		DO UPDATE SET attempts        = EXCLUDED.attempts,
		              next_attempt_at = now(),
		              operation       = EXCLUDED.operation,
		              claim_token     = NULL,
		              claimed_at      = NULL,
		              last_error      = NULL`,
		task.Index, task.Op, task.EntityID, task.Operation, task.Attempts)
	if err != nil {
		return fmt.Errorf("search retry enqueue: %w", err)
	}
	return nil
}

func (s pgSearchRetryStore) Import(ctx context.Context, task SearchRetryTask, nextAttemptAt time.Time) (bool, error) {
	if _, err := uuid.Parse(task.EntityID); err != nil {
		return false, fmt.Errorf("search retry import: entity id is not a uuid: %w", err)
	}
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO search_retry_outbox (index_name, op, entity_id, operation, attempts, next_attempt_at)
		VALUES ($1, $2, $3::uuid, $4, $5, $6)
		ON CONFLICT (index_name, entity_id, op) WHERE dead_lettered_at IS NULL
		DO NOTHING`,
		task.Index, task.Op, task.EntityID, task.Operation, task.Attempts, nextAttemptAt.UTC())
	if err != nil {
		return false, fmt.Errorf("search retry import: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// Claim is a single statement, so the row locks taken by FOR UPDATE SKIP
// LOCKED are held only for the UPDATE that stamps the claim. A concurrent
// claimer skips locked rows, and once the statement commits the rows are no
// longer due (next_attempt_at moved out by the lease), so two workers never
// receive the same row.
func (s pgSearchRetryStore) Claim(ctx context.Context, limit int) ([]claimedSearchRetryTask, error) {
	token := uuid.NewString()
	rows, err := s.pool.Query(ctx, `
		WITH due AS (
			SELECT id
			  FROM search_retry_outbox
			 WHERE dead_lettered_at IS NULL
			   AND next_attempt_at <= now()
			 ORDER BY next_attempt_at
			 LIMIT $1
			   FOR UPDATE SKIP LOCKED
		)
		UPDATE search_retry_outbox o
		   SET claim_token     = $2::uuid,
		       claimed_at      = now(),
		       next_attempt_at = now() + $3 * interval '1 second'
		  FROM due
		 WHERE o.id = due.id
		RETURNING o.id::text, o.index_name, o.op, o.entity_id::text, o.operation, o.attempts`,
		limit, token, searchRetryLease.Seconds())
	if err != nil {
		return nil, fmt.Errorf("search retry claim: %w", err)
	}
	defer rows.Close()

	out := make([]claimedSearchRetryTask, 0, limit)
	for rows.Next() {
		c := claimedSearchRetryTask{Token: token}
		if err := rows.Scan(&c.ID, &c.Task.Index, &c.Task.Op, &c.Task.EntityID, &c.Task.Operation, &c.Task.Attempts); err != nil {
			return nil, fmt.Errorf("search retry claim scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("search retry claim rows: %w", err)
	}
	return out, nil
}

func (s pgSearchRetryStore) Complete(ctx context.Context, id, token string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM search_retry_outbox
		 WHERE id = $1::uuid AND claim_token = $2::uuid`, id, token)
	if err != nil {
		return false, fmt.Errorf("search retry complete: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (s pgSearchRetryStore) Reschedule(ctx context.Context, id, token string, attempts int, backoff time.Duration, lastErr string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE search_retry_outbox
		   SET attempts        = $3,
		       next_attempt_at = now() + $4 * interval '1 second',
		       last_error      = $5,
		       claim_token     = NULL,
		       claimed_at      = NULL
		 WHERE id = $1::uuid AND claim_token = $2::uuid`,
		id, token, attempts, backoff.Seconds(), lastErr)
	if err != nil {
		return false, fmt.Errorf("search retry reschedule: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (s pgSearchRetryStore) DeadLetter(ctx context.Context, id, token string, attempts int, lastErr string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE search_retry_outbox
		   SET attempts         = $3,
		       last_error       = $4,
		       dead_lettered_at = now(),
		       claim_token      = NULL,
		       claimed_at       = NULL
		 WHERE id = $1::uuid AND claim_token = $2::uuid`,
		id, token, attempts, lastErr)
	if err != nil {
		return false, fmt.Errorf("search retry dead-letter: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func (s pgSearchRetryStore) PendingCount(ctx context.Context) (int64, error) {
	var n int64
	if err := s.pool.QueryRow(ctx, `
		SELECT count(*) FROM search_retry_outbox WHERE dead_lettered_at IS NULL`).Scan(&n); err != nil {
		return 0, fmt.Errorf("search retry depth: %w", err)
	}
	return n, nil
}

func (s pgSearchRetryStore) PruneDeadLetters(ctx context.Context, olderThan time.Duration, limit int) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM search_retry_outbox
		 WHERE id IN (
			SELECT id FROM search_retry_outbox
			 WHERE dead_lettered_at IS NOT NULL
			   AND dead_lettered_at < now() - $1 * interval '1 second'
			 LIMIT $2)`,
		olderThan.Seconds(), limit)
	if err != nil {
		return 0, fmt.Errorf("search retry prune: %w", err)
	}
	return tag.RowsAffected(), nil
}

// sanitizeSearchRetryError renders an error for last_error. The Meilisearch
// client's Error() embeds the raw request (the whole indexed document), so for
// that type only the endpoint, status and API error code are kept. Anything
// else is truncated.
func sanitizeSearchRetryError(err error) string {
	if err == nil {
		return ""
	}
	var me *meilisearch.Error
	if errors.As(err, &me) {
		return truncateSearchRetryError(fmt.Sprintf("meilisearch %s %s: status=%d code=%s",
			me.Method, me.Endpoint, me.StatusCode, me.MeilisearchApiError.Code))
	}
	return truncateSearchRetryError(err.Error())
}

func truncateSearchRetryError(s string) string {
	if len(s) <= searchRetryLastErrorMax {
		return s
	}
	// Byte truncation can split a rune; Postgres TEXT rejects invalid UTF-8.
	return strings.ToValidUTF8(s[:searchRetryLastErrorMax], "")
}
