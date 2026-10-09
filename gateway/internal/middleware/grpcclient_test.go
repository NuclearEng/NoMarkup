package middleware

import (
	"context"
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/nomarkup/nomarkup/gateway/internal/observability"
)

// TestGRPCClientInterceptorObservesMetrics is the regression guard for the bug
// this interceptor fixes: grpc_requests_total and grpc_request_duration_seconds
// were registered with no call site, so they exported a flat zero and an
// operator read "no traffic" instead of "no metric".
func TestGRPCClientInterceptorObservesMetrics(t *testing.T) {
	const fullMethod = "/nomarkup.user.v1.UserService/GetUser"

	for _, tc := range []struct {
		name       string
		invokerErr error
		wantStatus string
	}{
		{"successful call", nil, "OK"},
		{"failed call", status.Error(codes.NotFound, "nope"), "NotFound"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			GRPCRequestsTotal.Reset()
			GRPCRequestDuration.Reset()

			invoker := func(_ context.Context, _ string, _, _ any, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
				return tc.invokerErr
			}

			err := GRPCClientInterceptor(context.Background(), fullMethod, nil, nil, nil, invoker)
			if tc.invokerErr == nil && err != nil {
				t.Fatalf("interceptor returned %v, want nil", err)
			}
			if tc.invokerErr != nil && err == nil {
				t.Fatal("interceptor swallowed the invoker error")
			}

			counted := testutil.ToFloat64(
				GRPCRequestsTotal.WithLabelValues("UserService", "GetUser", tc.wantStatus))
			if counted != 1 {
				t.Errorf("grpc_requests_total{service=UserService,method=GetUser,status=%s} = %v, want 1",
					tc.wantStatus, counted)
			}

			if got := testutil.CollectAndCount(GRPCRequestDuration); got == 0 {
				t.Error("grpc_request_duration_seconds recorded no observation")
			}
		})
	}
}

// TestGRPCClientInterceptorForwardsRequestID proves the correlation id reaches
// the backend services as gRPC metadata, which is what lets a service log line
// be tied back to the gateway access log for the same user request.
func TestGRPCClientInterceptorForwardsRequestID(t *testing.T) {
	GRPCRequestsTotal.Reset()
	GRPCRequestDuration.Reset()

	var seen []string
	invoker := func(ctx context.Context, _ string, _, _ any, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
		if md, ok := metadata.FromOutgoingContext(ctx); ok {
			seen = md.Get(observability.MetadataRequestID)
		}
		return nil
	}

	ctx := observability.ContextWithRequestID(context.Background(), "req-abc123")
	if err := GRPCClientInterceptor(ctx, "/nomarkup.job.v1.JobService/GetJob", nil, nil, nil, invoker); err != nil {
		t.Fatalf("interceptor: %v", err)
	}

	if len(seen) != 1 || seen[0] != "req-abc123" {
		t.Errorf("outgoing %s metadata = %v, want [req-abc123]", observability.MetadataRequestID, seen)
	}
}

// TestGRPCClientInterceptorWithoutRequestID checks the interceptor is a no-op
// on correlation when there is nothing to correlate — background jobs and
// startup calls have no inbound request.
func TestGRPCClientInterceptorWithoutRequestID(t *testing.T) {
	GRPCRequestsTotal.Reset()
	GRPCRequestDuration.Reset()

	invoker := func(ctx context.Context, _ string, _, _ any, _ *grpc.ClientConn, _ ...grpc.CallOption) error {
		if md, ok := metadata.FromOutgoingContext(ctx); ok && len(md.Get(observability.MetadataRequestID)) > 0 {
			t.Error("an empty request id was forwarded as metadata")
		}
		return nil
	}

	if err := GRPCClientInterceptor(context.Background(), "/svc/M", nil, nil, nil, invoker); err != nil {
		t.Fatalf("interceptor: %v", err)
	}
}

func TestSplitFullMethod(t *testing.T) {
	for _, tc := range []struct{ in, service, method string }{
		{"/nomarkup.user.v1.UserService/GetUser", "UserService", "GetUser"},
		{"/nomarkup.bid.v1.BiddingService/PlaceBid", "BiddingService", "PlaceBid"},
		{"/Plain/Method", "Plain", "Method"},
		{"malformed", "unknown", "malformed"},
	} {
		t.Run(tc.in, func(t *testing.T) {
			service, method := splitFullMethod(tc.in)
			if service != tc.service || method != tc.method {
				t.Errorf("splitFullMethod(%q) = (%q, %q), want (%q, %q)",
					tc.in, service, method, tc.service, tc.method)
			}
		})
	}
}
