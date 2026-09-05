package client

import (
	"context"
	"fmt"
	"time"

	underwritingv1 "github.com/nomarkup/nomarkup/proto/underwriting/v1"
	"google.golang.org/grpc"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
)

// underwriteCallTimeout bounds a single Underwrite round-trip.
const underwriteCallTimeout = 2 * time.Second

// UnderwritingClient wraps the underwriting engine gRPC client and its
// underlying connection.
type UnderwritingClient struct {
	conn   *grpc.ClientConn
	client underwritingv1.UnderwritingServiceClient
}

// NewUnderwritingClient dials the underwriting engine at addr and returns a wrapper.
func NewUnderwritingClient(addr string) (*UnderwritingClient, error) {
	dialOpt, err := meshDialOption()
	if err != nil {
		return nil, fmt.Errorf("dial underwriting engine credentials: %w", err)
	}
	conn, err := grpc.NewClient(
		addr,
		dialOpt,
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
	)
	if err != nil {
		return nil, fmt.Errorf("dial underwriting engine at %q: %w", addr, err)
	}
	return &UnderwritingClient{
		conn:   conn,
		client: underwritingv1.NewUnderwritingServiceClient(conn),
	}, nil
}

// Underwrite is a thin passthrough to the underwriting engine's Underwrite RPC.
func (c *UnderwritingClient) Underwrite(
	ctx context.Context,
	f *underwritingv1.ProviderFeatures,
) (*underwritingv1.UnderwriteResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, underwriteCallTimeout)
	defer cancel()

	resp, err := c.client.Underwrite(ctx, &underwritingv1.UnderwriteRequest{
		Features: f,
	})
	if err != nil {
		return nil, fmt.Errorf("underwrite: %w", err)
	}
	return resp, nil
}

// Close releases the underlying gRPC connection.
func (c *UnderwritingClient) Close() error {
	if c.conn == nil {
		return nil
	}
	if err := c.conn.Close(); err != nil {
		return fmt.Errorf("close underwriting client conn: %w", err)
	}
	return nil
}
