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
// Discovery / ops visibility only. The job mesh has no payment gRPC client;
// real CreatePayment + off-session attempt-N is owned by the gateway cron
// ProcessDueRecurringPaymentRetries (see gateway/internal/handler/
// recurring_payment_retry_worker.go). Gateway stamps next_retry_at on
// CreatePayment setup failures (migration 113) and clears it on success.
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

// ProcessRecurringPaymentRetries is the job-service cron entrypoint. Selects a
// bounded batch of active recurring configs whose next_retry_at is due and logs
// each one for ops. Returns the number of due rows observed. Does not create
// PaymentIntents or call CreatePayment — charge orchestration is gateway-side.
// Fail-soft on DB errors so a tick never takes down the job service.
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

	// Discovery log: gateway charge cron claims these rows; this scan is
	// observability when gateway is down or lagging.
	for _, r := range due {
		slog.InfoContext(ctx, "FR-16.7: due recurring payment retry (job discovery; charge is gateway CreatePayment)",
			"recurring_id", r.ID,
			"contract_id", r.ContractID,
			"payment_retry_count", r.PaymentRetryCount,
			"next_retry_at", r.NextRetryAt.UTC().Format(time.RFC3339),
			"action", "discovery_only_gateway_charges",
		)
	}
	slog.InfoContext(ctx, "FR-16.7 processRecurringPaymentRetries tick complete (job discovery)",
		"due_count", len(due),
		"limit", limit,
	)
	return len(due), nil
}

// RunRecurringPaymentRetryCron starts the FR-16.7 due-scan ticker (discovery).
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
		slog.Info("FR-16.7 job recurring payment retry cron starting (discovery only; charge is gateway)",
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
				slog.Info("FR-16.7 processRecurringPaymentRetries: due rows logged (gateway charges)",
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
