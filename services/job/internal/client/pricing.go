// Package client holds outbound gRPC clients the job service dials, such as the
// Rust Fair-Price engine.
package client

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	pricingv1 "github.com/nomarkup/nomarkup/proto/pricing/v1"
)

// pricingCallTimeout bounds a single ComputeFairPrice call. The engine is a
// pure, sub-ms function; 2s is generous headroom that still fails fast so the
// caller can fall soft instead of hanging a request.
const pricingCallTimeout = 2 * time.Second

// PricingClient is a thin wrapper over the generated PricingService client.
type PricingClient struct {
	conn   *grpc.ClientConn
	client pricingv1.PricingServiceClient
}

// NewPricingClient dials the Rust pricing engine at addr (e.g.
// PRICING_ENGINE_ADDR, dev localhost:50061). The connection is lazy — dialing
// here does not block on the engine being up — so a down engine surfaces as a
// per-call error the caller can fall soft on, not a startup failure.
func NewPricingClient(addr string) (*PricingClient, error) {
	if addr == "" {
		return nil, fmt.Errorf("pricing client: empty address")
	}
	conn, err := grpc.NewClient(
		addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
	)
	if err != nil {
		return nil, fmt.Errorf("pricing client dial %q: %w", addr, err)
	}
	return &PricingClient{
		conn:   conn,
		client: pricingv1.NewPricingServiceClient(conn),
	}, nil
}

// ComputeFairPrice calls the engine's single RPC under a bounded timeout. The
// engine is a pure function; the caller pre-selects the candidate transaction
// set and reads the estimate from the response.
func (c *PricingClient) ComputeFairPrice(ctx context.Context, req *pricingv1.ComputeFairPriceRequest) (*pricingv1.ComputeFairPriceResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, pricingCallTimeout)
	defer cancel()

	resp, err := c.client.ComputeFairPrice(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("compute fair price: %w", err)
	}
	return resp, nil
}

// Close releases the underlying connection.
func (c *PricingClient) Close() error {
	if c.conn == nil {
		return nil
	}
	if err := c.conn.Close(); err != nil {
		return fmt.Errorf("pricing client close: %w", err)
	}
	return nil
}
