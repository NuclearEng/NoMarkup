package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// recurringPaymentRetryPauseThreshold is FR-16.7 partial: pause the recurring
// schedule after this many consecutive CreatePayment / setup failures for visit
// escrow. One-shot off-session charge on CreatePayment (approve/auto-approve)
// lives in payment service tryRecurringVisitOffSession. Day-0/3/7 *scheduled*
// charge retries are not implemented here — we store payment_retry_count +
// next_retry_at and pause at 3 strikes. A job-service ticker logs due rows only
// (processRecurringPaymentRetries).
const recurringPaymentRetryPauseThreshold = 3

// FR-16.7 day-0 / day-3 / day-7 spacing after a recorded failure:
//
//	count 1 (day-0 fail just stored) → schedule day-3: now + 3d
//	count 2 (day-3 fail)             → schedule day-7: now + 4d
//	count >= 3                       → no further retry (pause path)
const (
	recurringRetryAfterFirstFail  = 3 * 24 * time.Hour
	recurringRetryAfterSecondFail = 4 * 24 * time.Hour
)

// nextRetryAtAfterCount returns when the next automatic retry should run for a
// newly recorded failure count, or nil when no further retry is scheduled
// (threshold reached or unexpected count). Pure helper for SQL + response.
func nextRetryAtAfterCount(count int, now time.Time) *time.Time {
	switch count {
	case 1:
		t := now.UTC().Add(recurringRetryAfterFirstFail)
		return &t
	case 2:
		t := now.UTC().Add(recurringRetryAfterSecondFail)
		return &t
	default:
		return nil
	}
}

// incrRecurringPaymentRetryCount atomically increments
// recurring_configs.payment_retry_count (migration 112) and sets next_retry_at
// (migration 113) when the new count is still below the pause threshold.
// Returns the new count and the scheduled next_retry_at (nil when cleared /
// at-or-past threshold). Fail-soft callers must treat errors as "untracked"
// rather than inventing a pause decision without a durable counter.
func incrRecurringPaymentRetryCount(ctx context.Context, db *pgxpool.Pool, recurringID string) (int, *time.Time, error) {
	if db == nil {
		return 0, nil, errPaymentRetryDBUnwired
	}
	if recurringID == "" {
		return 0, nil, fmt.Errorf("increment payment_retry_count: empty recurring id")
	}
	var count int
	var nextRetryAt *time.Time
	err := db.QueryRow(ctx, `
		UPDATE recurring_configs
		   SET payment_retry_count = payment_retry_count + 1,
		       next_retry_at = CASE
		         WHEN payment_retry_count + 1 = 1 THEN now() + interval '3 days'
		         WHEN payment_retry_count + 1 = 2 THEN now() + interval '4 days'
		         ELSE NULL
		       END,
		       updated_at = now()
		 WHERE id = $1
		 RETURNING payment_retry_count, next_retry_at`, recurringID).Scan(&count, &nextRetryAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, fmt.Errorf("increment payment_retry_count: %w", errRecurringConfigMissing)
	}
	if err != nil {
		return 0, nil, fmt.Errorf("increment payment_retry_count: %w", err)
	}
	return count, nextRetryAt, nil
}

// resetRecurringPaymentRetryCount clears the FR-16.7 partial counter and
// next_retry_at after a successful visit payment setup or capture. No-op when
// already zero/null or the row is missing (fail-soft: money/status path already
// succeeded).
func resetRecurringPaymentRetryCount(ctx context.Context, db *pgxpool.Pool, recurringID string) error {
	if db == nil {
		return errPaymentRetryDBUnwired
	}
	if recurringID == "" {
		return fmt.Errorf("reset payment_retry_count: empty recurring id")
	}
	tag, err := db.Exec(ctx, `
		UPDATE recurring_configs
		   SET payment_retry_count = 0,
		       next_retry_at = NULL,
		       updated_at = now()
		 WHERE id = $1
		   AND (payment_retry_count <> 0 OR next_retry_at IS NOT NULL)`, recurringID)
	if err != nil {
		return fmt.Errorf("reset payment_retry_count: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Already zero/null, or unknown id — both are fine for fail-soft callers.
		slog.DebugContext(ctx, "FR-16.7: payment_retry_count already zero or config missing",
			"recurring_id", recurringID,
		)
	}
	return nil
}

var (
	errPaymentRetryDBUnwired  = errors.New("payment_retry_count: database pool unwired")
	errRecurringConfigMissing = errors.New("recurring config not found for payment_retry_count")
)
