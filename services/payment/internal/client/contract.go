// Package client — contract (job service) client for FR-18.8 pause-on-fail.
package client

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	contractv1 "github.com/nomarkup/nomarkup/proto/contract/v1"
	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
)

// contractCallTimeout bounds GetRecurringConfig + PauseRecurring.
// Match other mesh clients: fail-soft callers must not stall Stripe webhooks.
const contractCallTimeout = 2 * time.Second

// ContractClient wraps the job service's ContractService gRPC surface used by
// the payment service for FR-18.8 (pause recurrence after charge failure).
type ContractClient struct {
	conn   *grpc.ClientConn
	client contractv1.ContractServiceClient
}

// NewContractClient dials the job service at addr (ContractService lives there).
func NewContractClient(addr string) (*ContractClient, error) {
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
	}, nil
}

// PauseOnPaymentFailed implements service.RecurringPaymentFailureHandler.
//
// Looks up the recurring config for contractID and pauses it when active.
// Already-paused configs are a success no-op. Non-active statuses (cancelled,
// etc.) are left alone — never cancel the contract from this path.
// customerID is the payments.customer_id and must be a contract party so
// PauseRecurring's ownership check succeeds.
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
		// proceed to pause
	default:
		// cancelled / other — leave alone; never cancel from payment path.
		slog.InfoContext(ctx, "FR-18.8: skip pause on payment_failed — config not active",
			"contract_id", contractID,
			"recurring_id", cfg.GetId(),
			"status", status,
			"recurring_instance_id", recurringInstanceID,
			"payment_id", paymentID,
		)
		return nil
	}

	if _, err := c.client.PauseRecurring(ctx, &contractv1.PauseRecurringRequest{
		RecurringId: cfg.GetId(),
		UserId:      customerID,
	}); err != nil {
		return fmt.Errorf("pause recurring %s for contract %s: %w", cfg.GetId(), contractID, err)
	}
	return nil
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
