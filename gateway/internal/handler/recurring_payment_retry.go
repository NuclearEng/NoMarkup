package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// recurringPaymentRetryPauseThreshold is FR-16.7 partial: pause the recurring
// schedule after this many consecutive CreatePayment / setup failures for visit
// escrow. Full FR-16.7 (day 0 / day 3 / day 7 automatic retries + off-session
// charge) is not implemented here — only the "3 strikes then pause" gate.
const recurringPaymentRetryPauseThreshold = 3

// incrRecurringPaymentRetryCount atomically increments
// recurring_configs.payment_retry_count (migration 112) and returns the new
// value. Fail-soft callers must treat errors as "untracked" rather than
// inventing a pause decision without a durable counter.
func incrRecurringPaymentRetryCount(ctx context.Context, db *pgxpool.Pool, recurringID string) (int, error) {
	if db == nil {
		return 0, errPaymentRetryDBUnwired
	}
	if recurringID == "" {
		return 0, fmt.Errorf("increment payment_retry_count: empty recurring id")
	}
	var count int
	err := db.QueryRow(ctx, `
		UPDATE recurring_configs
		   SET payment_retry_count = payment_retry_count + 1,
		       updated_at = now()
		 WHERE id = $1
		 RETURNING payment_retry_count`, recurringID).Scan(&count)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, fmt.Errorf("increment payment_retry_count: %w", errRecurringConfigMissing)
	}
	if err != nil {
		return 0, fmt.Errorf("increment payment_retry_count: %w", err)
	}
	return count, nil
}

// resetRecurringPaymentRetryCount clears the FR-16.7 partial counter after a
// successful visit payment setup or capture. No-op when already zero or the
// row is missing (fail-soft: money/status path already succeeded).
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
		       updated_at = now()
		 WHERE id = $1
		   AND payment_retry_count <> 0`, recurringID)
	if err != nil {
		return fmt.Errorf("reset payment_retry_count: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Already zero, or unknown id — both are fine for fail-soft callers.
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
