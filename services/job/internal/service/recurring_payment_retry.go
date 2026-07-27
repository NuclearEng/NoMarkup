package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RecurringPaymentRetryWorker scans recurring_configs due for an FR-16.7
// scheduled payment retry (next_retry_at <= now, status active, count < 3).
//
// Residual: this worker only logs due rows. It does NOT create PaymentIntents,
// charge off-session, or call CreatePayment. Full day-0/3/7 automatic charge
// remains product residual until an off-session rail is wired. The durable
// schedule lives in next_retry_at (migration 113); gateway increments the
// counter and stamps next_retry_at on CreatePayment setup failures.
type RecurringPaymentRetryWorker struct {
	pool *pgxpool.Pool
}

// NewRecurringPaymentRetryWorker constructs a scan worker. pool may be nil
// (cron will no-op / disable).
func NewRecurringPaymentRetryWorker(pool *pgxpool.Pool) *RecurringPaymentRetryWorker {
	return &RecurringPaymentRetryWorker{pool: pool}
}

// dueRecurringPaymentRetry is one row returned by the due-scan query.
type dueRecurringPaymentRetry struct {
	ID                string
	ContractID        string
	PaymentRetryCount int
	NextRetryAt       time.Time
}

// ProcessRecurringPaymentRetries is the cron entrypoint. Selects a bounded
// batch of active recurring configs whose next_retry_at is due and logs each
// one. Returns the number of due rows observed (not acted on). Fail-soft on
// DB errors so a tick never takes down the job service.
//
// STUB: no money movement. When off-session charge ships, replace the log body
// with CreatePayment / ProcessPayment orchestration (idempotent per visit).
func (w *RecurringPaymentRetryWorker) ProcessRecurringPaymentRetries(ctx context.Context, limit int) (int, error) {
	if w == nil || w.pool == nil {
		return 0, fmt.Errorf("recurring payment retry worker: database pool unwired")
	}
	if limit <= 0 {
		limit = 100
	}

	rows, err := w.pool.Query(ctx, `
		SELECT id::text, contract_id::text, payment_retry_count, next_retry_at
		  FROM recurring_configs
		 WHERE status = 'active'
		   AND next_retry_at IS NOT NULL
		   AND next_retry_at <= now()
		   AND payment_retry_count > 0
		   AND payment_retry_count < 3
		 ORDER BY next_retry_at ASC
		 LIMIT $1`, limit)
	if err != nil {
		return 0, fmt.Errorf("recurring payment retry scan: %w", err)
	}
	defer rows.Close()

	var due []dueRecurringPaymentRetry
	for rows.Next() {
		var r dueRecurringPaymentRetry
		if scanErr := rows.Scan(&r.ID, &r.ContractID, &r.PaymentRetryCount, &r.NextRetryAt); scanErr != nil {
			return len(due), fmt.Errorf("recurring payment retry scan row: %w", scanErr)
		}
		due = append(due, r)
	}
	if err := rows.Err(); err != nil {
		return len(due), fmt.Errorf("recurring payment retry scan iterate: %w", err)
	}

	if len(due) == 0 {
		return 0, nil
	}

	// Log-only residual: surface due work for ops without charging.
	for _, r := range due {
		slog.InfoContext(ctx, "FR-16.7 residual: due recurring payment retry (no auto-charge; log-only stub)",
			"recurring_id", r.ID,
			"contract_id", r.ContractID,
			"payment_retry_count", r.PaymentRetryCount,
			"next_retry_at", r.NextRetryAt.UTC().Format(time.RFC3339),
			"action", "log_only_no_charge",
		)
	}
	slog.InfoContext(ctx, "FR-16.7 processRecurringPaymentRetries tick complete (stub)",
		"due_count", len(due),
		"limit", limit,
	)
	return len(due), nil
}

// RunRecurringPaymentRetryCron starts the FR-16.7 due-scan ticker (log-only).
// Interval defaults to 1 hour — retries are day-scale so sub-hour ticks waste
// cycles. Initial delay keeps deploy storms from hammering Postgres.
// Stops when ctx is cancelled.
func RunRecurringPaymentRetryCron(ctx context.Context, w *RecurringPaymentRetryWorker, interval, initialDelay time.Duration, batchLimit int) {
	if w == nil || w.pool == nil {
		slog.Info("FR-16.7 recurring payment retry cron disabled (no database pool)")
		return
	}
	if interval <= 0 {
		interval = time.Hour
	}
	if initialDelay < 0 {
		initialDelay = 0
	}
	if batchLimit <= 0 {
		batchLimit = 100
	}

	go func() {
		slog.Info("FR-16.7 recurring payment retry cron starting (log-only stub; off-session charge residual)",
			"interval", interval.String(),
			"initial_delay", initialDelay.String(),
			"batch_limit", batchLimit,
		)
		select {
		case <-time.After(initialDelay):
		case <-ctx.Done():
			return
		}

		t := time.NewTicker(interval)
		defer t.Stop()

		runOnce := func() {
			runCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
			defer cancel()
			n, err := w.ProcessRecurringPaymentRetries(runCtx, batchLimit)
			if err != nil {
				slog.Error("FR-16.7 processRecurringPaymentRetries: tick failed", "error", err)
				return
			}
			if n > 0 {
				slog.Info("FR-16.7 processRecurringPaymentRetries: due rows logged (no charge)",
					"due_count", n,
				)
			}
		}
		runOnce()

		for {
			select {
			case <-t.C:
				runOnce()
			case <-ctx.Done():
				slog.Info("FR-16.7 recurring payment retry cron stopping")
				return
			}
		}
	}()
}
