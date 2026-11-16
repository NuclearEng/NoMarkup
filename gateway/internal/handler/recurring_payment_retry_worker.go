package handler

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

// dueRecurringRetry is one active recurring_configs row due for FR-16.7 charge retry.
type dueRecurringRetry struct {
	ID                string
	ContractID        string
	PaymentRetryCount int
}

// unpaidApprovedVisit is the latest approved completed instance that still
// needs a successful payment (no escrow/released/completed/processing row).
type unpaidApprovedVisit struct {
	InstanceID  string
	ContractID  string
	CustomerID  string
	AmountCents int64
}

// ProcessDueRecurringPaymentRetries is the FR-16.7 gateway cron entrypoint.
// Scans recurring_configs where next_retry_at <= now, claims each row (lease),
// finds the latest approved completed instance without a funded payment, and
// calls payment CreatePayment with sticky key
//   recurring-instance-pay:{instanceID}:attempt-{count+1}
// so off-session confirm uses a fresh Stripe attempt key.
//
// On CreatePayment success: clears payment_retry_count + next_retry_at.
// On failure: increments strike (may pause at threshold). Never cancels the
// contract. Fail-soft: per-row errors are logged; a tick never panics.
//
// Returns (claimed, succeeded, failed) counts. Requires h.db + h.paymentClient.
func (h *ContractHandler) ProcessDueRecurringPaymentRetries(ctx context.Context, limit int) (claimed, succeeded, failed int, err error) {
	if h == nil {
		return 0, 0, 0, fmt.Errorf("recurring payment retry: handler nil")
	}
	// Production needs a live pool; unit tests inject claimDueRecurringRetriesFn.
	if h.db == nil && h.claimDueRecurringRetriesFn == nil {
		return 0, 0, 0, fmt.Errorf("recurring payment retry: database pool unwired")
	}
	if h.paymentClient == nil {
		return 0, 0, 0, fmt.Errorf("recurring payment retry: payment client unwired")
	}
	if limit <= 0 {
		limit = 100
	}

	due, err := h.claimDueRecurringRetries(ctx, limit)
	if err != nil {
		return 0, 0, 0, err
	}
	claimed = len(due)
	if claimed == 0 {
		return 0, 0, 0, nil
	}

	for _, row := range due {
		ok, rowErr := h.retryOneRecurringPayment(ctx, row)
		if rowErr != nil {
			// Infra / lookup error before CreatePayment — do NOT burn a strike
			// (lease already pushed next_retry_at; will re-enter after 30m).
			failed++
			slog.WarnContext(ctx, "FR-16.7: scheduled payment retry row skipped (infra; contract not cancelled; no strike)",
				"recurring_id", row.ID,
				"contract_id", row.ContractID,
				"payment_retry_count", row.PaymentRetryCount,
				"error", rowErr,
			)
			continue
		}
		if ok {
			succeeded++
		} else {
			failed++
		}
	}

	slog.InfoContext(ctx, "FR-16.7 processDueRecurringPaymentRetries tick complete",
		"claimed", claimed,
		"succeeded", succeeded,
		"failed", failed,
		"limit", limit,
	)
	return claimed, succeeded, failed, nil
}

// claimDueRecurringRetries selects and leases due rows (SKIP LOCKED) so multi-
// replica gateways do not double-CreatePayment. Lease pushes next_retry_at by
// 30m; success reset clears it, failure increment stamps day-3/day-7.
func (h *ContractHandler) claimDueRecurringRetries(ctx context.Context, limit int) ([]dueRecurringRetry, error) {
	if h.claimDueRecurringRetriesFn != nil {
		return h.claimDueRecurringRetriesFn(ctx, limit)
	}

	rows, err := h.db.Query(ctx, `
		WITH due AS (
			SELECT id
			  FROM recurring_configs
			 WHERE status = 'active'
			   AND next_retry_at IS NOT NULL
			   AND next_retry_at <= now()
			   AND payment_retry_count > 0
			   AND payment_retry_count < $2
			 ORDER BY next_retry_at ASC
			 LIMIT $1
			 FOR UPDATE SKIP LOCKED
		)
		UPDATE recurring_configs rc
		   SET next_retry_at = now() + interval '30 minutes',
		       updated_at = now()
		  FROM due
		 WHERE rc.id = due.id
		 RETURNING rc.id::text, rc.contract_id::text, rc.payment_retry_count`,
		limit, recurringPaymentRetryPauseThreshold)
	if err != nil {
		return nil, fmt.Errorf("recurring payment retry claim: %w", err)
	}
	defer rows.Close()

	var out []dueRecurringRetry
	for rows.Next() {
		var r dueRecurringRetry
		if scanErr := rows.Scan(&r.ID, &r.ContractID, &r.PaymentRetryCount); scanErr != nil {
			return out, fmt.Errorf("recurring payment retry claim row: %w", scanErr)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return out, fmt.Errorf("recurring payment retry claim iterate: %w", err)
	}
	return out, nil
}

// findUnpaidApprovedVisit loads the newest completed+approved instance for a
// recurring config that is not already funded in payments.
func (h *ContractHandler) findUnpaidApprovedVisit(ctx context.Context, recurringID string) (*unpaidApprovedVisit, error) {
	if h.findUnpaidApprovedVisitFn != nil {
		return h.findUnpaidApprovedVisitFn(ctx, recurringID)
	}
	if h.db == nil {
		return nil, fmt.Errorf("find unpaid visit: database pool unwired")
	}

	var v unpaidApprovedVisit
	err := h.db.QueryRow(ctx, `
		SELECT ri.id::text,
		       ri.contract_id::text,
		       c.customer_id::text,
		       ri.amount_cents
		  FROM recurring_instances ri
		  JOIN contracts c ON c.id = ri.contract_id
		 WHERE ri.recurring_id = $1
		   AND ri.status = 'completed'
		   AND ri.approved_at IS NOT NULL
		   AND ri.amount_cents > 0
		   AND NOT EXISTS (
		         SELECT 1
		           FROM payments p
		          WHERE p.recurring_instance_id = ri.id
		            AND p.status IN ('escrow', 'released', 'completed', 'processing')
		       )
		 ORDER BY ri.occurrence_date DESC, ri.created_at DESC
		 LIMIT 1`, recurringID).Scan(&v.InstanceID, &v.ContractID, &v.CustomerID, &v.AmountCents)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("find unpaid approved visit: %w", err)
	}
	return &v, nil
}

// retryOneRecurringPayment runs CreatePayment for one claimed due config.
// Returns (true, nil) on setup/charge success (reset counters).
// Returns (false, nil) when CreatePayment failed but strike was recorded.
// Returns (_, err) for infra/lookup errors before CreatePayment.
func (h *ContractHandler) retryOneRecurringPayment(ctx context.Context, row dueRecurringRetry) (bool, error) {
	visit, err := h.findUnpaidApprovedVisit(ctx, row.ID)
	if err != nil {
		return false, err
	}
	if visit == nil {
		// Nothing to charge — clear stale schedule so we do not spin forever.
		// Fail-soft: config may have been paid manually or all instances funded.
		if resetErr := h.resetPaymentRetry(ctx, row.ID); resetErr != nil {
			slog.WarnContext(ctx, "FR-16.7: no unpaid visit but retry counter reset failed",
				"recurring_id", row.ID,
				"error", resetErr,
			)
		} else {
			slog.InfoContext(ctx, "FR-16.7: due retry cleared — no unpaid approved visit",
				"recurring_id", row.ID,
				"contract_id", row.ContractID,
			)
		}
		return true, nil
	}

	// Next attempt number = current strike count + 1 (count is failures so far).
	attempt := row.PaymentRetryCount + 1
	if attempt < 2 {
		attempt = 2 // day-0 already used attempt-1 / bare sticky key
	}
	idemKey := fmt.Sprintf("recurring-instance-pay:%s:attempt-%d", visit.InstanceID, attempt)

	createReq := &paymentv1.CreatePaymentRequest{
		ContractId:          visit.ContractID,
		RecurringInstanceId: visit.InstanceID,
		CustomerId:          visit.CustomerID,
		AmountCents:         visit.AmountCents,
		IdempotencyKey:      idemKey,
	}

	slog.InfoContext(ctx, "FR-16.7: scheduled CreatePayment retry",
		"recurring_id", row.ID,
		"contract_id", visit.ContractID,
		"instance_id", visit.InstanceID,
		"customer_id", visit.CustomerID,
		"amount_cents", visit.AmountCents,
		"payment_retry_count", row.PaymentRetryCount,
		"attempt", attempt,
		"idempotency_key", idemKey,
	)

	payResp, payErr := h.paymentClient.CreatePayment(ctx, createReq)
	if payErr != nil {
		// Soft-replay once (mesh blip after insert).
		if replay, replayErr := h.paymentClient.CreatePayment(ctx, createReq); replayErr == nil {
			payResp, payErr = replay, nil
		}
	}
	if payErr != nil {
		// Funded visit may already exist under another path.
		if existing := h.findPaymentByRecurringInstance(ctx, visit.CustomerID, visit.InstanceID); existing != nil && recurringPaymentIsFunded(existing) {
			if resetErr := h.resetPaymentRetry(ctx, row.ID); resetErr != nil {
				slog.WarnContext(ctx, "FR-16.7: funded visit found but retry reset failed",
					"recurring_id", row.ID,
					"instance_id", visit.InstanceID,
					"payment_id", existing.GetId(),
					"error", resetErr,
				)
			}
			return true, nil
		}
		h.recordScheduledRetryFailure(ctx, row, visit.InstanceID)
		return false, nil
	}

	// Success: PI setup and/or off-session fund. Clear strikes (same as approve).
	if resetErr := h.resetPaymentRetry(ctx, row.ID); resetErr != nil {
		slog.WarnContext(ctx, "FR-16.7: CreatePayment retry succeeded but counter reset failed (PI kept)",
			"recurring_id", row.ID,
			"instance_id", visit.InstanceID,
			"error", resetErr,
		)
	}

	funded := false
	if p := payResp.GetPayment(); p != nil {
		funded = recurringPaymentIsFunded(p)
	}
	slog.InfoContext(ctx, "FR-16.7: scheduled CreatePayment retry succeeded",
		"recurring_id", row.ID,
		"instance_id", visit.InstanceID,
		"payment_id", payResp.GetPayment().GetId(),
		"off_session_funded", funded,
		"has_client_secret", payResp.GetClientSecret() != "",
	)
	return true, nil
}

// recordScheduledRetryFailure increments payment_retry_count and pauses at
// threshold. Never cancels the contract. Uses SQL helpers (+ PauseRecurring).
func (h *ContractHandler) recordScheduledRetryFailure(ctx context.Context, row dueRecurringRetry, instanceID string) {
	// Reuse the approve-path strike logic without a response map when possible.
	result := map[string]interface{}{}
	customerID := ""
	// Resolve customer for PauseRecurring ownership (job service requires user_id).
	if visit, err := h.findUnpaidApprovedVisit(ctx, row.ID); err == nil && visit != nil {
		customerID = visit.CustomerID
		if instanceID == "" {
			instanceID = visit.InstanceID
		}
	}
	if customerID == "" && h.contractClient != nil {
		// Fallback: GetContract for customer_id.
		// Inline to avoid import cycle / heavy deps — use SQL when available.
		if h.db != nil {
			_ = h.db.QueryRow(ctx,
				`SELECT customer_id::text FROM contracts WHERE id = $1`, row.ContractID,
			).Scan(&customerID)
		}
	}
	if customerID == "" {
		// Still increment the durable counter without pause ownership.
		count, next, incrErr := h.incrementPaymentRetry(ctx, row.ID)
		if incrErr != nil {
			slog.WarnContext(ctx, "FR-16.7: scheduled retry strike untracked (no customer; contract not cancelled)",
				"recurring_id", row.ID,
				"error", incrErr,
			)
			return
		}
		slog.InfoContext(ctx, "FR-16.7: scheduled retry strike recorded without pause path (no customer id)",
			"recurring_id", row.ID,
			"payment_retry_count", count,
			"next_retry_at", next,
		)
		return
	}
	h.recordRecurringPaymentSetupFailure(ctx, result, row.ContractID, instanceID, customerID, "scheduled_retry")
}

// RunRecurringPaymentRetryCron starts the gateway FR-16.7 charge ticker.
// Interval defaults to 1 hour (retries are day-scale). Stops on ctx cancel.
func RunRecurringPaymentRetryCron(ctx context.Context, h *ContractHandler, interval, initialDelay time.Duration, batchLimit int) {
	if h == nil || h.db == nil || h.paymentClient == nil {
		slog.Info("FR-16.7 gateway recurring payment retry cron disabled (db or payment client unwired)")
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
		slog.Info("FR-16.7 gateway recurring payment retry cron starting (CreatePayment + off-session attempt-N)",
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
			claimed, succeeded, failed, err := h.ProcessDueRecurringPaymentRetries(runCtx, batchLimit)
			if err != nil {
				slog.Error("FR-16.7 processDueRecurringPaymentRetries: tick failed", "error", err)
				return
			}
			if claimed > 0 {
				slog.Info("FR-16.7 processDueRecurringPaymentRetries: tick summary",
					"claimed", claimed,
					"succeeded", succeeded,
					"failed", failed,
				)
			}
		}
		runOnce()

		for {
			select {
			case <-t.C:
				runOnce()
			case <-ctx.Done():
				slog.Info("FR-16.7 gateway recurring payment retry cron stopping")
				return
			}
		}
	}()
}

// Env helpers for main — keep small and local to avoid config package churn.
func RecurringPaymentRetryIntervalFromEnv() time.Duration {
	return envDuration("RECURRING_PAYMENT_RETRY_INTERVAL", time.Hour)
}

func RecurringPaymentRetryInitialDelayFromEnv() time.Duration {
	return envDuration("RECURRING_PAYMENT_RETRY_INITIAL_DELAY", 60*time.Second)
}

func RecurringPaymentRetryBatchFromEnv() int {
	return envInt("RECURRING_PAYMENT_RETRY_BATCH", 100)
}

func envDuration(key string, def time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return def
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return def
	}
	return d
}

func envInt(key string, def int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return def
	}
	return n
}
