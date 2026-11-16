package main

import (
	"context"
	"log/slog"
	"runtime/debug"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/status"
)

// --- Panic recovery (RES-03) ---
//
// grpc-go does NOT recover panics raised inside a handler: the panic unwinds
// through the transport goroutine and takes the whole process down. One
// nil-map write or out-of-range index in any handler therefore kills the pod
// and every other in-flight RPC on it, and under Kubernetes a deterministic
// panic (a poison request retried by a client) becomes a CrashLoopBackOff.
//
// The gateway HTTP tier is already protected by middleware.Recovery and the
// Rust engines each have a catch_unwind boundary. These interceptors close the
// same hole for the Go gRPC tier.

// recoveryUnaryInterceptor converts a handler panic into codes.Internal.
//
// The panic value and stack go to the log (where request_id / trace_id are
// already stamped by the RequestID interceptor that runs outside this one) and
// NEVER to the client: a panic message routinely contains struct contents,
// SQL fragments or Stripe identifiers.
func recoveryUnaryInterceptor(
	ctx context.Context,
	req any,
	info *grpc.UnaryServerInfo,
	handler grpc.UnaryHandler,
) (resp any, err error) {
	defer func() {
		if r := recover(); r != nil {
			logPanic(ctx, info.FullMethod, r)
			resp = nil
			err = status.Error(codes.Internal, "internal error")
		}
	}()

	return handler(ctx, req)
}

// recoveryStreamInterceptor is the streaming counterpart. There are no
// streaming RPCs in the current protos, but the interceptor is registered so a
// future one is protected by default rather than by remembering to add it.
func recoveryStreamInterceptor(
	srv any,
	ss grpc.ServerStream,
	info *grpc.StreamServerInfo,
	handler grpc.StreamHandler,
) (err error) {
	defer func() {
		if r := recover(); r != nil {
			logPanic(ss.Context(), info.FullMethod, r)
			err = status.Error(codes.Internal, "internal error")
		}
	}()

	return handler(srv, ss)
}

// logPanic emits the structured record an operator needs to find the crash:
// which RPC, what the panic value was, and the stack that produced it.
func logPanic(ctx context.Context, fullMethod string, recovered any) {
	slog.ErrorContext(ctx, "panic recovered in grpc handler",
		"method", fullMethod,
		"panic", recovered,
		"stack", string(debug.Stack()),
	)
}

// --- Keepalive (RES-01) ---
//
// The gateway dials every backend with keepalive pings every 30s and
// PermitWithoutStream, so a black-holed connection surfaces in ~40s instead of
// hanging on the ~15-minute Linux TCP timeout.
//
// grpc-go's DEFAULT server EnforcementPolicy is MinTime 5 minutes /
// PermitWithoutStream false: a client pinging every 30s accumulates ping
// strikes and gets dropped with GOAWAY "too_many_pings" after two of them. The
// enforcement floor below must therefore stay under the client's ping interval
// (gateway/internal/middleware/grpcdial.go: grpcClientKeepaliveTime = 30s), or
// enabling client keepalive would make connections WORSE, not better.
const (
	// serverMinKeepaliveTime mirrors middleware.GRPCServerMinKeepaliveTime.
	serverMinKeepaliveTime = 10 * time.Second
	// serverKeepaliveTime is how often the server probes an idle client, so a
	// half-open connection from a dead gateway pod is reaped rather than
	// counted against the connection limit forever.
	serverKeepaliveTime = 60 * time.Second
	// serverKeepaliveTimeout is how long a probe waits before the server
	// declares the connection dead.
	serverKeepaliveTimeout = 20 * time.Second
)

// grpcKeepaliveEnforcement returns the server-side policy that permits the
// gateway's client keepalive instead of GOAWAY-ing it.
func grpcKeepaliveEnforcement() keepalive.EnforcementPolicy {
	return keepalive.EnforcementPolicy{
		MinTime:             serverMinKeepaliveTime,
		PermitWithoutStream: true,
	}
}

// grpcKeepaliveParams returns the server's own liveness probing parameters.
// MaxConnectionAge is deliberately left unset: forcing periodic reconnects
// would add avoidable tail latency to a mesh that has no load-balancer
// rebalancing requirement.
func grpcKeepaliveParams() keepalive.ServerParameters {
	return keepalive.ServerParameters{
		Time:    serverKeepaliveTime,
		Timeout: serverKeepaliveTimeout,
	}
}
