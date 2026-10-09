package middleware

import (
	"context"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/status"

	"github.com/nomarkup/nomarkup/gateway/internal/observability"
)

// splitFullMethod splits a gRPC "/pkg.Service/Method" string into the service
// and method labels used by GRPCRequestsTotal / GRPCRequestDuration.
//
// The package prefix is dropped so the label reads "UserService" rather than
// "nomarkup.user.v1.UserService" — bounded cardinality, still unambiguous.
func splitFullMethod(fullMethod string) (service, method string) {
	trimmed := strings.TrimPrefix(fullMethod, "/")
	slash := strings.Index(trimmed, "/")
	if slash < 0 {
		return "unknown", trimmed
	}
	service, method = trimmed[:slash], trimmed[slash+1:]
	if dot := strings.LastIndex(service, "."); dot >= 0 {
		service = service[dot+1:]
	}
	if service == "" {
		service = "unknown"
	}
	return service, method
}

// GRPCClientInterceptor is the unary client interceptor wired into every
// outbound gRPC connection from the gateway. It does two things:
//
//  1. Observes GRPCRequestsTotal / GRPCRequestDuration. These metrics were
//     registered but never observed, so they exported a flat zero and an
//     operator reading the dashboard saw "no traffic" rather than "no metric".
//  2. Forwards the request id as x-request-id metadata so the backend service
//     logs the same correlation id as the gateway access log.
//
// Tracing is already handled by otelgrpc.NewClientHandler on each connection;
// this interceptor deliberately does not start a second span.
func GRPCClientInterceptor(
	ctx context.Context,
	fullMethod string,
	req, reply any,
	cc *grpc.ClientConn,
	invoker grpc.UnaryInvoker,
	opts ...grpc.CallOption,
) error {
	ctx = observability.OutgoingContext(ctx)

	start := time.Now()
	err := invoker(ctx, fullMethod, req, reply, cc, opts...)
	elapsed := time.Since(start).Seconds()

	service, method := splitFullMethod(fullMethod)
	GRPCRequestsTotal.WithLabelValues(service, method, status.Code(err).String()).Inc()
	GRPCRequestDuration.WithLabelValues(service, method).Observe(elapsed)

	return err
}

// GRPCStreamClientInterceptor forwards the request id on streaming RPCs.
//
// Stream calls are intentionally left out of the duration histogram: a stream's
// wall-clock lifetime is dominated by how long the client keeps it open, so
// recording it next to unary latencies would corrupt the p99 the SLO reads.
func GRPCStreamClientInterceptor(
	ctx context.Context,
	desc *grpc.StreamDesc,
	cc *grpc.ClientConn,
	fullMethod string,
	streamer grpc.Streamer,
	opts ...grpc.CallOption,
) (grpc.ClientStream, error) {
	return streamer(observability.OutgoingContext(ctx), desc, cc, fullMethod, opts...)
}
