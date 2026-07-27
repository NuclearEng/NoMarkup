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
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
)

// contractCallTimeout bounds GetRecurringConfig + PauseRecurring.
// Match other mesh clients: fail-soft callers must not stall Stripe webhooks.
const contractCallTimeout = 2 * time.Second

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

	ctx, cancel := context.WithTimeout(ctx, contractCallTimeout)
	defer cancel()

	cfgResp, err := c.client.GetRecurringConfig(ctx, &contractv1.GetRecurringConfigRequest{
		ContractId: contractID,
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
		// Idempotent: FR-18.8 intent already satisfied.
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
	return nil
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
