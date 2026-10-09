package middleware

import (
	"context"
	"log/slog"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"
)

// --- Outbound gRPC deadlines (RES-01) ---
//
// Every gateway handler passes r.Context() straight into its gRPC client. That
// context carries NO deadline: http.Server.WriteTimeout does not cancel
// r.Context() (it only bounds the response write), and there is no
// chi middleware.Timeout in the stack. Without a deadline a single wedged
// downstream service pins one gateway goroutine — plus its HTTP connection,
// its request body buffer and any pool handles it holds — until the client
// gives up. At the §8 target of 10K concurrent requests per gateway instance
// that exhausts the gateway long before the slow dependency recovers.
//
// GRPCTimeoutUnaryInterceptor gives every outbound call a bounded lifetime so
// a slow dependency degrades into fast DeadlineExceeded errors (which the
// handler layer maps to 503/504) instead of into gateway-wide goroutine
// exhaustion.

// defaultGRPCCallTimeout bounds a single outbound unary gRPC round-trip.
//
// Budget derivation (CLAUDE.md §8): the API p99 target is 500ms end-to-end and
// a handler may chain two or three backend calls, so a per-call ceiling of 5s
// is ~10x the whole-request p99 budget — generous enough that it never trips on
// a merely-slow-but-working backend, tight enough that a wedged backend releases
// the goroutine in 5s rather than in the 15s http.Server.WriteTimeout (or never,
// for a request whose client keeps reading).
const defaultGRPCCallTimeout = 5 * time.Second

// grpcCallTimeoutEnv overrides defaultGRPCCallTimeout at boot (Go duration
// syntax, e.g. "3s"). A value of "0" disables the default deadline entirely —
// only for debugging; it restores the unbounded behaviour this guards against.
const grpcCallTimeoutEnv = "GRPC_CLIENT_TIMEOUT"

// longRunningGRPCMethods opts individual RPCs out of the default deadline with
// an explicit, longer one. Keyed by full method ("/pkg.Service/Method").
//
// Empty today: every RPC reachable from the gateway is a request/response call
// well inside the §8 budgets, and `grep -rn "stream " proto/` finds no
// streaming RPCs (a stream's lifetime is client-controlled and must never be
// bounded by a unary call timeout). Add an entry here — with the reason — if an
// RPC legitimately needs longer, rather than raising the global default.
var longRunningGRPCMethods = map[string]time.Duration{}

// GRPCCallTimeout returns the deadline applied to fullMethod.
func GRPCCallTimeout(fullMethod string) time.Duration {
	if override, ok := longRunningGRPCMethods[fullMethod]; ok {
		return override
	}
	return configuredGRPCCallTimeout()
}

// configuredGRPCCallTimeout resolves the process-wide default once per call
// site read. Parsed lazily rather than at init so tests can exercise it.
func configuredGRPCCallTimeout() time.Duration {
	raw := os.Getenv(grpcCallTimeoutEnv)
	if raw == "" {
		return defaultGRPCCallTimeout
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < 0 {
		slog.Warn("invalid gRPC client timeout, using default",
			"env", grpcCallTimeoutEnv,
			"value", raw,
			"default", defaultGRPCCallTimeout,
		)
		return defaultGRPCCallTimeout
	}
	return d
}

// GRPCTimeoutUnaryInterceptor bounds every outbound unary call.
//
// A caller-supplied deadline always wins when it is EARLIER than ours — a
// handler that deliberately budgets 200ms keeps its 200ms. A deadline that is
// later (or absent) is clamped down to the per-call ceiling, which is the case
// this exists for: handlers forwarding a deadline-free r.Context().
func GRPCTimeoutUnaryInterceptor(
	ctx context.Context,
	fullMethod string,
	req, reply any,
	cc *grpc.ClientConn,
	invoker grpc.UnaryInvoker,
	opts ...grpc.CallOption,
) error {
	timeout := GRPCCallTimeout(fullMethod)
	if timeout <= 0 {
		return invoker(ctx, fullMethod, req, reply, cc, opts...)
	}

	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) <= timeout {
		// Caller is already stricter than us — leave it alone.
		return invoker(ctx, fullMethod, req, reply, cc, opts...)
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	return invoker(ctx, fullMethod, req, reply, cc, opts...)
}

// --- Keepalive ---
//
// grpcClientKeepaliveTime / Timeout make a black-holed connection (node lost,
// NAT entry dropped, pod SIGKILLed mid-flight) surface as an error in ~40s
// instead of hanging until the OS TCP timeout, which on Linux is ~15 minutes.
// Per-call deadlines bound the individual request; keepalive is what stops the
// gateway from continuing to route new calls onto a dead subchannel.
const (
	grpcClientKeepaliveTime    = 30 * time.Second
	grpcClientKeepaliveTimeout = 10 * time.Second

	// GRPCServerMinKeepaliveTime is the server-side enforcement floor that the
	// Go services must configure. grpc-go's default EnforcementPolicy.MinTime
	// is 5 minutes: a client pinging every 30s accumulates ping strikes and is
	// dropped with GOAWAY "too_many_pings". Servers therefore set MinTime to
	// this value, comfortably below grpcClientKeepaliveTime.
	GRPCServerMinKeepaliveTime = 10 * time.Second
)

// GRPCClientKeepalive returns the keepalive parameters for every outbound
// gateway connection.
//
// PermitWithoutStream is true so idle subchannels are probed too. The gateway
// holds long-lived connections to services it may not call for minutes
// (imaging, notification); without it, the first call after an idle period is
// the one that discovers the connection died.
func GRPCClientKeepalive() keepalive.ClientParameters {
	return keepalive.ClientParameters{
		Time:                grpcClientKeepaliveTime,
		Timeout:             grpcClientKeepaliveTimeout,
		PermitWithoutStream: true,
	}
}
