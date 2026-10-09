package client

import (
	"context"
	"fmt"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"

	"github.com/nomarkup/nomarkup/pkg/grpmtls"
	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	paymentv1 "github.com/nomarkup/nomarkup/proto/payment/v1"
)

// PaymentClient is a thin wrapper over PaymentService used by 7-day
// auto-approve to release held services escrow as a System actor.
type PaymentClient struct {
	conn   *grpc.ClientConn
	client paymentv1.PaymentServiceClient
}

// NewPaymentClient dials the payment service at addr (PAYMENT_SERVICE_ADDR).
// The connection is lazy — dialing here does not block on payment being up.
func NewPaymentClient(addr string) (*PaymentClient, error) {
	if addr == "" {
		return nil, fmt.Errorf("payment client: empty address")
	}
	mtlsCfg, err := grpmtls.Load()
	if err != nil {
		return nil, fmt.Errorf("payment client mTLS: %w", err)
	}
	dialOpt, err := mtlsCfg.DialOption()
	if err != nil {
		return nil, fmt.Errorf("payment client credentials: %w", err)
	}
	conn, err := grpc.NewClient(
		addr,
		dialOpt,
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
	)
	if err != nil {
		return nil, fmt.Errorf("payment client dial %q: %w", addr, err)
	}
	return &PaymentClient{
		conn:   conn,
		client: paymentv1.NewPaymentServiceClient(conn),
	}, nil
}

const (
	escrowListPageSize = 100
	maxEscrowListPages = 20
)

// ListEscrowPaymentIDs returns ids of payments in escrow for contractID.
// Payment ListPayments filters by user+status+contract_id in SQL; the
// contract_id equality check below is belt-and-braces. Pages until !HasNext;
// a truncated list is a hard error so auto-approve cannot complete on a
// partial set.
func (c *PaymentClient) ListEscrowPaymentIDs(ctx context.Context, customerID, contractID string) ([]string, error) {
	if c == nil || c.client == nil {
		return nil, fmt.Errorf("payment client unset")
	}
	st := paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW
	cid := contractID
	ids := make([]string, 0)
	for page := int32(1); page <= maxEscrowListPages; page++ {
		resp, err := c.client.ListPayments(ctx, &paymentv1.ListPaymentsRequest{
			UserId:       customerID,
			ContractId:   &cid,
			StatusFilter: &st,
			Pagination: &commonv1.PaginationRequest{
				Page:     page,
				PageSize: escrowListPageSize,
			},
		})
		if err != nil {
			return nil, fmt.Errorf("list escrow payments: %w", err)
		}
		for _, p := range resp.GetPayments() {
			if p == nil || p.GetId() == "" {
				continue
			}
			if contractID != "" && p.GetContractId() != contractID {
				continue
			}
			if p.GetStatus() != paymentv1.PaymentStatus_PAYMENT_STATUS_ESCROW {
				continue
			}
			ids = append(ids, p.GetId())
		}
		if !resp.GetPagination().GetHasNext() {
			return ids, nil
		}
	}
	return nil, fmt.Errorf("list escrow payments: truncated after %d pages", maxEscrowListPages)
}

// ReleaseEscrow releases a held payment as a trusted in-process System actor.
// The provider must never be the actor; System bypasses authorizeRelease's
// party check without impersonating the customer.
func (c *PaymentClient) ReleaseEscrow(ctx context.Context, paymentID, reason string) error {
	if c == nil || c.client == nil {
		return fmt.Errorf("payment client unset")
	}
	_, err := c.client.ReleaseEscrow(ctx, &paymentv1.ReleaseEscrowRequest{
		PaymentId:       paymentID,
		Reason:          reason,
		SystemInitiated: true,
	})
	if err != nil {
		return fmt.Errorf("release escrow %s: %w", paymentID, err)
	}
	return nil
}

// Close releases the underlying connection.
func (c *PaymentClient) Close() error {
	if c == nil || c.conn == nil {
		return nil
	}
	if err := c.conn.Close(); err != nil {
		return fmt.Errorf("payment client close: %w", err)
	}
	return nil
}
