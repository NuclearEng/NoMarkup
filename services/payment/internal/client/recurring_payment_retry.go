package client

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FR-16.7: pause the recurring schedule after this many consecutive payment
// failures (CreatePayment setup OR payment_intent.payment_failed charge fails).
// Matches gateway recurringPaymentRetryPauseThreshold.
const recurringPaymentRetryPauseThreshold = 3

// incrRecurringPaymentRetryCount atomically increments
// recurring_configs.payment_retry_count (migration 112) and sets next_retry_at
// (migration 113) when the new count is still below the pause threshold.
// Same SQL as gateway/internal/handler/recurring_payment_retry.go so setup-fail
// and charge-fail share one strike schedule (day-0 / day-3 / day-7).
//
//	count 1 → next_retry_at = now + 3 days
//	count 2 → next_retry_at = now + 4 days
//	count >= 3 → next_retry_at = NULL (pause path)
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

// resetRecurringPaymentRetryCount clears the FR-16.7 counter + next_retry_at.
// Available for success-path callers; webhook payment_failed does not call it.
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
