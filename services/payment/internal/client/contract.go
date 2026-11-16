// Package client — contract (job service) client for FR-16.7 / FR-18.8
// recurring payment failure handling.
package client

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	notificationv1 "github.com/nomarkup/nomarkup/proto/notification/v1"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
)

// contractCallTimeout bounds GetRecurringConfig + PauseRecurring.
// Match other mesh clients: fail-soft callers must not stall Stripe webhooks.
// Notifications use a separate parent context + notifyCallTimeout so a near-
// expiry contract deadline never drops dual-party FR-18.8 alerts.
const contractCallTimeout = 2 * time.Second

// RecurringPauseNotifier is the narrow surface ContractClient needs to alert
// both parties after FR-18.8 pause-at-threshold. *NotificationClient satisfies
// it; tests substitute a recorder. Optional — nil logs residual and continues.
type RecurringPauseNotifier interface {
	Send(ctx context.Context, userID string, notificationType notificationv1.NotificationType,
		title, body, actionURL string, data map[string]string) error
}

// ContractClient wraps the job service's ContractService gRPC surface used by
// the payment service for FR-16.7 (3-strike retry) + FR-18.8 (pause at
// threshold after charge failure). Strike counters live on recurring_configs
// (shared Postgres); pause is still a job-service RPC (ownership checks).
type ContractClient struct {
	conn   *grpc.ClientConn
	client contractv1.ContractServiceClient
	// db is the shared Postgres pool for payment_retry_count / next_retry_at
	// (migrations 112/113). Same SQL as gateway CreatePayment setup-fail path.
	db *pgxpool.Pool
	// incrPaymentRetryFn overrides SQL for unit tests (nil in production).
	incrPaymentRetryFn func(ctx context.Context, recurringID string) (int, *time.Time, error)
	// notify delivers FR-16.7 dual-party in-app (and preference-driven email)
	// alerts after pause. Optional: nil → residual log only; never blocks pause.
	notify RecurringPauseNotifier
}

// SetNotifier wires fail-soft dual-party notifications on FR-18.8 pause.
// Safe to leave unset (tests / notification mesh down): pause still succeeds.
func (c *ContractClient) SetNotifier(n RecurringPauseNotifier) {
	if c == nil {
		return
	}
	c.notify = n
}

// NewContractClient dials the job service at addr (ContractService lives there).
// db may be nil only in tests that inject incrPaymentRetryFn; production must
// pass the payment service's pool so strikes are durable. Without a durable
// counter we never pause (matches gateway: no inventing pause without count).
func NewContractClient(addr string, db *pgxpool.Pool) (*ContractClient, error) {
	if addr == "" {
		return nil, fmt.Errorf("job/contract service address is empty")
	}
	dialOpt, err := meshDialOption()
	if err != nil {
		return nil, fmt.Errorf("dial job service credentials: %w", err)
	}
	conn, err := grpc.NewClient(
		addr,
		dialOpt,
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
	)
	if err != nil {
		return nil, fmt.Errorf("dial job service at %q: %w", addr, err)
	}
	return &ContractClient{
		conn:   conn,
		client: contractv1.NewContractServiceClient(conn),
		db:     db,
	}, nil
}

// PauseOnPaymentFailed implements service.RecurringPaymentFailureHandler.
//
// FR-16.7 + FR-18.8 for payment_intent.payment_failed on a recurring visit:
//  1. Look up the contract's recurring config.
//  2. Already-paused → success no-op. Non-active (cancelled/etc.) → leave alone.
//  3. Active → increment payment_retry_count + set next_retry_at when count < 3.
//  4. PauseRecurring only when count >= 3. Never cancel the contract.
//  5. On actual pause: fail-soft dual-party notification (customer + provider).
//
// customerID is payments.customer_id and must be a contract party so
// PauseRecurring's ownership check succeeds.
//
// If the strike counter cannot be written (nil db / SQL error), returns an
// error and does NOT pause — pausing without a durable count would re-introduce
// immediate-pause-on-first-fail.
func (c *ContractClient) PauseOnPaymentFailed(
	ctx context.Context,
	contractID, customerID, recurringInstanceID, paymentID string,
) error {
	if contractID == "" {
		return fmt.Errorf("pause on payment failed: contract_id is required")
	}
	if customerID == "" {
		return fmt.Errorf("pause on payment failed: customer_id is required")
	}

	// Parent context for post-pause notify (own timeout); contract RPCs use a
	// short deadline so a slow job mesh never stalls the Stripe webhook ack.
	parentCtx := ctx
	ctx, cancel := context.WithTimeout(ctx, contractCallTimeout)
	defer cancel()

	cfgResp, err := c.client.GetRecurringConfig(ctx, &contractv1.GetRecurringConfigRequest{
		ContractId:       contractID,
		RequestingUserId: customerID,
	})
	if err != nil {
		return fmt.Errorf("get recurring config for contract %s: %w", contractID, err)
	}
	cfg := cfgResp.GetConfig()
	if cfg == nil || cfg.GetId() == "" {
		return fmt.Errorf("get recurring config for contract %s: empty config", contractID)
	}

	status := cfg.GetStatus()
	switch status {
	case "paused":
		// Idempotent: FR-18.8 intent already satisfied. Do not re-notify.
		slog.InfoContext(ctx, "FR-18.8: recurring already paused on payment_failed",
			"contract_id", contractID,
			"recurring_id", cfg.GetId(),
			"recurring_instance_id", recurringInstanceID,
			"payment_id", paymentID,
		)
		return nil
	case "active":
		// proceed to 3-strike
	default:
		// cancelled / other — leave alone; never cancel from payment path.
		slog.InfoContext(ctx, "FR-18.8: skip on payment_failed — config not active (contract not cancelled)",
			"contract_id", contractID,
			"recurring_id", cfg.GetId(),
			"status", status,
			"recurring_instance_id", recurringInstanceID,
			"payment_id", paymentID,
		)
		return nil
	}

	// FR-16.7: durable strike count + next_retry_at before any pause decision.
	count, nextRetryAt, incrErr := c.incrementPaymentRetry(ctx, cfg.GetId())
	if incrErr != nil {
		// No durable count → do not invent a pause (gateway setup-fail parity).
		return fmt.Errorf("increment payment_retry_count for recurring %s: %w", cfg.GetId(), incrErr)
	}

	if count < recurringPaymentRetryPauseThreshold {
		logAttrs := []any{
			"contract_id", contractID,
			"recurring_id", cfg.GetId(),
			"recurring_instance_id", recurringInstanceID,
			"payment_id", paymentID,
			"payment_retry_count", count,
			"threshold", recurringPaymentRetryPauseThreshold,
		}
		if nextRetryAt != nil {
			logAttrs = append(logAttrs, "next_retry_at", nextRetryAt.UTC().Format(time.RFC3339))
		}
		slog.InfoContext(ctx, "FR-16.7: payment_intent.payment_failed counted; schedule still active; next_retry_at stored",
			logAttrs...,
		)
		return nil
	}

	// Threshold reached — FR-18.8 pause (never cancel contract).
	if _, err := c.client.PauseRecurring(ctx, &contractv1.PauseRecurringRequest{
		RecurringId: cfg.GetId(),
		UserId:      customerID,
	}); err != nil {
		return fmt.Errorf("pause recurring %s for contract %s after %d failures: %w",
			cfg.GetId(), contractID, count, err)
	}
	slog.InfoContext(ctx, "FR-16.7/FR-18.8: recurring paused after payment_failed reached retry threshold (contract not cancelled)",
		"contract_id", contractID,
		"recurring_id", cfg.GetId(),
		"recurring_instance_id", recurringInstanceID,
		"payment_id", paymentID,
		"customer_id", customerID,
		"payment_retry_count", count,
	)

	// FR-16.7: both parties notified. Never fail the pause path on notify.
	c.notifyRecurringPausedForPaymentFailure(parentCtx, contractID, customerID, cfg.GetId(), paymentID)
	return nil
}

// notifyRecurringPausedForPaymentFailure sends payment_failed notifications to
// customer and provider after a successful FR-18.8 pause. Fully fail-soft:
// missing notifier, GetContract blip, or Send errors are residual logs only.
func (c *ContractClient) notifyRecurringPausedForPaymentFailure(
	ctx context.Context,
	contractID, customerID, recurringID, paymentID string,
) {
	if c.notify == nil {
		slog.WarnContext(ctx, "FR-16.7/FR-18.8 residual: recurring paused but notification client unwired",
			"contract_id", contractID,
			"recurring_id", recurringID,
			"payment_id", paymentID,
			"customer_id", customerID,
		)
		return
	}

	providerID := c.resolveContractProviderID(ctx, contractID, customerID)
	actionURL := "/contracts/" + contractID
	data := map[string]string{
		"contract_id":  contractID,
		"recurring_id": recurringID,
		"payment_id":   paymentID,
		"reason":       "payment_retry_threshold",
	}

	if customerID != "" {
		if err := c.notify.Send(ctx, customerID,
			notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_FAILED,
			"Recurring payments paused",
			"We couldn't charge your payment method after several tries. Recurring visits are paused until you update your payment method.",
			actionURL,
			data,
		); err != nil {
			slog.WarnContext(ctx, "FR-16.7/FR-18.8 residual: customer pause notification failed (pause kept)",
				"contract_id", contractID,
				"customer_id", customerID,
				"error", err,
			)
		}
	}

	if providerID == "" {
		slog.WarnContext(ctx, "FR-16.7/FR-18.8 residual: recurring paused; provider not notified (provider_id unresolved)",
			"contract_id", contractID,
			"recurring_id", recurringID,
			"customer_id", customerID,
		)
		return
	}
	if providerID == customerID {
		return
	}
	if err := c.notify.Send(ctx, providerID,
		notificationv1.NotificationType_NOTIFICATION_TYPE_PAYMENT_FAILED,
		"Recurring schedule paused",
		"The customer's payment could not be collected after several tries. Recurring visits are paused until payment is updated.",
		actionURL,
		data,
	); err != nil {
		slog.WarnContext(ctx, "FR-16.7/FR-18.8 residual: provider pause notification failed (pause kept)",
			"contract_id", contractID,
			"provider_id", providerID,
			"error", err,
		)
	}
}

// resolveContractProviderID loads provider_id via GetContract. Empty
// RequestingUserId skips party check (mesh internal — see job GetContract).
func (c *ContractClient) resolveContractProviderID(ctx context.Context, contractID, customerID string) string {
	if c.client == nil || contractID == "" {
		return ""
	}
	// Prefer customer as requesting party when known; empty still works mesh-side.
	req := &contractv1.GetContractRequest{
		ContractId:       contractID,
		RequestingUserId: customerID,
	}
	// Short bound so notify path cannot stall the webhook handler long after pause.
	nctx, cancel := context.WithTimeout(ctx, contractCallTimeout)
	defer cancel()
	resp, err := c.client.GetContract(nctx, req)
	if err != nil {
		slog.WarnContext(ctx, "FR-18.8: GetContract for provider notify failed",
			"contract_id", contractID,
			"error", err,
		)
		return ""
	}
	if ct := resp.GetContract(); ct != nil {
		return ct.GetProviderId()
	}
	return ""
}

func (c *ContractClient) incrementPaymentRetry(ctx context.Context, recurringID string) (int, *time.Time, error) {
	if c.incrPaymentRetryFn != nil {
		return c.incrPaymentRetryFn(ctx, recurringID)
	}
	return incrRecurringPaymentRetryCount(ctx, c.db, recurringID)
}

// Close releases the underlying gRPC connection.
func (c *ContractClient) Close() error {
	if c.conn == nil {
		return nil
	}
	if err := c.conn.Close(); err != nil {
		return fmt.Errorf("close contract client conn: %w", err)
	}
	return nil
}
