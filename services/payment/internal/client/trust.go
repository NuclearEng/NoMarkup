// Package client holds gRPC client wrappers the payment service uses to call
// other engines (trust, underwriting).
package client

import (
	"context"
	"fmt"
	"time"

	commonv1 "github.com/nomarkup/nomarkup/proto/common/v1"
	trustv1 "github.com/nomarkup/nomarkup/proto/trust/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"go.opentelemetry.io/contrib/instrumentation/google.golang.org/grpc/otelgrpc"
)

// trustCallTimeout bounds a single GetTrustScore round-trip.
const trustCallTimeout = 2 * time.Second

// TrustClient wraps the trust engine gRPC client and its underlying connection.
type TrustClient struct {
	conn   *grpc.ClientConn
	client trustv1.TrustServiceClient
}

// NewTrustClient dials the trust engine at addr and returns a wrapper.
func NewTrustClient(addr string) (*TrustClient, error) {
	conn, err := grpc.NewClient(
		addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithStatsHandler(otelgrpc.NewClientHandler()),
	)
	if err != nil {
		return nil, fmt.Errorf("dial trust engine at %q: %w", addr, err)
	}
	return &TrustClient{
		conn:   conn,
		client: trustv1.NewTrustServiceClient(conn),
	}, nil
}

// GetProviderTrust fetches the trust score for a provider and returns the
// dimensions the underwriting engine consumes, with the tier mapped to the
// lowercase string vocabulary the underwriting engine expects.
//
// Fail-closed semantics are the caller's responsibility: this method simply
// returns the error from the trust engine.
func (c *TrustClient) GetProviderTrust(
	ctx context.Context,
	providerID string,
) (overall, feedback, fraud float64, tier string, err error) {
	ctx, cancel := context.WithTimeout(ctx, trustCallTimeout)
	defer cancel()

	resp, err := c.client.GetTrustScore(ctx, &trustv1.GetTrustScoreRequest{
		UserId: providerID,
	})
	if err != nil {
		return 0, 0, 0, "", fmt.Errorf("get trust score for provider %q: %w", providerID, err)
	}

	score := resp.GetScore()
	if score == nil {
		return 0, 0, 0, "", fmt.Errorf("get trust score for provider %q: empty score in response", providerID)
	}

	return normalizeTrustScore(score.GetOverallScore()),
		normalizeTrustScore(score.GetFeedbackScore()),
		normalizeTrustScore(score.GetFraudScore()),
		mapTrustTier(score.GetTier()),
		nil
}

// normalizeTrustScore coerces a trust dimension to the engine's 0..1 contract.
// The trust engine computes scores in 0..1, but legacy/seed rows can carry a
// 0..100 value; a value > 1.0 can only be that 0..100 scale, so recover it by
// /100 rather than letting the underwriting engine clamp it to a
// non-discriminating 1.0 (which would silently neutralize the trust dimension).
// Anything still out of range is clamped to [0, 1].
func normalizeTrustScore(v float64) float64 {
	if v > 1.0 {
		v /= 100.0
	}
	if v < 0 {
		return 0
	}
	if v > 1.0 {
		return 1.0
	}
	return v
}

// mapTrustTier converts a common.v1.TrustTier enum to the lowercase string the
// underwriting engine expects: new|rising|trusted|top_rated|under_review.
// Unspecified falls back to "new".
func mapTrustTier(t commonv1.TrustTier) string {
	switch t {
	case commonv1.TrustTier_TRUST_TIER_UNDER_REVIEW:
		return "under_review"
	case commonv1.TrustTier_TRUST_TIER_NEW:
		return "new"
	case commonv1.TrustTier_TRUST_TIER_RISING:
		return "rising"
	case commonv1.TrustTier_TRUST_TIER_TRUSTED:
		return "trusted"
	case commonv1.TrustTier_TRUST_TIER_TOP_RATED:
		return "top_rated"
	case commonv1.TrustTier_TRUST_TIER_UNSPECIFIED:
		return "new"
	default:
		return "new"
	}
}

// Close releases the underlying gRPC connection.
func (c *TrustClient) Close() error {
	if c.conn == nil {
		return nil
	}
	if err := c.conn.Close(); err != nil {
		return fmt.Errorf("close trust client conn: %w", err)
	}
	return nil
}
